"""Cut the five resource icons out of resources_sheet.webp as crisp 1x sprites on a transparent strip.

The sheet draws each art pixel as an 8x8 block on a solid #2a1a0e background, so we sample block
centres and drop background blocks. Output: one 16x16 cell per resource, in RESOURCE order.

Usage: python tools/extract_resource_icons.py
"""
import numpy as np
from PIL import Image

SRC = "apps/web/public/assets/resources_sheet.webp"
OUT = "apps/web/public/assets/resource_icons.png"
SHEET_ORDER = ["brick", "wheat", "ore", "wood", "sheep"]
RESOURCE = ["sheep", "wheat", "wood", "brick", "ore"]
CELL, PX = 16, 8

a = np.asarray(Image.open(SRC).convert("RGB")).astype(int)
bg = a[2, 2]
grid = a[PX // 2::PX, PX // 2::PX]                      # one sample per art pixel
solid = np.abs(grid - bg).sum(2) > 10
cols = np.nonzero(solid.any(0))[0]
runs, start = [], cols[0]
for p, c in zip(cols, cols[1:]):
    if c > p + 1: runs.append((start, p)); start = c
runs.append((start, cols[-1]))
assert len(runs) == 5, runs

strip = Image.new("RGBA", (CELL * 5, CELL), (0, 0, 0, 0))
for name, (x0, x1) in zip(SHEET_ORDER, runs):
    rows = np.nonzero(solid[:, x0:x1 + 1].any(1))[0]
    y0, y1 = rows[0], rows[-1]
    icon = np.zeros((y1 - y0 + 1, x1 - x0 + 1, 4), np.uint8)
    icon[..., :3] = grid[y0:y1 + 1, x0:x1 + 1]
    icon[..., 3] = np.where(solid[y0:y1 + 1, x0:x1 + 1], 255, 0)
    im = Image.fromarray(icon)
    i = RESOURCE.index(name)
    strip.alpha_composite(im, (i * CELL + (CELL - im.width) // 2, (CELL - im.height) // 2))
    print(name, im.size)
strip.save(OUT)
