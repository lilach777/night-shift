# NIGHT SHIFT - realistic characters from MPFB (MakeHuman for Blender, GPL add-on; generated
# characters and the MakeHuman system asset pack are CC0).
#   Arman's double (reflection / CCTV), the morning employee, and the ghost.
# Pipeline: MPFB base human with macro shape -> skin, eyes, brows, lashes, teeth, hair, clothes
# -> 'game_engine' rig with MakeHuman weights -> CC0 animations retargeted (ns_retarget.py)
# -> glTF to public/assets/models/<name>.glb
import bpy, os
import ns_lib
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

DATA = os.path.join(os.environ['APPDATA'], 'Blender Foundation', 'Blender', '5.2', 'extensions', '.user', 'user_default', 'mpfb', 'data')

def asset(kind, name, ext='.mhclo'):
    return os.path.join(DATA, kind, name, name + ext)

def ctx():
    import contextlib
    wins = bpy.context.window_manager.windows
    if not len(wins): return contextlib.nullcontext()          # headless (blender -b)
    win = wins[0]
    area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), None)
    return bpy.context.temp_override(window=win, area=area) if area else contextlib.nullcontext()

CHARACTERS = {
    'arman': dict(
        macro=dict(gender=1.0, age=0.5, muscle=0.58, weight=0.52, proportions=0.6, height=0.62,
                   race=dict(asian=0.35, caucasian=0.4, african=0.25)),
        skin='young_caucasian_male', tint=(0.86, 0.72, 0.6),
        eyebrows='eyebrow001', eyelashes='eyelashes02', hair='short02',
        clothes=[('male_casualsuit01', {'shirt': (0.12, 0.15, 0.24), 'jeans': (0.08, 0.085, 0.1)}), ('shoes03', None)],
    ),
    'employee': dict(
        macro=dict(gender=0.0, age=0.47, muscle=0.45, weight=0.45, proportions=0.6, height=0.45,
                   race=dict(asian=0.2, caucasian=0.6, african=0.2)),
        skin='young_caucasian_female', tint=(0.95, 0.84, 0.76),
        eyebrows='eyebrow010', eyelashes='eyelashes01', hair='ponytail01',
        clothes=[('female_casualsuit01', None), ('shoes05', None)],
    ),
    'ghost': dict(
        macro=dict(gender=0.0, age=0.42, muscle=0.25, weight=0.2, proportions=0.4, height=0.55,
                   race=dict(asian=0.3, caucasian=0.5, african=0.2)),
        skin='young_caucasian_female', tint=(0.72, 0.74, 0.76),   # drained, grey-blue
        eyebrows='eyebrow012', eyelashes='eyelashes01', hair='long01',
        clothes=[('female_casualsuit01', None)],
        ghost=True,
    ),
}


def tint_materials(objs, mapping):
    """multiply base colour; mapping keys match material names ('*' = all)"""
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes: continue
            col = None
            for k, v in mapping.items():
                if k == '*' or k in m.name.lower(): col = v
            if col is None: continue
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    inp = n.inputs['Base Color']
                    if inp.is_linked:      # texture -> multiply node in between
                        src = inp.links[0].from_socket
                        mix = m.node_tree.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
                        mix.inputs['Factor'].default_value = 1.0
                        mix.inputs[7].default_value = (*col, 1)
                        m.node_tree.links.new(src, mix.inputs[6]); m.node_tree.links.new(mix.outputs[2], inp)
                    else:
                        inp.default_value = (*col, 1)


