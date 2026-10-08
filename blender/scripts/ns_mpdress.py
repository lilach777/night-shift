# NIGHT SHIFT - multiplayer set dressing (MULTIPLAYER ONLY; the single-player hospital is untouched).
# Exported to public/assets/models/mp_dressing.glb as separate named root nodes, authored in three.js
# space (origin = floor centre, front facing +Z) like every other prop (see ns_props.py).
#
#   mp_clipboard          clipboard + work order sheet (readable in game)
#   mp_papers             a spill of loose sheets / folders across a floor (rushed evacuation)
#   mp_wheelchair_tipped  the ward wheelchair on its side
#   mp_chair_tipped       a waiting-room chair knocked over backwards
#   mp_gurney_sheet       a gurney left in the lobby, sheet half dragged off
#   mp_monitor_tipped     a monitor cart lying on its side (B11)
#   mp_ivstand_tipped     an IV stand on the floor (B11)
#   mp_boxes              archive boxes stacked for removal, one split open
#   mp_glass_shards       broken containment glass across the chamber floor
#   mp_straps             torn restraint straps with buckles
#   mp_notice_board       A-frame site notice (face material M_notice, UV 0..1, texture set in game)
#   mp_placard            steel procedure plate (face material M_placard, UV 0..1)
#   mp_beacon             amber/red rotating warning beacon (dome = M_beacon, lit in game)
#   mp_shutter_slat       one slat of the emergency roller shutter (instanced in game)
#   mp_shutter_bar        the shutter's bottom bar (hazard striped)
#   mp_shutter_frame      housing + guide rails (3.0 m corridor, 3.2 m ceiling)
#   mp_crank_base         wall plate of the manual shutter crank
#   mp_crank_wheel        the crank wheel + handle (origin on the axle; spins in game)
import math, os, sys
import numpy as np
import bpy
sys.path.insert(0, os.path.dirname(__file__))
import ns_lib
from ns_lib import MB, collection, std_materials, material
import ns_props as P


def grounded(b):
    """Drop the authored mesh so its lowest vertex sits on the floor (y = 0)."""
    miny = min(p[1] for p in b.v)
    b.v = [(x, y - miny, z) for (x, y, z) in b.v]
    return b


