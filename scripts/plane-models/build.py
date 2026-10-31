#!/usr/bin/env python3
"""Build the God's eye view's aircraft models from their dimensions. Plain Python: no Blender, no GPU.

    python scripts/plane-models/build.py [--only B738,A320] [--raw DIR] [--out public/models/planes]
    then pack each file:  npx gltfpack@1.3.0 -cc -kn -i <raw>.glb -o public/models/planes/<id>.glb

Reads shapes.json (how each model is built) and dimensions.json (its published length, span and
height, by ICAO type code). The numbers in shapes.json that dimensions.json does not hold (fuselage
width, sweep, chords, engine size) are estimates for the look, and docs/IMAGE-LICENSES.md says so.

Output frame (glTF, Y up): length 1.0 along Z with the NOSE toward -Z, the fuselage's centre line at
y = 0, right wing toward +X. components/eye/planeLayer.ts turns it with rotation.x = +PI/2, which puts
the nose on +Y (north at heading 0) in the map's east, north, up scene.

Each file holds two mesh objects named exactly `lod0` and `lod1`, with POSITION and COLOR_0 (linear)
only: no normals (the layer shades flat), no textures, no materials.
"""
import argparse
import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))

# The boats' palette (VESSEL_PALETTE), the view's plane colour, and two of this file's own.
PALETTE = {
    "top": "#e8f1f8",
    "belly": "#8eabbd",
    "wing": "#a9bdcb",
    "dark": "#56778b",
    "glass": "#16222c",
    "amber": "#fbbf24",
}
LOD_LIMIT = (1200, 250)

# Fuselage profiles: (share of the length, radius as a share of the largest, centre's rise as a share of the height).
AIRLINER = [(0, .02, 0), (.012, .28, -.05), (.035, .58, -.04), (.07, .84, -.02), (.115, .98, 0), (.17, 1, 0),
            (.66, 1, 0), (.78, .86, .10), (.88, .58, .26), (.96, .28, .40), (1, .06, .46)]
AIRLINER_LOW = [(0, .04, 0), (.035, .58, -.04), (.115, .98, 0), (.66, 1, 0), (.88, .58, .26), (1, .06, .46)]
TURBOPROP = [(0, .05, -.05), (.02, .42, -.08), (.06, .74, -.05), (.12, .96, 0), (.18, 1, 0), (.62, 1, 0),
             (.76, .78, .16), (.88, .46, .34), (1, .1, .52)]
TURBOPROP_LOW = [(0, .05, -.05), (.06, .74, -.05), (.18, 1, 0), (.62, 1, 0), (.88, .46, .34), (1, .1, .52)]
BIZJET = [(0, .02, -.08), (.03, .34, -.12), (.09, .68, -.08), (.17, .94, -.02), (.25, 1, 0), (.62, 1, 0),
          (.76, .86, .08), (.88, .56, .2), (1, .1, .34)]
BIZJET_LOW = [(0, .03, -.08), (.09, .68, -.08), (.25, 1, 0), (.62, 1, 0), (.88, .56, .2), (1, .1, .34)]
LIGHT = [(0, .22, -.05), (.1, .5, -.05), (.2, .86, 0), (.32, 1, .06), (.48, .86, .05), (.7, .42, .12), (1, .16, .2)]
LIGHT_LOW = [(0, .22, -.05), (.2, .86, 0), (.32, 1, .06), (.7, .42, .12), (1, .16, .2)]
HELI = [(0, .2, -.06), (.05, .55, -.07), (.13, .88, -.03), (.26, 1, 0), (.42, .92, .05), (.5, .5, .2), (.62, .2, .3), (.94, .13, .31), (1, .08, .31)]
HELI_LOW = [(0, .2, -.06), (.13, .88, -.03), (.26, 1, 0), (.5, .5, .2), (.62, .2, .3), (1, .08, .31)]
PROFILES = {"airliner": (AIRLINER, AIRLINER_LOW), "turboprop": (TURBOPROP, TURBOPROP_LOW), "bizjet": (BIZJET, BIZJET_LOW), "light": (LIGHT, LIGHT_LOW), "heli": (HELI, HELI_LOW)}
# Where a profile's windows are, as a share of the length.
GLASS = {"airliner": (.034, .072), "turboprop": (.05, .1), "bizjet": (.085, .135), "light": (.19, .34), "heli": (.03, .2)}


