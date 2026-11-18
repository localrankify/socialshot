"""The AI editor: turns a plain clip into a finished short, the way an editor would. One AI call per clip reads its
words (with when each line is said and how loud) and plans:

  * the music: one of the built-in songs, chosen by mood, low under the voice, rising at the end
  * zoom moments: on the punchline, the reveal, the reaction (aimed at the face)
  * sound effects: a whoosh as the hook lands, a pop on each zoom, a hit on the big moment
  * at most one reaction face, only when a moment clearly earns it

Everything it adds is an ordinary part of the clip's look, so the person can change or remove any of it in the
editor. Without the AI, a simple version is made from loudness alone (music, one zoom on the loudest moment, a
whoosh and a pop)."""
import json

import numpy as np

from . import brain, pack, render

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "mood": {"type": "STRING"},
        "zooms": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "at": {"type": "NUMBER"}, "len": {"type": "NUMBER"}, "strength": {"type": "NUMBER"}, "why": {"type": "STRING"}},
            "required": ["at", "len"]}},
        "sounds": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "at": {"type": "NUMBER"}, "sound": {"type": "STRING"}}, "required": ["at", "sound"]}},
        "reaction": {"type": "OBJECT", "properties": {"at": {"type": "NUMBER"}, "face": {"type": "STRING"}}},
    },
    "required": ["mood", "zooms", "sounds"],
}

PROMPT = """You are the editor of a viral short ({dur:.0f} seconds) cut from a longer video. Plan how to edit it so
people keep watching: music, punch-in zooms on key moments, and sound effects. Keep it tasteful: an edit that feels
professional, not noisy.

Video: {title}
What the clip is about: {about}

The clip's words, one line per sentence, with the second it starts on the clip's own clock (0 = clip start). (LOUD)
marks lines said much louder than usual:
{lines}

Pick:
- mood: the ONE music bed that fits, by its exact name from: {moods}
- zooms: 1 to 3 moments to punch in (at = second, len = 1.2 to 2.6 seconds, strength 1.25 to 1.8). Put them on the
  punchline, the reveal, the shocked or laughing reaction. Never in the first second. They must not overlap.
- sounds: 2 to 5 sound effects (at = second, sound = exact name from: {sounds}). Usually: a whoosh at 0.0 as the hook
  appears, a pop or zoom pop at each zoom's start, and at most one impact or bass drop on the single biggest moment.
  Comic sounds only if the clip is clearly funny.
- reaction: only if one moment is clearly shocking, funny or mind-blowing, a face (exact name from: {faces}) at that
  second. Otherwise leave it out.
"""


def _clip_lines(words, start, end):
    near = [dict(w, s=w["s"] - start, e=w["e"] - start) for w in words if start - 0.2 <= w["s"] <= end]
    return brain.make_lines(near) if near else []


def _loud_peaks(db, start, end, n=2):
    """The loudest seconds of the clip (clip clock), at least 3 s apart, never in the first second."""
    if db is None or not len(db):
        return []
    a, b = int(max(0, start)), int(min(len(db), end))
    seg = np.array(db[a:b], dtype=np.float32)
    if len(seg) < 4:
        return []
    order = list(np.argsort(-seg))
    out = []
    for i in order:
        if i < 1 or i > len(seg) - 2 or any(abs(i - j) < 3 for j in out):
            continue
        out.append(int(i))
        if len(out) >= n:
            break
    return out


