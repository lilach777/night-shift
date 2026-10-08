# NIGHT SHIFT â€” the Bloody Koala: sculpted metaball body, claws, teeth, eyes,
# blood vertex paint, armature, automatic weights and 15 hand-keyed animations.
# Exports public/assets/models/koala.glb. Blender space: Z up, creature faces -Y.
import math, os, random
import bpy, bmesh
import mathutils
from mathutils import Vector, Quaternion, Matrix, noise
import ns_lib
from ns_lib import material, collection

FPS = 30

BONES = {
    # name: (head, tail, parent, z-align vector)
    'root': ((0, 0, 0), (0, 0, 0.25), None, (0, -1, 0)),
    'hips': ((0, 0.02, 0.98), (0, -0.02, 1.18), 'root', (0, -1, 0)),
    'spine1': ((0, -0.02, 1.18), (0, -0.1, 1.38), 'hips', (0, -1, 0)),
    'chest': ((0, -0.1, 1.38), (0, -0.2, 1.55), 'spine1', (0, -1, 0)),
    'neck': ((0, -0.2, 1.55), (0, -0.3, 1.67), 'chest', (0, -1, 0)),
    'head': ((0, -0.3, 1.67), (0, -0.34, 1.95), 'neck', (0, -1, 0)),
    'jaw': ((0, -0.34, 1.69), (0, -0.52, 1.6), 'head', (0, 0, -1)),
    'ear.L': ((0.13, -0.32, 1.86), (0.29, -0.3, 1.98), 'head', (0, -1, 0)),
    'ear.R': ((-0.13, -0.32, 1.86), (-0.26, -0.3, 1.95), 'head', (0, -1, 0)),
    'clavicle.L': ((0.05, -0.12, 1.5), (0.26, -0.14, 1.48), 'chest', (0, -1, 0)),
    'clavicle.R': ((-0.05, -0.12, 1.5), (-0.26, -0.14, 1.48), 'chest', (0, -1, 0)),
    'upperarm.L': ((0.26, -0.14, 1.48), (0.4, -0.1, 1.1), 'clavicle.L', (0, -1, 0)),
    'upperarm.R': ((-0.26, -0.14, 1.48), (-0.4, -0.1, 1.1), 'clavicle.R', (0, -1, 0)),
    'forearm.L': ((0.4, -0.1, 1.1), (0.46, -0.18, 0.74), 'upperarm.L', (0, -1, 0)),
    'forearm.R': ((-0.4, -0.1, 1.1), (-0.46, -0.18, 0.74), 'upperarm.R', (0, -1, 0)),
    'hand.L': ((0.46, -0.18, 0.74), (0.48, -0.22, 0.6), 'forearm.L', (0, -1, 0)),
    'hand.R': ((-0.46, -0.18, 0.74), (-0.48, -0.22, 0.6), 'forearm.R', (0, -1, 0)),
    'fingers.L': ((0.48, -0.22, 0.6), (0.49, -0.28, 0.44), 'hand.L', (0, -1, 0)),
    'fingers.R': ((-0.48, -0.22, 0.6), (-0.49, -0.28, 0.44), 'hand.R', (0, -1, 0)),
    'thigh.L': ((0.15, 0.02, 0.96), (0.18, -0.14, 0.55), 'hips', (0, -1, 0)),
    'thigh.R': ((-0.15, 0.02, 0.96), (-0.18, -0.14, 0.55), 'hips', (0, -1, 0)),
    'shin.L': ((0.18, -0.14, 0.55), (0.18, 0.06, 0.12), 'thigh.L', (0, -1, 0)),
    'shin.R': ((-0.18, -0.14, 0.55), (-0.18, 0.06, 0.12), 'thigh.R', (0, -1, 0)),
    'foot.L': ((0.18, 0.06, 0.12), (0.19, -0.16, 0.03), 'shin.L', (0, 0, 1)),
    'foot.R': ((-0.18, 0.06, 0.12), (-0.19, -0.16, 0.03), 'shin.R', (0, 0, 1)),
}


