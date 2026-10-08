# NIGHT SHIFT â€” hospital prop models. Each builder returns an MB authored in
# three.js space: origin at floor centre, front facing +Z, dimensions matching the
# layout catalogue (w along X, d along Z, h up).
import math
import numpy as np
from ns_lib import MB


def legs4(b, w, d, h, r, M, inset=0.04, mat=None):
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.cyl((sx * (w / 2 - inset), 0, sz * (d / 2 - inset)), r, h, mat or M['steel'], seg=6)


def caster_legs(b, w, d, h, M):
    for sx in (-1, 1):
        for sz in (-1, 1):
            x = sx * (w / 2 - 0.06); z = sz * (d / 2 - 0.06)
            b.cyl((x, 0.0, z), 0.035, 0.07, M['rubber'], seg=6, axis='x')
            b.cyl((x, 0.07, z), 0.015, h - 0.07, M['steel'], seg=6)


def p_bed(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    caster_legs(b, w, d, 0.32, M)
    b.cbox(0, 0.32, 0, w, 0.08, d, M['metal'])
    b.cbox(0, 0.40, 0.02, w - 0.08, 0.18, d - 0.12, M['linen'], s=1.5)
    # pillow
    b.cbox(0, 0.58, -d / 2 + 0.3, w - 0.25, 0.08, 0.35, M['linen'], s=1.5)
    # crumpled sheet
    b.push(rot_z=0.04, offset=(0.05, 0.58, 0.25))
    b.cbox(0, 0, 0, w - 0.05, 0.035, d * 0.55, M['linen'], s=2)
    b.T = np.eye(4)
    # head / foot boards
    b.cbox(0, 0.32, -d / 2 + 0.02, w, 0.62, 0.04, M['metal'])
    b.cbox(0, 0.32, d / 2 - 0.02, w, 0.42, 0.04, M['metal'])
    # side rails
    for sx in (-1, 1):
        b.tube([(sx * (w / 2 + 0.02), 0.55, -0.6), (sx * (w / 2 + 0.02), 0.55, 0.3)], 0.015, M['steel'])
        b.tube([(sx * (w / 2 + 0.02), 0.42, -0.6), (sx * (w / 2 + 0.02), 0.55, -0.6)], 0.012, M['steel'])
        b.tube([(sx * (w / 2 + 0.02), 0.42, 0.3), (sx * (w / 2 + 0.02), 0.55, 0.3)], 0.012, M['steel'])
    return b


# Movable drawers / doors are separate models in items.glb (ns_items.py) animated by the
# game (src/world/containers.js). Static props keep only the carcass + a dark recess.

def slot(b, M, x, y, z, w, h):
    """Dark recess on the carcass face (z = face), hidden by the drawer front until it is pulled out."""
    b.cbox(x, y, z + 0.003, w, h, 0.006, M['rubber'])


def p_bedside(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0.05, 0, w, h - 0.05, d - 0.02, M['metal'])
    b.cbox(0, 0, 0, w - 0.04, 0.05, d - 0.04, M['dark'])
    slot(b, M, 0, h - 0.33, (d - 0.02) / 2, w - 0.08, 0.17)
    b.cbox(0.08, h, -0.05, 0.08, 0.12, 0.08, M['plastic'])  # cup
    return b


def p_desk(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, h - 0.035, 0, w, 0.035, d, M['wood'])
    b.cbox(-w / 2 + 0.22, 0, 0, 0.42, h - 0.035, d - 0.04, M['metal'])
    for i in range(3):
        slot(b, M, -w / 2 + 0.22, 0.08 + i * 0.22, (d - 0.04) / 2, 0.36, 0.18)
    b.cbox(w / 2 - 0.03, 0, 0, 0.04, h - 0.035, d - 0.04, M['metal'])
    b.cbox(0.1, 0.3, -d / 2 + 0.03, w - 0.5, 0.4, 0.02, M['metal'])
    # papers / folder
    b.push(rot_y=0.3, offset=(0.2, h, 0.05)); b.cbox(0, 0, 0, 0.3, 0.012, 0.22, M['paper'], s=4); b.T = np.eye(4)
    b.push(rot_y=-0.2, offset=(0.35, h + 0.012, 0.0)); b.cbox(0, 0, 0, 0.24, 0.01, 0.31, M['paper'], s=4); b.T = np.eye(4)
    b.cyl((-0.35, h, -0.15), 0.04, 0.1, M['plastic'], seg=8)
    return b


def p_chair(M, c):
    b = MB()
    legs4(b, 0.44, 0.44, 0.45, 0.012, M)
    b.cbox(0, 0.45, 0, 0.46, 0.05, 0.44, M['vinyl'], s=2)
    b.cbox(0, 0.5, -0.2, 0.44, 0.4, 0.04, M['vinyl'], s=2)
    for sx in (-1, 1):
        b.tube([(sx * 0.2, 0.45, -0.21), (sx * 0.2, 0.9, -0.22)], 0.012, M['steel'])
    return b


def p_office_chair(M, c):
    b = MB()
    for i in range(5):
        a = i * 2 * math.pi / 5
        b.tube([(0, 0.08, 0), (math.cos(a) * 0.3, 0.06, math.sin(a) * 0.3)], 0.02, M['dark'])
        b.cyl((math.cos(a) * 0.3, 0.0, math.sin(a) * 0.3), 0.03, 0.05, M['rubber'], seg=6)
    b.cyl((0, 0.08, 0), 0.025, 0.36, M['steel'], seg=8)
    b.cbox(0, 0.44, 0, 0.52, 0.08, 0.5, M['vinyl'], s=2)
    b.push(rot_x=-0.12, offset=(0, 0.52, -0.24))
    b.cbox(0, 0, 0, 0.48, 0.5, 0.06, M['vinyl'], s=2)
    b.T = np.eye(4)
    for sx in (-1, 1):
        b.cbox(sx * 0.27, 0.52, 0.0, 0.04, 0.16, 0.3, M['dark'])
    return b


def hollow(b, M, w, d, h, t=0.025, base=0.05, mat=None):
    """Open-fronted carcass: back, sides, top, bottom (front left open for doors)."""
    mat = mat or M['metal']
    b.cbox(0, 0, 0, w - 0.04, base, d - 0.04, M['dark'])                       # plinth
    b.cbox(0, base, -d / 2 + t / 2, w, h - base, t, mat)                      # back
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 - t / 2), base, 0, t, h - base, d, mat)            # sides
    b.cbox(0, h - t, 0, w, t, d, mat)                                         # top
    b.cbox(0, base, 0, w, t, d, mat)                                          # bottom
    b.cbox(0, base + t, -d / 2 + t + 0.002, w - 2 * t, h - base - 2 * t, 0.004, M['rubber'])  # dark inner back


