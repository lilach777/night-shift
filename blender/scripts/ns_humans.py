# NIGHT SHIFT - human characters: Arman's double (reflection / CCTV) and the morning employee.
# Replaces the old primitive figures with:
#   * a continuous body built from a skin-modifier skeleton graph + Catmull-Clark subdivision
#   * a sculpted head (nose, brow ridge, eye sockets, cheekbones, jaw/chin) with eyes, ears, brows, hair
#   * clothing zones by material (uniform shirt / trousers / belt / shoes, or scrubs with a V-neck)
#   * an armature with automatic weights, rigid accessories (cap, badge, lanyard, hair)
#   * key-pose actions (idle, walk, head_tilt, stare) with per-segment Blender interpolation and
#     CYCLES modifiers on the loops.
# Exported one file per character: public/assets/models/arman.glb, employee.glb
#   import ns_humans; ns_humans.build()
import bpy, bmesh, math, os
from mathutils import Vector
import ns_lib
from ns_lib import material

FPS = 30
R = math.radians

# ----------------------------------------------------------------------------- skeleton (Blender coords: +x = character's left, -y = front, z up)
def skeleton(h=1.0, sh=1.0):
    """joints scaled by height factor h and shoulder width factor sh"""
    J = {
        'pelvis': (0, 0, 0.95), 'waist': (0, 0.005, 1.08), 'chest': (0, 0, 1.27), 'uchest': (0, 0.005, 1.40),
        'neck0': (0, 0.012, 1.475), 'neckm': (0, 0.01, 1.53), 'neck1': (0, 0.006, 1.585),
    }
    for s, n in ((1, 'L'), (-1, 'R')):
        J['shoulder.' + n] = (s * 0.19 * sh, 0.01, 1.43)
        J['elbow.' + n] = (s * 0.245 * sh, 0.025, 1.165)
        J['wrist.' + n] = (s * 0.262 * sh, 0.0, 0.945)
        J['knuck.' + n] = (s * 0.268 * sh, -0.012, 0.86)
        J['tip.' + n] = (s * 0.266 * sh, -0.012, 0.785)
        J['thumb.' + n] = (s * 0.245 * sh, -0.04, 0.885)
        J['hip.' + n] = (s * 0.095, 0.0, 0.905)
        J['knee.' + n] = (s * 0.1, -0.008, 0.5)
        J['calf.' + n] = (s * 0.1, 0.012, 0.31)
        J['ankle.' + n] = (s * 0.1, 0.018, 0.09)
        J['toe.' + n] = (s * 0.1, -0.13, 0.035)
    return {k: Vector((x, y, z * h)) for k, (x, y, z) in J.items()}


EDGES = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'uchest'), ('uchest', 'neck0'), ('neck0', 'neckm'), ('neckm', 'neck1')]
for _n in 'LR':
    EDGES += [('uchest', 'shoulder.' + _n), ('shoulder.' + _n, 'elbow.' + _n), ('elbow.' + _n, 'wrist.' + _n),
              ('wrist.' + _n, 'knuck.' + _n), ('knuck.' + _n, 'tip.' + _n), ('wrist.' + _n, 'thumb.' + _n),
              ('pelvis', 'hip.' + _n), ('hip.' + _n, 'knee.' + _n), ('knee.' + _n, 'calf.' + _n),
              ('calf.' + _n, 'ankle.' + _n), ('ankle.' + _n, 'toe.' + _n)]


def radii(build):
    """skin radii (rx, ry) per joint. build: 'male' | 'female'"""
    f = build == 'female'
    r = {
        'pelvis': (0.16 if f else 0.15, 0.115), 'waist': (0.125 if f else 0.14, 0.1), 'chest': (0.155 if f else 0.175, 0.115 if f else 0.12),
        'uchest': (0.15 if f else 0.175, 0.1), 'neck0': (0.068, 0.064), 'neckm': (0.05, 0.054), 'neck1': (0.048, 0.052),
    }
    for n in 'LR':
        r.update({
            'shoulder.' + n: (0.055 if f else 0.065, 0.06), 'elbow.' + n: (0.04 if f else 0.047, 0.045),
            'wrist.' + n: (0.028, 0.024), 'knuck.' + n: (0.017, 0.042), 'tip.' + n: (0.012, 0.03),
            'thumb.' + n: (0.012, 0.012), 'hip.' + n: (0.09 if f else 0.088, 0.088),
            'knee.' + n: (0.055 if f else 0.06, 0.06), 'calf.' + n: (0.057 if f else 0.062, 0.064),
            'ankle.' + n: (0.038, 0.04), 'toe.' + n: (0.045, 0.035),
        })
    return r


