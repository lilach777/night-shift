# NIGHT SHIFT — analysis, slicing and processing of external (CC0) recordings.
# Candidates are downloaded with tools/freesound.ps1 into blender/audio_src/ext/<group>/,
# compared objectively here, and the chosen ones are cut into one-shots and encoded.
import os, json, glob
import numpy as np
import aud
import ns_audio as A

EXT = os.path.join(A.SRC, 'ext')
SR = A.SR


def load(path, mono=True):
    s = aud.Sound(path).resample(SR, False)
    d = s.data().astype(np.float64)     # frames x channels
    if d.ndim == 1: d = d[:, None]
    return d.mean(1) if mono else d


def frames_rms(x, win=0.02):
    n = int(win * SR)
    m = len(x) // n
    f = x[:m * n].reshape(m, n)
    return np.sqrt((f ** 2).mean(1) + 1e-12)


def db(v): return 20 * np.log10(np.maximum(v, 1e-9))


def onsets(x, min_gap=0.18, rel_db=18):
    """Transient events: 10 ms frames rising > rel_db above the noise floor, spaced by min_gap."""
    hop = int(0.01 * SR)
    m = len(x) // hop
    e = np.sqrt((x[:m * hop].reshape(m, hop) ** 2).mean(1) + 1e-12)
    ed = db(e)
    floor = np.percentile(ed, 12)
    # gated/edited recordings have a digital-silence floor: also require being
    # within ~32 dB of the recording's loud events so faint gate noise isn't an "onset"
    thr = max(floor + rel_db, np.percentile(ed, 99.5) - 32)
    out = []
    last = -1e9
    for i in range(1, m):
        if ed[i] > thr and ed[i] - ed[i - 1] > 4 and (i - last) * 0.01 > min_gap:
            out.append(i * hop); last = i
    return out, floor


def analyse(path):
    x = load(path)
    r = db(frames_rms(x))
    floor = np.percentile(r, 10)
    peak = np.percentile(r, 99.5)
    clip = float(np.mean(np.abs(x) > 0.995))
    ons, _ = onsets(x)
    X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    centroid = float((f * X).sum() / (X.sum() + 1e-9))
    low = float(X[f < 80].sum() / (X.sum() + 1e-9))
    # tail: median time for the envelope to fall 20 dB after each onset
    hop = int(0.01 * SR)
    m = len(x) // hop
    ed = db(np.sqrt((x[:m * hop].reshape(m, hop) ** 2).mean(1) + 1e-12))
    tails = []
    for o in ons:
        i = o // hop
        pk = ed[i:i + 5].max() if i + 5 < m else ed[i]
        j = i
        while j < m - 1 and ed[j] > pk - 20 and j - i < 150: j += 1
        tails.append((j - i) * 0.01)
    return {
        'file': os.path.basename(path), 'dur': round(len(x) / SR, 1), 'snr_db': round(peak - floor, 1),
        'floor_db': round(floor, 1), 'clip%': round(clip * 100, 3), 'events': len(ons),
        'tail_s': round(float(np.median(tails)) if tails else 0, 2), 'centroid_hz': int(centroid), 'rumble%': round(low * 100, 1),
    }


def report(group):
    rows = [analyse(p) for p in sorted(glob.glob(os.path.join(EXT, group, '*.mp3')))]
    lic = {}
    lf = os.path.join(EXT, group, 'LICENSES.json')
    if os.path.exists(lf):
        with open(lf, encoding='utf-8-sig') as fh:
            for e in json.load(fh): lic['fs_%s.mp3' % e['id']] = e['title']
    for r in rows: r['title'] = lic.get(r['file'], '')[:60]
    return rows


