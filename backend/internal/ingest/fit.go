package ingest

import (
	"encoding/binary"
	"fmt"
	"math"
	"time"
)

/*
The FIT format, decoded far enough to read an activity.

FIT is Garmin's binary recording format and the native output of most watches
and bike computers — the GPX or TCX beside it is an export of this, usually with
fields dropped on the way. It is a self-describing stream: every data message is
preceded, somewhere earlier in the file, by a definition message saying which
fields it carries, in what order, at what size and in which byte order. Nothing
can be read without tracking those definitions, which is why this is a decoder
rather than a struct with tags on it.

Only the format lives here — headers, records, base types, scaling. What the
numbers *mean* is in fit_activity.go. The split is deliberate: if hand-decoding
ever becomes a burden, that file keeps working against any FIT SDK that can
produce the same `[]fitMessage`, and this one is what gets deleted.

Written against the FIT Protocol as published in Garmin's SDK. The parts that
are easy to get wrong, and are therefore tested: definition reuse across local
message types, per-definition endianness, compressed timestamp headers,
developer fields (whose contents we ignore but whose sizes we must still step
over), and chained files.
*/

// fitSignature is the magic at byte 8 of every FIT header.
const fitSignature = ".FIT"

// fitEpoch is FIT's zero time: 1989-12-31 00:00:00 UTC.
var fitEpoch = time.Date(1989, 12, 31, 0, 0, 0, 0, time.UTC)

/*
minValidTimestamp separates real dates from device uptimes.

FIT allows a date_time below 0x10000000 to mean "seconds since the device
powered on", for gear that has never had a clock set. Those are not dates and
must not be read as ones — 0x0FFFFFFF as an offset from 1989 lands in 2098.
*/
const minValidTimestamp = 0x10000000

// Global message numbers, from the FIT profile. Only the ones read here.
const (
	msgFileID  = 0
	msgSession = 18
	msgSport   = 12
	msgRecord  = 20
)

// fitValue is one decoded field: a number, or a string, or an array we keep the
// first element of.
//
// Numbers are float64 throughout. FIT's integers arrive in eleven widths and
// most of them are scaled — a speed is thousandths of a metre per second, an
// altitude is fifths of a metre offset by 500 — so everything becomes a float
// at the point of decoding and the callers deal in real units. The alternative,
// carrying the raw integer plus its scale to every call site, is how a factor of
// 1000 ends up in a chart.
type fitValue struct {
	num   float64
	str   string
	isNum bool
}

// fitMessage is one decoded data message: which kind it is, and its fields by
// number. Fields the definition declared but the file left at the invalid value
// are absent, so a caller never has to know what "no value" looks like for
// eleven different base types.
type fitMessage struct {
	global uint16
	fields map[byte]fitValue
}

// num returns a numeric field, reporting whether it was present.
func (m fitMessage) num(field byte) (float64, bool) {
	v, ok := m.fields[field]
	if !ok || !v.isNum {
		return 0, false
	}
	return v.num, true
}

// text returns a string field, trimmed of its padding.
func (m fitMessage) text(field byte) (string, bool) {
	v, ok := m.fields[field]
	if !ok || v.isNum || v.str == "" {
		return "", false
	}
	return v.str, true
}

// timestamp reads a date_time field as a real instant, rejecting the
// device-uptime encoding described at minValidTimestamp.
func (m fitMessage) timestamp(field byte) (time.Time, bool) {
	v, ok := m.num(field)
	if !ok || v < minValidTimestamp || v > math.MaxUint32 {
		return time.Time{}, false
	}
	return fitEpoch.Add(time.Duration(int64(v)) * time.Second), true
}

// fitBaseType describes one of FIT's primitive types: how wide it is, and which
// bit pattern means "the sensor had nothing to say".
type fitBaseType struct {
	size    int
	invalid uint64
	signed  bool
	float   bool
	str     bool
}

