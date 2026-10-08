# NIGHT SHIFT - the Koala, v2 (realistic + aggressive).
# Same skeleton and animation set as ns_koala.py (so the AI / story code is untouched), new:
#  * anatomical koala head: broad flat skull, huge leathery spoon nose, small wide-set eyes,
#    big round ears, cheek ruffs - on a muscular, hunched predator body (heavy shoulders/forearms)
#  * snarling muzzle: lips drawn back, exposed gums, long fangs
#  * coat painted as vertex data for real-time SHELL FUR in three.js (no UV seams):
#      RGB = coat colour (grey back, white chin/chest/belly, pale ear fringe, blood, dirt)
#      A   = fur length (1 = tufts / ruffs, ~0.6 coat, 0 = bare: nose, lips, palms, mange)
#  * higher sculpt resolution; extra aggressive clips: snarl, charge, lunge
import math, os, random
import bpy, bmesh
from mathutils import Vector, Quaternion, Matrix, noise
import ns_lib, ns_koala
from ns_lib import material, collection

R = math.radians


def build_body(coll):
    mb = bpy.data.metaballs.new('koala_meta')
    mb.resolution = 0.0115; mb.render_resolution = 0.0115; mb.threshold = 0.25
    K = 1.32
    ob = bpy.data.objects.new('koala_meta', mb); coll.objects.link(ob)

    def ell(c, sx, sy, sz, r=1.0, neg=False, rot=None, stiff=2.0, k=K):
        e = mb.elements.new(type='ELLIPSOID'); e.co = c; e.radius = r
        e.size_x, e.size_y, e.size_z = sx * k, sy * k, sz * k; e.use_negative = neg; e.stiffness = stiff
        if rot is not None: e.rotation = rot
        return e

    def ball(c, r, neg=False, stiff=2.0, k=K):
        e = mb.elements.new(type='BALL'); e.co = c; e.radius = r * k; e.use_negative = neg; e.stiffness = stiff
        return e

    def cap(a, b, r, stiff=2.0, k=K):
        a, b = Vector(a), Vector(b); d = b - a
        e = mb.elements.new(type='CAPSULE'); e.co = (a + b) / 2; e.radius = r * k; e.size_x = d.length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized()); e.stiffness = stiff
        return e

    # --- torso: hunched, heavy shoulders, lean waist (predator, not a plush toy)
    ell((0, 0.03, 0.98), 0.18, 0.14, 0.12, stiff=2.2)                  # pelvis
    ell((0, -0.02, 1.18), 0.165, 0.13, 0.19)                           # abdomen (lean)
    ell((0, -0.1, 1.4), 0.235, 0.17, 0.15)                             # deep chest
    ell((0, 0.05, 1.47), 0.2, 0.14, 0.11)                              # back hump / traps
    for sx in (-1, 1):
        ell((sx * 0.17, -0.06, 1.5), 0.12, 0.11, 0.1)                  # shoulder mass
        ell((sx * 0.1, -0.2, 1.38), 0.09, 0.05, 0.08)                  # pectorals
        ell((sx * 0.19, -0.13, 1.2), 0.04, 0.05, 0.08, neg=True, stiff=1.2)   # gaunt flank hollows
    for i in range(7):                                                  # spine ridge
        t = i / 6; ball((0, 0.13 - 0.04 * t, 1.0 + 0.5 * t), 0.04, stiff=3)
    # --- neck: thick, forward
    cap((0, -0.14, 1.5), (0, -0.3, 1.68), 0.1)
    # --- head: koala anatomy
    ell((0, -0.37, 1.79), 0.195, 0.16, 0.15)                            # broad flat cranium
    ell((0, -0.33, 1.86), 0.17, 0.12, 0.08)                             # flat crown
    for sx in (-1, 1):
        ell((sx * 0.14, -0.4, 1.72), 0.09, 0.08, 0.085)                 # cheek ruffs
        ell((sx * 0.06, -0.505, 1.835), 0.06, 0.03, 0.022, rot=Quaternion((0, 1, 0), sx * 0.35), stiff=3)   # scowling brow
        ball((sx * 0.083, -0.505, 1.795), 0.026, neg=True, stiff=3)     # small deep-set eye sockets
    ell((0, -0.552, 1.755), 0.058, 0.045, 0.11, stiff=3)                # huge spoon nose (leathery), tall
    ell((0, -0.53, 1.69), 0.075, 0.06, 0.035, stiff=2.5)                # upper lip / muzzle
    ell((0, -0.47, 1.6), 0.1, 0.09, 0.045)                              # heavy lower jaw
    ell((0, -0.535, 1.648), 0.085, 0.075, 0.03, neg=True, stiff=3)      # snarl: open mouth cavity
    for sx in (-1, 1):
        ell((sx * 0.07, -0.54, 1.66), 0.03, 0.04, 0.026, neg=True, stiff=3)   # lips pulled back at the corners
    # --- ears: big, round, set high and wide; the left one torn
    for sx, torn in ((1, False), (-1, True)):
        ell((sx * 0.215, -0.31, 1.9), 0.13, 0.05, 0.12, rot=Quaternion((0, 1, 0), -sx * 0.35))
        if torn: ball((sx * 0.3, -0.31, 1.98), 0.045, neg=True, stiff=3)
    # --- arms: powerful, long, clawed
    for sx in (-1, 1):
        cap((sx * 0.1, -0.11, 1.5), (sx * 0.27, -0.14, 1.48), 0.085)
        cap((sx * 0.27, -0.14, 1.48), (sx * 0.4, -0.1, 1.1), 0.088)     # thick upper arm
        ball((sx * 0.4, -0.1, 1.1), 0.072, stiff=2.5)
        cap((sx * 0.4, -0.1, 1.1), (sx * 0.46, -0.18, 0.74), 0.07)      # heavy forearm
        ell((sx * 0.47, -0.205, 0.655), 0.065, 0.055, 0.09)             # big hands
        for k, (dx, dy) in enumerate(((0.025, -0.04), (0.0, -0.005), (-0.025, 0.03), (-0.05, -0.065), (-0.055, -0.03))):
            base = Vector((sx * (0.475 + dx * 0.8), -0.215 + dy * 0.8, 0.645))      # rooted inside the hand
            tip = base + Vector((sx * 0.01, -0.035, -0.18 if k < 3 else -0.12))
            cap(base, tip, 0.021, stiff=3)
    # --- legs: thick thighs, digitigrade, big feet
    for sx in (-1, 1):
        cap((sx * 0.14, 0.02, 0.97), (sx * 0.18, -0.14, 0.55), 0.11)
        ball((sx * 0.18, -0.14, 0.55), 0.075)
        cap((sx * 0.18, -0.14, 0.55), (sx * 0.18, 0.06, 0.12), 0.068)
        ell((sx * 0.185, -0.07, 0.06), 0.07, 0.15, 0.05)
        for k in range(3):
            base = Vector((sx * (0.155 + k * 0.026), -0.19, 0.04))
            cap(base, base + Vector((0, -0.07, -0.01)), 0.02, stiff=3)

    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    body = bpy.context.view_layer.objects.active; body.name = 'koala_body'
    for m in list(bpy.data.metaballs):
        if m.users == 0: bpy.data.metaballs.remove(m)
    return body