def plan(clip, words, title="", db=None) -> dict:
    """The edit for one clip, on the clip's own clock: {"song", "zooms": [(at, len, strength)], "sounds": [(at, id)],
    "reaction": (at, face id) or None, "by": "ai" | "rules"}."""
    start, end = clip["start"], clip["end"]
    dur = max(1.0, end - start)
    songs, sfx, faces = pack.songs(), pack.sfx()["items"], pack.faces()
    by_name = lambda items, name: next((x for x in items if x["name"].lower() == str(name or "").strip().lower()), None)  # noqa: E731
    lines = _clip_lines(words, start, end)
    try:
        if len(lines) < 2:
            raise ValueError("too little said")
        prompt = PROMPT.format(dur=dur, title=brain._safe(title) or "unknown", about=brain._safe(clip.get("reason") or clip.get("title") or ""),
                               lines=brain._fmt(lines), moods=", ".join(f"{s['name']} ({s['mood']})" for s in songs),
                               sounds=", ".join(x["name"] for x in sfx), faces=", ".join(f["name"] for f in faces))
        out, _model, _tok = brain.ask_ai(prompt, SCHEMA, purpose="AI editor")
        if isinstance(out, list):
            out = out[0] if out else {}
        song = by_name(songs, out.get("mood")) or songs[0]
        zooms, last = [], -9.0
        for z in sorted((z for z in out.get("zooms") or [] if isinstance(z, dict)), key=lambda z: float(z.get("at") or 0))[:3]:
            at = max(1.0, min(dur - 1.3, float(z.get("at") or 0)))
            ln = max(1.2, min(2.6, float(z.get("len") or 1.8)))
            if at < last + 0.4:
                continue
            zooms.append((round(at, 2), round(min(ln, dur - at), 2), round(max(1.25, min(1.8, float(z.get("strength") or 1.5))), 2)))
            last = at + ln
        sounds = []
        for x in (out.get("sounds") or [])[:6]:
            s = by_name(sfx, x.get("sound")) if isinstance(x, dict) else None
            if s:
                sounds.append((round(max(0.0, min(dur - 0.2, float(x.get("at") or 0))), 2), s["id"]))
        r = out.get("reaction") if isinstance(out.get("reaction"), dict) else None
        face = by_name(faces, r.get("face")) if r else None
        reaction = (round(max(1.0, min(dur - 1.0, float(r.get("at") or 0))), 2), face["id"]) if face else None
        return {"song": song["id"], "zooms": zooms, "sounds": sounds, "reaction": reaction, "by": "ai"}
    except Exception:  # noqa: BLE001 - no AI (or a bad answer): a plain, safe edit from loudness alone
        whoosh = by_name(sfx, "Whoosh Fast")
        pop = by_name(sfx, "Zoom Pop")
        peaks = _loud_peaks(db, start, end, 1)
        zooms = [(float(max(1, p - 0.4)), 1.8, 1.4) for p in peaks]
        sounds = ([(0.0, whoosh["id"])] if whoosh else []) + ([(z[0], pop["id"]) for z in zooms] if pop else [])
        return {"song": songs[0]["id"] if songs else "", "zooms": zooms, "sounds": sounds, "reaction": None, "by": "rules"}


def apply(clip, words, title="", db=None, src=None) -> dict:
    """Plan the edit and write it into the clip's look (keeping everything else in it). Returns the plan."""
    p = plan(clip, words, title, db)
    start = clip["start"]
    # a clip with no look of its own uses its caption style: start from that, so the captions stay as they were
    look = dict(clip.get("look") or {k: v for k, v in render.PRESETS.get(clip.get("style"), render.PRESETS["studio"]).items() if k != "label"})
    if p["song"]:
        look["music"] = {"id": p["song"], "vol": 14, "duck": True, "loop": True, "fade": True, "at": 0, "peak": 55, "rise": 3,
                         "rise_on": True, "peak_at": None, "off": 0, "till": None}
    aim = None
    if src and p["zooms"]:
        try:
            from . import facecam
            aim = facecam.face_point(src, start - clip.get("src_offset", 0.0), clip["end"] - clip.get("src_offset", 0.0))
        except Exception:  # noqa: BLE001 - no face found: zooms aim at the middle
            aim = None
    zooms = []
    for i, (at, ln, s) in enumerate(p["zooms"]):
        z = {"a": round(start + at, 2), "b": round(start + at + ln, 2), "s": s, "x": round((aim[0] if aim else 0.5) * 100, 1),
             "y": round((aim[1] if aim else 0.42) * 100, 1), "fx": "none", "ease": True}
        if p["reaction"] and abs(p["reaction"][0] - at) < ln:
            z["react"] = p["reaction"][1]
        zooms.append(z)
    if p["reaction"] and not any(z.get("react") for z in zooms):      # a reaction with no zoom near it: a zoom of its own
        at = p["reaction"][0]
        zooms.append({"a": round(start + at, 2), "b": round(start + at + 1.6, 2), "s": 1.35, "x": round((aim[0] if aim else 0.5) * 100, 1),
                      "y": round((aim[1] if aim else 0.42) * 100, 1), "fx": "none", "ease": True, "react": p["reaction"][1]})
    look["zooms"] = sorted(zooms, key=lambda z: z["a"])[:4]
    look["sfx"] = [{"id": sid, "t": round(start + at, 2), "vol": 80} for at, sid in p["sounds"]]
    look["ai_edit"] = p["by"]
    clip["look"] = render.clean_look(look) or look
    clip["auto_edited"] = p["by"]
    return p


def describe(p) -> str:
    """A short line for the person: what the AI editor did."""
    song = next((s["name"] for s in pack.songs() if s["id"] == p.get("song")), "")
    bits = [f"music: {song}" if song else "", f"{len(p['zooms'])} zoom{'s' if len(p['zooms']) != 1 else ''}" if p["zooms"] else "",
            f"{len(p['sounds'])} sound{'s' if len(p['sounds']) != 1 else ''}" if p["sounds"] else "", "a reaction face" if p.get("reaction") else ""]
    return ", ".join(b for b in bits if b)


if __name__ == "__main__":       # a quick look at a plan: python -m studio.autoedit <words.json> <start> <end>
    import sys
    w = json.loads(open(sys.argv[1], encoding="utf-8").read())
    print(json.dumps(plan({"start": float(sys.argv[2]), "end": float(sys.argv[3])}, w), indent=1))
