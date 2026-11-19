"""Cuts the streamer out of their face cam, frame by frame, for the pop-out layout (their head and hair rise out of
the top of the card).

Two small models, downloaded once, by themselves, the first time a pop-out clip is made (under 1 MB together):
- Google's MediaPipe selfie segmentation (Apache 2.0 licence), run with onnxruntime (MIT): which pixels are the
  person. About 15 ms a frame on an ordinary processor.
- OpenCV's YuNet face detector (MIT licence), run with OpenCV: where the face is. The selfie model counts a gaming
  chair or headrest behind the streamer as part of them, so only the area around the head may rise over the card.
Both licences allow commercial use.

What comes out is a matte: a grey video the size of the face cam picture, white where the head is, black elsewhere.
The render lays it on the face cam as its see-through channel. If anything goes wrong (no model, no internet the
first time), no matte is made and the clip is made without the pop-out, as a plain card.
"""
import shutil
import subprocess
import threading
import urllib.request
from pathlib import Path

import numpy as np

from . import config, media

MODELS = {   # file name -> where it is downloaded from
    "selfie_segmentation.onnx": "https://huggingface.co/onnx-community/mediapipe_selfie_segmentation/resolve/main/onnx/model.onnx",
    "face_detection_yunet.onnx": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
}
SIDE = 256                      # the selfie model looks at the picture squeezed to 256 x 256
FACE_W = 224                    # faces are looked for at this width (a face cam face is big: plenty)
_lock = threading.Lock()
_session = None


def available() -> bool:
    try:
        import onnxruntime  # noqa: F401
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


def _path(name) -> Path:
    return config.MODELS_DIR / name


def ensure() -> bool:
    """Both models on this computer, downloading them the first time. False if they can't be had."""
    def ok(n):
        return _path(n).is_file() and _path(n).stat().st_size > 100_000
    if all(ok(n) for n in MODELS):
        return True
    with _lock:
        for name, url in MODELS.items():
            if ok(name):
                continue
            part = _path(name).with_suffix(".part")
            try:
                part.parent.mkdir(parents=True, exist_ok=True)
                with urllib.request.urlopen(url, timeout=60) as r, open(part, "wb") as f:
                    shutil.copyfileobj(r, f)
                if part.stat().st_size < 100_000:
                    raise OSError("the download was cut short")
                part.replace(_path(name))
            except Exception as e:  # noqa: BLE001 - no model: the clip is made without the pop-out
                print(f"  Couldn't download the face cam cut-out model: {e}", flush=True)
                part.unlink(missing_ok=True)
                return False
    return True


def _model():
    global _session
    if _session is None:
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.intra_op_num_threads = 2          # leave the rest of the processor to the encoder running beside it
        o.log_severity_level = 3
        _session = ort.InferenceSession(str(_path("selfie_segmentation.onnx")), o, providers=["CPUExecutionProvider"])
    return _session


def _guided(img, p, r, eps=1e-3):
    """Pulls the soft mask's edges onto the real edges in the picture (a guided filter), so hair and shoulders are
    cut where they are, not where the small mask guessed."""
    import cv2
    box = lambda x: cv2.boxFilter(x, -1, (r, r))      # noqa: E731
    mi, mp = box(img), box(p)
    a = (box(img * p) - mi * mp) / (box(img * img) - mi * mi + eps)
    b = mp - a * mi
    return box(a) * img + box(b)