def build_body(name, J, build):
    names = list(J.keys())
    me = bpy.data.meshes.new(name + '_skel')
    me.from_pydata([J[n] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True; sk.branch_smoothing = 0.6
    rr = radii(build)
    for i, n in enumerate(names):
        sv = me.skin_vertices[0].data[i]
        sv.radius = rr[n]
        sv.use_root = (n == 'pelvis')
    ss = ob.modifiers.new('sub', 'SUBSURF'); ss.levels = 2; ss.render_levels = 2
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    # chest / glutes / calves volume: gentle radial pushes on the subdivided surface
    for v in me.vertices:
        p = v.co
        if 1.18 < p.z < 1.42 and p.y < 0:            # chest (front)
            w = math.exp(-((p.z - 1.31) / 0.07) ** 2) * (0.6 if build == 'female' else 0.35)
            p.y -= 0.022 * w
        if 0.78 < p.z < 1.0 and p.y > 0 and abs(p.x) < 0.17:   # seat
            p.y += 0.018 * math.exp(-((p.z - 0.9) / 0.06) ** 2)
    bpy.ops.object.shade_smooth()
    return ob


# ----------------------------------------------------------------------------- head
def gauss(d2, s): return math.exp(-d2 / (s * s))


def build_head(name, c, size=(0.078, 0.104, 0.112), female=False):
    """sculpted head around centre c (Blender coords), face toward -y"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=28, radius=1.0, location=(0, 0, 0))
    ob = bpy.context.active_object; ob.name = name
    for v in ob.data.vertices:
        n = v.co.normalized(); nx, ny, nz = n.x, n.y, n.z
        sx, sy, sz = size
        if nz < 0:                                   # jaw: narrower toward the chin
            sx *= 1 - 0.3 * (-nz) ** 1.4
            sy *= 1 - 0.08 * (-nz)
            sz *= 0.88                                # shorter lower face
        if ny > 0: sy *= 1.04                        # cranium back
        if nz > 0.35: sx *= 1 + 0.04 * (nz - 0.35)
        p = Vector((nx * sx, ny * sy, nz * sz))
        front = max(0.0, -ny)
        off = 0.0
        off += 0.024 * gauss(nx * nx, 0.07) * gauss((nz + 0.1) ** 2, 0.17) * front ** 3 * (0.85 if female else 1)  # nose
        off += 0.008 * gauss(nx * nx, 0.06) * gauss((nz - 0.12) ** 2, 0.12) * front ** 3                         # nose bridge
        off -= 0.013 * gauss((abs(nx) - 0.34) ** 2, 0.13) * gauss((nz - 0.15) ** 2, 0.1) * front ** 2           # eye sockets
        off += (0.004 if female else 0.008) * gauss((nz - 0.28) ** 2, 0.08) * gauss(nx * nx, 0.45) * front ** 2  # brow ridge
        off += 0.007 * gauss((abs(nx) - 0.55) ** 2, 0.12) * gauss((nz + 0.02) ** 2, 0.12) * front                # cheekbones
        off += 0.006 * gauss(nx * nx, 0.17) * gauss((nz + 0.32) ** 2, 0.07) * front ** 3                         # lips
        off -= 0.003 * gauss(nx * nx, 0.2) * gauss((nz + 0.44) ** 2, 0.04) * front ** 3                          # under-lip crease
        off += (0.006 if female else 0.011) * gauss(nx * nx, 0.22) * gauss((nz + 0.72) ** 2, 0.12) * front ** 2   # chin
        v.co = p + n * off + c
    bpy.ops.object.shade_smooth()
    return ob


def sphere(name, loc, scale, seg=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return o


def cyl(name, loc, r, depth, seg=24, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def box(name, loc, size, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        m = o.modifiers.new('bv', 'BEVEL'); m.width = bevel; m.segments = 2
        bpy.ops.object.modifier_apply(modifier='bv')
    return o


def set_mat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)


def rigid(o, bone):
    vg = o.vertex_groups.new(name=bone)
    vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    return o


# ----------------------------------------------------------------------------- armature
BONES = [  # name, head joint/pos, tail, parent
    ('hips', 'pelvis', (0, 0, 1.08), None),
    ('spine', (0, 0, 1.08), (0, 0, 1.28), 'hips'),
    ('chest', (0, 0, 1.28), (0, 0, 1.47), 'spine'),
    ('neck', (0, 0.008, 1.49), (0, 0.004, 1.585), 'chest'),
    ('head', (0, 0.004, 1.585), (0, 0.0, 1.80), 'neck'),
]
for _s, _n in ((1, 'L'), (-1, 'R')):
    BONES += [
        ('shoulder.' + _n, (_s * 0.035, 0.005, 1.44), 'shoulder.' + _n, 'chest'),
        ('upperarm.' + _n, 'shoulder.' + _n, 'elbow.' + _n, 'shoulder.' + _n),
        ('forearm.' + _n, 'elbow.' + _n, 'wrist.' + _n, 'upperarm.' + _n),
        ('hand.' + _n, 'wrist.' + _n, 'tip.' + _n, 'forearm.' + _n),
        ('thigh.' + _n, 'hip.' + _n, 'knee.' + _n, 'hips'),
        ('shin.' + _n, 'knee.' + _n, 'ankle.' + _n, 'thigh.' + _n),
        ('foot.' + _n, 'ankle.' + _n, 'toe.' + _n, 'shin.' + _n),
    ]


def build_armature(name, J, h):
    arm = bpy.data.armatures.new(name + '_rig')
    rig = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    P = lambda v: J[v].copy() if isinstance(v, str) else Vector((v[0], v[1], v[2] * h))
    for bn, a, b, parent in BONES:
        eb = arm.edit_bones.new(bn)
        eb.head = P(a); eb.tail = P(b)
        # consistent local axes: Z toward the front (-y) for limbs/spine, up for the feet,
        # so +X rotation always swings a bone's tail forward
        eb.align_roll(Vector((0, 0, 1)) if bn.startswith('foot') else Vector((0, -1, 0)))
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'
    return rig


# ----------------------------------------------------------------------------- clothing zones
def zone_materials(body, build, mats, h):
    me = body.data
    for m in mats['order']: me.materials.append(m)
    idx = {m.name: i for i, m in enumerate(me.materials)}
    for poly in me.polygons:
        c = poly.center; z = c.z / h; ax = abs(c.x)
        if z > 1.5: k = 'skin'                                                    # neck
        elif ax > 0.2 and z < (0.955 if build == 'male' else 1.2) and z < 1.25: k = 'skin'   # hands / forearms (short sleeves)
        elif z < 0.115: k = 'shoes'
        elif build == 'male' and 0.905 < z < 0.965 and ax < 0.2: k = 'belt'
        elif z < 0.94 and ax < 0.2: k = 'legs'
        else: k = 'top'
        poly.material_index = idx[mats[k].name]


# ----------------------------------------------------------------------------- actions
def pose(**kw):
    """bone=(x, y, z) degrees; hips_loc=(x, y, z)"""
    return kw


def mirror(d):
    out = {}
    for k, v in d.items():
        if k.endswith('.L'): out[k[:-2] + '.R'] = (v[0], -v[1], -v[2])
        elif k.endswith('.R'): out[k[:-2] + '.L'] = (v[0], -v[1], -v[2])
        else: out[k] = v
    return out


ARMS_DOWN = {'upperarm.L': (2, 0, 4), 'upperarm.R': (2, 0, -4), 'forearm.L': (8, 0, 0), 'forearm.R': (8, 0, 0)}


def walk_pose(ph, female=False):
    """phase 0 = left heel strike. Classic contact / down / passing / up key poses."""
    s = math.sin(2 * math.pi * ph); c = math.cos(2 * math.pi * ph)
    def g(q, at, w):                                           # circular gaussian over the cycle
        d = (q - at + 0.5) % 1.0 - 0.5
        return math.exp(-(d / w) ** 2)
    out = {}
    for n, sp in (('L', 0.0), ('R', 0.5)):
        q = (ph + sp) % 1.0                                    # 0 heel strike, ~0.6 toe off, swing after
        cp = math.cos(2 * math.pi * q)
        thigh = 22 * cp + 3
        knee = -(3 + 11 * g(q, 0.1, 0.07) + 56 * g(q, 0.73, 0.1))     # loading response + swing flexion
        foot = 11 * g(q, 0.0, 0.06) - 21 * g(q, 0.6, 0.07) + 7 * g(q, 0.86, 0.08)   # heel strike / push-off / toe clearance
        out['thigh.' + n] = (thigh, 0, 0)
        out['shin.' + n] = (knee, 0, 0)
        out['foot.' + n] = (foot, 0, 0)
        arm = -18 * cp * (0.8 if female else 1)
        sgn = 1 if n == 'L' else -1
        out['upperarm.' + n] = (arm + 2, 0, sgn * 5)
        out['forearm.' + n] = (12 + 10 * max(0.0, -cp), 0, 0)
    bob = -0.022 * math.cos(4 * math.pi * ph)
    out['hips_loc'] = (0.016 * s, 0, bob + 0.006)
    out['hips'] = (2, 6 * s * (1.4 if female else 1), -2.5 * c)
    out['spine'] = (3, -3 * s, 1.2 * c)
    out['chest'] = (-1, -5 * s, 1.5 * c)
    out['neck'] = (-2, 2 * s, 0)
    out['head'] = (2, 2 * s, -1 * c)
    return out


def keys_walk(female):
    return [(i / 8, walk_pose(i / 8, female), 'BEZIER', 'AUTO') for i in range(9)]


def idle_pose(u, female=False):
    b = math.sin(2 * math.pi * u)
    d = dict(ARMS_DOWN)
    d.update({'chest': (-1.2 * b, 0, 0), 'spine': (1.0, 0, 0), 'neck': (2 + 0.8 * b, 0, 0), 'head': (-1 - 0.6 * b, 0, 0),
              'shoulder.L': (0, 0, 1.5 * b), 'shoulder.R': (0, 0, -1.5 * b),
              'hips': (0, 0, 1.2), 'thigh.L': (1, 0, -1), 'thigh.R': (-1, 0, 1), 'shin.L': (-3, 0, 0), 'shin.R': (-1, 0, 0),
              'hips_loc': (0.012, 0, -0.004 * (1 + b))})
    return d


def keys_idle(female):
    # breathing in on a slow SINE, a weight shift hip-to-hip on top (QUAD ease)
    a, b2 = idle_pose(0.0, female), idle_pose(0.25, female)
    shift = dict(idle_pose(0.5, female)); shift['hips_loc'] = (-0.01, 0, -0.004); shift['hips'] = (0, 0, -1.2)
    shift['thigh.L'] = (-1, 0, 1); shift['thigh.R'] = (1, 0, -1)
    return [(0.0, a, 'SINE', 'EASE_IN_OUT'), (0.25, b2, 'SINE', 'EASE_IN_OUT'), (0.5, shift, 'QUAD', 'EASE_IN_OUT'),
            (0.75, idle_pose(0.75, female), 'SINE', 'EASE_IN_OUT'), (1.0, a, 'BEZIER', 'AUTO')]


def keys_stare(female):
    """standing dead still, staring - only the breath; nothing else moves (uncanny)."""
    a = dict(idle_pose(0.0, female)); a['head'] = (-4, 0, 0); a['neck'] = (1, 0, 0)
    a['upperarm.L'] = (0, 0, 2); a['upperarm.R'] = (0, 0, -2); a['forearm.L'] = (3, 0, 0); a['forearm.R'] = (3, 0, 0)
    b = dict(a); b['chest'] = (-1.4, 0, 0)
    return [(0.0, a, 'SINE', 'EASE_IN_OUT'), (0.5, b, 'SINE', 'EASE_IN_OUT'), (1.0, a, 'BEZIER', 'AUTO')]


def keys_head_tilt(female):
    """the reflection stops copying: a slow, wrong tilt of the head with a stop-motion twitch,
    the chin lowering while the eyes stay on you."""
    a = keys_stare(female)[0][1]
    t1 = dict(a); t1['head'] = (6, 0, -22); t1['neck'] = (4, 0, -8)
    tw = dict(t1); tw['head'] = (8, 4, -27)
    t2 = dict(t1); t2['head'] = (10, -2, -30); t2['neck'] = (6, 0, -10); t2['chest'] = (2, 0, -2)
    return [(0.0, a, 'CUBIC', 'EASE_IN_OUT'), (0.45, t1, 'CONSTANT'), (0.55, tw, 'CONSTANT'), (0.58, t1, 'SINE', 'EASE_IN_OUT'),
            (1.0, t2, 'BEZIER', 'AUTO')]


ACTIONS = {
    'idle': (keys_idle, 4.2, True), 'walk': (keys_walk, 1.1, True),
    'stare': (keys_stare, 4.8, True), 'head_tilt': (keys_head_tilt, 5.0, False),
}


def fcurves(act):
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])): return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]


def build_actions(rig, prefix, female):
    rig.animation_data_create()
    names = []
    all_bones = [b[0] for b in BONES]
    for an, (kf, dur, loop) in ACTIONS.items():
        act = bpy.data.actions.new(prefix + '_' + an); act.use_fake_user = True
        rig.animation_data.action = act
        info = []
        for k in kf(female):
            t, p, interp = k[:3]; easing = k[3] if len(k) > 3 else 'AUTO'
            frame = 1 + t * dur * FPS
            for bn in all_bones:
                pb = rig.pose.bones[bn]
                v = p.get(bn, (0, 0, 0))
                pb.rotation_euler = (R(v[0]), R(v[1]), R(v[2]))
                pb.keyframe_insert('rotation_euler', frame=frame)
            pb = rig.pose.bones['hips']; pb.location = p.get('hips_loc', (0, 0, 0)); pb.keyframe_insert('location', frame=frame)
            info.append((frame, interp, easing))
        for fc in fcurves(act):
            for kp in fc.keyframe_points:
                fi = min(info, key=lambda f: abs(f[0] - kp.co.x))
                kp.interpolation = fi[1]
                if fi[1] not in ('BEZIER', 'CONSTANT', 'LINEAR'): kp.easing = fi[2]
                if fi[1] == 'BEZIER': kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
            if loop: fc.modifiers.new('CYCLES')
            fc.update()
        tr = rig.animation_data.nla_tracks.new(); tr.name = act.name
        tr.strips.new(act.name, 1, act); tr.mute = True
        rig.animation_data.action = None
        names.append(act.name)
    for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    return names


# ----------------------------------------------------------------------------- characters
def common_mats(prefix, skin_col):
    return {
        'skin': material('M_%s_skin' % prefix, color=skin_col, rough=0.48),
        'eye_white': material('M_eye_white', color=(0.72, 0.7, 0.66), rough=0.15),
        'iris': material('M_eye_iris', color=(0.03, 0.022, 0.016), rough=0.05),
        'brow': material('M_%s_hair' % prefix, color=(0.035, 0.025, 0.02), rough=0.75),
        'lips': material('M_%s_lips' % prefix, color=(skin_col[0] * 0.75, skin_col[1] * 0.5, skin_col[2] * 0.48), rough=0.45),
    }


def face_parts(prefix, hc, mats, female, head_size):
    """eyes, brows, ears around head centre hc"""
    parts = []
    sx, sy, sz = head_size
    for s in (1, -1):
        ex, ez = s * 0.0335, hc.z + 0.016
        ey = hc.y - sy * 0.86
        e = sphere('%s_eye' % prefix, (ex, ey, ez), (0.0122, 0.0122, 0.0122), 16, 10); set_mat(e, mats['eye_white']); parts.append(e)
        i = sphere('%s_iris' % prefix, (ex, ey - 0.0105, ez), (0.0062, 0.0025, 0.0062), 12, 8); set_mat(i, mats['iris']); parts.append(i)
        lid = sphere('%s_lid' % prefix, (ex, ey - 0.001, ez + 0.0075), (0.0136, 0.0118, 0.0062), 16, 8); set_mat(lid, mats['skin']); parts.append(lid)
        low = sphere('%s_lowlid' % prefix, (ex, ey - 0.0005, ez - 0.0082), (0.0134, 0.0116, 0.0048), 16, 8); set_mat(low, mats['skin']); parts.append(low)
        b = box('%s_brow' % prefix, (s * 0.034, hc.y - sy * 0.97, hc.z + 0.036), (0.034 if not female else 0.03, 0.006, 0.0055 if not female else 0.0035), rot=(0, s * R(-8), 0), bevel=0.0015)
        set_mat(b, mats['brow']); parts.append(b)
        ear = sphere('%s_ear' % prefix, (s * (sx + 0.004), hc.y + 0.008, hc.z + 0.002), (0.008, 0.019, 0.026), 12, 8)
        set_mat(ear, mats['skin']); parts.append(ear)
    lip = sphere('%s_lip' % prefix, (0, hc.y - sy * 0.95, hc.z - 0.033), (0.021, 0.006, 0.0045), 12, 6); set_mat(lip, mats['lips']); parts.append(lip)
    return parts


def build_character(kind):
    ns_lib.reset_scene()
    female = kind == 'employee'
    h = 0.955 if female else 1.0
    J = skeleton(h, 0.9 if female else 1.0)
    build = 'female' if female else 'male'
    mats = common_mats(kind, (0.6, 0.45, 0.37) if female else (0.52, 0.38, 0.3))
    if female:
        top = material('M_scrubs', color=(0.13, 0.33, 0.35), rough=0.92)
        mats.update(top=top, legs=top, shoes=material('M_clog_white', color=(0.82, 0.82, 0.8), rough=0.5), belt=top)
    else:
        mats.update(top=material('M_uniform_shirt', color=(0.075, 0.09, 0.125), rough=0.88),
                    legs=material('M_uniform_trousers', color=(0.035, 0.04, 0.055), rough=0.85),
                    shoes=material('M_shoe_black', color=(0.015, 0.015, 0.016), rough=0.3),
                    belt=material('M_belt', color=(0.02, 0.018, 0.016), rough=0.4))
    mats['order'] = [mats['top'], mats['legs'], mats['shoes'], mats['belt'], mats['skin']]
    body = build_body(kind + '_body', J, build)
    zone_materials(body, build, mats, h)
    rig = build_armature(kind, J, h)
    # ---- weights for the body (heat diffusion), then rigid accessories
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    parts = []
    head_size = (0.073, 0.099, 0.104) if female else (0.077, 0.103, 0.109)
    hc = Vector((0, -0.008, 1.665 * h + (0.0 if not female else 0.01)))
    head = build_head(kind + '_head', hc, head_size, female); set_mat(head, mats['skin'])
    parts += [rigid(head, 'head')]
    for p in face_parts(kind, hc, mats, female, head_size): parts.append(rigid(p, 'head'))
    if female:
        hair = build_head(kind + '_hair', hc + Vector((0, 0.006, 0.008)), (head_size[0] + 0.007, head_size[1] + 0.006, head_size[2] + 0.006), True)
        bm = bmesh.new(); bm.from_mesh(hair.data)
        kill = [v for v in bm.verts if ((v.co - hc).normalized().y < -0.12 and (v.co - hc).normalized().z < 0.5) or ((v.co - hc).normalized().y < 0.3 and (v.co - hc).normalized().z < 0.12) or (v.co - hc).normalized().z < -0.4]
        bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(hair.data); bm.free()
        set_mat(hair, mats['brow']); parts.append(rigid(hair, 'head'))
        bun = sphere(kind + '_bun', (0, hc.y + 0.105, hc.z + 0.05), (0.045, 0.04, 0.042)); set_mat(bun, mats['brow']); parts.append(rigid(bun, 'head'))
        # sleeve hems: a folded cuff hides the cloth/skin boundary on each upper arm
        for s, n in ((1, 'L'), (-1, 'R')):
            a, b = J['shoulder.' + n], J['elbow.' + n]
            zc = 1.2 * h; u = (a.z - zc) / (a.z - b.z); pc = a.lerp(b, u)
            d = (b - a).normalized()
            cf = cyl(kind + '_cuff', tuple(pc), 0.05, 0.03, 24)
            cf.rotation_mode = 'QUATERNION'; cf.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(d)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
            set_mat(cf, mats['top']); parts.append(rigid(cf, 'upperarm.' + n))
        # ID card clipped to the scrub top
        card = box(kind + '_card', (0.075, -0.127, 1.215 * h), (0.05, 0.004, 0.07), bevel=0.003)
        set_mat(card, material('M_idcard', color=(0.85, 0.85, 0.82), rough=0.4)); parts.append(rigid(card, 'chest'))
        # pocket on the scrub top
        pk = box(kind + '_pocket', (0.075, -0.118, 1.27 * h), (0.07, 0.006, 0.07), bevel=0.004); set_mat(pk, mats['top']); parts.append(rigid(pk, 'chest'))
    else:
        hair = build_head(kind + '_hair', hc + Vector((0, 0.004, 0.006)), (head_size[0] + 0.004, head_size[1] + 0.004, head_size[2] + 0.004))
        bm = bmesh.new(); bm.from_mesh(hair.data)
        kill = [v for v in bm.verts if ((v.co - hc).normalized().y < -0.3 and (v.co - hc).normalized().z < 0.5) or (v.co - hc).normalized().z < 0.05]
        bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(hair.data); bm.free()
        set_mat(hair, mats['brow']); parts.append(rigid(hair, 'head'))
        # security cap: crown, band, peak
        crown = cyl(kind + '_cap', (0, hc.y + 0.004, hc.z + 0.085), 0.088, 0.06, 32, r2=0.082)
        cap_m = material('M_cap', color=(0.04, 0.045, 0.065), rough=0.7); set_mat(crown, cap_m); parts.append(rigid(crown, 'head'))
        band = cyl(kind + '_capband', (0, hc.y + 0.004, hc.z + 0.058), 0.087, 0.014, 32); set_mat(band, mats['belt']); parts.append(rigid(band, 'head'))
        peak = box(kind + '_peak', (0, hc.y - 0.105, hc.z + 0.057), (0.15, 0.065, 0.008), rot=(R(-12), 0, 0), bevel=0.006)
        set_mat(peak, mats['shoes']); parts.append(rigid(peak, 'head'))
        brass = material('M_brass', color=(0.55, 0.42, 0.18), rough=0.35, metal=1.0)
        cb = box(kind + '_capbadge', (0, hc.y - 0.089, hc.z + 0.085), (0.024, 0.004, 0.026), bevel=0.003); set_mat(cb, brass); parts.append(rigid(cb, 'head'))
        badge = box(kind + '_badge', (0.085, -0.13, 1.385), (0.045, 0.006, 0.055), bevel=0.004); set_mat(badge, brass); parts.append(rigid(badge, 'chest'))
        for s in (1, -1):
            pk = box(kind + '_pocket', (s * 0.08, -0.128, 1.315), (0.075, 0.007, 0.08), bevel=0.004); set_mat(pk, mats['top']); parts.append(rigid(pk, 'chest'))
            ep = box(kind + '_epaulette', (s * 0.125, 0.004, 1.448), (0.085, 0.045, 0.007), rot=(0, s * R(20), 0), bevel=0.003); set_mat(ep, mats['top']); parts.append(rigid(ep, 'chest'))
        col = cyl(kind + '_collar', (0, 0.008, 1.475), 0.07, 0.05, 32, r2=0.062); set_mat(col, mats['top']); parts.append(rigid(col, 'neck'))
        buckle = box(kind + '_buckle', (0, -0.118, 0.935), (0.05, 0.008, 0.035), bevel=0.003)
        set_mat(buckle, material('M_steel_buckle', color=(0.5, 0.5, 0.52), rough=0.3, metal=1.0)); parts.append(rigid(buckle, 'hips'))
        radio = box(kind + '_radio', (-0.155, -0.04, 0.9), (0.03, 0.055, 0.1), bevel=0.006); set_mat(radio, mats['belt']); parts.append(rigid(radio, 'hips'))
    # join accessories into the body (vertex groups merge by bone name)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body = bpy.context.active_object; body.name = kind + '_mesh'
    acts = build_actions(rig, kind, female)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    path = os.path.join(ns_lib.MODEL_DIR, kind + '.glb')
    size = ns_lib.export_glb(path, objects=[rig], anim=True, instances=False)
    os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Characters'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Characters', kind + '.blend'))
    return {'tris': tris, 'actions': acts, 'bytes': size}


def build():
    return {k: build_character(k) for k in ('arman', 'employee')}
