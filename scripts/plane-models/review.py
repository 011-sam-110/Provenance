#!/usr/bin/env python3
"""A review sheet of every aircraft model, flat shaded, at the sizes the view draws them.

    python scripts/plane-models/review.py OUT.png [--only B738,A320] [--cols 5]

Software-drawn with numpy and Pillow from build.py's own triangles, so it needs no GPU and no
browser, and shows each model at 120, 60 and 28 px long (LOD0 at 120, the LOD the view would use at
the others) at the view's own tilt. Not run in the gate.
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import PALETTE, build_all, to_arrays  # noqa: E402

TILT = math.radians(58)
TURN = math.radians(-58)
SUN = np.array([math.sin(math.radians(215)) * math.sin(math.radians(35)), math.cos(math.radians(35)), math.cos(math.radians(215)) * math.sin(math.radians(35))])
GROUND = (11, 18, 24)
SS = 4


def srgb(hex_):
    return np.array([int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def draw(mesh, length, pixels):
    """One model `pixels` long in a square image: orthographic, turned, tilted, with a z buffer."""
    size = int(pixels * 1.5) * SS
    colour = np.tile(np.array(GROUND) / 255, (size, size, 1))
    depth = np.full((size, size), -1e9)
    k = pixels * SS / length
    ct, st = math.cos(TURN), math.sin(TURN)
    cx, sx = math.cos(TILT), math.sin(TILT)
    for a, b, c, key in mesh.tris:
        tri = np.array([a, b, c], dtype=float)
        # Turn about the vertical (Y), then tilt about the screen's horizontal.
        x = tri[:, 0] * ct + tri[:, 2] * st
        z = -tri[:, 0] * st + tri[:, 2] * ct
        y = tri[:, 1]
        # A right-handed view from behind and above, so a triangle wound outward faces the camera.
        sy = y * sx - z * cx
        dz = y * cx + z * sx
        px = x * k + size / 2
        py = size / 2 - sy * k
        area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0])
        if area >= 0:  # wound outward, so the far side faces away
            continue
        x0, x1 = max(int(px.min()), 0), min(int(px.max()) + 1, size - 1)
        y0, y1 = max(int(py.min()), 0), min(int(py.max()) + 1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        w0 = ((px[1] - gx) * (py[2] - gy) - (px[2] - gx) * (py[1] - gy)) / area
        w1 = ((px[2] - gx) * (py[0] - gy) - (px[0] - gx) * (py[2] - gy)) / area
        w2 = 1 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        d = w0 * dz[0] + w1 * dz[1] + w2 * dz[2]
        region = depth[y0:y1 + 1, x0:x1 + 1]
        nearer = inside & (d > region)
        n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        n = n / (np.linalg.norm(n) + 1e-9)
        light = 0.7 + 0.45 * max(float(n @ SUN), 0)
        region[nearer] = d[nearer]
        colour[y0:y1 + 1, x0:x1 + 1][nearer] = np.clip(srgb(PALETTE[key]) * light, 0, 1)
    img = Image.fromarray((colour * 255).astype(np.uint8)).resize((size // SS, size // SS), Image.LANCZOS)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--only", default="")
    ap.add_argument("--cols", type=int, default=5)
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    models = build_all(only)
    cell_w, cell_h = 300, 230
    rows = math.ceil(len(models) / args.cols)
    sheet = Image.new("RGB", (cell_w * args.cols, cell_h * rows), GROUND)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for i, (id_, parts) in enumerate(models.items()):
        x, y = cell_w * (i % args.cols), cell_h * (i // args.cols)
        big = draw(parts["lod0"], parts["length"], 120 if parts["length"] != 1.0 else 120)
        sheet.paste(big, (x + 4, y + 20))
        mid = draw(parts["lod0"], parts["length"], 60)
        sheet.paste(mid, (x + 190, y + 28))
        small = draw(parts["lod1"], parts["length"], 28)
        sheet.paste(small, (x + 210, y + 130))
        tris = len(to_arrays(parts["lod0"], 1)[2]) // 3
        d.text((x + 8, y + 2), f"{id_}  {parts['length']:.1f} m  {tris} tris", font=font, fill=(232, 241, 248))
    sheet.save(args.out)
    print("saved", args.out, sheet.size, len(models), "models")


if __name__ == "__main__":
    main()