def _person(small_mask):
    """Keeps only the biggest blob (the person) and drops loose bits of chair or wall the model half-picked up."""
    import cv2
    hard = (small_mask > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n <= 2:
        return small_mask
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((lab == big).astype(np.uint8), np.ones((9, 9), np.uint8))
    return small_mask * cv2.GaussianBlur(keep.astype(np.float32), (9, 9), 0)


class _Head:
    """Follows the face from frame to frame and gives the soft oval around the head (face, hair, a little room) that
    may rise over the card. A frame where no face is found keeps the last place; before any face is found, the
    whole person may rise."""

    def __init__(self, w, h):
        import cv2
        self.k = FACE_W / w
        self.size = (FACE_W, max(16, round(h * self.k)))
        self.det = cv2.FaceDetectorYN.create(str(_path("face_detection_yunet.onnx")), "", self.size, 0.6, 0.3, 20)
        self.box, self.n = None, 0
        self.yy, self.xx = np.mgrid[0:h, 0:w].astype(np.float32)

    def window(self, img, rows, body=False):
        """The soft area around the head that may show, or None before any face is found. With body=True: (head,
        body), the body being the neck, shoulders and chest below it, widening like a person does, so a chair beside
        the head stays out either way."""
        import cv2
        if self.n % 6 == 0:                  # five times a second is plenty: heads move slowly
            small = cv2.cvtColor(cv2.resize(img, self.size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2BGR)
            _, found = self.det.detect(small)
            if found is not None and len(found):
                f = max(found, key=lambda r: r[2] * r[3] * r[-1])
                b = np.array(f[:4], np.float32) / self.k
                self.box = b if self.box is None else 0.7 * self.box + 0.3 * b
        self.n += 1
        if self.box is None:
            return (None, None) if body else None
        key = (rows, body, *np.round(self.box, 1))
        if getattr(self, "_key", None) == key:
            return self._win                    # the face hasn't moved: the same area as the last frame
        self._key, self._win = key, self._area(rows, body)
        return self._win

    def _area(self, rows, body):
        x, y, fw, fh = self.box
        # the face box runs from the eyebrows to the chin: hair and headphones reach about half a face above it and
        # most of a face to each side. Past that it fades out, so a headrest just above the hair stays behind.
        cx, cy = x + fw / 2, y + fh * 0.45
        rx, ry = fw * 1.0, fh * 0.88
        yy, xx = self.yy[:rows], self.xx[:rows]
        d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        win = np.clip((1.08 - d) / 0.1, 0.0, 1.0)     # a short fade: a long one leaves a smudge of chair round the hair
        if body:
            half = fw * np.clip(0.75 + (yy - (y + fh * 0.95)) / fh * 1.3, 0.75, 3.4)
            torso = np.clip((half - np.abs(xx - cx)) / (fw * 0.2), 0.0, 1.0) * np.clip((yy - (y + fh * 0.7)) / (fh * 0.3), 0.0, 1.0)
            return win, np.maximum(win, torso)
        return win


_faces: dict = {}


def face_box(src: Path, start: float, dur: float, cam, n: int = 7):
    """Where the streamer's face is in the face cam part `cam` of src between start and start + dur: [x, y, w, h] as
    fractions of that part (the middle of what was found in n frames across the clip), or None. The pop-out card's
    top edge is set from it, so the head clearly rises over the card however much room is above it in the box."""
    key = (str(src), round(start, 2), round(dur, 2), tuple(round(float(c), 4) for c in cam))
    if key in _faces:
        return _faces[key]
    if not available() or not ensure():
        return None
    import cv2
    x, y, cw, ch = cam
    found = []
    det = None
    for i in range(n):
        t = start + dur * (i + 0.5) / n
        try:
            p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.2f}", "-i", str(src), "-frames:v", "1",
                                "-vf", f"crop=iw*{cw}:ih*{ch}:iw*{x}:ih*{y},scale={FACE_W}:-2", "-f", "image2pipe",
                                "-vcodec", "bmp", "-"], capture_output=True, timeout=30, creationflags=media.NO_WINDOW)
        except (subprocess.TimeoutExpired, OSError):
            continue
        img = cv2.imdecode(np.frombuffer(p.stdout, np.uint8), cv2.IMREAD_COLOR) if p.stdout else None
        if img is None:
            continue
        h, w = img.shape[:2]
        if det is None:
            det = cv2.FaceDetectorYN.create(str(_path("face_detection_yunet.onnx")), "", (w, h), 0.6, 0.3, 20)
        det.setInputSize((w, h))
        _, faces = det.detect(img)
        if faces is not None and len(faces):
            f = max(faces, key=lambda r: r[2] * r[3] * r[-1])
            found.append([f[0] / w, f[1] / h, f[2] / w, f[3] / h])
    box = [round(float(np.median([b[k] for b in found])), 4) for k in range(4)] if len(found) >= 2 else None
    _faces[key] = box
    return box