# ----------------------------------------------------------------------------- body sculpt
def build_body(coll):
    mb = bpy.data.metaballs.new('koala_meta')
    mb.resolution = 0.016
    mb.render_resolution = 0.016
    mb.threshold = 0.25
    K = 1.32   # body bulk factor (visible radius ~0.87 x nominal at threshold 0.25)
    KH = 1.12  # head features
    ob = bpy.data.objects.new('koala_meta', mb)
    coll.objects.link(ob)

    def ell(c, sx, sy, sz, r=1.0, neg=False, rot=None, stiff=2.0, k=None):
        k = K if k is None else k
        e = mb.elements.new(type='ELLIPSOID')
        e.co = c; e.radius = r; e.size_x = sx * k; e.size_y = sy * k; e.size_z = sz * k
        e.use_negative = neg; e.stiffness = stiff
        if rot is not None:
            e.rotation = rot
        return e

    def ball(c, r, neg=False, stiff=2.0, k=None):
        k = K if k is None else k
        e = mb.elements.new(type='BALL'); e.co = c; e.radius = r * k; e.use_negative = neg; e.stiffness = stiff
        return e

    def cap(a, b, r, stiff=2.0, k=None):
        k = K if k is None else k
        r = r * k
        a = Vector(a); b = Vector(b)
        d = b - a
        e = mb.elements.new(type='CAPSULE')
        e.co = (a + b) / 2
        e.radius = r
        e.size_x = d.length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = stiff
        return e

    # torso â€” gaunt, hunched, uneven
    ell((0, 0.03, 0.98), 0.17, 0.13, 0.11, stiff=2.2)                # pelvis
    ell((0, -0.03, 1.2), 0.17, 0.13, 0.2)                             # abdomen
    ell((0, -0.1, 1.42), 0.21, 0.16, 0.13)                            # chest
    ell((0.02, 0.06, 1.46), 0.16, 0.12, 0.1)                          # hump
    ell((0.07, 0.06, 1.52), 0.08, 0.07, 0.06)                         # asymmetric shoulder hump
    ell((0, -0.2, 1.14), 0.12, 0.05, 0.09, neg=True, stiff=1.5)       # hollow belly
    for i in range(7):                                                 # spine ridge
        t = i / 6
        ball((0, 0.12 - 0.04 * t + 0.03 * math.sin(t * 3), 1.0 + 0.5 * t), 0.045, stiff=3)
    for sx in (-1, 1):                                                 # sunken flanks
        ell((sx * 0.2, -0.12, 1.22), 0.05, 0.05, 0.09, neg=True, stiff=1.2)
    # neck + head
    cap((0, -0.16, 1.5), (0, -0.3, 1.68), 0.085)
    ell((0, -0.36, 1.77), 0.16, 0.13, 0.13)                            # cranium
    for sx in (-1, 1):
        ell((sx * 0.09, -0.42, 1.72), 0.075, 0.07, 0.065, k=KH)              # cheeks
    ell((0, -0.5, 1.84), 0.12, 0.035, 0.03, stiff=3, k=KH)                   # heavy brow
    ell((0, -0.53, 1.745), 0.05, 0.05, 0.075, stiff=3, k=KH)                 # bulbous nose
    ell((0, -0.44, 1.6), 0.095, 0.085, 0.04, k=KH)                           # lower jaw
    ell((0, -0.52, 1.655), 0.07, 0.06, 0.022, neg=True, stiff=3, k=KH)      # open mouth cavity
    for sx in (-1, 1):
        ball((sx * 0.072, -0.5, 1.79), 0.032, neg=True, stiff=3, k=KH)       # sunken eye sockets
    # ears â€” left large and ragged, right torn
    ell((0.17, -0.33, 1.87), 0.13, 0.05, 0.12, rot=Quaternion((0, 1, 0), -0.5), k=KH)
    ell((0.23, -0.32, 1.93), 0.07, 0.04, 0.06, k=KH)
    ell((-0.15, -0.33, 1.86), 0.1, 0.045, 0.085, rot=Quaternion((0, 1, 0), 0.6), k=KH)
    ball((-0.21, -0.32, 1.92), 0.04, neg=True, stiff=3, k=KH)
    # arms (long, thin, knotted joints)
    for sx in (-1, 1):
        cap((sx * 0.08, -0.12, 1.5), (sx * 0.26, -0.14, 1.48), 0.075)
        cap((sx * 0.26, -0.14, 1.48), (sx * 0.4, -0.1, 1.1), 0.07)
        ball((sx * 0.4, -0.1, 1.1), 0.065, stiff=2.5)
        cap((sx * 0.4, -0.1, 1.1), (sx * 0.46, -0.18, 0.74), 0.052)
        ell((sx * 0.47, -0.2, 0.67), 0.045, 0.035, 0.07)
        # five digits: three fingers + two opposable thumbs (true koala anatomy, but wrong)
        for k, (dx, dy) in enumerate(((0.02, -0.035), (0.0, -0.005), (-0.02, 0.025), (-0.045, -0.06), (-0.05, -0.03))):
            base = Vector((sx * (0.48 + dx), -0.22 + dy, 0.6))
            tip = base + Vector((sx * 0.01, -0.03, -0.13 if k < 3 else -0.08))
            cap(base, tip, 0.017, stiff=3)
    # legs (bent, digitigrade)
    for sx in (-1, 1):
        cap((sx * 0.14, 0.02, 0.97), (sx * 0.18, -0.14, 0.55), 0.095)
        ball((sx * 0.18, -0.14, 0.55), 0.07)
        cap((sx * 0.18, -0.14, 0.55), (sx * 0.18, 0.06, 0.12), 0.062)
        ell((sx * 0.185, -0.06, 0.06), 0.06, 0.13, 0.045)
        for k in range(3):
            base = Vector((sx * (0.16 + k * 0.022), -0.17, 0.04))
            cap(base, base + Vector((0, -0.06, -0.01)), 0.018, stiff=3)

    # convert
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    body = bpy.context.view_layer.objects.active
    body.name = 'koala_body'
    # clean metaball leftovers
    for m in list(bpy.data.metaballs):
        if m.users == 0:
            bpy.data.metaballs.remove(m)
    return body


def remove_loose(body, min_verts=150):
    bm = bmesh.new(); bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    seen = set(); kill = []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp = []; stack = [v]; seen.add(v.index)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index); stack.append(o)
        if len(comp) < min_verts:
            kill.extend(comp)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(body.data); bm.free()
    return len(kill)


def finish_body(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True)
    remove_loose(body)
    # lumpy matted fur silhouette
    tex = bpy.data.textures.new('koala_clump', 'CLOUDS')
    tex.noise_scale = 0.035
    tex.noise_depth = 2
    d = body.modifiers.new('clump', 'DISPLACE'); d.texture = tex; d.strength = 0.022; d.mid_level = 0.5
    s = body.modifiers.new('smooth', 'SMOOTH'); s.factor = 0.5; s.iterations = 2
    bpy.ops.object.modifier_apply(modifier='clump')
    bpy.ops.object.modifier_apply(modifier='smooth')
    # decimate to game budget
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    target = 11000
    if tris > target:
        dm = body.modifiers.new('dec', 'DECIMATE'); dm.ratio = target / tris
        bpy.ops.object.modifier_apply(modifier='dec')
    bpy.ops.object.shade_smooth()
    # UVs
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    # scale UVs up so fur texture is dense (tiles)
    uv = body.data.uv_layers.active.data
    for l in uv:
        l.uv = (l.uv[0] * 6.0, l.uv[1] * 6.0)


def paint_blood(body, nose_mat_index):
    me = body.data
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    vcol = []
    for v in me.vertices:
        p = v.co
        x, y, z = p
        c = Vector((1.0, 1.0, 1.0))
        n = noise.noise(Vector((x * 9, y * 9, z * 9)))
        n2 = noise.noise(Vector((x * 30, y * 30, z * 4)))   # vertical drips
        blood = 0.0
        # mouth, chin and throat
        dm = (Vector((x, y, z)) - Vector((0, -0.5, 1.63))).length
        blood = max(blood, 1 - min(1, max(0, (dm - 0.06) / 0.1)))
        # drips down the chest from the mouth
        if y < -0.08 and 1.0 < z < 1.6 and abs(x) < 0.18:
            drip = max(0, n2 * 1.6 + 0.15) * (1 - abs(x) / 0.18) * min(1, (1.6 - z) * 3)
            blood = max(blood, min(1, drip * 1.4))
        # hands / forearms
        if abs(x) > 0.36 and z < 0.95:
            blood = max(blood, min(1, (0.95 - z) * 2.2 + n * 0.3))
        # feet
        if z < 0.18:
            blood = max(blood, 0.5 + 0.4 * n)
        # random splatter
        sp = noise.noise(Vector((x * 6 + 3, y * 6, z * 6)))
        if sp > 0.35:
            blood = max(blood, min(1, (sp - 0.35) * 4))
        blood = max(0.0, min(1.0, blood))
        # dirt darkening + belly mange
        dirt = 0.85 + 0.25 * n
        c = Vector((dirt, dirt * 0.96, dirt * 0.9))
        c = c.lerp(Vector((0.62, 0.02, 0.015)), blood)
        vcol.append((c.x, c.y, c.z, 1.0))
    data = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            data.extend(vcol[me.loops[li].vertex_index])
    ca.data.foreach_set('color', data)
    # nose / lips / eyelids: leathery skin material by region
    for poly in me.polygons:
        c = poly.center
        if (c - Vector((0, -0.55, 1.745))).length < 0.075 or (c - Vector((0, -0.52, 1.655))).length < 0.06:
            poly.material_index = nose_mat_index


