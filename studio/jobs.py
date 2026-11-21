"""Job pipeline: get video -> audio -> transcript -> AI picks -> rendered clips. One heavy task at a time."""
import collections
import json
import os
import math
import queue
import re
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

from . import brain, chat, config, creators, ctx, load, media, render, roman, safe, transcribe, usage

class _FairQueue:
    """Whose video is next. Each person has their own line and the lines take turns, so someone who adds ten
    videos does not make everyone else wait behind all ten. Small tasks (re-making one clip) go first."""

    def __init__(self):
        self.cv = threading.Condition()
        self.quick = collections.deque()
        self.lines = {}                       # user -> their waiting videos, oldest first
        self.turn = collections.deque()       # users with something waiting, in the order they will be served
        self.epoch = 0                        # goes up whenever the line moves
        self._pos = (0.0, {})
        self.running = 0                      # videos being worked on right now
        self.last_start = 0.0
        self.held = False                     # videos are waiting only because the machine is near full

    def _room(self) -> bool:
        """May one more video start? One always may. More only while the machine has room, and a few seconds
        after the last one started, so its weight is already showing in the measurements."""
        if self.running == 0:
            return True
        return self.running < config.JOB_WORKERS and time.time() - self.last_start > 6 and not load.busy()

    def done(self):
        with self.cv:
            self.running = max(0, self.running - 1)
            self.cv.notify_all()

    def put(self, item, user=None):
        with self.cv:
            if user is None:
                self.quick.append(item)
            else:
                if user not in self.lines:
                    self.lines[user] = collections.deque()
                    self.turn.append(user)
                self.lines[user].append(item)
            self.epoch += 1
            self.cv.notify()

    def get(self, quick_only=False):
        with self.cv:
            while True:
                if self.quick:
                    self.epoch += 1
                    return self.quick.popleft()
                if not quick_only and self.turn:
                    if self._room():
                        break
                    if not self.held:
                        self.held = True
                        self.epoch += 1
                elif self.held:
                    self.held = False
                    self.epoch += 1
                self.cv.wait(1.0)             # looked at again every second: the line moves the moment there is room
            self.epoch += 1
            self.held = False
            self.running += 1
            self.last_start = time.time()
            user = self.turn.popleft()
            item = self.lines[user].popleft()
            if self.lines[user]:
                self.turn.append(user)
            else:
                del self.lines[user]
            return item

    def ahead(self) -> dict:
        """job id -> how many videos will start before it. Worked out at most once a second."""
        with self.cv:
            if time.time() - self._pos[0] < 1:
                return self._pos[1]
            out, lines, order, n = {}, {u: list(q) for u, q in self.lines.items()}, list(self.turn), 0
            depth = 0
            while order:
                nxt = []
                for u in order:
                    if depth < len(lines[u]):
                        out[lines[u][depth][1]] = n
                        n += 1
                        if depth + 1 < len(lines[u]):
                            nxt.append(u)
                order, depth = nxt, depth + 1
            self._pos = (time.time(), out)
            return out


_q = _FairQueue()
_live_q: "queue.Queue" = queue.Queue()   # live clips never wait behind a long video
_jobs: dict = {}
_CHATS: dict = {}       # job id -> its YouTube chat download while the job runs
_by_user: dict = {}                       # user -> {job id: job}: listing one person's videos never scans everyone's
_lock = threading.RLock()
on_clip_ready: list = []   # callbacks (job, clip), run once when a clip first finishes

DEFAULTS = {"max_clips": 6, "min_len": 15, "max_len": 60, "style": "auto", "layout": "blur", "quality": 2160,   # 2160: the original, up to 4K
            "range_start": None, "range_end": None, "use_chat": True,
            "end_card": True,     # a two-second "Made with SocialShot" card after every new clip
            "watermark": False,   # a social watermark crediting the source ("Full video on YouTube /channel"); off unless turned on
            "ai_edit": False}      # the AI editor: music, zooms, sound effects (and a reaction) on every new clip


LIMITS = {"max_clips": (1, 20), "min_len": (5, 120), "max_len": (10, 180), "quality": (360, 2160)}   # 2160: a 4K source


# words in a title that mean gaming or a stream: with the Auto caption style, those clips get the Gamer captions
GAMING_WORDS = re.compile(
    r"\b(gam(e|es|ing|eplay|er|ers)|let'?s ?play|walkthrough|speedrun|playthrough|live|stream(s|ing|er|ers)?|vods?|"
    r"esports?|twitch|kick|bgmi|pubg|valorant|gta|minecraft|fortnite|free ?fire|warzone|call of duty|cod|apex|cs2|"
    r"cs ?go|counter[- ]strike|roblox|dota|league of legends|overwatch|rank(ed)? push|scrims?|clutch|lobby)\b", re.I)


def _style_for(job, o) -> str:
    """The caption style for a job's new clips. Auto: Gamer for gaming videos, live recordings, Twitch and Kick
    videos and past streams; Studio for everything else."""
    s = o.get("style") or "auto"
    if s != "auto":
        return s
    url = str((job.get("source") or {}).get("url") or "")
    gaming = (job.get("kind") == "live" or job.get("gaming") or "twitch.tv/" in url or "kick.com/" in url
              or GAMING_WORDS.search(f"{job.get('title') or ''} {(job.get('source') or {}).get('name') or ''}"))
    return "gamer" if gaming else "studio"


def clean_options(options) -> dict:
    """Only known settings, each inside its allowed range. Raises ValueError on nonsense."""
    out = {}
    for k, v in (options if isinstance(options, dict) else {}).items():
        if k not in DEFAULTS or v in ("", None):
            continue
        if k in LIMITS:
            lo, hi = LIMITS[k]
            v = max(lo, min(hi, int(float(v))))
        elif k == "style":
            v = v if v in render.STYLES or v == "auto" else DEFAULTS["style"]
        elif k == "layout":
            v = v if v in render.LAYOUTS else DEFAULTS["layout"]
        elif k in ("use_chat", "ai_edit", "watermark", "end_card"):        # on/off settings
            v = v is True or v in (1, "1", "true", "on")
        else:                                    # range_start, range_end: seconds into the video
            v = float(v)
            if not math.isfinite(v) or v < 0:
                raise ValueError("That part of the video isn't valid.")
        out[k] = v
    if out.get("range_end") is not None and out["range_end"] <= out.get("range_start", 0):
        raise ValueError("The end of the chosen part must be after its start.")
    return out


def job_dir(jid) -> Path:
    return Path(_jobs[jid]["dir"])


HIDDEN = ("dir", "user", "source_path", "recover")


def _thumb_later(job):
    """A finished video with no picture for the list (a live recording, say): one frame of its own video, made once
    in the background."""
    if job.get("thumb") or job.get("thumb_tried") or job.get("status") != "done":
        return
    src = Path(str(job.get("source_path") or ""))
    if not src.is_file():
        return
    job["thumb_tried"] = True

    def run():
        if media.save_thumb(Path(job["dir"]), video=src):
            job["thumb"] = True
        save(job)
    threading.Thread(target=ctx.bind(run), daemon=True).start()


def public(job) -> dict:
    """What the browser may see: no server paths, no owner id."""
    _thumb_later(job)
    out = {k: v for k, v in job.items() if k not in HIDDEN}
    out["source"] = {k: v for k, v in job["source"].items() if k != "path"}
    out["clips"] = [{k: v for k, v in c.items() if k not in ("src", "fixed_words", "fixed_for", "caption_words", "heard_words", "heard_for")} for c in job["clips"]]
    ai = job.get("ai") or {}
    out["ai"] = {"tokens": ai.get("tokens", 0), "note": ai.get("note", ""), "used": bool(ai.get("model"))}   # never the model, never raw errors
    try:
        out["can_more"] = can_find_more(job)
    except Exception:  # noqa: BLE001
        out["can_more"] = False
    if job.get("status") == "queued":
        n = _q.ahead().get(job["id"])
        if n:
            out["stage"] = (f"High demand right now: {n} video{'s' if n != 1 else ''} ahead of yours" if _q.held else
                            f"Waiting in line: {n} video{'s' if n != 1 else ''} ahead of yours")
        elif n == 0 and _q.held:
            out["stage"] = "High demand right now: yours is next"
    return out