def _card_shape(w, h, card):
    """The card's own shape inside the w x h picture: 1 inside the card (its lower card["h"] rows, rounded or a
    circle), 0 above it and outside its corners."""
    from PIL import Image, ImageDraw
    m = Image.new("L", (w * 2, card["h"] * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * 2 - 1, card["h"] * 2 - 1), radius=card["r"] * 2, fill=255)
    out = np.zeros((h, w), np.float32)
    out[h - card["h"]:] = np.asarray(m.resize((w, card["h"]), Image.LANCZOS), np.float32)[:h] / 255.0
    return out


def _run(src: Path, start: float, dur: float, cam, w: int, h: int, keep: int, fps: int, card, writer: list) -> bool:
    """The cut-out, frame by frame: reads the face cam part `cam` ([left, top, width, height] of the source) of src
    from start for dur seconds, cropped and scaled to w x h at fps exactly like the render's face cam, and feeds
    `writer` (an ffmpeg command reading raw frames) either the matte alone ("gray") or the picture with the matte as
    its see-through channel ("rgba"), as the command's -pix_fmt says. See matte() for what shows where."""
    if not available() or not ensure():
        return False
    import cv2
    sess = _model()
    name = sess.get_inputs()[0].name
    x, y, cw, ch = cam
    vf = (f"fps={fps},crop=iw*{cw}:ih*{ch}:iw*{x}:ih*{y},scale={w}:{h}:force_original_aspect_ratio=increase,"
          f"crop={w}:{h},setsar=1")
    rgba = "rgba" in writer
    rd = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{dur:.2f}", "-i", str(src), "-vf", vf,
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, creationflags=media.NO_WINDOW)
    wr = subprocess.Popen(writer, stdin=subprocess.PIPE, creationflags=media.NO_WINDOW)
    # the rows that can show, with a short soft edge so the cut line under the head never looks drawn
    keep = max(1, min(h, keep))
    inside = _card_shape(w, h, card) if card else None
    plain = bool(card and card.get("plain"))
    out_of_card = None                       # the card shows its own sharp picture inside it
    if inside is not None and not plain:
        e = max(3, w // 120) * 2 + 1          # reach a few pixels into the card, so its soft edge never lets the
        out_of_card = 1.0 - cv2.erode(inside, np.ones((e, e), np.uint8))    # border show through the head
    if plain:
        keep = h                            # the whole picture; the card's shape decides below the head
    rows = np.zeros((h, 1), np.float32)
    rows[:keep] = 1.0
    fe = max(2, h // 60)
    if not plain:
        rows[max(0, keep - fe):keep, 0] = np.linspace(1.0, 0.0, min(fe, keep), dtype=np.float32)
    ft = min(keep, max(2, h // 18))         # the face cam's own top edge often cuts the head: fade it in, no hard line
    rows[:ft, 0] *= np.linspace(0.0, 1.0, ft, dtype=np.float32)
    top = min(h, keep + 2)
    rad = max(3, (w // 90) | 1)
    lo, span = (0.4, 0.35) if plain else (0.3, 0.45)   # on a plain fill a soft edge shows the old background: cut tighter
    size, prev, frames = w * h * 3, None, 0
    try:
        head = _Head(w, h)
        while True:
            buf = rd.stdout.read(size)
            if len(buf) < size:
                break
            img = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            if prev is None or frames % 2 == 0:    # the person model every other frame; the edges follow every frame
                x_in = cv2.resize(img, (SIDE, SIDE), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
                m = sess.run(None, {name: x_in.transpose(2, 0, 1)[None]})[0][0, 0]
                m = _person(m)
                prev = m if prev is None else 0.65 * m + 0.35 * prev    # steadier from frame to frame: no flicker
            part = cv2.resize(prev, (w, h), interpolation=cv2.INTER_LINEAR)[:top]
            grey = cv2.cvtColor(img[:top], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
            hs = (max(8, w // 2), max(8, top // 2))   # the edge clean-up at half size, then back to full
            a = cv2.resize(_guided(cv2.resize(grey, hs, interpolation=cv2.INTER_AREA), cv2.resize(part, hs, interpolation=cv2.INTER_AREA),
                                   max(3, (rad // 2) | 1)), (w, top), interpolation=cv2.INTER_LINEAR)
            a = np.clip((a - lo) / span, 0.0, 1.0)                       # a firm edge, still soft over a pixel or two
            a = a * a * (3 - 2 * a) * rows[:top]
            if plain:                       # plain: the head may rise anywhere, the body stays inside the card
                hw, bw = head.window(img, top, body=True)
                if hw is not None:
                    a *= np.maximum(hw, bw * inside)
                else:                       # no face found: the top rows like a face cam card, the card's shape below
                    a *= np.maximum(rows[:top] * (np.arange(top)[:, None] < h - card["h"] + max(card["r"], card.get("b", 0))), inside)
            else:
                win = head.window(img, top)
                if win is not None:
                    a *= win
                if out_of_card is not None:     # only what is outside the card: the head over its top edge and border
                    a *= out_of_card[:top]
            alpha = np.zeros((h, w), np.uint8)
            alpha[:top] = (a * 255 + 0.5).astype(np.uint8)
            wr.stdin.write(np.dstack([img, alpha]).tobytes() if rgba else alpha.tobytes())
            frames += 1
        wr.stdin.close()
        ok = wr.wait(timeout=300) == 0 and rd.wait(timeout=30) == 0 and frames > 0
    except Exception as e:  # noqa: BLE001 - no cut-out: the clip is made as a plain card
        print(f"  The face cam cut-out failed: {e}", flush=True)
        ok = False
    finally:
        for p in (rd, wr):
            if p.poll() is None:
                p.kill()
    return ok


def matte(src: Path, start: float, dur: float, cam, w: int, h: int, keep: int, out: Path, fps: int, card=None) -> bool:
    """Writes `out`: the person in the face cam part `cam` ([left, top, width, height] of the source) of src from
    start for dur seconds, as a grey video w x h at fps, cropped and scaled exactly like the render's face cam.
    Only the top `keep` rows can show (the part above the card and its rounded top corners); below that it is
    black, so the card's own picture shows there, and with `card` ({"h", "r", "b", "plain"}) nothing inside the card's
    shape either: only what rises out of it. With card["plain"] (a plain background) the whole person shows instead:
    the head anywhere, the body only inside the card's shape. True when the matte was made."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(fps),
           "-i", "-", "-c:v", "ffv1", str(out)]
    return _run(src, start, dur, cam, w, h, keep, fps, card, cmd) and out.is_file()


def preview(src: Path, start: float, dur: float, cam, w: int, h: int, keep: int, out: Path, fps: int, card=None) -> bool:
    """The same cut-out for the editor's live preview: the face cam picture with only the person showing (exactly
    what the finished clip lays over the card), as a small see-through WebM the browser plays over the stream."""
    part = out.with_suffix(".part.webm")
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps),
           "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-deadline", "realtime",
           "-cpu-used", "8", "-row-mt", "1", "-g", str(fps), "-auto-alt-ref", "0", "-an", str(part)]
    ok = _run(src, start, dur, cam, w, h, keep, fps, card, cmd) and part.is_file()
    if ok:
        part.replace(out)
    else:
        part.unlink(missing_ok=True)
    return ok
