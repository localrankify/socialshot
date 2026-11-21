"""Moving effects around the pop-out card's border: a soft glow, fire licking up from the edge, or lightning crackling
around it. Each is a short loop of see-through frames drawn here from the card's shape, the same way for the
finished clip (full size, looped under the card by ffmpeg) and for the editor's preview (a small copy played in the
browser), so the two look alike.

Everything is measured in the card's own pixels at full size and drawn at `scale` of that, so a small preview copy is
the same picture, only smaller.
"""
import subprocess
from pathlib import Path

import numpy as np

from . import media

KINDS = ("glow", "fire", "thunder")
FPS = 24
FRAMES = 48                    # a two-second loop
THUNDER_COL = (150, 200, 255)


def margin(w: int, h: int) -> int:
    """How far the effect reaches outside the card (full-size pixels): room for the flames and the bolts."""
    return int(round(max(28, 0.13 * max(w, h)) / 2)) * 2


def _noise(size, scale, seed):
    """Smooth random noise that tiles in both directions (so it can scroll forever without a seam)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((size, size)))
    fy, fx = np.meshgrid(np.fft.fftfreq(size), np.fft.fftfreq(size), indexing="ij")
    f *= np.exp(-(fx ** 2 + fy ** 2) * (size / scale) ** 2)
    n = np.real(np.fft.ifft2(f))
    return ((n - n.min()) / (n.max() - n.min() + 1e-9)).astype(np.float32)


def _shape(cw, ch, m, w, h, r):
    """The card's outward distance at every pixel (negative inside), and which way is out (y part of it)."""
    import cv2
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
    px, py = xx - (m + w / 2), yy - (m + h / 2)
    qx, qy = np.abs(px) - (w / 2 - r), np.abs(py) - (h / 2 - r)
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=3)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=3)
    up = np.clip(-gy / (np.hypot(gx, gy) + 1e-6), 0, 1)        # 1 on the top edge, 0 on the sides and bottom
    return d, up, xx, yy


def _ramp(i, stops):
    out = np.zeros(i.shape + (3,), np.float32)
    xs = [s[0] for s in stops]
    for c in range(3):
        out[..., c] = np.interp(i, xs, [s[1][c] for s in stops])
    return out


def frames(kind: str, w: int, h: int, r: int, b: int, color: str = "#FFFFFF", scale: float = 1.0):
    """The loop for a card w x h (full-size pixels, corners r, border b): FRAMES pictures, each an RGBA array of
    (h + 2m) x (w + 2m) at `scale`, the card's top-left corner at (m, m)."""
    import cv2
    m = margin(w, h)
    fw_, fh_ = max(8, int(round((w + 2 * m) * scale))), max(8, int(round((h + 2 * m) * scale)))
    if kind in ("glow", "fire"):            # soft: drawn at half size and scaled up, four times quicker
        S = scale * 0.5
        return [cv2.resize(f, (fw_, fh_), interpolation=cv2.INTER_LINEAR) for f in _frames(kind, w, h, r, b, color, S, m)]
    return _frames(kind, w, h, r, b, color, scale, m)