def accessory_meshes(coll, mats):
    """Claws, teeth and eyes as separate objects with a single-bone vertex group each."""
    parts = []

    def obj_from_bm(bm, name, mat, group):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me); bm.free()
        me.materials.append(mat)
        o = bpy.data.objects.new(name, me); coll.objects.link(o)
        vg = o.vertex_groups.new(name=group)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        for p in me.polygons:
            p.use_smooth = True
        uvl = me.uv_layers.new(name='UVMap')
        parts.append(o)
        return o

    def cone(bm, base, direction, length, r, segs=6, bend=None):
        """Curved cone from base along direction (bend = vector added progressively)."""
        direction = Vector(direction).normalized()
        up = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((1, 0, 0))
        u = direction.cross(up).normalized(); w = direction.cross(u).normalized()
        rings = []
        steps = 3
        for s in range(steps + 1):
            t = s / steps
            c = Vector(base) + direction * length * t
            if bend is not None:
                c += Vector(bend) * (t * t)
            rr = r * (1 - t) + 0.0008
            ring = [bm.verts.new(c + (u * math.cos(a) + w * math.sin(a)) * rr) for a in [i / segs * math.tau for i in range(segs)]]
            rings.append(ring)
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(segs):
                bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
        bm.faces.new(list(reversed(rings[0])))

    # claws
    for side, sx in (('L', 1), ('R', -1)):
        bm = bmesh.new()
        for k, (dx, dy) in enumerate(((0.02, -0.035), (0.0, -0.005), (-0.02, 0.025), (-0.045, -0.06), (-0.05, -0.03))):
            base = Vector((sx * (0.48 + dx), -0.22 + dy, 0.6)) + Vector((sx * 0.01, -0.03, -0.13 if k < 3 else -0.08)) * 0.9
            ln = 0.15 if k < 3 else 0.09
            cone(bm, base, (sx * 0.05, -0.25, -1), ln, 0.014, bend=(0, -0.06, 0.0))
        obj_from_bm(bm, 'claws_hand_' + side, mats['claw'], 'fingers.' + side)
        bm = bmesh.new()
        for k in range(3):
            base = Vector((sx * (0.16 + k * 0.022), -0.23, 0.035))
            cone(bm, base, (0, -1, -0.4), 0.07, 0.012, bend=(0, 0, -0.025))
        obj_from_bm(bm, 'claws_foot_' + side, mats['claw'], 'foot.' + side)
    # teeth: upper row (head) and lower row (jaw), irregular
    rnd = random.Random(7)
    bm = bmesh.new()
    for i in range(11):
        t = (i / 10) * 2 - 1
        x = t * 0.06
        y = -0.555 + 0.035 * t * t
        ln = 0.03 + rnd.random() * 0.03 + (0.02 if abs(t) > 0.6 else 0)
        cone(bm, (x, y, 1.678), (rnd.uniform(-0.2, 0.2), -0.15, -1), ln, 0.007 + rnd.random() * 0.004, segs=5)
    obj_from_bm(bm, 'teeth_upper', mats['teeth'], 'head')
    bm = bmesh.new()
    for i in range(10):
        t = (i / 9) * 2 - 1
        x = t * 0.055
        y = -0.53 + 0.04 * t * t
        ln = 0.025 + rnd.random() * 0.03
        cone(bm, (x, y, 1.625), (rnd.uniform(-0.2, 0.2), -0.2, 1), ln, 0.007 + rnd.random() * 0.003, segs=5)
    obj_from_bm(bm, 'teeth_lower', mats['teeth'], 'jaw')
    # eyes
    bm = bmesh.new()
    for sx in (-1, 1):
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.027,
                                  matrix=Matrix.Translation((sx * 0.072, -0.508, 1.79)))
    obj_from_bm(bm, 'eyes', mats['eye'], 'head')
    # tongue (lolling, inside the mouth)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0,
                              matrix=Matrix.Translation((0.01, -0.52, 1.635)) @ Matrix.Diagonal((0.035, 0.06, 0.012, 1)))
    obj_from_bm(bm, 'tongue', mats['nose'], 'jaw')
    return parts


# ----------------------------------------------------------------------------- rig
def build_armature(coll):
    arm = bpy.data.armatures.new('koala_rig')
    ob = bpy.data.objects.new('koala_rig', arm)
    coll.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (h, t, parent, zv) in BONES.items():
        b = arm.edit_bones.new(name)
        b.head = h; b.tail = t
        b.align_roll(Vector(zv))
        eb[name] = b
    for name, (h, t, parent, zv) in BONES.items():
        if parent:
            eb[name].parent = eb[parent]
            eb[name].use_connect = False
    for name in BONES:
        eb[name].use_deform = name != 'root'
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def skin(body, parts, rig):
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    # join accessories (already carry single-bone vertex groups)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'koala_bloody'
    # make sure the armature modifier exists after join
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        m = body.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    # glTF supports at most 4 influences â€” limit & normalise
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return body


# ----------------------------------------------------------------------------- animation
def S(x):
    return math.sin(x * math.tau)


def C(x):
    return math.cos(x * math.tau)


R = math.radians


def pose_rest():
    return {n: [0.0, 0.0, 0.0] for n in BONES}


