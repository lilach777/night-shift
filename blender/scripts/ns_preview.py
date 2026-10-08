# Preview renders of the koala poses (QA helper).
import math, os
import bpy

OUT = os.environ.get('NS_PREVIEW_DIR', os.path.join(os.path.dirname(__file__), '..', '..', 'blender', 'previews'))


def setup(res=(400, 520)):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('rcam')
    if not cam:
        cd = bpy.data.cameras.new('rcam'); cam = bpy.data.objects.new('rcam', cd); sc.collection.objects.link(cam)
        for n, (loc, e) in {'k1': ((2, -3, 3), 450), 'k2': ((-2, -2, 2), 220), 'k3': ((0, 2, 2.5), 300)}.items():
            ld = bpy.data.lights.new(n, 'POINT'); l = bpy.data.objects.new(n, ld); sc.collection.objects.link(l)
            l.location = loc; l.data.energy = e
    sc.camera = cam
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.05, 0.05, 0.05)
    return cam


def shot(name, action=None, t=0.3, cam_loc=(2.6, -2.6, 1.3), yaw_deg=45, pitch_deg=86, lens=32, out_dir=OUT):
    os.makedirs(out_dir, exist_ok=True)
    cam = setup()
    cam.location = cam_loc
    cam.rotation_euler = (math.radians(pitch_deg), 0, math.radians(yaw_deg))
    cam.data.lens = lens
    rig = bpy.data.objects['koala_rig']
    if action:
        act = bpy.data.actions[action]
        rig.animation_data.action = act
        try:
            rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]
        except Exception:
            pass
        f0, f1 = act.frame_range
        bpy.context.scene.frame_set(int(f0 + (f1 - f0) * t))
    else:
        rig.animation_data.action = None
        for pb in rig.pose.bones:
            pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    path = os.path.join(out_dir, name + '.png')
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
