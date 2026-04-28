#!/usr/bin/env python3
"""Generate PWA icons for desk-quotes.

Renders a single italic 'Q' on the cream background, in two sizes (192, 512).
Uses macOS system Times font for portability.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

BG = (250, 247, 240)   # #FAF7F0
FG = (26, 26, 26)      # #1A1A1A

# Try a few likely macOS serif fonts in order of preference
FONT_CANDIDATES = [
    '/Library/Fonts/Hoefler Text.ttc',
    '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf',
    '/System/Library/Fonts/Times.ttc',
    '/System/Library/Fonts/NewYork.ttf',
]

def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("No suitable serif font found on this system.")

def make_icon(size, font_path, out_path, *, maskable=False):
    img = Image.new('RGB', (size, size), BG)
    draw = ImageDraw.Draw(img)

    # Maskable icons need a 'safe zone' — Android crops up to 20% from each edge
    safe_inset = 0.10 if maskable else 0.0
    safe_size = size * (1 - 2 * safe_inset)

    # Render Q at ~72% of the safe area
    point_size = int(safe_size * 0.72)
    font = ImageFont.truetype(font_path, point_size)

    text = 'Q'
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] - size * 0.02  # nudge up slightly

    draw.text((x, y), text, fill=FG, font=font)
    img.save(out_path, 'PNG', optimize=True)
    print(f"  wrote {out_path}")

def main():
    font_path = find_font()
    print(f"Using font: {font_path}")
    for size in (192, 512):
        make_icon(size, font_path, os.path.join(OUT_DIR, f'icon-{size}.png'))
    # Also a maskable version at 512 for Android adaptive icons
    make_icon(512, font_path, os.path.join(OUT_DIR, 'icon-512-maskable.png'), maskable=True)

if __name__ == '__main__':
    main()
