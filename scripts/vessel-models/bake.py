"""Bake the vessel models for God's eye view (Blender 5.2, headless).

    blender -b --factory-startup -P bake.py -- --in DIR --out DIR --device OPTIX|CUDA|CPU
            [--only <class>-<seed>|plain] [--flip]

Reads `<class>-<seed>.glb` candidates (fal `tripo3d/h3.1/text-to-3d`, untextured), cleans,
orients, cuts at the waterline, scales to length 1, makes two levels of detail, colours
them in GEV's palette with baked ambient occlusion, exports them and renders a review
sheet. The tenth class, `plain`, is drawn here, not generated, so an untyped boat can
never look like any typed class.

Output frame (glTF, Y up): length 1.0 along Z with the BOW toward -Z, waterline at y = 0,
centred on x and z. EyeOverlay's layer turns it with rotation.x = +PI/2, which puts the
bow on +Y (north at heading 0) in the map's east/north/up scene.

Each export holds two mesh objects named exactly `lod0` and `lod1`, one colour attribute
(COLOR_0, linear), no normals, no textures, no materials.

Outputs under --out:
    candidates/<id>.glb, candidates/plain.glb
    review/<id>-gev.png, -side.png, -top.png, -small.png
    manifest.json   (merged on a re-run with --only, so a flip updates one row)
"""
import argparse
import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

PALETTE = {"hull": "#56778b", "deck": "#8eabbd", "top": "#e8f1f8", "waterline": "#2dd4bf"}
LOD0_TRIS = 1200
LOD1_TRIS = 250
WATERLINE_FRACTION = {"default": 0.45}
LIGHT = {"azimuth": 215, "polar": 35}  # GEV's sun, EYE_LIGHT in lib/eye/look.ts

CLASSES = ["cargo", "tanker", "passenger", "highspeed", "tug", "service", "fishing", "sailing", "pleasure"]
WATERLINE_BAND = 0.012  # centroids below this height (in units of ship length) are the waterline colour
SLICES = 40
BG_HEX = "#0b1218"  # the dark ground of the review renders
GEV_FOV_DEG = 36.87  # MapLibre's default vertical field of view
GEV_TILT_DEG = 56
GEV_HEADING_DEG = 32
RENDER_W, RENDER_H, SAMPLES = 640, 400, 64
AO_SAMPLES, AO_DISTANCE = 64, 0.15
VOXEL_SIZES = (0.008, 0.012, 0.018)  # in units of ship length: the voxel remesh before decimation, finest first


def log(*a):
    print("[bake]", *a, flush=True)


# ---------------------------------------------------------------------------------------
# small helpers


def hex_to_linear(hexstr):
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def enum_ids(rna_owner, prop):
    """Identifiers of an enum property, read from the running Blender, never typed."""
    return [i.identifier for i in rna_owner.bl_rna.properties[prop].enum_items]


def op_enum_ids(op, prop):
    return [i.identifier for i in op.get_rna_type().properties[prop].enum_items]


def pick_id(ids, *wanted):
    for w in wanted:
        if w in ids:
            return w
    raise RuntimeError("none of %r in %r" % (wanted, ids))


def set_enum(owner, name, *candidates):
    """Assign the first candidate Blender accepts. Registered engines and colour transforms are
    under-reported by the static enum list, so try them and let Blender's TypeError decide."""
    last = None
    for c in candidates:
        try:
            setattr(owner, name, c)
            return c
        except TypeError as exc:
            last = exc
    raise RuntimeError("none of %r accepted for %s: %s" % (candidates, name, last))


def set_if(owner, name, value):
    try:
        setattr(owner, name, value)
        return True
    except (AttributeError, TypeError, ValueError):
        return False


def clear_data():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                 bpy.data.lights, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def node_by_type(tree, type_name):
    return next(n for n in tree.nodes if n.type == type_name)


