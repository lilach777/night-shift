# Retarget CC0 animations (Quaternius Universal Animation Library, Rigify-style DEF- bones)
# onto MPFB's 'game_engine' rig.
#
# Calibration: the target is posed so every mapped bone points the same way as the source in its
# reference pose (swing-only alignment, parent-first). The per-bone rotation offset between the two
# rigs is taken in that matching pose, then each frame: target_world = source_world @ offset.
# Hip translation is transferred relative to rest and scaled by the hip-height ratio.
import bpy, glob, os
from mathutils import Matrix, Quaternion, Vector

UAL = glob.glob(os.path.join(os.environ['TEMP'], 'claude', '*', '*', 'scratchpad', 'ual', 'x', '*', 'Godot', '*.glb'))

MAP = {'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
       'DEF-neck': 'neck_01', 'DEF-head': 'head'}
for s, t in (('L', 'l'), ('R', 'r')):
    MAP.update({f'DEF-shoulder.{s}': f'clavicle_{t}', f'DEF-upper_arm.{s}': f'upperarm_{t}', f'DEF-forearm.{s}': f'lowerarm_{t}',
                f'DEF-hand.{s}': f'hand_{t}', f'DEF-thigh.{s}': f'thigh_{t}', f'DEF-shin.{s}': f'calf_{t}',
                f'DEF-foot.{s}': f'foot_{t}', f'DEF-toe.{s}': f'ball_{t}'})
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        for i in (1, 2, 3):
            src = f'DEF-{"thumb" if f == "thumb" else "f_" + f}.0{i}.{s}'
            MAP[src] = f'{f}_0{i}_{t}'


def ctx():
    import contextlib
    wins = bpy.context.window_manager.windows
    if not len(wins): return contextlib.nullcontext()          # headless (blender -b)
    win = wins[0]
    area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), None)
    return bpy.context.temp_override(window=win, area=area) if area else contextlib.nullcontext()


def import_source():
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    with ctx():
        bpy.ops.import_scene.gltf(filepath=UAL[0])
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE' and len(o.data.bones) > 10)
    for o in new:                           # hide the mannequin, keep the rig
        if o.type == 'MESH': o.hide_render = True; o.hide_viewport = True
    return src, new, [a for a in bpy.data.actions if a not in acts_before]


def order(arm):
    out = []
    def walk(b):
        out.append(b.name)
        for c in b.children: walk(c)
    for b in arm.data.bones:
        if b.parent is None: walk(b)
    return out


def world_rot(obj, pb):
    return (obj.matrix_world @ pb.matrix).to_quaternion()


def local_basis(tgt, name, arm_mats, desired_arm):
    """basis matrix for bone `name` so its armature-space matrix becomes desired_arm"""
    b = tgt.data.bones[name]
    if b.parent:
        rel = b.parent.matrix_local.inverted() @ b.matrix_local
        parent_m = arm_mats[b.parent.name]
        return (parent_m @ rel).inverted() @ desired_arm
    return b.matrix_local.inverted() @ desired_arm


def calibrate(src, tgt):
    """pose target to match source directions in the source's rest pose; return per-bone offsets"""
    for pb in src.pose.bones: pb.matrix_basis = Matrix()
    for pb in tgt.pose.bones: pb.matrix_basis = Matrix(); pb.rotation_mode = 'QUATERNION'
    bpy.context.view_layer.update()
    inv_t = tgt.matrix_world.inverted()
    rev = {v: k for k, v in MAP.items()}
    for name in order(tgt):
        if name not in rev or rev[name] not in src.pose.bones: continue
        spb = src.pose.bones[rev[name]]; tpb = tgt.pose.bones[name]
        sdir = (src.matrix_world.to_3x3() @ (spb.tail - spb.head)).normalized()
        tdir = (tgt.matrix_world.to_3x3() @ (tpb.tail - tpb.head)).normalized()
        swing = tdir.rotation_difference(sdir)                # world-space minimal rotation
        cur = tgt.matrix_world @ tpb.matrix
        new_rot = (swing @ cur.to_quaternion()).to_matrix().to_4x4()
        new_rot.translation = cur.translation
        tpb.matrix = inv_t @ new_rot
        bpy.context.view_layer.update()
    offs = {}
    for s, t in MAP.items():
        if s in src.pose.bones and t in tgt.pose.bones:
            offs[t] = world_rot(src, src.pose.bones[s]).inverted() @ world_rot(tgt, tgt.pose.bones[t])
    for pb in tgt.pose.bones: pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()
    return offs


def retarget(src, tgt, src_action, out_name, offs, frame_step=1, loop=False):
    sc = bpy.context.scene
    src.animation_data_create(); src.animation_data.action = src_action
    try: src.animation_data.action_slot = src.animation_data.action_suitable_slots[0]
    except Exception: pass
    f0, f1 = [int(round(v)) for v in src_action.frame_range]
    for pb in src.pose.bones: pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()
    s_hip0 = (src.matrix_world @ src.pose.bones['DEF-hips'].head)
    t_hip0 = (tgt.matrix_world @ tgt.data.bones['pelvis'].head_local)
    scale = t_hip0.z / max(s_hip0.z, 1e-4)
    act = bpy.data.actions.new(out_name); act.use_fake_user = True
    tgt.animation_data_create(); tgt.animation_data.action = act
    inv_t = tgt.matrix_world.inverted()
    names = order(tgt)
    rev = {v: k for k, v in MAP.items()}
    prevq = {}
    for f in range(f0, f1 + 1, frame_step):
        sc.frame_set(f)
        arm_mats = {}
        for name in names:
            b = tgt.data.bones[name]
            if name in offs and rev[name] in src.pose.bones:
                q = world_rot(src, src.pose.bones[rev[name]]) @ offs[name]
                # head position follows the (already solved) parent chain, rotation from the source
                if b.parent:
                    rel = b.parent.matrix_local.inverted() @ b.matrix_local
                    head = (arm_mats[b.parent.name] @ rel).translation
                else:
                    head = b.matrix_local.translation.copy()
                if name == 'pelvis':
                    sh = src.matrix_world @ src.pose.bones['DEF-hips'].head
                    head = inv_t @ (t_hip0 + (sh - s_hip0) * scale)
                m = (inv_t.to_quaternion() @ q).to_matrix().to_4x4(); m.translation = head
            else:
                m = (arm_mats[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)) if b.parent else b.matrix_local.copy()
            arm_mats[name] = m
            basis = local_basis(tgt, name, arm_mats, m)
            pb = tgt.pose.bones[name]
            pb.rotation_mode = 'QUATERNION'
            loc, rot, _ = basis.decompose()
            if name in prevq and prevq[name].dot(rot) < 0: rot.negate()      # keep quaternions continuous
            prevq[name] = rot.copy()
            pb.rotation_quaternion = rot
            pb.keyframe_insert('rotation_quaternion', frame=f - f0 + 1)
            if name == 'pelvis':
                pb.location = loc; pb.keyframe_insert('location', frame=f - f0 + 1)
    tgt.animation_data.action = None
    tr = tgt.animation_data.nla_tracks.new(); tr.name = out_name
    tr.strips.new(out_name, 1, act); tr.mute = True
    return act