def finish_body(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True)
    ns_koala.remove_loose(body)
    tex = bpy.data.textures.new('koala_muscle', 'CLOUDS'); tex.noise_scale = 0.05; tex.noise_depth = 2
    d = body.modifiers.new('clump', 'DISPLACE'); d.texture = tex; d.strength = 0.012; d.mid_level = 0.5
    s = body.modifiers.new('smooth', 'SMOOTH'); s.factor = 0.5; s.iterations = 3
    bpy.ops.object.modifier_apply(modifier='clump'); bpy.ops.object.modifier_apply(modifier='smooth')
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    target = 22000
    if tris > target:
        dm = body.modifiers.new('dec', 'DECIMATE'); dm.ratio = target / tris
        bpy.ops.object.modifier_apply(modifier='dec')
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')


def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)


def paint_coat(body, nose_idx, gum_idx):
    me = body.data
    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    cols = []
    for v in me.vertices:
        x, y, z = v.co; p = Vector((x, y, z)); ax = abs(x)
        n = noise.noise(p * 7.0); n2 = noise.noise(Vector((x * 28, y * 28, z * 5)))
        grey = 0.33 + 0.07 * n                                           # koala grey, a little brown in it
        c = Vector((grey * 1.04, grey, grey * 0.95))
        # pale fur: chin, throat, chest, belly, inner arms; ear fringe
        front = smooth01(-0.05, -0.16, y)
        pale = 0.0
        if 0.95 < z < 1.62: pale = max(pale, front * (1 - smooth01(0.1, 0.17, ax)))
        if 1.55 < z < 1.7 and y < -0.38: pale = max(pale, 0.8 * (1 - smooth01(0.06, 0.12, ax)))      # chin
        ear = smooth01(0.13, 0.2, ax) * smooth01(1.8, 1.86, z)
        pale = max(pale, ear * smooth01(-0.31, -0.36, y) * 0.9)
        c = c.lerp(Vector((0.74, 0.71, 0.66)), pale * 0.9)
        # muzzle darker
        dm = (p - Vector((0, -0.52, 1.7))).length
        c *= 0.7 + 0.3 * smooth01(0.06, 0.16, dm)
        # fur length
        length = 0.62 + 0.12 * n
        length = max(length, 0.95 * ear)                                  # ear tufts
        cheek = smooth01(0.1, 0.17, ax) * smooth01(1.62, 1.68, z) * (1 - smooth01(1.82, 1.9, z))
        length = max(length, 0.9 * cheek)                                 # cheek ruffs
        length = max(length, 0.85 * smooth01(1.42, 1.5, z) * smooth01(0.0, 0.08, y))   # mane on the hump
        if dm < 0.11: length *= smooth01(0.06, 0.11, dm)                  # bare nose/lips
        for sx in (-1, 1):
            de = (p - Vector((sx * 0.083, -0.5, 1.795))).length
            if de < 0.05: length *= smooth01(0.025, 0.05, de)             # bare ring around the eyes
        if ax > 0.4 and z < 0.78: length *= 0.25                          # hands
        if z < 0.13: length *= 0.3                                        # feet
        mange = noise.noise(p * 5 + Vector((3.1, 0, 0)))
        if mange > 0.42 and 0.4 < z < 1.45:                               # mange: bare grey skin patches
            m = smooth01(0.42, 0.55, mange); length *= 1 - 0.9 * m
            c = c.lerp(Vector((0.28, 0.24, 0.23)), m * 0.8)
        # blood: mouth, chin, chest drips, forearms, claws
        blood = 1 - smooth01(0.05, 0.16, (p - Vector((0, -0.52, 1.64))).length)
        if y < -0.08 and 1.0 < z < 1.62 and ax < 0.17:
            blood = max(blood, min(1, max(0, n2 * 1.6 + 0.15) * (1 - ax / 0.17) * min(1, (1.62 - z) * 3) * 1.4))
        if ax > 0.36 and z < 0.98: blood = max(blood, min(1, (0.98 - z) * 2.0 + n * 0.3))
        sp = noise.noise(Vector((x * 6 + 3, y * 6, z * 6)))
        if sp > 0.38: blood = max(blood, min(1, (sp - 0.38) * 4))
        blood = max(0.0, min(1.0, blood))
        c = c.lerp(Vector((0.36, 0.015, 0.01)), blood * 0.92)
        length *= 1 - 0.45 * blood                                         # blood mats the fur down
        lin = lambda u: max(0.0, u) ** 2.2                                # attribute is linear; values above are sRGB
        cols.append((lin(c.x), lin(c.y), lin(c.z), max(0.0, min(1.0, length))))
    flat = [v for col in cols for v in col]
    ca.data.foreach_set('color', flat)
    me.color_attributes.active_color = ca
    # glTF drops colour alpha: fur length also goes out as a custom attribute (exported as _FURLEN)
    fl = me.attributes.new('_furlen', 'FLOAT', 'POINT')
    fl.data.foreach_set('value', [c[3] for c in cols])
    # materials by region: leathery nose + lips, red gums inside the snarl
    for poly in me.polygons:
        c = poly.center
        if (c - Vector((0, -0.56, 1.75))).length < 0.08: poly.material_index = nose_idx
        elif (c - Vector((0, -0.535, 1.655))).length < 0.075 and c.y < -0.5: poly.material_index = gum_idx