def new_material(name, color_hex=None, vertex_color_layer=None, emission=None):
    mat = bpy.data.materials.new(name)
    set_if(mat, "use_nodes", True)  # deprecated in 5.x, always on there
    tree = mat.node_tree
    bsdf = node_by_type(tree, "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 1.0
    for spec in ("Specular IOR Level", "Specular"):
        if spec in bsdf.inputs:
            bsdf.inputs[spec].default_value = 0.0
            break
    if vertex_color_layer:
        vc = tree.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = vertex_color_layer
        tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    elif color_hex:
        r, g, b = hex_to_linear(color_hex)
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    if emission:
        r, g, b = hex_to_linear(emission)
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 2.0
    return mat


# ---------------------------------------------------------------------------------------
# device


def setup_device(scene, requested):
    """Pick the best Cycles device: the requested one, else CUDA, else CPU. Returns its name."""
    set_enum(scene.render, "engine", "CYCLES")
    cyc = scene.cycles
    order = [requested] + [d for d in ("OPTIX", "CUDA") if d != requested]
    if requested == "CPU":
        order = []
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception as exc:  # noqa: BLE001 - log and fall back to CPU
        log("no cycles preferences:", exc)
        prefs = None
    for dev in order:
        if prefs is None:
            break
        try:
            set_enum(prefs, "compute_device_type", dev)
            if hasattr(prefs, "refresh_devices"):
                prefs.refresh_devices()
            devices = prefs.get_devices_for_type(dev) if hasattr(prefs, "get_devices_for_type") else []
            usable = [d for d in devices if d.type == dev]
            if not usable:
                log("device", dev, "has no hardware here")
                continue
            for d in prefs.devices:
                d.use = d.type == dev
            cyc.device = "GPU"
            names = ", ".join(d.name for d in usable)
            log("RENDER DEVICE:", dev, "|", names)
            return "%s (%s)" % (dev, names)
        except Exception as exc:  # noqa: BLE001
            log("device", dev, "failed:", exc)
    cyc.device = "CPU"
    log("RENDER DEVICE: CPU")
    return "CPU"


# ---------------------------------------------------------------------------------------
# geometry


def coords(bm):
    return np.array([v.co[:] for v in bm.verts], dtype=np.float64).reshape(-1, 3)


def tris_of(bm):
    """(T, 3, 3) array of triangle corners; the bmesh must be triangulated."""
    idx = {v: i for i, v in enumerate(bm.verts)}
    co = coords(bm)
    t = np.array([[idx[v] for v in f.verts] for f in bm.faces], dtype=np.int64)
    return co[t]


def slice_points(tris, h):
    """Intersection points of the triangle edges with the plane z = h."""
    pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        pa, pb = tris[:, a, :], tris[:, b, :]
        da, db = pa[:, 2] - h, pb[:, 2] - h
        m = (da * db) < 0
        if not m.any():
            continue
        t = (-da[m]) / (db[m] - da[m])
        pts.append(pa[m] + (pb[m] - pa[m]) * t[:, None])
    return np.concatenate(pts) if pts else np.empty((0, 3))


def x_span(pts):
    return float(pts[:, 0].max() - pts[:, 0].min()) if len(pts) else 0.0


def components(bm):
    """Connected-component label per vertex."""
    label, n = {}, 0
    for v in bm.verts:
        if v in label:
            continue
        stack = [v]
        label[v] = n
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o not in label:
                    label[o] = n
                    stack.append(o)
        n += 1
    return label, n


def component_volumes(bm, label, n):
    vol = np.zeros(n)
    lo = np.full((n, 3), np.inf)
    hi = np.full((n, 3), -np.inf)
    for f in bm.faces:
        c = label[f.verts[0]]
        a, b, d = (v.co for v in f.verts)
        vol[c] += a.dot(b.cross(d)) / 6.0
    for v in bm.verts:
        c = label[v]
        lo[c] = np.minimum(lo[c], v.co[:])
        hi[c] = np.maximum(hi[c], v.co[:])
    box = np.prod(np.maximum(hi - lo, 0), axis=1)
    vol = np.abs(vol)
    # an open or inside-out part has no honest volume: fall back to its box
    return np.where(vol < 1e-12, box, vol)


def mesh_to_bmesh(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    return bm


def import_candidate(path):
    clear_data()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh in file")
    bm = bmesh.new()
    for o in meshes:
        part = mesh_to_bmesh(o)
        tmp = bpy.data.meshes.new("part")
        part.to_mesh(tmp)
        part.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    clear_data()  # the imported objects must not stay in the scene
    for layer in list(bm.loops.layers.uv):
        bm.loops.layers.uv.remove(layer)
    for layer in list(bm.loops.layers.color) + list(bm.loops.layers.float_color):
        pass  # candidates are untextured and carry no colour
    return bm


def principal_yaw(co):
    """Angle (radians, 0 to pi/2) that the outline is turned from the axes: the one that
    makes the bounding rectangle of the top-down points smallest."""
    xy = co[:, :2]

    def area(a):
        c, s = math.cos(a), math.sin(a)
        x = xy[:, 0] * c + xy[:, 1] * s
        y = -xy[:, 0] * s + xy[:, 1] * c
        return float(np.ptp(x) * np.ptp(y))

    coarse = min((math.radians(d) for d in np.arange(0.0, 90.0, 1.0)), key=area)
    fine = min((coarse + math.radians(d) for d in np.arange(-1.0, 1.0001, 0.1)), key=area)
    off = math.degrees(fine) % 90.0
    if off < 3.0 or off > 87.0:  # already square to the axes: a pointed bow must not skew it
        return 0.0
    return fine


def rotate_z(bm, radians):
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(radians, 3, "Z"))


def clean_and_orient(bm, cls, flip=False):
    """Steps 1 to 4 of the spec. Returns (info, z_top_world_units_before_scale are folded in)."""
    info = {"objective_fail": []}
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    co = coords(bm)
    diag = float(np.linalg.norm(co.max(0) - co.min(0)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * diag)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # loose parts below 1% of the volume go; two or more large parts is an objective fail
    label, n = components(bm)
    vols = component_volumes(bm, label, n)
    total = float(vols.sum())
    drop = {i for i in range(n) if vols[i] < 0.01 * total}
    if drop:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if label[v] in drop], context="VERTS")
    large = [i for i in range(n) if i not in drop and vols[i] >= 0.10 * total]
    info["parts"] = {"found": n, "dropped": len(drop), "large": len(large)}
    if len(large) >= 2:
        info["objective_fail"].append("two_or_more_large_parts")
    bm.verts.ensure_lookup_table()

    co = coords(bm)
    dims = co.max(0) - co.min(0)
    info["dims_raw"] = [round(float(x), 4) for x in dims]

    # Yaw: some candidates come out of Tripo turned about the vertical (sailing-303 by about 25
    # degrees), so the longest horizontal axis is found as the minimal-area bounding rectangle of
    # the top-down outline, and the long side becomes +Y.
    yaw = principal_yaw(co)
    rotate_z(bm, -yaw)
    co = coords(bm)
    if np.ptp(co[:, 0]) > np.ptp(co[:, 1]):
        rotate_z(bm, math.pi / 2)
        co = coords(bm)
        yaw += math.pi / 2
    dims = co.max(0) - co.min(0)
    info["yaw_removed_deg"] = round(math.degrees(yaw) % 180.0, 1)
    info["dims_aligned"] = [round(float(x), 4) for x in dims]
    if dims[2] > max(dims[0], dims[1]):
        info["objective_fail"].append("longest_axis_vertical")
    lo, hi = co.min(0), co.max(0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, 0))
    tris = tris_of(bm)
    co = coords(bm)
    z_min, z_max = float(co[:, 2].min()), float(co[:, 2].max())
    length = float(co[:, 1].max() - co[:, 1].min())

    # widest slice
    best_h, best_w = z_min, -1.0
    for k in range(1, SLICES + 1):
        h = z_min + (z_max - z_min) * k / (SLICES + 1)
        w = x_span(slice_points(tris, h))
        if w > best_w:
            best_h, best_w = h, w
    z_beam = best_h

    # bow: the end that is narrower in the outer 15% of the length. Measured on the part of the
    # vessel up to the widest slice (its hull), as the mean top-down width of ten bins per end,
    # so one flat deck at exactly the slice height cannot hide an end.
    y0, y1 = float(co[:, 1].min()), float(co[:, 1].max())
    hull = co[co[:, 2] <= z_beam + 1e-9]

    def mean_width(lo_y, hi_y):
        edges = np.linspace(lo_y, hi_y, 11)
        widths = []
        for a, b in zip(edges[:-1], edges[1:]):
            sel = hull[(hull[:, 1] >= a) & (hull[:, 1] <= b)]
            widths.append(float(sel[:, 0].max() - sel[:, 0].min()) if len(sel) > 1 else 0.0)
        return float(np.mean(widths))

    w_pos = mean_width(y1 - 0.15 * length, y1)
    w_neg = mean_width(y0, y0 + 0.15 * length)
    bow_is_pos = w_pos <= w_neg
    ratio = min(w_pos, w_neg) / max(w_pos, w_neg) if max(w_pos, w_neg) > 0 else 1.0
    if not bow_is_pos:
        rotate_z(bm, math.pi)
    flipped = False
    if flip:  # a wrong bow is fixed with `flip` in picks.json
        rotate_z(bm, math.pi)
        flipped = True
    info["bow"] = {
        "decision": "+y" if bow_is_pos else "-y (turned 180 degrees)",
        "width_pos_end": round(w_pos, 4), "width_neg_end": round(w_neg, 4),
        "narrow_over_wide": round(ratio, 3), "ambiguous": ratio > 0.9, "flip_applied": flipped,
    }

    # waterline: bisect, delete below, fill the cut
    frac = WATERLINE_FRACTION.get(cls, WATERLINE_FRACTION["default"])
    wl = z_min + frac * (z_beam - z_min)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-9, plane_co=(0, 0, wl), plane_no=(0, 0, 1),
                                 clear_inner=True, clear_outer=False)
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid]
    boundary = [e for e in cut if e.is_boundary]
    filled = 0
    if boundary:
        try:
            r = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            filled = len(r.get("faces", []))
        except Exception as exc:  # noqa: BLE001
            log("holes_fill failed:", exc)
        if not filled:
            try:
                r = bmesh.ops.triangle_fill(bm, use_beauty=True, edges=[e for e in boundary if e.is_valid])
                filled = len(r.get("geom", []))
            except Exception as exc:  # noqa: BLE001
                log("triangle_fill failed:", exc)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    co = coords(bm)
    lo, hi = co.min(0), co.max(0)
    bmesh.ops.translate(bm, verts=bm.verts,
                        vec=(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -wl))

    # uniform scale so the length along Y is exactly 1.0
    co = coords(bm)
    ln = float(co[:, 1].max() - co[:, 1].min())
    s = 1.0 / ln
    bmesh.ops.scale(bm, vec=(s, s, s), space=Matrix.Identity(4), verts=bm.verts)
    co = coords(bm)
    info["waterline"] = {
        "fraction": frac, "height_fraction_of_beam_slice": frac,
        "z_beam_over_length": round((z_beam - wl) * s, 4), "cap_faces": filled,
        "cut_height_over_length": round((wl - z_min) * s, 4),
    }
    info["z_deck"] = float((z_beam - wl) * s)
    info["z_top"] = float(co[:, 2].max())
    info["z_bottom"] = float(co[:, 2].min())
    info["beam_over_length"] = round(float(co[:, 0].max() - co[:, 0].min()), 4)
    return info