def linear(hex_):
    out = []
    for i in (1, 3, 5):
        c = int(hex_[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


class Mesh:
    """Triangles with one colour each, in metres: `p(aft, right, up)` from the nose."""

    def __init__(self, length):
        self.L = length
        self.tris = []  # (a, b, c, colour)

    def p(self, aft, right, up):
        return (right, up, aft - self.L / 2)

    def solid(self, tris):
        """A closed part: wound outward, whichever way it was written."""
        volume = sum(
            a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])
            for a, b, c, _ in tris
        )
        self.tris += tris if volume >= 0 else [(a, c, b, k) for a, b, c, k in tris]

    def card(self, a, b, c, d, colour):
        """A flat part seen from both sides: a blade, a strut."""
        self.tris += [(a, b, c, colour), (a, c, d, colour), (a, c, b, colour), (a, d, c, colour)]

    def loft(self, rings, colour, cap_colour=None):
        """Rings of equal length joined up and capped at both ends. `colour` may be a function of a face's centre."""
        n = len(rings[0])
        tris = []

        def pick(*pts):
            if callable(colour):
                return colour(tuple(sum(q[k] for q in pts) / len(pts) for k in range(3)))
            return colour

        for a in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                p0, p1, p2, p3 = rings[a][i], rings[a][j], rings[a + 1][j], rings[a + 1][i]
                k = pick(p0, p1, p2, p3)
                tris += [(p0, p1, p2, k), (p0, p2, p3, k)]
        for ring, cap in ((rings[0], cap_colour), (rings[-1], None)):
            centre = tuple(sum(q[k] for q in ring) / n for k in range(3))
            k = cap or pick(*ring)
            for i in range(n):
                tris.append((centre, ring[i], ring[(i + 1) % n], k))
        self.solid(tris)


def fuselage(m, kind, width, height, lod, hump=None):
    stations = PROFILES[kind][lod]
    sides = (10 if kind != "light" and kind != "heli" else 8) if lod == 0 else 6
    rings = []
    for x, r, z in stations:
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides + (math.pi / sides if lod else 0)
            up = math.sin(a) * r * height / 2 + z * height
            if hump and up > 0 and hump[0] <= x <= hump[1]:
                up += hump[2] * math.sin(a) * min(1, min(x - hump[0], hump[1] - x) / .04)
            ring.append(m.p(x * m.L, math.cos(a) * r * width / 2, up))
        rings.append(ring)
    lo, hi = GLASS[kind]

    def colour(c):
        aft = c[2] + m.L / 2
        if lo * m.L < aft < hi * m.L and c[1] > .08 * height:
            return "glass"
        return "top" if c[1] > -.12 * height else "belly"

    m.loft(rings, colour)


def section(m, aft_le, chord, right, up, thick, lod):
    t = chord * thick / 2
    if lod:
        return [m.p(aft_le, right, up), m.p(aft_le + chord * .35, right, up + t), m.p(aft_le + chord, right, up), m.p(aft_le + chord * .35, right, up - t)]
    return [m.p(aft_le, right, up), m.p(aft_le + chord * .25, right, up + t), m.p(aft_le + chord * .6, right, up + t * .7),
            m.p(aft_le + chord, right, up), m.p(aft_le + chord * .6, right, up - t * .6), m.p(aft_le + chord * .25, right, up - t * .8)]


def wing(m, x, z, semi, stations, sweep, dihedral, lod, thick=.11, tip=None, colour="wing"):
    """stations: (span share, chord). The leading edge runs back at `sweep` degrees from the side."""
    ts, td = math.tan(math.radians(sweep)), math.tan(math.radians(dihedral))
    for side in (1, -1):
        rings = []
        for frac, chord in stations:
            y = frac * semi
            rings.append(section(m, x + y * ts, chord, side * y, z + y * td, thick, lod))
        if tip and tip != "none":
            f, c = stations[-1]
            y = f * semi
            le, up = x + y * ts, z + y * td
            if tip in ("winglet", "split"):
                rings.append(section(m, le + c * .75, c * .5, side * (y + semi * .018), up + c * 1.2, thick, lod))
            elif tip == "sharklet":
                rings.append(section(m, le + c * .7, c * .55, side * (y + semi * .012), up + c * 1.5, thick, lod))
            elif tip == "raked":
                rings.append(section(m, le + c * 1.9, c * .3, side * (y + semi * .09), up + semi * .012, thick, lod))
            if tip == "split" and lod == 0:
                lower = [section(m, le, c, side * y, up, thick, lod), section(m, le + c * .6, c * .4, side * (y + semi * .012), up - c * .75, thick, lod)]
                m.loft(lower, colour)
        m.loft(rings, colour)