def anim_idle(t):
    p = pose_rest(); loc = {}
    b = S(t)
    p['spine1'][0] = R(14 + 2 * b); p['chest'][0] = R(12 + 3 * b); p['neck'][0] = R(-10 - 2 * b)
    p['head'][0] = R(-6 + 2 * S(t * 2 + 0.2)); p['head'][2] = R(4 * S(t + 0.3))
    p['jaw'][0] = R(6 + 3 * max(0, b))
    for s, sg in (('L', 1), ('R', -1)):
        p['clavicle.' + s][0] = R(6 + 2 * b)
        p['upperarm.' + s][0] = R(24 + 2 * S(t + 0.1)); p['upperarm.' + s][2] = R(-sg * 4)
        p['forearm.' + s][0] = R(18 + 3 * S(t + 0.2))
        p['fingers.' + s][0] = R(25 + 6 * S(t * 2))
        p['thigh.' + s][0] = R(12); p['shin.' + s][0] = R(-22); p['foot.' + s][0] = R(8)
    loc['hips'] = (0, -0.035 + 0.008 * b, 0)
    return p, loc


def anim_breathe(t):
    p, loc = anim_idle(t)
    b = S(t)
    p['chest'][0] = R(8 + 9 * b); p['spine1'][0] = R(16 + 4 * b)
    p['head'][0] = R(-14 - 6 * b); p['jaw'][0] = R(14 + 10 * max(0, b))
    for s in 'LR':
        p['clavicle.' + s][0] = R(2 + 7 * b)
    loc['hips'] = (0, -0.04 + 0.015 * b, 0)
    return p, loc


def anim_look_around(t):
    p, loc = anim_idle(t)
    # left, hold, right, hold, back â€” with an unnatural over-rotation
    keys = [(0, 0), (0.15, 55), (0.35, 60), (0.5, -70), (0.75, -72), (1.0, 0)]
    for (t0, a0), (t1, a1) in zip(keys[:-1], keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0); u = u * u * (3 - 2 * u)
            yaw = a0 + (a1 - a0) * u
    p['head'][1] = R(yaw * 0.7); p['neck'][1] = R(yaw * 0.3); p['chest'][1] = R(yaw * 0.12)
    p['head'][2] = R(8 * S(t))
    return p, loc


def anim_head_tilt(t):
    p, loc = anim_idle(t)
    u = math.sin(min(1, t / 0.6) * math.pi / 2) if t < 0.85 else 1 - (t - 0.85) / 0.15
    p['head'][2] = R(-75 * u); p['neck'][2] = R(-15 * u); p['head'][0] = R(-6 + 10 * u)
    p['jaw'][0] = R(5 + 12 * u)
    return p, loc


def anim_head_turn(t):
    p, loc = anim_idle(t)
    u = min(1, t / 0.12)  # snap
    p['head'][1] = R(85 * u); p['neck'][1] = R(25 * u); p['head'][2] = R(-10 * u)
    p['chest'][1] = R(6 * u)
    return p, loc


def walk_cycle(t, stride=1.0, hunch=18, arm=1.0):
    p = pose_rest(); loc = {}
    arm_base = hunch * 1.8 + 4    # pitching the torso swings hanging arms back; compensate
    for s, ph, sg in (('L', 0.0, 1), ('R', 0.5, -1)):
        x = t + ph
        p['thigh.' + s][0] = R(14 + 26 * stride * S(x))
        p['shin.' + s][0] = R(-20 - 32 * stride * max(0, S(x + 0.25)))
        p['foot.' + s][0] = R(10 - 18 * stride * S(x + 0.1))
        p['upperarm.' + s][0] = R(arm_base - 22 * arm * S(x))
        p['upperarm.' + s][2] = R(-sg * 6)
        p['forearm.' + s][0] = R(22 + 14 * arm * max(0, S(x + 0.2)))
        p['fingers.' + s][0] = R(30)
        p['clavicle.' + s][0] = R(4 * S(x))
    p['spine1'][0] = R(hunch); p['chest'][0] = R(hunch * 0.8); p['neck'][0] = R(-hunch * 0.9)
    p['spine1'][1] = R(5 * S(t)); p['chest'][1] = R(-7 * S(t))
    p['hips'][1] = R(-6 * S(t)); p['hips'][2] = R(3 * S(t * 2))
    p['head'][0] = R(-8 + 3 * S(t * 2)); p['head'][2] = R(5 * S(t))
    p['jaw'][0] = R(8)
    loc['hips'] = (0, -0.04 + 0.025 * abs(S(t)), 0)
    return p, loc


def anim_walk(t):
    p, loc = walk_cycle(t, 1.0, 20, 0.8)
    p['head'][1] = R(10 * S(t * 0.5))  # lazy head roll â€” animal-like
    return p, loc


def anim_run(t):
    p, loc = walk_cycle(t, 1.7, 26, 1.8)
    p['neck'][0] = R(-32)
    p['jaw'][0] = R(14)
    for s in 'LR':
        p['forearm.' + s][0] = R(40 + 30 * max(0, S(t + (0 if s == 'L' else 0.5) + 0.2)))
    loc['hips'] = (0, -0.08 + 0.06 * abs(S(t)), 0)
    return p, loc


def anim_chase(t):
    p, loc = walk_cycle(t, 1.8, 30, 1.0)
    for s, ph, sg in (('L', 0.0, 1), ('R', 0.5, -1)):
        # arms reaching forward, claws grasping
        p['upperarm.' + s][0] = R(112 + 22 * S(t + ph))
        p['upperarm.' + s][2] = R(-sg * 14)
        p['forearm.' + s][0] = R(15 + 20 * S(t + ph + 0.25))
        p['fingers.' + s][0] = R(10 + 40 * max(0, S(t * 2 + ph)))
    p['neck'][0] = R(-38); p['head'][0] = R(-20); p['jaw'][0] = R(22 + 8 * S(t * 2))
    p['head'][2] = R(9 * S(t * 2))
    loc['hips'] = (0, -0.1 + 0.07 * abs(S(t)), 0)
    return p, loc