def build_plain():
    """An extruded hull outline: pointed bow, square stern, beam 0.18, freeboard 0.06, length 1."""
    bm = bmesh.new()
    half = 0.09
    outline = [(-half, -0.5), (half, -0.5), (half, 0.15), (0.05, 0.35), (0.0, 0.5),
               (-0.05, 0.35), (-half, 0.15)]
    levels = [0.0, WATERLINE_BAND, 0.06]
    rings = []
    for z in levels:
        rings.append([bm.verts.new((x, y, z)) for x, y in outline])
    n = len(outline)
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    info = {"objective_fail": [], "parts": {"found": 1, "dropped": 0, "large": 1},
            "bow": {"decision": "+y (drawn)", "ambiguous": False, "flip_applied": False},
            "waterline": {"fraction": 0.0, "note": "drawn at the waterline"},
            "z_deck": 0.06, "z_top": 0.06, "z_bottom": 0.0, "beam_over_length": 2 * half}
    return bm, info


# ---------------------------------------------------------------------------------------
# levels of detail, colour, ambient occlusion


def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    if me.validate(verbose=False):
        log("mesh", name, "had invalid data and was repaired")
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def evaluated_copy(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me)
    bpy.data.meshes.remove(me)
    return out


def collapse_to(bm, target):
    """Collapse-decimate a copy of bm to at most `target` triangles, or None if it stalls above."""
    base = new_object("_dec_src", bm)
    mod = base.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = pick_id(enum_ids(bpy.types.DecimateModifier, "decimate_type"), "COLLAPSE")
    mod.use_collapse_triangulate = True
    tris = len(bm.faces)
    ratio, last, same, out = target / tris, None, 0, None
    for _ in range(40):
        mod.ratio = min(max(ratio, 0.0005), 1.0)
        cand = evaluated_copy(base)
        n = len(cand.faces)
        if n <= target:
            out = cand
            break
        cand.free()
        same = same + 1 if n == last else 0
        last = n
        if same >= 3:  # lowering the ratio changes nothing: it has stalled
            break
        ratio *= 0.85
    bpy.data.objects.remove(base)
    return out