def save(job):
    ctx.bump(job.get("user"))
    with _lock:
        d = Path(job["dir"])
        for _ in range(5):
            try:
                text = json.dumps(job, indent=1)
                break
            except RuntimeError:  # changed mid-dump by another thread
                time.sleep(0.05)
        else:
            return
        tmp = d / "job.json.tmp"
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(d / "job.json")


def _set(job, **kw):
    with _lock:
        job.update(kw)
    save(job)


def _remap(path, folder: Path):
    """Paths saved before data moved into per-user folders (or on another machine): find the file by name."""
    if path and not Path(path).exists():
        cand = folder / Path(str(path).replace("\\", "/")).name
        if cand.exists():
            return str(cand)
    return path


def _load_file(f: Path, uid: str):
    try:
        job = json.loads(f.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return
    job.update(dir=str(f.parent), user=uid)
    job.setdefault("kind", "video")
    job.setdefault("creator", None)
    job.pop("finding", None)            # "Find more clips" stopped by a restart: it can be pressed again
    job.pop("halting", None)
    if job.get("source_path"):
        job["source_path"] = _remap(job["source_path"], f.parent)
    if job.get("source", {}).get("path"):
        job["source"]["path"] = _remap(job["source"]["path"], f.parent)
    if job.get("status") in ("queued", "running") and job.get("kind") != "live":
        # Picked up again as soon as the server is back (jobs.start), from the last finished part of the transcript.
        job.update(status="queued", stage="Picking up where it stopped", error=None, resume=True)
    if job.get("status") == "live":
        job.update(status="done", stage="Recording paused by a server update", was_live=True)
    buffered = job.get("kind") == "live" and any((f.parent / "buffer").glob("*.ts"))
    for c in job.get("clips", []):
        if c.get("src"):
            c["src"] = _remap(c["src"], f.parent / "clips")
        if c.get("status") in ("rendering", "queued"):
            if buffered and not c.get("src"):
                c["status"] = "queued"  # the stream is still on disk: live.recover() finishes these
                job["recover"] = True
            elif job.get("resume"):
                c["status"] = "queued"  # the video is being picked up again: this clip is made then
            elif job.get("kind") != "live" and (f.parent / "words.json").is_file():
                c["status"] = "queued"  # a single clip being re-made: jobs.start() makes it again
                job.setdefault("remake", []).append(c["id"])
            else:
                c.update(status="error", error="Interrupted by a restart. Open it and press Save and re-make.")
    _jobs[job["id"]] = job
    _by_user.setdefault(uid, {})[job["id"]] = job


def load_user(uid: str):
    d = config.USERS_DIR / uid
    for f in list((d / "jobs").glob("*/job.json")) + list((d / "creators").glob("*/*/*/job.json")):
        _load_file(f, uid)


def load_all():
    for d in config.USERS_DIR.iterdir():
        if d.is_dir():
            load_user(d.name)


def all_jobs() -> list:
    """Every user's jobs. Only for background work; never send this to a browser."""
    with _lock:
        return list(_jobs.values())


def list_jobs():
    u = ctx.uid()
    with _lock:
        return sorted((dict(j) for j in _by_user.get(u, {}).values()), key=lambda j: -j["created"])


def get(jid):
    """The job, only if it belongs to whoever this code is running for."""
    job = _jobs.get(jid)
    return job if job and job["user"] == ctx.uid() else None


def busy_count() -> int:
    u = ctx.uid()
    return sum(1 for j in list(_by_user.get(u, {}).values()) if j["kind"] == "video" and j["status"] in ("queued", "running"))


def waiting_total() -> int:
    return sum(1 for j in list(_jobs.values()) if j["kind"] == "video" and j["status"] == "queued")


def queue_epoch() -> int:
    return _q.epoch


def running_now() -> int:
    return _q.running


def create(source: dict, options: dict, enqueue=True, creator=None, kind="video") -> dict:
    jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:10]
    c = creators.get(creator) if creator else None
    if c:
        d = creators.root(c["id"]) / ("live" if kind == "live" else "videos") / jid
        base = {**DEFAULTS, **{k: c[k] for k in ("max_clips", "min_len", "max_len", "style", "layout")}}
    else:
        d, base, creator = config.user_dir(ctx.uid()) / "jobs" / jid, dict(DEFAULTS), None
    d.mkdir(parents=True)
    opts = {**base, **clean_options(options)}
    if opts["min_len"] >= opts["max_len"]:
        opts["min_len"] = max(5, opts["max_len"] - 5)
    job = {"id": jid, "user": ctx.uid(), "kind": kind, "creator": creator, "dir": str(d), "created": time.time(), "source": source,
           "options": opts, "status": "queued", "stage": "Waiting", "progress": 0.0,
           "title": source.get("name", ""), "uploader": "", "duration": 0, "clips": [], "error": None, "ai": {}}
    with _lock:
        _jobs[jid] = job
        _by_user.setdefault(job["user"], {})[jid] = job
    save(job)
    if enqueue:
        _q.put(("job", jid, None), user=job["user"])
    return job


def enqueue(job):
    save(job)
    _q.put(("job", job["id"], None), user=job["user"])


_halt: dict = {}     # video id -> "pause" or "stop", asked for while it is being made; looked at between parts


def halt(job, how):
    """Pause or stop a video. Waiting in line: at once. Being made: at the next part of the transcript (about a
    minute), keeping every clip, transcript part and AI answer made so far. Finding more clips: stops after the
    part it is on. A paused video can be stopped too: it finishes with the clips it has."""
    st, jid = job.get("status"), job["id"]
    if st == "done" and job.get("finding"):
        _halt[jid] = "stop"
        _set(job, halting="stop")
    elif st == "queued":
        if how == "pause":
            _set(job, status="paused", stage="Paused before it started")
        else:
            _set(job, status="done", stage="Stopped before it started", progress=1.0)
    elif st == "running":
        _halt[jid] = how
        _set(job, halting=how)
    elif st == "paused" and how == "stop":
        job.pop("resume", None)
        _set(job, status="done", stage="Stopped by you", progress=1.0)
    else:
        raise ValueError("This video isn't being made right now.")


def resume(job):
    """A paused video carries on from where it stopped (its transcript parts, clips and AI answers are kept)."""
    if job.get("status") != "paused":
        raise ValueError("This video isn't paused.")
    job.pop("halting", None)
    job.update(status="queued", stage="Picking up where it stopped", resume=True)
    enqueue(job)


def submit(fn):
    """Run any heavy task (a render, a cleanup) on the single worker, in order."""
    _q.put(("fn", ctx.bind(fn), None))


def submit_live(fn):
    """Live-stream renders and cleanups: their own worker, so a long video can never hold them up."""
    _live_q.put(ctx.bind(fn))


def _live_worker():
    while True:
        fn = _live_q.get()
        try:
            fn()
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def delete(jid):
    with _lock:
        job = _jobs.pop(jid, None)
        if job:
            _by_user.get(job["user"], {}).pop(jid, None)
    if job:
        ctx.bump(job["user"])
        shutil.rmtree(job["dir"], ignore_errors=True)
    return bool(job)


