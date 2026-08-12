package imageutil

import (
	"encoding/binary"
	"image"

	xdraw "golang.org/x/image/draw"
)

// EXIF orientation, read and applied by hand.
//
// Re-encoding a photo drops its metadata, which is the point — see ProcessPhoto
// — but orientation is the one tag that is not metadata about the picture so
// much as part of it. Phones almost always store the sensor's own landscape
// frame and record "rotate this 90°" beside it, so dropping the tag without
// applying it turns every portrait photo on its side.
//
// Parsed here rather than pulled in as a dependency. This is a fixed offset
// into a well-specified header and about eighty lines; a library for it would
// be a supply-chain entry and a version to keep up with, for a single uint16.

// orientation values, as defined by EXIF. 1 is "already upright".
const (
	orientNormal        = 1
	orientFlipH         = 2
	orientRotate180     = 3
	orientFlipV         = 4
	orientTransposeCW   = 5
	orientRotate90CW    = 6
	orientTransposeCCW  = 7
	orientRotate270CW   = 8
	maxEXIFScanBytes    = 256 * 1024
	exifTagOrientation  = 0x0112
	exifIFDEntryLen     = 12
	exifHeaderMinLength = 8
)

// orientationOf returns the EXIF orientation of a JPEG, or orientNormal when
// there is none to find. Every failure path returns "upright": a photo whose
// header cannot be parsed is far better shown as it decoded than not shown.
func orientationOf(data []byte) int {
	// Only JPEG carries this. PNG has no EXIF orientation and the decoder
	// handles everything else.
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return orientNormal
	}

	// Walk the JPEG marker segments looking for APP1/Exif. Bounded, because a
	// malformed file must not send this scanning a hundred megabytes.
	limit := min(len(data), maxEXIFScanBytes)
	for i := 2; i+4 <= limit; {
		if data[i] != 0xFF {
			return orientNormal
		}
		marker := data[i+1]
		// Standalone markers carry no length.
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		// Start of scan: the pixel data begins, and any EXIF is behind us.
		if marker == 0xDA {
			return orientNormal
		}
		segLen := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if segLen < 2 || i+2+segLen > limit {
			return orientNormal
		}
		if marker == 0xE1 {
			seg := data[i+4 : i+2+segLen]
			if len(seg) > 6 && string(seg[:4]) == "Exif" {
				if o := orientationFromTIFF(seg[6:]); o != 0 {
					return o
				}
			}
		}
		i += 2 + segLen
	}
	return orientNormal
}

// orientationFromTIFF reads the orientation tag out of the TIFF header an Exif
// segment wraps. Returns 0 when there is none.
func orientationFromTIFF(tiff []byte) int {
	if len(tiff) < exifHeaderMinLength {
		return 0
	}
	var order binary.ByteOrder
	switch {
	case tiff[0] == 'I' && tiff[1] == 'I':
		order = binary.LittleEndian
	case tiff[0] == 'M' && tiff[1] == 'M':
		order = binary.BigEndian
	default:
		return 0
	}

	offset := int(order.Uint32(tiff[4:8]))
	if offset < exifHeaderMinLength || offset+2 > len(tiff) {
		return 0
	}
	count := int(order.Uint16(tiff[offset : offset+2]))
	entries := tiff[offset+2:]
	for i := 0; i < count; i++ {
		start := i * exifIFDEntryLen
		if start+exifIFDEntryLen > len(entries) {
			return 0
		}
		e := entries[start : start+exifIFDEntryLen]
		if order.Uint16(e[0:2]) != exifTagOrientation {
			continue
		}
		// A SHORT value sits in the first two bytes of the value field.
		v := int(order.Uint16(e[8:10]))
		if v >= orientNormal && v <= orientRotate270CW {
			return v
		}
		return 0
	}
	return 0
}

// applyOrientation returns src rotated and flipped so it is upright.
//
// Written out per case rather than as a general affine transform: there are
// eight of them, they are fixed, and a matrix would need the same eight cases
// to build it plus the reader's trust that it got them right.
func applyOrientation(src image.Image, orientation int) image.Image {
	if orientation <= orientNormal || orientation > orientRotate270CW {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()

	// The four rotating cases swap the dimensions.
	swap := orientation == orientTransposeCW || orientation == orientRotate90CW ||
		orientation == orientTransposeCCW || orientation == orientRotate270CW
	dw, dh := w, h
	if swap {
		dw, dh = h, w
	}

	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	// Through an RGBA copy of the source, so reading a pixel is an array index
	// rather than an interface call per pixel.
	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.Draw(rgba, rgba.Bounds(), src, b.Min, xdraw.Src)

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var nx, ny int
			switch orientation {
			case orientFlipH:
				nx, ny = w-1-x, y
			case orientRotate180:
				nx, ny = w-1-x, h-1-y
			case orientFlipV:
				nx, ny = x, h-1-y
			case orientTransposeCW:
				nx, ny = y, x
			case orientRotate90CW:
				nx, ny = h-1-y, x
			case orientTransposeCCW:
				nx, ny = h-1-y, w-1-x
			case orientRotate270CW:
				nx, ny = y, w-1-x
			}
			copy(dst.Pix[dst.PixOffset(nx, ny):], rgba.Pix[rgba.PixOffset(x, y):rgba.PixOffset(x, y)+4])
		}
	}
	return dst
}