def fin(m, x, z, height, root, top, sweep, lod, colour="amber", lean=0.0, side=1):
    """A vertical surface. `lean` tips it outward, for a V-tail."""
    shift = height * math.tan(math.radians(sweep))
    out = height * lean * side
    def ring(a, chord, r, up):
        w = max(chord * .05, .03)
        if lod:
            return [m.p(a, r, up), m.p(a + chord * .4, r + w, up), m.p(a + chord, r, up), m.p(a + chord * .4, r - w, up)]
        return [m.p(a, r, up), m.p(a + chord * .4, r + w, up), m.p(a + chord, r, up), m.p(a + chord * .4, r - w, up)]
    m.loft([ring(x, root, 0, z), ring(x + shift, top, out, z + height)], colour)


def nacelle(m, aft, right, up, length, dia, lod, cap="glass"):
    sides = 10 if lod == 0 else 4
    shape = ((0, .9), (.08, 1), (.5, .98), (.85, .72), (1, .42)) if lod == 0 else ((0, 1), (1, .6))
    rings = []
    for f, r in shape:
        rings.append([m.p(aft + f * length, right + math.cos(2 * math.pi * i / sides) * r * dia / 2, up + math.sin(2 * math.pi * i / sides) * r * dia / 2) for i in range(sides)])
    m.loft(rings, "belly", cap_colour=cap)


def pylon(m, aft, right, up, length, drop):
    w = .09
    a = [m.p(aft, right - w, up), m.p(aft + length, right - w, up), m.p(aft + length, right + w, up), m.p(aft, right + w, up)]
    b = [m.p(aft + length * .2, right - w, up + drop), m.p(aft + length, right - w, up + drop), m.p(aft + length, right + w, up + drop), m.p(aft + length * .2, right + w, up + drop)]
    m.loft([a, b], "dark")


def propeller(m, aft, right, up, dia, blades, lod, chord=None):
    chord = chord or max(dia * .07, .1)
    count = blades if lod == 0 else min(blades, 2)
    for b in range(count):
        t = math.pi * b / count + math.pi / 4
        c, s = math.cos(t) * dia / 2, math.sin(t) * dia / 2
        ca, sa = -math.sin(t) * chord / 2, math.cos(t) * chord / 2
        m.card(m.p(aft, right - c - ca, up - s - sa), m.p(aft, right + c - ca, up + s - sa),
               m.p(aft, right + c + ca, up + s + sa), m.p(aft, right - c + ca, up - s + sa), "dark")


def stations_of(s, span):
    """The wing's planform, from the shape's own shares of the span, or its kind's usual ones."""
    kind = s.get("planform", "airliner")
    if kind == "airliner":
        return [(.03, s.get("root", span * .2)), (s.get("kink", .34), s.get("kinkC", span * .12)), (.97 if s.get("tip") not in (None, "none") else 1, s.get("tipC", span * .035))]
    if kind == "taper":
        return [(.03, s.get("root", span * .17)), (.97 if s.get("tip") not in (None, "none") else 1, s.get("tipC", span * .05))]
    if kind == "straight":
        return [(.02, s.get("root", span * .1)), (s.get("kink", .4), s.get("kinkC", s.get("root", span * .1))), (1, s.get("tipC", span * .06))]
    raise ValueError(kind)