def p_cabinet(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    hollow(b, M, w, d, h)
    rng = np.random.default_rng(31)
    for k, y in enumerate((0.55, 1.0, 1.45)):
        b.cbox(0, y, 0, w - 0.06, 0.018, d - 0.06, M['metal'])
        x = -w / 2 + 0.1
        while x < w / 2 - 0.12:                      # bottles, boxes and files inside
            bw = rng.uniform(0.06, 0.16)
            if rng.random() < 0.7:
                if rng.random() < 0.5: b.cyl((x + bw / 2, y + 0.018, rng.uniform(-0.1, 0.08)), bw * 0.4, rng.uniform(0.1, 0.24), M['plastic'], seg=7)
                else: b.cbox(x + bw / 2, y + 0.018, rng.uniform(-0.08, 0.05), bw - 0.01, rng.uniform(0.08, 0.2), 0.22, M['paper'], s=3)
            x += bw + 0.02
    for i in range(3):
        b.cyl((-0.25 + i * 0.22, h, 0), 0.04, 0.16 + 0.04 * (i % 2), M['plastic'], seg=7)
    return b


def p_shelf(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.cbox(sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02), 0.035, h, 0.035, M['metal'])
    rng = np.random.default_rng(int(w * 100 + h * 10))
    for i in range(5):
        y = 0.12 + i * (h - 0.15) / 4
        b.cbox(0, y, 0, w, 0.025, d, M['metal'])
        if i < 4:
            x = -w / 2 + 0.1
            while x < w / 2 - 0.15:
                bw = rng.uniform(0.15, 0.35); bh = rng.uniform(0.12, 0.3)
                if rng.random() < 0.7:
                    m = M['paper'] if rng.random() < 0.6 else M['plastic']
                    b.cbox(x + bw / 2, y + 0.025, rng.uniform(-0.05, 0.05), bw - 0.02, bh, d * 0.75, m, s=3)
                x += bw
    return b


def p_iv_stand(M, c):
    b = MB()
    for i in range(5):
        a = i * 2 * math.pi / 5
        b.tube([(0, 0.08, 0), (math.cos(a) * 0.2, 0.04, math.sin(a) * 0.2)], 0.012, M['steel'])
        b.cyl((math.cos(a) * 0.2, 0, math.sin(a) * 0.2), 0.02, 0.04, M['rubber'], seg=5)
    b.cyl((0, 0.06, 0), 0.012, 1.74, M['steel'], seg=6)
    b.tube([(-0.12, 1.75, 0), (0.12, 1.75, 0)], 0.008, M['steel'])
    b.cbox(0.1, 1.45, 0, 0.12, 0.22, 0.04, M['glass'])
    b.tube([(0.1, 1.45, 0), (0.08, 1.0, 0.05), (0.05, 0.5, 0.1)], 0.003, M['plastic'], seg=4)
    return b


def p_monitor_cart(M, c):
    b = MB(); w, d = c['w'], c['d']
    caster_legs(b, w, d, 0.1, M)
    b.cbox(0, 0.1, 0, w, 0.05, d, M['plastic'])
    b.cyl((0, 0.15, 0), 0.03, 0.8, M['steel'], seg=8)
    b.cbox(0, 0.85, 0, w - 0.1, 0.03, d - 0.1, M['plastic'])
    b.push(rot_x=-0.15, offset=(0, 0.95, 0))
    b.cbox(0, 0, 0, 0.42, 0.34, 0.16, M['plastic'])
    b.cbox(0, 0.04, 0.081, 0.34, 0.26, 0.01, M['screen'])
    b.T = np.eye(4)
    return b


def p_wheelchair(M, c):
    b = MB()
    for sx in (-1, 1):
        b.cyl((sx * 0.3, 0.3, -0.12), 0.3, 0.025, M['rubber'], seg=16, axis='x')
        b.cyl((sx * 0.31, 0.3, -0.12), 0.26, 0.01, M['steel'], seg=12, axis='x', caps=False)
        b.cyl((sx * 0.22, 0.0, 0.35), 0.06, 0.03, M['rubber'], seg=8, axis='x')
        b.tube([(sx * 0.24, 0.06, 0.35), (sx * 0.24, 0.5, 0.25), (sx * 0.24, 0.5, -0.2), (sx * 0.24, 0.95, -0.28)], 0.014, M['steel'])
        b.tube([(sx * 0.24, 0.68, 0.18), (sx * 0.24, 0.68, -0.18)], 0.014, M['steel'])
    b.cbox(0, 0.48, 0.0, 0.46, 0.03, 0.42, M['vinyl'], s=2)
    b.push(rot_x=-0.15, offset=(0, 0.52, -0.24)); b.cbox(0, 0, 0, 0.46, 0.4, 0.02, M['vinyl'], s=2); b.T = np.eye(4)
    b.cbox(0, 0.1, 0.42, 0.4, 0.02, 0.14, M['steel'])
    return b


def p_gurney(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    caster_legs(b, w, d, 0.55, M)
    b.cbox(0, 0.25, 0, w - 0.1, 0.03, d - 0.2, M['steel'])
    b.cbox(0, 0.55, 0, w, 0.08, d, M['steel'])
    b.cbox(0, 0.63, 0, w - 0.04, 0.1, d - 0.04, M['vinyl'], s=2)
    b.cbox(0, 0.73, 0.1, w - 0.02, 0.03, d - 0.4, M['linen'], s=2)
    for sx in (-1, 1):
        b.tube([(sx * (w / 2 + 0.02), 0.85, -0.7), (sx * (w / 2 + 0.02), 0.85, 0.7)], 0.014, M['steel'])
    return b


def p_or_table(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, 0.6, 0.1, 0.9, M['dark'])
    b.cyl((0, 0.1, 0), 0.12, 0.65, M['steel'], seg=10)
    b.cbox(0, 0.75, 0, w, 0.1, d, M['steel'])
    b.cbox(0, 0.85, 0, w - 0.04, 0.08, d - 0.04, M['vinyl'], s=2)
    b.cbox(0, 0.93, 0.3, w - 0.06, 0.02, 1.0, M['linen'], s=2)
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 + 0.15), 0.8, -0.45, 0.25, 0.04, 0.12, M['steel'])
    return b


