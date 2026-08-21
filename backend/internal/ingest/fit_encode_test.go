package ingest

import (
	"bytes"
	"encoding/binary"
	"time"
)

/*
A minimal FIT writer, for tests only.

Every FIT test needs a file, and there is no sample activity in this repo to
read — the format is binary and a fixture would be an opaque blob nobody could
review. Writing the bytes here instead means each test states exactly which
shape of file it is about: big-endian, compressed timestamps, developer fields,
a field left at its invalid value.

It is deliberately a separate implementation from the decoder rather than its
inverse. A round trip through one set of assumptions proves only that the
assumptions are self-consistent; this is written from the protocol document, so
where the two disagree, one of them is wrong about the format.
*/

// fitField numbers and sizes for the writer.
type wField struct {
	num  byte
	size int
	base byte
}

const (
	tEnum   = 0x00
	tUint8  = 0x02
	tSint8  = 0x01
	tUint16 = 0x84
	tSint16 = 0x83
	tUint32 = 0x86
	tSint32 = 0x85
	tString = 0x07
)

// fitWriter builds a FIT file one message at a time.
type fitWriter struct {
	body   bytes.Buffer
	order  binary.ByteOrder
	bigEnd bool
}

func newFitWriter() *fitWriter { return &fitWriter{order: binary.LittleEndian} }

// bigEndian switches the byte order used by definitions written from here on,
// which a real file may do per definition message.
func (w *fitWriter) bigEndian() *fitWriter {
	w.order, w.bigEnd = binary.BigEndian, true
	return w
}

// define writes a definition message for a local message type.
func (w *fitWriter) define(local byte, global uint16, fields []wField) {
	w.defineWithDev(local, global, fields, nil)
}

// defineWithDev writes a definition that also declares developer fields, whose
// sizes a decoder must step over even though it cannot know what they hold.
func (w *fitWriter) defineWithDev(local byte, global uint16, fields []wField, devSizes []int) {
	header := byte(0x40) | local
	if len(devSizes) > 0 {
		header |= 0x20
	}
	w.body.WriteByte(header)
	w.body.WriteByte(0) // reserved
	if w.bigEnd {
		w.body.WriteByte(1)
	} else {
		w.body.WriteByte(0)
	}
	var g [2]byte
	w.order.PutUint16(g[:], global)
	w.body.Write(g[:])
	w.body.WriteByte(byte(len(fields)))
	for _, f := range fields {
		w.body.Write([]byte{f.num, byte(f.size), f.base})
	}
	if len(devSizes) > 0 {
		w.body.WriteByte(byte(len(devSizes)))
		for i, size := range devSizes {
			w.body.Write([]byte{byte(i), byte(size), 0})
		}
	}
}

// data writes a data message: the values in the order they were defined, then
// any developer-field padding.
func (w *fitWriter) data(local byte, fields []wField, values []any, devSizes []int) {
	w.body.WriteByte(local)
	w.writeValues(fields, values)
	for _, size := range devSizes {
		w.body.Write(make([]byte, size))
	}
}

// compressed writes a data message under a compressed timestamp header, which
// carries five bits of time offset in the header byte itself.
func (w *fitWriter) compressed(local byte, offset byte, fields []wField, values []any) {
	w.body.WriteByte(0x80 | (local&0x03)<<5 | offset&0x1F)
	w.writeValues(fields, values)
}

func (w *fitWriter) writeValues(fields []wField, values []any) {
	for i, f := range fields {
		var v any
		if i < len(values) {
			v = values[i]
		}
		switch f.base {
		case tString:
			s, _ := v.(string)
			b := make([]byte, f.size)
			copy(b, s)
			w.body.Write(b)
		case tUint8, tEnum, tSint8:
			w.body.WriteByte(byte(toInt(v)))
		case tUint16, tSint16:
			var b [2]byte
			w.order.PutUint16(b[:], uint16(toInt(v)))
			w.body.Write(b[:])
		case tUint32, tSint32:
			var b [4]byte
			w.order.PutUint32(b[:], uint32(toInt(v)))
			w.body.Write(b[:])
		}
	}
}

func toInt(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case int64:
		return n
	case uint32:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

// bytes finishes the file: a 12-byte header naming the body's length, and a
// two-byte CRC slot the decoder is expected not to depend on.
func (w *fitWriter) bytes() []byte {
	var out bytes.Buffer
	out.WriteByte(12)
	out.WriteByte(0x20) // protocol version
	out.Write([]byte{0x00, 0x00})
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(w.body.Len()))
	out.Write(size[:])
	out.WriteString(fitSignature)
	out.Write(w.body.Bytes())
	out.Write([]byte{0x00, 0x00})
	return out.Bytes()
}

// fitTime converts a real instant to FIT's seconds-since-1989 encoding.
func fitTime(t time.Time) uint32 { return uint32(t.Sub(fitEpoch).Seconds()) }

// degreesToSemicircles is the inverse of what the decoder does to a position.
func degreesToSemicircles(deg float64) int32 { return int32(deg / (180.0 / 2147483648.0)) }
