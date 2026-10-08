# NIGHT SHIFT â€” procedural texture generation (runs inside Blender, numpy only).
# Produces tileable colour / normal / roughness maps into blender/Textures.
import os
import numpy as np
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX_DIR = os.path.join(ROOT, 'blender', 'Textures')
os.makedirs(TEX_DIR, exist_ok=True)


# ----------------------------------------------------------------------------- noise
def _interp_grid(grid, size):
    """Upsample a periodic grid to size x size with smoothstep bilinear (tileable)."""
    n = grid.shape[0]
    m = grid.shape[1]
    ys = np.arange(size) * n / size
    xs = np.arange(size) * m / size
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = ys - y0; fx = xs - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % n; x1 = (x0 + 1) % m
    a = grid[y0][:, x0]; b = grid[y0][:, x1]; c = grid[y1][:, x0]; d = grid[y1][:, x1]
    fx = fx[None, :]; fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def noise(size, freq, rng, aspect=1):
    fx = max(1, int(freq * aspect)); fy = max(1, int(freq))
    g = rng.random((fy, fx))
    out = _interp_grid(g, size)
    return out


def fbm(size, freq, rng, octaves=5, gain=0.5, aspect=1):
    out = np.zeros((size, size)); amp = 1.0; tot = 0
    f = freq
    for _ in range(octaves):
        out += noise(size, f, rng, aspect) * amp
        tot += amp; amp *= gain; f *= 2
    return out / tot


def ridged(size, freq, rng, octaves=4):
    out = np.zeros((size, size)); amp = 1; tot = 0; f = freq
    for _ in range(octaves):
        n = 1 - np.abs(noise(size, f, rng) * 2 - 1)
        out += n * n * amp; tot += amp; amp *= 0.5; f *= 2
    return out / tot


def smooth(t, a, b):
    t = np.clip((t - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(img, r=1, axis=None):
    out = img.copy()
    for _ in range(r):
        if axis in (None, 0):
            out = (np.roll(out, 1, 0) + out * 2 + np.roll(out, -1, 0)) / 4
        if axis in (None, 1):
            out = (np.roll(out, 1, 1) + out * 2 + np.roll(out, -1, 1)) / 4
    return out


def normal_from_height(h, strength=4.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    # image rows go top->bottom; OpenGL normal maps (+Y up)
    return np.stack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5], -1)


def save(name, arr, fmt='PNG', alpha=False):
    """arr: HxWx3 or HxWx4 float 0..1 with row 0 = top of image."""
    arr = np.clip(arr, 0, 1).astype(np.float32)
    h, w = arr.shape[:2]
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, -1)
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1)
    flipped = arr[::-1].copy()
    ext = '.png' if fmt == 'PNG' else '.jpg'
    path = os.path.join(TEX_DIR, name + ext)
    img = bpy.data.images.get(name + '_gen')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name + '_gen', w, h, alpha=alpha)
    img.pixels.foreach_set(flipped.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == 'JPEG':
        bpy.context.scene.render.image_settings.quality = 90
    img.save()
    bpy.data.images.remove(img)
    return path


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def col(c, shape):
    return np.ones(shape + (3,)) * np.asarray(c)


# ----------------------------------------------------------------------------- textures
def tex_floor_tile(S=1024):
    rng = np.random.default_rng(11)
    n = 8  # 8 tiles across 2.4 m
    yy, xx = np.mgrid[0:S, 0:S] / S * n
    ti = np.floor(xx).astype(int); tj = np.floor(yy).astype(int)
    fx = xx - ti; fy = yy - tj
    checker = ((ti + tj) % 2).astype(float)
    tile_rand = rng.random((n, n))[tj % n, ti % n]
    grout = 1 - smooth(np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)), 0.006, 0.02)
    a = np.array([0.66, 0.64, 0.56]); b = np.array([0.42, 0.47, 0.43])
    base = lerp(a, b, checker) * (0.92 + 0.12 * tile_rand)[..., None]
    speck = (rng.random((S, S)) > 0.985).astype(float)
    base *= (1 - 0.25 * speck)[..., None]
    grime = fbm(S, 4, rng, 6)
    dirt = smooth(grime, 0.45, 0.8)
    base = lerp(base, base * np.array([0.5, 0.45, 0.38]), dirt * 0.6)
    scuff = smooth(fbm(S, 12, rng, 3, aspect=0.25), 0.62, 0.75) * 0.35
    base *= (1 - scuff)[..., None]
    stains = smooth(fbm(S, 2, rng, 4), 0.62, 0.7)
    base = lerp(base, base * np.array([0.55, 0.42, 0.3]), stains * 0.6)
    base = lerp(base, np.array([0.12, 0.11, 0.1]), grout * 0.9)
    h = 1 - grout * 0.8 + fbm(S, 32, rng, 3) * 0.05 - scuff * 0.1
    wet = smooth(fbm(S, 3, rng, 4), 0.58, 0.66)
    rough = 0.42 + dirt * 0.35 + grout * 0.3 - wet * 0.32 + scuff * 0.2
    save('floor_tile_col', base, 'JPEG'); save('floor_tile_nrm', normal_from_height(h, 3), 'JPEG'); save('floor_tile_rgh', rough, 'JPEG')