def _frames(kind, w, h, r, b, color, S, m):
    import cv2
    cw, ch = max(8, int(round((w + 2 * m) * S))), max(8, int(round((h + 2 * m) * S)))
    d, up, xx, yy = _shape(cw, ch, m * S, w * S, h * S, min(r, w / 2, h / 2) * S)
    d = d / S                                   # back in full-size pixels
    outside = np.clip((d - b * 0.3) / 3.0, 0, 1)   # the effect stays outside the card (it may cover the border)
    rgb0 = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)], np.float32) if color.startswith("#") else np.full(3, 255, np.float32)
    out = []
    if kind == "glow":
        base = np.exp(-np.maximum(d - b, 0) / (0.22 * m)) * outside
        line = np.exp(-np.abs(d - b * 0.5) / (0.05 * m + 1))
        for k in range(FRAMES):
            pulse = 0.82 + 0.18 * np.sin(2 * np.pi * k / FRAMES)
            a = np.clip(base * 0.75 * pulse + line * 0.35, 0, 1)
            rgb = np.clip(rgb0 * (0.75 + 0.25 * a[..., None]) + 255 * 0.35 * line[..., None], 0, 255)
            out.append(np.dstack([rgb, a * 255]).astype(np.uint8))
        return out
    if kind == "fire":
        P = 256
        n1, n2 = _noise(P, 18, 7), _noise(P, 7, 11)
        # noise looked up in full-size pixels, so a smaller preview shows the same flames
        u, v = xx / S / (0.5 * m) * 32, yy / S / (0.9 * m) * 32
        dn = np.maximum(d - b * 0.2, 0) / m                       # 0 at the border, 1 at the edge of the picture
        reach = (0.3 + 0.7 * up ** 1.3)                             # tall on the top edge, shorter on the sides
        for k in range(FRAMES):
            ph = k / FRAMES * P
            a1 = cv2.remap(n1, (u % P).astype(np.float32), ((v + ph) % P).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            a2 = cv2.remap(n2, ((u * 2.1) % P).astype(np.float32), ((v * 2.1 + 2 * ph) % P).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            n = 0.65 * a1 + 0.35 * a2
            i = np.clip(1 - dn / (reach * (0.45 + 1.15 * n) + 1e-3), 0, 1) ** 1.35 * outside
            i = np.clip(i * (0.85 + 0.5 * n), 0, 1)
            rgb = _ramp(i, [(0, (90, 0, 0)), (0.3, (200, 30, 0)), (0.55, (255, 110, 10)), (0.8, (255, 200, 60)), (1, (255, 250, 220))])
            a = np.clip(i * 1.5, 0, 1)
            glow = cv2.GaussianBlur(i, (0, 0), max(1.0, 0.06 * m * S)) * 0.5
            a = np.maximum(a, glow * outside)
            out.append(np.dstack([rgb, a * 255]).astype(np.uint8))
        return out
    # thunder: a cold glow that flickers, and a few jagged bolts running along the border, each lasting 2-3 frames
    base = np.exp(-np.maximum(d - b, 0) / (0.16 * m)) * outside
    ring = ((np.abs(d - b * 0.5 - 0.06 * m) < 1.5 / S + 0.5)).astype(np.uint8)
    cs, _ = cv2.findContours(ring, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    path = max(cs, key=len)[:, 0, :].astype(np.float32) if cs else np.zeros((1, 2), np.float32)
    nrm = np.roll(path, -3, 0) - np.roll(path, 3, 0)
    nrm = np.stack([nrm[:, 1], -nrm[:, 0]], 1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-6
    probe = np.clip((path + nrm * 4).astype(int), 0, [cw - 1, ch - 1])   # make every normal point out of the card
    nrm *= np.where(d[probe[:, 1], probe[:, 0]] < d[np.clip(path.astype(int)[:, 1], 0, ch - 1), np.clip(path.astype(int)[:, 0], 0, cw - 1)], -1, 1)[:, None]
    col = np.array(THUNDER_COL, np.float32)
    for k in range(FRAMES):
        rng = np.random.default_rng(1000 + k // 3)
        flick = 0.55 + 0.45 * rng.random()
        bolts = np.zeros((ch, cw), np.float32)
        for _ in range(int(rng.integers(3, 6))):
            if len(path) < 20:
                break
            n = int(len(path) * rng.uniform(0.07, 0.17))
            s0 = int(rng.integers(0, len(path)))
            nodes = int(rng.integers(10, 16))
            idx = (s0 + np.linspace(0, n, nodes).astype(int)) % len(path)
            env = np.sin(np.pi * np.linspace(0, 1, nodes))       # starts and ends on the border, jumps off between
            off = env * (0.2 + 0.8 * rng.random(nodes)) * 0.42 * m * S
            pts = path[idx] + nrm[idx] * off[:, None] + rng.normal(0, 0.035 * m * S, (nodes, 2))
            th = max(1, int(round(2.4 * S)))
            cv2.polylines(bolts, [pts.astype(np.int32)], False, 1.0, th, cv2.LINE_AA)
            j = int(rng.integers(2, nodes - 2))                   # one small branch flicking outward
            br = [pts[j]]
            for q in range(3):
                br.append(br[-1] + nrm[idx[j]] * 0.12 * m * S * rng.uniform(0.5, 1.2) + rng.normal(0, 0.06 * m * S, 2))
            cv2.polylines(bolts, [np.array(br, np.int32)], False, 0.8, max(1, th - 1), cv2.LINE_AA)
        core = np.clip(bolts, 0, 1)
        glow = cv2.GaussianBlur(core, (0, 0), max(1.0, 0.05 * m * S)) * 2.2
        a = np.clip(np.maximum(core, glow) + base * 0.55 * flick, 0, 1) * outside
        rgb = np.clip(col * (1 - core[..., None]) + 255 * core[..., None], 0, 255)
        out.append(np.dstack([rgb, a * 255]).astype(np.uint8))
    return out


def write(kind, w, h, r, b, color, out: Path, scale: float = 1.0, webm: bool = False) -> bool:
    """The loop as a file: lossless (ffv1, for the finished clip) or a small see-through WebM (the preview)."""
    fs = frames(kind, w, h, r, b, color, scale)
    fh, fw = fs[0].shape[:2]
    part = out.with_name(out.stem + ".part" + out.suffix)
    codec = (["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-deadline", "realtime", "-cpu-used", "8",
              "-auto-alt-ref", "0"] if webm else ["-c:v", "ffv1", "-pix_fmt", "bgra"])
    p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{fw}x{fh}", "-r", str(FPS),
                        "-i", "-", *codec, "-an", str(part)], input=b"".join(f.tobytes() for f in fs),
                       capture_output=True, timeout=120, creationflags=media.NO_WINDOW)
    if p.returncode or not part.is_file():
        part.unlink(missing_ok=True)
        return False
    part.replace(out)
    return True