def anim_crawl(t):
    p = pose_rest(); loc = {}
    p['hips'][0] = R(70)
    p['spine1'][0] = R(8 + 4 * S(t)); p['chest'][0] = R(6); p['neck'][0] = R(-55); p['head'][0] = R(-30)
    p['head'][2] = R(12 * S(t * 0.5))
    for s, ph, sg in (('L', 0.0, 1), ('R', 0.5, -1)):
        x = t + ph
        # hips pitched 70deg forward swings the legs back; bring thighs under the body
        p['thigh.' + s][0] = R(95 + 28 * S(x))
        p['shin.' + s][0] = R(-95 - 25 * max(0, S(x + 0.25)))
        p['foot.' + s][0] = R(25)
        # torso pitched ~84deg: front limbs reach down to the floor
        p['upperarm.' + s][0] = R(82 + 30 * S(x + 0.5)); p['upperarm.' + s][2] = R(-sg * 10)
        p['forearm.' + s][0] = R(-5 + 25 * max(0, S(x + 0.75)))
        p['hand.' + s][0] = R(-45); p['fingers.' + s][0] = R(-25)
    p['jaw'][0] = R(16)
    loc['hips'] = (0, -0.5 + 0.03 * abs(S(t)), 0.05)
    return p, loc


def anim_observe(t):
    """Hidden / observing: crouched low, gripping, slow head tilts."""
    p = pose_rest(); loc = {}
    b = S(t)
    p['hips'][0] = R(40)
    p['spine1'][0] = R(30); p['chest'][0] = R(15); p['neck'][0] = R(-50); p['head'][0] = R(-25)
    p['head'][2] = R(-30 + 25 * S(t * 0.5)); p['head'][1] = R(10 * S(t * 0.25))
    for s, sg in (('L', 1), ('R', -1)):
        p['thigh.' + s][0] = R(115); p['shin.' + s][0] = R(-135); p['foot.' + s][0] = R(25)
        p['thigh.' + s][2] = R(-sg * 12)
        p['upperarm.' + s][0] = R(100); p['upperarm.' + s][2] = R(sg * 8)
        p['forearm.' + s][0] = R(55); p['fingers.' + s][0] = R(50 + 10 * S(t * 2 + (0 if sg > 0 else 0.5)))
    p['jaw'][0] = R(5 + 4 * max(0, b))
    loc['hips'] = (0, -0.42 + 0.01 * b, 0.08)
    return p, loc


def anim_attack(t):
    p, loc = anim_chase(0.0)
    # wind up (0-0.35), slash (0.35-0.55), follow through
    if t < 0.35:
        u = t / 0.35; a = 100 + 90 * u
    elif t < 0.55:
        u = (t - 0.35) / 0.2; a = 190 - 170 * u
    else:
        u = (t - 0.55) / 0.45; a = 20 + 60 * u
    for s, sg in (('L', 1), ('R', -1)):
        p['upperarm.' + s][0] = R(a); p['upperarm.' + s][2] = R(-sg * 25)
        p['forearm.' + s][0] = R(25 if t < 0.35 else 5)
        p['fingers.' + s][0] = R(60 if t < 0.35 else -10)
    p['spine1'][0] = R(20 + 25 * (1 if 0.35 < t < 0.7 else 0))
    p['jaw'][0] = R(35)
    p['neck'][0] = R(-30); p['head'][0] = R(-15 + 10 * S(t * 3))
    return p, loc


def anim_stagger(t):
    p, loc = anim_idle(0)
    u = math.sin(min(1, t / 0.3) * math.pi / 2) * (1 - max(0, (t - 0.5) / 0.5))
    p['spine1'][0] = R(14 - 30 * u); p['chest'][0] = R(12 - 20 * u); p['head'][0] = R(-6 - 35 * u)
    p['head'][2] = R(25 * u); p['jaw'][0] = R(8 + 25 * u)
    for s, sg in (('L', 1), ('R', -1)):
        p['upperarm.' + s][0] = R(10 + 50 * u); p['upperarm.' + s][2] = R(-sg * 40 * u)
        p['thigh.' + s][0] = R(12 + (20 * u if s == 'L' else -10 * u))
    loc['hips'] = (0, -0.035 - 0.05 * u, 0.12 * u)
    return p, loc


def anim_disappear(t):
    """Folds down into the dark: crouch fast, head drops, arms wrap."""
    p, loc = anim_observe(0.0)
    u = min(1, t / 0.5)
    p['hips'][0] = R(40 + 30 * u); p['neck'][0] = R(-50 + 70 * u); p['head'][0] = R(-25 + 40 * u)
    for s in 'LR':
        p['upperarm.' + s][0] = R(100 + 25 * u); p['forearm.' + s][0] = R(55 + 60 * u)
    loc['hips'] = (0, -0.42 - 0.25 * u, 0.08)
    return p, loc


def anim_jumpscare(t):
    p = pose_rest(); loc = {}
    u = min(1, t / 0.18)
    shake = S(t * 9) * (1 - min(1, t))
    p['spine1'][0] = R(25 * u); p['chest'][0] = R(15 * u); p['neck'][0] = R(-30 * u)
    p['head'][0] = R(-20 * u + 8 * shake); p['head'][2] = R(14 * shake); p['head'][1] = R(6 * shake)
    p['jaw'][0] = R(48 * u)
    for s, sg in (('L', 1), ('R', -1)):
        p['upperarm.' + s][0] = R(125 * u); p['upperarm.' + s][2] = R(-sg * 50 * u)
        p['forearm.' + s][0] = R(20 * u); p['fingers.' + s][0] = R(-20 + 60 * abs(shake))
        p['clavicle.' + s][0] = R(15 * u)
        p['thigh.' + s][0] = R(20); p['shin.' + s][0] = R(-30)
    loc['hips'] = (0, -0.05, 0.25 * u)
    return p, loc


def anim_scream(t):
    p, loc = anim_idle(0)
    if t < 0.25:
        u = t / 0.25; p['head'][0] = R(-6 - 40 * u); p['neck'][0] = R(-10 - 15 * u); p['jaw'][0] = R(10 + 20 * u)
    else:
        u = min(1, (t - 0.25) / 0.15); sh = S(t * 14) * (1 - t)
        p['head'][0] = R(-46 + 55 * u + 6 * sh); p['neck'][0] = R(-25 - 10 * u); p['jaw'][0] = R(30 + 25 * u)
        p['head'][2] = R(8 * sh)
        for s, sg in (('L', 1), ('R', -1)):
            p['upperarm.' + s][0] = R(30 * u); p['upperarm.' + s][2] = R(-sg * 50 * u)
            p['forearm.' + s][0] = R(30 * u); p['fingers.' + s][0] = R(-25 * u)
            p['clavicle.' + s][0] = R(-12 * u)
        p['chest'][0] = R(12 - 20 * u); p['spine1'][0] = R(14 - 10 * u)
    return p, loc


