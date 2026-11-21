"""Speech to text with word timestamps, using Parakeet 0.6b through sherpa-onnx.

It runs in one of two places. On this machine's processors (the default), or, when PEAKCUT_ASR_URL is set, on a
separate machine with a graphics card (studio/asr_worker.py), which does the same work many times faster. If that
machine cannot be reached, the pieces are done here instead, so transcription never stops because of it."""
import os
import queue
import re
import threading
import time

import numpy as np

from . import config, roman

_lock = threading.Lock()

# Several copies of the speech model, each on a few cores, instead of one copy on all of them: one copy cannot keep
# a big machine busy, and several videos transcribing at once would queue behind each other inside it. On a small
# machine (under 8 cores) this is still a single copy, as before.
_CPUS = os.cpu_count() or 4
PROVIDER = os.environ.get("PEAKCUT_ASR_PROVIDER", "cpu").strip().lower() or "cpu"      # "cuda" on a graphics card
THREADS = int(os.environ.get("PEAKCUT_ASR_THREADS") or (4 if _CPUS >= 8 else max(2, _CPUS - 2)))
COPIES = int(os.environ.get("PEAKCUT_ASR_COPIES") or (1 if PROVIDER != "cpu" else max(1, _CPUS // THREADS) if _CPUS >= 8 else 1))
_free: "queue.LifoQueue" = queue.LifoQueue()
_made = 0

# The machine with the graphics card, if there is one.
REMOTE = os.environ.get("PEAKCUT_ASR_URL", "").strip().rstrip("/")
REMOTE_TOKEN = os.environ.get("PEAKCUT_ASR_TOKEN", "").strip()
REMOTE_BATCH = int(os.environ.get("PEAKCUT_ASR_REMOTE_BATCH", "8"))         # pieces sent together: the card does them at once
REMOTE_PARALLEL = int(os.environ.get("PEAKCUT_ASR_REMOTE_PARALLEL", "4"))   # pieces of one video worked on at once
# The card has a ceiling: beyond a few requests at once it gets no faster. So only this many are sent to it at a
# time (all videos together), and the rest is done on this machine's own processors at the same moment: both are used.
REMOTE_SLOTS = threading.BoundedSemaphore(max(1, int(os.environ.get("PEAKCUT_ASR_REMOTE_INFLIGHT", "6"))))
_remote_down_until = 0.0


def model_ready() -> bool:
    from . import fetch_model
    return fetch_model.ready()


def _model_files(d) -> dict:
    """The model's three parts. A graphics card wants the full-precision files; processors the compact ones."""
    kinds = ("fp16", "", "int8") if PROVIDER != "cpu" else ("int8", "", "fp16")
    for k in kinds:
        names = {p: d / (f"{p}.{k}.onnx" if k else f"{p}.onnx") for p in ("encoder", "decoder", "joiner")}
        if all(f.is_file() for f in names.values()):
            return {p: str(f) for p, f in names.items()}
    raise FileNotFoundError(f"No speech model files in {d}")


def _new():
    import sherpa_onnx
    from . import fetch_model
    fetch_model.ensure()             # downloaded here, once, if it was never fetched
    d = config.ASR_MODEL_DIR
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        **_model_files(d),
        tokens=str(d / "tokens.txt"),
        num_threads=THREADS,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        model_type="nemo_transducer",
        provider=PROVIDER,
    )


def _take():
    """A free copy of the model: one that is idle, a new one while there is room for more, else wait for one."""
    global _made
    try:
        return _free.get_nowait()
    except queue.Empty:
        pass
    with _lock:
        make = _made < COPIES
        if make:
            _made += 1
    if make:
        try:
            return _new()
        except Exception:
            with _lock:
                _made -= 1
            raise
    return _free.get()


def _take_now():
    """A copy of the model if one is free (or can still be made) this instant, else None."""
    global _made
    try:
        return _free.get_nowait()
    except queue.Empty:
        pass
    with _lock:
        make = _made < COPIES
        if make:
            _made += 1
    if not make:
        return None
    try:
        return _new()
    except Exception:
        with _lock:
            _made -= 1
        raise


def warm():
    """Load every copy of the model now, side by side, so the first video doesn't wait for them (about 10 s each on a
    6-core processor). Copies already made are left as they are."""
    if REMOTE:                      # the card's machine does the work: nothing to load here
        return
    got = []

    def one():
        rec = _take_now()
        if rec is not None:
            got.append(rec)

    ts = [threading.Thread(target=one, daemon=True) for _ in range(COPIES)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    for rec in got:
        _free.put(rec)


def _recognizer():
    """Kept for callers that only need the model loaded (warm-up)."""
    rec = _take()
    _free.put(rec)
    return rec


def _chunks(audio: np.ndarray, lo=12.0, hi=24.0):
    """Split at the quietest point between lo and hi seconds so words are not cut in half."""
    sr, hop = 16000, 800  # 50 ms frames
    n = len(audio)
    frames = n // hop
    if frames == 0:
        return
    x = audio[: frames * hop].reshape(frames, hop).astype(np.float32)
    rms = np.sqrt((x ** 2).mean(axis=1))
    pos = 0
    while pos < n:
        if n - pos <= hi * sr:
            yield pos, n
            return
        a, b = (pos + int(lo * sr)) // hop, (pos + int(hi * sr)) // hop
        cut = (a + int(np.argmin(rms[a:b]))) * hop + hop // 2
        yield pos, cut
        pos = cut


BATCH = int(os.environ.get("PEAKCUT_ASR_BATCH", "1"))   # pieces decoded together. Measured: no faster on CPU, since
# each piece already uses every core, so one at a time (which also keeps the words exactly as before).


def _words(tokens, timestamps, a: int, b: int) -> list:
    out = []
    off, seg_end = a / 16000.0, b / 16000.0
    cur, gap = None, False
    for tok, t in zip(tokens, timestamps):
        new_word = tok.startswith((" ", "▁")) or gap
        piece = tok.replace("▁", " ").strip()
        if not piece:
            gap = True      # a space on its own: whatever comes next starts a new word ("in" "120", not "in120")
            continue
        gap = False
        is_punct = all(not c.isalnum() for c in piece)
        if cur is None or (new_word and not is_punct):
            if cur:
                out.append(cur)
            cur = {"w": piece, "s": round(off + t, 2), "e": round(off + t + 0.12, 2)}
        else:
            cur["w"] += piece
            cur["e"] = round(off + t + 0.12, 2)
    if cur:
        cur["e"] = min(cur["e"], round(seg_end, 2))
        out.append(cur)
    return out


def decode_pieces(pieces: list, rec=None) -> list:
    """[(tokens, timestamps), ...] for float32 pieces of audio, done on this machine with one copy of the model."""
    streams = []
    rec = rec or _take()       # held only for these pieces, so videos transcribing at once take turns fairly
    try:
        for seg in pieces:
            st = rec.create_stream()
            st.accept_waveform(16000, seg)
            streams.append(st)
        rec.decode_streams(streams)
    finally:
        _free.put(rec)
    return [(list(st.result.tokens), [float(t) for t in st.result.timestamps]) for st in streams]


def _remote_ok() -> bool:
    return bool(REMOTE) and time.time() >= _remote_down_until


def _decode_remote(pieces: list) -> list:
    """The same, on the machine with the graphics card. Audio goes as 16-bit sound, the answer comes back as text."""
    import httpx
    raw = [np.clip(seg * 32768.0, -32768, 32767).astype("<i2") for seg in pieces]
    r = httpx.post(REMOTE + "/decode", content=b"".join(x.tobytes() for x in raw), timeout=httpx.Timeout(120, connect=4),
                   headers={"Authorization": "Bearer " + REMOTE_TOKEN, "X-Lens": ",".join(str(len(x)) for x in raw),
                            "Content-Type": "application/octet-stream"})
    r.raise_for_status()
    got = r.json()["pieces"]
    if len(got) != len(pieces):
        raise ValueError("wrong number of pieces came back")
    return [(p["tokens"], p["timestamps"]) for p in got]


CLIP_PIECES = (6.0, 10.0)   # one short clip heard again: shorter pieces. Measured on a Hindi stream over game sound,
# 6-10 s pieces caught about twice the words of 12-24 s ones (the model drops speech it is unsure of in long pieces)


def transcribe(audio: np.ndarray, on_progress=None, pieces=(12.0, 24.0)) -> list:
    """Returns [{'w': word, 's': start_sec, 'e': end_sec}, ...] for the whole audio.
    Speech is cut at quiet moments into pieces of 12-24 s (or `pieces`); silent pieces are skipped."""
    global _remote_down_until
    words = []
    todo = []
    for a, b in _chunks(audio, *pieces):
        seg = audio[a:b].astype(np.float32) / 32768.0
        if len(seg) < 4800 or float(np.sqrt((seg ** 2).mean())) < 0.003:
            continue  # silence: skip, saves time and avoids made-up words
        todo.append((a, b, seg))
    remote = _remote_ok()
    size = max(1, REMOTE_BATCH if remote else BATCH)
    groups = [todo[i:i + size] for i in range(0, len(todo), size)]
    done = [0]

    def decode(group):
        global _remote_down_until
        segs = [seg for _, _, seg in group]
        got = None
        while got is None:
            # whichever is free first: a place on the card's machine, or a copy of the model on this one
            if remote and _remote_ok() and REMOTE_SLOTS.acquire(blocking=False):
                try:
                    got = _decode_remote(segs)
                except Exception:  # noqa: BLE001 - the card's machine is away or busy: these pieces are done here
                    _remote_down_until = time.time() + 60
                finally:
                    REMOTE_SLOTS.release()
                continue
            rec = _take_now()
            if rec is None and not (remote and _remote_ok()):
                rec = _take()                                # nothing else to wait for: wait for a copy here
            if rec is not None:
                got = []
                step = max(1, BATCH)
                try:
                    for i in range(0, len(segs), step):
                        got += decode_pieces(segs[i:i + step], rec)
                        rec = None if i + step >= len(segs) else _take()
                except Exception:
                    got = None
                    raise
                continue
            time.sleep(0.02)
        out = [_words(tok, ts, a, b) for (a, b, _), (tok, ts) in zip(group, got)]
        done[0] += 1
        if on_progress:
            on_progress(done[0] / len(groups))
        return out

    # Pieces are independent, so they go to every copy of the model that is free: a video alone on the server
    # uses all of it, and several videos share it piece by piece. The words come back in order.
    workers = REMOTE_PARALLEL if remote else COPIES
    if workers > 1 and len(groups) > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(min(workers, len(groups)), thread_name_prefix="asr") as ex:
            results = list(ex.map(decode, groups))
    else:
        results = [decode(g) for g in groups]
    return _finish([piece for out in results for piece in out])


def _finish(pieces) -> list:
    words = []
    for piece in pieces:
        for w in piece:
            if words and words[-1]["w"] == w["w"] and words[-1]["s"] == w["s"]:
                continue  # the model sometimes says the same word twice at the same moment
            words.append(w)
    # A word lasts until the next one starts, capped so pauses stay pauses.
    for i, w in enumerate(words):
        nxt = words[i + 1]["s"] if i + 1 < len(words) else w["e"] + 0.4
        w["e"] = round(max(w["s"] + 0.08, min(nxt, max(w["e"], w["s"] + 0.6))), 2)
    return words


# ---------------------------------------------------------------- Hindi (and Urdu): one clip heard again
# The main model hears English only, so Hindi speech comes out as guesses ("Patani kya hai") and much of it is
# dropped. Meta's Omnilingual model hears Hindi properly. It writes Hindi in Urdu or Devanagari letters; the caption
# step then spells that in Roman letters (Hinglish), as it already does for Hindi videos. Measured on a Hindi stream
# over game sound: 93 words heard where the main model heard 28, in about the same time.
_HINDI_LETTERS = re.compile(r"[ऀ-ॿ؀-ۿ]")
# Copies of the Hindi model, made when first needed, as many as the main model's (a whole Hindi video is heard by
# them side by side, the same way).
_hfree: "queue.LifoQueue" = queue.LifoQueue()
_hmade = 0


def _new_hindi():
    import sherpa_onnx
    d = config.HINDI_MODEL_DIR
    model = min(d.glob("model*.onnx"), key=lambda f: "int8" not in f.name)   # the compact file if there
    return sherpa_onnx.OfflineRecognizer.from_omnilingual_asr_ctc(
        model=str(model), tokens=str(d / "tokens.txt"), num_threads=THREADS, provider=PROVIDER)


def _take_hindi():
    global _hmade
    try:
        return _hfree.get_nowait()
    except queue.Empty:
        pass
    with _lock:
        make = _hmade < COPIES
        if make:
            _hmade += 1
    if make:
        try:
            return _new_hindi()
        except Exception:
            with _lock:
                _hmade -= 1
            raise
    return _hfree.get()


def _speech_pieces(audio: np.ndarray):
    """[(a, b, float piece)] of the audio cut at quiet moments into 6-10 s pieces (the Hindi model drops speech it is
    unsure of in long pieces), silent pieces left out."""
    out = []
    for a, b in _chunks(audio, *CLIP_PIECES):
        seg = audio[a:b].astype(np.float32) / 32768.0
        if len(seg) < 4800 or float(np.sqrt((seg ** 2).mean())) < 0.003:
            continue
        out.append((a, b, seg))
    return out


def _hindi_decode(group) -> list:
    """Words for some pieces, with one copy of the Hindi model."""
    rec = _take_hindi()
    try:
        out = []
        for a, b, seg in group:
            st = rec.create_stream()
            st.accept_waveform(16000, seg)
            rec.decode_stream(st)
            out.append(_words(list(st.result.tokens), [float(t) for t in st.result.timestamps], a, b))
        return out
    finally:
        _hfree.put(rec)


# The Hindi model knows 1600 languages and now and then writes a word in a neighbour's letters (Bengali, Gurmukhi,
# Gujarati) or a stray Chinese character. Those Indian scripts sit in the same order as Devanagari, so their letters
# are moved over to it (the caption step then spells Devanagari in Roman letters); anything else that is not Latin,
# Devanagari or Urdu is dropped, so no caption is drawn in letters the fonts don't have.
_SHIFT = ((0x0980, 0x09FF, 0x80), (0x0A00, 0x0A7F, 0x100), (0x0A80, 0x0AFF, 0x180))


def _keep_char(ch: str) -> str:
    o = ord(ch)
    for lo, hi, back in _SHIFT:
        if lo <= o <= hi:
            return chr(o - back)
    if o < 0x250 or 0x0900 <= o <= 0x097F or 0x0600 <= o <= 0x06FF or 0x0750 <= o <= 0x077F or 0xFB50 <= o <= 0xFEFF:
        return ch
    return ""


def _tidy_script(pieces: list) -> list:
    out = []
    for piece in pieces:
        kept = []
        for w in piece:
            t = "".join(_keep_char(c) for c in w["w"]).strip()
            t = roman.loose_signs(t)           # a Hindi vowel sign left on a Roman letter ("yे" -> "ye")
            if any(c.isalnum() for c in t):
                kept.append(dict(w, w=t))
        out.append(kept)
    return out


def _hindi_words(audio: np.ndarray, on_progress=None) -> list:
    """The audio heard by the Hindi model: pieces shared out to every copy, words back in order."""
    todo = _speech_pieces(audio)
    groups = [todo[i:i + 6] for i in range(0, len(todo), 6)]
    if not groups:
        return []
    done = [0]

    def one(group):
        out = _hindi_decode(group)
        done[0] += 1
        if on_progress:
            on_progress(done[0] / len(groups))
        return out

    if COPIES > 1 and len(groups) > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(min(COPIES, len(groups)), thread_name_prefix="asr-hi") as ex:
            results = list(ex.map(one, groups))
    else:
        results = [one(g) for g in groups]
    return _finish(_tidy_script([piece for out in results for piece in out]))


def transcribe_hindi(audio: np.ndarray, on_progress=None) -> list:
    """A whole Hindi (or Urdu) video's words, in Hindi or Urdu letters. The caption step spells them in Roman
    letters (Hinglish)."""
    return _hindi_words(audio, on_progress)


def sounds_hindi(audio: np.ndarray, sample_secs: float = 24.0) -> bool:
    """Is this video spoken in Hindi or Urdu? A few stretches of speech, spread over its first minutes, are heard by
    the Hindi model: mostly Hindi or Urdu letters back means yes. English comes back in Roman letters, so an English
    video says no. Takes a few seconds; False when the Hindi model isn't here or can't be used."""
    from . import fetch_model
    if not config.HINDI_ASR:
        return False
    if not fetch_model.hindi_ready():
        fetch_model.fetch_hindi_later()
        return False
    pieces = _speech_pieces(audio[: 8 * 60 * 16000])
    if not pieces:
        return False
    loud = sorted(pieces, key=lambda p: -float(np.sqrt((p[2] ** 2).mean())))[: max(3, len(pieces) // 2)]
    loud.sort(key=lambda p: p[0])                    # the louder half (speech, more than music), in time order
    want = max(1, int(sample_secs / 8))
    pick = [loud[round(i * (len(loud) - 1) / max(1, want - 1))] for i in range(min(want, len(loud)))]
    try:                                             # each stretch on its own copy of the model, at the same time
        if COPIES > 1 and len(pick) > 1:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(min(COPIES, len(pick)), thread_name_prefix="asr-lang") as ex:
                got = list(ex.map(lambda p: _hindi_decode([p]), pick))
        else:
            got = [_hindi_decode(pick)]
        words = [w for out in got for piece in out for w in piece]
    except Exception:  # noqa: BLE001 - a broken Hindi model: the video is heard by the main model as before
        return False
    return len(words) >= 6 and _hindi_share(words) >= 0.5


def _hindi_share(words) -> float:
    """How much of what was heard is written in Hindi or Urdu letters (0 to 1)."""
    letters = [c for w in words for c in w["w"] if c.isalpha()]
    return sum(bool(_HINDI_LETTERS.match(c)) for c in letters) / max(1, len(letters))


def hear_clip(audio: np.ndarray, lang: str = "", english=None) -> list:
    """One clip heard again, from its own audio. A clip known to be English goes to the main model. Otherwise the
    Hindi model listens first, and its words are kept when they are mostly Hindi or Urdu; anything else (English,
    or a language the main model was already handling) is heard by the main model as before. `english`: the main
    model's words for this audio, when the caller already has them."""
    from . import fetch_model
    lang = (lang or "").lower()
    if config.HINDI_ASR and not lang.startswith("en"):
        if fetch_model.hindi_ready():
            try:
                heard = _hindi_words(audio)
                if lang.startswith(("hi", "ur")) or (len(heard) >= 3 and _hindi_share(heard) >= 0.5):
                    return heard
            except Exception:  # noqa: BLE001 - a broken Hindi model never stops a clip: the main model hears it
                pass
        else:
            fetch_model.fetch_hindi_later()        # ready for the next clip
    return english if english is not None else transcribe(audio, pieces=CLIP_PIECES)
