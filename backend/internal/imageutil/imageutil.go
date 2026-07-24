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