def _wall_common(S, rng, top, low, rail, plaster):
    # v: row 0 = ceiling (3.2 m), last row = floor. u tiles horizontally (2.5 m).
    yy, xx = np.mgrid[0:S, 0:S] / S
    hgt = (1 - yy) * 3.2
    base = col(top, (S, S)) * (0.94 + 0.08 * fbm(S, 6, rng, 5))[..., None]
    lowmask = smooth(1.02 - hgt, 0, 0.01)
    base = lerp(base, col(low, (S, S)) * (0.9 + 0.12 * fbm(S, 8, rng, 4))[..., None], lowmask)
    railmask = smooth(0.06 - np.abs(hgt - 1.04), 0, 0.01)
    base = lerp(base, col(rail, (S, S)), railmask)
    # Water streaks from the ceiling
    streak = noise(S, 3, rng, aspect=14)[:, :]
    streak = smooth(streak, 0.62, 0.8) * smooth(hgt, 1.0, 3.1) * (0.4 + 0.6 * fbm(S, 4, rng, 3))
    base = lerp(base, base * np.array([0.6, 0.52, 0.38]), streak * 0.8)
    # Floor grime gradient
    grime = smooth(0.5 - hgt, 0, 0.5) * (0.5 + 0.5 * fbm(S, 8, rng, 4))
    base = lerp(base, base * np.array([0.35, 0.32, 0.28]), grime * 0.8)
    # Peeling paint
    peel_n = fbm(S, 9, rng, 6) * 0.7 + fbm(S, 3, rng, 4) * 0.3
    peel = smooth(peel_n, 0.69, 0.705) * (0.4 + 0.6 * smooth(hgt, 0.9, 2.6))
    edge = np.clip(smooth(peel_n, 0.675, 0.69) * (0.4 + 0.6 * smooth(hgt, 0.9, 2.6)) - peel, 0, 1)
    base = lerp(base, col(plaster, (S, S)) * (0.8 + 0.3 * fbm(S, 30, rng, 2))[..., None], peel)
    base = lerp(base, base * 0.55, edge * 0.8)
    # Cracks
    cr = ridged(S, 3, rng, 4)
    crack = smooth(cr, 0.93, 0.99)
    base = lerp(base, np.array([0.08, 0.07, 0.06]), crack * 0.8)
    # Blotchy mould
    mould = smooth(fbm(S, 6, rng, 5), 0.68, 0.78) * (0.4 + 0.6 * smooth(hgt, 2.0, 3.2))
    base = lerp(base, np.array([0.13, 0.15, 0.1]), mould * 0.55)
    h = 0.5 + 0.15 * fbm(S, 40, rng, 3) - peel * 0.15 + edge * 0.25 - crack * 0.4 + railmask * 0.3
    rough = 0.72 + 0.15 * fbm(S, 10, rng, 3) - streak * 0.25 - railmask * 0.2 + peel * 0.15
    return base, h, rough