def voxel_remesh(bm, size):
    """A watertight single surface from bm."""
    base = new_object("_vox_src", bm)
    mod = base.modifiers.new("vox", "REMESH")
    mod.mode = pick_id(enum_ids(bpy.types.RemeshModifier, "mode"), "VOXEL")
    mod.voxel_size = size
    out = evaluated_copy(base)
    bpy.data.objects.remove(base)
    bmesh.ops.triangulate(out, faces=out.faces[:])
    return out


def decimated_bm(bm, target):
    """(copy of bm with at most `target` triangles, method used).

    A voxel remesh comes first: Tripo's meshes are slightly noisy and thin-walled, Blender's
    collapse decimator stalls on them (cargo-101 stops at 984 triangles) and leaves spikes
    where it does not. Measured side by side, the remeshed-then-collapsed models are clean."""
    if len(bm.faces) <= target:
        out, method = bm.copy(), "as is"
    else:
        out = None
        for size in VOXEL_SIZES:  # a coarser voxel only where thin sheets (sails) stall the collapse
            vox = voxel_remesh(bm, size)
            out = collapse_to(vox, target)
            vox.free()
            if out is not None:
                method = "voxel remesh %.3f + collapse" % size
                break
        if out is None:
            raise RuntimeError("could not decimate to %d" % target)
    bmesh.ops.triangulate(out, faces=out.faces[:])
    bmesh.ops.recalc_face_normals(out, faces=out.faces[:])
    return out, method