// baseTypes is indexed by the low 5 bits of a field's base-type byte.
//
// The invalid values are part of the format, not a convention: an absent field
// is still written, filled with its type's invalid pattern. Reading those as
// data is what puts a heart rate of 255 and an altitude of -500 on a chart.
var baseTypes = map[byte]fitBaseType{
	0x00: {size: 1, invalid: 0xFF},                             // enum
	0x01: {size: 1, invalid: 0x7F, signed: true},               // sint8
	0x02: {size: 1, invalid: 0xFF},                             // uint8
	0x83: {size: 2, invalid: 0x7FFF, signed: true},             // sint16
	0x84: {size: 2, invalid: 0xFFFF},                           // uint16
	0x85: {size: 4, invalid: 0x7FFFFFFF, signed: true},         // sint32
	0x86: {size: 4, invalid: 0xFFFFFFFF},                       // uint32
	0x07: {size: 1, invalid: 0x00, str: true},                  // string
	0x88: {size: 4, invalid: 0xFFFFFFFF, float: true},          // float32
	0x89: {size: 8, invalid: 0xFFFFFFFFFFFFFFFF, float: true},  // float64
	0x0A: {size: 1, invalid: 0x00},                             // uint8z
	0x8B: {size: 2, invalid: 0x0000},                           // uint16z
	0x8C: {size: 4, invalid: 0x00000000},                       // uint32z
	0x0D: {size: 1, invalid: 0xFF},                             // byte
	0x8E: {size: 8, invalid: 0x7FFFFFFFFFFFFFFF, signed: true}, // sint64
	0x8F: {size: 8, invalid: 0xFFFFFFFFFFFFFFFF},               // uint64
	0x90: {size: 8, invalid: 0x0000000000000000},               // uint64z
}

// baseTypeFor resolves a field's base-type byte. The low 5 bits are the type;
// bit 7 marks it as endian-sensitive and is part of the key above.
func baseTypeFor(b byte) (fitBaseType, bool) {
	if t, ok := baseTypes[b&0x9F]; ok {
		return t, true
	}
	return fitBaseType{}, false
}

// fitField is one field within a definition: which field number it is, how many
// bytes it occupies, and how to read them.
type fitField struct {
	num  byte
	size int
	base fitBaseType
	// known is false for a developer field, or one whose base type this build
	// does not recognise. Its bytes are still counted and skipped — the size is
	// what keeps the reader aligned with the stream.
	known bool
}

// fitDefinition is a local message type's current shape. A file redefines a
// local type as often as it likes, so this is state, not a header.
type fitDefinition struct {
	global uint16
	order  binary.ByteOrder
	fields []fitField
	size   int
}

/*
fitLimits bound what one file may produce.

A FIT file is a length-prefixed stream, so a corrupt or hostile one can claim
almost anything. These stop a bad file costing memory rather than an error: the
message cap is far above a twelve-hour ride at one sample a second, and the
chained-file cap is far above the two or three a multisport activity produces.
*/
const (
	maxFitMessages = 2_000_000
	maxFitChained  = 16
)

/*
minSalvageMessages is how much of a file must have decoded before a failure
part-way through is treated as damage rather than as a misreading.

Both cases exist and they need opposite answers. A watch whose battery died
mid-ride writes a file that is perfectly well-formed until it simply stops:
thousands of messages, then nothing, and that ride happened and should import. A
file this decoder has misread — an encoding it does not handle, or a bug here —
also fails part-way, but after a handful of messages, and salvaging that produces
a workout assembled from misaligned bytes: a plausible-looking row with a
distance and a heart rate that were never recorded. Refusing is the only safe
answer there, because nothing downstream can tell the difference.

A real recording writes a message a second, so anything worth keeping is
hundreds; this sits far below that and far above what a misparse survives.
*/
const minSalvageMessages = 32