def tex_wall_paint(S=1024):
    rng = np.random.default_rng(23)
    base, h, rough = _wall_common(S, rng, top=[0.6, 0.62, 0.55], low=[0.19, 0.26, 0.24], rail=[0.42, 0.42, 0.37], plaster=[0.5, 0.47, 0.42])
    save('wall_paint_col', base, 'JPEG'); save('wall_paint_nrm', normal_from_height(h, 2.5), 'JPEG'); save('wall_paint_rgh', rough, 'JPEG')


def tex_wall_children(S=1024):
    rng = np.random.default_rng(29)
    base, h, rough = _wall_common(S, rng, top=[0.7, 0.62, 0.52], low=[0.52, 0.32, 0.3], rail=[0.62, 0.55, 0.3], plaster=[0.55, 0.52, 0.47])
    # faded painted stars/dots
    yy, xx = np.mgrid[0:S, 0:S] / S
    hgt = (1 - yy) * 3.2
    dots = smooth(noise(S, 22, rng), 0.82, 0.86) * smooth(hgt, 1.2, 1.3) * smooth(2.4 - hgt, 0, 0.1)
    base = lerp(base, np.array([0.55, 0.6, 0.72]), dots * 0.55)
    save('wall_children_col', base, 'JPEG'); save('wall_children_nrm', normal_from_height(h, 2.5), 'JPEG'); save('wall_children_rgh', rough, 'JPEG')


def tex_wall_concrete(S=1024):
    rng = np.random.default_rng(31)
    yy, xx = np.mgrid[0:S, 0:S] / S
    hgt = (1 - yy) * 3.2
    n = fbm(S, 6, rng, 7)
    base = col([0.42, 0.42, 0.4], (S, S)) * (0.75 + 0.45 * n)[..., None]
    # formwork seams
    seam = smooth(0.006 - np.abs(((hgt / 0.8) % 1) - 0.5) + 0.5 - 0.5, 0, 1)
    ys = np.abs(((hgt / 0.8) % 1) - 0.0)
    seam = 1 - smooth(np.minimum(ys, 1 - ys), 0.004, 0.012)
    xs = (xx * 2.5 / 1.25) % 1
    seam2 = 1 - smooth(np.minimum(xs, 1 - xs), 0.002, 0.006)
    s = np.maximum(seam, seam2)
    base = lerp(base, base * 0.6, s)
    pores = (rng.random((S, S)) > 0.992).astype(float)
    pores = blur(pores, 1)
    base *= (1 - pores * 0.8)[..., None]
    streak = smooth(noise(S, 3, rng, aspect=16), 0.6, 0.8) * (0.5 + 0.5 * fbm(S, 3, rng, 3))
    base = lerp(base, base * np.array([0.5, 0.45, 0.38]), streak * 0.7)
    damp = smooth(0.9 - hgt, 0, 0.9) * (0.4 + 0.6 * fbm(S, 5, rng, 4))
    base = lerp(base, base * np.array([0.4, 0.42, 0.38]), damp * 0.8)
    h = 0.5 + 0.2 * n - s * 0.3 - pores * 0.5
    rough = 0.85 - damp * 0.35 - streak * 0.2
    save('concrete_wall_col', base, 'JPEG'); save('concrete_wall_nrm', normal_from_height(h, 3), 'JPEG'); save('concrete_wall_rgh', rough, 'JPEG')