# --- multiplayer crew (MP only; the single-player models above are untouched)
CHARACTERS.update({
    'crew_1': dict(macro=dict(gender=1.0, age=0.55, muscle=0.62, weight=0.58, proportions=0.6, height=0.6,
                              race=dict(asian=0.15, caucasian=0.7, african=0.15)),
                   skin='middleage_caucasian_male', eyebrows='eyebrow003', eyelashes='eyelashes02', hair='short04',
                   clothes=[('male_worksuit01', None), ('shoes03', None)]),
    'crew_2': dict(macro=dict(gender=0.0, age=0.45, muscle=0.5, weight=0.48, proportions=0.6, height=0.55,
                              race=dict(asian=0.15, caucasian=0.35, african=0.5)),
                   skin='young_african_female', eyebrows='eyebrow010', eyelashes='eyelashes01', hair='ponytail01',
                   clothes=[('female_casualsuit01', None), ('shoes03', None)]),
    'crew_3': dict(macro=dict(gender=1.0, age=0.42, muscle=0.5, weight=0.45, proportions=0.6, height=0.55,
                              race=dict(asian=0.6, caucasian=0.25, african=0.15)),
                   skin='young_asian_male', eyebrows='eyebrow001', eyelashes='eyelashes02', hair='short02',
                   clothes=[('male_casualsuit05', None), ('shoes02', None)]),
    'crew_4': dict(macro=dict(gender=0.0, age=0.5, muscle=0.52, weight=0.5, proportions=0.6, height=0.6,
                              race=dict(asian=0.2, caucasian=0.6, african=0.2)),
                   skin='young_caucasian_female', eyebrows='eyebrow010', eyelashes='eyelashes01', hair='bob02',
                   clothes=[('male_worksuit01', None), ('shoes04', None)]),
})
CREW_CLIPS = {'idle': 'Idle_Loop', 'walk': 'Walk_Loop', 'jog': 'Jog_Fwd_Loop', 'sprint': 'Sprint_Loop',
              'crouch': 'Crouch_Idle_Loop', 'crouchwalk': 'Crouch_Fwd_Loop', 'torch': 'Idle_Torch_Loop',
              'down': 'Death01', 'interact': 'Interact'}

CLIPS = {
    'arman': {'idle': 'Idle_Loop', 'walk': 'Walk_Loop', 'jog': 'Jog_Fwd_Loop', 'sprint': 'Sprint_Loop',
              'crouch': 'Crouch_Idle_Loop', 'torch': 'Idle_Torch_Loop'},
    'employee': {'idle': 'Idle_Loop', 'walk': 'Walk_Formal_Loop', 'talk': 'Idle_Talking_Loop'},
    'ghost': {'idle': 'Idle_Loop', 'walk': 'Walk_Loop', 'crawl': 'Crouch_Fwd_Loop'},
    **{f'crew_{i}': CREW_CLIPS for i in range(1, 5)},
}
LOOPS = {'idle', 'walk', 'jog', 'sprint', 'crouch', 'torch', 'talk', 'stare', 'crawl', 'lurch', 'twitch'}


# ----------------------------------------------------------------------------- keyed variants
# Extra rotations are given in WORLD axes (character faces -Y): x = nod (chin down +),
# y = tilt toward the character's right (+), z = turn left (+). Each key carries its own Blender
# interpolation for the following segment (BEZIER, SINE/CUBIC/EXPO/BACK + easing, CONSTANT).
import math
from mathutils import Euler, Matrix

def _fcurves(act):
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])): return list(act.fcurves)
    return [fc for l in act.layers for s in l.strips for cb in s.channelbags for fc in cb.fcurves]

def _assign(rig, act):
    rig.animation_data.action = act
    try: rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]
    except Exception: pass

def variant(rig, base, name, frames, overlay, step=1, interp='BEZIER', loop=False):
    """new action: base action evaluated per frame (looping) + world-axis overlay(t) -> {bone: (x,y,z) deg}"""
    bf0, bf1 = [int(round(v)) for v in base.frame_range]
    blen = max(1, bf1 - bf0)
    poses = {}
    _assign(rig, base)
    for f in range(1, frames + 1, step):
        bpy.context.scene.frame_set(bf0 + ((f - 1) % blen))
        poses[f] = {pb.name: (pb.matrix_basis.copy(), pb.matrix.copy()) for pb in rig.pose.bones}
    act = bpy.data.actions.new(name); act.use_fake_user = True
    _assign(rig, act)
    prev = {}
    for f, pose in poses.items():
        t = (f - 1) / max(1, frames - 1)
        extra = overlay(t)
        for pb in rig.pose.bones:
            basis, arm = pose[pb.name]
            if pb.name in extra:
                x, y, z = (math.radians(v) for v in extra[pb.name])
                rw = Euler((x, y, z), 'XYZ').to_matrix().to_4x4()
                ra = arm.to_quaternion().to_matrix().to_4x4()
                basis = basis @ (ra.inverted() @ rw @ ra)
            pb.rotation_mode = 'QUATERNION'
            loc, rot, _ = basis.decompose()
            if pb.name in prev and prev[pb.name].dot(rot) < 0: rot.negate()
            prev[pb.name] = rot.copy()
            pb.rotation_quaternion = rot; pb.keyframe_insert('rotation_quaternion', frame=f)
            if pb.name == 'pelvis': pb.location = loc; pb.keyframe_insert('location', frame=f)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points: kp.interpolation = interp
    rig.animation_data.action = None
    tr = rig.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, 1, act); tr.mute = True
    return act