def request_render(jid, cid, changes: dict, render_now: bool = True):
    """Keeps the editor's changes on the clip. With render_now the clip is made again with them; without, they are
    only saved (the clip's video stays as it was, marked as having changes that are not in it yet)."""
    job = _jobs[jid]
    clip = next(c for c in job["clips"] if c["id"] == cid)
    new = dict(clip)
    for k in ("start", "end"):
        if k in changes:
            new[k] = round(float(changes[k]), 2)
    if "src_offset" in clip:  # live clip: can only move inside the saved piece of stream
        new["start"] = max(new["start"], clip["src_offset"])
        new["end"] = min(new["end"], clip["src_end"])
    if not (math.isfinite(new["start"]) and math.isfinite(new["end"])) or new["start"] < 0:
        raise ValueError("Those times aren't valid.")
    shots = changes.get("shots") if "shots" in changes else clip.get("shots")
    if shots:                                 # several stretches joined: the clip spans them, the gaps are cut out
        shots = clean_shots(shots, new["start"], new["end"])
    if not 3 <= new["end"] - new["start"] <= (3600 if shots else 180):
        raise ValueError("A clip can be 3 to 180 seconds long.")
    for k in ("hook", "title", "description", "style", "layout"):
        if k in changes:
            new[k] = str(changes[k])[:{"hook": 60, "title": 100, "description": 2000}.get(k, 20)]
    if new.get("style") not in render.STYLES:
        new["style"] = DEFAULTS["style"]
    if new.get("layout") not in render.LAYOUTS:
        new["layout"] = DEFAULTS["layout"]
    if "look" in changes:                     # the editor's caption look; null goes back to the clip's style
        new["look"] = render.clean_look(changes["look"])
    if "captions" in changes:                 # caption words typed in the editor; null goes back to what was heard
        new["caption_words"] = clean_caption_words(changes["captions"])
    if "cuts" in changes:                     # parts taken out by Speech cleanup (and the gaps between shots)
        new["cuts"] = clean_cuts(changes["cuts"], new["start"], new["end"])
    if "shots" in changes:
        new["shots"] = shots or None
    kept = (new["end"] - new["start"]) - sum(b - a for a, b in new.get("cuts") or [])
    if kept > 180.5:
        raise ValueError("Together the shots are longer than 3 minutes. Make them shorter.")
    if not render_now:
        clip.update(new, unrendered=True)     # saved only: the video is made with these the next time it is rendered
        save(job)
        return
    clip.update(new, status="queued", unrendered=False)
    save(job)
    _q.put(("clip", jid, cid))


def clean_shots(shots, start, end) -> list | None:
    """The stretches of the video joined into this clip ([[from, to], ...]): in order, not overlapping, each at least
    half a second, inside the clip. One stretch is just a normal clip (None)."""
    if not isinstance(shots, list) or len(shots) > 20:
        raise ValueError("Those shots can't be used.")
    out = []
    for x in shots:
        if not isinstance(x, (list, tuple)) or len(x) != 2:
            raise ValueError("Those shots can't be used.")
        a, b = max(float(x[0]), start), min(float(x[1]), end)
        if math.isfinite(a) and math.isfinite(b) and b - a >= 0.5:
            out.append([round(a, 2), round(b, 2)])
    out.sort()
    for i in range(1, len(out)):
        if out[i][0] < out[i - 1][1]:
            raise ValueError("Two shots overlap. Move one so they don't.")
    return out if len(out) > 1 else None


def clean_cuts(cuts, start, end) -> list:
    """Stretches of the clip to leave out ([[from, to], ...] in seconds of the video): inside the clip, in order,
    joined where they touch, each at least a twentieth of a second. At least 3 seconds of the clip always stay."""
    if not cuts:
        return []
    if not isinstance(cuts, list) or len(cuts) > 500:
        raise ValueError("Those cuts can't be used.")
    out = []
    for c in cuts:
        if not isinstance(c, (list, tuple)) or len(c) != 2:
            raise ValueError("Those cuts can't be used.")
        a, b = max(float(c[0]), start), min(float(c[1]), end)
        if math.isfinite(a) and math.isfinite(b) and b - a >= 0.05:
            out.append([round(a, 2), round(b, 2)])
    out.sort()
    merged = []
    for a, b in out:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    if (end - start) - sum(b - a for a, b in merged) < 3:
        raise ValueError("That would cut almost the whole clip. Keep at least 3 seconds.")
    return merged


def clean_caption_words(words) -> list | None:
    """Caption words from the editor: [{"w": text, "s": start, "e": end}, ...] in seconds of the video, checked."""
    if words is None:
        return None
    if not isinstance(words, list) or len(words) > 3000:
        raise ValueError("Those captions can't be used.")
    out = []
    for w in words:
        if not isinstance(w, dict):
            raise ValueError("Those captions can't be used.")
        text = re.sub(r"\s+", " ", str(w.get("w", ""))).strip()[:40]
        s, e = float(w.get("s")), float(w.get("e"))
        if not text or not (math.isfinite(s) and math.isfinite(e)) or s < 0 or e < s:
            continue
        out.append({"w": text, "s": round(s, 2), "e": round(e, 2)})
    out.sort(key=lambda w: w["s"])
    return out


def caption_words(job, clip) -> tuple[list, bool]:
    """The words a clip's captions are made from, and whether they were typed in the editor."""
    if clip.get("caption_words") is not None:
        return clip["caption_words"], True
    if clip.get("fixed_words"):
        return roman.words(clip["fixed_words"]), False
    try:
        words = json.loads((Path(job["dir"]) / "words.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        words = []
    words = with_heard(clip, words)
    return roman.words([w for w in words if clip["start"] - 1 <= w["s"] <= clip["end"] + 1]), False


def with_heard(clip, words) -> list:
    """The video's words, with this clip's own transcript in place of them where it has one. A clip heard on its
    own (from its own audio, in long pieces) is more exact than a live stream's running transcript, which is made
    a few seconds at a time; outside that stretch (after a longer trim) the video's words are still used."""
    h, mine = clip.get("heard_for"), clip.get("heard_words")
    if not h or mine is None:
        return words
    return sorted([w for w in words if not h[0] <= w["s"] <= h[1]] + mine, key=lambda w: w["s"])


def clip_audio_words(src: Path, a: float, b: float, shift: float, lang: str = "") -> list:
    """Transcribe seconds a..b of a file on its own, with each word's time moved by `shift` (to the video's clock)."""
    wav = config.TMP_DIR / f"heard-{uuid.uuid4().hex[:10]}.wav"
    try:
        media.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.2f}", "-t", f"{b - a:.2f}", "-i", str(src), "-vn",
                   "-ac", "1", "-ar", "16000", "-af", "aresample=async=1:first_pts=0", "-c:a", "pcm_s16le", str(wav)])
        heard = transcribe.hear_clip(media.load_audio(wav), lang)
    finally:
        wav.unlink(missing_ok=True)
    return [dict(w, s=round(w["s"] + shift, 2), e=round(w["e"] + shift, 2)) for w in heard]


def retranscribe(job, clip) -> list:
    """Listen to just this clip again, from its own audio, and make its captions from what is heard now. The rest
    of the video is left alone. Words typed in the editor are replaced, since the person asked for a fresh hearing."""
    off = clip.get("src_offset", 0.0)
    src = Path(clip["src"]) if clip.get("src") else Path(job.get("source_path") or "")
    if not src.is_file():
        raise ValueError("This clip's video is no longer here, so it can't be listened to again.")
    end = clip.get("src_end") or job.get("duration") or clip["end"]
    a, b = max(off, clip["start"] - 3), min(end, clip["end"] + 3)       # a little either side, for later trims
    words = clip_audio_words(src, a - off, b - off, off, job.get("lang") or "")
    clip.update(heard_words=words, heard_for=[round(a, 2), round(b, 2)])
    for k in ("fixed_words", "fixed_for", "caption_words"):
        clip.pop(k, None)
    raw = [w for w in words if clip["start"] - 1 <= w["s"] <= clip["end"] + 1]
    try:                                    # tidied the same way a render does, so the editor shows the final words
        usage.set_context(job.get("creator"), job.get("title") or "")
        fixed = brain.english_captions(raw, job.get("lang") or "", job.get("title") or "",
                                       youtube_english=lambda: _english_part(job, clip))
        clip.update(fixed_words=fixed, fixed_for=[round(clip["start"], 2), round(clip["end"], 2), "en2"])
    except Exception:  # noqa: BLE001 - the words as heard are still better than before
        pass
    save(job)
    return words


