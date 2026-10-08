# NIGHT SHIFT â€” builds St. Mercy Hospital (all floors + exterior) from layout.json
# and exports public/assets/models/hospital.glb.
import math, os
import numpy as np
import bpy
import ns_lib
from ns_lib import MB, to_b, collection, empty, std_materials, text_mesh, join, load_layout
import ns_props

STEP_COUNT = 12
GUARD_T = 0.12     # stair balustrade (inner flight edge) thickness
GUARD_H = 1.0      # balustrade height above the treads


def build(export=True):
    ns_lib.reset_scene()
    L = load_layout()
    M = std_materials()
    C = L['constants']
    CEIL = C['CEIL']
    root = collection('HOSPITAL')
    proto_coll = collection('PROTOTYPES')
    proto_coll.hide_render = True

    # --------------------------------------------------------------- prop prototypes
    protos = {}
    for t, cat in L['catalog'].items():
        b = ns_props.BUILDERS[t](M, cat)
        o = b.build('prop_' + t, proto_coll)
        protos[t] = o.data
    bpy.data.collections['PROTOTYPES'].hide_viewport = True

    fixture = MB()
    fixture.cbox(0, -0.07, 0, 1.24, 0.07, 0.34, M['metal'])
    fixture.box(-0.58, -0.075, -0.13, 0.58, -0.07, 0.13, M['light'], faces='y')
    fixture_mesh = fixture.build('fixture_fluor', proto_coll).data
    emerg = MB()
    emerg.cbox(0, 0, -0.05, 0.3, 0.14, 0.1, M['metal'])
    emerg.cyl((-0.07, 0.07, 0.0), 0.045, 0.06, M['sign_red'], seg=8, axis='z')
    emerg.cyl((0.07, 0.07, 0.0), 0.045, 0.06, M['sign_red'], seg=8, axis='z')
    emerg_mesh = emerg.build('fixture_emergency', proto_coll).data
    speaker = MB()
    speaker.cyl((0, -0.06, 0), 0.14, 0.06, M['plastic'], seg=12)
    speaker.cyl((0, -0.061, 0), 0.11, 0.002, M['dark'], seg=12)
    speaker_mesh = speaker.build('fixture_speaker', proto_coll).data

    levels = {lv['id']: lv for lv in L['levels']}
    level_root = {}
    for lv in L['levels']:
        level_root[lv['id']] = empty('LEVEL_' + lv['id'], root)
    ext_root = empty('EXTERIOR', root)

    def inst(mesh, name, parent, x, y, z, rot=0.0, tilt=0.0):
        o = bpy.data.objects.new(name, mesh)
        root.objects.link(o)
        o.location = to_b((x, y, z))
        o.rotation_euler = (tilt, 0, rot)
        o.parent = parent
        return o

    # --------------------------------------------------------------- per level geometry
    for lv in L['levels']:
        lid = lv['id']; y = lv['y']; isB = lid == 'B'
        par = level_root[lid]
        W = MB(); F = MB(); Cc = MB(); G = MB(); S = MB(); D = MB(); T = MB()
        wallM = M['wall_conc'] if isB else M['wall']
        floorM = M['floor_conc'] if isB else M['floor']
        fs = 1 / 4 if isB else 1 / 2.4

        # floors & ceilings
        B = L['bounds']
        if isB:
            rects = [(B['x0'], B['x1'], B['z0'], B['z1'])]
        else:
            rects = [(B['x0'], 17, B['z0'], B['z1']), (17, B['x1'], -1.5, B['z1'])]
        for (x0, x1, z0, z1) in rects:
            F.box(x0, y - 0.35, z0, x1, y, z1, floorM, s=fs, faces='Y')
            F.box(x0, y - 0.35, z0, x1, y, z1, M['roof'], s=0.25, faces='y')
        # ceilings never cover the stair shaft (except the roof of the shaft on the top floor)
        ceil_rects = [(B['x0'], 17, B['z0'], B['z1']), (17, B['x1'], -1.5, B['z1'])]
        if lid == '4':
            ceil_rects = [(B['x0'], B['x1'], B['z0'], B['z1'])]
        for (x0, x1, z0, z1) in ceil_rects:
            if isB:
                Cc.box(x0, y + CEIL, z0, x1, y + CEIL + 0.1, z1, M['roof'], s=0.25, faces='y')
            else:
                Cc.box(x0, y + CEIL, z0, x1, y + CEIL + 0.05, z1, M['ceiling'], s=1 / 2.4, faces='y')
        # Stair shaft top cap for upper floors' ceilings already covered; lintel over stair opening:
        W.box(17, y + CEIL, -1.5 - 0.09, B['x1'], y + 4.0, -1.5 + 0.09, wallM, uvmode='wall', wall=('x', y))

        # walls
        for w in [w for w in L['walls'] if w['level'] == lid]:
            axis, c, a, bb, t = w['axis'], w['c'], w['a'], w['b'], w['t']
            y0, y1 = w['y0'], w['y1']
            if w['kind'] == 'rail':
                for yy in (0.5, 1.0):
                    T.tube([(a, y + yy, c), (bb, y + yy, c)], 0.025, M['steel'])
                for xx in np.linspace(a, bb, 5):
                    T.tube([(xx, y, c), (xx, y + 1.0, c)], 0.02, M['steel'])
                continue
            # stairwell walls full storey height
            if axis == 'z' and abs(c - 17) < 0.01 and bb <= -1.4:
                y1 = y + 4.0
            ext = w['ext']
            mat_in = wallM if w['kind'] != 'spine' else (M['wall_conc'])
            outer_face = None
            if ext:
                if axis == 'x':
                    outer_face = 'Z' if c > 0 else 'z'
                else:
                    outer_face = 'X' if c > 0 else 'x'

            def piece(p0, p1, q0, q1):
                if p1 - p0 < 0.005 or q1 - q0 < 0.005:
                    return
                if axis == 'x':
                    bx = (p0, q0, c - t / 2, p1, q1, c + t / 2)
                else:
                    bx = (c - t / 2, q0, p0, c + t / 2, q1, p1)
                all_faces = 'xXyYzZ'
                inner_faces = all_faces.replace(outer_face, '') if outer_face else all_faces
                W.box(*bx, mat_in, uvmode='wall', wall=(axis, y), faces=inner_faces)
                if outer_face:
                    ext_mat = M['wall_conc'] if isB else M['brick']
                    W.box(*bx, ext_mat, s=1 / 2.4, faces=outer_face)

            ops = sorted(w['openings'], key=lambda o: o['at'])
            cur = a
            for o in ops:
                o0 = o['at'] - o['w'] / 2; o1 = o['at'] + o['w'] / 2
                piece(cur, o0, y0, y1)
                if o['type'] in ('door', 'entrance'):
                    piece(o0, o1, y + o['y1'], y1)
                    # frame
                    ft = t + 0.04
                    fm = M['metal'] if o['type'] == 'door' else M['dark']
                    if axis == 'x':
                        W.box(o0 - 0.05, y, c - ft / 2, o0, y + o['y1'], c + ft / 2, fm, s=2)
                        W.box(o1, y, c - ft / 2, o1 + 0.05, y + o['y1'], c + ft / 2, fm, s=2)
                        W.box(o0 - 0.05, y + o['y1'], c - ft / 2, o1 + 0.05, y + o['y1'] + 0.05, c + ft / 2, fm, s=2)
                    else:
                        W.box(c - ft / 2, y, o0 - 0.05, c + ft / 2, y + o['y1'], o0, fm, s=2)
                        W.box(c - ft / 2, y, o1, c + ft / 2, y + o['y1'], o1 + 0.05, fm, s=2)
                        W.box(c - ft / 2, y + o['y1'], o0 - 0.05, c + ft / 2, y + o['y1'] + 0.05, o1 + 0.05, fm, s=2)
                else:  # window
                    piece(o0, o1, y0, y + o['y0'])
                    piece(o0, o1, y + o['y1'], y1)
                    fm = M['dark']
                    yb, yt = y + o['y0'], y + o['y1']
                    if axis == 'x':
                        W.box(o0, yb, c - t / 2 - 0.02, o1, yb + 0.04, c + t / 2 + 0.06, fm)  # sill
                        W.box(o0, yt - 0.04, c - 0.04, o1, yt, c + 0.04, fm)
                        W.box(o0, yb, c - 0.04, o0 + 0.05, yt, c + 0.04, fm)
                        W.box(o1 - 0.05, yb, c - 0.04, o1, yt, c + 0.04, fm)
                        W.box((o0 + o1) / 2 - 0.025, yb, c - 0.035, (o0 + o1) / 2 + 0.025, yt, c + 0.035, fm)
                        W.box(o0, (yb + yt) / 2 - 0.02, c - 0.035, o1, (yb + yt) / 2 + 0.02, c + 0.035, fm)
                        G.box(o0, yb, c - 0.005, o1, yt, c + 0.005, M['glass'], faces='zZ', s=1 / 1.5, uvoff=(0, 0))
                    else:
                        W.box(c - t / 2 - 0.06, yb, o0, c + t / 2 + 0.02, yb + 0.04, o1, fm)
                        W.box(c - 0.04, yt - 0.04, o0, c + 0.04, yt, o1, fm)
                        W.box(c - 0.04, yb, o0, c + 0.04, yt, o0 + 0.05, fm)
                        W.box(c - 0.04, yb, o1 - 0.05, c + 0.04, yt, o1, fm)
                        W.box(c - 0.035, yb, (o0 + o1) / 2 - 0.025, c + 0.035, yt, (o0 + o1) / 2 + 0.025, fm)
                        W.box(c - 0.035, (yb + yt) / 2 - 0.02, o0, c + 0.035, (yb + yt) / 2 + 0.02, o1, fm)
                        G.box(c - 0.005, yb, o0, c + 0.005, yt, o1, M['glass'], faces='xX', s=1 / 1.5)
                cur = o1
            piece(cur, bb, y0, y1)

            # elevator doors on elevator lobby wall
            if w.get('elevator'):
                ex = w['elevator']['x']; zf = c - t / 2 - 0.01
                W.box(ex - 0.75, y, zf - 0.04, ex + 0.75, y + 2.4, zf, M['steel'], s=1)
                W.box(ex - 0.6, y, zf - 0.05, ex - 0.005, y + 2.2, zf - 0.04, M['steel'], s=1)
                W.box(ex + 0.005, y, zf - 0.05, ex + 0.6, y + 2.2, zf - 0.04, M['steel'], s=1)
                W.box(ex - 0.3, y + 2.25, zf - 0.05, ex + 0.3, y + 2.37, zf - 0.04, M['screen'])
                W.box(ex + 0.95, y + 1.0, zf - 0.03, ex + 1.08, y + 1.3, zf, M['steel'])
                W.box(ex + 0.99, y + 1.05, zf - 0.04, ex + 1.04, y + 1.1, zf - 0.03, M['sign_red'])

        # baseboard strip in corridors (dark rubber skirting)
        for cz in (-1.5 + 0.09, 1.5 - 0.09):
            sgn = 1 if cz < 0 else -1
            corr = [cc for cc in L['corridors'] if cc['level'] == lid][0]
            x0 = corr['x0']
            xs = [x0] + sorted([d['x'] for d in L['doors'] if d['level'] == lid and abs(d['z'] - (-1.5 if cz < 0 else 1.5)) < 0.01]) + [17]
            segs = []
            cur = x0
            for dx in xs[1:-1]:
                segs.append((cur, dx - 0.65)); cur = dx + 0.65
            segs.append((cur, 17))
            for s0, s1 in segs:
                if s1 > s0:
                    W.box(s0, y, cz, s1, y + 0.1, cz + sgn * 0.012, M['rubber'], faces='zZY')

        # stairs (flights starting at this level)
        for st in [s for s in L['stairs'] if s['level'] == lid]:
            for fk in ('flightA', 'flightB'):
                fl = st[fk]
                run = (fl['z1'] - fl['z0']) / STEP_COUNT
                rise = (fl['yHigh'] - fl['yLow']) / STEP_COUNT
                up_neg = fl['lowAt'] == 'z1'           # flight climbs toward -z
                riser_face = 'Z' if up_neg else 'z'     # face looking at the person climbing
                for i in range(STEP_COUNT):
                    top = fl['yLow'] + rise * (i + 1)
                    if up_neg:
                        za, zb = fl['z1'] - run * (i + 1), fl['z1'] - run * i
                    else:
                        za, zb = fl['z0'] + run * i, fl['z0'] + run * (i + 1)
                    # solid step down to the soffit line (no sawtooth gaps, no see-through)
                    bottom = fl['yLow'] - 0.28 + rise * (i + 1)
                    x0, x1 = fl['x0'] + 0.005, fl['x1'] - 0.005
                    T.box(x0, bottom, za, x1, top, zb, M['floor'], s=1 / 2.4, faces='Y')               # vinyl tread
                    T.box(x0, bottom, za, x1, top, zb, M['wall'], uvmode='wall', wall=('x', fl['yLow']), faces=riser_face + 'xX')  # painted riser + sides
                    # anti-slip nosing: yellow strip on the tread edge + down the riser
                    nz = zb if up_neg else za
                    sg = -1 if up_neg else 1            # direction from the edge onto the tread
                    T.box(x0, top - 0.035, min(nz, nz + sg * 0.05), x1, top + 0.004, max(nz, nz + sg * 0.05), M['orange'], faces='Y' + riser_face)
                # sloped soffit under the flight (hides the step undersides)
                zl, zh = (fl['z1'], fl['z0']) if up_neg else (fl['z0'], fl['z1'])
                yl, yh = fl['yLow'] - 0.28, fl['yHigh'] - 0.28
                T.poly([(fl['x0'], yl, zl), (fl['x1'], yl, zl), (fl['x1'], yh, zh), (fl['x0'], yh, zh)], M['roof'],
                       [(0, 0), (1, 0), (1, 2), (0, 2)], normal=(0, -1, 0.4 * (1 if up_neg else -1)))
                # Inner edge (x = 19.5): an open balustrade instead of a full-height wall — a
                # sloped stringer wall up to waist height with a capping rail, so the stairwell
                # is open and you can see where both flights go.
                inner = 19.5
                gx0, gx1 = (inner - GUARD_T, inner) if fl['x1'] == inner else (inner, inner + GUARD_T)
                y_lo_l, y_lo_h = yl - 0.02, yh - 0.02                     # soffit line
                y_hi_l, y_hi_h = fl['yLow'] + GUARD_H, fl['yHigh'] + GUARD_H
                for xx, nrm in ((gx0, (-1, 0, 0)), (gx1, (1, 0, 0))):     # both faces of the stringer wall
                    pts = [(xx, y_lo_l, zl), (xx, y_lo_h, zh), (xx, y_hi_h, zh), (xx, y_hi_l, zl)]
                    if nrm[0] > 0: pts = pts[::-1]
                    dz = abs(zh - zl)
                    T.poly(pts, M['wall'], [(0, 0), (dz / 2.4, 0), (dz / 2.4, (GUARD_H + 0.3) / 2.4), (0, (GUARD_H + 0.3) / 2.4)], normal=nrm)
                # sloped top cap + steel rail on top
                T.poly([(gx0, y_hi_l, zl), (gx1, y_hi_l, zl), (gx1, y_hi_h, zh), (gx0, y_hi_h, zh)] if up_neg else
                       [(gx0, y_hi_h, zh), (gx1, y_hi_h, zh), (gx1, y_hi_l, zl), (gx0, y_hi_l, zl)], M['dark'],
                       [(0, 0), (1, 0), (1, 4), (0, 4)], normal=(0, 1, 0))
                # end caps of the stringer wall (low end + high end)
                for zz, ylo, yhi in ((zl, y_lo_l, y_hi_l), (zh, y_lo_h, y_hi_h)):
                    T.box(gx0, ylo, zz - 0.004, gx1, yhi, zz + 0.004, M['wall'], uvmode='wall', wall=('x', fl['yLow']), faces='zZ')
                rx = (gx0 + gx1) / 2
                T.tube([(rx, y_hi_l + 0.05, zl), (rx, y_hi_h + 0.05, zh)], 0.028, M['steel'], seg=8)
                # handrail on the outer wall side (wall faces: x=17.09, exterior 21.85)
                faces = {17.0: 17.09, 22.0: 21.85}
                wx = fl['x0'] if fl['x1'] == inner else fl['x1']
                face = faces.get(round(wx, 1), wx)
                hx = face + (0.075 if face < (fl['x0'] + fl['x1']) / 2 else -0.075)
                a = (hx, fl['yLow'] + rise + 0.9, zl); bb = (hx, fl['yHigh'] + 0.9, zh)
                T.tube([a, bb], 0.022, M['steel'], seg=8)
                for k in range(4):                 # wall brackets
                    u = (k + 0.5) / 4
                    p = (hx, a[1] + (bb[1] - a[1]) * u - 0.02, a[2] + (bb[2] - a[2]) * u)
                    T.tube([p, (face, p[1] - 0.05, p[2])], 0.01, M['steel'], seg=5)
            ld = st['landing']
            T.box(ld['x0'], ld['y'] - 0.3, ld['z0'], ld['x1'], ld['y'], ld['z1'], M['floor'], s=1 / 2.4, faces='Y')
            T.box(ld['x0'], ld['y'] - 0.3, ld['z0'], ld['x1'], ld['y'], ld['z1'], M['roof'], s=0.25, faces='yxXzZ')
            # yellow edge where the landing meets each flight
            T.box(ld['x0'], ld['y'] - 0.035, ld['z1'] - 0.05, ld['x1'], ld['y'] + 0.004, ld['z1'], M['orange'], faces='YZ')
            # lamp on landing exterior wall (fixture comes from lights)

        # basement pipes in the corridor + morgue blood
        if isB:
            for (pz, py, pr) in ((1.2, CEIL - 0.25, 0.09), (1.0, CEIL - 0.45, 0.05), (-1.15, CEIL - 0.3, 0.07)):
                T.tube([(B['x0'] + 0.2, y + py, pz), (B['x1'] - 0.2, y + py, pz)], pr, M['steel'], seg=8)
            for xx in np.arange(-20, 21, 4):
                T.box(xx - 0.03, y + CEIL - 0.6, 0.8, xx + 0.03, y + CEIL, 1.35, M['dark'])
                T.box(xx - 0.03, y + CEIL - 0.45, -1.3, xx + 0.03, y + CEIL, -1.0, M['dark'])

        # Floor 4: hanging ceiling panels and broken tiles in the corridor
        if lid == '4':
            rng = np.random.default_rng(404)
            for i in range(9):
                x = rng.uniform(-20, 15); z = rng.uniform(-1.2, 1.2)
                T.push(rot_z=rng.uniform(-0.9, 0.9), rot_x=rng.uniform(-0.4, 0.4), offset=(x, y + CEIL - 0.35, z))
                T.cbox(0, 0, 0, 0.6, 0.02, 0.6, M['ceiling'], s=1 / 2.4)
                T.T = np.eye(4)
            for i in range(6):
                x = rng.uniform(-20, 15); z = rng.uniform(-1.2, 1.2)
                T.push(rot_y=rng.uniform(0, 6), rot_x=rng.uniform(-0.1, 0.1), offset=(x, y + 0.01, z))
                T.cbox(0, 0, 0, 0.6, 0.02, 0.6, M['ceiling'], s=1 / 2.4)
                T.T = np.eye(4)

        # decals (floor) and wall handprints
        cells = {'blood': [0, 1], 'blood_trail': [2], 'handprint': [3], 'grime': [4], 'stain': [5], 'water': [6], 'footprints': [7]}
        rngd = np.random.default_rng(sum(map(ord, lid)) * 7)

        def decal_quad(x, yy, z, rot, s, cell, vertical=None):
            col_ = cell % 4; row = cell // 4
            u0, u1 = col_ / 4, (col_ + 1) / 4
            v0, v1 = (0.5, 1.0) if row == 0 else (0.0, 0.5)
            hs = s / 2
            if vertical is None:
                cs, sn = math.cos(rot), math.sin(rot)
                corners = [(-hs, -hs), (hs, -hs), (hs, hs), (-hs, hs)]
                pts = [(x + cx * cs - cz * sn, yy, z + cx * sn + cz * cs) for cx, cz in corners]
                D.poly(pts, M['decal'], [(u0, v1), (u1, v1), (u1, v0), (u0, v0)], normal=(0, 1, 0))
            else:
                axis, sign = vertical
                if axis == 'x':  # wall along x, decal faces +/-z
                    pts = [(x - hs, yy - hs, z), (x + hs, yy - hs, z), (x + hs, yy + hs, z), (x - hs, yy + hs, z)]
                    D.poly(pts, M['decal'], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], normal=(0, 0, sign))
                else:
                    pts = [(x, yy - hs, z - hs), (x, yy - hs, z + hs), (x, yy + hs, z + hs), (x, yy + hs, z - hs)]
                    D.poly(pts, M['decal'], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], normal=(sign, 0, 0))

        for i, d in enumerate([d for d in L['decals'] if d['level'] == lid]):
            cl = cells.get(d['kind'], [4])
            decal_quad(d['x'], d['y'] + i * 0.0002, d['z'], d['rot'], d['s'], cl[i % len(cl)])
        n_hand = {'B': 5, '1': 2, '2': 3, '3': 4, '4': 6}[lid]
        corr = [cc for cc in L['corridors'] if cc['level'] == lid][0]
        for i in range(n_hand):
            x = rngd.uniform(corr['x0'] + 1, 16); hy = y + rngd.uniform(0.8, 1.6)
            side = 1 if rngd.random() < 0.5 else -1
            zf = side * (1.5 - 0.09 - 0.004)
            decal_quad(x, hy, zf, 0, rngd.uniform(0.28, 0.4), 3, vertical=('x', -side))
        if isB:
            # bloody footprints leading out of the morgue toward the stairs
            for i in range(6):
                decal_quad(12.5 + i * 0.8, y + 0.014, -0.4 + 0.3 * math.sin(i), -math.pi / 2, 0.8, 7)

        # signs
        sign_objs = []
        for sg in [s for s in L['signs'] if s['level'] == lid]:
            size = {'small': 0.075, 'medium': 0.13, 'large': 0.17, 'facade': 0.55}[sg['size']]
            tm = text_mesh(sg['text'], size, root, M['sign_text'] if sg['size'] != 'facade' else M['dark'], extrude=0.004 if sg['size'] != 'facade' else 0.06)
            to = bpy.data.objects.new('sign_txt', tm); root.objects.link(to)
            xs = [v.co.x for v in tm.vertices]
            tw = (max(xs) - min(xs)) if xs else 0.5
            bw = tw + 0.14
            bh = size * 2.1
            sb = MB()
            if sg['size'] == 'facade':
                sb.cbox(0, -bh / 2, -0.06, bw + 0.4, bh, 0.06, M['metal'])
            else:
                sb.cbox(0, -bh / 2, -0.012, bw, bh, 0.012, M['sign'], s=2)
                sb.box(-bw / 2, bh / 2 - 0.03, 0.0, bw / 2, bh / 2 - 0.012, 0.002, M['green'], faces='Z')
            if sg.get('hang'):
                sb.tube([(-bw / 2 + 0.05, bh / 2, -0.006), (-bw / 2 + 0.05, bh / 2 + 0.4, -0.006)], 0.006, M['steel'])
                sb.tube([(bw / 2 - 0.05, bh / 2, -0.006), (bw / 2 - 0.05, bh / 2 + 0.4, -0.006)], 0.006, M['steel'])
                # double-sided: back text
            bo = sb.build('sign_board', root)
            for o in (to, bo):
                o.location = to_b((sg['x'], sg['y'], sg['z']))
            to.rotation_euler = (math.pi / 2, 0, sg['rot'])
            to.location = to_b((sg['x'] + math.sin(sg['rot']) * 0.002, sg['y'], sg['z'] + math.cos(sg['rot']) * 0.002))
            bo.rotation_euler = (0, 0, sg['rot'])
            sign_objs += [to, bo]

        objs = []
        for name, b in (('walls', W), ('floor', F), ('ceiling', Cc), ('glass', G), ('decals', D), ('detail', T)):
            if not b.empty_():
                o = b.build(f'L{lid}_{name}', root)
                o.parent = par
                objs.append(o)
        if sign_objs:
            so = join(sign_objs, f'L{lid}_signs')
            so.parent = par

        # props (linked duplicates -> EXT_mesh_gpu_instancing)
        for i, p in enumerate([p for p in L['props'] if p['level'] == lid]):
            inst(protos[p['type']], f"{p['type']}_{lid}_{i}", par, p['x'], p['y'], p['z'], p['rot'], p.get('tilt', 0.0) * 0.5)
        for i, l in enumerate([l for l in L['lights'] if l['level'] == lid]):
            rot = 0.0 if l['room'] in ('corridor',) else (math.pi / 2 if l['room'] == 'stair' else 0.0)
            inst(fixture_mesh, f'fixture_{lid}_{i}', par, l['x'], l['y'] + 0.04, l['z'], rot)
        for i, e in enumerate([e for e in L['emergencyLights'] if e['level'] == lid]):
            inst(emerg_mesh, f'emerg_{lid}_{i}', par, e['x'], e['y'], e['z'], e['face'])
        for i, s in enumerate([s for s in L['speakers'] if s['level'] == lid]):
            inst(speaker_mesh, f'speaker_{lid}_{i}', par, s['x'], s['y'] + 0.1, s['z'])

    # --------------------------------------------------------------- exterior
    E = MB(); X = MB()
    ex = L['exterior']
    B = L['bounds']
    # ground: muddy field + parking asphalt + road
    # (four strips around the building footprint: the ground must not run under the
    #  building, or it shows through the stair opening down to the basement)
    Bd = L['bounds']
    for (gx0, gx1, gz0, gz1) in ((-160, Bd['x0'], -120, 120), (Bd['x1'], 120, -120, 120),
                                 (Bd['x0'], Bd['x1'], Bd['z1'], 120), (Bd['x0'], Bd['x1'], -120, Bd['z0'])):
        E.box(gx0, -0.06, gz0, gx1, -0.03, gz1, M['mud'], s=1 / 6, faces='Y')
    E.box(-70, -0.03, -26, B['x0'], -0.005, 26, M['asphalt'], s=1 / 5, faces='Y')
    E.box(-74, -0.03, -120, -62, -0.004, 120, M['asphalt'], s=1 / 5, faces='Y')
    # path from car park to entrance
    E.box(B['x0'] - 6, -0.005, -2.5, B['x0'], 0.0, 2.5, M['floor_conc'], s=1 / 3, faces='Y')
    # parking lines
    for i in range(10):
        z = -22 + i * 4.5
        if abs(z) < 3.5:
            continue
        E.box(-44, 0.0, z - 0.06, -38, 0.004, z + 0.06, M['sign'], faces='Y')
    E.box(-68.2, -0.003, -120, -67.8, 0.001, 120, M['orange'], faces='Y')
    # canopy over entrance
    E.box(B['x0'] - 4.5, 3.0, -3.2, B['x0'], 3.3, 3.2, M['dark'], s=0.4)
    for cz in (-2.9, 2.9):
        E.cyl((B['x0'] - 4.2, 0, cz), 0.15, 3.0, M['metal'], seg=10)
    # roof + parapet
    E.box(B['x0'] - 0.2, 15.95, B['z0'] - 0.2, B['x1'] + 0.2, 16.3, B['z1'] + 0.2, M['roof'], s=0.25)
    for (x0, x1, z0, z1) in ((B['x0'] - 0.2, B['x1'] + 0.2, B['z1'], B['z1'] + 0.25), (B['x0'] - 0.2, B['x1'] + 0.2, B['z0'] - 0.25, B['z0']),
                             (B['x0'] - 0.25, B['x0'], B['z0'], B['z1']), (B['x1'], B['x1'] + 0.25, B['z0'], B['z1'])):
        E.box(x0, 16.3, z0, x1, 17.0, z1, M['roof'], s=0.25)
    # rooftop units / water tank
    E.cbox(10, 16.3, 3, 3, 1.6, 2.4, M['metal'])
    E.cyl((-12, 16.3, -3), 1.6, 3.2, M['metal'], seg=14)
    # floor band ledges on the facade
    for yy in (4.0, 8.0, 12.0):
        E.box(B['x0'] - 0.25, yy - 0.12, B['z0'] - 0.25, B['x1'] + 0.25, yy + 0.06, B['z1'] + 0.25, M['roof'], s=0.25, faces='xXzZYy')
    # lamp posts (dead) and dead trees
    rng = np.random.default_rng(99)
    rng_t = np.random.default_rng(7)
    TREES = []
    for (lx, lz) in ((-30, -10), (-30, 10), (-48, -14), (-48, 14), (-60, 0)):
        E.cyl((lx, 0, lz), 0.09, 5.5, M['dark'], seg=8)
        E.tube([(lx, 5.5, lz), (lx + 0.8, 5.7, lz)], 0.05, M['dark'])
        E.cbox(lx + 0.9, 5.45, lz, 0.5, 0.15, 0.25, M['dark'])
    for i in range(26):
        while True:
            tx = rng.uniform(-110, 50); tz = rng.uniform(-70, 70)
            if not (-75 < tx < B['x1'] + 6 and -30 < tz < 30):
                break
        h = rng.uniform(5, 10)
        for k in range(6):                       # (keeps the original random sequence -> same spots)
            a = rng.uniform(0, 6.28); by = rng.uniform(h * 0.4, h * 0.9); l = rng.uniform(1.0, 3.0)
        # leafy trees (ns_trees.py / trees.glb) are instanced here by the game
        TREES.append({'x': round(float(tx), 3), 'z': round(float(tz), 3), 'rot': round(float(rng_t.uniform(0, 6.283)), 3),
                      'scale': round(float(h / 8.5), 3), 'variant': int(i % 3)})
    # chain-link fence line around the car park
    for (a0, a1, zz) in ((-70, B['x0'] - 2, 26), (-70, B['x0'] - 2, -26)):
        for xx in np.arange(a0, a1, 3):
            X.cyl((xx, 0, zz), 0.04, 2.0, M['steel'], seg=5)
        X.tube([(a0, 1.95, zz), (a1, 1.95, zz)], 0.025, M['steel'])
        X.box(a0, 0.05, zz - 0.005, a1, 1.95, zz + 0.005, M['glass'], faces='zZ', s=0.5)
    # a row of trees just beyond each car-park fence (frames the intro and the morning ending)
    for side in (-1, 1):
        for k, xx in enumerate(np.arange(-68, -24, 6.5)):
            TREES.append({'x': round(float(xx + rng_t.uniform(-1.5, 1.5)), 3), 'z': round(float(side * rng_t.uniform(29.5, 33.5)), 3),
                          'rot': round(float(rng_t.uniform(0, 6.283)), 3), 'scale': round(float(rng_t.uniform(0.75, 1.1)), 3), 'variant': int((k + side) % 3)})
    import json
    with open(os.path.join(ns_lib.MODEL_DIR, 'trees.json'), 'w') as fh: json.dump(TREES, fh)
    eo = E.build('EXT_ground', root); eo.parent = ext_root
    xo = X.build('EXT_nature', root); xo.parent = ext_root

    # Hide prototypes from export by unlinking from scene collection tree.
    for o in list(proto_coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(proto_coll)

    stats = {'objects': len(bpy.data.objects), 'tris': 0}
    for o in bpy.data.objects:
        if o.type == 'MESH':
            stats['tris'] += sum(len(p.vertices) - 2 for p in o.data.polygons)
    if export:
        path = os.path.join(ns_lib.MODEL_DIR, 'hospital.glb')
        stats['bytes'] = ns_lib.export_glb(path)
        os.makedirs(os.path.join(ns_lib.ROOT, 'blender', 'Environment'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ns_lib.ROOT, 'blender', 'Environment', 'hospital.blend'))
    return stats

