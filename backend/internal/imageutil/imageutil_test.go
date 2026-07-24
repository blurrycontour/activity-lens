package imageutil

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func makePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func decodeDims(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	return cfg.Width, cfg.Height
}

func TestProcessAvatarDownscalesLargeLandscape(t *testing.T) {
	out, err := ProcessAvatar(makePNG(t, 2000, 1000))
	if err != nil {
		t.Fatalf("ProcessAvatar: %v", err)
	}
	w, h := decodeDims(t, out)
	if w != MaxAvatarDim {
		t.Errorf("width = %d, want %d", w, MaxAvatarDim)
	}
	if h != MaxAvatarDim/2 {
		t.Errorf("height = %d, want %d", h, MaxAvatarDim/2)
	}
}

func TestProcessAvatarDownscalesLargePortrait(t *testing.T) {
	out, err := ProcessAvatar(makePNG(t, 800, 1600))
	if err != nil {
		t.Fatalf("ProcessAvatar: %v", err)
	}
	w, h := decodeDims(t, out)
	if h != MaxAvatarDim {
		t.Errorf("height = %d, want %d", h, MaxAvatarDim)
	}
	if w != MaxAvatarDim/2 {
		t.Errorf("width = %d, want %d", w, MaxAvatarDim/2)
	}
}

func TestProcessAvatarKeepsSmallDimensions(t *testing.T) {
	out, err := ProcessAvatar(makePNG(t, 128, 96))
	if err != nil {
		t.Fatalf("ProcessAvatar: %v", err)
	}
	w, h := decodeDims(t, out)
	if w != 128 || h != 96 {
		t.Errorf("dims = %dx%d, want 128x96", w, h)
	}
}

func TestProcessAvatarRejectsGarbage(t *testing.T) {
	if _, err := ProcessAvatar([]byte("not an image")); err == nil {
		t.Fatal("expected error for non-image input")
	}
}