def accessory_meshes(coll, mats):
    parts = [p for p in ns_koala.accessory_meshes(coll, mats) if not p.name.startswith('teeth')]
    # replace the teeth: long fangs at the corners, a crowded irregular row between
    def cone(bm, base, direction, length, r, segs=6, bend=None):
        direction = Vector(direction).normalized()
        up = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((1, 0, 0))
        u = direction.cross(up).normalized(); w = direction.cross(u).normalized()
        rings = []
        for s in range(5):
            t = s / 4; c = Vector(base) + direction * length * t + (Vector(bend) * t * t if bend else Vector())
            rr = r * (1 - t) ** 0.8 + 0.0006
            rings.append([bm.verts.new(c + (u * math.cos(a) + w * math.sin(a)) * rr) for a in [i / segs * math.tau for i in range(segs)]])
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(segs): bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
        bm.faces.new(list(reversed(rings[0])))
    def obj(bm, name, mat, group):
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
        o = bpy.data.objects.new(name, me); coll.objects.link(o)
        o.vertex_groups.new(name=group).add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        for p in me.polygons: p.use_smooth = True
        me.uv_layers.new(name='UVMap'); parts.append(o); return o
    rnd = random.Random(11)
    bm = bmesh.new()
    for i in range(12):
        t = i / 11 * 2 - 1; x = t * 0.07; y = -0.56 + 0.04 * t * t
        fang = abs(t) > 0.75
        ln = 0.075 if fang else 0.025 + rnd.random() * 0.025
        cone(bm, (x, y, 1.675), (rnd.uniform(-0.15, 0.15), -0.12, -1), ln, (0.011 if fang else 0.007) + rnd.random() * 0.002, bend=(0, 0.012 if fang else 0, 0))
    obj(bm, 'teeth_upper', mats['teeth'], 'head')
    bm = bmesh.new()
    for i in range(11):
        t = i / 10 * 2 - 1; x = t * 0.062; y = -0.535 + 0.045 * t * t
        fang = abs(t) > 0.7
        cone(bm, (x, y, 1.618), (rnd.uniform(-0.15, 0.15), -0.18, 1), 0.06 if fang else 0.022 + rnd.random() * 0.02, 0.01 if fang else 0.0065)
    obj(bm, 'teeth_lower', mats['teeth'], 'jaw')
    # gums: wet red ridges the teeth sit in
    bm = bmesh.new()
    for (zc, yc, grp) in ((1.678, -0.555, 'head'), (1.62, -0.53, 'jaw')):
        pts = [Vector((t * 0.075, yc + 0.045 * t * t, zc)) for t in [i / 10 * 2 - 1 for i in range(11)]]
        for a, b in zip(pts[:-1], pts[1:]):
            mid = (a + b) / 2
            bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=1.0, matrix=Matrix.Translation(mid) @ Matrix.Diagonal((0.012, 0.011, 0.008, 1)))
    obj(bm, 'gums', mats['gum'], 'head')
    return parts