def face_colour_linear(z, z_deck, z_top):
    if z < WATERLINE_BAND:
        return hex_to_linear(PALETTE["waterline"])
    if z <= z_deck:
        return hex_to_linear(PALETTE["hull"])
    if z <= z_deck + (z_top - z_deck) / 2:
        return hex_to_linear(PALETTE["deck"])
    return hex_to_linear(PALETTE["top"])


def bake_colour(obj, info, final_name="Col"):
    """Colour attribute from each face's centroid height, times (0.6 + 0.4 * baked AO)."""
    me = obj.data
    scene = bpy.context.scene
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    ao_attr = me.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = ao_attr
    me.color_attributes.render_color_index = list(me.color_attributes).index(ao_attr)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bake = scene.render.bake
    bake.target = pick_id(enum_ids(bake, "target"), "VERTEX_COLORS")
    set_if(bake, "use_clear", True)
    scene.cycles.samples = AO_SAMPLES
    scene.world.light_settings.distance = AO_DISTANCE
    bpy.ops.object.bake(type=pick_id(op_enum_ids(bpy.ops.object.bake, "type"), "AO"))
    ao = np.zeros(len(me.loops) * 4, dtype=np.float32)
    ao_attr = me.color_attributes["AO"]
    ao_attr.data.foreach_get("color", ao)
    ao = ao.reshape(-1, 4)[:, 0]
    ao_mean = float(ao.mean()) if len(ao) else 0.0

    col = np.zeros((len(me.loops), 4), dtype=np.float32)
    col[:, 3] = 1.0
    z_deck, z_top = info["z_deck"], info["z_top"]
    cent = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get("center", cent)
    cent = cent.reshape(-1, 3)
    for pi, poly in enumerate(me.polygons):
        rgb = face_colour_linear(cent[pi][2], z_deck, z_top)
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            k = 0.6 + 0.4 * float(ao[li])
            col[li, 0], col[li, 1], col[li, 2] = rgb[0] * k, rgb[1] * k, rgb[2] * k
    me.color_attributes.remove(me.color_attributes["AO"])
    attr = me.color_attributes.new(final_name, "FLOAT_COLOR", "CORNER")
    attr.data.foreach_set("color", col.reshape(-1))
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    me.update()
    return ao_mean


