"""Finds the streamer's face cam in a stream, so the split layout can show it without anyone drawing a box.

A few frames from the clip are checked for faces (OpenCV's face detector, front and side views). The face that turns
up in the same place most often is the streamer's; the face cam box is drawn around it, a little wider than the
head and reaching down to the shoulders, in the shape of the band it will fill. If no face is found reliably,
nothing is returned and the usual box (bottom right) is used.
"""
import subprocess
from pathlib import Path

import numpy as np

from . import media

SAMPLES = 8          # frames looked at across the clip
WIDTH = 960          # frames are checked at this width: big enough for a small face cam, quick to search


def _frame(src: Path, t: float):
    """One frame at t seconds, as a grey picture WIDTH pixels wide, or None."""
    import cv2
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.2f}",
           "-i", str(src), "-frames:v", "1", "-vf", f"scale={WIDTH}:-2", "-f", "image2pipe", "-vcodec", "bmp", "-"]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=30, creationflags=media.NO_WINDOW)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if p.returncode or not p.stdout:
        return None
    img = cv2.imdecode(np.frombuffer(p.stdout, np.uint8), cv2.IMREAD_GRAYSCALE)
    return None if img is None else cv2.equalizeHist(img)


def _faces(img) -> list:
    """Faces in one frame as (x, y, w, h) in that frame's pixels: front-facing first, then side views both ways."""
    import cv2
    h, w = img.shape[:2]
    lo, hi = (int(w * 0.03),) * 2, (int(w * 0.45),) * 2
    found = []
    front = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    found += [tuple(f) for f in front.detectMultiScale(img, 1.1, 7, minSize=lo, maxSize=hi)]
    if not found:
        side = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
        found += [tuple(f) for f in side.detectMultiScale(img, 1.1, 7, minSize=lo, maxSize=hi)]
        flip = cv2.flip(img, 1)
        found += [(w - x - fw, y, fw, fh) for x, y, fw, fh in side.detectMultiScale(flip, 1.1, 7, minSize=lo, maxSize=hi)]
    return found


def find(src, start: float, end: float, aspect: float = 1080 / 960):
    """The face cam box for a clip of src between start and end, as [x, y, w, h] in parts of the frame (0 to 1),
    shaped to aspect (width over height of the band it fills). None if no face shows up reliably."""
    try:
        import cv2  # noqa: F401
    except ImportError:
        return None
    src = Path(src)
    span = max(1.0, end - start)
    seen, size = [], None
    for i in range(SAMPLES):
        img = _frame(src, start + span * (i + 0.5) / SAMPLES)
        if img is None:
            continue
        size = img.shape[1], img.shape[0]
        seen += [(x / size[0], y / size[1], fw / size[0], fh / size[1], i) for x, y, fw, fh in _faces(img)]
    if not seen or not size:
        return None
    # the face that turns up in the most frames, in about the same place, is the streamer's
    def near(a, b):
        return abs((a[0] + a[2] / 2) - (b[0] + b[2] / 2)) < 0.06 and abs((a[1] + a[3] / 2) - (b[1] + b[3] / 2)) < 0.08
    best = max(seen, key=lambda a: len({b[4] for b in seen if near(a, b)}))
    group = [b for b in seen if near(best, b)]
    if len({b[4] for b in group}) < min(2, SAMPLES):
        return None                       # seen once only: could be anything, keep the usual box
    fx, fy, fw, fh = (float(np.median([b[k] for b in group])) for k in range(4))
    # in frame pixels: a box about 2.6 faces tall, centred a little below the face (head and shoulders),
    # as wide as the band's shape needs, then kept inside the frame
    W, H = size
    cx, cy = (fx + fw / 2) * W, (fy + fh / 2) * H + fh * H * 0.3
    bh = fh * H * 2.6
    bw = bh * aspect
    if bw > W:
        bw, bh = W, W / aspect
    if bh > H:
        bh, bw = H, H * aspect
    x = min(max(0.0, cx - bw / 2), W - bw)
    y = min(max(0.0, cy - bh / 2), H - bh)
    return [round(x / W, 4), round(y / H, 4), round(bw / W, 4), round(bh / H, 4)]


def scene(src, start: float, end: float):
    """What the picture shows during start..end, for the AI editor choosing a layout. Faces are counted only when
    they stay in about the same place across the clip (a streamer's face cam, a podcast's speakers); faces that
    come and go (characters in a game or a film) don't count. Returns {"faces": steady faces, "cam": a small steady
    face off to a side or corner, or None, "big": steady faces filling a good part of the frame, "seen": any face at
    all}, sizes and places as parts of the frame. None when the frames can't be read."""
    n, seen, read = 6, [], 0
    for i in range(n):
        img = _frame(Path(src), start + (end - start) * (i + 0.5) / n)
        if img is None:
            continue
        read += 1
        W, H = img.shape[1], img.shape[0]
        seen += [((x + w / 2) / W, (y + h / 2) / H, w / W, h / H, i) for x, y, w, h in _faces(img)]
    if not read:
        return None
    if not seen:
        return {"faces": 0, "cam": None, "big": 0, "seen": False}

    def near(a, b):
        return abs(a[0] - b[0]) < 0.06 and abs(a[1] - b[1]) < 0.08
    steady, used = [], set()
    for f in sorted(seen, key=lambda f: -len({g[4] for g in seen if near(f, g)})):
        if id(f) in used:
            continue
        group = [g for g in seen if near(f, g)]
        used.update(id(g) for g in group)
        if len({g[4] for g in group}) >= max(2, read // 2):          # in at least half the frames, in the same place
            steady.append([round(float(sorted(g[k] for g in group)[len(group) // 2]), 3) for k in range(4)])
    side = lambda f: f[0] < 0.3 or f[0] > 0.7 or f[1] > 0.62 or f[1] < 0.3   # noqa: E731 - off to a side or a corner
    cams = [f for f in steady if f[2] < 0.14 and side(f)]
    big = [f for f in steady if f[2] >= 0.14]
    cam = min(cams, key=lambda f: f[2]) if cams else None
    return {"faces": len(steady), "cam": dict(zip("xywh", cam)) if cam else None, "big": len(big), "seen": True}


def face_point(src, start: float, end: float):
    """Where the main face is during start..end, for a zoom: its middle as (x, y) fractions of the picture, or None.
    Four frames are checked; the biggest face in each counts, and their middles are averaged (faces far from the
    others are left out, so one wrong find doesn't pull the zoom away)."""
    pts = []
    for i in range(4):
        img = _frame(Path(src), start + (end - start) * (i + 0.5) / 4)
        if img is None:
            continue
        faces = _faces(img)
        if faces:
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            pts.append(((x + w / 2) / img.shape[1], (y + h * 0.45) / img.shape[0]))
    if not pts:
        return None
    mx, my = sorted(p[0] for p in pts)[len(pts) // 2], sorted(p[1] for p in pts)[len(pts) // 2]
    near = [p for p in pts if abs(p[0] - mx) < 0.15 and abs(p[1] - my) < 0.15] or pts
    return round(float(sum(p[0] for p in near) / len(near)), 4), round(float(sum(p[1] for p in near) / len(near)), 4)
