package imageutil

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
)

// Identicon geometry: a 5-column grid, mirrored about the centre column so the
// result reads as a deliberate mark rather than noise.
const (
	identiconGrid = 5
	identiconSize = 256
	// Padding keeps the pattern clear of the circular crop the UI applies.
	identiconPad = 28
)

// Identicon renders a deterministic avatar for a seed (a username). The same
// seed always produces the same image, so it needs no storage: it can be
// regenerated on demand and cached forever by URL.
//
// It exists because a push notification icon has to be a real image URL — the
// initial-on-a-gradient the UI draws in CSS cannot be handed to the OS.
func Identicon(seed string) ([]byte, error) {
	sum := sha256.Sum256([]byte(seed))

	// Hue from the first two bytes; fixed saturation and lightness so every
	// generated avatar sits at the same weight regardless of seed, and none
	// come out muddy or fluorescent.
	hue := float64(int(sum[0])<<8|int(sum[1])) / 65535 * 360
	fg := hsl(hue, 0.55, 0.55)
	bg := hsl(hue, 0.30, 0.16)

	img := image.NewRGBA(image.Rect(0, 0, identiconSize, identiconSize))
	for y := range identiconSize {
		for x := range identiconSize {
			img.Set(x, y, bg)
		}
	}

	cell := (identiconSize - 2*identiconPad) / identiconGrid
	half := identiconGrid/2 + 1 // columns actually decided; the rest mirror
	for col := range half {
		for row := range identiconGrid {
			// One bit per cell, taken from the tail of the hash so it is
			// independent of the bytes that chose the hue.
			if sum[2+col*identiconGrid+row]&1 == 0 {
				continue
			}
			for _, c := range [2]int{col, identiconGrid - 1 - col} {
				x0 := identiconPad + c*cell
				y0 := identiconPad + row*cell
				for y := y0; y < y0+cell; y++ {
					for x := x0; x < x0+cell; x++ {
						img.Set(x, y, fg)
					}
				}
			}
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode identicon: %w", err)
	}
	return buf.Bytes(), nil
}

// hsl converts HSL to RGBA. Hue is in degrees; saturation and lightness in
// [0,1]. Used so a single hash-derived hue yields a matched fore/background
// pair without hand-picking a palette.
func hsl(h, s, l float64) color.RGBA {
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := l - c/2
	var r, g, b float64
	switch {
	case h < 60:
		r, g, b = c, x, 0
	case h < 120:
		r, g, b = x, c, 0
	case h < 180:
		r, g, b = 0, c, x
	case h < 240:
		r, g, b = 0, x, c
	case h < 300:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return color.RGBA{
		R: uint8(math.Round((r + m) * 255)),
		G: uint8(math.Round((g + m) * 255)),
		B: uint8(math.Round((b + m) * 255)),
		A: 255,
	}
}