# ---------------------------------------------------------------------------------------
# export and renders


def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    op = bpy.ops.export_scene.gltf
    props = {p.identifier for p in op.get_rna_type().properties}
    want = {
        "filepath": path,
        "use_selection": True,
        "export_apply": False,
        "export_normals": False,
        "export_texcoords": False,
        "export_tangents": False,
        "export_attributes": False,
        "export_cameras": False,
        "export_lights": False,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_extras": False,
        "export_yup": True,
        "export_image_format": pick_id(op_enum_ids(op, "export_image_format"), "NONE", "AUTO"),
        "export_materials": pick_id(op_enum_ids(op, "export_materials"), "NONE"),
        "export_vertex_color": pick_id(op_enum_ids(op, "export_vertex_color"), "ACTIVE", "MATERIAL"),
        "export_active_vertex_color_when_no_material": True,
        "export_all_vertex_colors": False,
    }
    fmt_ids = op_enum_ids(op, "export_format") if "export_format" in props else []
    if fmt_ids:
        want["export_format"] = pick_id(fmt_ids, "GLB")
    else:
        want["export_format"] = "GLB"
    op(**{k: v for k, v in want.items() if k in props})


def glb_stats(path):
    """(nodes, triangles per mesh node, has COLOR_0, has NORMAL, has TEXCOORD) from the JSON chunk."""
    with open(path, "rb") as fh:
        data = fh.read()
    length = int.from_bytes(data[12:16], "little")
    doc = json.loads(data[20:20 + length])
    out = {"bytes": len(data), "nodes": {}, "COLOR_0": False, "NORMAL": False, "TEXCOORD_0": False}
    for node in doc.get("nodes", []):
        if "mesh" in node:
            mesh = doc["meshes"][node["mesh"]]
            tris = 0
            for prim in mesh["primitives"]:
                attrs = prim["attributes"]
                out["COLOR_0"] |= "COLOR_0" in attrs
                out["NORMAL"] |= "NORMAL" in attrs
                out["TEXCOORD_0"] |= "TEXCOORD_0" in attrs
                if "indices" in prim:
                    tris += doc["accessors"][prim["indices"]]["count"] // 3
                else:
                    tris += doc["accessors"][attrs["POSITION"]]["count"] // 3
            out["nodes"][node.get("name", "?")] = tris
    return out


def sun_direction():
    """Vector toward the sun in east/north/up from MapLibre's [radial, azimuth, polar] (anchor map)."""
    a, p = math.radians(LIGHT["azimuth"]), math.radians(LIGHT["polar"])
    return Vector((math.sin(a) * math.sin(p), math.cos(a) * math.sin(p), math.cos(p)))


def build_render_scene(boats, extra_objs=()):
    """boats: list of (object, scale). Returns the ground, light and camera."""
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = RENDER_W, RENDER_H
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.cycles.samples = SAMPLES
    set_if(scene.cycles, "use_denoising", True)
    set_enum(scene.view_settings, "view_transform", "Standard", "NONE")
    world = scene.world
    set_if(world, "use_nodes", True)
    bg = node_by_type(world.node_tree, "BACKGROUND")
    r, g, b = hex_to_linear(BG_HEX)
    bg.inputs["Color"].default_value = (r, g, b, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    # ground
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60.0)
    bm.to_mesh(me)
    bm.free()
    ground = bpy.data.objects.new("ground", me)
    scene.collection.objects.link(ground)
    ground.data.materials.append(new_material("ground", color_hex=BG_HEX))
    # sun
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 2.6
    sun_data.angle = math.radians(3)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = sun_direction().to_track_quat("Z", "Y").to_euler()
    # a dim fill from the other side stands in for GEV's hemisphere light, so shaded walls read
    fill_data = bpy.data.lights.new("fill", "SUN")
    fill_data.energy = 1.0
    fill_data.angle = math.radians(40)
    fill = bpy.data.objects.new("fill", fill_data)
    scene.collection.objects.link(fill)
    fill.rotation_euler = Vector((0.55, 0.65, 0.5)).to_track_quat("Z", "Y").to_euler()
    cam_data = bpy.data.cameras.new("cam")
    cam_data.clip_start, cam_data.clip_end = 0.01, 200.0
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return ground, sun, cam


