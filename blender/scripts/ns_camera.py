# NIGHT SHIFT - cinematic camera authoring.
# Camera moves are keyframed in Blender with per-key interpolation (BEZIER auto-clamped,
# SINE/CUBIC/QUAD/EXPO/BACK easing, CONSTANT for hard cuts), a keyframed look-target empty
# driven through a Track To constraint (camera-operator style), an animated focal length,
# and NOISE F-modifiers on the target for handheld drift.  The result is baked frame by
# frame to public/assets/cams/<name>.json in three.js space and played by src/systems/camtrack.js.
#
#   import ns_camera; ns_camera.build_all()
import bpy, json, math, os
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'cams')
FPS = 30


def to_b(p):            # three (x, y, z) -> Blender (x, -z, y)
    return (p[0], -p[2], p[1])


C3 = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))   # Blender -> three basis change


# ---------------------------------------------------------------- three.js CatmullRom port
def _cr(x0, x1, x2, x3, d0, d1, d2):
    t1 = ((x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1) * d1
    t2 = ((x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2) * d1
    c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2
    c3 = 2 * x1 - 2 * x2 + t1 + t2
    return lambda t: x1 + t1 * t + c2 * t * t + c3 * t * t * t


def catmull_point(pts, u):
    """three.js CatmullRomCurve3(pts, false, 'centripetal').getPoint(u) for 2D (x, z) points."""
    l = len(pts)
    p = (l - 1) * u
    i = int(math.floor(p)); w = p - i
    if w == 0 and i == l - 1:
        i = l - 2; w = 1
    P = lambda k: Vector((pts[k][0], pts[k][1]))
    p0 = P(i - 1) if i > 0 else (P(0) - P(1)) + P(0)
    p1, p2 = P(i), P(i + 1)
    p3 = P(i + 2) if i + 2 < l else (P(l - 1) - P(l - 2)) + P(l - 1)
    d0 = ((p1 - p0).length_squared) ** 0.25
    d1 = ((p2 - p1).length_squared) ** 0.25
    d2 = ((p3 - p2).length_squared) ** 0.25
    if d1 < 1e-4: d1 = 1
    if d0 < 1e-4: d0 = d1
    if d2 < 1e-4: d2 = d1
    fx = _cr(p0.x, p1.x, p2.x, p3.x, d0, d1, d2)
    fz = _cr(p0.y, p1.y, p2.y, p3.y, d0, d1, d2)
    return fx(w), fz(w)


def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- keyframing helpers
def key(obj, path, t, value, interp='BEZIER', easing='AUTO', back=None, size=3):
    """Insert a key at time t (seconds) and set its interpolation for the segment that follows."""
    f = t * FPS
    if path == 'lens':
        obj.data.lens = value
        obj.data.keyframe_insert('lens', frame=f)
        fcs = fcurves_of(obj.data)
    else:
        setattr(obj, path, to_b(value) if path == 'location' else value)
        obj.keyframe_insert(path, frame=f)
        fcs = fcurves_of(obj)
    for fc in fcs:
        if fc.data_path != path: continue
        for kp in fc.keyframe_points:
            if abs(kp.co.x - f) < 1e-3:
                kp.interpolation = interp
                kp.easing = easing
                if back is not None: kp.back = back
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
    return f


def fcurves_of(idb):
    ad = idb.animation_data
    if not ad or not ad.action: return []
    act = ad.action
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])):   # legacy actions
        return list(act.fcurves)
    out = []                                                            # Blender 4.4+/5 slotted actions
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def add_noise(obj, path, strength, scale, phase=0.0):
    for fc in fcurves_of(obj):
        if fc.data_path != path: continue
        m = fc.modifiers.new('NOISE')
        m.strength = strength; m.scale = scale; m.phase = phase + fc.array_index * 13.7


def new_rig(name):
    sc = bpy.data.scenes.get('CAM_' + name) or bpy.data.scenes.new('CAM_' + name)
    for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
    sc.render.fps = FPS
    cam_data = bpy.data.cameras.new(name + '_cam')
    cam_data.sensor_fit = 'VERTICAL'; cam_data.sensor_height = 24.0; cam_data.sensor_width = 42.7
    cam = bpy.data.objects.new(name + '_cam', cam_data)
    tgt = bpy.data.objects.new(name + '_look', None)
    sc.collection.objects.link(cam); sc.collection.objects.link(tgt)
    con = cam.constraints.new('TRACK_TO')
    con.target = tgt; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
    sc.camera = cam
    return sc, cam, tgt