def p_or_lamp(M, c):
    b = MB()
    b.cyl((0, 0.55, 0), 0.03, 0.35, M['steel'], seg=8)
    b.tube([(0, 0.55, 0), (0.35, 0.5, 0.1), (0.35, 0.3, 0.1)], 0.03, M['steel'])
    b.cyl((0.35, 0.05, 0.1), 0.38, 0.22, M['metal'], seg=16, r2=0.25)
    b.cyl((0.35, 0.04, 0.1), 0.36, 0.01, M['light'], seg=16)
    return b


def p_lab_bench(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, h - 0.04, 0, w, 0.04, d, M['dark'])
    b.cbox(-w / 2 + 0.3, 0, 0, 0.55, h - 0.04, d - 0.05, M['metal'])
    b.cbox(w / 2 - 0.3, 0, 0, 0.55, h - 0.04, d - 0.05, M['metal'])
    b.cbox(0, 0.1, -d / 2 + 0.05, w - 1.2, h - 0.2, 0.03, M['metal'])
    rng = np.random.default_rng(7)
    for i in range(7):
        x = rng.uniform(-w / 2 + 0.15, w / 2 - 0.15); z = rng.uniform(-d / 2 + 0.1, d / 2 - 0.15)
        b.cyl((x, h, z), rng.uniform(0.025, 0.05), rng.uniform(0.08, 0.22), M['glass'], seg=7)
    b.cbox(0.4, h, -0.1, 0.35, 0.3, 0.3, M['plastic'])  # microscope-ish box
    b.cyl((0.4, h + 0.3, -0.05), 0.03, 0.15, M['dark'], seg=6)
    # shelf riser
    b.cbox(0, h, -d / 2 + 0.08, w, 0.5, 0.03, M['metal'])
    b.cbox(0, h + 0.5, -d / 2 + 0.2, w, 0.03, 0.26, M['metal'])
    return b