# ----------------------------------------------------------------------------- aggressive clips
def keys_snarl():
    """standing threat: shoulders up, head low and forward, lips working, jaw snapping"""
    base = ns_koala.sym(ns_koala.merge(ns_koala.anim_idle(0.0), spine1=(18, None, None), chest=(12, None, None),
                                       neck=(-24, None, None), head=(-6, None, None), jaw=(12, None, None)),
                        clavicle_both=(-10, 0, 0), upperarm_both=(28, 0, 22), forearm_both=(38, 0, 0), fingers_both=(45, 0, 0))
    open_ = ns_koala.merge(base, jaw=(26, None, None), head=(-10, None, 4))
    snap = ns_koala.merge(base, jaw=(6, None, None), head=(-2, None, -3))
    shake = lambda s: ns_koala.merge(base, head=(-8, s * 6, s * 9), jaw=(20, None, None))
    return [ns_koala.K(0.0, base, 'SINE', 'EASE_IN_OUT'), ns_koala.K(0.22, open_, 'EXPO', 'EASE_IN'),
            ns_koala.K(0.3, snap, 'BACK', 'EASE_OUT'), ns_koala.K(0.42, base, 'LINEAR'),
            ns_koala.K(0.5, shake(1), 'LINEAR'), ns_koala.K(0.55, shake(-1), 'LINEAR'), ns_koala.K(0.6, shake(1), 'LINEAR'),
            ns_koala.K(0.66, open_, 'SINE', 'EASE_IN_OUT'), ns_koala.K(1.0, base)]