def tex_concrete_floor(S=1024):
    rng = np.random.default_rng(37)
    n = fbm(S, 5, rng, 7)
    base = col([0.36, 0.36, 0.34], (S, S)) * (0.7 + 0.5 * n)[..., None]
    cr = ridged(S, 2, rng, 5)
    crack = smooth(cr, 0.95, 0.995)
    base = lerp(base, np.array([0.06, 0.06, 0.06]), crack * 0.9)
    oil = smooth(fbm(S, 3, rng, 4), 0.62, 0.7)
    base = lerp(base, base * np.array([0.35, 0.33, 0.3]), oil * 0.8)
    wet = smooth(fbm(S, 2, rng, 5), 0.6, 0.66)
    base = lerp(base, base * 0.55, wet * 0.6)
    h = 0.5 + 0.15 * fbm(S, 30, rng, 4) - crack * 0.5
    rough = 0.8 - wet * 0.65 - oil * 0.3
    save('concrete_floor_col', base, 'JPEG'); save('concrete_floor_nrm', normal_from_height(h, 3), 'JPEG'); save('concrete_floor_rgh', rough, 'JPEG')


def tex_ceiling(S=512):
    rng = np.random.default_rng(41)
    n = 4  # 4 tiles across 2.4 m (60 cm)
    yy, xx = np.mgrid[0:S, 0:S] / S * n
    fx = xx % 1; fy = yy % 1
    ti = np.floor(xx).astype(int); tj = np.floor(yy).astype(int)
    grid = 1 - smooth(np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)), 0.012, 0.03)
    holes = (rng.random((S, S)) > 0.94).astype(float) * 0.3
    tr = rng.random((n, n))[tj % n, ti % n]
    base = col([0.7, 0.69, 0.63], (S, S)) * (0.9 + 0.1 * tr)[..., None]
    base *= (1 - holes)[..., None]
    stains = smooth(fbm(S, 3, rng, 5), 0.6, 0.66)
    ring = smooth(fbm(S, 3, rng, 5), 0.58, 0.6) - smooth(fbm(S, 3, rng, 5), 0.6, 0.62)
    base = lerp(base, base * np.array([0.6, 0.45, 0.28]), stains * 0.7)
    base = lerp(base, np.array([0.5, 0.52, 0.5]), grid)
    missing = np.zeros_like(tr)
    base = lerp(base, np.array([0.02, 0.02, 0.02]), missing)
    h = 0.5 - holes * 0.3 + grid * 0.4 - missing * 0.8
    save('ceiling_col', base, 'JPEG'); save('ceiling_nrm', normal_from_height(h, 2), 'JPEG')


def tex_metal(S=512):
    rng = np.random.default_rng(43)
    n = fbm(S, 6, rng, 6)
    base = col([0.5, 0.55, 0.52], (S, S)) * (0.85 + 0.2 * n)[..., None]
    scratches = smooth(noise(S, 40, rng, aspect=0.05), 0.88, 0.92)
    scratches = np.maximum(scratches, smooth(noise(S, 2, rng, aspect=40).T, 0.9, 0.93))
    base = lerp(base, np.array([0.7, 0.7, 0.68]), scratches * 0.6)
    rust = smooth(fbm(S, 5, rng, 6), 0.62, 0.72)
    base = lerp(base, np.array([0.35, 0.18, 0.08]) * (0.7 + 0.5 * fbm(S, 30, rng, 2))[..., None], rust)
    dirt = smooth(fbm(S, 3, rng, 4), 0.5, 0.8)
    base = lerp(base, base * 0.5, dirt * 0.6)
    h = 0.5 + rust * 0.2 * fbm(S, 40, rng, 2) - scratches * 0.1
    rough = 0.5 + rust * 0.4 + dirt * 0.2 - scratches * 0.2
    save('metal_paint_col', base, 'JPEG'); save('metal_paint_nrm', normal_from_height(h, 2), 'JPEG'); save('metal_paint_rgh', rough, 'JPEG')