def build_fixed_wing(id_, s, dims, lod):
    L, span, H = dims["lengthM"], dims["spanM"], dims["heightM"]
    arch = s["arch"]
    m = Mesh(L)
    width = s["w"]
    hf = s.get("hf", 1.05 if arch in ("jet", "biz") else 1.0)
    fh = width * hf
    profile = s.get("profile", {"jet": "airliner", "biz": "bizjet", "prop": "turboprop", "light": "light"}[arch])
    fuselage(m, profile, width, fh, lod, s.get("hump"))
    semi = span / 2
    place = s.get("wingZ", "low")
    z = {"low": -fh * .28, "mid": 0.0, "high": fh * .46}[place]
    x = s["wingX"] * L
    sweep = s.get("sweep", 0)
    dih = s.get("dih", 5 if place == "low" else 1)
    stations = stations_of(s, span)
    wing(m, x, z, semi, stations, sweep, dih, lod, thick=s.get("thick", .11), tip=s.get("tip"))

    # Wing-mounted engines: slung below a low or high wing, or carried over a low wing's top.
    for frac in s.get("eng", []):
        for side in (1, -1):
            y = frac * semi
            le = x + y * math.tan(math.radians(sweep))
            up = z + y * math.tan(math.radians(dih))
            length, dia = s["engL"], s["engD"]
            if s.get("engOver"):
                centre = up + dia * .34
            else:
                centre = up - dia * .62
            nacelle(m, le - length * s.get("engFwd", .62), side * y, centre, length, dia, lod)
            if lod == 0 and not s.get("engOver"):
                pylon(m, le - length * .18, side * y, centre + dia * .35, length * .55, dia * .4)
            if "propD" in s:
                propeller(m, le - length * s.get("engFwd", .62) - .1, side * y, centre, s["propD"], s.get("blades", 4), lod)
    # Rear engines, on the fuselage's sides.
    if "rear" in s:
        r = s["rear"]
        y = width / 2 * .8 + r["d"] * .62
        for side in (1, -1):
            nacelle(m, r["x"] * L, side * y, r.get("z", fh * .14), r["l"], r["d"], lod)
            if lod == 0:
                a = r["x"] * L + r["l"] * .3
                b = a + r["l"] * .4
                up = r.get("z", fh * .14)
                m.card(m.p(a, side * width * .3, up), m.p(b, side * width * .3, up), m.p(b, side * y, up), m.p(a, side * y, up), "dark")
    # An engine on the centre line: in the fin's root, or on the fuselage's back.
    if "tailEng" in s:
        r = s["tailEng"]
        nacelle(m, r["x"] * L, 0, r.get("z", fh * .62), r["l"], r["d"], lod)
    if "noseProp" in s:
        propeller(m, -.04, 0, -.05 * fh, s["noseProp"], s.get("blades", 2), lod)

    # The fin reaches the type's published height above the ground.
    centre_height = fh / 2 + s.get("gear", 1.0)
    fin_top = max(H - centre_height, fh * .8)
    fin_z = fh * s.get("finZ", .36)
    fin_h = fin_top - fin_z
    fin_root = s.get("finRoot", span * .155)
    fin_x = (s.get("finX", .79)) * L
    fin_sweep = s.get("finSweep", sweep + 8)
    tail = s.get("tail", "conv")
    stab_semi = s.get("stabSemi", span * .19)
    stab_root = s.get("stabRoot", span * .1)
    stab_sweep = s.get("stabSweep", sweep + 4)
    if tail == "V":
        for side in (1, -1):
            fin(m, fin_x, fh * .2, fin_h, fin_root, fin_root * .5, fin_sweep, lod, lean=.9, side=side)
    else:
        fin(m, fin_x, fin_z, fin_h, fin_root, fin_root * s.get("finTop", .38), fin_sweep, lod)
        if tail == "T":
            ax = fin_x + fin_h * math.tan(math.radians(fin_sweep)) + fin_root * .1
            wing(m, ax - stab_root * .2, fin_z + fin_h, stab_semi, [(.03, stab_root), (1, stab_root * .5)], stab_sweep, s.get("stabDih", -2), lod, thick=.09)
        elif tail == "cruci":
            up = fin_h * .42
            ax = fin_x + up * math.tan(math.radians(fin_sweep))
            wing(m, ax, fin_z + up, stab_semi, [(.03, stab_root), (1, stab_root * .5)], stab_sweep, 2, lod, thick=.09)
        else:
            wing(m, s.get("stabX", .84) * L, s.get("stabZ", fh * .22), stab_semi, [(.03, stab_root), (1, stab_root * .36)], stab_sweep, s.get("stabDih", 5), lod, thick=.09)

    if s.get("strut") and lod == 0:
        for side in (1, -1):
            a = x + stations[0][1] * .25
            y = semi * .48
            m.card(m.p(a, side * width * .42, -fh * .32), m.p(a + .1, side * width * .42, -fh * .32), m.p(a + .1, side * y, z), m.p(a, side * y, z), "dark")
    return m


