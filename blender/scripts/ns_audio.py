# NIGHT SHIFT — complete procedural sound design (numpy DSP inside Blender) +
# processing of the offline TTS voice lines. Encodes Ogg Vorbis with Blender's aud.
# Every sound in the game is generated here: no third-party samples, no licences.
import os, math, wave
import numpy as np
import aud

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
SRC = os.path.join(ROOT, 'blender', 'audio_src')
SR = 44100
TAU = 2 * np.pi


# ============================================================================ DSP core
def T(d): return np.arange(int(d * SR)) / SR
def R(seed): return np.random.default_rng(seed)


def ffilt(x, lo=None, hi=None, order=2, bands=None, tilt=None):
    """Zero-phase FFT filter. lo=highpass cutoff, hi=lowpass cutoff, bands=[(f0,q,gain)]."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    fs = np.maximum(f, 1e-3)
    H = np.ones_like(f)
    if lo: H *= 1 / np.sqrt(1 + (lo / fs) ** (2 * order))
    if hi: H *= 1 / np.sqrt(1 + (fs / hi) ** (2 * order))
    if bands:
        B = np.zeros_like(f)
        for f0, q, g in bands:
            B += g / np.sqrt(1 + ((fs / f0 - f0 / fs) * q) ** 2)
        H *= B
    if tilt is not None:
        H *= (fs / 1000.0) ** tilt
    return np.fft.irfft(X * H, n)


def bp(x, f0, q=1.0): return ffilt(x, bands=[(f0, q, 1.0)])


def pink(n, rng):
    x = rng.standard_normal(n)
    return ffilt(x, lo=20, tilt=-0.5)


def brown(n, rng):
    x = np.cumsum(rng.standard_normal(n))
    return ffilt(x, lo=18, order=2)


def slow_noise(n, rate_hz, rng, smooth=True):
    """Smooth random control signal 0..1 changing at ~rate_hz."""
    k = max(2, int(n / SR * rate_hz) + 2)
    pts = rng.random(k)
    xs = np.linspace(0, n, k)
    y = np.interp(np.arange(n), xs, pts)
    if smooth:
        y = ffilt(y - y.mean(), hi=rate_hz * 1.5) + y.mean()
    return y


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) + 1e-9
    return x * (peak / m)


def fade(x, a=0.005, b=0.02):
    x = x.copy()
    na, nb = int(a * SR), int(b * SR)
    if x.ndim == 1:
        if na: x[:na] *= np.linspace(0, 1, na)
        if nb: x[-nb:] *= np.linspace(1, 0, nb)
    else:
        if na: x[:na] *= np.linspace(0, 1, na)[:, None]
        if nb: x[-nb:] *= np.linspace(1, 0, nb)[:, None]
    return x


def loopify(x, xf=1.0):
    """Crossfade the tail into the head so the buffer loops seamlessly."""
    n = int(xf * SR)
    L = len(x) - n
    out = x[:L].copy()
    w = np.sqrt(np.linspace(0, 1, n))
    v = np.sqrt(1 - np.linspace(0, 1, n))
    if x.ndim == 1:
        out[:n] = x[:n] * w + x[L:L + n] * v
    else:
        out[:n] = x[:n] * w[:, None] + x[L:L + n] * v[:, None]
    return out


def wrap(buf, L):
    """Fold anything rendered past L back to the start (for seamless rhythmic loops)."""
    out = buf[:L].copy()
    tail = buf[L:]
    out[:len(tail)] += tail
    return out


def conv(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


def make_ir(dur=2.0, decay=3.0, seed=1, hi=6000, pre=0.01):
    rng = R(seed)
    t = T(dur)
    ir = rng.standard_normal(len(t)) * np.exp(-t * decay)
    ir = ffilt(ir, hi=hi, lo=60)
    ir[:int(pre * SR)] *= 0.2
    ir[0] = 1.0
    return ir / np.sqrt(np.sum(ir ** 2)) * 0.6


def reverb(x, mix=0.3, dur=2.2, decay=3.0, seed=3, hi=5000, tail=True):
    ir = make_ir(dur, decay, seed, hi)
    wet = conv(x, ir)
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    y = dry * (1 - mix * 0.5) + wet * mix
    return y if tail else y[:len(x)]


def dist(x, drive=2.0):
    return np.tanh(x * drive) / np.tanh(drive)


def stereo(l, r=None):
    if r is None: r = l
    n = min(len(l), len(r))
    return np.stack([l[:n], r[:n]], 1)


def osc(freq, dur_or_t, kind='sin', phase0=0.0):
    """freq: scalar or array (per-sample)."""
    t = dur_or_t if isinstance(dur_or_t, np.ndarray) else T(dur_or_t)
    if np.isscalar(freq):
        ph = TAU * freq * t + phase0
    else:
        ph = TAU * np.cumsum(freq) / SR + phase0
    if kind == 'sin': return np.sin(ph)
    if kind == 'saw': return 2 * ((ph / TAU) % 1) - 1
    if kind == 'sqr': return np.sign(np.sin(ph))
    if kind == 'tri': return 2 * np.abs(2 * ((ph / TAU) % 1) - 1) - 1


def additive_saw(freq, t, maxf=9000, nmax=40):
    """Band-limited sawtooth (per-sample frequency allowed)."""
    f = freq if not np.isscalar(freq) else np.full(len(t), freq)
    ph = TAU * np.cumsum(f) / SR
    out = np.zeros(len(t))
    for k in range(1, nmax + 1):
        mask = (f * k < maxf).astype(float)
        if not mask.any(): break
        out += mask * np.sin(ph * k) / k
    return out * 0.6


def mx(*arrs):
    """Sum arrays of different lengths (zero-padded)."""
    n = max(len(a) for a in arrs)
    out = np.zeros(n)
    for a in arrs:
        out[:len(a)] += a
    return out


def place(buf, snd, at):
    i = int(at * SR)
    if i >= len(buf): return
    n = min(len(snd), len(buf) - i)
    buf[i:i + n] += snd[:n]


# STFT / ISTFT / phase vocoder
def stft(x, n=1024, hop=256):
    win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), x, np.zeros(n)])
    frames = np.lib.stride_tricks.sliding_window_view(pad, n)[::hop]
    return np.fft.rfft(frames * win, axis=1)


def istft(S, n=1024, hop=256, length=None):
    win = np.hanning(n)
    frames = np.fft.irfft(S, n, axis=1) * win
    out = np.zeros(hop * (len(frames) - 1) + n)
    wsum = np.zeros_like(out)
    for i, fr in enumerate(frames):
        out[i * hop:i * hop + n] += fr
        wsum[i * hop:i * hop + n] += win ** 2
    out /= np.maximum(wsum, 1e-6)
    out = out[n:]
    return out[:length] if length else out


def time_stretch(x, r, n=2048, hop=512):
    """Phase vocoder: r>1 = longer."""
    S = stft(x, n, hop)
    steps = np.arange(0, len(S) - 1, 1 / r)
    omega = TAU * hop * np.arange(n // 2 + 1) / n
    phase = np.angle(S[0])
    out = []
    for s in steps:
        i = int(s); fr = s - i
        a, b = S[i], S[i + 1]
        mag = (1 - fr) * np.abs(a) + fr * np.abs(b)
        out.append(mag * np.exp(1j * phase))
        dphi = np.angle(b) - np.angle(a) - omega
        dphi -= TAU * np.round(dphi / TAU)
        phase += omega + dphi
    return istft(np.array(out), n, hop)


def resample(x, ratio):
    """ratio > 1 => shorter / higher."""
    idx = np.arange(0, len(x) - 1, ratio)
    return np.interp(idx, np.arange(len(x)), x)


def pitch_shift(x, semis):
    r = 2 ** (semis / 12)
    y = time_stretch(x, r)
    y = resample(y, r)
    return y[:len(x)] if len(y) >= len(x) else np.concatenate([y, np.zeros(len(x) - len(y))])


def whisperize(x, n=512, hop=128, seed=5):
    rng = R(seed)
    S = stft(x, n, hop)
    mag = np.abs(S)
    ph = rng.uniform(0, TAU, mag.shape)
    y = istft(mag * np.exp(1j * ph), n, hop, len(x))
    return ffilt(y, lo=250)


def telephone(x, seed=9, crush=True):
    y = ffilt(x, lo=300, hi=3400, order=3)
    y = resample(resample(y, 44100 / 8000), 8000 / 44100)[:len(x)]
    if len(y) < len(x): y = np.concatenate([y, np.zeros(len(x) - len(y))])
    y = dist(y * 1.3, 1.3)
    if not crush: return y
    q = 2 ** 7
    return np.round(y * q) / q


def read_wav(path):
    with wave.open(path, 'rb') as w:
        sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels()
        data = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768
    if ch > 1: data = data.reshape(-1, ch).mean(1)
    return resample(data, sr / SR) if sr != SR else data


def trim(x, thr=0.01, pad=0.08):
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx): return x
    a = max(0, idx[0] - int(pad * SR)); b = min(len(x), idx[-1] + int(pad * SR))
    return x[a:b]


# ============================================================================ writer
WRITTEN = []


def write(rel, x, peak=0.9, bitrate=96000, normalize=True):
    path = os.path.join(OUT, rel + '.ogg')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    x = np.asarray(x, dtype=np.float64)
    if normalize: x = norm(x, peak)
    x = np.clip(x, -1, 1).astype(np.float32)
    st = x.ndim == 2
    if not st: x = x.reshape(-1, 1)
    snd = aud.Sound.buffer(np.ascontiguousarray(x), SR)
    snd.write(path, rate=SR, channels=aud.CHANNELS_STEREO if st else aud.CHANNELS_MONO,
              format=aud.FORMAT_FLOAT32, container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=bitrate)
    WRITTEN.append((rel, os.path.getsize(path), round(len(x) / SR, 2)))
    return path


# ============================================================================ AMBIENCE
def drops_layer(n, count, rng, lo=1500, hi=7000, dec=(0.001, 0.004)):
    buf = np.zeros(n)
    kernels = []
    for k in range(24):
        d = rng.uniform(*dec)
        kt = T(d * 8)
        ker = rng.standard_normal(len(kt)) * np.exp(-kt / d)
        ker = bp(ker, rng.uniform(lo, hi), 2.5)
        kernels.append(norm(ker, 1))
    pos = rng.integers(0, n - 2000, count)
    amps = rng.uniform(0.05, 1.0, count) ** 2
    for p, a in zip(pos, amps):
        k = kernels[rng.integers(0, len(kernels))]
        m = min(len(k), n - p)
        buf[p:p + m] += k[:m] * a
    return buf


def rain_render(dur, seed, inside=False):
    rng = R(seed)
    n = int(dur * SR)
    hiss = ffilt(pink(n, rng), lo=350, hi=9000 if not inside else 1800)
    drops = drops_layer(n, int(dur * (900 if not inside else 140)), rng, 1200, 6500)
    rumble = ffilt(brown(n, rng), hi=220) * 0.6
    gust = 0.82 + 0.3 * slow_noise(n, 0.25, rng)
    if inside:
        glass = drops_layer(n, int(dur * 40), rng, 2500, 7000, (0.0008, 0.002))
        drops = ffilt(drops, hi=2000)
        gutter = drops_layer(n, int(dur * 3), rng, 600, 1400, (0.01, 0.03)) * 0.8
        return (norm(hiss, 1) * 0.55 + norm(drops, 1) * 0.35 + norm(glass, 1) * 0.25 + norm(rumble, 1) * 0.45 + norm(gutter, 1) * 0.2) * gust
    return (norm(hiss, 1) * 0.75 + norm(drops, 1) * 0.35 + norm(rumble, 1) * 0.35) * gust


def amb_rain():
    for name, inside in (('rain_outside', False), ('rain_inside', True)):
        l = rain_render(21.5, 11 if not inside else 13, inside)
        r = rain_render(21.5, 12 if not inside else 14, inside)
        write('ambience/' + name, loopify(stereo(l, r), 1.5), 0.8, 112000)


def amb_wind(name='wind', dur=21.5, seed=21, soft=False):
    def ch(s):
        rng = R(s)
        n = int(dur * SR)
        src = pink(n, rng)
        S = stft(src, 2048, 512)
        f = np.fft.rfftfreq(2048, 1 / SR)
        c = 220 + 420 * slow_noise(len(S), 0.08 * SR / 512, rng)
        q = 2.5
        H = 1 / np.sqrt(1 + ((np.maximum(f, 1)[None, :] / c[:, None] - c[:, None] / np.maximum(f, 1)[None, :]) * q) ** 2)
        y = istft(S * H, 2048, 512, n)
        gust = 0.35 + 0.65 * slow_noise(n, 0.12, rng) ** 1.5
        whistle = osc(780 + 60 * slow_noise(n, 0.2, rng) * 2, T(dur)) * 0.04 * slow_noise(n, 0.1, rng)
        out = norm(y, 1) * gust + whistle
        if soft: out = ffilt(out, hi=900) * 0.8 + ffilt(pink(n, rng), lo=2000, hi=6000) * 0.03
        return out
    write('ambience/' + name, loopify(stereo(ch(seed), ch(seed + 1)), 1.5), 0.75 if not soft else 0.5, 96000)


def amb_hum():
    t = T(10)
    x = np.zeros(len(t))
    for k, a in ((1, 0.5), (2, 0.8), (3, 0.35), (4, 0.25), (5, 0.18), (6, 0.12), (7, 0.08), (9, 0.05)):
        x += a * np.sin(TAU * 60 * k * t + k)
    buzz = ffilt(np.sign(np.sin(TAU * 120 * t)) * 0.12, hi=2500)
    whine = np.sin(TAU * 7840 * t) * 0.006
    jitter = 1 + 0.05 * np.sin(TAU * 0.3 * t)
    write('ambience/hum_electric', (x * 0.4 + buzz) * jitter + whine, 0.5, 80000)


def amb_room_tone():
    rng = R(31)
    n = int(21.5 * SR); t = T(21.5)
    b = ffilt(brown(n, rng), hi=140) * 1.0
    d = np.sin(TAU * 41.2 * t) * 0.5 + np.sin(TAU * 43.65 * t) * 0.45 + np.sin(TAU * 55.0 * t + 1) * 0.2 * slow_noise(n, 0.05, rng)
    air = ffilt(pink(n, rng), lo=800, hi=3000) * 0.05
    x = norm(b, 1) * 0.6 + d * 0.35 + air
    write('ambience/room_tone', loopify(stereo(x, np.roll(x, 3000) * 0.9 + air), 2.0), 0.6, 80000)


def drip_snd(rng, big=False):
    d = 0.9
    t = T(d)
    f0 = rng.uniform(1100, 2400) * (0.7 if big else 1)
    f = f0 * (1 + 0.6 * np.exp(-t / 0.012))
    x = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / rng.uniform(0.02, 0.05))
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.0008) * 0.3
    return x + ffilt(click, lo=2000)


def amb_drips():
    rng = R(41)
    dur = 21.5; n = int(dur * SR)
    buf = np.zeros(n)
    tt = 0.3
    while tt < dur - 1:
        place(buf, drip_snd(rng) * rng.uniform(0.2, 1.0), tt)
        tt += rng.uniform(0.4, 2.8)
    buf = reverb(buf, 0.5, 2.5, 2.2, 5)[:n]
    pipes = ffilt(brown(n, rng), hi=90) * 0.3 + np.sin(TAU * 50 * T(dur)) * 0.03
    x = norm(buf, 1) * 0.8 + norm(pipes, 1) * 0.25
    write('ambience/basement_drips', loopify(stereo(x, np.roll(x, 9000)), 1.5), 0.7, 80000)


def amb_drone(name, seed, dark=True, dur=21.5):
    rng = R(seed)
    n = int(dur * SR); t = T(dur)
    x = np.zeros(n)
    for f, a in ((55, 0.5), (58.27, 0.35), (82.4, 0.25), (116.5, 0.12)):
        x += np.sin(TAU * f * t + rng.uniform(0, 6)) * a * (0.6 + 0.4 * slow_noise(n, 0.07, rng))
    sw = ffilt(pink(n, rng), lo=200, hi=1200) * slow_noise(n, 0.05, rng) * 0.4
    hi = np.sin(TAU * 1864.7 * t) * 0.012 * slow_noise(n, 0.1, rng)  # thin dissonant harmonic
    x = norm(x, 1) * 0.7 + norm(sw, 1) * 0.3 + hi
    x = reverb(x, 0.4, 3.5, 1.5, seed)[:n]
    write('music/' + name, loopify(stereo(x, np.roll(x, 7000)), 2.0), 0.6, 96000)


# ============================================================================ MUSIC
PIANO_NOTES = [110.0, 130.81, 164.81, 174.61, 220.0, 246.94, 261.63, 311.13, 329.63, 349.23, 440.0, 523.25]


def piano_note(f, seed, dur=6.5):
    rng = R(seed)
    t = T(dur)
    x = np.zeros(len(t))
    B = 0.00045 * (f / 220) ** 0.5
    for n in range(1, 18):
        fn = n * f * math.sqrt(1 + B * n * n)
        if fn > 11000: break
        amp = (1 / n ** 1.15) * abs(math.sin(math.pi * n * 0.13)) * rng.uniform(0.7, 1.1)
        dec = 3.2 / (1 + 0.4 * (n - 1)) * (220 / f) ** 0.4
        e = 0.62 * np.exp(-t / (dec * 0.22)) + 0.38 * np.exp(-t / (dec * 1.5))
        det = 1 + rng.normal(0, 0.0015)
        p1, p2 = rng.uniform(0, TAU, 2)
        x += amp * e * (np.sin(TAU * fn * t + p1) + 0.8 * np.sin(TAU * fn * det * t + p2))
    hammer = ffilt(rng.standard_normal(len(t)) * np.exp(-t / 0.004), lo=300, hi=5000) * 0.08
    board = np.sin(TAU * 95 * t) * np.exp(-t / 0.08) * 0.06
    att = 1 - np.exp(-t / 0.0015)
    y = x * att + hammer + board
    # slightly muffled old upright
    y = ffilt(y, hi=4500)
    return fade(y, 0, 0.6)


def music_piano():
    for i, f in enumerate(PIANO_NOTES):
        write(f'music/piano_{i:02d}', piano_note(f, 100 + i), 0.85, 96000)


def tom(rng, f0=90, d=0.6):
    t = T(d)
    f = f0 * (1 + 1.4 * np.exp(-t / 0.03))
    x = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / (d * 0.3))
    n = ffilt(rng.standard_normal(len(t)) * np.exp(-t / 0.02), lo=200, hi=3000) * 0.3
    return x + n


def clang(rng, d=1.5, base=180):
    t = T(d)
    x = np.zeros(len(t))
    for r_, a in ((1, 1), (2.76, 0.6), (5.4, 0.4), (8.93, 0.25), (13.3, 0.15)):
        x += np.sin(TAU * base * r_ * t + rng.uniform(0, 6)) * a * np.exp(-t / (d * 0.25 / r_ ** 0.3))
    return x + rng.standard_normal(len(t)) * np.exp(-t / 0.005) * 0.4


def music_chase():
    rng = R(51)
    bpm = 130; beat = 60 / bpm
    L = int(16 * beat * SR)   # 4 bars
    buf = np.zeros(L + SR * 3)
    for b in range(16):
        tb = b * beat
        place(buf, tom(rng, 70, 0.7) * 1.0, tb)
        if b % 2 == 1: place(buf, tom(rng, 110, 0.4) * 0.7, tb + beat / 2)
        if b % 4 == 3: place(buf, tom(rng, 85, 0.4) * 0.6, tb + beat * 0.75)
        if b % 4 == 0: place(buf, clang(rng, 1.4, 160) * 0.35, tb)
    # string ostinato: 16ths, minor-second motif A2 / Bb2
    for s in range(64):
        ts = s * beat / 4
        f = 110 if (s // 2) % 2 == 0 else 116.54
        if s % 16 >= 12: f *= 1.335  # lift to D
        d = beat / 4 * 0.9
        t = T(d)
        note = additive_saw(f, t, 5000) * np.exp(-t / 0.08) * (1 - np.exp(-t / 0.004))
        place(buf, note * (0.35 if s % 4 else 0.5), ts)
    # high dissonant swell + riser across the loop
    t = T(len(buf) / SR)
    sw = (additive_saw(880, t, 9000, 10) + additive_saw(932.3, t, 9000, 10)) * 0.04 * (0.4 + 0.6 * (t % (16 * beat)) / (16 * beat))
    buf += ffilt(sw, hi=4000)
    riser = ffilt(R(52).standard_normal(len(t)), lo=1500, hi=7000) * 0.05 * ((t % (8 * beat)) / (8 * beat)) ** 2
    buf += riser
    x = wrap(buf, L)
    x = reverb(x, 0.2, 1.4, 4, 7)[:L]
    x = wrap(np.concatenate([x, np.zeros(10)]), L)
    write('music/chase_loop', stereo(x, np.roll(x, 400)), 0.85, 128000)


def music_tension():
    rng = R(61)
    dur = 16.0; L = int(dur * SR)
    t = T(dur + 4)
    x = (additive_saw(55, t, 2000) * 0.5 + additive_saw(58.27, t, 2000) * 0.4 + additive_saw(82.41, t, 2500) * 0.3)
    x = ffilt(x, hi=700) * (0.5 + 0.5 * np.sin(TAU * t / dur) ** 2)
    buf = x.copy()
    for k in range(16):
        place(buf, tom(rng, 48, 0.9) * 0.5, k * 1.0)
        place(buf, tom(rng, 52, 0.7) * 0.3, k * 1.0 + 0.28)
    hi = (np.sin(TAU * 1244.5 * t) * 0.02 + np.sin(TAU * 1318.5 * t) * 0.02) * (0.5 + 0.5 * np.sin(TAU * 7 * t))
    buf += hi
    y = wrap(reverb(buf, 0.35, 2.5, 2, 9)[:L + SR * 4], L)
    write('music/tension_loop', stereo(y, np.roll(y, 1200)), 0.8, 112000)


def music_stingers():
    rng = R(71)
    t = T(4)
    boom = np.sin(TAU * np.cumsum(45 * (1 + 2 * np.exp(-t / 0.05))) / SR) * np.exp(-t / 0.9)
    cl = np.zeros(len(t))
    for f in (622.3, 659.3, 698.5, 739.99, 1244.5):
        cl += additive_saw(f * (1 + 0.004 * np.sin(TAU * 6 * t)), t, 9000, 12) * 0.15
    cl = ffilt(cl, lo=300) * np.exp(-t / 1.2) * (1 - np.exp(-t / 0.01))
    scrape = bp(rng.standard_normal(len(t)), 2800, 4) * np.exp(-t / 0.5) * 0.4
    hit = reverb(boom * 1.0 + cl + scrape, 0.4, 2.5, 2, 11)
    write('music/stinger_hit', fade(hit, 0, 0.5), 0.9)
    t = T(5)
    sub = np.sin(TAU * 38 * t) * (np.sin(np.pi * t / 5) ** 2) * 0.8
    trem = np.sin(TAU * 2489 * t) * (0.5 + 0.5 * np.sin(TAU * 11 * t)) * 0.05 * np.sin(np.pi * t / 5)
    bow = ffilt(additive_saw(311.1, t, 6000, 20) + additive_saw(329.6, t, 6000, 20), lo=200, hi=3000) * 0.07 * np.sin(np.pi * t / 5) ** 2
    write('music/stinger_reveal', reverb(sub + trem + bow, 0.45, 3, 1.6, 12), 0.75)


# ============================================================================ ENVIRONMENT
def thunder(seed, near=False, dur=9.0):
    rng = R(seed)
    n = int(dur * SR); t = T(dur)
    def ch(s):
        r = R(s)
        bn = brown(n, r)
        rumble = ffilt(bn, hi=900 if near else 320, lo=25)
        und = 0.25 + slow_noise(n, 2.5, r) ** 2
        att = 1 - np.exp(-t / (0.03 if near else 0.5))
        env = att * np.exp(-t / (dur * 0.33)) * und
        y = norm(rumble, 1) * env
        for k in range(r.integers(2, 5)):
            at = r.uniform(0.3, dur * 0.5)
            m = (t > at) * np.exp(-np.maximum(t - at, 0) / r.uniform(0.6, 1.5)) * (1 - np.exp(-np.maximum(t - at, 0) / 0.08))
            y += norm(ffilt(brown(n, r), hi=r.uniform(200, 600)), 1) * m * r.uniform(0.3, 0.8)
        if near:
            crack = ffilt(r.standard_normal(n), lo=900) * np.exp(-t / 0.05) * 1.2
            crack2 = ffilt(r.standard_normal(n), lo=300, hi=4000) * np.exp(-np.maximum(t - 0.04, 0) / 0.25) * (t > 0.04) * 0.6
            y = y + crack + crack2
        return y
    return fade(stereo(ch(seed), ch(seed + 50)), 0.002, 1.5)


def creak(rng, dur=1.6, f_lo=260, f_hi=620, rough=1.0):
    t = T(dur)
    path = f_lo + (f_hi - f_lo) * slow_noise(len(t), 2.0, rng)
    jitter = 1 + 0.08 * rng.standard_normal(len(t)).cumsum() / np.sqrt(np.arange(1, len(t) + 1))
    f = path * np.clip(jitter, 0.85, 1.15)
    src = additive_saw(f, t, 8000, 25)
    # stick-slip pulsing
    pulse = (0.5 + 0.5 * np.sign(np.sin(TAU * np.cumsum(f / 12) / SR))) * rough + (1 - rough)
    y = ffilt(src * pulse, bands=[(900, 3, 1), (1800, 4, 0.6), (3100, 5, 0.3)])
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.6
    return y * env


def thud(rng, f0=75, d=0.5, noise=0.5, hi=700):
    t = T(d)
    s = np.sin(TAU * np.cumsum(f0 * (1 + 0.8 * np.exp(-t / 0.02))) / SR) * np.exp(-t / (d * 0.25))
    nz = ffilt(rng.standard_normal(len(t)), hi=hi) * np.exp(-t / 0.03) * noise
    return s + nz


def click(rng, d=0.04, f=3000):
    t = T(d)
    return bp(rng.standard_normal(len(t)) * np.exp(-t / 0.002), f, 2)


def env_sounds():
    for i, s in enumerate((201, 202, 203, 204)):
        write(f'environment/thunder_{i + 1}', thunder(s, False, 8 + i), 0.85, 96000)
    write('environment/thunder_near', thunder(299, True, 9), 0.95, 96000)
    rng = R(301)
    for i in range(2):
        t_len = 1.7
        x = np.zeros(int(t_len * SR))
        place(x, click(rng, 0.05, 2500) * 0.8, 0.02)
        place(x, creak(rng, 1.2, 300 + i * 80, 650 + i * 60, 0.8) * 0.5, 0.12)
        write(f'environment/door_open_{i + 1}', reverb(x, 0.25, 1.2, 4, 21 + i), 0.75)
    x = np.zeros(int(1.2 * SR))
    place(x, thud(rng, 85, 0.5, 0.6), 0.0); place(x, click(rng, 0.05, 2200) * 0.7, 0.03)
    write('environment/door_close', reverb(x, 0.3, 1.5, 3, 23), 0.8)
    x = np.zeros(int(2.0 * SR))
    place(x, thud(rng, 65, 0.9, 1.0, 1500) * 1.2, 0.0); place(x, clang(rng, 0.6, 410) * 0.15, 0.0); place(x, click(rng, 0.06, 1800), 0.04)
    rattle = ffilt(rng.standard_normal(int(0.4 * SR)), lo=1200, hi=5000) * np.abs(np.sin(TAU * 38 * T(0.4))) * np.exp(-T(0.4) / 0.12) * 0.3
    place(x, rattle, 0.05)
    write('environment/door_slam', reverb(x, 0.45, 2.2, 2.5, 24), 0.95)
    write('environment/door_creak', reverb(creak(rng, 3.2, 180, 520, 1.0), 0.35, 2, 3, 25), 0.8)
    for i in range(3):
        x = np.zeros(int(2.4 * SR))
        place(x, thud(rng, 48 + i * 5, 1.2, 1.2, 2500) * 1.4, 0)
        place(x, clang(rng, 1.2, 140 + i * 25) * 0.35, 0)
        place(x, rattle * 1.5, 0.02)
        write(f'environment/door_bang_{i + 1}', dist(reverb(x, 0.4, 2.0, 2.2, 26 + i), 1.4), 0.98)
    x = np.zeros(int(0.9 * SR))
    for k in range(6):
        c = click(rng, 0.05, rng.uniform(1800, 3500)) * rng.uniform(0.4, 1.0)
        c = c + clang(rng, 0.05, 900)[:len(c)] * 0.05
        place(x, c, 0.05 + k * rng.uniform(0.07, 0.12))
    write('environment/door_locked', reverb(x, 0.25, 1, 4, 30), 0.8)
    for i in range(2):
        d = 2.2; t = T(d); n = len(t)
        src = rng.standard_normal(n)
        S = stft(src, 1024, 256); f = np.fft.rfftfreq(1024, 1 / SR)
        c = 1200 + 2200 * slow_noise(len(S), 1.5 * SR / 256, rng)
        H = 1 / np.sqrt(1 + ((np.maximum(f, 1)[None] / c[:, None] - c[:, None] / np.maximum(f, 1)[None]) * 6) ** 2)
        y = istft(S * H, 1024, 256, n) * np.sin(np.pi * t / d) ** 0.5
        res = np.zeros(n)
        for fr in (523, 1187, 1993, 2840): res += np.sin(TAU * fr * t) * 0.15
        y = y * (1 + res) * (0.6 + 0.4 * np.abs(np.sin(TAU * 7 * t)))
        write(f'environment/metal_scrape_{i + 1}', reverb(y, 0.35, 1.8, 3, 31 + i), 0.8)
    for i in range(2):
        x = np.zeros(int(2.0 * SR))
        tt = 0.0; a = 1.0
        for k in range(7):
            place(x, mx(clang(rng, 0.5, rng.uniform(380, 900)) * a * 0.5, click(rng, 0.03, 4000) * a), tt)
            tt += 0.18 * (0.75 ** k) + 0.02; a *= 0.62
        write(f'environment/object_fall_{i + 1}', reverb(x, 0.35, 2.0, 2.8, 33 + i), 0.85)
    t = T(2.6)
    def bell(f): return sum(np.sin(TAU * f * r_ * t) * a * np.exp(-t / (1.4 / r_ ** 0.5)) for r_, a in ((1, 1), (2.01, 0.4), (2.76, 0.25), (5.4, 0.1)))
    ding = bell(659.3); dong = np.concatenate([np.zeros(int(0.45 * SR)), bell(523.3)])[:len(t)]
    write('environment/elevator_ding', reverb(ding * 0.8 + dong * 0.8, 0.3, 1.5, 3, 35), 0.7)
    t = T(4.5); n = len(t)
    motor = (np.sin(TAU * 98 * t) * 0.3 + ffilt(brown(n, rng), hi=300) * 0.6) * np.sin(np.pi * t / 4.5) ** 0.5
    whine = np.sin(TAU * np.cumsum(600 + 300 * np.sin(np.pi * t / 4.5)) / SR) * 0.05 * np.sin(np.pi * t / 4.5)
    x = motor + whine; place(x, thud(rng, 60, 0.4, 0.8) * 0.6, 4.1)
    write('environment/elevator_motor', x, 0.7)
    # heart monitor (2s loop, 1 beep/s)
    t = T(2.0); x = np.zeros(len(t))
    bt = T(0.12); beep = np.sin(TAU * 980 * bt) * (1 - np.exp(-bt / 0.003)) * np.exp(-bt / 0.09)
    place(x, beep, 0.1); place(x, beep * 0.95, 1.08)
    write('environment/monitor_beep', x, 0.6)
    t = T(0.6)
    pa = click(rng, 0.03, 1500) * 1.0
    hum = np.sin(TAU * 60 * t) * 0.2 * np.exp(-t / 0.3) + ffilt(rng.standard_normal(len(t)), lo=500, hi=3500) * 0.08 * np.exp(-t / 0.2)
    write('environment/pa_click', np.concatenate([pa, np.zeros(len(t) - len(pa))]) + hum, 0.7)
    t = T(4.0); n = len(t)
    st = ffilt(rng.standard_normal(n), lo=350, hi=3200) * (0.4 + 0.6 * slow_noise(n, 3, rng))
    crack = drops_layer(n, 60, rng, 1500, 4000, (0.0005, 0.002)) * 2
    write('environment/pa_static', loopify(st + crack, 0.5), 0.5)
    # power down / up
    t = T(3.0); n = len(t)
    f = 420 * np.exp(-t / 0.7) + 25
    x = additive_saw(f, t, 4000, 20) * np.exp(-t / 1.4) * 0.6
    x += np.sin(TAU * 60 * t) * 0.3 * np.exp(-t / 0.25)
    place(x, thud(rng, 70, 0.6, 1.0, 900) * 1.2, 0.0); place(x, click(rng, 0.05, 1500) * 0.9, 0.01)
    write('environment/power_down', reverb(x, 0.35, 2.5, 2, 41), 0.9)
    t = T(4.5); n = len(t)
    f = 25 + 400 * (1 - np.exp(-t / 1.2))
    x = additive_saw(f, t, 4000, 20) * (1 - np.exp(-t / 0.8)) * 0.4 * np.exp(-np.maximum(t - 3, 0) / 0.8)
    for k in range(6): place(x, mx(thud(rng, 80, 0.4, 0.8) * 0.7, click(rng, 0.04, 2000) * 0.6), 0.0 + k * 0.42)
    x += np.sin(TAU * 60 * t) * 0.25 * (1 - np.exp(-t / 1.0))
    write('environment/power_up', reverb(x, 0.35, 2.5, 2, 42), 0.9)
    # fluorescent buzz (loop) + flicker
    t = T(4.0); n = len(t)
    bz = ffilt(np.sign(np.sin(TAU * 120 * t)) * (0.7 + 0.3 * np.sin(TAU * 240 * t)), hi=3500) * 0.4
    crack = drops_layer(n, 20, rng, 2000, 6000, (0.0005, 0.0015)) * 1.5
    write('environment/light_buzz', (bz * (0.75 + 0.25 * slow_noise(n, 4, rng)) + crack), 0.55)
    x = np.zeros(int(1.0 * SR))
    for k in range(5): place(x, mx(click(rng, 0.03, rng.uniform(2500, 5000)) * rng.uniform(0.3, 1), bz[:int(0.06 * SR)] * 0.5), rng.uniform(0, 0.7))
    write('environment/light_flicker', x, 0.7)
    # telephone bell ringer (2 s ring, 4 s silence) — loop 6 s
    t = T(2.0)
    rng2 = R(77)
    strikes = np.zeros(len(t))
    for k in range(int(2.0 * 40)):
        place(strikes, np.array([1.0]), k / 40)
    bell_ir_t = T(0.35)
    def bell_ir(f0): return sum(np.sin(TAU * f0 * r_ * bell_ir_t) * a * np.exp(-bell_ir_t / (0.25 / r_ ** 0.4)) for r_, a in ((1, 1), (2.32, 0.5), (2.97, 0.35), (4.3, 0.2), (5.6, 0.1)))
    ring = conv(strikes, bell_ir(1020) * 0.5 + bell_ir(1093) * 0.5)[:len(t)]
    ring += np.sin(TAU * 20 * t) * 0.02
    x = np.zeros(6 * SR); place(x, fade(ring, 0.002, 0.04), 0.0)
    write('environment/phone_ring', reverb(x, 0.15, 0.6, 6, 43)[:6 * SR], 0.85)
    x = np.zeros(int(0.5 * SR)); place(x, thud(rng, 140, 0.15, 0.6, 2500) * 0.8, 0); place(x, click(rng, 0.03, 2000), 0.06)
    write('environment/phone_pickup', x, 0.75)
    x = np.zeros(int(0.6 * SR)); place(x, thud(rng, 120, 0.2, 0.8, 2500), 0); place(x, click(rng, 0.03, 1800), 0.02); place(x, click(rng, 0.03, 2500) * 0.7, 0.18)
    write('environment/phone_hangup', x, 0.8)
    t = T(3.0); n = len(t)
    st = telephone(ffilt(rng.standard_normal(n), lo=300, hi=3400) * 0.3 + drops_layer(n, 80, rng, 1000, 3000, (0.0005, 0.002)))
    write('environment/phone_static', loopify(st, 0.3), 0.5)
    for i in range(3):
        write(f'environment/drip_{i + 1}', reverb(drip_snd(R(80 + i), i == 2), 0.45, 1.6, 2.5, 44 + i), 0.7)
    # distant scream (female-ish, far)
    t = T(2.6); n = len(t)
    f0 = 620 + 380 * np.sin(np.pi * np.clip(t / 1.8, 0, 1)) + 25 * np.sin(TAU * 6 * t)
    src = additive_saw(f0, t, 9000, 14) + ffilt(rng.standard_normal(n), lo=1000) * 0.15
    vox = ffilt(src, bands=[(900, 4, 1), (1400, 5, 0.7), (2900, 6, 0.4)])
    env = (1 - np.exp(-t / 0.08)) * np.exp(-np.maximum(t - 1.6, 0) / 0.35)
    x = ffilt(dist(vox * env, 1.5), hi=2200)
    write('environment/distant_scream', reverb(x, 0.7, 3.5, 1.4, 48), 0.6)
    x = np.zeros(int(1.0 * SR)); place(x, mx(clang(rng, 0.3, 700) * 0.4, click(rng, 0.05, 3000)), 0); place(x, thud(rng, 120, 0.2, 0.6, 3000) * 0.6, 0.04)
    place(x, ffilt(np.sign(np.sin(TAU * 120 * T(0.3))), hi=3000) * 0.15 * np.exp(-T(0.3) / 0.1), 0.08)
    write('environment/fuse_insert', reverb(x, 0.2, 1, 4, 49), 0.85)
    x = np.zeros(int(1.6 * SR)); place(x, thud(rng, 55, 1.0, 1.0, 1500) * 1.2, 0.0); place(x, clang(rng, 0.8, 230) * 0.3, 0.0); place(x, click(rng, 0.08, 1500), 0.0)
    write('environment/lever', reverb(x, 0.35, 2, 2.5, 50), 0.9)
    # car engine idle loop
    t = T(4.0); n = len(t)
    fire = 31.5
    pulses = np.maximum(0, np.sin(TAU * fire * t)) ** 6
    eng = ffilt(pulses * (1 + 0.2 * rng.standard_normal(n)), hi=400) + ffilt(brown(n, rng), hi=200) * 0.2 + np.sin(TAU * fire * 2 * t) * 0.1
    write('environment/car_engine', loopify(np.concatenate([eng, eng[:SR]]), 1.0), 0.7)
    x = np.zeros(int(1.2 * SR)); place(x, thud(rng, 90, 0.5, 1.0, 1500), 0.0); place(x, click(rng, 0.04, 2500) * 0.8, 0.05); place(x, clang(rng, 0.2, 1200)[:3000] * 0.05, 0.05)
    write('environment/car_door', reverb(x, 0.15, 0.8, 6, 51), 0.85)
    x = np.zeros(int(1.2 * SR)); place(x, mx(clang(rng, 0.5, 520) * 0.4, thud(rng, 110, 0.3, 0.8, 2500)), 0); place(x, click(rng, 0.06, 1600), 0.12)
    write('environment/entrance_unlock', reverb(x, 0.3, 1.5, 3, 52), 0.85)
    x = np.zeros(int(2.6 * SR)); place(x, thud(rng, 60, 1.0, 1.2, 1200) * 1.3, 0)
    glass = sum(np.sin(TAU * f * T(1.2)) * np.exp(-T(1.2) / 0.18) * 0.06 for f in (2310, 3170, 4400, 5210))
    place(x, glass * np.abs(np.sin(TAU * 30 * T(1.2))), 0.01); place(x, click(rng, 0.08, 1300) * 0.8, 0.03)
    write('environment/entrance_slam', reverb(x, 0.55, 3.0, 1.8, 53), 0.95)
    x = np.zeros(int(3.0 * SR)); place(x, thud(rng, 38, 1.8, 1.0, 400) * 1.5, 0)
    write('environment/impact_low', reverb(x, 0.5, 3, 1.6, 54), 0.95)
    t = T(0.6); n = len(t)
    slap = ffilt(rng.standard_normal(n), lo=200, hi=2500) * np.exp(-t / 0.03)
    sq = bp(rng.standard_normal(n), 900, 3) * np.exp(-t / 0.12) * 0.4
    write('environment/wet_slap', reverb(slap + sq, 0.3, 1.2, 4, 55), 0.7)


# ============================================================================ PLAYER
def footstep(kind, seed):
    rng = R(seed)
    d = 0.5; t = T(d); n = len(t)
    def hit(at, amp):
        x = np.zeros(n)
        nn = n - int(at * SR); tt = T(nn / SR)
        clk = ffilt(rng.standard_normal(nn) * np.exp(-tt / 0.0025), lo=1800) * 0.6
        body = ffilt(rng.standard_normal(nn) * np.exp(-tt / 0.02), hi=300) * 1.4 + np.sin(TAU * rng.uniform(95, 140) * tt) * np.exp(-tt / 0.025) * 0.5
        y = clk + body
        if kind == 'tile': y += np.sin(TAU * rng.uniform(1900, 2600) * tt) * np.exp(-tt / 0.018) * 0.12
        if kind == 'concrete': y += bp(rng.standard_normal(nn), rng.uniform(1500, 3500), 1.2) * np.exp(-tt / 0.05) * 0.5
        if kind == 'metal': y += clang(rng, nn / SR, rng.uniform(300, 500))[:nn] * 0.25
        if kind == 'outside':
            y = body * 0.8 + ffilt(rng.standard_normal(nn), lo=900, hi=8000) * np.exp(-tt / 0.09) * 0.9
        x[int(at * SR):] = y[:n - int(at * SR)] * amp
        return x
    x = hit(0.0, 1.0) + hit(rng.uniform(0.045, 0.075), 0.45)
    if kind in ('concrete', 'outside'): x += ffilt(rng.standard_normal(n), lo=2000, hi=6000) * np.exp(-t / 0.12) * 0.12
    return fade(x, 0.0005, 0.1)


def breath_cycle(rng, inh, exh, pause, voiced=0.0, shake=0.0, f_in=1100, f_ex=700):
    dur = inh + exh + pause
    t = T(dur); n = len(t)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    i_n = int(inh * SR)
    ti = T(inh)
    ei = np.sin(np.pi * ti / inh) ** 1.5 * (1 + shake * np.sin(TAU * 9 * ti))
    out[:i_n] = ffilt(nz[:i_n], bands=[(f_in, 1.6, 1), (f_in * 2.3, 2.5, 0.4)]) * ei * 0.8
    e_n = int(exh * SR)
    te = T(exh)
    ee = np.sin(np.pi * te / exh) ** 0.8 * np.exp(-te / (exh * 0.8)) * (1 + shake * np.sin(TAU * 11 * te))
    ex = ffilt(nz[i_n:i_n + e_n], bands=[(f_ex, 1.2, 1), (f_ex * 2.6, 2, 0.35)])
    if voiced:
        ex += additive_saw(108 + 6 * np.sin(TAU * 3 * te), te, 2500, 15) * voiced * 0.2
    out[i_n:i_n + e_n] = ex * ee
    return out


def player_sounds():
    for kind, cnt, s0 in (('tile', 4, 400), ('concrete', 4, 410), ('metal', 3, 420), ('outside', 3, 430)):
        for i in range(cnt):
            write(f'player/step_{kind}_{i + 1}', reverb(footstep(kind, s0 + i), 0.12, 0.6, 7, 60 + i, 6000), 0.85, 80000)
    rng = R(500)
    def loop_of(cycles):
        x = np.concatenate(cycles)
        return loopify(np.concatenate([x, x[:int(0.4 * SR)]]), 0.4)
    write('player/breath_normal', loop_of([breath_cycle(rng, 1.4, 1.8, 0.9), breath_cycle(rng, 1.3, 1.9, 1.1)]), 0.7, 80000)
    write('player/breath_heavy', loop_of([breath_cycle(rng, 0.55, 0.7, 0.08, 0.25, f_in=1300, f_ex=850) for _ in range(5)]), 0.85, 80000)
    write('player/breath_panic', loop_of([breath_cycle(rng, 0.32, 0.42, 0.04, 0.45, 0.35, 1500, 950) for _ in range(7)]), 0.9, 80000)
    t = T(0.7)
    gasp = ffilt(rng.standard_normal(len(t)), bands=[(1400, 1.5, 1), (2800, 2, 0.5)]) * np.sin(np.pi * np.clip(t / 0.35, 0, 1)) * np.exp(-t / 0.25)
    write('player/inhale_sharp', gasp, 0.9)
    for i in range(2):
        t = T(0.45); n = len(t)
        cl = ffilt(R(510 + i).standard_normal(n), lo=1500, hi=7000) * slow_noise(n, 30, R(511 + i)) ** 2 * np.sin(np.pi * t / 0.45)
        write(f'player/cloth_{i + 1}', cl, 0.6, 64000)
    x = np.zeros(int(0.15 * SR)); place(x, click(rng, 0.03, 3500), 0); place(x, click(rng, 0.02, 2200) * 0.6, 0.012)
    write('player/flashlight_click', x, 0.7, 64000)
    x = np.zeros(int(0.8 * SR)); place(x, click(rng, 0.04, 2000), 0.0); place(x, click(rng, 0.04, 2600) * 0.8, 0.25); place(x, click(rng, 0.05, 1500), 0.55)
    write('player/battery_swap', x, 0.7, 64000)
    x = np.zeros(int(0.5 * SR)); place(x, ffilt(rng.standard_normal(int(0.25 * SR)), lo=1200, hi=6000) * np.sin(np.pi * T(0.25) / 0.25) * 0.4, 0); place(x, click(rng, 0.03, 2500) * 0.6, 0.18)
    write('player/pickup', x, 0.6, 64000)
    t = T(0.9); n = len(t)
    slide = ffilt(rng.standard_normal(n), lo=150, hi=1500) * (0.6 + 0.4 * slow_noise(n, 25, rng)) * np.sin(np.pi * np.clip(t / 0.6, 0, 1))
    x = slide * 0.7; place(x, thud(rng, 110, 0.25, 0.7, 1500) * 0.7, 0.6)
    write('player/drawer_open', x, 0.75, 64000)
    t = T(1.6); x = np.zeros(len(t))
    lub = thud(rng, 48, 0.25, 0.3, 200); dub = thud(rng, 56, 0.2, 0.25, 200)
    place(x, lub, 0.0); place(x, dub * 0.7, 0.28); place(x, lub, 0.8); place(x, dub * 0.7, 1.08)
    write('player/heartbeat', ffilt(x, hi=180), 0.9, 64000)


# ============================================================================ MONSTER
def bellow(dur, f0_fn, formants, seed, noise=0.35, drive=2.5, pulse_sharp=0.08):
    """Koala-style bellow: low pulsed (snore-like) glottal source through formants."""
    rng = R(seed)
    t = T(dur); n = len(t)
    f0 = f0_fn(t)
    ph = np.cumsum(f0) / SR
    pulses = np.exp(-((ph % 1.0)) / pulse_sharp)
    src = pulses - pulses.mean() + rng.standard_normal(n) * noise
    y = ffilt(src, bands=formants, lo=40)
    return dist(norm(y, 1) * 1.2, drive)


def monster_sounds():
    rng = R(600)
    # breathing loop: wet, deep, rattling
    def cyc(s):
        r = R(s)
        inh = bellow(1.3, lambda t: 22 + 6 * np.sin(np.pi * t / 1.3), [(320, 2, 1), (900, 3, 0.6), (2100, 4, 0.25)], s, 0.6, 1.8)
        inh *= np.sin(np.pi * T(1.3) / 1.3) ** 1.2
        exh = bellow(1.6, lambda t: 30 + 10 * np.exp(-t / 0.5), [(260, 2, 1), (700, 2.5, 0.7), (1700, 3, 0.3)], s + 1, 0.5, 2.2)
        exh *= np.sin(np.pi * T(1.6) / 1.6) ** 0.7
        gurgle = bp(r.standard_normal(int(1.6 * SR)), 450, 6) * np.abs(np.sin(TAU * 13 * T(1.6))) * 0.2 * np.sin(np.pi * T(1.6) / 1.6)
        return np.concatenate([inh * 0.7, exh + gurgle, np.zeros(int(0.3 * SR))])
    x = np.concatenate([cyc(610), cyc(612)])
    write('monster/koala_breath', loopify(np.concatenate([x, x[:int(0.3 * SR)]]), 0.3), 0.85, 80000)
    for i in range(2):
        d = 2.2 + i * 0.6
        g = bellow(d, lambda t: 34 + 18 * np.sin(np.pi * t / d) + 4 * np.sin(TAU * 7 * t), [(300, 1.8, 1), (820, 2.5, 0.8), (1900, 3, 0.4)], 620 + i, 0.4, 3.0)
        g *= (1 - np.exp(-T(d) / 0.15)) * np.exp(-np.maximum(T(d) - d * 0.7, 0) / 0.2)
        write(f'monster/koala_growl_{i + 1}', reverb(g, 0.25, 1.6, 3, 63 + i), 0.9, 96000)
    # scream: inhuman, layered
    d = 2.4; t = T(d); n = len(t)
    f0 = 380 + 520 * np.sin(np.pi * np.clip(t / 1.2, 0, 1)) ** 0.7 - 160 * np.clip(t - 1.2, 0, 1) + 35 * np.sin(TAU * 8.5 * t)
    hi = additive_saw(f0, t, 10000, 22)
    sub = additive_saw(f0 / 2.01, t, 5000, 20) * 0.6
    vox = ffilt(hi + sub + rng.standard_normal(n) * 0.5, bands=[(850, 3, 1), (1350, 4, 0.8), (2700, 5, 0.6), (4200, 6, 0.3)])
    ringm = vox * np.sin(TAU * 73 * t) * 0.35
    roar = bellow(d, lambda t: 55 + 25 * np.sin(np.pi * t / d), [(250, 1.5, 1), (700, 2, 0.8), (1500, 3, 0.4)], 640, 0.5, 3)
    env = (1 - np.exp(-t / 0.03)) * np.exp(-np.maximum(t - 1.7, 0) / 0.25)
    sc = dist((norm(vox, 1) + ringm + norm(roar, 1) * 0.7) * env, 2.2)
    write('monster/koala_scream', reverb(sc, 0.35, 2.2, 2.5, 66), 0.98, 112000)
    d = 0.9; t = T(d); n = len(t)
    f0 = 1300 + 500 * np.sin(np.pi * t / d) + 60 * np.sin(TAU * 13 * t)
    s2 = ffilt(additive_saw(f0, t, 12000, 10) + rng.standard_normal(n) * 0.8, bands=[(1800, 3, 1), (3300, 4, 0.7), (5000, 5, 0.4)])
    s2 = dist(s2 * (1 - np.exp(-t / 0.01)) * np.exp(-t / 0.35), 2.5)
    write('monster/koala_screech', reverb(s2, 0.3, 1.5, 3, 67), 0.95, 96000)
    t = T(1.2); n = len(t)
    scr = np.zeros(n)
    for k in range(5):
        at = rng.uniform(0, 0.8); ln = rng.uniform(0.1, 0.3)
        seg = ffilt(rng.standard_normal(int(ln * SR)), lo=2500, hi=9000) * np.abs(np.sin(TAU * 45 * T(ln))) * np.sin(np.pi * T(ln) / ln)
        place(scr, seg * rng.uniform(0.4, 1), at)
    write('monster/koala_scratch', reverb(scr, 0.2, 0.8, 5, 68), 0.75, 80000)
    for i in range(3):
        x = np.zeros(int(0.6 * SR))
        place(x, thud(R(700 + i), 55 + i * 6, 0.45, 0.9, 500) * 1.2, 0)
        for c in range(3): place(x, click(R(710 + i * 3 + c), 0.02, rng.uniform(3000, 5500)) * 0.35, 0.02 + c * 0.018)
        write(f'monster/koala_step_{i + 1}', x, 0.85, 80000)
    d = 1.2; t = T(d); n = len(t)
    whoosh = ffilt(rng.standard_normal(n), lo=300, hi=3000) * np.sin(np.pi * np.clip((t - 0.2) / 0.4, 0, 1)) ** 2 * 0.6
    roar = bellow(d, lambda t: 60 + 30 * np.sin(np.pi * t / d), [(400, 2, 1), (1100, 3, 0.8), (2400, 4, 0.5)], 650, 0.5, 3.5) * np.exp(-t / 0.6)
    write('monster/koala_attack', reverb(roar + whoosh, 0.25, 1.2, 4, 69), 0.95, 96000)
    for i in range(2):
        d = 3.0
        g = bellow(d, lambda t: 28 + 14 * np.sin(np.pi * t / d), [(300, 1.8, 1), (800, 2.5, 0.8), (1800, 3, 0.4)], 660 + i, 0.4, 2.5)
        g = ffilt(g * np.sin(np.pi * T(d) / d), hi=900)
        write(f'monster/koala_distant_{i + 1}', reverb(g, 0.75, 4, 1.2, 70 + i, 2500), 0.6, 80000)
    x = np.zeros(int(1.2 * SR)); tt = 0
    while tt < 1.0:
        place(x, click(rng, 0.02, rng.uniform(2500, 5000)) * rng.uniform(0.3, 1), tt); tt += rng.uniform(0.03, 0.07)
    write('monster/koala_chitter', reverb(x * np.linspace(1, 0.3, len(x)), 0.2, 0.8, 5, 72), 0.75, 80000)
    d = 2.0; t = T(d); n = len(t)
    boom = np.sin(TAU * np.cumsum(40 * (1 + 3 * np.exp(-t / 0.04))) / SR) * np.exp(-t / 0.7)
    blast = ffilt(rng.standard_normal(n), lo=600) * np.exp(-t / 0.15) * 0.8
    stab = sum(additive_saw(f, t, 9000, 10) for f in (740, 784, 1480)) * np.exp(-t / 0.5) * 0.25
    write('monster/jumpscare_hit', dist(reverb(boom * 1.4 + blast + stab, 0.3, 1.8, 3, 73), 1.6), 0.99, 112000)


# ============================================================================ UI
def ui_sounds():
    rng = R(800)
    t = T(0.08); write('ui/ui_hover', bp(rng.standard_normal(len(t)), 4200, 6) * np.exp(-t / 0.008), 0.35, 64000)
    x = np.zeros(int(0.2 * SR)); place(x, click(rng, 0.04, 2400), 0); place(x, thud(rng, 180, 0.08, 0.3, 2000) * 0.4, 0)
    write('ui/ui_click', x, 0.55, 64000)
    x = np.zeros(int(0.4 * SR)); place(x, thud(rng, 120, 0.3, 0.4, 1500) * 0.6, 0); place(x, click(rng, 0.04, 1800), 0)
    write('ui/ui_confirm', x, 0.6, 64000)
    t = T(2.2)
    tone = (np.sin(TAU * 196 * t) + 0.5 * np.sin(TAU * 293.7 * t) + 0.25 * np.sin(TAU * 587.3 * t)) * np.exp(-t / 0.7) * (1 - np.exp(-t / 0.01))
    write('ui/ui_fuse', reverb(tone, 0.4, 2, 2.5, 81), 0.5, 64000)


# ============================================================================ VOICE
def voice_lines():
    V = os.path.join(SRC, 'voice')
    def src(name): return trim(read_wav(os.path.join(V, name + '.wav')), 0.008)

    # PHONE — low, distorted, telephone filtered, but intelligible
    # (processing tuned against an offline speech recogniser so the words survive)
    x = src('phone_threat')
    y = pitch_shift(x, -2) * 1.0 + x * 0.45   # double voice keeps the formants (and the words)
    y = telephone(norm(y, 1), crush=False)    # the phone line itself is the distortion
    rng = R(900)
    bed = ffilt(rng.standard_normal(len(y)), lo=400, hi=3200) * 0.004 + drops_layer(len(y), int(len(y) / SR * 10), rng, 1200, 3000, (0.0005, 0.002)) * 0.02
    out = np.concatenate([np.zeros(int(0.1 * SR)), norm(y, 1) + bed])
    write('voice/phone_threat', fade(out, 0.002, 0.1), 0.95, 96000)

    x = src('phone_laugh')
    x = fade(x[:int(6.2 * SR)], 0.0, 0.9)   # keep the laugh tight and unsettling, not comic
    x = time_stretch(x, 1.1)
    y = pitch_shift(x, -5) * 0.85 + pitch_shift(x, -12) * 0.45
    t = np.arange(len(y)) / SR
    y = y * (1 + 0.25 * np.sin(TAU * 31 * t))            # inhuman flutter
    y = dist(norm(y, 1) * 1.6, 2.8)
    y = telephone(y)
    bed = ffilt(rng.standard_normal(len(y)), lo=400, hi=3200) * 0.03
    write('voice/phone_laugh', reverb(y + bed, 0.15, 0.8, 5, 92), 0.95, 96000)

    # FINAL lines
    x = src('turned_on')
    y = pitch_shift(x, -3) * 1.0 + pitch_shift(x, -12) * 0.1 + x * 0.42
    y = dist(norm(y, 1) * 1.0, 1.08)
    y = ffilt(y, lo=70, hi=9000)
    write('voice/turned_on', fade(y, 0.002, 0.15), 0.95, 96000)   # room reverb added in-engine

    x = src('not_first')
    w = whisperize(x, seed=94)
    y = norm(w, 1) * 0.65 + norm(pitch_shift(x, -2), 1) * 0.4
    y = ffilt(y, lo=160, hi=9500)
    write('voice/not_first', reverb(y, 0.18, 1.4, 3.5, 94), 0.9, 96000)

    x = src('see_tonight')
    w = whisperize(x, seed=95)
    y = norm(w, 1) * 0.55 + norm(pitch_shift(x, -1), 1) * 0.5
    y = ffilt(y, lo=140, hi=9500)
    write('voice/see_tonight', reverb(y, 0.15, 1.2, 4, 95), 0.92, 96000)

    # PA — calm voice through old ceiling speakers, light corridor slapback
    for name in ('pa_over', 'pa_morning'):
        x = src(name)
        y = ffilt(x, lo=260, hi=5500, order=2)
        y = dist(norm(y, 1) * 1.05, 1.15)
        d1, d2 = int(0.21 * SR), int(0.47 * SR)
        e = np.concatenate([y, np.zeros(d2 + SR)])
        e[d1:d1 + len(y)] += y * (0.14 if name == 'pa_morning' else 0.08)
        e[d2:d2 + len(y)] += y * (0.06 if name == 'pa_morning' else 0.0)
        write('voice/' + name, reverb(e, 0.16 if name == 'pa_morning' else 0.12, 2.2, 2.4, 96), 0.9, 96000)

    # ambient whispers (unintelligible-ish, partly reversed)
    x = src('whisper_src')
    w = norm(whisperize(x, seed=97), 1)
    segs = np.array_split(w, 6)
    rr = R(98)
    mix = np.concatenate([s[::-1] if rr.random() < 0.4 else s for s in segs])
    l = mix * (0.6 + 0.4 * np.sin(TAU * 0.3 * np.arange(len(mix)) / SR))
    r = np.roll(mix, int(0.25 * SR)) * 0.8
    write('environment/whisper_ambient', reverb(stereo(l, r)[:, 0], 0.35, 2, 2.5, 99), 0.75, 80000)


def build_all():
    WRITTEN.clear()
    amb_rain(); amb_wind(); amb_wind('morning_wind', 21.5, 25, soft=True); amb_hum(); amb_room_tone(); amb_drips()
    amb_drone('menu_drone', 131); amb_drone('ending_drone', 133)
    music_piano(); music_chase(); music_tension(); music_stingers()
    env_sounds(); player_sounds(); monster_sounds(); ui_sounds(); voice_lines()
    total = sum(w[1] for w in WRITTEN)
    return {'count': len(WRITTEN), 'MB': round(total / 1e6, 2), 'files': WRITTEN}