def charge_pose(t):
    p, loc = ns_koala.anim_chase(t)
    p['spine1'][0] += R(14); p['chest'][0] += R(10); p['neck'][0] -= R(22); p['head'][0] -= R(8)
    p['jaw'][0] = R(34 + 10 * math.sin(t * 12.566))
    for s, sg in (('L', 1), ('R', -1)):
        p['upperarm.' + s][0] += R(35); p['fingers.' + s][0] = R(55)
    loc['hips'] = (loc.get('hips', (0, 0, 0))[0], loc.get('hips', (0, 0, 0))[1] - 0.06, loc.get('hips', (0, 0, 0))[2])
    return p, loc


def keys_lunge():
    crouch = ns_koala.sym(ns_koala.merge(ns_koala.anim_idle(0.0), spine1=(34, None, None), neck=(-30, None, None), jaw=(14, None, None),
                                         hips_loc=(0, -0.2, -0.06)), upperarm_both=(20, 0, 30), thigh_both=(40, 0, 0), shin_both=(-60, 0, 0))
    air = ns_koala.sym(ns_koala.merge(ns_koala.anim_idle(0.0), spine1=(22, None, None), chest=(10, None, None), neck=(-34, None, None),
                                      head=(-18, None, None), jaw=(55, None, None), hips_loc=(0, -0.05, 0.3)),
                       upperarm_both=(150, 0, 45), forearm_both=(15, 0, 0), fingers_both=(-25, 0, 0), thigh_both=(-10, 0, 0))
    strike = ns_koala.sym(ns_koala.merge(air, spine1=(46, None, None), jaw=(30, None, None), hips_loc=(0, -0.05, 0.1)),
                          upperarm_both=(40, 0, 20), forearm_both=(5, 0, 0), fingers_both=(60, 0, 0))
    return [ns_koala.K(0.0, ns_koala.anim_idle(0.0), 'QUAD', 'EASE_OUT'), ns_koala.K(0.22, crouch, 'EXPO', 'EASE_OUT'),
            ns_koala.K(0.42, air, 'EXPO', 'EASE_IN'), ns_koala.K(0.55, strike, 'BACK', 'EASE_OUT'),
            ns_koala.K(0.8, strike, 'SINE', 'EASE_IN_OUT'), ns_koala.K(1.0, ns_koala.anim_chase(0.0))]


def stalk_pose(t):
    """search / stalking gait: low and deliberate, the head held level and still while the body rolls
    under it (a predator keeping its eyes on one spot), a slow open-close of the jaw"""
    p, loc = ns_koala.walk_cycle(t, 0.7, 32, 0.6)
    p['neck'][0] -= R(14); p['head'][0] = R(6 - 2 * ns_koala.S(t * 2))       # head counter-rotates: stabilised
    p['head'][1] = R(-4 * ns_koala.S(t)); p['head'][2] = R(-2 * ns_koala.S(t))
    p['jaw'][0] = R(9 + 5 * max(0, ns_koala.S(t)))
    for s in 'LR':
        p['fingers.' + s][0] = R(48)                                          # claws half-closed, ready
    h = loc.get('hips', (0, 0, 0)); loc['hips'] = (h[0], h[1] - 0.11 + 0.012 * abs(ns_koala.S(t)), h[2])
    return p, loc