def build_heli(id_, s, dims, lod):
    L, rotor_dia = dims["lengthM"], dims.get("spanM") or s["rotor"]
    if s.get("basis") == "overall":
        # This type's published length runs from the rotor's tip to the tail, so the body is shorter.
        L = (L - rotor_dia / 2) / (1 - s.get("hub", .3))
    m = Mesh(L)
    width, fh = s["w"], s.get("h", s["w"] * 1.15)
    fuselage(m, "heli", width, fh, lod)
    fin(m, .9 * L, fh * .2, fh * .75, fh * .5, fh * .33, 24, lod)
    wing(m, .78 * L, fh * .4, width * .62, [(.05, fh * .3), (1, fh * .24)], 0, 0, lod, thick=.09)
    hub = s.get("hub", .3) * L
    top = fh * .82
    # The mast, then the blades, real diameter, seen from both sides.
    if lod == 0:
        mast = L * .006
        m.card(m.p(hub - mast, 0, fh * .4), m.p(hub + mast, 0, fh * .4), m.p(hub + mast, 0, top), m.p(hub - mast, 0, top), "dark")
    blades = s.get("blades", 4)
    r = rotor_dia / 2
    w = rotor_dia * .02
    for k in range(blades if lod == 0 else min(blades, 2) * (2 if blades % 2 == 0 else 1)):
        a = math.pi / 4 + k * 2 * math.pi / (blades if lod == 0 else 4)
        c, sn = math.cos(a), math.sin(a)
        near = L * .015
        m.card(m.p(hub + sn * near - c * w, c * near + sn * w, top), m.p(hub + sn * r - c * w, c * r + sn * w, top),
               m.p(hub + sn * r + c * w, c * r - sn * w, top), m.p(hub + sn * near + c * w, c * near - sn * w, top), "dark")
    if s.get("tailRotor", True) and lod == 0:
        d = rotor_dia * .17
        side = width * .1 + .12
        a = .955 * L
        m.card(m.p(a - d / 2, side, fh * .55), m.p(a + d / 2, side, fh * .55), m.p(a + d / 2, side, fh * .55 + d * .12), m.p(a - d / 2, side, fh * .55 + d * .12), "dark")
        m.card(m.p(a - d * .06, side, fh * .55 - d / 2), m.p(a + d * .06, side, fh * .55 - d / 2), m.p(a + d * .06, side, fh * .55 + d / 2), m.p(a - d * .06, side, fh * .55 + d / 2), "dark")
    if s.get("skids", True) and lod == 0:
        for side in (1, -1):
            y = width * .62
            a, b = .08 * L, .46 * L
            low = -fh * .72
            m.card(m.p(a, side * y, low), m.p(b, side * y, low), m.p(b, side * (y + .1), low), m.p(a, side * (y + .1), low), "dark")
    return m


def build_plain(id_, lod):
    """No engines and no named shape: a tube with wings or a tube with a rotor, so it claims nothing."""
    if id_ == "plain-heli":
        return build_heli(id_, {"w": .17, "h": .2, "blades": 2, "rotor": .95, "tailRotor": False, "skids": False}, {"lengthM": 1.0, "spanM": .95, "heightM": .3}, lod)
    L = 1.0
    m = Mesh(L)
    span = .92 if id_ == "plain-jet" else 1.3
    width = .095 if id_ == "plain-jet" else .13
    profile = "airliner" if id_ == "plain-jet" else "light"
    fuselage(m, profile, width, width, lod)
    sweep = 25 if id_ == "plain-jet" else 2
    wing(m, .38 * L, -width * .2, span / 2, [(.03, span * .16), (1, span * .05)], sweep, 4, lod, thick=.1)
    fin(m, .8 * L, width * .3, width * 1.5, width * 1.3, width * .6, sweep + 8, lod)
    wing(m, .84 * L, width * .2, span * .17, [(.03, width * .9), (1, width * .4)], sweep, 3, lod, thick=.08)
    return m


def to_arrays(m, scale):
    """Positions and colours, one vertex per distinct position and colour, and triangle indices."""
    index, positions, colours, indices = {}, [], [], []
    for a, b, c, key in m.tris:
        for pt in (a, b, c):
            q = (round(pt[0] * scale, 6), round(pt[1] * scale, 6), round(pt[2] * scale, 6), key)
            i = index.get(q)
            if i is None:
                i = len(positions)
                index[q] = i
                positions.append(q[:3])
                colours.append(linear(PALETTE[key]))
            indices.append(i)
    return positions, colours, indices