# ----------------------------------------------------------------------------- slicing
def slice_events(path, pre=0.012, max_len=0.45, min_gap=0.18, rel_db=18, fade_ms=40, keep=None):
    """Cut a sequence recording into clean one-shot events, ordered by quality (loudness, isolation)."""
    x = load(path)
    ons, floor = onsets(x, min_gap, rel_db)
    cuts = []
    for k, o in enumerate(ons):
        a = max(0, o - int(pre * SR))
        nxt = ons[k + 1] - int(0.01 * SR) if k + 1 < len(ons) else len(x)
        b = min(len(x), a + int(max_len * SR), nxt)
        seg = x[a:b].copy()
        if len(seg) < int(0.08 * SR): continue
        n = int(fade_ms / 1000 * SR)
        seg[-n:] *= np.linspace(1, 0, n) ** 2
        seg[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        pk = np.abs(seg).max()
        isolation = (b - a) / SR
        cuts.append((pk * min(1, isolation / 0.25), seg))
    cuts.sort(key=lambda c: -c[0])
    segs = [c[1] for c in cuts]
    return segs[:keep] if keep else segs


def segment(path, t0, t1, fade_in=0.004, fade_out=0.06):
    x = load(path)
    seg = x[int(t0 * SR):int(t1 * SR)].copy()
    a, b = int(fade_in * SR), int(fade_out * SR)
    if a: seg[:a] *= np.linspace(0, 1, a)
    if b: seg[-b:] *= np.linspace(1, 0, b) ** 2
    return seg


def clean(seg, hp=60, lp=None, gate_db=None):
    y = A.ffilt(seg, lo=hp, hi=lp) if (hp or lp) else seg
    if gate_db is not None:
        # gentle expander on the noise floor between transients
        env = np.convolve(np.abs(y), np.ones(int(0.01 * SR)) / int(0.01 * SR), 'same')
        thr = 10 ** (gate_db / 20) * np.abs(y).max()
        g = np.clip(env / thr, 0, 1) ** 0.6
        y = y * g
    return y


def rms_norm(seg, target=0.16, window=0.15):
    """Loudness-match one-shots on their attack (so every footstep feels the same weight)."""
    n = min(len(seg), int(window * SR))
    r = np.sqrt((seg[:n] ** 2).mean() + 1e-12)
    y = seg * (target / r)
    pk = np.abs(y).max()
    return y * (0.95 / pk) if pk > 0.95 else y


def compress(x, thr_db=-18, ratio=3.0, att=0.004, rel=0.12):
    env = np.abs(x)
    a, r = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    # one-pole envelope follower (vectorised in blocks for speed)
    e = np.empty_like(env); s = 0.0
    for i in range(0, len(env), 64):
        blk = env[i:i + 64].max()
        s = a * s + (1 - a) * blk if blk > s else r * s + (1 - r) * blk
        e[i:i + 64] = s
    lvl = 20 * np.log10(np.maximum(e, 1e-9))
    over = np.maximum(0, lvl - thr_db)
    gain = 10 ** (-over * (1 - 1 / ratio) / 20)
    return x * gain


def write_set(rel_base, segs, bitrate=112000, start=1):
    names = []
    for i, s in enumerate(segs):
        A.write(f'{rel_base}_{i + start}', s, peak=0.95, bitrate=bitrate, normalize=False)
        names.append(f'{rel_base}_{i + start}')
    return names


SOURCES = {}   # filled by build(): output -> list of freesound ids (for the credits)


def F(group, fid): return os.path.join(EXT, group, f'fs_{fid}.mp3')


def build():
    A.WRITTEN.clear()
    SOURCES.clear()
    def steps(fid, gap, n, hp=70, lp=None, max_len=0.42, target=0.16, group='footsteps', rel_db=18):
        segs = slice_events(F(group, fid), min_gap=gap, keep=n, max_len=max_len, rel_db=rel_db)
        return [rms_norm(clean(s, hp=hp, lp=lp), target) for s in segs]
    # ---------------- footsteps (all CC0, Freesound)
    # Nox_Sound boots on tile: the take mixes clean walking with a scuff/shuffle section,
    # so use the 8 strongest isolated heel strikes (measured peak times)
    walk_tile = [rms_norm(clean(segment(F('footsteps', 555868), t - 0.035, t + 0.36, fade_out=0.05), hp=70), 0.15)
                 for t in (5.39, 7.4, 27.34, 28.3, 31.08, 33.01, 34.56, 35.29)]
    run_tile = steps(170501, 0.2, 8, max_len=0.3, target=0.2)                          # SpliceSound tile, fast pace
    walk_conc = steps(558472, 0.28, 8, hp=55, target=0.15)                             # Nox_Sound boots on rock/concrete
    run_conc = steps(558471, 0.2, 5, hp=55, max_len=0.32, target=0.2) + steps(558468, 0.18, 3, hp=55, max_len=0.3, target=0.2)
    stairs = steps(383673, 0.3, 4, max_len=0.45, target=0.16) + steps(383661, 0.3, 4, max_len=0.45, target=0.16)
    write_set('player/step_tile', walk_tile); SOURCES['player/step_tile_*'] = [555868]
    write_set('player/run_tile', run_tile); SOURCES['player/run_tile_*'] = [170501]
    write_set('player/step_concrete', walk_conc); SOURCES['player/step_concrete_*'] = [558472]
    write_set('player/run_concrete', run_conc); SOURCES['player/run_concrete_*'] = [558471, 558468]
    write_set('player/step_stairs', stairs); SOURCES['player/step_stairs_*'] = [383673, 383661]
    # ---------------- doors
    D = lambda fid, a, b, fo=0.08: clean(segment(F('doors', fid), a, b, fade_out=fo), hp=45)
    norm = lambda s, p=0.9: A.norm(s, p)
    wood_open = [norm(D(734944, 1.25, 2.55)), norm(D(734944, 6.68, 8.0)), norm(D(734944, 12.05, 13.1))]
    wood_close = [norm(D(734944, 4.7, 6.0)), norm(D(734944, 9.62, 10.95)), norm(D(734944, 15.6, 16.95)), norm(D(482295, 4.95, 6.9))]
    latch = [norm(D(125297, a - 0.05, b + 0.12, 0.05), 0.8) for a, b in ((0.19, 0.81), (2.28, 2.98), (5.65, 6.19), (8.78, 9.39), (11.62, 12.2), (13.08, 13.61))]
    write_set('environment/door_wood_open', wood_open); SOURCES['environment/door_wood_open_*'] = [734944]
    write_set('environment/door_wood_close', wood_close); SOURCES['environment/door_wood_close_*'] = [734944, 482295]
    write_set('environment/door_latch', latch); SOURCES['environment/door_latch_*'] = [125297]
    A.write('environment/door_heavy_open', norm(D(453966, 2.95, 5.2, 0.3)), 0.92, normalize=False); SOURCES['environment/door_heavy_open'] = [453966]
    A.write('environment/door_heavy_close', norm(D(453966, 7.9, 9.7, 0.25)), 0.95, normalize=False); SOURCES['environment/door_heavy_close'] = [453966]
    A.write('environment/door_basement_open', norm(D(383830, 0.85, 4.2, 0.5)), 0.9, normalize=False); SOURCES['environment/door_basement_open'] = [383830]
    A.write('environment/door_basement_close', norm(D(383830, 20.15, 21.9, 0.35)), 0.95, normalize=False); SOURCES['environment/door_basement_close'] = [383830]
    morgue_open = A.mx(norm(D(564389, 4.7, 6.2, 0.2), 0.75), np.concatenate([np.zeros(int(0.55 * SR)), norm(D(568108, 0.85, 2.45, 0.3), 0.85)]))
    A.write('environment/door_morgue_open', morgue_open, 0.92); SOURCES['environment/door_morgue_open'] = [564389, 568108]
    morgue_close = A.mx(norm(D(568108, 4.3, 5.75, 0.3), 0.9), np.concatenate([np.zeros(int(0.12 * SR)), norm(D(564390, 1.35, 2.6, 0.2), 0.55)]))
    A.write('environment/door_morgue_close', morgue_close, 0.95); SOURCES['environment/door_morgue_close'] = [568108, 564390]
    A.write('environment/door_creak', norm(D(455852, 0.85, 3.9, 0.4)), 0.9, normalize=False); SOURCES['environment/door_creak'] = [455852]
    slam = A.mx(norm(D(406197, 0.1, 2.95, 0.6), 0.95), norm(D(734944, 4.7, 6.0), 0.5))
    A.write('environment/door_slam', slam, 0.97); SOURCES['environment/door_slam'] = [406197, 734944]
    # ---------------- drawers / cabinets
    C = lambda fid, a, b, fo=0.08: clean(segment(F('containers', fid), a, b, fade_out=fo), hp=60)
    A.write('environment/drawer_wood_open_1', norm(C(353622, 0.0, 1.95)), 0.85, normalize=False)
    A.write('environment/drawer_wood_close_1', norm(C(353622, 2.58, 4.75)), 0.9, normalize=False)
    A.write('environment/drawer_wood_open_2', norm(C(829805, 0.12, 1.95)), 0.85, normalize=False)
    A.write('environment/drawer_wood_close_2', norm(C(829805, 2.35, 4.0)), 0.9, normalize=False)
    SOURCES['environment/drawer_wood_*'] = [353622, 829805]
    A.write('environment/drawer_metal_open_1', norm(C(509464, 0.18, 3.0)), 0.85, normalize=False)
    A.write('environment/drawer_metal_close_1', norm(C(509464, 3.58, 6.2)), 0.9, normalize=False)
    A.write('environment/drawer_metal_open_2', norm(C(185842, 0.05, 1.7)), 0.85, normalize=False)
    A.write('environment/drawer_metal_close_2', norm(C(185842, 1.98, 4.0)), 0.9, normalize=False)
    SOURCES['environment/drawer_metal_*'] = [509464, 185842]
    A.write('environment/cabinet_open', norm(C(403539, 0.12, 1.3)), 0.85, normalize=False)
    A.write('environment/cabinet_close', norm(C(403539, 1.42, 2.6)), 0.9, normalize=False)
    SOURCES['environment/cabinet_*'] = [403539]
    # ---------------- the telephone laugh
    L = lambda fid, a, b: clean(segment(os.path.join(EXT, 'laugh', f'fs_{fid}.mp3'), a, b, fade_out=0.25), hp=90)
    main = np.concatenate([L(686444, 0.5, 3.9), np.zeros(int(0.12 * SR)), L(686444, 5.05, 9.4)])
    main = A.norm(main, 1)
    low = A.norm(L(405613, 3.92, 7.05), 1)
    low = A.pitch_shift(low, -5)
    layer = np.zeros(len(main)); off = int(0.9 * SR)
    n = min(len(low), len(main) - off); layer[off:off + n] = low[:n]
    lead = A.pitch_shift(main, -2)
    y = lead * 1.0 + layer * 0.45 + main * 0.25
    # it slows and drags at the very end — unnatural, not theatrical
    tail_n = int(1.2 * SR)
    end = A.time_stretch(y[-tail_n:], 1.35)
    y = np.concatenate([y[:-tail_n], A.resample(end, 1.06)])
    y = compress(A.norm(y, 1), -16, 3.5)
    y = A.telephone(A.norm(y, 1), crush=False)
    rng = A.R(902)
    bed = A.ffilt(rng.standard_normal(len(y)), lo=400, hi=3200) * 0.006
    A.write('voice/phone_laugh', A.fade(A.reverb(y + bed, 0.08, 0.5, 7, 92), 0.003, 0.4), 0.95, 96000)
    SOURCES['voice/phone_laugh'] = [686444, 405613]
    # spoken line: telephone EQ + subtle distortion + compression + slight pitch + small-room reverb
    V = os.path.join(A.SRC, 'voice')
    x = A.trim(A.read_wav(os.path.join(V, 'phone_threat.wav')), 0.008)
    y = A.pitch_shift(x, -2) * 1.0 + x * 0.45
    y = compress(A.norm(y, 1), -20, 3.0)
    y = A.telephone(A.norm(y, 1), crush=False)
    y = A.reverb(y, 0.06, 0.35, 9, 91)
    bed = A.ffilt(rng.standard_normal(len(y)), lo=400, hi=3200) * 0.004
    A.write('voice/phone_threat', A.fade(np.concatenate([np.zeros(int(0.1 * SR)), A.norm(y, 1) + bed]), 0.002, 0.1), 0.95, 96000)
    # disconnect: line static dies, then the engaged/busy tone (480 + 620 Hz, 0.5 s cadence)
    t = np.arange(int(2.0 * SR)) / SR
    tone = (np.sin(A.TAU * 480 * t) + np.sin(A.TAU * 620 * t)) * 0.3 * ((t % 1.0) < 0.5)
    tone *= np.minimum(1, (t % 1.0) / 0.01) * np.minimum(1, np.maximum(0, 0.5 - (t % 1.0)) / 0.01 + ((t % 1.0) >= 0.5))
    A.write('environment/phone_busy', A.telephone(tone, crush=False) * 0.6, 0.6, 80000)
    # licences / credits
    meta = {}
    for g in ('footsteps', 'doors', 'containers', 'laugh'):
        lf = os.path.join(EXT, g, 'LICENSES.json')
        if os.path.exists(lf):
            with open(lf, encoding='utf-8-sig') as fh:
                for e in json.load(fh): meta[int(e['id'])] = e
    credits = []
    for out, ids in SOURCES.items():
        for i in ids:
            m = meta.get(int(i), {})
            credits.append({'file': out, 'freesound_id': i, 'title': m.get('title', ''), 'license': m.get('license', ''), 'url': m.get('url', f'https://freesound.org/s/{i}/')})
    with open(os.path.join(A.OUT, 'CREDITS_EXTERNAL.json'), 'w', encoding='utf-8') as fh:
        json.dump(credits, fh, indent=1)
    return {'written': [(w[0], w[2]) for w in A.WRITTEN], 'licenses': sorted({c['license'] for c in credits})}


def events_timeline(path, rel_db=18, min_gap=0.18):
    x = load(path)
    ons, floor = onsets(x, min_gap, rel_db)
    return [round(o / SR, 2) for o in ons]