def _source_watermark(job, clip):
    """A new clip, before its first render: a social watermark crediting where the video came from, the way clip pages
    do it ("Full video on" + the platform's icon + /channel). Only when the clip's look has no brand of its own and the
    option is on; the person can change or turn it off in the editor's Brand panel."""
    if clip.get("version", 0) or clip.get("wm_done") or not (job.get("options") or {}).get("watermark", False):
        return
    clip["wm_done"] = True
    look = dict(clip.get("look") or {k: v for k, v in render.PRESETS.get(clip.get("style"), render.PRESETS["studio"]).items() if k != "label"})
    if look.get("brand_on"):                       # their saved brand already puts something there
        return
    url = str((job.get("source") or {}).get("url") or "")
    plat = "youtube" if media.is_youtube(url) else "twitch" if "twitch.tv/" in url else "kick" if "kick.com/" in url else ""
    m = re.search(r"(?:twitch\.tv|kick\.com)/([A-Za-z0-9_]+)", url) or re.search(r"youtube\.com/(@[\w.\-]+)", url)
    name = (m.group(1) if m else "") or str(job.get("uploader") or job.get("creator_name") or "")
    handle = re.sub(r"[^a-z0-9_.]", "", name.lower().lstrip("@"))[:30]
    if not handle and not plat:                     # an uploaded file with no channel: nothing to credit
        return
    look.update(brand_on=True, brand_kind="social", brand_head="Full video on" if plat else "", brand_icon=plat or "none",
                brand_handle=("/" + handle) if handle else "", brand_tag_on=False, brand_font=look.get("brand_font") or "Inter",
                brand_color=look.get("brand_color") or "#FFFFFF", brand_size=look.get("brand_size") or 84, brand_pos=look.get("brand_pos") or "tr")
    clip["look"] = render.clean_look(look) or look


def _end_card(job, clip):
    """Every clip, on its next render: the "Made with SocialShot" end card (the SocialShot mark and
    socialshot.io), unless the clip already has an outro of its own. It can be changed or turned off in the
    editor (Media, Outro)."""
    if clip.get("end_done") or not (job.get("options") or {}).get("end_card", True):   # every clip, once (older ones too)
        return
    clip["end_done"] = True
    look = dict(clip.get("look") or {k: v for k, v in render.PRESETS.get(clip.get("style"), render.PRESETS["studio"]).items() if k != "label"})
    if (look.get("outro") or {}).get("on"):            # their saved brand already ends on something
        return
    look["outro"] = dict(render.MADE_WITH)
    clip["look"] = render.clean_look(look) or look


