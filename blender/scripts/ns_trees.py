# NIGHT SHIFT - leafy trees for the exterior (replaces the bare trunks).
# Leaves: CC0 scans from ambientCG (LeafSet009 hazel, LeafSet010 maple), composited here into
# twig-cluster cards (colour + opacity), graded toward wet late-summer/early-autumn greens.
# Trees: recursive branching (trunk -> boughs -> twigs) as tapered tubes with bark material,
# crossed leaf cards at the twig ends. Three variants; the game instances them at the positions
# ns_hospital.py writes to trees.json, and sways the leaves in the wind.
import bpy, bmesh, math, os, random, glob
import numpy as np
from mathutils import Vector, Matrix, Quaternion
import ns_lib

LEAF_SRC = glob.glob(os.path.join(os.environ['TEMP'], 'claude', '*', '*', 'scratchpad', 'leaves'))[0]
TEXOUT = os.path.join(ns_lib.ROOT, 'blender', 'Textures', 'trees')


def _img(path):
    im = bpy.data.images.load(path, check_existing=True)
    w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def leaf_sprites(setname):
    """cut the individual leaves out of an ambientCG leaf set -> list of RGBA arrays"""
    col = _img(glob.glob(os.path.join(LEAF_SRC, setname, '*_Color.png'))[0])
    op = _img(glob.glob(os.path.join(LEAF_SRC, setname, '*_Opacity.png'))[0])[..., 0]
    h, w = op.shape
    mask = op > 0.5
    # connected blobs by scanning a coarse grid
    lab = np.zeros((h, w), np.int32); n = 0; sprites = []
    step = 8
    ys, xs = np.nonzero(mask[::step, ::step])
    seen = np.zeros((h // step + 1, w // step + 1), bool)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]: continue
        stack = [(y0, x0)]; seen[y0, x0] = True; pts = []
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < seen.shape[0] and 0 <= xx < seen.shape[1] and not seen[yy, xx] and yy * step < h and xx * step < w and mask[yy * step, xx * step]:
                    seen[yy, xx] = True; stack.append((yy, xx))
        if len(pts) < 30: continue
        py = [p[0] * step for p in pts]; px = [p[1] * step for p in pts]
        y1, y2, x1, x2 = max(0, min(py) - step), min(h, max(py) + step * 2), max(0, min(px) - step), min(w, max(px) + step * 2)
        rgba = np.concatenate([col[y1:y2, x1:x2, :3], op[y1:y2, x1:x2, None]], -1)
        hh, ww = rgba.shape[:2]
        fill = (rgba[..., 3] > 0.5).mean()
        if max(hh, ww) / max(1, min(hh, ww)) > 2.0 or fill < 0.3: continue      # loose stems, slivers
        sprites.append(rgba)
    return sprites


def grade(rgb, rng):
    """night-time wet foliage: deeper, less saturated greens with some yellow/brown turning leaves"""
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    turn = rng.random()
    target = np.array([0.16, 0.27, 0.08]) if turn < 0.6 else np.array([0.26, 0.26, 0.07]) if turn < 0.85 else np.array([0.3, 0.17, 0.06])
    out = lum[..., None] / max(lum.mean(), 1e-3) * target * rng.uniform(0.6, 1.0)
    return np.clip(out * 0.7 + rgb * 0.3 * target / max(rgb.mean(), 1e-3) * 0.5, 0, 1)


def paste(canvas, spr, cx, cy, scale, ang):
    """rotate+scale sprite (nearest) and alpha-composite onto canvas"""
    H, W = canvas.shape[:2]; sh, sw = spr.shape[:2]
    size = int(max(sh, sw) * scale * 1.5) + 2
    ys, xs = np.mgrid[-size // 2:size // 2, -size // 2:size // 2]
    ca, sa = math.cos(ang), math.sin(ang)
    sx = (ca * xs + sa * ys) / scale + sw / 2; sy = (-sa * xs + ca * ys) / scale + sh / 2
    ok = (sx >= 0) & (sx < sw - 1) & (sy >= 0) & (sy < sh - 1)
    ty, tx = ys + cy, xs + cx
    ok &= (ty >= 0) & (ty < H) & (tx >= 0) & (tx < W)
    src = spr[sy[ok].astype(int), sx[ok].astype(int)]
    a = src[:, 3:4]
    dst = canvas[ty[ok], tx[ok]]
    dst[:, :3] = src[:, :3] * a + dst[:, :3] * (1 - a)
    dst[:, 3:4] = np.maximum(dst[:, 3:4], a)
    canvas[ty[ok], tx[ok]] = dst


def make_cluster(name, sprites, seed, size=1024, n=42):
    rng = np.random.default_rng(seed)
    cv = np.zeros((size, size, 4), np.float32)
    # a thin twig down the middle, leaves fanning off it, smaller toward the tip
    for t in np.linspace(0.04, 0.97, 220):
        x = int(size * (0.5 + 0.03 * math.sin(t * 5))); y = int(size * t)
        cv[max(0, y - 2):y + 2, max(0, x - 3):x + 3] = (0.09, 0.06, 0.04, 1)
    for i in range(n):
        t = rng.uniform(0.08, 0.95)
        side = -1 if i % 2 else 1
        cx = int(size * (0.5 + side * rng.uniform(0.02, 0.2) * (0.5 + 0.8 * t)))
        cy = int(size * (1 - t))
        spr = sprites[rng.integers(len(sprites))].copy()
        spr[..., :3] = grade(spr[..., :3], rng)
        spr[..., :3] *= rng.uniform(0.6, 1.0)                    # inner leaves in shadow
        sc = size * rng.uniform(0.17, 0.25) * (1.1 - 0.35 * t) / max(spr.shape[:2])
        ang = side * rng.uniform(0.6, 1.5) + rng.normal(0, 0.25)
        paste(cv, spr, cx, cy, sc, ang)
    os.makedirs(TEXOUT, exist_ok=True)
    im = bpy.data.images.new(name, size, size, alpha=True)
    im.pixels.foreach_set(np.flipud(cv).ravel())
    im.filepath_raw = os.path.join(TEXOUT, name + '.png'); im.file_format = 'PNG'; im.save()
    return im


def leaf_material(name, im):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.55                      # wet leaves
    m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
    try: m.surface_render_method = 'DITHERED'
    except Exception: pass
    return m


# ----------------------------------------------------------------------------- tree geometry
def tube(bm, pts, radii, segs, uv_v0=0.0):
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        u = d.cross(up).normalized(); w = d.cross(u).normalized()
        rings.append([bm.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * r) for a in [k / segs * math.tau for k in range(segs)]])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    return rings


def branch(bm, cards, rng, start, direction, length, radius, depth, segs):
    n = max(3, int(length * 3))
    pts = [start]; d = direction.normalized()
    for i in range(1, n + 1):
        d = (d + Vector((rng.normal(0, 0.12), rng.normal(0, 0.12), rng.normal(0, 0.1) + (0.05 if depth > 0 else 0.0)))).normalized()
        pts.append(pts[-1] + d * (length / n))
    radii = [radius * (1 - 0.75 * i / n) for i in range(n + 1)]
    tube(bm, pts, radii, segs)
    if depth == 0:
        for k in range(rng.integers(3, 6)):          # leaf cards along the twig end
            cards.append((pts[-1] - d * rng.uniform(0, length * 0.7), (d + Vector((rng.normal(0, 0.5), rng.normal(0, 0.5), rng.normal(0, 0.4)))).normalized(), rng.uniform(1.2, 2.0)))
        return
    nb = rng.integers(2, 5) if depth > 1 else rng.integers(3, 5)
    for k in range(nb):
        t = rng.uniform(0.35, 0.95)
        i = int(t * n)
        side = Vector((rng.normal(), rng.normal(), 0)).normalized()
        nd = (d * 0.7 + side * 0.65 + Vector((0, 0, rng.uniform(0.35, 0.8)))).normalized()     # reach up: rounded crown
        branch(bm, cards, rng, pts[i], nd, length * rng.uniform(0.45, 0.7), radii[i] * 0.7, depth - 1, max(4, segs - 2))


def leaf_cards(bm_leaf, uvl, cards, rng):
    for (p, d, s) in cards:
        for k in range(2):                          # crossed pair, randomly rolled
            ang = rng.uniform(0, math.pi) + k * math.pi / 2
            up = Vector((0, 0, 1))
            dd = (d + Vector((0, 0, -0.3))).normalized()
            side = dd.cross(up).normalized() if abs(dd.z) < 0.95 else Vector((1, 0, 0))
            side = Quaternion(dd, ang) @ side
            base = p - dd * s * 0.15
            v = [base - side * s * 0.5, base + side * s * 0.5, base + side * s * 0.5 + dd * s, base - side * s * 0.5 + dd * s]
            vs = [bm_leaf.verts.new(x) for x in v]
            f = bm_leaf.faces.new(vs)
            for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uvl].uv = uv


def build_tree(name, seed, bark, leaf_mats, height):
    rng = np.random.default_rng(seed)
    bm = bmesh.new(); cards = []
    trunk_top = Vector((rng.normal(0, 0.3), rng.normal(0, 0.3), height * 0.45))
    pts = [Vector((0, 0, 0)), Vector((0, 0, height * 0.15)), trunk_top * 0.6 + Vector((0, 0, height * 0.12)), trunk_top]
    tube(bm, pts, [0.32, 0.24, 0.2, 0.16], 10)
    for k in range(rng.integers(5, 8)):
        a = k / 7 * math.tau + rng.normal(0, 0.4)
        d = Vector((math.cos(a), math.sin(a), rng.uniform(0.8, 1.6))).normalized()
        st = pts[2].lerp(trunk_top, rng.uniform(0.2, 1.0))
        branch(bm, cards, rng, st, d, height * rng.uniform(0.38, 0.52), 0.12, 3, 7)
    me = bpy.data.meshes.new(name + '_wood'); bm.to_mesh(me); bm.free()
    me.materials.append(bark)
    wood = bpy.data.objects.new(name + '_wood', me); bpy.context.scene.collection.objects.link(wood)
    bpy.context.view_layer.objects.active = wood
    for o in bpy.context.selected_objects: o.select_set(False)
    wood.select_set(True)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cylinder_project(); bpy.ops.object.mode_set(mode='OBJECT')
    # leaves (two cluster textures mixed)
    objs = [wood]
    for li, lm in enumerate(leaf_mats):
        bml = bmesh.new(); uvl = bml.loops.layers.uv.new('UVMap')
        leaf_cards(bml, uvl, cards[li::len(leaf_mats)], rng)
        lme = bpy.data.meshes.new(f'{name}_leaves{li}'); bml.to_mesh(lme); bml.free()
        lme.materials.append(lm)
        lo = bpy.data.objects.new(f'{name}_leaves{li}', lme); bpy.context.scene.collection.objects.link(lo)
        objs.append(lo)
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    for o in objs: o.parent = root
    return root, len(cards)


def build(export=True):
    ns_lib.reset_scene()
    hz = leaf_sprites('LeafSet009'); mp = leaf_sprites('LeafSet010')
    c1 = make_cluster('leaf_cluster_a', hz + mp[:1], 5)
    c2 = make_cluster('leaf_cluster_b', mp + hz[:2], 9)
    lm = [leaf_material('M_leaves_a', c1), leaf_material('M_leaves_b', c2)]
    bark = ns_lib.material('M_bark', color=(0.075, 0.065, 0.058), nrm='wood_nrm', rough=0.95)       # dark, rain-soaked
    out = {}
    for i, (seed, h) in enumerate(((3, 8.5), (17, 7.0), (29, 10.0))):
        root, n = build_tree(f'tree_{i}', seed, bark, lm, h)
        out[root.name] = n
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'trees.glb')
        out['bytes'] = ns_lib.export_glb(path, instances=False)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Props', 'trees.blend'))
    out['sprites'] = (len(hz), len(mp))
    return out