def anim_emerge(t):
    """Clawing up out of the floor (root height is driven in game): claws reach up first,
    hands plant on the floor and push, the torso straightens, the head comes up last."""
    def sm(a, b, x):
        u = min(1.0, max(0.0, (x - a) / (b - a))); return u * u * (3 - 2 * u)
    p, loc = anim_idle(0)
    poses = []
    for key in ('A', 'B', 'C'):
        q = {}
        for s, sg in (('L', 1), ('R', -1)):
            if key == 'A':    # both arms straight up, claws hooked
                q['upperarm.' + s] = (R(168), 0, R(sg * 10)); q['forearm.' + s] = (R(14), 0, 0)
                q['hand.' + s] = (R(-25), 0, 0); q['fingers.' + s] = (R(70), 0, 0)
            elif key == 'B':  # hands planted wide on the floor, pushing
                q['upperarm.' + s] = (R(14), 0, R(sg * 78)); q['forearm.' + s] = (R(26), 0, 0)
                q['hand.' + s] = (R(-62), 0, 0); q['fingers.' + s] = (R(-20), 0, 0)
            else:             # up: arms half spread, claws curling
                q['upperarm.' + s] = (R(30), 0, R(sg * 42)); q['forearm.' + s] = (R(48), 0, 0)
                q['hand.' + s] = (R(-10), 0, 0); q['fingers.' + s] = (R(45), 0, 0)
        body = {'A': (24, 16, -8, 34, 8), 'B': (32, 20, -24, -6, 22), 'C': (10, 2, -28, -2, 34)}[key]
        q['spine1'] = (R(body[0]), 0, 0); q['chest'] = (R(body[1]), 0, 0)
        q['neck'] = (R(body[2]), 0, 0); q['head'] = (R(body[3]), 0, 0); q['jaw'] = (R(body[4]), 0, 0)
        poses.append(q)
    ab, bc = sm(0.26, 0.52, t), sm(0.7, 0.9, t)
    for bn in poses[0]:
        a, b, c = poses[0][bn], poses[1][bn], poses[2][bn]
        v = [a[i] + (b[i] - a[i]) * ab for i in range(3)]
        v = [v[i] + (c[i] - v[i]) * bc for i in range(3)]
        p[bn] = list(v)
    # straining tremor while it drags itself up, a twitch of the head at the end
    tr = S(t * 31) * (1 - bc) * 0.6
    p['chest'][2] += R(3 * tr); p['head'][2] = R(5 * tr + 10 * S(t * 3) * bc)
    return p, loc


# ----------------------------------------------------------------------------- key-pose animation
# Actions authored as KEY POSES with an explicit Blender interpolation per segment (the
# interpolation set on a key applies from that key to the next):
#   BEZIER (auto-clamped handles)  natural, weighted motion
#   SINE / QUAD / CUBIC  + easing  gentle accelerations (breathing, slow creeping tilts)
#   EXPO (ease in)                 a strike that keeps accelerating until impact
#   BACK (ease out)                snap with overshoot and settle (head snaps, lunges)
#   ELASTIC (ease out)             wobbling recoil
#   CONSTANT                       stop-motion jerks/twitches — deliberately unnatural
#   LINEAR                         fast tremors
# Gait loops are keyed at their phases with a CYCLES modifier so the loop seam is smooth.
def merge(base, **over):
    p = {k: list(v) for k, v in base[0].items()}; loc = dict(base[1])
    for k, v in over.items():
        if k == 'hips_loc': loc['hips'] = v; continue
        bn = k.replace('_L', '.L').replace('_R', '.R')
        p[bn] = [R(a) if a is not None else p[bn][i] for i, a in enumerate(v)]
    return p, loc


def sym(base, **over):
    """Apply 'arm=(x,y,z)'-style overrides to both sides (z/y mirrored)."""
    out = {}
    for k, (x, y, z) in over.items():
        if k.endswith('_both'):
            n = k[:-5]
            out[n + '_L'] = (x, y, z)
            out[n + '_R'] = (x, -y if y is not None else None, -z if z is not None else None)
        else:
            out[k] = (x, y, z)
    return merge(base, **out)


def K(t, pose, interp='BEZIER', easing='AUTO'):
    return (t, pose, interp, easing)


def jitter(base, seed, amt=6):
    rnd = __import__('random').Random(seed)
    return merge(base, head=(None, rnd.uniform(-amt, amt), rnd.uniform(-amt, amt)), neck=(None, rnd.uniform(-amt / 2, amt / 2), None),
                 jaw=(base[0]['jaw'][0] / math.radians(1) + rnd.uniform(0, amt), None, None))


def keys_idle():
    a = anim_idle(0.0); b = anim_idle(0.5)
    return [K(0.0, a, 'SINE', 'EASE_IN_OUT'), K(0.5, b, 'SINE', 'EASE_IN_OUT'), K(1.0, a)]


def keys_breathe():
    inh = merge(anim_breathe(0.25), jaw=(26, None, None))
    exh = merge(anim_breathe(0.75), jaw=(10, None, None))
    return [K(0.0, exh, 'SINE', 'EASE_IN_OUT'), K(0.42, inh, 'QUAD', 'EASE_OUT'), K(0.58, inh, 'SINE', 'EASE_IN_OUT'), K(1.0, exh)]


def keys_observe():
    a = anim_observe(0.0); b = anim_observe(0.5)
    tw = merge(a, head=(None, 18, -48))              # a sudden curious twitch, then back
    return [K(0.0, a, 'SINE', 'EASE_IN_OUT'), K(0.4, b, 'CONSTANT'), K(0.62, tw, 'CONSTANT'), K(0.66, b, 'SINE', 'EASE_IN_OUT'), K(1.0, a)]


def keys_look_around():
    base = anim_idle(0.0)
    L = merge(base, head=(None, 42, 8), neck=(None, 18, None), chest=(None, 7, None))
    L2 = merge(L, head=(None, 46, 14))
    Rt = merge(base, head=(None, -50, -6), neck=(None, -21, None), chest=(None, -8, None))
    Rt2 = merge(Rt, head=(None, -52, -16))
    return [K(0.0, base, 'SINE', 'EASE_IN_OUT'), K(0.16, L, 'SINE', 'EASE_IN_OUT'), K(0.33, L2, 'CONSTANT'),
            K(0.36, L, 'SINE', 'EASE_IN_OUT'), K(0.55, Rt, 'SINE', 'EASE_IN_OUT'), K(0.74, Rt2, 'BACK', 'EASE_OUT'), K(1.0, base)]


