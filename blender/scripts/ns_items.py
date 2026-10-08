# NIGHT SHIFT — interactive items, doors, vehicle and the reflection double.
# Exported to public/assets/models/items.glb as separate named root nodes.
import math, os
import numpy as np
import bpy
import ns_lib
from ns_lib import MB, to_b, collection, std_materials, material, text_mesh, join


def _obj(b, name, coll):
    return b.build(name, coll)


def build(export=True):
    ns_lib.reset_scene()
    M = std_materials()
    coll = collection('ITEMS')
    out = []
    brass = material('M_brass', color=(0.55, 0.42, 0.18), rough=0.35, metal=1.0)
    ceramic = material('M_ceramic', color=(0.82, 0.8, 0.74), tex='plastic_col', rough=0.4)
    lens = material('M_flash_lens', color=(0.9, 0.9, 0.8), emit=(1.0, 0.95, 0.8), emit_strength=0.0, rough=0.1)
    skin = material('M_human_skin', color=(0.55, 0.42, 0.36), rough=0.6)
    navy = material('M_uniform', color=(0.06, 0.07, 0.1), tex='vinyl_col', rough=0.85)
    teeth = material('M_teeth', color=(0.85, 0.8, 0.65), rough=0.3)
    eyes = material('M_eye_dark', color=(0.01, 0.01, 0.01), rough=0.1)
    car_paint = material('M_car_paint', color=(0.08, 0.1, 0.12), rough=0.25, metal=0.6)
    headlight = material('M_headlight', color=(1, 1, 0.9), emit=(1, 0.95, 0.8), emit_strength=3.0)
    taillight = material('M_taillight', color=(0.5, 0.02, 0.02), emit=(1, 0.05, 0.02), emit_strength=1.5)
    warn_y = material('M_warn_yellow', color=(0.75, 0.6, 0.08), tex='plastic_col', rough=0.5)

    # ---------------------------------------------------------------- doors (hinge at x=0, leaf along +x)
    def door(kind):
        b = MB(); w, h, t = 1.1, 2.15, 0.045
        mat = M['wood'] if kind == 'wood' else M['metal']
        b.box(0.0, 0.0, -t / 2, w, h, t / 2, mat, s=1 / 1.2)
        if kind == 'wood':
            # narrow vision panel
            b.box(0.72, 1.25, -t / 2 - 0.004, 0.92, 1.85, t / 2 + 0.004, M['dark'], faces='zZ')
            b.box(0.74, 1.27, -0.006, 0.9, 1.83, 0.006, M['glass'], faces='zZ')
            b.box(0.05, 0.02, -t / 2 - 0.003, w - 0.05, 0.28, t / 2 + 0.003, M['steel'], faces='zZ')
            for sz in (-1, 1):
                b.box(0.94, 0.98, sz * (t / 2), 1.02, 1.02, sz * (t / 2 + 0.06), M['steel'])
                b.box(0.86, 1.0, sz * (t / 2 + 0.05), 1.02, 1.025, sz * (t / 2 + 0.065), M['steel'])
        else:
            for i in range(6):
                b.box(0.25, 0.25 + i * 0.05, -t / 2 - 0.004, 0.85, 0.27 + i * 0.05, t / 2 + 0.004, M['dark'], faces='zZ')
            for sz in (-1, 1):
                b.box(0.2, 1.0, sz * (t / 2), 1.0, 1.05, sz * (t / 2 + 0.07), M['steel'])
            b.box(0.3, 1.6, -t / 2 - 0.003, 0.8, 1.8, t / 2 + 0.003, M['sign_red'], faces='zZ')
        for y in (0.25, 1.9):
            b.cyl((0.0, y, 0), 0.015, 0.12, M['steel'], seg=6)
        return b

    for kind in ('wood', 'metal'):
        out.append(_obj(door(kind), 'door_' + kind, coll))

    # entrance glass door leaf (hinge at x=0, leaf along +x, 1.3 wide)
    b = MB()
    w, h = 1.28, 2.55
    b.box(0, 0, -0.03, 0.06, h, 0.03, M['dark']); b.box(w - 0.06, 0, -0.03, w, h, 0.03, M['dark'])
    b.box(0, 0, -0.03, w, 0.12, 0.03, M['dark']); b.box(0, h - 0.08, -0.03, w, h, 0.03, M['dark'])
    b.box(0.06, 0.12, -0.006, w - 0.06, h - 0.08, 0.006, M['glass'], faces='zZ', s=1)
    b.box(0.2, 1.0, -0.06, 1.0, 1.04, 0.06, M['steel'])
    out.append(_obj(b, 'door_entrance', coll))

    # ---------------------------------------------------------------- movable furniture parts
    # Drawers: origin at the bottom-centre of the front panel's back face; the front faces +Z,
    # the tray extends to -Z (inside the furniture) and slides out along +Z.
    # Hinged doors: origin at the bottom of the hinge edge; the leaf extends along +X, faces +Z.
    def drawer(name, w, h, depth, front_mat, tray_mat, contents=True, seed=1):
        b = MB()
        b.box(-w / 2, 0, 0, w / 2, h, 0.02, front_mat)                         # front panel
        b.box(-0.06, h * 0.55, 0.02, 0.06, h * 0.55 + 0.022, 0.045, M['steel'])  # handle
        b.box(-0.05, h * 0.55, 0.02, -0.035, h * 0.55 + 0.022, 0.045, M['steel'])
        tw, th = w - 0.04, h - 0.04
        b.box(-tw / 2, 0.01, -depth, tw / 2, 0.022, 0, tray_mat)                 # bottom
        for sx in (-1, 1):
            b.box(sx * tw / 2 - 0.006, 0.01, -depth, sx * tw / 2 + 0.006, th, 0, tray_mat)
        b.box(-tw / 2, 0.01, -depth, tw / 2, th, -depth + 0.012, tray_mat)        # back
        if contents:
            rng = np.random.default_rng(seed)
            for k in range(3):
                b.push(rot_y=rng.uniform(-0.3, 0.3), offset=(rng.uniform(-tw / 4, tw / 4), 0.022 + k * 0.006, -depth * rng.uniform(0.3, 0.6)))
                b.cbox(0, 0, 0, tw * 0.6, 0.004, depth * 0.45, M['paper'], s=4)
                b.T = np.eye(4)
        out.append(_obj(b, name, coll))

    drawer('part_desk_drawer', 0.38, 0.19, 0.55, M['metal'], M['metal'], seed=3)
    drawer('part_filing_drawer', 0.46, 0.27, 0.56, M['metal'], M['metal'], seed=4)
    drawer('part_bedside_drawer', 0.44, 0.17, 0.36, M['metal'], M['metal'], seed=5)
    drawer('part_reception_drawer', 0.4, 0.22, 0.6, M['metal'], M['metal'], seed=6)

    def hinged(name, w, h, t, mat, glass=False, vents=False, tag=False):
        b = MB()
        b.box(0.0, 0.0, -t / 2, w, h, t / 2, mat)
        if glass:
            b.box(0.06, h * 0.5, -t / 2 - 0.002, w - 0.06, h - 0.08, t / 2 + 0.002, M['glass'], faces='zZ')
        if vents:
            for k in range(4):
                b.box(0.08, h - 0.25 - k * 0.04, t / 2, w - 0.08, h - 0.238 - k * 0.04, t / 2 + 0.004, M['dark'], faces='Z')
        if tag:
            b.box(w * 0.2, h * 0.62, t / 2, w * 0.45, h * 0.72, t / 2 + 0.003, M['paper'], faces='Z', s=8)
        for sz in (-1, 1):                                                         # handles on both faces
            b.box(w - 0.07, h * 0.48, sz * t / 2, w - 0.045, h * 0.48 + 0.12, sz * (t / 2 + 0.025), M['steel'] if not tag else M['dark'])
        out.append(_obj(b, name, coll))

    # louvred hiding-closet door: solid lower panel, angled slats at eye level you can peek through
    b = MB(); cw, ch, ct = 1.12, 2.1, 0.03
    b.box(0, 0, -ct / 2, cw, 1.25, ct / 2, M['metal'])                       # lower panel
    b.box(0, 1.9, -ct / 2, cw, ch, ct / 2, M['metal'])                       # top rail
    b.box(0, 1.25, -ct / 2, 0.08, 1.9, ct / 2, M['metal'])                   # stiles
    b.box(cw - 0.08, 1.25, -ct / 2, cw, 1.9, ct / 2, M['metal'])
    for k in range(13):                                                      # slats with gaps
        y = 1.28 + k * 0.047
        b.push(rot_x=0.55, offset=(cw / 2, y, 0))
        b.cbox(0, 0, 0, cw - 0.16, 0.026, 0.006 + ct * 0.6, M['metal'])
        b.T = np.eye(4)
    for sz in (-1, 1):
        b.box(cw - 0.12, 1.0, sz * ct / 2, cw - 0.09, 1.14, sz * (ct / 2 + 0.03), M['steel'])
    out.append(_obj(b, 'part_closet_door', coll))
    hinged('part_cabinet_door', 0.43, 1.7, 0.014, M['metal'], glass=True)
    hinged('part_locker_door', 0.37, 1.8, 0.014, M['green'], vents=True)
    hinged('part_fridge_door', 0.92, 0.6, 0.03, M['steel'], tag=True)

    # ---------------------------------------------------------------- flashlight (points -Z, origin at grip)
    b = MB()
    b.cyl((0, 0, 0.1), 0.019, -0.2, M['dark'], seg=12, axis='z')
    b.cyl((0, 0, -0.1), 0.019, -0.05, M['dark'], seg=12, axis='z', r2=0.032)
    b.cyl((0, 0, -0.15), 0.032, -0.03, M['steel'], seg=12, axis='z')
    b.cyl((0, 0, -0.18), 0.029, -0.002, lens, seg=12, axis='z')
    b.cbox(0, 0.017, 0.0, 0.012, 0.01, 0.03, M['rubber'])
    for i in range(6):
        b.cyl((0, 0, 0.08 - i * 0.025), 0.0195, -0.008, M['rubber'], seg=12, axis='z', caps=False)
    b.cyl((0, 0, 0.1), 0.017, 0.01, M['steel'], seg=10, axis='z')
    out.append(_obj(b, 'flashlight', coll))

    # ---------------------------------------------------------------- fuse
    # Industrial knife-blade cartridge fuse (~23 cm): white ceramic body, a red rating band,
    # brass end caps and flat blade terminals — unmistakable, and the brass catches the flashlight.
    fuse_red = material('M_fuse_band', color=(0.62, 0.07, 0.04), rough=0.45)
    b = MB(); r = 0.034; cy = r + 0.004
    b.cyl((-0.075, cy, 0), r, 0.15, ceramic, seg=16, axis='x')
    b.cyl((-0.035, cy, 0), r + 0.0015, 0.07, fuse_red, seg=16, axis='x')
    b.cyl((-0.03, cy, 0), r + 0.002, 0.008, ceramic, seg=16, axis='x')      # white stripe in the band
    b.cyl((0.018, cy, 0), r + 0.002, 0.008, ceramic, seg=16, axis='x')
    for sx, x0 in ((-1, -0.095), (1, 0.075)):
        b.cyl((x0, cy, 0), r + 0.004, 0.02, brass, seg=16, axis='x')         # end caps
        bx = -0.115 if sx < 0 else 0.095
        b.box(bx, cy - 0.004, -0.017, bx + 0.02, cy + 0.004, 0.017, brass)   # blade tab
        b.cyl((bx + 0.01, cy - 0.005, 0), 0.006, 0.01, M['dark'], seg=8)     # mounting hole
    b.box(-0.07, 0.004, -0.02, 0.075, 0.006, 0.02, M['rubber'], faces='y')
    out.append(_obj(b, 'fuse', coll))

    # ---------------------------------------------------------------- batteries
    # A pair of D-cells: black body, gold/copper top halves and a pale label band —
    # the classic battery look, readable in a flashlight beam.
    copper = material('M_battery_copper', color=(0.6, 0.33, 0.12), rough=0.3, metal=0.85)
    label = material('M_battery_label', color=(0.8, 0.78, 0.7), tex='plastic_col', rough=0.4)
    b = MB(); r = 0.0225; L = 0.0615
    for sx in (-0.024, 0.024):
        y = r + 0.001
        b.cyl((sx, y, -L / 2), r, L * 0.55, M['dark'], seg=14, axis='z')
        b.cyl((sx, y, -L / 2 + L * 0.55), r, L * 0.45, copper, seg=14, axis='z')
        b.cyl((sx, y, -L * 0.08), r + 0.0008, 0.012, label, seg=14, axis='z')
        b.cyl((sx, y, L / 2), 0.008, 0.004, M['steel'], seg=10, axis='z')   # + terminal
    b.box(-0.047, 0.012, -0.004, 0.047, 0.036, 0.004, label)                 # tape band holding the pair
    out.append(_obj(b, 'battery', coll))

    # ---------------------------------------------------------------- key with tag
    b = MB()
    b.cyl((0, 0.002, 0), 0.016, 0.004, brass, seg=10)
    b.box(0.014, 0.002, -0.004, 0.07, 0.006, 0.004, brass)
    for i in range(3):
        b.box(0.04 + i * 0.01, 0.002, 0.004, 0.046 + i * 0.01, 0.006, 0.009, brass)
    b.tube([(-0.016, 0.004, 0), (-0.04, 0.004, 0.02)], 0.002, M['steel'], seg=4)
    b.push(rot_y=0.4, offset=(-0.07, 0.0, 0.03))
    b.cbox(0, 0, 0, 0.06, 0.002, 0.035, warn_y)
    b.T = np.eye(4)
    out.append(_obj(b, 'key', coll))

    # ---------------------------------------------------------------- desk phone + handset
    b = MB()
    b.cbox(0, 0, 0, 0.22, 0.05, 0.22, M['dark'])
    b.push(rot_x=0.25, offset=(0, 0.05, 0.03))
    b.cbox(0, 0, 0, 0.2, 0.04, 0.14, M['dark'])
    b.T = np.eye(4)
    for i in range(4):
        for j in range(3):
            b.cbox(-0.04 + j * 0.04, 0.085 - i * 0.009, 0.07 - i * 0.03, 0.025, 0.01, 0.018, M['plastic'])
    b.cbox(-0.085, 0.05, -0.06, 0.04, 0.035, 0.06, M['dark'])
    b.cbox(0.085, 0.05, -0.06, 0.04, 0.035, 0.06, M['dark'])
    b.tube([(0.11, 0.02, 0.0), (0.16, 0.02, 0.05), (0.14, 0.02, -0.05), (0.09, 0.09, -0.06)], 0.004, M['dark'], seg=4)
    out.append(_obj(b, 'phone_desk', coll))
    b = MB()
    b.cbox(0, 0, 0, 0.22, 0.03, 0.05, M['dark'])
    for sx in (-1, 1):
        b.cbox(sx * 0.09, -0.02, 0, 0.05, 0.03, 0.06, M['dark'])
    out.append(_obj(b, 'phone_handset', coll))  # origin near rest position: placed at (0, 0.09, -0.06) on base
    b = MB()  # wall phone (faces +z, origin at back centre)
    b.box(-0.09, -0.15, 0, 0.09, 0.15, 0.07, M['plastic'])
    b.box(-0.04, -0.12, 0.07, 0.04, 0.12, 0.11, M['plastic'])
    b.tube([(0.04, -0.1, 0.09), (0.0, -0.3, 0.06), (0.03, -0.45, 0.08), (0.06, -0.12, 0.07)], 0.004, M['plastic'], seg=4)
    out.append(_obj(b, 'phone_wall', coll))

    # ---------------------------------------------------------------- reception drawer (origin front-panel bottom centre; tray toward +z)
    b = MB()
    b.box(-0.25, 0.0, -0.02, 0.25, 0.13, 0.0, M['wood'])
    b.box(-0.06, 0.055, -0.035, 0.06, 0.07, -0.02, M['steel'])
    b.box(-0.23, 0.01, 0.0, 0.23, 0.02, 0.45, M['wood'], faces='YyX')
    b.box(-0.235, 0.01, 0.0, -0.225, 0.11, 0.45, M['wood'])
    b.box(0.225, 0.01, 0.0, 0.235, 0.11, 0.45, M['wood'])
    b.box(-0.23, 0.01, 0.44, 0.23, 0.11, 0.45, M['wood'])
    b.push(rot_y=0.3, offset=(0.1, 0.02, 0.3)); b.cbox(0, 0, 0, 0.15, 0.003, 0.2, M['paper'], s=4); b.T = np.eye(4)
    out.append(_obj(b, 'drawer', coll))

    # ---------------------------------------------------------------- wall clock (faces +z, origin centre)
    b = MB()
    b.cyl((0, 0, -0.03), 0.17, 0.05, M['dark'], seg=24, axis='z')
    b.cyl((0, 0, 0.0), 0.155, 0.021, material('M_clock_face', color=(0.85, 0.83, 0.75), rough=0.6), seg=24, axis='z')
    for i in range(12):
        a = i / 12 * math.tau
        b.push(rot_z=-a, offset=(0, 0, 0.022))
        b.box(-0.004, 0.12, 0, 0.004, 0.145 if i % 3 else 0.135, 0.002, M['rubber'])
        b.T = np.eye(4)
    b.cyl((0, 0, 0.02), 0.155, 0.012, M['glass'], seg=24, axis='z', caps=True)
    out.append(_obj(b, 'clock_body', coll))
    b = MB(); b.box(-0.006, -0.015, 0, 0.006, 0.085, 0.003, M['rubber']); out.append(_obj(b, 'clock_hour', coll))
    b = MB(); b.box(-0.004, -0.02, 0, 0.004, 0.125, 0.003, M['rubber']); out.append(_obj(b, 'clock_min', coll))

    # ---------------------------------------------------------------- power lever (pivot at base, handle up when OFF, rotates on x)
    b = MB()
    b.cbox(0, -0.12, -0.05, 0.22, 0.24, 0.1, M['dark'])
    b.box(-0.015, 0, -0.015, 0.015, 0.32, 0.015, M['steel'])
    b.cyl((-0.08, 0.32, 0), 0.025, 0.16, M['sign_red'], seg=8, axis='x')
    out.append(_obj(b, 'power_lever', coll))

    # ---------------------------------------------------------------- warning sign (faces +z, origin centre)
    b = MB()
    b.box(-0.5, -0.36, -0.01, 0.5, 0.36, 0.0, material('M_warn_plate', color=(0.78, 0.76, 0.68), tex='paper_col', rough=0.6))
    b.box(-0.5, 0.2, 0.0, 0.5, 0.36, 0.002, M['sign_red'], faces='Z')
    b.box(-0.47, -0.33, 0.0, 0.47, -0.2, 0.002, warn_y, faces='Z')
    sign_o = b.build('warning_sign_plate', coll)
    parts = [sign_o]
    lines = [('DANGER', 0.085, 0.28, M['sign'], 'Z'), ('DO NOT RESTORE AUXILIARY POWER', 0.038, 0.1, M['rubber'], None),
             ('WITHOUT AUTHORIZATION.', 0.038, 0.03, M['rubber'], None),
             ('CONTAINMENT SYSTEM — ACTIVE', 0.045, -0.265, M['rubber'], None),
             ('ST. MERCY HOSPITAL  ·  SUB-LEVEL B  ·  1987', 0.018, -0.12, M['rubber'], None)]
    for txt, size, yy, mat, _ in lines:
        tm = text_mesh(txt, size, coll, mat, extrude=0.001)
        to = bpy.data.objects.new('wtxt', tm); coll.objects.link(to)
        to.rotation_euler = (math.pi / 2, 0, 0)
        to.location = to_b((0, yy, 0.004))
        parts.append(to)
    ws = join(parts, 'warning_sign')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    out.append(ws)

    # ---------------------------------------------------------------- car (forward +z, origin ground centre)
    b = MB()
    L, W = 4.5, 1.8
    b.box(-W / 2, 0.3, -L / 2, W / 2, 0.85, L / 2, car_paint, s=0.5)
    b.box(-W / 2 + 0.08, 0.85, -L / 2 + 0.9, W / 2 - 0.08, 1.38, L / 2 - 1.4, car_paint, s=0.5)
    # windows
    for sx in (-1, 1):
        b.box(sx * (W / 2 - 0.079), 0.9, -L / 2 + 1.0, sx * (W / 2 - 0.07), 1.32, L / 2 - 1.5, M['screen'], faces='xX')
    b.box(-W / 2 + 0.12, 0.9, L / 2 - 1.41, W / 2 - 0.12, 1.32, L / 2 - 1.39, M['screen'], faces='Z')
    b.box(-W / 2 + 0.12, 0.9, -L / 2 + 0.89, W / 2 - 0.12, 1.32, -L / 2 + 0.91, M['screen'], faces='z')
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.cyl((sx * (W / 2 - 0.12), 0.33, sz * (L / 2 - 0.8)), 0.33, 0.24 * sx, M['rubber'], seg=14, axis='x')
        b.box(sx * 0.6 - 0.18, 0.6, L / 2, sx * 0.6 + 0.18, 0.75, L / 2 + 0.01, headlight, faces='Z')
        b.box(sx * 0.65 - 0.15, 0.62, -L / 2 - 0.01, sx * 0.65 + 0.15, 0.74, -L / 2, taillight, faces='z')
    b.box(-0.7, 0.35, L / 2, 0.7, 0.45, L / 2 + 0.05, M['steel'])
    b.box(-0.7, 0.35, -L / 2 - 0.05, 0.7, 0.45, -L / 2, M['steel'])
    out.append(_obj(b, 'car', coll))

    # ---------------------------------------------------------------- Arman's reflection double (feet origin, faces +z)
    b = MB()
    for sx in (-1, 1):
        b.cyl((sx * 0.1, 0.0, 0.03), 0.065, 0.1, M['rubber'], seg=8)  # shoes
        b.cbox(sx * 0.1, 0.0, 0.08, 0.1, 0.08, 0.12, M['rubber'])
        b.cyl((sx * 0.1, 0.08, 0), 0.075, 0.8, navy, seg=10, r2=0.085)  # legs
        b.cyl((sx * 0.25, 0.85, 0.0), 0.05, 0.6, navy, seg=8, r2=0.06)  # arms hanging
        b.sphere((sx * 0.25, 0.82, 0.0), 0.045, 0.06, 0.04, skin, seg=8, rings=5)
    b.cyl((0, 0.88, 0), 0.19, 0.58, navy, seg=12, r2=0.22)  # torso
    b.cbox(0, 1.46, 0, 0.5, 0.06, 0.24, navy)
    b.cyl((0, 1.46, 0), 0.06, 0.1, skin, seg=8)
    b.cbox(0.11, 1.25, 0.2, 0.08, 0.1, 0.01, brass)  # badge
    b.cbox(0, 0.88, 0.0, 0.42, 0.05, 0.3, M['dark'])  # belt
    head = (0, 1.66, 0.0)
    b.sphere(head, 0.1, 0.125, 0.11, skin, seg=14, rings=10)
    b.sphere((0, 1.6, 0.05), 0.075, 0.06, 0.07, skin, seg=10, rings=6)   # jaw
    for sx in (-1, 1):
        b.sphere((sx * 0.037, 1.685, 0.092), 0.022, 0.014, 0.012, eyes, seg=8, rings=5)
        b.sphere((sx * 0.104, 1.66, 0.0), 0.014, 0.03, 0.02, skin, seg=6, rings=4)
    b.cyl((0, 1.74, 0.0), 0.112, 0.05, navy, seg=14)  # cap
    b.cyl((0, 1.79, 0.0), 0.105, 0.04, navy, seg=14, r2=0.09)
    b.push(rot_x=-0.15, offset=(0, 1.745, 0.1)); b.cbox(0, 0, 0, 0.18, 0.012, 0.1, M['rubber']); b.T = np.eye(4)
    b.cbox(0, 1.635, 0.105, 0.05, 0.006, 0.006, material('M_lips', color=(0.3, 0.15, 0.13), rough=0.6))  # neutral mouth
    out.append(_obj(b, 'arman', coll))
    # The smile: a crescent of teeth, scaled from 0 -> 1 in-game
    b = MB()
    n = 10
    for i in range(n):
        t0 = -1 + 2 * i / n; t1 = -1 + 2 * (i + 1) / n
        x0, x1 = t0 * 0.042, t1 * 0.042
        y0, y1 = 0.012 * t0 * t0, 0.012 * t1 * t1
        b.poly([(x0, y0 - 0.006, 0), (x1, y1 - 0.006, 0), (x1, y1 + 0.004, 0.001), (x0, y0 + 0.004, 0.001)], teeth, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, 1))
        b.poly([(x0, y0 - 0.0085, -0.0005), (x1, y1 - 0.0085, -0.0005), (x1, y1 - 0.006, 0.0005), (x0, y0 - 0.006, 0.0005)], eyes, [(0, 0), (1, 0), (1, 1), (0, 1)], normal=(0, 0, 1))
    out.append(_obj(b, 'arman_smile', coll))

    # ================================================================ ACT II props
    hazard = material('M_hazard', color=(0.72, 0.55, 0.06), tex='plastic_col', rough=0.55)
    hz_dark = material('M_hazard_dark', color=(0.04, 0.04, 0.04), rough=0.6)
    leather = material('M_strap_leather', color=(0.16, 0.09, 0.05), rough=0.75)
    crt_body = material('M_crt_body', color=(0.42, 0.4, 0.35), tex='plastic_col', rough=0.6)

    def label(txt, size, pos, mat, parts, rot_y=0.0):
        tm = text_mesh(txt, size, coll, mat, extrude=0.0012)
        to = bpy.data.objects.new('lbl', tm); coll.objects.link(to)
        to.rotation_euler = (math.pi / 2, 0, rot_y)
        to.location = to_b(pos)
        parts.append(to)

    # ---------------------------------------------------------------- emergency containment switch box
    # wall mounted, faces +z, origin = bottom-centre of the back plate (on the wall). The handle is a
    # separate part ('switch_handle', pivot at its hinge) that JS rotates from UP (off) to DOWN (on).
    b = MB()
    W_, H_, D_ = 0.5, 0.72, 0.17
    b.box(-W_ / 2, 0, 0, W_ / 2, H_, D_, M['metal'])                                  # cabinet
    for i in range(9):                                                                 # hazard border
        x = -W_ / 2 + i * W_ / 9
        b.box(x, H_ - 0.06, D_, x + W_ / 18, H_ - 0.01, D_ + 0.003, hazard, faces='Z')
        b.box(x + W_ / 18, H_ - 0.06, D_, x + W_ / 9, H_ - 0.01, D_ + 0.003, hz_dark, faces='Z')
        b.box(x, 0.01, D_, x + W_ / 18, 0.06, D_ + 0.003, hz_dark, faces='Z')
        b.box(x + W_ / 18, 0.01, D_, x + W_ / 9, 0.06, D_ + 0.003, hazard, faces='Z')
    b.box(-0.2, H_ - 0.2, D_, 0.2, H_ - 0.09, D_ + 0.004, M['sign_red'], faces='Z')      # label plate
    b.box(-0.07, 0.24, D_, 0.07, 0.52, D_ + 0.03, M['dark'])                            # handle slot
    b.box(-0.03, 0.26, D_ + 0.03, 0.03, 0.5, D_ + 0.032, hz_dark, faces='Z')
    b.box(0.13, 0.12, D_, 0.21, 0.2, D_ + 0.012, M['dark'])                             # lamp housing
    for sx in (-1, 1):
        for sy in (0.09, H_ - 0.09):
            b.cyl((sx * (W_ / 2 - 0.03), sy, D_ + 0.002), 0.008, 0.006, M['steel'], seg=6, axis='z')
    b.tube([(0.0, -0.4, 0.06), (0.0, 0.0, 0.06)], 0.02, M['dark'], seg=6)              # conduit down the wall
    sw = b.build('switch_box_body', coll)
    parts = [sw]
    label('EMERGENCY', 0.032, (0, H_ - 0.135, D_ + 0.0045), M['sign'], parts)
    label('CONTAINMENT', 0.022, (0, H_ - 0.175, D_ + 0.0045), M['sign'], parts)
    label('ON', 0.02, (-0.11, 0.27, D_ + 0.0015), M['sign'], parts)
    label('OFF', 0.02, (-0.11, 0.48, D_ + 0.0015), M['sign'], parts)
    o = join(parts, 'switch_box'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); out.append(o)
    b = MB()                                                                            # handle: pivot at origin, points UP
    b.box(-0.016, 0, -0.016, 0.016, 0.2, 0.016, M['steel'])
    b.cyl((-0.06, 0.2, 0), 0.022, 0.12, M['sign_red'], seg=10, axis='x')
    out.append(_obj(b, 'switch_handle', coll))
    b = MB(); b.cbox(0, 0, 0, 0.06, 0.06, 0.01, material('M_lamp_glass', color=(0.8, 0.8, 0.8), rough=0.2)); out.append(_obj(b, 'switch_lamp', coll))

    # ---------------------------------------------------------------- CCTV monitor rack (faces +z, origin floor centre)
    # four CRTs in a steel rack + a desk shelf with a control panel. Screen rectangles (filled
    # with live camera feeds in JS) sit at x = ±0.36, y = 1.08 / 1.52, z = 0.33 (front face).
    b = MB()
    for sx in (-0.8, 0.8):
        b.box(sx - 0.03, 0, -0.25, sx + 0.03, 1.95, -0.19, M['dark'])                 # rear posts
        b.box(sx - 0.03, 0, 0.25, sx + 0.03, 0.82, 0.31, M['dark'])                   # front posts
    for y in (0.78, 1.3, 1.74):
        b.box(-0.83, y, -0.25, 0.83, y + 0.03, 0.3 if y < 1 else 0.2, M['metal'])      # shelves
    b.box(-0.83, 0.72, 0.3, 0.83, 0.8, 0.5, M['metal'])                               # desk lip
    b.box(-0.5, 0.8, 0.32, 0.5, 0.83, 0.47, M['dark'])                                # keyboard / panel
    for i in range(10):
        b.cyl((-0.42 + i * 0.09, 0.835, 0.4), 0.012, 0.012, M['sign_red'] if i % 3 == 0 else M['plastic'], seg=6)
    for sx in (-0.36, 0.36):
        for y in (0.81, 1.33):
            b.box(sx - 0.31, y, -0.2, sx + 0.31, y + 0.42, 0.3, crt_body, s=2)       # CRT case
            b.box(sx - 0.24, y + 0.06, 0.3, sx + 0.24, y + 0.36, 0.33, crt_body)       # bezel
            b.box(sx - 0.22, y + 0.075, 0.33, sx + 0.22, y + 0.345, 0.333, M['screen'], faces='Z')   # glass (feed overlaid in JS)
            b.box(sx + 0.17, y + 0.02, 0.3, sx + 0.21, y + 0.045, 0.335, M['dark'])    # knob strip
    b.tube([(0.8, 0.2, -0.22), (0.5, 0.05, -0.3), (-0.2, 0.02, -0.32)], 0.012, M['rubber'], seg=4)
    out.append(_obj(b, 'cctv_rack', coll))
    # a security camera (wall/ceiling bracket, faces +z, origin at the bracket on the wall)
    b = MB()
    b.box(-0.04, -0.04, 0, 0.04, 0.04, 0.12, M['dark'])
    b.push(rot_x=-0.45, offset=(0, -0.02, 0.16)); b.cbox(0, 0, 0, 0.11, 0.1, 0.24, M['plastic']); b.cyl((0, 0, 0.12), 0.035, 0.02, M['screen'], seg=10, axis='z'); b.T = np.eye(4)
    out.append(_obj(b, 'cctv_camera', coll))

    # ---------------------------------------------------------------- containment partition (faces +z = antechamber side)
    # origin floor centre; spans x -4..4, 3.2 m high (to the ceiling); door opening x -0.7..0.7.
    b = MB()
    for x in (-4.0, -2.4, -0.78, 0.78, 2.4, 4.0):
        b.box(x - 0.08, 0, -0.1, x + 0.08, 3.2, 0.1, M['steel'], s=2)                  # posts
    b.box(-4.0, 0, -0.14, -0.78, 0.22, 0.14, M['metal'])                               # kerb
    b.box(0.78, 0, -0.14, 4.0, 0.22, 0.14, M['metal'])
    b.box(-4.0, 2.42, -0.12, 4.0, 3.2, 0.12, M['metal'])                               # header
    b.box(-0.9, 2.36, 0.12, 0.9, 2.44, 0.18, M['dark'])                                # door track
    for i in range(16):                                                                # hazard stripe on the header
        x = -4 + i * 0.5
        b.box(x, 2.48, 0.12, x + 0.25, 2.6, 0.123, hazard, faces='Z')
        b.box(x + 0.25, 2.48, 0.12, x + 0.5, 2.6, 0.123, hz_dark, faces='Z')
    cf = b.build('containment_frame_body', coll)
    parts = [cf]
    label('CONTAINMENT  01', 0.11, (-2.0, 2.66, 0.125), M['sign'], parts)
    label('AUTHORISED PERSONNEL ONLY', 0.05, (2.2, 2.68, 0.125), M['sign'], parts)
    o = join(parts, 'containment_frame'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); out.append(o)
    # sliding door leaf (origin bottom centre; slides along x in JS)
    b = MB()
    b.box(-0.72, 0.22, -0.05, 0.72, 0.3, 0.05, M['steel'])
    b.box(-0.72, 2.28, -0.05, 0.72, 2.36, 0.05, M['steel'])
    b.box(-0.72, 0.22, -0.05, -0.64, 2.36, 0.05, M['steel'])
    b.box(0.64, 0.22, -0.05, 0.72, 2.36, 0.05, M['steel'])
    b.box(-0.66, 1.12, 0.05, -0.6, 1.5, 0.08, M['dark'])                               # pull bar
    out.append(_obj(b, 'containment_door', coll))

    # ---------------------------------------------------------------- restraint bed (faces +z, origin floor centre)
    b = MB()
    b.box(-0.45, 0.0, -1.0, 0.45, 0.08, 1.0, M['steel'])                               # floor plate (bolted)
    for sx in (-0.38, 0.38):
        for sz in (-0.9, 0.9):
            b.box(sx - 0.04, 0.08, sz - 0.04, sx + 0.04, 0.62, sz + 0.04, M['steel'])
    b.box(-0.45, 0.62, -1.0, 0.45, 0.7, 1.0, M['steel'])
    b.box(-0.42, 0.7, -0.97, 0.42, 0.8, 0.97, M['vinyl'], s=2)                         # stained pad
    b.box(-0.45, 0.7, -1.0, 0.45, 1.25, -0.94, M['steel'])                             # head board
    for z, broken in ((-0.6, False), (-0.05, True), (0.55, True)):                     # torn straps
        b.box(-0.47, 0.6, z - 0.05, -0.43, 0.82, z + 0.05, leather)
        b.box(-0.47, 0.8, z - 0.05, 0.43 if not broken else -0.05, 0.82, z + 0.05, leather)
        if broken:
            b.push(rot_z=0.9, offset=(0.42, 0.55, z)); b.cbox(0, 0, 0, 0.04, 0.3, 0.1, leather); b.T = np.eye(4)
            b.push(rot_z=-0.4, offset=(-0.02, 0.85, z)); b.cbox(0, 0, 0, 0.12, 0.012, 0.1, leather); b.T = np.eye(4)
        b.box(0.4, 0.74, z - 0.03, 0.47, 0.8, z + 0.03, M['steel'])                    # buckles
    out.append(_obj(b, 'restraint_bed', coll))

    # ---------------------------------------------------------------- document folder (lies flat, origin bottom centre)
    b = MB()
    b.box(-0.17, 0, -0.12, 0.17, 0.012, 0.12, material('M_folder', color=(0.42, 0.33, 0.18), tex='paper_col', rough=0.8))
    for k in range(4):
        b.push(rot_y=(k - 1.5) * 0.03, offset=(0.01 * k, 0.013 + k * 0.002, 0)); b.cbox(0, 0, 0, 0.3, 0.002, 0.21, M['paper'], s=4); b.T = np.eye(4)
    b.box(-0.17, 0.02, 0.06, 0.05, 0.022, 0.1, M['sign_red'], faces='Y')                # CONFIDENTIAL stamp band
    out.append(_obj(b, 'document_folder', coll))

    # ---------------------------------------------------------------- control console (faces +z, origin floor centre)
    b = MB()
    b.box(-0.8, 0, -0.35, 0.8, 0.85, 0.35, M['metal'])
    b.push(rot_x=-0.45, offset=(0, 0.92, 0.05)); b.cbox(0, 0, 0, 1.6, 0.06, 0.5, M['metal'])
    for i in range(6):
        b.cyl((-0.6 + i * 0.24, 0.035, -0.05), 0.06, 0.012, M['dark'], seg=12)          # gauges
        b.cyl((-0.6 + i * 0.24, 0.045, -0.05), 0.05, 0.004, material('M_gauge', color=(0.8, 0.78, 0.7), rough=0.4), seg=12)
        b.cbox(-0.6 + i * 0.24, 0.04, 0.15, 0.05, 0.03, 0.05, M['sign_red'] if i % 2 else M['green'])
    b.T = np.eye(4)
    b.box(-0.8, 0.85, -0.35, 0.8, 1.5, -0.25, M['metal'])
    out.append(_obj(b, 'control_console', coll))

    # ---------------------------------------------------------------- the employee (morning; faces +z, feet origin)
    scrubs = material('M_scrubs', color=(0.16, 0.36, 0.38), rough=0.9)
    hair = material('M_hair', color=(0.06, 0.04, 0.03), rough=0.7)
    skin2 = material('M_skin_employee', color=(0.62, 0.47, 0.38), rough=0.6)
    white = material('M_shoe_white', color=(0.8, 0.8, 0.78), rough=0.6)
    b = MB()
    for sx in (-1, 1):
        b.cbox(sx * 0.09, 0.0, 0.05, 0.1, 0.08, 0.24, white)                             # clogs
        b.cyl((sx * 0.09, 0.08, 0), 0.07, 0.78, scrubs, seg=10, r2=0.085)              # legs
        b.cyl((sx * 0.235, 0.86, 0.0), 0.045, 0.56, skin2, seg=8, r2=0.055)             # forearms
        b.cyl((sx * 0.235, 1.15, 0.0), 0.06, 0.3, scrubs, seg=8, r2=0.065)              # sleeves
        b.sphere((sx * 0.235, 0.84, 0.0), 0.04, 0.055, 0.035, skin2, seg=8, rings=5)
    b.cyl((0, 0.86, 0), 0.18, 0.58, scrubs, seg=12, r2=0.205)
    b.cbox(0, 1.44, 0, 0.44, 0.06, 0.22, scrubs)
    b.cyl((0, 1.44, 0), 0.055, 0.1, skin2, seg=8)
    b.tube([(-0.07, 1.42, 0.08), (0.0, 1.2, 0.17), (0.07, 1.42, 0.08)], 0.006, M['sign_red'], seg=4)   # lanyard
    b.cbox(0, 1.16, 0.18, 0.06, 0.08, 0.005, M['sign'])                                 # ID card
    head = (0, 1.63, 0.0)
    b.sphere(head, 0.095, 0.12, 0.105, skin2, seg=14, rings=10)
    b.sphere((0, 1.67, -0.02), 0.102, 0.11, 0.105, hair, seg=14, rings=10, ymin=-0.05)   # hair cap
    b.sphere((0, 1.7, -0.11), 0.05, 0.05, 0.05, hair, seg=10, rings=6)                   # bun
    for sx in (-1, 1):
        b.sphere((sx * 0.035, 1.655, 0.088), 0.02, 0.012, 0.01, eyes, seg=8, rings=5)
    b.cbox(0, 1.6, 0.1, 0.045, 0.005, 0.006, material('M_lips2', color=(0.35, 0.17, 0.15), rough=0.6))
    out.append(_obj(b, 'employee', coll))

    stats = {o.name: len(o.data.polygons) for o in out if o.type == 'MESH'}
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'items.glb')
        stats['bytes'] = ns_lib.export_glb(path, instances=False)
        os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Props'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Props', 'items.blend'))
    return stats