def bake(sc, cam, name, t0, t1, cuts, extra=None):
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    frames = []
    f0, f1 = int(round(t0 * FPS)), int(round(t1 * FPS))
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        M = cam.matrix_world
        p = M.to_translation()
        R = C3 @ M.to_3x3().normalized()
        q = R.to_quaternion()
        fov = math.degrees(cam.data.angle_y)
        frames.append([round(p.x, 4), round(p.z, 4), round(-p.y, 4),
                       round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5), round(fov, 3)])
    bpy.context.window.scene = prev
    os.makedirs(OUT, exist_ok=True)
    data = {'name': name, 'fps': FPS, 'start': t0, 'cuts': cuts, 'frames': frames}
    if extra: data.update(extra)
    path = os.path.join(OUT, name + '.json')
    with open(path, 'w') as fh: json.dump(data, fh, separators=(',', ':'))
    return path, len(frames)


# ---------------------------------------------------------------- intro (shots A-C)
CAR_PATH = [(-95, 30), (-62, 30), (-58, 22), (-50, 9), (-40, 5.5), (-36, 5)]


def car_at(t):
    u = 0 if t < 4.5 else min(1.0, (t - 4.5) / 10.5)
    x, z = catmull_point(CAR_PATH, smooth(u))
    return (x, 1.0, z)