def keys(points):
    """piecewise overlay from key poses [(t, {bone: xyz}, interp, easing)] using the curve maths of
    Blender's easing modes (evaluated here, then baked per frame)"""
    def ease(kind, how, u):
        if kind == 'CONSTANT': return 0.0
        if kind == 'LINEAR': return u
        f = {'SINE': lambda u: 1 - math.cos(u * math.pi / 2), 'CUBIC': lambda u: u ** 3, 'QUAD': lambda u: u * u,
             'EXPO': lambda u: 0 if u <= 0 else 2 ** (10 * u - 10),
             'BACK': lambda u: u * u * (2.70158 * u - 1.70158), 'BEZIER': lambda u: u * u * (3 - 2 * u)}[kind]
        if kind == 'BEZIER': return f(u)
        if how == 'EASE_IN': return f(u)
        if how == 'EASE_OUT': return 1 - f(1 - u)
        return f(2 * u) / 2 if u < 0.5 else 1 - f(2 - 2 * u) / 2
    def ov(t):
        for i in range(len(points) - 1):
            t0, a, k, h = points[i]; t1, b = points[i + 1][0], points[i + 1][1]
            if t0 <= t <= t1:
                u = ease(k, h, (t - t0) / max(1e-6, t1 - t0))
                return {bn: tuple(a.get(bn, (0, 0, 0))[j] + (b.get(bn, (0, 0, 0))[j] - a.get(bn, (0, 0, 0))[j]) * u for j in range(3))
                        for bn in set(a) | set(b)}
        return points[-1][1]
    return ov


def custom_clips(name, rig):
    A = bpy.data.actions
    idle = A[name + '_idle']
    if name in ('arman', 'employee'):
        # the reflection / the employee stops copying: still, then a slow wrong tilt with a
        # stop-motion twitch; chin lowers while the eyes stay on you
        stare = {'head': (2, 0, 0)}
        variant(rig, idle, name + '_stare', 120, lambda t: {'head': (2 + math.sin(t * 6.283) * 0.6, 0, 0)}, step=2)
        variant(rig, idle, name + '_head_tilt', 150, keys([
            (0.0, stare, 'CUBIC', 'EASE_IN_OUT'),
            (0.45, {'head': (8, 22, 0), 'neck_01': (4, 8, 0)}, 'CONSTANT', ''),
            (0.55, {'head': (10, 28, 4), 'neck_01': (4, 9, 0)}, 'CONSTANT', ''),
            (0.58, {'head': (8, 22, 0), 'neck_01': (4, 8, 0)}, 'SINE', 'EASE_IN_OUT'),
            (1.0, {'head': (12, 31, -2), 'neck_01': (6, 10, 0), 'spine_03': (2, 2, 0)}, 'LINEAR', '')]), step=2)
    if name == 'ghost':
        walk = A['ghost_walk']
        # lurch: the walk, but the head hangs to one side and the shoulders hitch on a stepped rhythm
        def lurch(t):
            hitch = 1.0 if (int(t * 16) % 5) == 0 else 0.0
            return {'head': (18, -26 + hitch * 9, 0), 'neck_01': (8, -6, 0), 'spine_03': (6, 0, 0),
                    'clavicle_l': (0, 0, -8 * hitch), 'upperarm_l': (0, 0, -6), 'upperarm_r': (0, 0, 6)}
        variant(rig, walk, 'ghost_lurch', 64, lurch, step=1)
        # twitch: standing, head snapping between wrong angles (CONSTANT holds = stop-motion)
        tw = [(0.0, {'head': (22, -20, 0)}, 'CONSTANT', ''), (0.18, {'head': (10, 32, 12)}, 'CONSTANT', ''),
              (0.24, {'head': (26, -24, -8)}, 'EXPO', 'EASE_IN'), (0.5, {'head': (35, 5, 0), 'neck_01': (14, 0, 0)}, 'CONSTANT', ''),
              (0.62, {'head': (5, 40, 20)}, 'CONSTANT', ''), (0.66, {'head': (22, -20, 0)}, 'SINE', 'EASE_IN_OUT'), (1.0, {'head': (22, -20, 0)}, 'LINEAR', '')]
        variant(rig, idle, 'ghost_twitch', 96, keys(tw), step=1)
        # reach: arm rises toward the camera with a BACK overshoot, then hangs
        variant(rig, idle, 'ghost_reach', 72, keys([
            (0.0, {'head': (20, -10, 0)}, 'CUBIC', 'EASE_IN'),
            (0.55, {'head': (5, 0, 0), 'upperarm_r': (-75, 0, 0), 'lowerarm_r': (-10, 0, 0)}, 'BACK', 'EASE_OUT'),
            (1.0, {'head': (2, 0, 0), 'upperarm_r': (-82, 0, 0), 'lowerarm_r': (-14, 0, 0)}, 'LINEAR', '')]), step=1)