def keys_sniff():
    """head down to the air at a door seam: quick CONSTANT sniffs, a still beat, then the head comes up
    with a BACK overshoot - it heard something"""
    idle = ns_koala.anim_idle(0.0)
    low = ns_koala.merge(idle, spine1=(28, None, None), chest=(14, None, None), neck=(-28, None, None), head=(20, None, None), jaw=(5, None, None))
    s1 = ns_koala.merge(low, head=(24, 5, 3)); s2 = ns_koala.merge(low, head=(21, -4, -2))
    up = ns_koala.merge(idle, spine1=(10, None, None), neck=(-6, None, None), head=(-12, 16, 12), jaw=(14, None, None))
    return [ns_koala.K(0.0, idle, 'SINE', 'EASE_IN_OUT'), ns_koala.K(0.2, low, 'LINEAR'),
            ns_koala.K(0.26, s1, 'CONSTANT'), ns_koala.K(0.31, s2, 'CONSTANT'), ns_koala.K(0.36, s1, 'CONSTANT'),
            ns_koala.K(0.41, s2, 'CONSTANT'), ns_koala.K(0.46, low, 'SINE', 'EASE_IN_OUT'),
            ns_koala.K(0.62, low, 'EXPO', 'EASE_OUT'), ns_koala.K(0.7, up, 'BACK', 'EASE_OUT'),
            ns_koala.K(0.86, up, 'SINE', 'EASE_IN_OUT'), ns_koala.K(1.0, idle)]


def keys_twitch():
    """mid-chase stutter: the body freezes, the head jerks in stop-motion (CONSTANT keys, nothing in
    between), one snap to the side with overshoot - then back into the chase pose"""
    base = ns_koala.anim_chase(0.0)
    return [ns_koala.K(0.0, base, 'CONSTANT'), ns_koala.K(0.1, ns_koala.jitter(base, 3, 20), 'CONSTANT'),
            ns_koala.K(0.2, ns_koala.jitter(base, 9, 26), 'CONSTANT'), ns_koala.K(0.28, ns_koala.jitter(base, 15, 18), 'EXPO', 'EASE_OUT'),
            ns_koala.K(0.4, ns_koala.merge(base, head=(None, 68, -30), neck=(None, 20, None)), 'BACK', 'EASE_OUT'),
            ns_koala.K(0.66, ns_koala.merge(base, head=(None, 62, -24), neck=(None, 18, None)), 'CUBIC', 'EASE_IN'),
            ns_koala.K(1.0, base)]


def export_glb(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_image_format='WEBP',
                              export_cameras=False, export_lights=False, export_animations=True, export_extras=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True,
                              export_def_bones=False, export_skins=True, export_attributes=True)
    return os.path.getsize(path)


def build(export=True):
    ns_koala.ANIMS_KEYED.update({
        'koala_snarl': (keys_snarl, 1.9, True),
        'koala_charge': (lambda: ns_koala.keys_gait(charge_pose), 0.5, True),
        'koala_lunge': (keys_lunge, 0.95, False),
        'koala_stalk': (lambda: ns_koala.keys_gait(stalk_pose), 1.7, True),
        'koala_sniff': (keys_sniff, 2.2, False),
        'koala_twitch': (keys_twitch, 0.75, False),
    })
    ns_lib.reset_scene()
    coll = collection('KOALA')
    mats = {
        'fur': material('M_koala_fur', color=(1, 1, 1), rough=0.92, vcol=True),
        'nose': material('M_koala_skin', color=(0.03, 0.025, 0.025), nrm='skin_nrm', rough=0.22),
        'gum': material('M_koala_gum', color=(0.32, 0.03, 0.04), rough=0.2),
        'claw': material('M_koala_claw', color=(0.13, 0.1, 0.07), rough=0.3),
        'teeth': material('M_koala_teeth', color=(0.55, 0.47, 0.32), rough=0.35),
        'eye': material('M_koala_eye', color=(0.01, 0.006, 0.004), rough=0.03),
    }
    body = build_body(coll)
    finish_body(body)
    for k in ('fur', 'nose', 'gum'): body.data.materials.append(mats[k])
    paint_coat(body, 1, 2)
    parts = accessory_meshes(coll, mats)
    for p in parts:
        ca = p.data.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', [1.0, 1.0, 1.0, 0.0] * len(p.data.vertices))     # no fur on accessories
        p.data.attributes.new('_furlen', 'FLOAT', 'POINT')
    rig = ns_koala.build_armature(coll)
    body = ns_koala.skin(body, parts, rig)
    tracks = ns_koala.build_actions_keyed(rig)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    st = {'tris': tris, 'verts': len(body.data.vertices), 'actions': tracks}
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'koala.glb')
        st['bytes'] = export_glb(path)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Characters', 'koala.blend'))
    return st