def keys_head_tilt():
    base = anim_idle(0.0)
    tilt = merge(base, head=(4, None, -72), neck=(None, None, -15), jaw=(16, None, None))
    tw = merge(tilt, head=(4, 8, -80))
    return [K(0.0, base, 'SINE', 'EASE_IN_OUT'), K(0.38, tilt, 'CONSTANT'), K(0.6, tw, 'CONSTANT'), K(0.63, tilt, 'QUAD', 'EASE_IN'),
            K(0.82, tilt, 'CUBIC', 'EASE_IN_OUT'), K(1.0, base)]


def keys_head_turn():
    base = anim_idle(0.0)
    turned = merge(base, head=(None, 86, -10), neck=(None, 26, None), chest=(None, 6, None))
    over = merge(turned, head=(None, 94, -14))
    return [K(0.0, base, 'EXPO', 'EASE_OUT'), K(0.09, over, 'BACK', 'EASE_OUT'), K(0.2, turned, 'BEZIER'), K(1.0, merge(turned, head=(None, 84, -6)))]


def keys_scream():
    base = anim_idle(0.0)
    antic = merge(base, head=(-46, None, None), neck=(-25, None, None), chest=(20, None, None), jaw=(12, None, None))
    out = sym(merge(base, head=(10, None, None), neck=(-35, None, None), chest=(-8, None, None), spine1=(4, None, None), jaw=(58, None, None)),
              upperarm_both=(32, 0, 52), forearm_both=(32, 0, 0), fingers_both=(-28, 0, 0), clavicle_both=(-14, 0, 0))
    k = [K(0.0, base, 'SINE', 'EASE_IN'), K(0.17, antic, 'BACK', 'EASE_OUT'), K(0.26, out, 'LINEAR')]
    for i, tt in enumerate((0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68)):   # throat tremor
        k.append(K(tt, merge(out, head=(10 + (3 if i % 2 else -3), None, (4 if i % 2 else -4) * (1 - i / 8)), jaw=(58 - (i % 2) * 6, None, None)), 'LINEAR'))
    k += [K(0.78, out, 'SINE', 'EASE_IN_OUT'), K(1.0, merge(base, jaw=(20, None, None)))]
    return k


def keys_attack():
    ready = anim_chase(0.0)
    wind = sym(merge(ready, spine1=(12, None, None), head=(-22, None, None), jaw=(40, None, None)),
               upperarm_both=(178, 0, -26), forearm_both=(28, 0, 0), fingers_both=(65, 0, 0))
    hit = sym(merge(ready, spine1=(48, None, None), chest=(30, None, None), head=(-5, None, None), jaw=(46, None, None)),
              upperarm_both=(18, 0, -20), forearm_both=(4, 0, 0), fingers_both=(-12, 0, 0))
    over = sym(hit, upperarm_both=(4, 0, -16))
    return [K(0.0, ready, 'SINE', 'EASE_IN'), K(0.32, wind, 'EXPO', 'EASE_IN'), K(0.44, hit, 'BACK', 'EASE_OUT'),
            K(0.5, over, 'QUAD', 'EASE_OUT'), K(0.72, hit, 'SINE', 'EASE_IN_OUT'), K(1.0, ready)]


def keys_jumpscare():
    crouch = sym(merge(anim_idle(0.0), spine1=(30, None, None), head=(10, None, None), jaw=(6, None, None), hips_loc=(0, -0.12, -0.05)),
                 upperarm_both=(40, 0, -10))
    lunge = sym(merge(anim_idle(0.0), spine1=(26, None, None), chest=(16, None, None), neck=(-32, None, None), head=(-22, None, None), jaw=(50, None, None),
                      hips_loc=(0, -0.05, 0.28)), upperarm_both=(128, 0, 48), forearm_both=(18, 0, 0), fingers_both=(-22, 0, 0), clavicle_both=(16, 0, 0))
    k = [K(0.0, crouch, 'EXPO', 'EASE_OUT'), K(0.07, lunge, 'BACK', 'EASE_OUT')]
    for i, tt in enumerate((0.16, 0.22, 0.29, 0.35, 0.44, 0.52, 0.63)):  # stop-motion convulsions
        k.append(K(tt, jitter(lunge, 7 + i, 9 - i), 'CONSTANT'))
    k += [K(0.75, lunge, 'SINE', 'EASE_IN_OUT'), K(1.0, merge(lunge, jaw=(40, None, None)))]
    return k


def keys_stagger():
    base = anim_idle(0.0)
    hit = sym(merge(base, spine1=(-18, None, None), chest=(-10, None, None), head=(-42, None, 24), jaw=(34, None, None), hips_loc=(0, -0.09, 0.14)),
              upperarm_both=(60, 0, 40))
    return [K(0.0, base, 'EXPO', 'EASE_OUT'), K(0.12, hit, 'ELASTIC', 'EASE_OUT'), K(0.75, base, 'SINE', 'EASE_IN_OUT'), K(1.0, base)]


def keys_disappear():
    a = anim_observe(0.0); b = anim_disappear(1.0)
    return [K(0.0, a, 'CUBIC', 'EASE_IN'), K(0.55, b, 'BEZIER'), K(1.0, b)]


def keys_emerge():
    P = [anim_emerge(x) for x in (0.0, 0.18, 0.34, 0.52, 0.66, 0.9, 1.0)]
    k = [K(0.0, P[0], 'LINEAR')]
    for i, tt in enumerate((0.05, 0.1, 0.15, 0.2)):                    # straining tremor, claws up
        k.append(K(tt, jitter(P[0], 40 + i, 3), 'LINEAR'))
    k += [K(0.26, P[1], 'BACK', 'EASE_OUT'),                           # hands slap down onto the floor
          K(0.52, P[3], 'CUBIC', 'EASE_IN_OUT'),                       # push
          K(0.66, P[4], 'CONSTANT'), K(0.69, jitter(P[4], 50, 4), 'CUBIC', 'EASE_IN_OUT'),   # a joint-cracking jerk
          K(0.9, P[5], 'SINE', 'EASE_OUT'), K(1.0, P[6])]
    return k