def _ai_edit(job, clip, words, src):
    """A new clip, before its first render: the AI editor adds music, zooms and sound effects (when it's on)."""
    if clip.get("auto_edited") or clip.get("version", 0) or not (job.get("options") or {}).get("ai_edit", False):
        return
    from . import autoedit
    try:
        db = json.loads((Path(job["dir"]) / "loudness.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        db = None
    try:
        usage.set_context(job.get("creator"), job.get("title") or "")
        p = autoedit.apply(clip, words, job.get("title") or "", db, src)
        clip["ai_note"] = autoedit.describe(p)
    except Exception:  # noqa: BLE001 - the clip is still made, just without the extra edit
        clip["auto_edited"] = "failed"


def render_one(job, clip, words):
    d = Path(job["dir"])
    clip["status"] = "rendering"
    save(job)
    try:
        _source_watermark(job, clip)
        _end_card(job, clip)
        _ai_edit(job, clip, words, Path(clip["src"]) if clip.get("src") else Path(job.get("source_path") or "") if job.get("source_path") else None)
        words = with_heard(clip, words)
        off = clip.get("src_offset", 0.0)
        src = Path(clip["src"]) if clip.get("src") else Path(job["source_path"])
        if not clip.get("src"):
            clip["end"] = min(clip["end"], job["duration"])
        local = dict(clip, start=clip["start"] - off, end=clip["end"] - off, hook=roman.to_roman(clip.get("hook") or ""),
                     cuts=[[a - off, b - off] for a, b in clip.get("cuts") or []])
        span = [round(clip["start"], 2), round(clip["end"], 2), "en2"]      # "en2": captions made always-English
        if clip.get("caption_words") is not None:
            raw = clip["caption_words"]       # typed in the editor: drawn exactly as written
        elif clip.get("fixed_for") == span and clip.get("fixed_words") and not any(
                roman.needs_roman(w.get("w", "")) for w in clip["fixed_words"]):
            raw = clip["fixed_words"]          # already tidied for this exact span: no second AI call
        else:
            raw = [w for w in words if clip["start"] - 1 <= w["s"] <= clip["end"] + 1]
            try:
                usage.set_context(job.get("creator"), job.get("title") or "")
                raw = brain.english_captions(raw, job.get("lang") or "", job.get("title") or "",
                                             youtube_english=lambda: _english_part(job, clip))
                clip.update(fixed_words=raw, fixed_for=span)
            except Exception:  # noqa: BLE001 - captions still render with the words as heard
                pass
        # the last word on it: whatever was said, nothing is drawn in Hindi or Urdu script
        typed = clip.get("caption_words") is not None
        near = [dict(w, s=w["s"] - off, e=w["e"] - off) for w in (raw if typed else roman.words(raw))]
        logo = render.brand_logo_path(job.get("user") or ctx.uid())
        local["logo_path"] = str(logo) if logo.is_file() else ""
        local["card_name"] = str(job.get("uploader") or job.get("creator_name") or "")[:40]   # the post card's name when none is typed
        local["media_dir"] = str(config.user_dir(job.get("user") or ctx.uid()) / "media")    # pictures and the outro file
        mid = render.clean_music((clip.get("look") or {}).get("music"))["id"]     # background music from the owner's library
        local["music_path"] = str(render.music_path(job.get("user") or ctx.uid(), mid)) if mid else ""
        # split face cam with no box placed yet: find the streamer's face cam once, and keep it on the clip
        if clip.get("layout") in ("split", "pip", "pop") and not (clip.get("look") or {}).get("split") and "auto_split" not in clip:
            try:
                from . import facecam
                cam = facecam.find(src, local["start"], local["end"])
            except Exception:  # noqa: BLE001 - no face found is fine: the usual box is used
                cam = None
            clip["auto_split"] = dict(render.SPLIT_DEFAULT, cam=cam) if cam else None
            local["auto_split"] = clip["auto_split"]
        out = render.render_clip(src, d / "clips", clip["id"], local, near, job["width"], job["height"])
        clip.update(out, status="done", version=clip.get("version", 0) + 1, error=None)
        post = {k: clip[k] for k in ("title", "description", "hashtags", "hook", "start", "end", "score")}
        (d / "clips" / f"{clip['id']}.json").write_text(json.dumps(post, indent=1), encoding="utf-8")
        if clip["version"] == 1:
            clip.setdefault("made_at", time.time())
            creators.log(job["creator"], f"Clip ready (score {clip['score']}): {clip['title'] or clip['hook']}")
            save(job)
            for fn in on_clip_ready:
                try:
                    fn(job, clip)
                except Exception:  # noqa: BLE001
                    traceback.print_exc()
    except Exception as e:  # noqa: BLE001
        clip.update(status="error", error=safe.friendly(e, 400))
        creators.log(job["creator"], f"Clip failed: {safe.friendly(e, 200)}")
    save(job)


def brand_look(uid):
    """The look new clips start with: the brand look chosen for new clips in the editor's Brand kit (the first one
    saved when none is chosen). None when there is no brand look, or "none" was chosen: the clip's style decides."""
    try:
        b = json.loads((config.user_dir(uid or ctx.uid()) / "brand.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    styles = [s for s in b.get("styles") or [] if isinstance(s, dict) and isinstance(s.get("look"), dict)]
    want = b.get("default")
    if want == "":
        return None
    pick = next((s for s in styles if s.get("name") == want), None) if want else None
    pick = pick or (styles[0] if styles else None)
    return render.clean_look(pick["look"]) if pick else None


def new_clip_setup(uid):
    """What a new clip is made with. A template turned on in Options wins: its layout and the whole look
    (captions, hook, frame, card, brand). Otherwise the layout stays the one picked in Options (None here)
    and the look is the brand look, when one is chosen."""
    try:
        b = json.loads((config.user_dir(uid or ctx.uid()) / "brand.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        b = {}
    tid = b.get("template") if isinstance(b.get("template"), str) else ""
    raw = next((t for t in b.get("templates") or [] if isinstance(t, dict) and t.get("id") == tid), None) if tid else None
    if raw:
        look = render.clean_look(raw.get("look") if isinstance(raw.get("look"), dict) else None)
        if look:
            layout = raw.get("layout") if raw.get("layout") in render.LAYOUTS else "blur"
            return layout, look
    return None, brand_look(uid)


def _next_id(job) -> str:
    nums = [int(m.group(1)) for c in job["clips"] for m in [re.match(r"clip(\d+)$", c.get("id", ""))] if m]
    return f"clip{(max(nums) if nums else 0) + 1:02d}"


def _overlap(a, b, clips, gap=4.0) -> bool:
    return any(a < c["end"] + gap and b > c["start"] - gap for c in clips)


def more_clips(job, n, changes=None):
    """Find `n` more clips in a video (or a live recording) that is already done, next to the ones it has.
    Reads the saved transcript (and writes the part not written yet, when the first pass stopped early); the AI picks
    the best moments it has not used. `changes`: new settings for these clips (length, captions, layout, quality,
    AI editor, watermark), kept on the video for next time."""
    d = Path(job["dir"])
    if changes:
        job["options"] = {**job["options"], **clean_options(changes)}
        if job["options"]["min_len"] >= job["options"]["max_len"]:
            job["options"]["max_len"] = job["options"]["min_len"] + 10
        save(job)
    o = job["options"]
    try:
        words = json.loads((d / "words.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        words = []
    if len(words) < 20:
        raise RuntimeError("This video has no transcript to look through.")
    job.pop("more_error", None)
    usage.set_context(job.get("creator"), job.get("title") or "")
    dur = float(job.get("duration") or words[-1]["e"])
    src_path = Path(job.get("source_path") or "")
    recording = job.get("kind") == "live"
    from_vod = recording and not src_path.is_file()      # an older recording: cut from the stream's saved copy
    audio = None
    try:
        db = json.loads((d / "loudness.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        db = None
    upto = job.get("transcribed_to")
    end_s = float(o.get("range_end") or dur)
    rest = upto is not None and not recording and float(upto) < end_s - 5      # a transcript the first pass left short
    need_audio = (not recording and job["source"].get("type") == "url" and not src_path.is_file()) or rest
    if db is None and from_vod:
        db = [-30.0] * (int(dur) + 2)       # the recording's loudness is gone: the AI goes by the words alone
    if db is None or need_audio:
        _set(job, finding="Getting the audio")
        if src_path.is_file():
            f = src_path
        elif job["source"].get("type") == "url":
            f = media.download_audio(job["source"]["url"], d, lambda p: None)
        else:
            raise RuntimeError("The video file is no longer here, so no more clips can be made from it.")
        wav = d / "audio.wav"
        media.extract_audio(f, wav)
        audio = media.load_audio(wav)
        wav.unlink(missing_ok=True)
        if f != src_path:
            f.unlink(missing_ok=True)
        db = [round(float(x), 1) for x in media.loudness_per_second(audio)]
        (d / "loudness.json").write_text(json.dumps(db), encoding="utf-8")
    if rest and audio is not None:        # the rest of the transcript, a part at a time, kept as it goes
        x, end = int(float(upto) * 16000), min(len(audio), int(end_s * 16000))
        step = BLOCK * 16000
        while x < end:
            if _halt.get(job["id"]):
                break
            y = min(end, x + step)
            _set(job, finding=f"Writing the rest of the transcript (minute {round(x / 16000 / 60)} of {round(end / 16000 / 60)})")
            sh = x / 16000
            words += [dict(w, s=round(w["s"] + sh, 2), e=round(w["e"] + sh, 2)) for w in transcribe.transcribe(audio[x:y])]
            words.sort(key=lambda w: w["s"])
            (d / "words.json").write_text(json.dumps(words), encoding="utf-8")
            job["transcribed_to"] = round(y / 16000, 2)
            save(job)
            x = y
        if x >= end:
            job.pop("transcribed_to", None)
        save(job)
    import numpy as np
    db = np.array(db, dtype=np.float32)
    have = [c for c in job["clips"] if c.get("status") != "error"]
    found = []
    blocks = [(t, min(dur, t + BLOCK)) for t in range(0, int(dur) + 1, BLOCK)] or [(0, dur)]
    # the parts with the fewest clips are read first, so new clips spread over the whole video
    blocks.sort(key=lambda ab: sum(1 for c in have if ab[0] <= c["start"] < ab[1]))
    for bi, (a, b) in enumerate(blocks):
        if len(found) >= n or _halt.get(job["id"]):
            break
        bw = [dict(w, s=round(w["s"] - a, 2), e=round(w["e"] - a, 2)) for w in words if a <= w["s"] < b]
        if len(bw) < 8:
            continue
        _set(job, finding=f"Finding more clips (part {bi + 1} of {len(blocks)})")
        inside = sum(1 for c in have if a <= c["start"] < b)
        quota = min(6, max(1, math.ceil((n - len(found)) / max(1, len(blocks) - bi))) + inside)
        got, ai = brain.find_clips(bw, db[int(a): int(b) + 1], b - a, job.get("title") or "", job.get("uploader") or "",
                                   quota, int(o["min_len"]), int(o["max_len"]), lambda *_: None, None)
        for c in sorted(got, key=lambda c: -c.get("score", 0)):
            s, e = round(c["start"] + a, 2), round(c["end"] + a, 2)
            if len(found) >= n or _overlap(s, e, have + found):
                continue
            c.update(start=s, end=e)
            found.append(c)
    if not found:
        _halt.pop(job["id"], None)
        job.pop("finding", None)
        job.pop("halting", None)
        save(job)
        return 0
    lay, look = new_clip_setup(job.get("user"))
    for c in found:
        c.update(id=_next_id(job), style=_style_for(job, o), layout=lay or o["layout"], status="queued", version=0, made_at=time.time(), more=True)
        if look:
            c["look"] = dict(look)
        job["clips"].append(c)
    _set(job, finding=f"Making {len(found)} more clip{'s' if len(found) != 1 else ''}")
    for c in found:
        if from_vod:
            from . import live
            live.cut_from_vod(job, c, words)
        elif recording:
            from . import live
            live.cut_from_recording(job, c, words)
        elif job["source"].get("type") == "url" and not src_path.is_file():
            _fetch_piece(job, c, audio)
        if c["status"] != "error":
            render_one(job, c, words)
    _halt.pop(job["id"], None)
    job.pop("finding", None)
    job.pop("halting", None)
    save(job)
    try:
        from . import notices
        ok = sum(1 for c in found if c.get("status") == "done")
        notices.add(job.get("user"), "clips", f"{ok} more clip{'s' if ok != 1 else ''} ready", job.get("title") or "your video",
                    f"/app/creators/{job['creator']}" if job.get("creator") else "/app/videos")
    except Exception:  # noqa: BLE001
        pass
    return len(found)


def can_find_more(job) -> bool:
    """Is there what "Find more clips" needs: the transcript, and the video (its file, its link, or the recording)?"""
    d = Path(job["dir"])
    if job.get("status") not in ("done",) or job.get("finding") or not (d / "words.json").is_file():
        return False
    if job.get("kind") == "live":         # its kept recording, or (older ones) the stream's saved copy on the site
        return Path(job.get("source_path") or "").is_file() or bool(job.get("vod")) or \
            media.is_youtube(job["source"].get("url") or "") or "twitch.tv/" in (job["source"].get("url") or "")
    return Path(job.get("source_path") or "").is_file() or job["source"].get("type") == "url"


CLIP_MINUTES = float(config.env("PEAKCUT_CLIP_MINUTES", "15"))     # the longest one clip may take to make


def _wait_for_clips(job, futures, began, workers):
    """Wait for a video's clips, but not for ever. A clip that hangs (a download that stalls, an encoder that
    freezes) used to keep the whole video "in progress", and no other clip could be re-made. Now it is marked as
    failed after CLIP_MINUTES and the video finishes with the clips that did work."""
    left, given_up = list(futures), 0
    late = "This clip took too long and was stopped. Open it and press Save and re-make to try again."
    while left:
        still = []
        for f, clip in left:
            if f.done():
                f.result()
                continue
            t = began.get(clip["id"])
            if (t and time.time() - t > CLIP_MINUTES * 60) or (not t and given_up >= workers):
                given_up += 1
                clip.update(status="error", error=late)
                creators.log(job["creator"], f"Clip stopped after {CLIP_MINUTES:g} minutes: {clip.get('title') or clip.get('hook') or clip['id']}")
                save(job)
                continue
            still.append((f, clip))
        left = still
        if left:
            time.sleep(1)


def _english_part(job, clip):
    """YouTube's English captions for just this clip, for a video in another language. Fetched once per video."""
    if (job.get("source") or {}).get("type") != "url":
        return None
    f = Path(job["dir"]) / "words_en.json"
    if f.is_file():
        en = json.loads(f.read_text(encoding="utf-8"))
    else:
        try:
            en = media.youtube_english_words(job["source"]["url"]) or []
        except Exception:  # noqa: BLE001 - YouTube often refuses its translations: the AI translates instead
            en = []
        f.write_text(json.dumps(en), encoding="utf-8")       # asked once per video, refused or not
    return [w for w in en if clip["start"] - 0.5 <= w["s"] <= clip["end"] + 0.5]


LONG_VIDEO = 40 * 60   # above this, fetch only the pieces that become clips
PAD = 8                # seconds kept either side of a fetched piece, so clips can be re-trimmed


def _fetch_piece(job, clip, full_audio):
    """Long videos: download just this clip's stretch and pin down exactly where it starts."""
    d = Path(job["dir"])
    o = job["options"]
    try:
        want = max(0.0, clip["start"] - PAD)
        piece = media.download_section(job["source"]["url"], d / "clips", f"{clip['id']}.src", want,
                                       min(job["duration"], clip["end"] + PAD), max(1080, int(o["quality"])))
        wav = d / "clips" / f"{clip['id']}.wav"
        media.extract_audio(piece, wav)
        part = media.load_audio(wav)
        wav.unlink(missing_ok=True)
        meta = media.probe(piece)
        off = media.find_offset(full_audio, part, want)
        clip.update(src=str(piece), src_offset=round(off, 2), src_end=round(off + meta["duration"], 2))
        clip["start"], clip["end"] = max(clip["start"], clip["src_offset"]), min(clip["end"], clip["src_end"])
        job.setdefault("width", meta["width"])
        job.setdefault("height", meta["height"])
    except Exception as e:  # noqa: BLE001
        clip.update(status="error", error=f"Could not fetch this part of the video: {safe.friendly(e, 250)}")


BLOCK = 10 * 60         # long videos are transcribed and clipped one block at a time
PROGRESSIVE_FROM = 8 * 60      # longer than this: transcribed and clipped part by part, so clips come sooner
FIRST_BLOCK = 4 * 60           # the first part is short: the first clips are being made a minute or two in


def _covers(words: list, start: float, end: float) -> bool:
    """Is a borrowed transcript good enough to find clips with? It has to reach the end of the part being clipped
    and have a normal amount of talking in it; otherwise our own model writes the transcript."""
    inside = [w for w in words if start <= w["s"] <= end]
    minutes = max(0.5, (end - start) / 60)
    return len(inside) >= 25 * minutes and inside[-1]["s"] >= start + 0.85 * (end - start)


def _run_job(job):
    import math
    from concurrent.futures import ThreadPoolExecutor
    d = Path(job["dir"])
    o = job["options"]
    src = job["source"]
    t0 = time.time()
    notes = []
    usage.set_context(job["creator"], job["title"] or src.get("name"))
    resuming = bool(job.pop("resume", False)) and (d / "words.json").is_file()
    job.pop("transcribed_to", None)       # carrying on: the transcript is written to the end again
    job.pop("halting", None)
    _halt.pop(job["id"], None)
    if resuming:   # after a restart: keep the transcript parts, clips and AI answers already made, and carry on
        _set(job, status="running", stage="Picking up where it stopped", error=None)
    else:
        _set(job, status="running", stage="Getting the audio", progress=0.03, error=None, clips=[], ai={}, done_blocks=0)
    if not transcribe.model_ready() and not transcribe.REMOTE:
        from . import fetch_model
        _set(job, stage="Getting the speech model (one time, about 480 MB)")
        fetch_model.ensure()
        _set(job, stage="Getting the audio")
    fetch = ThreadPoolExecutor(1)
    video = None
    yt_chat = None
    if src["type"] == "url":
        meta = media.info(src["url"])
        if meta["kind"] != "video":
            raise RuntimeError("That link is a channel or playlist, not a single video. Paste the link of one video.")
        if ((o["range_end"] or meta["duration"]) - (o["range_start"] or 0)) > config.MAX_VIDEO_HOURS * 3600:
            raise RuntimeError(f"That is longer than {config.MAX_VIDEO_HOURS:g} hours. Choose a shorter part of it under Options.")
        if meta["is_live"]:
            raise RuntimeError("This link is a live stream, so it would never finish downloading. Open the creator, "
                               "put this link under Setup, and press Start recording instead.")
        _set(job, title=meta["title"], uploader=meta["uploader"], duration=meta["duration"],
             gaming=bool(meta.get("gaming") or meta.get("was_live")))
        if not job.get("thumb") and media.save_thumb(d, url=src["url"]):
            _set(job, thumb=True)
        usage.set_context(job["creator"], meta["title"])
        span = (o["range_end"] or meta["duration"]) - (o["range_start"] or 0)
        pieces = span > LONG_VIDEO or meta["duration"] <= 0
        if not pieces:  # shorter video: fetch all of it in the background while the audio is worked on
            video = fetch.submit(media.download, src["url"], d, int(o["quality"]))
        if o.get("use_chat", True) and not chat.load(d) and chat.has_chat(src["url"]):
            yt_chat = _CHATS[job["id"]] = chat.YouTubeChat(src["url"], d)   # a past live stream's chat, fetched alongside
        audio_file = media.download_audio(src["url"], d, lambda p: _set(job, progress=0.03 + 0.1 * p))
    else:
        pieces, audio_file = False, Path(src["path"])
        info = media.probe(audio_file)
        if info["duration"] > config.MAX_VIDEO_HOURS * 3600:
            raise RuntimeError(f"That video is longer than {config.MAX_VIDEO_HOURS:g} hours, which is the limit.")
        _set(job, source_path=str(audio_file), width=info["width"], height=info["height"], duration=info["duration"])
        if not job.get("thumb") and media.save_thumb(d, video=audio_file):
            _set(job, thumb=True)
    wav = d / "audio.wav"
    media.extract_audio(audio_file, wav)
    audio = media.load_audio(wav)
    wav.unlink(missing_ok=True)
    if src["type"] == "url":
        audio_file.unlink(missing_ok=True)
    if not job["duration"]:
        job["duration"] = len(audio) / 16000
    lo = int((o["range_start"] or 0) * 16000)
    hi = min(len(audio), int(o["range_end"] * 16000)) if o["range_end"] else len(audio)
    span = (hi - lo) / 16000
    db = media.loudness_per_second(audio[lo:hi])
    try:
        (d / "loudness.json").write_text(json.dumps([round(float(x), 1) for x in media.loudness_per_second(audio)]), encoding="utf-8")
    except Exception:  # noqa: BLE001 - only needed for "Find more clips"
        pass

    vlock, vstate = threading.Lock(), {}

    def whole_video():
        """Wait for the background download once; retry it, or give up and use pieces."""
        with vlock:
            if "path" not in vstate:
                path = None
                try:
                    path = video.result()
                except Exception as e:  # noqa: BLE001 - sites sometimes refuse a download
                    notes.append(f"Video download refused once ({str(e)[-80:]}), retrying")
                    try:
                        path = media.download(src["url"], d, int(o["quality"]))
                    except Exception as e2:  # noqa: BLE001
                        notes.append(f"Whole-video download failed ({str(e2)[-80:]}), fetching clip parts instead")
                if path:
                    info = media.probe(path)
                    job.update(source_path=str(path), width=info["width"], height=info["height"])
                vstate["path"] = path
            return vstate["path"]

    exact = {}      # clip id -> (from, to, words): our own model's words for just that clip

    began = {}      # clip id -> when work on it started

    def make(clip, words_now):
        began[clip["id"]] = time.time()
        if src["type"] == "url" and (pieces or not whole_video()):
            _fetch_piece(job, clip, audio)
        if clip["status"] != "error" and yt and yt[1].lower().startswith("en"):
            # The clip was found with YouTube's transcript. What is shown on screen comes from our own model,
            # run on just this clip: full punctuation, nothing blanked out, timings to the word.
            a0, b0 = max(lo, int((clip["start"] - 1.5) * 16000)), min(hi, int((clip["end"] + 1.5) * 16000))
            try:
                tw = [dict(w, s=round(w["s"] + a0 / 16000, 2), e=round(w["e"] + a0 / 16000, 2)) for w in transcribe.transcribe(audio[a0:b0])]
            except Exception:  # noqa: BLE001 - the clip is still made, with YouTube's words
                tw = []
            if len(tw) >= 3:
                exact[clip["id"]] = (a0 / 16000, b0 / 16000, tw)
                words_now = tw
        if clip["status"] != "error":
            render_one(job, clip, words_now)

    cpus = os.cpu_count() or 4
    # Clips made at once: a render's drawing step uses only part of the processor, so a few side by side finish
    # sooner (measured on 12 threads: 3 at once in 44 s, one after another in 69 s).
    renders = ThreadPoolExecutor(2 if cpus < 8 else min(6, cpus // 4))
    futures = []
    # a job picked up again after a restart keeps the parts it was started with (it may predate the short first part)
    old = resuming and "first_block" not in job
    step = BLOCK * 16000 if span > (20 * 60 if old else PROGRESSIVE_FROM) else hi - lo
    first = step if old or span <= PROGRESSIVE_FROM else FIRST_BLOCK * 16000
    job.setdefault("first_block", 0 if old else FIRST_BLOCK)
    blocks = [(lo, min(hi, lo + first))] + [(x, min(hi, x + step)) for x in range(lo + first, hi, step)] if hi > lo else [(lo, hi)]
    words, tokens, model = [], 0, None
    done_blocks = 0
    yt = None
    if src["type"] == "url" and config.YT_TRANSCRIPT and media.is_youtube(src["url"]):
        try:
            yt = media.youtube_words(src["url"])
        except Exception:  # noqa: BLE001 - no transcript to borrow: ours is written as usual
            yt = None
        if yt and not _covers(yt[0], lo / 16000, hi / 16000):
            yt = None
        job["transcript_from"] = "youtube" if yt else "own"
        job["lang"] = yt[1] if yt else ""          # the language spoken, when YouTube says (decides the captions)
    if resuming:
        try:
            words = json.loads((d / "words.json").read_text(encoding="utf-8"))
        except ValueError:
            words = []
        done_blocks = min(int(job.get("done_blocks", 0)), len(blocks)) if words else 0
        tokens, model = int((job.get("ai") or {}).get("tokens", 0)), (job.get("ai") or {}).get("model")
        if done_blocks < len(blocks):     # words past the last finished part are transcribed again
            cut = blocks[done_blocks][0] / 16000
            words = [w for w in words if w["s"] < cut]
        for c in job["clips"]:            # clips found before the restart that were not finished yet
            if c.get("status") not in ("done", "error"):
                c["status"] = "queued"
                futures.append((renders.submit(ctx.bind(make), c, list(words)), c))
        save(job)
    # The transcript of the next part is written while the AI is still reading this one (the AI is a wait on the
    # network, the transcript is work on this machine), so neither waits for the other.
    ahead = ThreadPoolExecutor(2, thread_name_prefix="ahead")
    heard, now_on = {}, [done_blocks]

    def hear(i):
        if i < len(blocks) and i >= done_blocks and i not in heard:
            a_, b_ = blocks[i]
            last = [0.0]

            def tp(p, i=i, a_=a_, b_=b_):
                if now_on[0] == i and p - last[0] > 0.05:      # only the part being shown moves the bar
                    last[0] = p
                    at = ((a_ - lo) + p * (b_ - a_)) / 16000
                    more = {"stage": f"Writing the transcript (minute {int(at // 60)} of {round(span / 60)})"} \
                        if len(blocks) > 1 and job.get("stage", "").startswith("Writing") else {}
                    _set(job, progress=max(job["progress"], 0.14 + 0.78 * at * 16000 / max(1, hi - lo)), **more)
            heard[i] = ahead.submit(ctx.bind(transcribe.transcribe), audio[a_:b_], tp)

    def chat_spikes(until):
        """The chat's spikes so far ([(second in the video, messages)]), or None if there is no chat to read.
        A YouTube chat still downloading is waited for (a little) to reach the part being looked at."""
        if not o.get("use_chat", True):
            return None
        if yt_chat:
            if not yt_chat.done:
                _set(job, stage="Reading the chat")
            counts, covered = yt_chat.now(need_until=until + chat.AROUND, wait=90)
            src_name = "youtube"
        else:
            got = chat.load(d)            # a TwitchDownloader chat file, sent by the page right after the video
            if not got:
                return None
            counts, covered, src_name = got["counts"], got["covered"], got["from"]
        if not sum(counts):
            return None
        spk = chat.spikes(counts, covered)
        job["chat"] = {"from": src_name, "messages": sum(counts[:covered]), "spikes": len(spk),
                       "top": sorted(spk, key=lambda x: -x[1])[:20]}
        return spk

    for bi, (a, b) in enumerate(blocks):
        if bi < done_blocks:
            continue                      # transcribed and checked by the AI before the restart
        if _halt.get(job["id"]):             # Pause or Stop pressed: keep what is made, stop here
            job["transcribed_to"] = round(a / 16000, 2)
            save(job)
            break
        if not yt and len(job["clips"]) >= int(o["max_clips"]):
            # Every clip asked for is made: the rest of a long video is not transcribed now (for a 10-hour stream
            # that is most of the wait). "More clips" writes the rest first, when it is wanted.
            job["transcribed_to"] = round(a / 16000, 2)
            save(job)
            break
        shift = a / 16000
        where = f" (minute {round((a - lo) / 16000 / 60)} of {round(span / 60)})" if len(blocks) > 1 else ""
        if yt:
            _set(job, stage="Reading the transcript" + where)
            bw = [dict(w, s=round(w["s"] - shift, 2), e=round(w["e"] - shift, 2)) for w in yt[0] if a / 16000 <= w["s"] < b / 16000]
        else:
            _set(job, stage="Writing the transcript" + where)
            now_on[0] = bi
            hear(bi)
            bw = heard.pop(bi).result()      # this part alone first, with the whole processor: its clips come sooner
            hear(bi + 1)                     # the next part is written while the AI reads this one
        _set(job, progress=max(job["progress"], 0.14 + 0.78 * (b - lo) / max(1, hi - lo)))
        words += [dict(w, s=round(w["s"] + shift, 2), e=round(w["e"] + shift, 2)) for w in bw]
        (d / "words.json").write_text(json.dumps(words), encoding="utf-8")
        _set(job, stage="Finding the best moments" + where, word_count=len(words))
        left = int(o["max_clips"]) - len(job["clips"])
        if left <= 0 or len(bw) < 8:
            job["done_blocks"] = bi + 1
            save(job)
            continue
        quota = max(1, math.ceil(left / (len(blocks) - bi)))
        s0 = int((a - lo) / 16000)
        spk = chat_spikes(b / 16000)
        a_s, b_s = a / 16000, b / 16000
        here = [(t - a_s, c) for t, c in spk if a_s <= t < b_s] if spk else None
        found, ai = brain.find_clips(bw, db[s0: s0 + int((b - a) / 16000) + 1], (b - a) / 16000, job["title"],
                                     job["uploader"], quota, int(o["min_len"]), int(o["max_len"]), notes.append, here)
        tokens += ai.get("tokens", 0)
        model = ai.get("model") or model
        if ai.get("note"):
            notes.append(ai["note"])
        lay, look = new_clip_setup(job.get("user"))
        for c in found:
            c.update(id=f"clip{len(job['clips']) + 1:02d}", start=round(c["start"] + shift, 2),
                     end=round(c["end"] + shift, 2), style=_style_for(job, o), layout=lay or o["layout"], status="queued", version=0)
            if look:
                c["look"] = dict(look)
            job["clips"].append(c)
            futures.append((renders.submit(ctx.bind(make), c, list(words)), c))
        job["ai"] = {"model": model, "tokens": tokens, "note": "", "log": notes[-5:]}
        job["done_blocks"] = bi + 1       # a restart from here on carries on with the next part
        save(job)
    if futures:
        _set(job, stage="Finishing the clips", progress=max(job["progress"], 0.92))
    _wait_for_clips(job, futures, began, renders._max_workers)
    if exact:           # keep our own words for the clips in the saved transcript, so editing a clip later uses them
        for a_s, b_s, tw in exact.values():
            words = [w for w in words if not a_s <= w["s"] < b_s] + tw
        words.sort(key=lambda w: w["s"])
        (d / "words.json").write_text(json.dumps(words), encoding="utf-8")
    renders.shutdown(wait=False)
    ahead.shutdown(wait=False)
    fetch.shutdown(wait=False)
    if yt_chat:                 # keep the chat's counts (for the editor), drop the raw download
        got = yt_chat.finish()
        if got:
            spk = chat.spikes(got["counts"])
            job["chat"] = {"from": "youtube", "messages": got["messages"], "spikes": len(spk), "top": sorted(spk, key=lambda x: -x[1])[:20]}
    del audio
    clips = job["clips"]
    job["ai"] = {"model": model, "tokens": tokens, "log": notes[-5:],
                 "note": "The AI was unavailable, so clips were picked by loudness only." if clips and not model else ""}
    how = _halt.pop(job["id"], None)
    job.pop("halting", None)
    if how == "pause":                    # Resume carries on from the next part
        where = f" at minute {round((job.get('transcribed_to') or 0) / 60)}" if job.get("transcribed_to") else ""
        _set(job, status="paused", stage=f"Paused{where}", took=round(time.time() - t0))
        creators.log(job["creator"], f"Video paused{where} with {len(clips)} clips: {job['title']}")
        return
    stage = ("Stopped by you" if how == "stop" else "Done") if clips else ("Stopped by you" if how == "stop" else "Done, but nothing clip-worthy was found")
    _set(job, status="done", stage=stage, progress=1.0, took=round(time.time() - t0))
    try:
        from . import notices
        name = job.get("title") or job["source"].get("name") or "your video"
        notices.add(job.get("user"), "clips", f"{len(clips)} clip{'s' if len(clips) != 1 else ''} ready" if clips else "Nothing clip-worthy found",
                    name, f"/app/creators/{job['creator']}" if job.get("creator") else "/app/videos")
    except Exception:  # noqa: BLE001
        pass
    creators.log(job["creator"], f"Video finished with {len(clips)} clips in {round(time.time() - t0)}s: {job['title']}")


def _worker(quick_only=False):
    while True:
        kind, a, cid = _q.get(quick_only)
        if kind == "fn":
            try:
                a()
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            continue
        job = _jobs.get(a)
        if not job:
            if kind == "job":
                _q.done()
            continue
        if kind == "job" and job.get("status") != "queued":     # paused or stopped while it waited in line
            _q.done()
            continue
        token = ctx._uid.set(job["user"])  # everything this job does runs as its owner
        try:
            if kind == "job":
                _run_job(job)
            else:
                words = json.loads((Path(job["dir"]) / "words.json").read_text(encoding="utf-8"))
                clip = next(c for c in job["clips"] if c["id"] == cid)
                render_one(job, clip, words)
        except Exception as e:  # noqa: BLE001
            (Path(job["dir"]) / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
            if kind == "job":
                for c in job["clips"]:
                    if c.get("status") in ("queued", "rendering"):
                        c.update(status="error", error="The video stopped before this clip was made.")
                _set(job, status="error", error=safe.friendly(e), stage="Stopped")
                creators.log(job["creator"], f"Video failed: {safe.friendly(e)[:200]}")
        finally:
            ctx._uid.reset(token)
            left = _CHATS.pop(a, None) if kind == "job" else None
            if left:
                left.stop()                # a video that stopped early does not leave its chat download running
            if kind == "job":
                _q.done()


def _pick_up_after_restart():
    """Videos and single clips that were being made when the server stopped: queued again, oldest first."""
    waiting = sorted((j for j in all_jobs() if j.get("status") == "queued" and j.get("resume")), key=lambda j: j["created"])
    for j in waiting:
        _q.put(("job", j["id"], None), user=j["user"])
    for j in all_jobs():
        for cid in j.pop("remake", []):
            _q.put(("clip", j["id"], cid))
        if j.get("status") == "done":
            save(j)


def start():
    load.start()
    load_all()
    _pick_up_after_restart()
    for _ in range(max(1, config.JOB_WORKERS)):
        threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=_worker, args=(True,), daemon=True).start()   # re-making a single clip never waits behind whole videos
    threading.Thread(target=_live_worker, daemon=True).start()