// decodeFIT reads every data message in a file, in order.
//
// Errors are returned only for a file that cannot be read at all — a bad
// signature, a truncated header, a definition that runs off the end. Anything
// self-consistent but unrecognised (an unknown base type, a message type
// nothing here reads, developer data) is stepped over by its declared size,
// because a decoder that fails on the parts it does not need is a decoder that
// fails on every watch it was not written against.
func decodeFIT(data []byte) ([]fitMessage, error) {
	var out []fitMessage
	for files := 0; files < maxFitChained; files++ {
		if len(data) < 12 {
			break
		}
		headerSize := int(data[0])
		if headerSize < 12 || headerSize > len(data) {
			return nil, fmt.Errorf("parse fit: header size %d", headerSize)
		}
		if string(data[8:12]) != fitSignature {
			// A first pass with no signature is not a FIT file; a later one is
			// simply the end of the chain, with a trailing CRC or padding left.
			if files == 0 {
				return nil, fmt.Errorf("parse fit: not a fit file")
			}
			break
		}
		dataSize := int(binary.LittleEndian.Uint32(data[4:8]))
		end := headerSize + dataSize
		// A truncated file is worth reading as far as it goes: a watch that ran
		// out of battery mid-ride writes exactly this, and the ride happened.
		if end > len(data) || dataSize <= 0 {
			end = len(data)
		}
		msgs, err := decodeFITRecords(data[headerSize:end], len(out))
		if err != nil {
			// Keep what was decoded before the damage, but only if there is
			// enough of it to be a recording rather than a misreading. See
			// minSalvageMessages.
			if len(out)+len(msgs) < minSalvageMessages {
				return nil, err
			}
			return append(out, msgs...), nil
		}
		out = append(out, msgs...)
		// Past the data section sits a two-byte CRC, then possibly another
		// complete FIT file — which is how multisport activities are stored.
		next := end + 2
		if next >= len(data) {
			break
		}
		data = data[next:]
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("parse fit: no data messages")
	}
	return out, nil
}

// decodeFITRecords walks one file's data section.
func decodeFITRecords(buf []byte, already int) ([]fitMessage, error) {
	var (
		out   []fitMessage
		defs  = map[byte]*fitDefinition{}
		pos   int
		lastT uint32
		haveT bool
	)
	for pos < len(buf) {
		if already+len(out) >= maxFitMessages {
			return out, fmt.Errorf("parse fit: too many messages")
		}
		header := buf[pos]
		pos++

		// Compressed timestamp header: five bits of local time offset packed
		// into the header byte itself, against the last full timestamp seen.
		// Watches use it for long stretches of records, so a decoder without it
		// reads a third of a real ride as garbage.
		if header&0x80 != 0 {
			local := (header >> 5) & 0x03
			def := defs[local]
			if def == nil {
				return out, fmt.Errorf("parse fit: data before its definition")
			}
			msg, n, err := readFITData(buf[pos:], def)
			if err != nil {
				return out, err
			}
			pos += n
			if haveT {
				offset := uint32(header & 0x1F)
				t := lastT&^0x1F | offset
				if offset < lastT&0x1F {
					t += 0x20 // the five-bit field rolled over
				}
				lastT = t
				msg.fields[253] = fitValue{num: float64(t), isNum: true}
			}
			out = append(out, msg)
			continue
		}

		local := header & 0x0F
		if header&0x40 != 0 {
			def, n, err := readFITDefinition(buf[pos:], header&0x20 != 0)
			if err != nil {
				return out, err
			}
			pos += n
			defs[local] = def
			continue
		}

		def := defs[local]
		if def == nil {
			return out, fmt.Errorf("parse fit: data before its definition")
		}
		msg, n, err := readFITData(buf[pos:], def)
		if err != nil {
			return out, err
		}
		pos += n
		if t, ok := msg.num(253); ok && t >= 0 && t <= math.MaxUint32 {
			lastT, haveT = uint32(t), true
		}
		out = append(out, msg)
	}
	return out, nil
}

