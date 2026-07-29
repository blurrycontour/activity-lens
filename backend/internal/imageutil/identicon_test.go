package imageutil

import "testing"

func TestIdenticonIsDeterministicAndDistinct(t *testing.T) {
	a, err := Identicon("alice")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Identicon("alice")
	if string(a) != string(b) {
		t.Fatal("same seed must yield the same image")
	}
	c, _ := Identicon("bob")
	if string(a) == string(c) {
		t.Fatal("different seeds must differ")
	}
	if len(a) < 100 {
		t.Fatalf("suspiciously small PNG: %d bytes", len(a))
	}
}
