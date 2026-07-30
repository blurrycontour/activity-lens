#!/usr/bin/env python3
"""Regenerate the raster app icons from frontend/public/logo.svg.

logo.svg is the source of truth — this script never redefines the mark's
geometry, it only re-grounds and rescales what is already in that file.

To change the logo:
  1. edit frontend/public/logo.svg
  2. mirror the same numbers into frontend/src/components/Logo.tsx, which draws
     the mark inline so it can follow the active accent colour
  3. run this script

Not wired into the build: the icons change roughly never, and rasterising on
every build would add a Python dependency to a Node toolchain for no gain.

Usage:  python3 scripts/gen_icons.py
Needs:  pip install cairosvg
"""
import re
from pathlib import Path

import cairosvg

PUBLIC = Path(__file__).resolve().parent.parent / "frontend" / "public"

INK = "#0a0b0e"      # --bg in dark mode
ACCENT = "#00e87a"   # ACCENTS[0].value in frontend/src/lib/theme.ts

source = (PUBLIC / "logo.svg").read_text()

# Everything between the root <svg> tags — the mark itself, ground-agnostic.
match = re.search(r"<svg[^>]*>(.*)</svg>", source, re.S)
if not match:
    raise SystemExit(f"{PUBLIC / 'logo.svg'}: could not find the root <svg> element")
MARK = match.group(1).strip()


def doc(body: str) -> str:
    """Wrap markup in a 512-unit square SVG document."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '
        f'viewBox="0 0 512 512">{body}</svg>'
    )


# Transparent: browser tab, in-app, PWA "any" icon, plain logo.
TRANSPARENT = doc(MARK)

# Full-bleed dark. Square, not rounded — the platform applies its own mask, and
# baked-in corners would show as a rounded tile inside a rounded mask. Scaled to
# 0.86 so the mark clears the maskable safe zone (the central 80%).
TILED = doc(
    f'<rect width="512" height="512" fill="{INK}"/>'
    f'<g transform="translate(256,256) scale(0.86) translate(-256,-256)">{MARK}</g>'
)

# Android renders the notification badge as a monochrome mask: only the alpha
# channel survives, so this has to be a solid glyph on transparent.
BADGE = doc(MARK.replace(ACCENT, "#ffffff"))

JOBS = [
    ("favicon-32.png", TRANSPARENT, 32),
    ("logo.png", TRANSPARENT, 512),
    ("icon-192.png", TRANSPARENT, 192),
    ("icon-512.png", TRANSPARENT, 512),
    ("icon-maskable-512.png", TILED, 512),
    ("apple-touch-icon.png", TILED, 180),
    ("badge-96.png", BADGE, 96),
]


# The Android launcher icon and splash are vector drawables written by hand in
# mobile/android/app/src/main/res/, not rasterised here. They are the same two
# shapes as logo.svg — change the mark and they need the same edit, exactly as
# Logo.tsx does. See mobile/README.md.


def main() -> None:
    """Rasterise every icon variant into frontend/public."""
    for name, svg, px in JOBS:
        cairosvg.svg2png(
            bytestring=svg.encode(),
            write_to=str(PUBLIC / name),
            output_width=px,
            output_height=px,
            background_color=None,
        )
        print(f"wrote {name} ({px}px)")


if __name__ == "__main__":
    main()