// readFITDefinition reads a definition message, returning it and its length.
func readFITDefinition(buf []byte, hasDev bool) (*fitDefinition, int, error) {
	if len(buf) < 5 {
		return nil, 0, fmt.Errorf("parse fit: truncated definition")
	}
	def := &fitDefinition{order: binary.LittleEndian}
	if buf[1] == 1 {
		def.order = binary.BigEndian
	}
	def.global = def.order.Uint16(buf[2:4])
	count := int(buf[4])
	pos := 5
	if len(buf) < pos+count*3 {
		return nil, 0, fmt.Errorf("parse fit: truncated field list")
	}
	for i := 0; i < count; i++ {
		f := fitField{num: buf[pos], size: int(buf[pos+1])}
		f.base, f.known = baseTypeFor(buf[pos+2])
		def.fields = append(def.fields, f)
		def.size += f.size
		pos += 3
	}
	if hasDev {
		if len(buf) < pos+1 {
			return nil, 0, fmt.Errorf("parse fit: truncated developer field list")
		}
		devCount := int(buf[pos])
		pos++
		if len(buf) < pos+devCount*3 {
			return nil, 0, fmt.Errorf("parse fit: truncated developer field list")
		}
		for i := 0; i < devCount; i++ {
			// Developer fields carry whatever an app chose to record, described
			// by a field_description message elsewhere in the file. Nothing here
			// reads them — but their sizes are how the reader stays aligned with
			// the stream, so they are declared and skipped rather than ignored.
			def.fields = append(def.fields, fitField{size: int(buf[pos+1])})
			def.size += int(buf[pos+1])
			pos += 3
		}
	}
	return def, pos, nil
}

// readFITData reads one data message against its definition.
func readFITData(buf []byte, def *fitDefinition) (fitMessage, int, error) {
	if len(buf) < def.size {
		return fitMessage{}, 0, fmt.Errorf("parse fit: truncated data message")
	}
	msg := fitMessage{global: def.global, fields: make(map[byte]fitValue, len(def.fields))}
	pos := 0
	for _, f := range def.fields {
		raw := buf[pos : pos+f.size]
		pos += f.size
		if !f.known || f.size == 0 {
			continue
		}
		if v, ok := readFITField(raw, f, def.order); ok {
			msg.fields[f.num] = v
		}
	}
	return msg, pos, nil
}

// readFITField decodes one field's bytes, reporting whether it held a value.
//
// Arrays keep their first element. Every array field read here — a position, a
// speed — is a scalar in practice, and the one place FIT genuinely uses arrays
// is in messages this decoder does not read.
func readFITField(raw []byte, f fitField, order binary.ByteOrder) (fitValue, bool) {
	if f.base.str {
		// A string field is UTF-8 padded with NULs, and may hold several
		// strings; the first is the one that names the thing.
		for i, b := range raw {
			if b == 0 {
				raw = raw[:i]
				break
			}
		}
		if len(raw) == 0 {
			return fitValue{}, false
		}
		return fitValue{str: string(raw)}, true
	}
	size := f.base.size
	if size == 0 || len(raw) < size {
		return fitValue{}, false
	}
	var bits uint64
	switch size {
	case 1:
		bits = uint64(raw[0])
	case 2:
		bits = uint64(order.Uint16(raw[:2]))
	case 4:
		bits = uint64(order.Uint32(raw[:4]))
	case 8:
		bits = order.Uint64(raw[:8])
	default:
		return fitValue{}, false
	}
	if bits == f.base.invalid {
		return fitValue{}, false
	}
	switch {
	case f.base.float && size == 4:
		v := float64(math.Float32frombits(uint32(bits)))
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fitValue{}, false
		}
		return fitValue{num: v, isNum: true}, true
	case f.base.float:
		v := math.Float64frombits(bits)
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fitValue{}, false
		}
		return fitValue{num: v, isNum: true}, true
	case f.base.signed:
		// Sign-extend from the field's own width.
		shift := uint(64 - size*8)
		return fitValue{num: float64(int64(bits<<shift) >> shift), isNum: true}, true
	default:
		return fitValue{num: float64(bits), isNum: true}, true
	}
}
