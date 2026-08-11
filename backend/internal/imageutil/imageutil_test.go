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

func TestProcessPhotoDownscalesAndThumbnails(t *testing.T) {
	full, thumb, w, h, err := ProcessPhoto(makePNG(t, 4000, 3000))
	if err != nil {
		t.Fatalf("ProcessPhoto: %v", err)
	}
	if w != MaxPhotoDim || h != MaxPhotoDim*3/4 {
		t.Errorf("stored dimensions = %dx%d, want %dx%d", w, h, MaxPhotoDim, MaxPhotoDim*3/4)
	}
	fw, fh := decodeDims(t, full)
	if fw != w || fh != h {
		t.Errorf("full image is %dx%d but the row says %dx%d", fw, fh, w, h)
	}
	tw, th := decodeDims(t, thumb)
	if tw != MaxThumbDim {
		t.Errorf("thumbnail width = %d, want %d", tw, MaxThumbDim)
	}
	// The tile is what almost every request fetches, so it being genuinely
	// smaller is the whole point of generating it.
	if len(thumb) >= len(full) {
		t.Errorf("thumbnail (%d bytes) is not smaller than the full image (%d bytes)", len(thumb), len(full))
	}
	_ = th
}

// A photo already within bounds is still re-encoded, because that is what
// strips the EXIF — and a phone photo's EXIF carries where it was taken. A
// "leave small images alone" optimisation would silently publish the GPS
// coordinates of every picture small enough to skip the resize.
func TestProcessPhotoReencodesSmallImages(t *testing.T) {
	full, _, w, h, err := ProcessPhoto(makePNG(t, 300, 200))
	if err != nil {
		t.Fatalf("ProcessPhoto: %v", err)
	}
	if w != 300 || h != 200 {
		t.Errorf("dimensions = %dx%d, want 300x200", w, h)
	}
	if len(full) < 2 || full[0] != 0xFF || full[1] != 0xD8 {
		t.Error("small image was not re-encoded as JPEG, so its metadata survived")
	}
}

func TestProcessPhotoRejectsNonImages(t *testing.T) {
	if _, _, _, _, err := ProcessPhoto([]byte("this is not a photograph")); err == nil {
		t.Error("ProcessPhoto accepted bytes that are not an image")
	}
}