def build_and_export(name):
    import ns_retarget
    rig, bm, meshes = build(name)
    src, new, src_acts = ns_retarget.import_source()
    offs = ns_retarget.calibrate(src, rig)
    for clip, srcname in CLIPS[name].items():
        ns_retarget.retarget(src, rig, bpy.data.actions[srcname], f'{name}_{clip}', offs)
    custom_clips(name, rig)
    # drop the source rig, its mannequin and its clips so only our actions are exported
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    for a in src_acts: bpy.data.actions.remove(a)
    for pb in rig.pose.bones: pb.matrix_basis = Matrix()
    if rig.animation_data: rig.animation_data.action = None
    path = os.path.join(ns_lib.MODEL_DIR, name + '.glb')
    size = ns_lib.export_glb(path, objects=[rig], anim=True, instances=False)
    os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Characters'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Characters', name + '_mpfb.blend'))
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    return {'bytes': size, 'tris': tris, 'actions': sorted(a.name for a in bpy.data.actions)}


# ----------------------------------------------------------------------------- texture variants
# Clothing is recoloured in the TEXTURE (so glTF carries it): the fabric's luminance grain is kept,
# its hue replaced, prints/logos/piping flattened out. Written to blender/Textures/characters/.
import numpy as np
TEXOUT = os.path.join(ns_lib.ROOT, 'blender', 'Textures', 'characters')

def _load(img):
    w, h = img.size; a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)