def keys_gait(fn, phases=8):
    return [K(i / phases, fn(i / phases)) for i in range(phases + 1)]


ANIMS_KEYED = {
    'koala_idle': (keys_idle, 3.4, True), 'koala_breathe': (keys_breathe, 2.4, True), 'koala_observe': (keys_observe, 4.6, True),
    'koala_look_around': (keys_look_around, 4.0, False), 'koala_head_tilt': (keys_head_tilt, 3.0, False), 'koala_head_turn': (keys_head_turn, 1.4, False),
    'koala_walk': (lambda: keys_gait(anim_walk), 1.3, True), 'koala_crawl': (lambda: keys_gait(anim_crawl), 1.1, True),
    'koala_run': (lambda: keys_gait(anim_run), 0.62, True), 'koala_chase': (lambda: keys_gait(anim_chase), 0.56, True),
    'koala_attack': (keys_attack, 1.0, False), 'koala_stagger': (keys_stagger, 1.2, False), 'koala_disappear': (keys_disappear, 0.9, False),
    'koala_jumpscare': (keys_jumpscare, 1.4, False), 'koala_scream': (keys_scream, 1.6, False), 'koala_emerge': (keys_emerge, 4.8, False),
}


def build_actions_keyed(rig):
    rig.animation_data_create()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    tracks = []
    for name, (kf, dur, loop) in ANIMS_KEYED.items():
        act = bpy.data.actions.new(name); act.use_fake_user = True
        rig.animation_data.action = act
        keys = kf()
        frame_info = []
        for (t, (pose, loc), interp, easing) in keys:
            frame = 1 + t * dur * FPS
            for bn, (rx, ry, rz) in pose.items():
                pb = rig.pose.bones[bn]; pb.rotation_euler = (rx, ry, rz)
                pb.keyframe_insert('rotation_euler', frame=frame)
            pb = rig.pose.bones['hips']; pb.location = loc.get('hips', (0, 0, 0)); pb.keyframe_insert('location', frame=frame)
            frame_info.append((frame, interp, easing))
        # per-segment interpolation + easing on every curve
        fcurves = act.fcurves if hasattr(act, 'fcurves') and len(act.fcurves) else [fc for layer in act.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]
        for fc in fcurves:
            for kp in fc.keyframe_points:
                info = min(frame_info, key=lambda f: abs(f[0] - kp.co.x))
                kp.interpolation = info[1]
                if info[1] not in ('BEZIER', 'CONSTANT', 'LINEAR'): kp.easing = info[2]
                if info[1] == 'BEZIER': kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
            if loop:
                fc.modifiers.new('CYCLES')
            fc.update()
        tr = rig.animation_data.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 1, act); tr.mute = True
        rig.animation_data.action = None
        tracks.append(name)
    return tracks


ANIMS = [
    ('koala_emerge', anim_emerge, 4.8, False),
    ('koala_idle', anim_idle, 3.0, True),
    ('koala_breathe', anim_breathe, 2.2, True),
    ('koala_look_around', anim_look_around, 4.0, False),
    ('koala_head_tilt', anim_head_tilt, 2.6, False),
    ('koala_head_turn', anim_head_turn, 1.2, False),
    ('koala_walk', anim_walk, 1.3, True),
    ('koala_crawl', anim_crawl, 1.1, True),
    ('koala_run', anim_run, 0.62, True),
    ('koala_chase', anim_chase, 0.56, True),
    ('koala_attack', anim_attack, 1.0, False),
    ('koala_stagger', anim_stagger, 1.2, False),
    ('koala_disappear', anim_disappear, 0.9, False),
    ('koala_jumpscare', anim_jumpscare, 1.4, False),
    ('koala_observe', anim_observe, 4.0, True),
    ('koala_scream', anim_scream, 1.6, False),
]


def build_actions(rig):
    rig.animation_data_create()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    tracks = []
    for name, fn, dur, loop in ANIMS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        n = max(2, int(round(dur * 15)))
        for i in range(n + 1):
            t = i / n
            frame = 1 + t * dur * FPS
            pose, loc = fn(t if not loop else t % 1.0)
            if loop and i == n:
                pose, loc = fn(0.0)
            for bn, (rx, ry, rz) in pose.items():
                pb = rig.pose.bones[bn]
                pb.rotation_euler = (rx, ry, rz)
                pb.keyframe_insert('rotation_euler', frame=frame)
            for bn in ('hips',):
                pb = rig.pose.bones[bn]
                pb.location = loc.get(bn, (0, 0, 0))
                pb.keyframe_insert('location', frame=frame)
        tr = rig.animation_data.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        tr.mute = True
        rig.animation_data.action = None
        tracks.append(name)
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    return tracks


def build(export=True):
    ns_lib.reset_scene()
    coll = collection('KOALA')
    mats = {
        'fur': material('M_koala_fur', tex='fur_col', nrm='fur_nrm', rgh='fur_rgh', vcol=True, nrm_strength=1.2),
        'nose': material('M_koala_skin', color=(0.035, 0.025, 0.025), nrm='skin_nrm', rough=0.18),
        'claw': material('M_koala_claw', color=(0.14, 0.1, 0.07), rough=0.35),
        'teeth': material('M_koala_teeth', color=(0.36, 0.28, 0.16), rough=0.45),
        'eye': material('M_koala_eye', color=(0.005, 0.004, 0.004), rough=0.04),
    }
    body = build_body(coll)
    finish_body(body)
    body.data.materials.append(mats['fur'])
    body.data.materials.append(mats['nose'])
    paint_blood(body, 1)
    parts = accessory_meshes(coll, mats)
    for p in parts:
        # accessories need the colour attribute too (white = no tint)
        ca = p.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        ca.data.foreach_set('color', [1.0] * (len(p.data.loops) * 4))
    rig = build_armature(coll)
    body = skin(body, parts, rig)
    tracks = build_actions_keyed(rig)       # key poses + per-segment interpolation (see ANIMS_KEYED)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    st = {'tris': tris, 'verts': len(body.data.vertices), 'actions': tracks}
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'koala.glb')
        st['bytes'] = ns_lib.export_glb(path, anim=True, instances=False)
        os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Characters'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Characters', 'koala.blend'))
    return st

