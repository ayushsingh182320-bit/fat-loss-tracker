"""Generate icon-180.png and icon-512.png: black square, bold orange dumbbell.

Usage: python3 tools/make_icons.py   (run from the repo root; needs Pillow)
"""
from PIL import Image, ImageDraw

ORANGE = (255, 106, 0, 255)
BLACK = (0, 0, 0, 255)
SS = 4  # supersample factor for smooth edges


def dumbbell(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), BLACK)
    d = ImageDraw.Draw(img)
    u = S / 100.0  # draw on a 100-unit grid
    r = lambda x0, y0, x1, y1, rad: d.rounded_rectangle(
        [x0 * u, y0 * u, x1 * u, y1 * u], radius=rad * u, fill=ORANGE)
    # handle bar
    r(22, 46, 78, 54, 2)
    # inner plates (tall)
    r(24, 26, 34, 74, 3)
    r(66, 26, 76, 74, 3)
    # outer plates (shorter)
    r(14, 33, 22, 67, 3)
    r(78, 33, 86, 67, 3)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


for n in (180, 512):
    dumbbell(n).save(f"icon-{n}.png", "PNG", optimize=True)
    print(f"wrote icon-{n}.png")