def p_morgue_table(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cyl((0, 0, 0.4), 0.15, 0.06, M['steel'], seg=10)
    b.cyl((0, 0, -0.4), 0.15, 0.06, M['steel'], seg=10)
    b.cyl((0, 0.06, 0.4), 0.06, 0.75, M['steel'], seg=8)
    b.cyl((0, 0.06, -0.4), 0.06, 0.75, M['steel'], seg=8)
    b.cbox(0, 0.8, 0, w, 0.02, d, M['steel'])
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 - 0.02), 0.82, 0, 0.04, 0.08, d, M['steel'])
    for sz in (-1, 1):
        b.cbox(0, 0.82, sz * (d / 2 - 0.02), w, 0.08, 0.04, M['steel'])
    b.cyl((0, 0.7, d / 2 - 0.15), 0.06, 0.1, M['steel'], seg=8)  # drain
    # blood pool on top
    b.cbox(0.05, 0.821, -0.2, 0.5, 0.004, 0.9, M['blood'])
    return b


def p_morgue_fridge(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['steel'], s=1)
    cols, rows = 3, 3
    cw = (w - 0.1) / cols; rh = (h - 0.25) / rows
    for i in range(cols):
        for j in range(rows):
            # dark compartment behind each (movable) fridge door
            x = -w / 2 + 0.05 + cw * (i + 0.5); y = 0.15 + rh * j
            b.cbox(x, y + 0.04, d / 2 + 0.002, cw - 0.12, rh - 0.1, 0.004, M['rubber'])
    # a tray pulled out of the bottom-left drawer with a covered body
    x = -w / 2 + 0.05 + cw * 0.5
    b.cbox(x, 0.2, d / 2 + 0.55, cw - 0.1, 0.03, 1.1, M['steel'])
    b.cbox(x, 0.23, d / 2 + 0.55, cw - 0.25, 0.18, 1.0, M['linen'], s=2)
    b.sphere((x, 0.36, d / 2 + 0.95), 0.12, 0.08, 0.14, M['linen'], seg=8, rings=5)
    return b