def tex_steel(S=512):
    rng = np.random.default_rng(47)
    brushed = blur(rng.random((S, S)), 6, axis=1)
    base = col([0.62, 0.63, 0.64], (S, S)) * (0.85 + 0.3 * (brushed - 0.5) + 0.1 * fbm(S, 4, rng, 4))[..., None]
    smudge = smooth(fbm(S, 4, rng, 5), 0.55, 0.75)
    blood = smooth(fbm(S, 3, rng, 6), 0.68, 0.72)
    base = lerp(base, base * 0.6, smudge * 0.6)
    base = lerp(base, np.array([0.22, 0.02, 0.015]), blood * 0.9)
    rough = 0.32 + smudge * 0.3 + (brushed - 0.5) * 0.2 - blood * 0.1
    save('steel_col', base, 'JPEG'); save('steel_rgh', rough, 'JPEG')


def tex_wood(S=512):
    rng = np.random.default_rng(53)
    yy, xx = np.mgrid[0:S, 0:S] / S
    warp = fbm(S, 3, rng, 4) * 6
    grain = np.sin((xx * 40 + warp * 3) * np.pi) * 0.5 + 0.5
    fine = blur(rng.random((S, S)), 4, axis=0)
    base = lerp(np.array([0.32, 0.2, 0.11]), np.array([0.5, 0.34, 0.2]), grain * 0.6 + fine * 0.4)
    dirt = smooth(fbm(S, 4, rng, 5), 0.5, 0.8)
    base = lerp(base, base * 0.45, dirt * 0.7)
    scr = smooth(noise(S, 30, rng, aspect=0.1), 0.9, 0.94)
    base = lerp(base, np.array([0.55, 0.45, 0.35]), scr * 0.5)
    h = grain * 0.3 + fine * 0.2
    save('wood_col', base, 'JPEG'); save('wood_nrm', normal_from_height(h, 1.5), 'JPEG')


def tex_fabric(S=512):
    rng = np.random.default_rng(59)
    n = fbm(S, 8, rng, 5)
    base = col([0.28, 0.4, 0.42], (S, S)) * (0.8 + 0.3 * n)[..., None]
    cracks = smooth(ridged(S, 6, rng, 3), 0.9, 0.97)
    stain = smooth(fbm(S, 3, rng, 5), 0.6, 0.7)
    base = lerp(base, base * np.array([0.6, 0.5, 0.35]), stain * 0.8)
    base = lerp(base, np.array([0.7, 0.68, 0.6]), cracks * 0.6)
    save('vinyl_col', base, 'JPEG')
    # mattress / linen
    n2 = fbm(S, 10, rng, 5)
    lin = col([0.72, 0.7, 0.64], (S, S)) * (0.85 + 0.2 * n2)[..., None]
    st = smooth(fbm(S, 3, rng, 6), 0.6, 0.72)
    lin = lerp(lin, np.array([0.5, 0.38, 0.22]), st * 0.7)
    bl = smooth(fbm(S, 2, rng, 6), 0.7, 0.74)
    lin = lerp(lin, np.array([0.3, 0.03, 0.02]), bl * 0.85)
    save('linen_col', lin, 'JPEG')


def tex_plastic(S=256):
    rng = np.random.default_rng(61)
    n = fbm(S, 5, rng, 5)
    base = col([0.72, 0.7, 0.62], (S, S)) * (0.85 + 0.2 * n)[..., None]
    dirt = smooth(fbm(S, 3, rng, 5), 0.5, 0.8)
    base = lerp(base, base * np.array([0.6, 0.55, 0.45]), dirt * 0.8)
    save('plastic_col', base, 'JPEG')


def tex_fur(S=1024):
    rng = np.random.default_rng(67)
    # Anisotropic strands (stretched noise along v)
    strands = noise(S, 24, rng, aspect=8) * 0.45 + noise(S, 48, rng, aspect=10) * 0.35 + fbm(S, 8, rng, 4) * 0.2
    clumps = fbm(S, 6, rng, 5)
    matted = smooth(clumps, 0.55, 0.75)
    v = strands * (0.55 + 0.45 * clumps)
    base = lerp(np.array([0.16, 0.155, 0.15]), np.array([0.6, 0.58, 0.54]), smooth(v, 0.2, 0.8))
    base = lerp(base, base * np.array([0.6, 0.5, 0.4]), matted * 0.7)
    dirt = smooth(fbm(S, 3, rng, 5), 0.45, 0.75)
    base = lerp(base, base * np.array([0.55, 0.45, 0.35]), dirt * 0.6)
    h = strands * 0.6 + clumps * 0.4
    rough = 0.75 + 0.2 * (1 - strands) - matted * 0.25
    save('fur_col', base, 'JPEG'); save('fur_nrm', normal_from_height(h, 5), 'JPEG'); save('fur_rgh', rough, 'JPEG')