def look_at(cam, target, location):
    cam.location = Vector(location)
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def arrow_object():
    bm = bmesh.new()
    pts = [(-0.012, 0.0), (0.012, 0.0), (0.012, 0.07), (0.04, 0.07), (0.0, 0.13), (-0.04, 0.07), (-0.012, 0.07)]
    verts = [bm.verts.new((x, y, 0.004)) for x, y in pts]
    bm.faces.new(verts)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("arrow")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("arrow", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(new_material("arrow", color_hex=PALETTE["waterline"], emission=PALETTE["waterline"]))
    return obj


def render_to(path):
    scene = bpy.context.scene
    scene.render.filepath = path
    scene.render.image_settings.file_format = pick_id(
        [i.identifier for i in scene.render.image_settings.bl_rna.properties["file_format"].enum_items], "PNG")
    bpy.ops.render.render(write_still=True)


def render_review(cid, lod0, lod1, review_dir, z_top):
    """The four review images for one candidate. lod objects carry a colour attribute 'Col'."""
    scene = bpy.context.scene
    mat = new_material("vessel", vertex_color_layer="Col")
    for o in (lod0, lod1):
        o.data.materials.clear()
        o.data.materials.append(mat)
        o.hide_render = True
    ground, sun, cam = build_render_scene([])
    cam_data = cam.data
    arrow = arrow_object()
    arrow.hide_render = True

    def show(obj, location=(0, 0, 0), heading=0.0, scale=1.0):
        obj.hide_render = False
        obj.location = location
        obj.rotation_euler = (0, 0, -math.radians(heading))
        obj.scale = (scale, scale, scale)

    def hide_all():
        for o in (lod0, lod1, arrow):
            o.hide_render = True

    # gev: the angle GEV looks from, heading 32
    cam_data.type = pick_id(enum_ids(bpy.types.Camera, "type"), "PERSP")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = math.radians(GEV_FOV_DEG)
    tilt = math.radians(GEV_TILT_DEG)
    dist = max(1.5, 1.6 * z_top + 0.8)  # a tall rig must fit the frame
    show(lod0, heading=GEV_HEADING_DEG)
    look_at(cam, (0, 0, z_top / 3), (0, -math.sin(tilt) * dist, z_top / 3 + math.cos(tilt) * dist))
    render_to(os.path.join(review_dir, "%s-gev.png" % cid))

    # side on, orthographic, bow to the right
    cam_data.type = pick_id(enum_ids(bpy.types.Camera, "type"), "ORTHO")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = max(0.8, 1.3 * z_top)
    cam.location = Vector((3.0, 0.0, max(0.12, z_top / 2 - 0.05)))
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    show(lod0)
    render_to(os.path.join(review_dir, "%s-side.png" % cid))

    # top down, orthographic, a teal arrow at the bow
    cam_data.ortho_scale = 1.3
    cam.location = Vector((0.0, 0.0, 3.0))
    cam.rotation_euler = (0, 0, 0)
    show(lod0)
    arrow.hide_render = False
    arrow.location = (0, 0.5 + 0.03, 0)
    render_to(os.path.join(review_dir, "%s-top.png" % cid))

    # small: the GEV view with the boat 28 px and 48 px long (lod1 below 48 px)
    hide_all()
    cam_data.type = pick_id(enum_ids(bpy.types.Camera, "type"), "PERSP")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = math.radians(GEV_FOV_DEG)
    ppu = 100.0  # pixels per unit of length at the screen centre
    dist = RENDER_H / (2 * math.tan(math.radians(GEV_FOV_DEG) / 2) * ppu)
    look_at(cam, (0, 0, 0), (0, -math.sin(tilt) * dist, math.cos(tilt) * dist))
    small = lod1.copy()
    small.data = lod1.data
    bpy.context.scene.collection.objects.link(small)
    show(small, location=(-1.2, 0, 0), heading=GEV_HEADING_DEG, scale=0.28)
    show(lod0, location=(1.2, 0, 0), heading=GEV_HEADING_DEG, scale=0.48)
    render_to(os.path.join(review_dir, "%s-small.png" % cid))
    bpy.data.objects.remove(small)
    for o in (lod0, lod1):
        o.scale = (1, 1, 1)
        o.rotation_euler = (0, 0, 0)
        o.location = (0, 0, 0)


# ---------------------------------------------------------------------------------------
# one candidate


def process(cid, cls, glb_path, out_dir, flip, device_name):
    t0 = time.time()
    entry = {"id": cid, "class": cls, "source": os.path.basename(glb_path) if glb_path else "drawn by bake.py",
             "render_device": device_name}
    clear_data()  # nothing of the previous candidate may stay in the scene or in the render
    try:
        if cls == "plain":
            bm, info = build_plain()
        else:
            bm = import_candidate(glb_path)
            info = clean_and_orient(bm, cls, flip=flip)
        entry.update(info)
        (b0, m0), (b1, m1) = decimated_bm(bm, LOD0_TRIS), decimated_bm(bm, LOD1_TRIS)
        entry["lod_method"] = {"lod0": m0, "lod1": m1}
        lod_bms = [b0, b1]
        bm.free()
        objs = []
        for name, lb in zip(("lod0", "lod1"), lod_bms):
            obj = new_object(name, lb)
            lb.free()
            entry["ao_mean_" + name] = round(bake_colour(obj, info), 4)
            objs.append(obj)
        cand_dir = os.path.join(out_dir, "candidates")
        os.makedirs(cand_dir, exist_ok=True)
        path = os.path.join(cand_dir, "%s.glb" % cid)
        export_glb(objs, path)
        stats = glb_stats(path)
        entry["triangles"] = {"lod0": stats["nodes"].get("lod0"), "lod1": stats["nodes"].get("lod1")}
        entry["bytes"] = stats["bytes"]
        entry["export_has"] = {k: stats[k] for k in ("COLOR_0", "NORMAL", "TEXCOORD_0")}
        review_dir = os.path.join(out_dir, "review")
        os.makedirs(review_dir, exist_ok=True)
        render_review(cid, objs[0], objs[1], review_dir, entry.get("z_top", 0.2))
        entry["ok"] = True
    except Exception as exc:  # noqa: BLE001 - one bad candidate must not stop the sheet
        import traceback
        traceback.print_exc()
        entry["ok"] = False
        entry["error"] = "%s: %s" % (type(exc).__name__, exc)
        if "import" in entry["error"].lower() or "no mesh" in entry["error"].lower():
            entry.setdefault("objective_fail", []).append("import_failed")
    entry["seconds"] = round(time.time() - t0, 1)
    log(cid, "ok" if entry.get("ok") else "FAILED", entry.get("triangles"), entry.get("objective_fail"),
        "%.1fs" % entry["seconds"])
    return entry


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="CPU", choices=["OPTIX", "CUDA", "CPU"])
    ap.add_argument("--only")
    ap.add_argument("--flip", action="store_true", help="turn the candidate 180 degrees about z (with --only)")
    return ap.parse_args(argv)


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    log("Blender", bpy.app.version_string)
    clear_data()
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("world")
    device_name = setup_device(scene, args.device)
    jobs = []
    for cls in CLASSES:
        for seed in (101, 202, 303, 404, 505):
            p = os.path.join(args.inp, "%s-%d.glb" % (cls, seed))
            if os.path.exists(p):
                jobs.append(("%s-%d" % (cls, seed), cls, p))
    jobs.append(("plain", "plain", None))
    if args.only:
        jobs = [j for j in jobs if j[0] == args.only]
        if not jobs:
            raise SystemExit("--only %s matches no input" % args.only)
    mpath = os.path.join(args.out, "manifest.json")
    manifest = {"entries": {}}
    if os.path.exists(mpath):
        with open(mpath) as fh:
            manifest = json.load(fh)
    manifest.update({"blender": bpy.app.version_string, "palette": PALETTE, "lod0_tris": LOD0_TRIS,
                     "lod1_tris": LOD1_TRIS, "render_device": device_name,
                     "frame": "glTF Y up, length 1 along Z, bow toward -Z, waterline y=0"})
    for cid, cls, path in jobs:
        manifest["entries"][cid] = process(cid, cls, path, args.out, args.flip and bool(args.only), device_name)
        with open(mpath, "w") as fh:
            json.dump(manifest, fh, indent=1)
    failed = [k for k, v in manifest["entries"].items() if not v.get("ok")]
    log("done:", len(jobs), "processed,", len(failed), "failed", failed)


main()