def build(export=True):
    ns_lib.reset_scene()
    M = std_materials()
    coll = collection('MP_DRESSING')
    out = []
    rng = np.random.default_rng(1987)
    leather = material('M_strap', color=(0.11, 0.07, 0.05), rough=0.55)
    cardboard = material('M_cardboard', color=(0.42, 0.31, 0.19), tex='paper_col', rough=0.95)
    notice = material('M_notice', color=(0.9, 0.9, 0.86), rough=0.85)
    placard = material('M_placard', color=(0.85, 0.85, 0.8), rough=0.5, metal=0.2)
    beacon = material('M_beacon', color=(0.6, 0.05, 0.02), emit=(1.0, 0.12, 0.03), emit_strength=0.0, rough=0.2)
    hazard = material('M_hazard', color=(0.72, 0.55, 0.08), rough=0.55)
    shard = material('M_glass_shard', color=(0.32, 0.38, 0.41), rough=0.04, metal=0.0, alpha=0.4)
    CAT = ns_lib.load_layout()['catalog']

    def emit(b, name):
        out.append(b.build(name, coll))

    # ---------------------------------------------------------------- clipboard (lies flat, top edge -z)
    b = MB()
    b.cbox(0, 0, 0, 0.235, 0.008, 0.32, M['wood'])                              # hardboard
    b.cbox(0, 0.008, -0.135, 0.11, 0.012, 0.04, M['steel'])                      # clip
    b.push(rot_y=0.03, offset=(0.004, 0.0085, 0.012))
    b.poly([(-0.105, 0, 0.14), (0.105, 0, 0.14), (0.105, 0, -0.14), (-0.105, 0, -0.14)], M['paper'], [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 1, 0))
    b.T = np.eye(4)
    emit(b, 'mp_clipboard')

    # ---------------------------------------------------------------- loose papers (scatter ~2.4 m)
    b = MB()
    for i in range(22):
        r = math.sqrt(rng.uniform(0, 1)) * 1.2
        a = rng.uniform(0, 2 * math.pi)
        x, z = math.cos(a) * r, math.sin(a) * r * 0.75
        y = 0.002 + i * 0.0006
        prev = b.push(rot_y=rng.uniform(-math.pi, math.pi), offset=(x, y, z))
        w, d = (0.21, 0.297) if rng.uniform() < 0.8 else (0.24, 0.32)
        if rng.uniform() < 0.25:                                                 # a folded / curled sheet
            fold = rng.uniform(0.15, 0.4)
            b.poly([(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, -d / 2), (-w / 2, 0, -d / 2)], M['paper'], [(0, 0.5), (1, 0.5), (1, 1), (0, 1)], normal=(0, 1, 0))
            b.poly([(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, math.sin(fold) * d / 2, math.cos(fold) * d / 2), (-w / 2, math.sin(fold) * d / 2, math.cos(fold) * d / 2)], M['paper'], [(0, 0.5), (1, 0.5), (1, 0), (0, 0)], normal=(0, 1, 0))
        elif rng.uniform() < 0.2:                                                # a manila folder
            b.cbox(0, 0, 0, w + 0.02, 0.004, d + 0.02, M['orange'])
        else:
            b.poly([(-w / 2, 0, d / 2), (w / 2, 0, d / 2), (w / 2, 0, -d / 2), (-w / 2, 0, -d / 2)], M['paper'], [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 1, 0))
        b.pop(prev)
    emit(b, 'mp_papers')

    # ---------------------------------------------------------------- knocked-over furniture
    b = MB(); prev = b.push(rot_z=-math.pi / 2 + 0.06)
    w = P.p_wheelchair(M, CAT['wheelchair']); b.v, b.f, b.uv, b.mi, b.sm, b.mats = w.v, w.f, w.uv, w.mi, w.sm, w.mats
    b.v = [b._xf(p) for p in b.v]; b.pop(prev)
    emit(grounded(b), 'mp_wheelchair_tipped')

    def tipped(builder, cat, name, **rot):
        src = builder(M, CAT[cat])
        b = MB(); b.push(**rot)
        b.v = [b._xf(p) for p in src.v]; b.f, b.uv, b.mi, b.sm, b.mats = src.f, src.uv, src.mi, src.sm, src.mats
        emit(grounded(b), name)

    tipped(P.p_chair, 'chair', 'mp_chair_tipped', rot_x=-math.pi / 2 + 0.12)
    tipped(P.p_monitor_cart, 'monitor_cart', 'mp_monitor_tipped', rot_z=math.pi / 2 - 0.05)
    tipped(P.p_iv_stand, 'iv_stand', 'mp_ivstand_tipped', rot_z=math.pi / 2 - 0.02)

    # gurney with the sheet dragged half off one side
    g = P.p_gurney(M, CAT['gurney']); b = MB()
    keep = [i for i, m in enumerate(g.mi) if g.mats[m] is not M['linen']]
    b.mats = list(g.mats)
    for i in keep:
        b.v.extend(g.v[k] for k in g.f[i]); n = len(b.v)
        b.f.append(list(range(n - len(g.f[i]), n))); b.uv.append(g.uv[i]); b.mi.append(g.mi[i]); b.sm.append(g.sm[i])
    gw, gd = CAT['gurney']['w'], CAT['gurney']['d']
    b.cbox(-0.06, 0.73, 0.05, gw - 0.1, 0.012, gd - 0.5, M['linen'], s=2)         # on the mattress
    prev = b.push(rot_z=-1.25, offset=(gw / 2 + 0.01, 0.74, 0.05))                 # draped over the edge
    b.cbox(0.18, 0, 0, 0.36, 0.01, gd - 0.6, M['linen'], s=2)
    b.pop(prev)
    b.cbox(gw / 2 + 0.28, 0.0, 0.2, 0.42, 0.012, 0.7, M['linen'], s=2)            # pooled on the floor
    emit(b, 'mp_gurney_sheet')

    # ---------------------------------------------------------------- archive boxes
    b = MB()
    for (x, y, z, ry) in ((0, 0, 0, 0.05), (0.43, 0, 0.04, -0.08), (0.2, 0.3, 0.02, 0.2), (-0.05, 0, 0.45, 0.6)):
        prev = b.push(rot_y=ry, offset=(x, y, z))
        b.cbox(0, 0, 0, 0.4, 0.3, 0.31, cardboard)
        b.cbox(0, 0.27, 0, 0.405, 0.035, 0.315, cardboard)                          # lid lip
        b.cbox(0, 0.12, 0.156, 0.12, 0.06, 0.004, M['paper'])                       # label
        b.pop(prev)
    for i in range(5):                                                               # files spilling out
        prev = b.push(rot_y=rng.uniform(-0.6, 0.6), offset=(-0.35 + i * 0.05, 0.003 + i * 0.004, 0.75 + rng.uniform(-0.1, 0.1)))
        b.cbox(0, 0, 0, 0.24, 0.006, 0.32, M['orange'] if i % 2 else M['paper'])
        b.pop(prev)
    emit(b, 'mp_boxes')

    # ---------------------------------------------------------------- broken containment glass
    b = MB()
    for i in range(110):
        r = math.sqrt(rng.uniform(0, 1)) * 1.6
        a = rng.uniform(-0.2, math.pi + 0.2)                                         # mostly on one side of the frame
        cx, cz = math.cos(a) * r, math.sin(a) * r * 0.6
        s = rng.uniform(0.015, 0.07) * (1.35 if r < 0.5 else 1)
        t = rng.uniform(0, 2 * math.pi)
        pts = [(cx + math.cos(t + k * 2.1 + rng.uniform(-0.4, 0.4)) * s, 0.003 + rng.uniform(0, 0.012), cz + math.sin(t + k * 2.1) * s) for k in range(3)]
        b.poly(pts, shard, [(0, 0), (1, 0), (0.5, 1)], normal=(0, 1, 0))
    for i in range(6):                                                               # bigger panes still standing in the frame bottom
        x = -1.2 + i * 0.48
        h = rng.uniform(0.08, 0.3)
        b.poly([(x, 0, 0), (x + 0.4, 0, 0), (x + rng.uniform(0.1, 0.35), h, 0)], shard, [(0, 0), (1, 0), (0.5, 1)])
    emit(b, 'mp_glass_shards')

    # ---------------------------------------------------------------- torn restraint straps
    b = MB()
    for i in range(5):
        prev = b.push(rot_y=rng.uniform(-math.pi, math.pi), offset=(rng.uniform(-0.6, 0.6), 0.004, rng.uniform(-0.5, 0.5)))
        L = rng.uniform(0.25, 0.55)
        b.cbox(0, 0, 0, 0.055, 0.006, L, leather)
        b.cbox(0, 0, L / 2 - 0.03, 0.07, 0.012, 0.05, M['steel'])                  # buckle
        for k in range(4):                                                           # frayed end
            b.cbox(-0.02 + k * 0.013, 0, -L / 2 - 0.02, 0.008, 0.005, 0.04 + rng.uniform(0, 0.03), leather)
        b.pop(prev)
    emit(b, 'mp_straps')

    # ---------------------------------------------------------------- notice board (A-frame), face UV 0..1
    b = MB()
    W, H = 0.62, 0.86
    prev = b.push(rot_x=-0.18, offset=(0, 0.25, 0.12))
    b.cbox(0, 0, 0, W + 0.06, H + 0.06, 0.025, M['dark'])
    b.poly([(-W / 2, 0.03, 0.0131), (W / 2, 0.03, 0.0131), (W / 2, 0.03 + H, 0.0131), (-W / 2, 0.03 + H, 0.0131)], notice, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, 1))
    b.pop(prev)
    for sx in (-1, 1):
        b.tube([(sx * 0.3, 0, 0.27), (sx * 0.3, 1.2, 0.04)], 0.014, M['steel'])
        b.tube([(sx * 0.3, 0, -0.25), (sx * 0.3, 1.2, 0.02)], 0.014, M['steel'])
    emit(b, 'mp_notice_board')

    # ---------------------------------------------------------------- procedure placard (on a wall, faces +Z)
    b = MB()
    b.cbox(0, 0, 0, 0.46, 0.34, 0.012, M['steel'])
    b.poly([(-0.21, 0.02, 0.0125), (0.21, 0.02, 0.0125), (0.21, 0.32, 0.0125), (-0.21, 0.32, 0.0125)], placard, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, 1))
    for sx in (-1, 1):
        for y in (0.012, 0.328):
            b.cyl((sx * 0.215, y, 0.012), 0.008, 0.004, M['dark'], seg=6, axis='z')
    emit(b, 'mp_placard')

    # ---------------------------------------------------------------- warning beacon (wall/ceiling mount, dome up)
    b = MB()
    b.cyl((0, 0, 0), 0.07, 0.04, M['dark'], seg=14)
    b.cyl((0, 0.04, 0), 0.06, 0.09, beacon, seg=16, r2=0.055)
    b.sphere((0, 0.13, 0), 0.055, 0.035, 0.055, beacon, seg=14, rings=6, ymin=0)
    for k in range(4):
        a = k * math.pi / 2
        b.tube([(math.cos(a) * 0.065, 0.04, math.sin(a) * 0.065), (math.cos(a) * 0.065, 0.16, math.sin(a) * 0.065)], 0.004, M['steel'], seg=4)
    emit(b, 'mp_beacon')

    # ---------------------------------------------------------------- emergency roller shutter
    SW = 3.04
    b = MB()                                                                          # one slat: curved profile, 0.1 pitch
    b.cbox(0, 0, 0, SW, 0.1, 0.022, M['metal'], s=0.7)
    b.cbox(0, 0.045, 0.011, SW, 0.012, 0.008, M['dark'])                              # interlock groove
    emit(b, 'mp_shutter_slat')
    b = MB()
    b.cbox(0, 0, 0, SW, 0.09, 0.05, M['dark'])
    for i in range(16):                                                               # hazard stripes
        x0 = -SW / 2 + i * SW / 16
        b.poly([(x0, 0.005, 0.0255), (x0 + SW / 32, 0.005, 0.0255), (x0 + SW / 32 + 0.06, 0.085, 0.0255), (x0 + 0.06, 0.085, 0.0255)], hazard, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, 1))
        b.poly([(x0 + 0.06, 0.005, -0.0255), (x0 + SW / 32 + 0.06, 0.005, -0.0255), (x0 + SW / 32, 0.085, -0.0255), (x0, 0.085, -0.0255)], hazard, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, -1))
    emit(b, 'mp_shutter_bar')
    b = MB()
    b.cbox(0, 2.86, 0, SW + 0.16, 0.34, 0.42, M['metal'])                             # housing under the ceiling
    b.cbox(0, 2.98, 0.212, 0.5, 0.12, 0.004, hazard)
    for sx in (-1, 1):                                                                # guide rails
        b.cbox(sx * (SW / 2 + 0.035), 0, 0, 0.07, 2.86, 0.1, M['dark'])
        b.cbox(sx * (SW / 2 - 0.005), 0, 0.04, 0.02, 2.86, 0.02, M['steel'])
        b.cbox(sx * (SW / 2 - 0.005), 0, -0.04, 0.02, 2.86, 0.02, M['steel'])
    emit(b, 'mp_shutter_frame')

    # ---------------------------------------------------------------- manual crank (wall, faces +Z)
    b = MB()
    b.cbox(0, 0, 0, 0.26, 0.34, 0.03, M['metal'])
    b.cbox(0, 0.26, 0.016, 0.22, 0.05, 0.004, hazard)
    b.cyl((0, 0.13, 0.03), 0.035, 0.05, M['dark'], seg=12, axis='z')
    emit(b, 'mp_crank_base')
    b = MB()
    b.cyl((0, 0, 0), 0.11, 0.02, M['orange'], seg=24, axis='z', r2=0.11)
    b.cyl((0, 0, 0), 0.085, 0.022, M['dark'], seg=24, axis='z')
    for k in range(5):
        a = k * 2 * math.pi / 5
        b.tube([(0, 0, 0.012), (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.012)], 0.008, M['steel'], seg=5)
    b.cyl((0.085, 0, 0.02), 0.014, 0.09, M['rubber'], seg=8, axis='z')               # handle
    emit(b, 'mp_crank_wheel')

    stats = {o.name: len(o.data.polygons) for o in out}
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'mp_dressing.glb')
        stats['bytes'] = ns_lib.export_glb(path, instances=False)
        os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Props'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Props', 'mp_dressing.blend'))
    return stats


if __name__ == '__main__':
    print('MPDRESS', build())