def write_glb(path, lods):
    """A minimal binary glTF: one node per level of detail, positions and colours, indexed."""
    bin_ = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def add(data, target, component, count, type_, minmax=None):
        while len(bin_) % 4:
            bin_.append(0)
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), "target": target})
        bin_.extend(data)
        acc = {"bufferView": len(views) - 1, "componentType": component, "count": count, "type": type_}
        if minmax:
            acc["min"], acc["max"] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    for name, (positions, colours, indices) in lods:
        pos = b"".join(struct.pack("<3f", *p) for p in positions)
        col = b"".join(struct.pack("<4f", *c) for c in colours)
        idx = b"".join(struct.pack("<I", i) for i in indices)
        lo = [min(p[k] for p in positions) for k in range(3)]
        hi = [max(p[k] for p in positions) for k in range(3)]
        a_pos = add(pos, 34962, 5126, len(positions), "VEC3", (lo, hi))
        a_col = add(col, 34962, 5126, len(colours), "VEC4")
        a_idx = add(idx, 34963, 5125, len(indices), "SCALAR")
        meshes.append({"primitives": [{"attributes": {"POSITION": a_pos, "COLOR_0": a_col}, "indices": a_idx}]})
        nodes.append({"name": name, "mesh": len(meshes) - 1})
    while len(bin_) % 4:
        bin_.append(0)
    doc = {
        "asset": {"version": "2.0", "generator": "scripts/plane-models/build.py"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_)}],
    }
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * ((4 - len(text) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<3I", 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(bin_)))
        f.write(struct.pack("<2I", len(text), 0x4E4F534A))
        f.write(text)
        f.write(struct.pack("<2I", len(bin_), 0x004E4942))
        f.write(bin_)


def fit_length(lods, length):
    """A published length is overall, so a model spans exactly that along its body and a swept fin
    does not run past it. Span and height keep their figures. Both levels take the same fit."""
    z = [q[2] for t in lods[0].tris for q in t[:3]]
    z0, k = min(z), length / (max(z) - min(z))
    for m in lods:
        move = lambda q: (q[0], q[1], (q[2] - z0) * k - length / 2)
        m.tris = [(move(a), move(b), move(c), col) for a, b, c, col in m.tris]
        m.L = length


def build_all(only=None):
    """Every model as {id: {lod0: Mesh, lod1: Mesh, length}}."""
    with open(os.path.join(HERE, "shapes.json"), encoding="utf8") as f:
        shapes = json.load(f)["models"]
    with open(os.path.join(HERE, "dimensions.json"), encoding="utf8") as f:
        all_dims = json.load(f)
    out = {}
    for id_, s in shapes.items():
        if only and id_ not in only:
            continue
        dims = {**all_dims.get(id_, {}), **all_dims.get(id_, {}).get("override", {})}
        if not all(dims.get(k) for k in ("lengthM", "spanM", "heightM")):
            raise SystemExit(f"{id_}: no published length, span and height in dimensions.json")
        heli = s["arch"] == "heli"
        builder = build_heli if heli else build_fixed_wing
        lods = builder(id_, s, dims, 0), builder(id_, s, dims, 1)
        # A helicopter measured along its fuselage keeps its true rotor, which runs past the nose.
        if not heli or s.get("basis") == "overall":
            fit_length(lods, dims["lengthM"])
        out[id_] = {"lod0": lods[0], "lod1": lods[1], "length": dims["lengthM"]}
    for id_ in ("plain-jet", "plain-light", "plain-heli"):
        if not only or id_ in only:
            lods = build_plain(id_, 0), build_plain(id_, 1)
            if id_ != "plain-heli":
                fit_length(lods, 1.0)
            out[id_] = {"lod0": lods[0], "lod1": lods[1], "length": 1.0}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--raw", default=os.path.join(HERE, ".raw"))
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    os.makedirs(args.raw, exist_ok=True)
    rows = []
    for id_, parts in build_all(only).items():
        lods = []
        scale = 1 / parts["length"]
        counts = []
        for level, name in enumerate(("lod0", "lod1")):
            arrays = to_arrays(parts[name], scale)
            tris = len(arrays[2]) // 3
            if tris > LOD_LIMIT[level]:
                raise SystemExit(f"{id_} {name}: {tris} triangles, over {LOD_LIMIT[level]}")
            counts.append(tris)
            lods.append((name, arrays))
        write_glb(os.path.join(args.raw, f"{id_}.glb"), lods)
        rows.append((id_, counts[0], counts[1]))
    for id_, a, b in rows:
        print(f"{id_:12} {a:5} {b:4}")
    print(f"{len(rows)} models, largest lod0 {max(r[1] for r in rows)}, largest lod1 {max(r[2] for r in rows)}")


if __name__ == "__main__":
    main()