def tex_skin(S=512):
    rng = np.random.default_rng(71)
    n = fbm(S, 8, rng, 6)
    base = col([0.24, 0.17, 0.16], (S, S)) * (0.7 + 0.5 * n)[..., None]
    veins = smooth(ridged(S, 5, rng, 4), 0.86, 0.95)
    base = lerp(base, np.array([0.18, 0.05, 0.06]), veins * 0.6)
    blood = smooth(fbm(S, 3, rng, 5), 0.5, 0.7)
    base = lerp(base, np.array([0.28, 0.02, 0.02]), blood * 0.8)
    h = n * 0.5 + veins * 0.3
    save('skin_col', base, 'JPEG'); save('skin_nrm', normal_from_height(h, 4), 'JPEG')


def tex_brick(S=1024):
    rng = np.random.default_rng(73)
    yy, xx = np.mgrid[0:S, 0:S] / S
    rows = 16; cols = 6  # covers 2.4 m
    ry = yy * rows; rx = xx * cols + (np.floor(ry) % 2) * 0.5
    fy = ry % 1; fx = rx % 1
    mortar = 1 - smooth(np.minimum(np.minimum(fx * 2.2, (1 - fx) * 2.2), np.minimum(fy, 1 - fy)), 0.04, 0.09)
    bid = (np.floor(ry).astype(int) * 31 + np.floor(rx).astype(int) * 7) % 97
    br = (np.sin(bid * 12.9898) * 43758.5453) % 1
    base = lerp(np.array([0.32, 0.16, 0.11]), np.array([0.46, 0.25, 0.17]), br)
    base *= (0.8 + 0.3 * fbm(S, 20, rng, 3))[..., None]
    soot = smooth(fbm(S, 3, rng, 5), 0.4, 0.8)
    base = lerp(base, base * 0.35, soot * 0.7)
    streak = smooth(noise(S, 4, rng, aspect=18), 0.6, 0.8)
    base = lerp(base, base * 0.5, streak * 0.6)
    base = lerp(base, np.array([0.3, 0.29, 0.27]) * (0.8 + 0.3 * fbm(S, 30, rng, 2))[..., None], mortar)
    h = 1 - mortar * 0.7 + fbm(S, 40, rng, 3) * 0.1
    save('brick_col', base, 'JPEG'); save('brick_nrm', normal_from_height(h, 3), 'JPEG')


def tex_asphalt(S=1024):
    rng = np.random.default_rng(79)
    n = fbm(S, 10, rng, 6)
    grit = rng.random((S, S))
    base = col([0.12, 0.12, 0.125], (S, S)) * (0.7 + 0.4 * n + 0.25 * (grit - 0.5))[..., None]
    cr = smooth(ridged(S, 2, rng, 5), 0.95, 0.99)
    base = lerp(base, np.array([0.03, 0.03, 0.03]), cr)
    puddle = smooth(fbm(S, 2, rng, 5), 0.58, 0.62)
    base = lerp(base, base * 0.45, puddle)
    rough = 0.85 - puddle * 0.8 + cr * 0.1
    h = 0.5 + (grit - 0.5) * 0.15 - cr * 0.5 - puddle * 0.1
    save('asphalt_col', base, 'JPEG'); save('asphalt_rgh', rough, 'JPEG'); save('asphalt_nrm', normal_from_height(h, 2), 'JPEG')