def recolor_cloth(src_path, out_name, top, bottom, grain_top=1.0, grain_bottom=0.4, grime=0.0):
    img = bpy.data.images.load(src_path, check_existing=True)
    px = _load(img); rgb = px[..., :3]
    h, w = rgb.shape[:2]
    bg = np.array([0.84, 0.84, 0.84]) if rgb.max() > 0 else 0
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sat = rgb.max(-1) - rgb.min(-1)
    cloth = np.abs(rgb - rgb[2, 2]).sum(-1) > 0.06                 # not the flat background
    # NB Blender image rows run bottom-up: the shirt (top of the PNG) is at high row indices
    is_top = (np.arange(h)[:, None] > h * 0.58) | ((np.arange(w)[None, :] > w * 0.72) & (np.arange(h)[:, None] < h * 0.45))
    blue = cloth & (rgb[..., 2] > rgb[..., 0] + 0.08) & (sat > 0.18)        # real dyed fabric (not the grey logo ring)
    out = rgb.copy()
    for region, col, grain in ((cloth & is_top, top, grain_top), (cloth & ~is_top, bottom, grain_bottom)):
        if not region.any(): continue
        med = np.median(lum[region & blue]) if (region & blue).any() else np.median(lum[region])
        ratio = lum / max(med, 1e-4)
        odd = region & ~blue                                         # logo, ring, piping: flatten
        ratio[odd] = 1.0
        ratio = 1 + (ratio - 1) * grain
        out[region] = np.clip(np.array(col)[None, :] * ratio[region][:, None], 0, 1)
    if grime:
        rng = np.random.default_rng(3)
        n = np.zeros((h, w))
        for cell, amp in ((256, 1.0), (96, 0.5), (32, 0.25)):     # smooth multi-octave stains
            g = rng.standard_normal((h // cell + 2, w // cell + 2))
            ys = np.linspace(0, h / cell, h); xs = np.linspace(0, w / cell, w)
            y0 = ys.astype(int); x0 = xs.astype(int); fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
            fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
            a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
            n += amp * (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)
        n = (n - n.mean()) / (n.std() + 1e-6)
        out[cloth] *= (1 - grime * np.clip(n[cloth] * 0.35 + 0.35, 0, 1))[:, None]
    px[..., :3] = out
    os.makedirs(TEXOUT, exist_ok=True)
    new = bpy.data.images.new(out_name, w, h, alpha=True)
    new.pixels.foreach_set(px.ravel()); new.filepath_raw = os.path.join(TEXOUT, out_name + '.png'); new.file_format = 'PNG'; new.save()
    return new

def recolor_skin(src_path, out_name, tint, desat=0.6, darken=1.0):
    img = bpy.data.images.load(src_path, check_existing=True)
    px = _load(img); rgb = px[..., :3]
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    out = (rgb * (1 - desat) + lum * desat) * np.array(tint)[None, None, :] * darken
    px[..., :3] = np.clip(out, 0, 1)
    os.makedirs(TEXOUT, exist_ok=True)
    new = bpy.data.images.new(out_name, img.size[0], img.size[1], alpha=True)
    new.pixels.foreach_set(px.ravel()); new.filepath_raw = os.path.join(TEXOUT, out_name + '.png'); new.file_format = 'PNG'; new.save()
    return new

def swap_diffuse(obj, new_img):
    """point the material's base-colour image at new_img (first image node feeding Base Color)"""
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes: continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and ('diffuse' in n.image.name.lower() or 'diffuse' in (n.image.filepath or '').lower()
                                                     or n.image.name.lower().endswith(('.png', '.jpg')) and 'normal' not in n.image.name.lower() and 'ao' not in n.image.name.lower()):
                n.image = new_img
                return n.image
    return None

RETEX = {
    'crew_2': [('female_casualsuit01', 'cloth', dict(top=(0.17, 0.18, 0.2), bottom=(0.1, 0.11, 0.14), grain_top=1.0, grain_bottom=0.5))],
    'employee': [('female_casualsuit01', 'cloth', dict(top=(0.20, 0.42, 0.44), bottom=(0.17, 0.37, 0.39), grain_top=0.9, grain_bottom=0.35))],
    'ghost': [('female_casualsuit01', 'cloth', dict(top=(0.62, 0.62, 0.58), bottom=(0.55, 0.56, 0.53), grain_top=1.0, grain_bottom=0.5, grime=0.35)),
              ('body', 'skin', dict(tint=(0.86, 0.93, 1.0), desat=0.75, darken=0.92)),
              ('long01', 'skin', dict(tint=(0.9, 0.92, 1.0), desat=1.0, darken=0.28))],     # lank near-black hair
}

def apply_retex(name, meshes, spec):
    done = []
    for key, kind, kw in RETEX.get(name, []):
        for o in meshes:
            if not o.name.endswith(key) and key != 'body': continue
            if key == 'body' and o.name != name + '_body': continue
            node = None
            for slot in o.material_slots:
                for n in (slot.material.node_tree.nodes if slot.material and slot.material.use_nodes else []):
                    fp = (n.image.filepath if n.type == 'TEX_IMAGE' and n.image else '').lower()
                    if fp and 'normal' not in fp and '_ao' not in fp and 'bump' not in fp and 'spec' not in fp:
                        node = n; break
                if node: break
            if not node: continue
            src = bpy.path.abspath(node.image.filepath)
            node.image = (recolor_cloth if kind == 'cloth' else recolor_skin)(src, f'{name}_{key}_retex', **kw)
            done.append((o.name, os.path.basename(src)))
    return done


def build(name):
    spec = CHARACTERS[name]
    ns_lib.reset_scene()
    macro = TargetService.get_default_macro_info_dict()
    for k, v in spec['macro'].items(): macro[k] = v
    with ctx():
        bm = HumanService.create_human(macro_detail_dict=macro)
        bm.name = name + '_body'
        HumanService.set_character_skin(asset('skins', spec['skin'], '.mhmat'), bm, skin_type='MAKESKIN', material_instances=False)
        # rig first: assets added afterwards are bound to it (weights interpolated from the body)
        rig = HumanService.add_builtin_rig(bm, 'game_engine', import_weights=True)
        HumanService.add_mhclo_asset(os.path.join(DATA, 'eyes', 'high-poly', 'high-poly.mhclo'), bm, asset_type='Eyes', subdiv_levels=0)
        HumanService.add_mhclo_asset(asset('eyebrows', spec['eyebrows']), bm, asset_type='Eyebrows', subdiv_levels=0)
        HumanService.add_mhclo_asset(asset('eyelashes', spec['eyelashes']), bm, asset_type='Eyelashes', subdiv_levels=0)
        HumanService.add_mhclo_asset(os.path.join(DATA, 'teeth', 'teeth_base', 'teeth_base.mhclo'), bm, asset_type='Teeth', subdiv_levels=0)
        HumanService.add_mhclo_asset(asset('hair', spec['hair']), bm, asset_type='Hair', subdiv_levels=0)
        for cl, tint in spec['clothes']:
            HumanService.add_mhclo_asset(asset('clothes', cl), bm, asset_type='Clothes', subdiv_levels=0)
    rig.name = name
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    spec['retex_done'] = apply_retex(name, meshes, spec)
    for cl, tint in spec['clothes']:
        if tint: tint_materials([o for o in meshes if cl.split('_')[0] in o.name.lower() or cl in o.name.lower()], tint)
    return rig, bm, meshes