def p_crib(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    legs4(b, w, d, 0.45, 0.02, M, mat=M['metal'])
    b.cbox(0, 0.42, 0, w, 0.04, d, M['metal'])
    b.cbox(0, 0.46, 0, w - 0.06, 0.1, d - 0.06, M['linen'], s=2)
    for sx in (-1, 1):
        b.tube([(sx * w / 2, h, -d / 2), (sx * w / 2, h, d / 2)], 0.012, M['metal'])
        for k in range(9):
            z = -d / 2 + d * k / 8
            b.tube([(sx * w / 2, 0.44, z), (sx * w / 2, h, z)], 0.008, M['metal'], seg=4)
    for sz in (-1, 1):
        b.tube([(-w / 2, h, sz * d / 2), (w / 2, h, sz * d / 2)], 0.012, M['metal'])
        for k in range(5):
            x = -w / 2 + w * k / 4
            b.tube([(x, 0.44, sz * d / 2), (x, h, sz * d / 2)], 0.008, M['metal'], seg=4)
    return b


def p_teddy(M, c):
    b = MB()
    b.sphere((0, 0.12, 0), 0.1, 0.12, 0.08, M['teddy'], seg=8, rings=6)
    b.sphere((0, 0.28, 0.01), 0.075, 0.07, 0.07, M['teddy'], seg=8, rings=6)
    for sx in (-1, 1):
        b.sphere((sx * 0.055, 0.34, 0.0), 0.028, 0.028, 0.02, M['teddy'], seg=6, rings=4)
        b.sphere((sx * 0.1, 0.14, 0.04), 0.035, 0.06, 0.035, M['teddy'], seg=6, rings=4)
        b.sphere((sx * 0.06, 0.03, 0.07), 0.04, 0.035, 0.06, M['teddy'], seg=6, rings=4)
        b.sphere((sx * 0.025, 0.3, 0.065), 0.01, 0.01, 0.01, M['rubber'], seg=4, rings=3)
    b.cbox(0, 0.15, 0.075, 0.06, 0.06, 0.01, M['blood'])
    return b


def p_filing_cabinet(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d - 0.02, M['metal'])
    for i in range(4):
        slot(b, M, 0, 0.04 + i * (h - 0.06) / 4 + 0.01, (d - 0.02) / 2, w - 0.07, (h - 0.06) / 4 - 0.04)
    return b


def p_records_shelf(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    for sx in (-1, 0, 1):
        b.cbox(sx * (w / 2 - 0.02), 0, 0, 0.03, h, d, M['metal'])
    rng = np.random.default_rng(13)
    for i in range(6):
        y = 0.08 + i * 0.36
        b.cbox(0, y, 0, w, 0.02, d, M['metal'])
        x = -w / 2 + 0.05
        while x < w / 2 - 0.08:
            bw = rng.uniform(0.04, 0.09)
            if rng.random() < 0.85:
                tilt = rng.uniform(-0.15, 0.15) if rng.random() < 0.2 else 0
                b.push(rot_z=tilt, offset=(x + bw / 2, y + 0.02, 0))
                b.cbox(0, 0, 0, bw - 0.005, rng.uniform(0.24, 0.31), d * 0.8, M['paper'], s=3)
                b.T = np.eye(4)
            x += bw
    return b


def p_reception_desk(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    # Front panel (faces +z, lobby side), raised transaction counter, work surface behind.
    b.cbox(0, 0, d / 2 - 0.06, w, h, 0.06, M['wood'])
    b.cbox(0, h, d / 2 - 0.12, w + 0.06, 0.04, 0.32, M['wood'])
    b.cbox(-w / 2 + 0.03, 0, 0, 0.06, h, d, M['wood'])
    b.cbox(w / 2 - 0.03, 0, 0, 0.06, h, d, M['wood'])
    b.cbox(0, 0.74, -0.08, w - 0.1, 0.035, d - 0.2, M['wood'])
    b.cbox(0, 0.05, 0.25, w - 0.1, 0.69, 0.04, M['wood'])
    # drawer pedestal under the chair position (x = -0.4) with the special top drawer (modelled in items)
    b.cbox(-0.95, 0, -0.1, 0.45, 0.58, d - 0.25, M['metal'])
    for yy in (0.06, 0.32):   # recesses behind the two movable pedestal drawers (face toward the chair)
        b.cbox(-0.95, yy + 0.01, -0.1 - (d - 0.25) / 2 - 0.003, 0.4, 0.22, 0.006, M['rubber'])
    b.cbox(1.3, 0, -0.1, 0.45, 0.72, d - 0.25, M['metal'])
    # computer (CRT) + keyboard
    b.cbox(-0.7, 0.775, 0.05, 0.42, 0.38, 0.4, M['plastic'])
    b.cbox(-0.7, 0.81, -0.151, 0.34, 0.28, 0.01, M['screen'])
    b.cbox(-0.7, 0.775, -0.32, 0.45, 0.025, 0.16, M['plastic'])
    # register / log book
    b.push(rot_y=0.15, offset=(-1.7, 1.14, 0.25)); b.cbox(0, 0, 0, 0.42, 0.025, 0.3, M['paper'], s=4); b.T = np.eye(4)
    b.cyl((-1.45, 1.14, 0.3), 0.006, 0.14, M['dark'], seg=4, axis='x')
    # papers, bell, nameplate
    for i in range(5):
        b.push(rot_y=i * 0.4, offset=(0.4 + i * 0.12, 0.775 + i * 0.003, -0.15)); b.cbox(0, 0, 0, 0.21, 0.004, 0.3, M['paper'], s=4); b.T = np.eye(4)
    b.cyl((0.6, 1.14, 0.28), 0.04, 0.03, M['steel'], seg=8, r2=0.01)
    b.cbox(0.1, 1.14, 0.3, 0.3, 0.08, 0.02, M['dark'])
    return b


def p_waiting_chairs(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0.36, 0.0, w, 0.04, 0.08, M['steel'])
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 - 0.1), 0, 0, 0.06, 0.36, 0.5, M['steel'])
    for i in range(4):
        x = -w / 2 + w * (i + 0.5) / 4
        b.cbox(x, 0.4, 0.02, w / 4 - 0.05, 0.06, 0.46, M['vinyl'], s=2)
        b.push(rot_x=-0.12, offset=(x, 0.46, -0.24)); b.cbox(0, 0, 0, w / 4 - 0.05, 0.42, 0.05, M['vinyl'], s=2); b.T = np.eye(4)
    return b


def p_power_panel(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['metal'])
    b.cbox(0, 0.15, d / 2, w - 0.12, h - 0.3, 0.02, M['dark'])
    # meters
    for i in range(4):
        b.cyl((-0.75 + i * 0.5, 1.75, d / 2 + 0.01), 0.08, 0.03, M['plastic'], seg=12, axis='z')
    # breakers rows
    for r in range(2):
        for k in range(10):
            b.cbox(-0.95 + k * 0.21, 0.35 + r * 0.25, d / 2 + 0.02, 0.12, 0.16, 0.04, M['plastic'])
    # 4 fuse sockets (game places fuses here) and the main lever housing
    for i in range(4):
        b.cbox(-0.75 + i * 0.5, 1.15, d / 2 + 0.02, 0.26, 0.34, 0.06, M['orange'])
        b.cbox(-0.75 + i * 0.5, 1.2, d / 2 + 0.08, 0.14, 0.24, 0.01, M['rubber'])
    b.cbox(0.0, 0.95, d / 2 + 0.02, 1.8, 0.04, 0.02, M['orange'])
    # conduit pipes to ceiling
    for i in range(5):
        b.tube([(-0.9 + i * 0.45, h, 0), (-0.9 + i * 0.45, 3.2, 0)], 0.035, M['steel'])
    return b


def p_generator(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, 0.12, d, M['dark'])
    b.cbox(-0.3, 0.12, 0, w - 0.8, h - 0.45, d - 0.15, M['green'])
    b.cyl((w / 2 - 0.45, 0.12, 0), 0.45, 0.9, M['green'], seg=12)
    b.cbox(-0.3, h - 0.33, 0, w - 0.9, 0.2, d - 0.3, M['dark'])
    for i in range(6):
        b.cbox(-1.0 + i * 0.25, 0.4, d / 2 - 0.07, 0.03, 0.8, 0.02, M['dark'])
    b.tube([(-1.0, h - 0.13, 0.3), (-1.0, 3.0, 0.3)], 0.08, M['steel'])
    b.cbox(0.4, 0.5, d / 2 - 0.05, 0.4, 0.5, 0.06, M['plastic'])
    return b


def p_electrical_box(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['metal'])
    b.cbox(0, 0.05, d / 2, w - 0.06, h - 0.1, 0.01, M['metal'])
    b.cbox(0.3, h / 2, d / 2 + 0.01, 0.04, 0.15, 0.03, M['dark'])
    b.cbox(0, h * 0.7, d / 2 + 0.011, 0.2, 0.14, 0.002, M['orange'])
    b.tube([(0, h, 0), (0, 2.6 - 0.0, 0)], 0.03, M['steel'])
    return b


def p_boiler(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cyl((0, 0, 0), w / 2, 0.15, M['dark'], seg=14)
    b.cyl((0, 0.15, 0), w / 2 - 0.05, h - 0.5, M['metal'], seg=14)
    b.cyl((0, h - 0.35, 0), w / 2 - 0.05, 0.35, M['metal'], seg=14, r2=0.25)
    b.tube([(0, h, 0), (0, 3.2, 0)], 0.12, M['steel'])
    b.tube([(w / 2, 1.2, 0), (w / 2 + 0.4, 1.2, 0), (w / 2 + 0.4, 3.0, 0)], 0.07, M['steel'])
    b.cyl((0, 1.4, w / 2 - 0.04), 0.1, 0.06, M['plastic'], seg=10, axis='z')
    for y in (0.6, 1.8):
        b.cyl((0, y, 0), w / 2 - 0.02, 0.05, M['dark'], seg=14)
    return b


def p_crates(M, c):
    b = MB()
    b.cbox(0, 0, 0, 0.95, 0.5, 0.95, M['wood'])
    b.push(rot_y=0.25, offset=(0.05, 0.5, -0.05)); b.cbox(0, 0, 0, 0.6, 0.4, 0.5, M['paper'], s=1.5); b.T = np.eye(4)
    b.cbox(-0.22, 0.9, 0.1, 0.35, 0.1, 0.3, M['paper'], s=2)
    return b


def p_cart(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    caster_legs(b, w, d, 0.9, M)
    for y in (0.15, 0.5, 0.88):
        b.cbox(0, y, 0, w, 0.03, d, M['steel'])
        b.cbox(0, y, d / 2 - 0.01, w, 0.05, 0.02, M['steel'])
    b.tube([(-w / 2 - 0.05, 0.9, -0.15), (-w / 2 - 0.05, 0.9, 0.15)], 0.012, M['steel'])
    rng = np.random.default_rng(3)
    for i in range(5):
        b.cyl((rng.uniform(-0.35, 0.35), 0.91, rng.uniform(-0.15, 0.15)), 0.025, rng.uniform(0.05, 0.12), M['plastic'], seg=6)
    b.cbox(0.2, 0.53, 0, 0.3, 0.12, 0.3, M['paper'], s=3)
    return b


def p_sink(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0.0, -d / 2 + 0.05, 0.1, 0.7, 0.1, M['plastic'])
    b.cbox(0, 0.7, 0, w, 0.2, d, M['plastic'])
    b.cbox(0, 0.78, 0.03, w - 0.12, 0.13, d - 0.18, M['steel'])
    b.tube([(0, 0.9, -d / 2 + 0.05), (0, 1.05, -d / 2 + 0.05), (0, 1.05, -0.05)], 0.015, M['steel'])
    b.cbox(0, 1.2, -d / 2 + 0.02, 0.5, 0.65, 0.02, M['screen'])  # mirror (dark glass)
    return b


def p_debris(M, c):
    b = MB()
    rng = np.random.default_rng(17)
    for i in range(14):
        x = rng.uniform(-0.65, 0.65); z = rng.uniform(-0.55, 0.55)
        b.push(rot_y=rng.uniform(0, 6), rot_x=rng.uniform(-0.3, 0.3), offset=(x, 0, z))
        kind = rng.random()
        if kind < 0.4:
            b.cbox(0, 0, 0, rng.uniform(0.2, 0.6), rng.uniform(0.02, 0.06), rng.uniform(0.2, 0.6), M['ceiling'], s=0.5)
        elif kind < 0.7:
            b.cbox(0, 0, 0, rng.uniform(0.1, 0.25), rng.uniform(0.05, 0.12), rng.uniform(0.1, 0.25), M['wall_conc'], s=0.5)
        else:
            b.cbox(0, 0, 0, rng.uniform(0.2, 0.3), 0.004, rng.uniform(0.25, 0.32), M['paper'], s=4)
        b.T = np.eye(4)
    b.push(rot_y=0.7, rot_z=0.3, offset=(0.1, 0.12, 0.1)); b.cbox(0, 0, 0, 1.0, 0.04, 0.08, M['wood']); b.T = np.eye(4)
    return b


def p_couch(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    legs4(b, w - 0.1, d - 0.1, 0.1, 0.02, M, mat=M['dark'])
    b.cbox(0, 0.1, 0, w, 0.3, d, M['vinyl'], s=2)
    b.cbox(0, 0.4, 0.05, w - 0.3, 0.1, d - 0.25, M['vinyl'], s=2)
    b.cbox(0, 0.4, -d / 2 + 0.1, w, 0.4, 0.2, M['vinyl'], s=2)
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 - 0.08), 0.4, 0, 0.16, 0.22, d, M['vinyl'], s=2)
    return b


def p_vending(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['toy_red'])
    b.cbox(-0.12, 0.6, d / 2, 0.65, 1.15, 0.02, M['glass'])
    for r in range(5):
        b.cbox(-0.12, 0.65 + r * 0.22, d / 2 - 0.25, 0.6, 0.015, 0.4, M['steel'])
        for k in range(5):
            b.cyl((-0.38 + k * 0.13, 0.67 + r * 0.22, d / 2 - 0.15), 0.03, 0.11, M['plastic'] if (r + k) % 3 else M['orange'], seg=6)
    b.cbox(0.33, 0.9, d / 2, 0.22, 0.6, 0.02, M['dark'])
    b.cbox(-0.12, 0.2, d / 2, 0.6, 0.2, 0.03, M['dark'])
    return b


def p_plant(M, c):
    b = MB()
    b.cyl((0, 0, 0), 0.16, 0.35, M['plastic'], seg=10, r2=0.22)
    b.cyl((0, 0.33, 0), 0.2, 0.01, M['mud'], seg=10)
    rng = np.random.default_rng(5)
    for i in range(9):
        a = rng.uniform(0, 6.28); l = rng.uniform(0.4, 0.85)
        tip = (math.cos(a) * l * 0.35, 0.34 + l, math.sin(a) * l * 0.35)
        droop = (tip[0] * 1.6, tip[1] - rng.uniform(0.1, 0.35), tip[2] * 1.6)
        b.tube([(0, 0.34, 0), tip, droop], 0.008, M['bark'], seg=4)
    return b


def p_lockers(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    # four open-fronted compartments; the doors are movable parts (items.glb: part_locker_door)
    b.cbox(0, 0, -d / 2 + 0.01, w, h, 0.02, M['green'])
    for k in range(5):
        b.cbox(-w / 2 + w * k / 4, 0, 0, 0.02, h, d, M['green'])
    b.cbox(0, h - 0.02, 0, w, 0.02, d, M['green']); b.cbox(0, 0, 0, w, 0.05, d, M['dark'])
    for i in range(4):
        x = -w / 2 + w * (i + 0.5) / 4
        b.cbox(x, 0.05, -d / 2 + 0.025, w / 4 - 0.03, h - 0.08, 0.004, M['rubber'])
        b.cbox(x, h - 0.45, 0, w / 4 - 0.03, 0.015, d - 0.04, M['green'])       # hat shelf
        if i % 2 == 0:                                                             # a coat on a hook
            b.cbox(x, h - 1.15, -0.02, 0.26, 0.62, 0.12, M['uniform'] if 'uniform' in M else M['vinyl'], s=2)
    return b


def p_workbench(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    legs4(b, w, d, h - 0.05, 0.025, M, mat=M['dark'])
    b.cbox(0, h - 0.05, 0, w, 0.05, d, M['wood'])
    b.cbox(0, 0.2, 0, w - 0.1, 0.03, d - 0.1, M['wood'])
    b.cbox(0, h, -d / 2 + 0.03, w, 0.9, 0.03, M['wood'])  # pegboard
    rng = np.random.default_rng(9)
    for i in range(8):
        b.cbox(rng.uniform(-0.8, 0.8), h + rng.uniform(0.2, 0.8), -d / 2 + 0.06, rng.uniform(0.04, 0.2), rng.uniform(0.04, 0.25), 0.02, M['dark'])
    b.cbox(0.5, h, 0.05, 0.4, 0.2, 0.22, M['toy_red'])  # toolbox
    b.cbox(-0.4, h, 0.1, 0.25, 0.08, 0.15, M['steel'])
    return b


def p_washer(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['plastic'])
    b.cyl((0, 0.45, d / 2), 0.22, 0.03, M['steel'], seg=16, axis='z')
    b.cyl((0, 0.45, d / 2 + 0.01), 0.17, 0.025, M['screen'], seg=16, axis='z')
    b.cbox(0, h - 0.12, d / 2, w - 0.06, 0.1, 0.02, M['dark'])
    return b


def p_toy_blocks(M, c):
    b = MB()
    rng = np.random.default_rng(21)
    mats = [M['toy_red'], M['toy_blue'], M['orange'], M['wood']]
    for i in range(7):
        b.push(rot_y=rng.uniform(0, 6), offset=(rng.uniform(-0.16, 0.16), 0 if i < 5 else 0.07, rng.uniform(-0.16, 0.16)))
        b.cbox(0, 0, 0, 0.07, 0.07, 0.07, mats[i % 4], s=10)
        b.T = np.eye(4)
    return b


def p_rocking_horse(M, c):
    b = MB()
    for sx in (-1, 1):
        pts = [(sx * 0.15, 0.08 + 0.1 * (t * t), -0.45 + 0.9 * (t * 0.5 + 0.5)) for t in np.linspace(-1, 1, 7)]
        b.tube(pts, 0.02, M['wood'])
        b.tube([(sx * 0.12, 0.1, -0.25), (sx * 0.08, 0.4, -0.15)], 0.02, M['wood'])
        b.tube([(sx * 0.12, 0.1, 0.25), (sx * 0.08, 0.4, 0.15)], 0.02, M['wood'])
    b.cbox(0, 0.38, 0, 0.18, 0.16, 0.5, M['toy_red'])
    b.push(rot_x=0.5, offset=(0, 0.45, 0.25)); b.cbox(0, 0, 0, 0.12, 0.3, 0.12, M['toy_red']); b.T = np.eye(4)
    b.cbox(0, 0.62, 0.36, 0.11, 0.1, 0.2, M['toy_red'])
    b.sphere((0.06, 0.66, 0.42), 0.012, 0.012, 0.012, M['rubber'], seg=4, rings=3)
    b.cbox(0, 0.4, -0.27, 0.05, 0.12, 0.08, M['wood'])
    return b


def p_xray_box(M, c):
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    b.cbox(0, 0, 0, w, h, d, M['plastic'])
    b.cbox(0, 0.05, d / 2, w - 0.08, h - 0.1, 0.005, M['screen'])
    b.cbox(-0.2, 0.12, d / 2 + 0.006, 0.36, 0.46, 0.002, M['paper'], s=2)
    return b


def p_pipes_h(M, c):
    b = MB(); w = c['w']
    for i, (y, z, r) in enumerate([(0.3, -0.15, 0.08), (0.3, 0.1, 0.05), (0.1, 0.0, 0.11)]):
        b.tube([(-w / 2, y, z), (w / 2, y, z)], r, M['steel'] if i != 2 else M['metal'], seg=8)
    for x in np.linspace(-w / 2 + 0.3, w / 2 - 0.3, 5):
        b.cbox(x, 0.0, 0, 0.04, 0.45, 0.5, M['dark'])
    return b


def p_closet(M, c):
    """Walk-in storage wardrobe the player can hide in: open front (door is a movable part)."""
    b = MB(); w, d, h = c['w'], c['d'], c['h']
    t = 0.035
    paint = M['metal']
    b.cbox(0, 0, 0, w, 0.06, d, M['dark'])                                   # plinth / floor
    b.cbox(0, 0.06, -d / 2 + t / 2, w, h - 0.06, t, paint)                   # back
    for sx in (-1, 1):
        b.cbox(sx * (w / 2 - t / 2), 0.06, 0, t, h - 0.06, d, paint)          # sides
    b.cbox(0, h - t, 0, w, t, d, paint)                                       # roof
    b.cbox(0, h - 0.11, d / 2 - 0.02, w, 0.07, 0.04, paint)                  # header rail
    b.cbox(0, 0.06, -d / 2 + t + 0.002, w - 2 * t, h - 0.1, 0.004, M['rubber'])   # dark interior back
    b.cbox(0, h - 0.45, -0.12, w - 2 * t, 0.02, d * 0.55, paint)             # hat shelf
    b.tube([(-w / 2 + t, h - 0.55, -0.1), (w / 2 - t, h - 0.55, -0.1)], 0.012, M['steel'])   # hanging rail
    # an old coat and a lab coat pushed to one side (room left for a person)
    b.push(offset=(-w / 2 + 0.2, h - 0.6, -0.12), rot_z=0.05)
    b.cbox(0, -1.05, 0, 0.1, 1.05, 0.42, M['vinyl'], s=2)
    b.T = np.eye(4)
    b.push(offset=(-w / 2 + 0.33, h - 0.6, -0.14), rot_z=-0.04)
    b.cbox(0, -1.2, 0, 0.08, 1.2, 0.45, M['linen'], s=2)
    b.T = np.eye(4)
    b.cbox(w / 2 - 0.22, 0.06, -d / 2 + 0.2, 0.3, 0.32, 0.28, M['paper'], s=2)   # box on the floor
    return b


BUILDERS = {k[2:]: v for k, v in globals().items() if k.startswith('p_')}

