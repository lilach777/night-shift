# NIGHT SHIFT — Blender helper library.
# All geometry is authored in three.js space (x right, y up, z toward viewer, metres)
# and converted to Blender space (x, -z, y) on mesh creation, so the glTF exporter
# (+Y up) round-trips coordinates exactly into the game.
import os, math, json
import numpy as np
import bpy, bmesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX_DIR = os.path.join(ROOT, 'blender', 'Textures')
MODEL_DIR = os.path.join(ROOT, 'public', 'assets', 'models')
os.makedirs(MODEL_DIR, exist_ok=True)


def load_layout():
    with open(os.path.join(ROOT, 'blender', 'layout.json'), 'r', encoding='utf-8') as f:
        return json.load(f)


def to_b(p):
    return (p[0], -p[2], p[1])


# ----------------------------------------------------------------------------- scene
def reset_scene():
    _img_cache.clear()
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions, bpy.data.curves, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for b in list(blocks):
            if b.users == 0 or True:
                try:
                    blocks.remove(b)
                except Exception:
                    pass


def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def empty(name, coll, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.location = to_b(loc)
    coll.objects.link(o)
    if parent:
        o.parent = parent
    return o


# ----------------------------------------------------------------------------- materials
_img_cache = {}


def img(name, noncolor=False):
    key = (name, noncolor)
    if key in _img_cache and _img_cache[key].name in bpy.data.images:
        return _img_cache[key]
    for ext in ('.jpg', '.png'):
        p = os.path.join(TEX_DIR, name + ext)
        if os.path.exists(p):
            im = bpy.data.images.load(p, check_existing=True)
            if noncolor:
                im.colorspace_settings.name = 'Non-Color'
            _img_cache[key] = im
            return im
    raise FileNotFoundError(name)


def material(name, color=(0.8, 0.8, 0.8), tex=None, nrm=None, rgh=None, rough=0.8, metal=0.0,
             emit=None, emit_strength=1.0, alpha=None, nrm_strength=1.0, vcol=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    y = 300
    base_out = None
    if tex:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(tex); t.location = (-600, y)
        base_out = t.outputs['Color']
        if alpha == 'tex':
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    if vcol:
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Color'; a.location = (-600, 0)
        if base_out is not None:
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(base_out, mix.inputs[6]); nt.links.new(a.outputs['Color'], mix.inputs[7])
            base_out = mix.outputs[2]
        else:
            base_out = a.outputs['Color']
    if base_out is not None:
        nt.links.new(base_out, bsdf.inputs['Base Color'])
    if rgh:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(rgh, True); t.location = (-600, -300)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if nrm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(nrm, True); t.location = (-800, -600)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-400, -600)
        nm.inputs['Strength'].default_value = nrm_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if isinstance(alpha, (int, float)):
        bsdf.inputs['Alpha'].default_value = alpha
    if alpha is not None:
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return m


def std_materials():
    M = {}
    M['wall'] = material('M_wall_paint', tex='wall_paint_col', nrm='wall_paint_nrm', rgh='wall_paint_rgh')
    M['wall_kids'] = material('M_wall_children', tex='wall_children_col', nrm='wall_children_nrm', rgh='wall_children_rgh')
    M['wall_conc'] = material('M_wall_concrete', tex='concrete_wall_col', nrm='concrete_wall_nrm', rgh='concrete_wall_rgh')
    M['floor'] = material('M_floor_tile', tex='floor_tile_col', nrm='floor_tile_nrm', rgh='floor_tile_rgh')
    M['floor_conc'] = material('M_floor_concrete', tex='concrete_floor_col', nrm='concrete_floor_nrm', rgh='concrete_floor_rgh')
    M['ceiling'] = material('M_ceiling', tex='ceiling_col', nrm='ceiling_nrm', rough=0.95)
    M['metal'] = material('M_metal_paint', tex='metal_paint_col', nrm='metal_paint_nrm', rgh='metal_paint_rgh', metal=0.3)
    M['steel'] = material('M_steel', tex='steel_col', rgh='steel_rgh', metal=0.85)
    M['wood'] = material('M_wood', tex='wood_col', nrm='wood_nrm', rough=0.65)
    M['vinyl'] = material('M_vinyl', tex='vinyl_col', rough=0.55)
    M['linen'] = material('M_linen', tex='linen_col', rough=0.95)
    M['plastic'] = material('M_plastic', tex='plastic_col', rough=0.5)
    M['paper'] = material('M_paper', tex='paper_col', rough=0.9)
    M['rubber'] = material('M_rubber', color=(0.03, 0.03, 0.03), rough=0.9)
    M['dark'] = material('M_dark_metal', color=(0.06, 0.06, 0.065), rough=0.5, metal=0.6)
    M['glass'] = material('M_glass', color=(0.15, 0.18, 0.2), rough=0.05, alpha=0.25)
    M['screen'] = material('M_screen', color=(0.02, 0.025, 0.03), rough=0.15)
    M['light'] = material('M_light_panel', color=(0.9, 0.92, 0.95), emit=(0.9, 0.95, 1.0), emit_strength=2.0, rough=0.3)
    M['sign'] = material('M_sign_board', color=(0.75, 0.75, 0.7), tex='plastic_col', rough=0.4)
    M['sign_text'] = material('M_sign_text', color=(0.05, 0.12, 0.1), rough=0.5)
    M['sign_red'] = material('M_sign_red', color=(0.45, 0.04, 0.03), rough=0.5)
    M['brick'] = material('M_brick', tex='brick_col', nrm='brick_nrm', rough=0.9)
    M['asphalt'] = material('M_asphalt', tex='asphalt_col', nrm='asphalt_nrm', rgh='asphalt_rgh')
    M['mud'] = material('M_mud', tex='mud_col', rough=0.95)
    M['roof'] = material('M_roof', tex='concrete_floor_col', rough=0.9)
    M['decal'] = material('M_decals', tex='decals_atlas', alpha='tex', rough=0.35)
    M['blood'] = material('M_blood', color=(0.2, 0.01, 0.01), rough=0.2)
    M['bark'] = material('M_bark', color=(0.07, 0.06, 0.05), tex='concrete_wall_col', rough=0.95)
    M['green'] = material('M_paint_green', color=(0.2, 0.32, 0.28), tex='plastic_col', rough=0.6)
    M['orange'] = material('M_paint_yellow', color=(0.7, 0.55, 0.12), tex='plastic_col', rough=0.6)
    M['toy_red'] = material('M_toy_red', color=(0.5, 0.08, 0.06), tex='plastic_col', rough=0.6)
    M['toy_blue'] = material('M_toy_blue', color=(0.1, 0.2, 0.5), tex='plastic_col', rough=0.6)
    M['teddy'] = material('M_teddy', color=(0.45, 0.32, 0.2), tex='fur_col', rough=1.0)
    return M


# ----------------------------------------------------------------------------- mesh builder
class MB:
    """Mesh builder working in three.js coordinates."""

    def __init__(self):
        self.v = []; self.f = []; self.uv = []; self.mi = []; self.sm = []; self.mats = []
        self.T = np.eye(4)

    def mat(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def push(self, rot_y=0.0, offset=(0, 0, 0), rot_x=0.0, rot_z=0.0, scale=None):
        T = np.eye(4)
        cy, sy = math.cos(rot_y), math.sin(rot_y)
        Ry = np.array([[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]])
        cx, sx = math.cos(rot_x), math.sin(rot_x)
        Rx = np.array([[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]])
        cz, sz = math.cos(rot_z), math.sin(rot_z)
        Rz = np.array([[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
        S = np.eye(4)
        if scale is not None:
            S[0, 0], S[1, 1], S[2, 2] = scale
        T[:3, 3] = offset
        prev = self.T
        self.T = prev @ T @ Ry @ Rx @ Rz @ S
        return prev

    def pop(self, prev):
        self.T = prev

    def _xf(self, p):
        q = self.T @ np.array([p[0], p[1], p[2], 1.0])
        return (q[0], q[1], q[2])

    def poly(self, pts, mat, uvs, smooth=False, normal=None):
        pts = [self._xf(p) for p in pts]
        if normal is not None:
            nrm = (self.T[:3, :3] @ np.asarray(normal))
            a = np.array(pts[1]) - np.array(pts[0]); b = np.array(pts[2]) - np.array(pts[0])
            if np.dot(np.cross(a, b), nrm) < 0:
                pts = pts[::-1]; uvs = uvs[::-1]
        base = len(self.v)
        self.v.extend(pts)
        self.f.append(list(range(base, base + len(pts))))
        self.uv.append(list(uvs))
        self.mi.append(self.mat(mat))
        self.sm.append(smooth)

    def box(self, x0, y0, z0, x1, y1, z1, mat, s=1.0, faces='xXyYzZ', fmat=None, uvmode='box', wall=None, uvoff=(0, 0)):
        """Axis-aligned box (in current transform). faces: x=-X X=+X y=-Y Y=+Y z=-Z Z=+Z."""
        fmat = fmat or {}
        if x0 > x1: x0, x1 = x1, x0
        if y0 > y1: y0, y1 = y1, y0
        if z0 > z1: z0, z1 = z1, z0
        P = {
            'X': ([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], (1, 0, 0)),
            'x': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
            'Y': ([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], (0, 1, 0)),
            'y': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
            'Z': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
            'z': ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1)),
        }
        for k in faces:
            pts, n = P[k]
            m = fmat.get(k, mat)
            if uvmode == 'wall':
                # wall = (axis, ybase): u along wall, v = height / 3.2
                axis, yb = wall
                uvs = []
                for p in pts:
                    if k in 'yY':
                        uvs.append((p[0] * s, p[2] * s))
                        continue
                    along = p[0] if axis == 'x' else p[2]
                    if k in ('xX' if axis == 'x' else 'zZ'):
                        along = (p[2] if axis == 'x' else p[0])
                    sgn = 1 if k in 'XZ' else -1
                    uvs.append((along / 2.5 + uvoff[0], (p[1] - yb) / 3.2))
            else:
                uvs = []
                for p in pts:
                    wp = self._xf(p) if uvmode == 'world' else p
                    if k in 'xX':
                        uvs.append((wp[2] * s + uvoff[0], wp[1] * s + uvoff[1]))
                    elif k in 'yY':
                        uvs.append((wp[0] * s + uvoff[0], wp[2] * s + uvoff[1]))
                    else:
                        uvs.append((wp[0] * s + uvoff[0], wp[1] * s + uvoff[1]))
            self.poly(pts, m, uvs, normal=n)

    def cbox(self, cx, cy, cz, w, h, d, mat, s=1.0, faces='xXyYzZ', **kw):
        """Box centred on x/z with bottom at cy."""
        self.box(cx - w / 2, cy, cz - d / 2, cx + w / 2, cy + h, cz + d / 2, mat, s, faces, **kw)

    def cyl(self, c, r, h, mat, seg=10, axis='y', caps=True, r2=None, s=1.0, smooth=True):
        """Cylinder/cone. c = centre of bottom cap."""
        r2 = r if r2 is None else r2
        if h < 0:
            ax_i = {'x': 0, 'y': 1, 'z': 2}[axis]
            c = list(c); c[ax_i] += h; h = -h; r, r2 = r2, r
        def P(a, rr, t):
            ca, sa = math.cos(a) * rr, math.sin(a) * rr
            if axis == 'y': return (c[0] + ca, c[1] + t, c[2] + sa)
            if axis == 'x': return (c[0] + t, c[1] + ca, c[2] + sa)
            return (c[0] + ca, c[1] + sa, c[2] + t)
        circ = 2 * math.pi * max(r, r2)
        for i in range(seg):
            a0 = 2 * math.pi * i / seg; a1 = 2 * math.pi * (i + 1) / seg
            pts = [P(a0, r, 0), P(a1, r, 0), P(a1, r2, h), P(a0, r2, h)]
            u0 = i / seg * circ * s; u1 = (i + 1) / seg * circ * s
            mid = (a0 + a1) / 2
            nd = {'y': (math.cos(mid), 0, math.sin(mid)), 'x': (0, math.cos(mid), math.sin(mid)), 'z': (math.cos(mid), math.sin(mid), 0)}[axis]
            self.poly(pts, mat, [(u0, 0), (u1, 0), (u1, h * s), (u0, h * s)], smooth=smooth, normal=nd)
        if caps:
            ax = {'y': (0, 1, 0), 'x': (1, 0, 0), 'z': (0, 0, 1)}[axis]
            for t, rr, sg in ((0, r, -1), (h, r2, 1)):
                if rr <= 0.0005:
                    continue
                pts = [P(2 * math.pi * i / seg, rr, t) for i in range(seg)]
                uvs = [(0.5 + 0.5 * math.cos(2 * math.pi * i / seg), 0.5 + 0.5 * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
                self.poly(pts, mat, uvs, normal=tuple(sg * a for a in ax))

    def sphere(self, c, rx, ry, rz, mat, seg=10, rings=6, s=1.0, ymin=-1.0):
        for j in range(rings):
            v0 = -math.pi / 2 + math.pi * j / rings; v1 = -math.pi / 2 + math.pi * (j + 1) / rings
            if math.sin(v1) < ymin:
                continue
            for i in range(seg):
                u0 = 2 * math.pi * i / seg; u1 = 2 * math.pi * (i + 1) / seg
                def P(u, v):
                    return (c[0] + rx * math.cos(v) * math.cos(u), c[1] + ry * math.sin(v), c[2] + rz * math.cos(v) * math.sin(u))
                pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]
                uvs = [(i / seg, j / rings), ((i + 1) / seg, j / rings), ((i + 1) / seg, (j + 1) / rings), (i / seg, (j + 1) / rings)]
                mu = (u0 + u1) / 2; mv = (v0 + v1) / 2
                n = (math.cos(mv) * math.cos(mu), math.sin(mv), math.cos(mv) * math.sin(mu))
                if j == 0 or j == rings - 1:
                    # collapse degenerate pole quads into triangles
                    if j == 0:
                        pts = [pts[0], pts[2], pts[3]]; uvs = [uvs[0], uvs[2], uvs[3]]
                    else:
                        pts = [pts[0], pts[1], pts[2]]; uvs = [uvs[0], uvs[1], uvs[2]]
                self.poly(pts, mat, uvs, smooth=True, normal=n)

    def quad_uv(self, pts, mat, uvs, normal=None, smooth=False):
        self.poly(pts, mat, uvs, normal=normal, smooth=smooth)

    def tube(self, path, r, mat, seg=6, s=1.0):
        """Straight segments between successive points (pipes / rails)."""
        for a, b in zip(path[:-1], path[1:]):
            a = np.array(a, float); b = np.array(b, float)
            d = b - a; L = np.linalg.norm(d)
            if L < 1e-6:
                continue
            d /= L
            up = np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0])
            u = np.cross(d, up); u /= np.linalg.norm(u); v = np.cross(d, u)
            for i in range(seg):
                a0 = 2 * math.pi * i / seg; a1 = 2 * math.pi * (i + 1) / seg
                o0 = (u * math.cos(a0) + v * math.sin(a0)) * r
                o1 = (u * math.cos(a1) + v * math.sin(a1)) * r
                pts = [tuple(a + o0), tuple(a + o1), tuple(b + o1), tuple(b + o0)]
                nm = (u * math.cos((a0 + a1) / 2) + v * math.sin((a0 + a1) / 2))
                self.poly(pts, mat, [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, L * s), (i / seg, L * s)], smooth=True, normal=tuple(nm))

    def empty_(self):
        return len(self.f) == 0

    def build(self, name, coll, vcols=None):
        me = bpy.data.meshes.new(name)
        verts = [to_b(p) for p in self.v]
        me.from_pydata(verts, [], self.f)
        me.update()
        uvl = me.uv_layers.new(name='UVMap')
        flat = [uv for face in self.uv for uv in face]
        uvl.data.foreach_set('uv', [c for uv in flat for c in uv])
        for m in self.mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.mi)
        me.polygons.foreach_set('use_smooth', self.sm)
        if vcols is not None:
            ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
            ca.data.foreach_set('color', vcols)
        me.validate()
        o = bpy.data.objects.new(name, me)
        coll.objects.link(o)
        return o


def text_mesh(text, size, coll, mat, extrude=0.004, align='CENTER', name='txt'):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return me  # in Blender space: text lies in XY plane (faces +Z)


def join(objs, name):
    objs = [o for o in objs if o]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def export_glb(path, objects=None, collection_name=None, anim=False, instances=True):
    bpy.ops.object.select_all(action='DESELECT')
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
              export_image_format='WEBP', export_image_quality=82, export_cameras=False, export_lights=False,
              export_gpu_instances=instances, export_animations=anim, export_extras=True)
    if objects is not None:
        for o in objects:
            o.select_set(True)
            for ch in o.children_recursive:
                ch.select_set(True)
        kw['use_selection'] = True
    if anim:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False, export_skins=True)
    bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)