def tex_mud(S=512):
    rng = np.random.default_rng(83)
    n = fbm(S, 6, rng, 6)
    base = lerp(np.array([0.09, 0.08, 0.05]), np.array([0.17, 0.17, 0.09]), n)
    grass = smooth(noise(S, 60, rng), 0.6, 0.8) * smooth(fbm(S, 3, rng, 3), 0.4, 0.6)
    base = lerp(base, np.array([0.12, 0.15, 0.06]), grass)
    save('mud_col', base, 'JPEG')


def tex_paper(S=256):
    rng = np.random.default_rng(89)
    n = fbm(S, 6, rng, 5)
    base = col([0.78, 0.75, 0.64], (S, S)) * (0.85 + 0.2 * n)[..., None]
    # faint text lines
    yy, xx = np.mgrid[0:S, 0:S] / S
    lines = ((np.floor(yy * 28) % 1 == 0) & (((yy * 28) % 1) < 0.25)).astype(float)
    lines = smooth(((yy * 28) % 1), 0.0, 0.05) * (1 - smooth(((yy * 28) % 1), 0.2, 0.25))
    lines *= smooth(noise(S, 40, rng, aspect=0.05), 0.3, 0.4) * (xx > 0.1) * (xx < 0.9) * (yy > 0.12) * (yy < 0.9)
    base = lerp(base, np.array([0.25, 0.25, 0.3]), lines * 0.6)
    stain = smooth(fbm(S, 3, rng, 5), 0.6, 0.7)
    base = lerp(base, np.array([0.5, 0.38, 0.2]), stain * 0.6)
    save('paper_col', base, 'JPEG')


