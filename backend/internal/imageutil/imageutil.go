// Package imageutil provides small image helpers used for avatar processing.
package imageutil

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif" // register GIF decoder
	"image/jpeg"
	_ "image/png" // register PNG decoder

	xdraw "golang.org/x/image/draw"
)

// MaxAvatarDim is the largest width/height (px) an avatar is stored at.
const MaxAvatarDim = 512

// ProcessAvatar decodes an image, downscales it so neither side exceeds
// MaxAvatarDim (preserving aspect ratio), and re-encodes it as JPEG. Images
// already within bounds are still re-encoded to normalise the format.
func ProcessAvatar(data []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("invalid image dimensions")
	}

	dw, dh := scaledDims(w, h, MaxAvatarDim)

	var out image.Image
	if dw == w && dh == h {
		out = src
	} else {
		dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Over, nil)
		out = dst
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 85}); err != nil {
		return nil, fmt.Errorf("encode image: %w", err)
	}
	return buf.Bytes(), nil
}

// Bounds for workout gallery photos.
const (
	// MaxPhotoDim is the longest side a stored photo keeps. Generous enough to
	// stay sharp full-screen on a high-density phone and when zoomed a little on
	// a desktop, and far below what a modern camera produces — a 12 MP phone
	// photo is around 4000px, and storing that costs four times the disk to
	// show the same picture.
	MaxPhotoDim = 2048

	// MaxThumbDim is the grid tile. The gallery lays out several across, so this
	// is what almost every request actually fetches.
	MaxThumbDim = 400

	photoQuality = 82
	thumbQuality = 72
)

// ProcessPhoto decodes an image, downscales it so neither side exceeds
// MaxPhotoDim, and returns the full-size JPEG, a thumbnail, and the stored
// dimensions.
//
// Re-encoding unconditionally, even for an image already within bounds, is the
// point rather than an oversight: it normalises the format so the gallery only
// ever serves JPEG, and it drops every metadata block the source carried. A
// phone photo arrives with GPS coordinates in its EXIF, and a workout that is
// shared publicly should not quietly publish the photographer's home address
// because they took a picture in the kitchen.
//
// The cost is orientation. EXIF carries the camera's rotation, and dropping it
// would leave a portrait photo on its side, so it is read and applied before
// the tag goes.
func ProcessPhoto(data []byte) (full, thumb []byte, w, h int, err error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("decode image: %w", err)
	}
	src = applyOrientation(src, orientationOf(data))

	b := src.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return nil, nil, 0, 0, fmt.Errorf("invalid image dimensions")
	}

	fw, fh := scaledDims(b.Dx(), b.Dy(), MaxPhotoDim)
	fullImg := resize(src, fw, fh)
	full, err = encode(fullImg, photoQuality)
	if err != nil {
		return nil, nil, 0, 0, err
	}

	tw, th := scaledDims(fw, fh, MaxThumbDim)
	thumb, err = encode(resize(fullImg, tw, th), thumbQuality)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	return full, thumb, fw, fh, nil
}

func resize(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	if w == b.Dx() && h == b.Dy() {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Over, nil)
	return dst
}

func encode(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode image: %w", err)
	}
	return buf.Bytes(), nil
}

// scaledDims returns the largest dimensions fitting within max on both sides
// while preserving aspect ratio. If the image already fits, the original
// dimensions are returned.
func scaledDims(w, h, max int) (int, int) {
	if w <= max && h <= max {
		return w, h
	}
	if w >= h {
		nh := int(float64(h) * float64(max) / float64(w))
		if nh < 1 {
			nh = 1
		}
		return max, nh
	}
	nw := int(float64(w) * float64(max) / float64(h))
	if nw < 1 {
		nw = 1
	}
	return nw, max
}