def build_intro():
    sc, cam, tgt = new_rig('intro')
    # Shot A (0 - 6.5): storm establishing. Slow crane down + truck right, slow push on the lens.
    key(cam, 'location', 0.0, (-82, 10.5, -32), 'SINE', 'EASE_IN')        # slow start (dolly takes weight)
    key(cam, 'location', 3.2, (-76.5, 8.2, -26.5), 'BEZIER')
    key(cam, 'location', 6.49, (-70, 6.4, -21), 'CONSTANT')                # hard cut
    key(tgt, 'location', 0.0, (-14, 8.2, 0), 'BEZIER')
    key(tgt, 'location', 6.49, (-14, 5.4, 0), 'CONSTANT')
    key(cam, 'lens', 0.0, 26, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', 6.49, 30, 'CONSTANT')
    # Shot B (6.5 - 13): low tracking shot. The operator pans with the car, slightly late.
    # roadside, ~6 m off the lane so the car passes the lens instead of through it
    key(cam, 'location', 6.5, (-49.5, 1.15, 21.5), 'QUAD', 'EASE_IN_OUT')
    key(cam, 'location', 12.99, (-46.5, 1.5, 16.5), 'CONSTANT')
    for t in (6.5, 7.6, 8.7, 9.8, 10.9, 12.0, 12.99):
        x, y, z = car_at(t - 0.12)                                          # a touch of operator lag
        key(tgt, 'location', t, (x, y, z), 'CONSTANT' if t == 12.99 else 'BEZIER')
    key(cam, 'lens', 6.5, 38, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', 10.5, 44, 'CUBIC', 'EASE_IN')                          # creeping push-in as it nears
    key(cam, 'lens', 12.99, 52, 'CONSTANT')
    # Shot C (13 - 16.5): the car stops; the camera drifts and pans off it to the hospital,
    # overshooting a touch and settling (BACK ease-out) like a hand-operated head.
    key(cam, 'location', 13.0, (-43.4, 1.85, 10.3), 'CUBIC', 'EASE_IN_OUT')
    key(cam, 'location', 16.5, (-41, 1.65, 8.4), 'BEZIER')
    key(tgt, 'location', 13.0, (-36, 1.0, 5), 'BEZIER')
    key(tgt, 'location', 14.4, (-35.6, 1.1, 4.8), 'BACK', 'EASE_OUT', back=0.9)
    key(tgt, 'location', 16.5, (-22, 2.3, 0), 'BEZIER')
    key(cam, 'lens', 13.0, 34, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', 16.5, 30, 'BEZIER')
    # handheld drift on the look target (Blender NOISE modifiers on the F-curves)
    add_noise(tgt, 'location', 0.10, 55)
    return bake(sc, cam, 'intro', 0.0, 16.5, [6.5, 13.0])


# ---------------------------------------------------------------- title screen (40 s seamless loop)
def build_menu():
    sc, cam, tgt = new_rig('menu')
    # Floor 2 corridor (floor y = 4), looking west toward the storm window. A slow dolly in and
    # back out on SINE ease-in-out so the loop seam never shows; drifting look target and lens.
    L = 40.0
    key(cam, 'location', 0.0, (3.5, 5.62, 0.18), 'SINE', 'EASE_IN_OUT')
    key(cam, 'location', L * 0.5, (-1.8, 5.55, -0.22), 'SINE', 'EASE_IN_OUT')
    key(cam, 'location', L, (3.5, 5.62, 0.18), 'BEZIER')
    key(tgt, 'location', 0.0, (-14, 5.3, -0.3), 'SINE', 'EASE_IN_OUT')
    key(tgt, 'location', L * 0.3, (-14, 5.15, 0.45), 'SINE', 'EASE_IN_OUT')
    key(tgt, 'location', L * 0.7, (-14, 5.45, -0.1), 'SINE', 'EASE_IN_OUT')
    key(tgt, 'location', L, (-14, 5.3, -0.3), 'BEZIER')
    key(cam, 'lens', 0.0, 24, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', L * 0.5, 28, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', L, 24, 'BEZIER')
    for fc in fcurves_of(cam) + fcurves_of(cam.data) + fcurves_of(tgt):
        fc.modifiers.new('CYCLES')
    add_noise(tgt, 'location', 0.05, 70)
    return bake(sc, cam, 'menu', 0.0, L, [], {'loop': True})


# ---------------------------------------------------------------- multiplayer arrival (MULTIPLAYER ONLY)
def build_mp_arrival():
    """Shot A: low and wide across the wet car park - the crew's car in the foreground, the dark
    hospital beyond; the camera creeps (SINE ease-in) and then simply HOLDS on the building.
    Hard cut. Shot B: over the crew's shoulders, a still beat (anticipation), then a sudden push at the
    entrance (EXPO ease-in) that overshoots and settles (BACK ease-out) - like something pulled it in.
    Then control goes to the players exactly where shot B ends up."""
    sc, cam, tgt = new_rig('mp_arrival')
    key(cam, 'location', 0.0, (-45.5, 0.95, 10.2), 'SINE', 'EASE_IN')
    key(cam, 'location', 3.4, (-44.2, 1.1, 9.3), 'SINE', 'EASE_OUT')
    key(cam, 'location', 4.39, (-44.05, 1.12, 9.2), 'CONSTANT')                  # the hold, then a hard cut
    key(tgt, 'location', 0.0, (-22, 4.2, 1.5), 'SINE', 'EASE_IN_OUT')
    key(tgt, 'location', 3.4, (-22, 3.3, 0.4), 'BEZIER')
    key(tgt, 'location', 4.39, (-22, 3.25, 0.35), 'CONSTANT')
    key(cam, 'lens', 0.0, 22, 'SINE', 'EASE_IN_OUT')
    key(cam, 'lens', 4.39, 25, 'CONSTANT')
    key(cam, 'location', 4.4, (-30.6, 1.78, 1.7), 'BEZIER')
    key(cam, 'location', 5.1, (-30.55, 1.78, 1.68), 'EXPO', 'EASE_IN')            # still... then pulled
    key(cam, 'location', 6.55, (-26.9, 1.66, 0.55), 'BACK', 'EASE_OUT', back=1.2)
    key(cam, 'location', 7.3, (-27.3, 1.64, 0.45), 'SINE', 'EASE_IN_OUT')
    key(cam, 'location', 7.8, (-27.35, 1.62, 0.42), 'BEZIER')
    key(tgt, 'location', 4.4, (-22, 1.5, -0.3), 'BEZIER')
    key(tgt, 'location', 6.55, (-22, 1.35, 0.0), 'BACK', 'EASE_OUT', back=1.0)
    key(tgt, 'location', 7.8, (-22, 1.45, 0.0), 'BEZIER')
    key(cam, 'lens', 4.4, 28, 'BEZIER')
    key(cam, 'lens', 5.1, 28, 'EXPO', 'EASE_IN')
    key(cam, 'lens', 6.55, 38, 'SINE', 'EASE_OUT')
    key(cam, 'lens', 7.8, 34, 'BEZIER')
    add_noise(tgt, 'location', 0.06, 45)
    return bake(sc, cam, 'mp_arrival', 0.0, 7.8, [4.4])


def build_all():
    return {'intro': build_intro(), 'menu': build_menu(), 'mp_arrival': build_mp_arrival()}