def tex_decals(S=512):
    """Atlas 4x2 cells (each S). RGBA. Cells: 0 blood splat, 1 blood splat 2, 2 smear/trail,
    3 handprint, 4 grime, 5 stain ring, 6 water puddle, 7 bloody footprints."""
    rng = np.random.default_rng(97)
    atlas = np.zeros((S * 2, S * 4, 4))
    yy, xx = np.mgrid[0:S, 0:S] / S
    cx = xx - 0.5; cy = yy - 0.5
    r = np.sqrt(cx * cx + cy * cy)
    ang = np.arctan2(cy, cx)
    blood = np.array([0.24, 0.015, 0.012])

    def cell(i, rgb, a):
        y0 = (i // 4) * S; x0 = (i % 4) * S
        atlas[y0:y0 + S, x0:x0 + S, :3] = rgb
        atlas[y0:y0 + S, x0:x0 + S, 3] = np.clip(a, 0, 1)

    def splat(seed):
        g = np.random.default_rng(seed)
        n = fbm(S, 6, g, 5)
        spikes = noise(S, 1, g) * 0 + 0
        edge = 0.22 + 0.1 * np.sin(ang * g.integers(5, 11) + g.random() * 6) * n + n * 0.12
        a = smooth(edge - r, -0.01, 0.02)
        for _ in range(26):
            d = g.random() * 0.25 + 0.2; th = g.random() * 6.28; rad = g.random() * 0.03 + 0.006
            px = 0.5 + np.cos(th) * d; py = 0.5 + np.sin(th) * d
            a = np.maximum(a, smooth(rad - np.sqrt((xx - px) ** 2 + (yy - py) ** 2), -0.003, 0.003))
        shade = 0.6 + 0.6 * fbm(S, 10, g, 3)
        rgb = blood[None, None, :] * shade[..., None]
        rgb = lerp(rgb, rgb * 0.4, smooth(0.12 - r, 0, 0.1))
        return rgb, a * (0.85 + 0.15 * n)

    rgb, a = splat(1); cell(0, rgb, a)
    rgb, a = splat(2); cell(1, rgb, a)
    # smear / drag trail along y
    n = fbm(S, 8, rng, 5)
    band = smooth(0.2 + 0.08 * (noise(S, 4, rng) - 0.5) - np.abs(cx), 0, 0.05)
    streaks = noise(S, 2, rng, aspect=40)
    a = band * (0.4 + 0.6 * streaks) * smooth(yy, 0.0, 0.15) * (1 - smooth(yy, 0.75, 1.0))
    cell(2, blood[None, None, :] * (0.6 + 0.6 * n)[..., None], a)
    # handprint
    hand = smooth(0.14 - np.sqrt((cx / 1.0) ** 2 + ((cy - 0.1) / 1.25) ** 2), 0, 0.02)
    fingers = [(-0.13, -0.08, 0.17), (-0.05, -0.17, 0.22), (0.04, -0.18, 0.23), (0.12, -0.13, 0.19), (0.2, 0.08, 0.13)]
    for fx_, fy_, ln in fingers:
        dx = cx - fx_; dy = cy - fy_
        ang_f = np.arctan2(fy_ - 0.05, fx_) if fx_ < 0.18 else 0.6
        # capsule along direction from palm centre
        ux = fx_; uy = fy_ - 0.1; l = np.hypot(ux, uy); ux /= l; uy /= l
        t = np.clip(dx * ux + dy * uy, -ln * 0.5, ln * 0.3)
        px = dx - t * ux; py = dy - t * uy
        hand = np.maximum(hand, smooth(0.035 - np.sqrt(px * px + py * py), 0, 0.012))
    hn = fbm(S, 16, rng, 4)
    hand *= smooth(hn, 0.25, 0.5)
    drip = smooth(0.012 - np.abs(cx - 0.02 - 0.04 * np.sin(yy * 5)), 0, 0.006) * smooth(yy, 0.62, 0.7) * (1 - smooth(yy, 0.85, 0.95))
    cell(3, blood[None, None, :] * (0.7 + 0.5 * hn)[..., None], np.maximum(hand, drip) * 0.95)
    # grime
    g = fbm(S, 4, rng, 6)
    cell(4, np.array([0.06, 0.05, 0.04])[None, None, :] * np.ones((S, S, 1)), smooth(g, 0.42, 0.75) * smooth(0.5 - r, 0, 0.25) * 0.8)
    # stain ring (brown)
    ring = smooth(0.3 + 0.05 * fbm(S, 5, rng, 4) - r, 0, 0.02) * (0.3 + 0.7 * smooth(r, 0.15, 0.3))
    cell(5, np.array([0.25, 0.16, 0.07])[None, None, :] * np.ones((S, S, 1)), ring * 0.7)
    # water puddle (dark, mostly for roughness via alpha)
    p = smooth(0.32 + 0.12 * (fbm(S, 4, rng, 5) - 0.5) - r, 0, 0.03)
    cell(6, np.array([0.04, 0.045, 0.05])[None, None, :] * np.ones((S, S, 1)), p * 0.55)
    # bloody footprints (bare feet / paw-claw prints walking along y)
    fp = np.zeros((S, S))
    for k in range(4):
        px = 0.38 if k % 2 == 0 else 0.62
        py = 0.15 + k * 0.23
        fp = np.maximum(fp, smooth(0.07 - np.sqrt(((xx - px) / 0.8) ** 2 + ((yy - py) / 1.3) ** 2), 0, 0.01))
        for c in range(4):
            tx = px - 0.06 + c * 0.04; ty = py - 0.12
            fp = np.maximum(fp, smooth(0.018 - np.sqrt((xx - tx) ** 2 + ((yy - ty) / 2.2) ** 2), 0, 0.006))
    fp *= smooth(fbm(S, 14, rng, 3), 0.3, 0.55)
    cell(7, blood[None, None, :] * np.ones((S, S, 1)), fp * 0.9)
    path = save('decals_atlas', atlas, 'PNG', alpha=True)
    return path


def build_all():
    tex_floor_tile(); tex_wall_paint(); tex_wall_children(); tex_wall_concrete(); tex_concrete_floor()
    tex_ceiling(); tex_metal(); tex_steel(); tex_wood(); tex_fabric(); tex_plastic(); tex_fur(); tex_skin()
    tex_brick(); tex_asphalt(); tex_mud(); tex_paper(); tex_decals()
    return sorted(os.listdir(TEX_DIR))

