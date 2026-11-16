"""Chat spikes: when something crazy happens on stream, chat explodes within seconds. The busier the chat, the
bigger the moment, so the chat's activity is a clip finder of its own.

A video's chat is kept as one number per second: how many messages arrived in it. It comes from:
  - a chat file made with TwitchDownloader (chat.json), which the page reads and turns into those counts, so the
    file itself and the messages in it never leave the person's computer;
  - YouTube, for the replay of a past live stream, fetched with yt-dlp while the video is being worked on.

A spike is a 10-second stretch with at least 3 times the usual number of messages, where "usual" is the average
of the ten minutes on each side (a stream's chat grows and shrinks over hours). Spikes are at least 60 seconds
apart. Chat reacts after the moment, not before: people watch, laugh, then type, which takes 5 to 15 seconds. So
the moment itself is the 20 seconds before a spike, and that is where a clip should start."""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

WINDOW = 10          # seconds counted together
FACTOR = 3.0         # this many times busier than usual
MIN_MESSAGES = 5     # a stretch needs at least this many messages to count, so a quiet chat is not all "spikes"
GAP = 60             # seconds between two spikes
BEFORE = 20          # how long before a spike the moment starts
AROUND = 600         # seconds on each side that make up "usual"
EDGE = 120           # seconds at the start and the end of a stream that are never spikes
MAX_SECONDS = 12 * 3600
YT_SECONDS = 20 * 60     # the longest a YouTube chat download may run before what arrived so far is used


# ---------------------------------------------------------------- keeping it
def clean_counts(counts) -> list:
    """Counts sent by the page: whole numbers, at most 12 hours of them."""
    if not isinstance(counts, list) or len(counts) > MAX_SECONDS:
        raise ValueError("That chat can't be used.")
    out = []
    for v in counts:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError("That chat can't be used.")
        out.append(max(0, min(100_000, int(v))))
    return out


def save(job_dir: Path, counts: list, source: str, covered=None):
    data = {"from": source, "counts": counts, "covered": len(counts) if covered is None else covered,
            "messages": sum(counts)}
    tmp = Path(job_dir) / "chat.json.part"
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(Path(job_dir) / "chat.json")
    return data


def load(job_dir: Path):
    try:
        d = json.loads((Path(job_dir) / "chat.json").read_text(encoding="utf-8"))
        return d if isinstance(d.get("counts"), list) else None
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- spikes
def spikes(counts: list, covered=None) -> list:
    """[(second the spike's 10 s begin, messages in them), ...], in time order."""
    n = min(len(counts), covered if covered is not None else len(counts))
    bins = [sum(counts[i:i + WINDOW]) for i in range(0, n, WINDOW)]
    if len(bins) < 6:
        return []
    k = AROUND // WINDOW
    edge = EDGE // WINDOW            # the hellos at the start and the goodbyes at the end are not moments
    found = []
    for i, c in enumerate(bins):
        if c < MIN_MESSAGES or i < edge or (covered is None or covered >= len(counts)) and i >= len(bins) - edge:
            continue
        near = bins[max(0, i - k):i] + bins[i + 1:i + 1 + k]
        usual = sum(near) / len(near) if near else 0
        if c >= FACTOR * max(usual, 0.5):
            found.append((i * WINDOW, c))
    picked = []
    for t, c in sorted(found, key=lambda x: -x[1]):          # the biggest first, then nothing too close to it
        if all(abs(t - p) >= GAP for p, _ in picked):
            picked.append((t, c))
    return sorted(picked)


def reacted(spk, shift=0.0):
    """For brain.make_lines: is a line (seconds in the block, which starts `shift` s into the video) part of a
    moment chat reacted to? True for lines from 20 s before a spike to the end of its 10 s."""
    marks = [t - shift for t, _ in spk]
    return lambda s, e: any(m - BEFORE <= s <= m + WINDOW or m - BEFORE <= e <= m + WINDOW for m in marks)


# ---------------------------------------------------------------- YouTube: the chat of a past live stream
def _yt_counts(raw: Path) -> tuple:
    """Per-second counts from yt-dlp's live_chat file (one JSON object per line), and how far it reaches."""
    counts, last = [], 0
    try:
        text = raw.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return [], 0
    for line in text.splitlines():
        try:
            item = json.loads(line).get("replayChatItemAction") or {}
            ms = int(item.get("videoOffsetTimeMsec") or 0)
        except (ValueError, AttributeError):
            continue                                   # the half-written last line of a download in progress
        n = sum(1 for a in item.get("actions") or [] if "addChatItemAction" in a)
        sec = ms // 1000
        if sec >= MAX_SECONDS:
            break
        if sec >= len(counts):
            counts.extend([0] * (sec + 1 - len(counts)))
        counts[sec] += n
        last = max(last, sec)
    return counts, last


class YouTubeChat:
    """Fetches the chat of a past YouTube live stream in the background. `now()` gives what has arrived so far,
    so the clip finder can use the chat of the part it is looking at before the whole download is done."""

    def __init__(self, url: str, job_dir: Path):
        self.dir, self.raw = Path(job_dir), Path(job_dir) / "chat_raw"
        self.started, self.done, self.proc = time.time(), False, None
        try:
            self.proc = subprocess.Popen([sys.executable, "-m", "yt_dlp", "--skip-download", "--write-subs",
                                          "--sub-langs", "live_chat", "--no-playlist", "--quiet", "--no-warnings",
                                          "-o", str(self.raw), url],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except OSError:
            self.done = True

    def _file(self):
        for name in ("chat_raw.live_chat.json", "chat_raw.live_chat.json.part"):
            if (self.dir / name).is_file():
                return self.dir / name
        return None

    def now(self, need_until=None, wait=0.0):
        """(counts, seconds covered), waiting up to `wait` seconds for the chat to reach `need_until`."""
        end = time.time() + wait
        while True:
            self._check()
            f = self._file()
            counts, last = _yt_counts(f) if f else ([], 0)
            if self.done or need_until is None or last >= need_until or time.time() >= end:
                return counts, (len(counts) if self.done else last)
            time.sleep(3)

    def _check(self):
        if self.done or not self.proc:
            return
        if self.proc.poll() is not None:
            self.done = True
        elif time.time() - self.started > YT_SECONDS:
            self.stop()

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
        self.done = True

    def finish(self):
        """Keep the counts, drop the raw download (it can be large)."""
        self.stop()
        counts, _ = self.now()
        for p in self.dir.glob("chat_raw*"):
            p.unlink(missing_ok=True)
        return save(self.dir, counts, "youtube") if sum(counts) else None


def has_chat(url: str) -> bool:
    """Only YouTube live replays carry a chat that can be fetched here."""
    return bool(re.search(r"(youtube\.com|youtu\.be)", url or "", re.I))
