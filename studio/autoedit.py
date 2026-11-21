"""The AI editor: turns a plain clip into a finished short, the way an editor would. One AI call per clip reads its
words (with when each line is said and how loud) and plans:

  * the music: one of the built-in songs, chosen by mood, low under the voice, rising at the end
  * zoom moments: on the punchline, the reveal, the reaction (aimed at the face)
  * sound effects: a whoosh as the hook lands, a pop on each zoom, a hit on the big moment
  * at most one reaction face, only when a moment clearly earns it

Everything it adds is an ordinary part of the clip's look, so the person can change or remove any of it in the
editor. Without the AI, a simple version is made from loudness alone (music, one zoom on the loudest moment, a
whoosh and a pop)."""
import hashlib
import json
import time

import numpy as np

from . import ai, brain, config, pack, render

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "mood": {"type": "STRING"},
        "zooms": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "at": {"type": "NUMBER"}, "len": {"type": "NUMBER"}, "strength": {"type": "NUMBER"}},
            "required": ["at", "len"]}},
        "sounds": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "at": {"type": "NUMBER"}, "sound": {"type": "STRING"}}, "required": ["at", "sound"]}},
        "reaction": {"type": "OBJECT", "properties": {"at": {"type": "NUMBER"}, "face": {"type": "STRING"}}},
        "kind": {"type": "STRING"},
        "template": {"type": "STRING"}, "template_why": {"type": "STRING"},
        "caption_style": {"type": "STRING"}, "style_why": {"type": "STRING"},
    },
    "required": ["mood", "zooms", "sounds"],
}

PROMPT = """Edit a viral short so people keep watching. Tasteful, not noisy. Seconds are on the clip's clock (0 = start).
- mood: one music bed, exact name from: {moods}
- zooms: 1-3 punch-ins on the punchline, reveal or reaction (at; len 1.2-2.6; strength 1.25-1.8). Not in the first
  second, no overlaps.
- sounds: 2-5 (at; sound, exact name from: {sounds}). Usually a whoosh at 0.0, a zoom pop at each zoom, at most one
  impact on the biggest moment. Comic sounds only if clearly funny.
- reaction: only for one clearly shocking or funny moment: at, face (exact name from: {faces}). Else leave out.
{look_rules}
Short ({dur:.0f} s) from: {title}
About: {about}
{look_part}Words ([second] line; LOUD = said much louder):
{lines}"""

# The look of the short, chosen with the edit: what kind of video it is, the template (layout and title look) that
# suits it and its picture, and the caption style. Only asked when the editor sends its templates.
LOOK_RULES = """- kind: what the video is, 2-3 words (gaming stream, podcast, talking head, IRL, tutorial, news...).
- template: one key that fits the kind and the picture, from (key: name [layout]): {templates}
  Face cam in a corner over gameplay: a template showing the cam (split, pip, pop). One person filling the frame:
  full or close-up. Two people: two speakers. No face: centered or full.
- caption_style: one key that fits the kind and mood, from: {styles}
- template_why, style_why: up to 12 plain words each.
"""
LOOK_PART = "Picture: {scene}\n"

CACHE_DAYS = 30      # the same clip, words and picture asked again within this: the saved plan, no AI call


def _cache_file(prompt: str):
    """Where the AI's plan for exactly this prompt (and this AI setup) is kept."""
    h = hashlib.sha256(json.dumps([ai.provider(), ai.models(), prompt, SCHEMA], sort_keys=True).encode()).hexdigest()
    return config.DATA_DIR / "cache" / "autoedit" / f"{h[:32]}.json"


def _ask(prompt: str):
    """The AI's plan: from the cache when this exact clip was planned before, else one light call (saved for next
    time). Returns (answer, tokens used, from the cache)."""
    f = _cache_file(prompt)
    try:
        if f.is_file() and time.time() - f.stat().st_mtime < CACHE_DAYS * 86400:
            return json.loads(f.read_text(encoding="utf-8")), 0, True
    except (OSError, ValueError):
        pass
    out, _model, tok = brain.ask_ai(prompt, SCHEMA, purpose="AI editor", light=True)
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(out), encoding="utf-8")
    except OSError:
        pass
    return out, tok, False


def scene_text(sc) -> str:
    """The face reading as one plain sentence for the AI."""
    if not sc:
        return "unknown (the picture couldn't be read)"
    cam = sc.get("cam")
    if cam:
        side = "left" if cam["x"] < 0.4 else "right" if cam["x"] > 0.6 else "middle"
        level = "top" if cam["y"] < 0.4 else "bottom" if cam["y"] > 0.6 else "middle"
        return f"a small face cam box at the {level} {side} of the frame, over gameplay or a screen (a streamer)"
    if sc.get("big", 0) >= 2:
        return f"{sc['big']} people's faces, side by side (an interview or podcast)"
    if sc.get("big") == 1:
        return "one person's face fills a good part of the frame (a talking head)"
    if sc.get("seen"):
        return "faces come and go (characters in a game or a film); no steady face cam or speaker"
    return "no face is visible (gameplay, screen or scenery only)"


def rules_look(sc, title=""):
    """Without the AI: the template and caption style from the face reading alone."""
    gaming = any(w in (title or "").lower() for w in ("game", "gaming", "gameplay", "stream", "live", "gta", "minecraft", "valorant", "bgmi", "pubg"))
    if sc and sc.get("cam"):
        return "stream", "gamer" if gaming else "boldpop", "A face cam over gameplay: the stream on top, the streamer below"
    if sc and sc.get("big", 0) >= 2:
        return "duo", "podcast", "Two people: one on top, one below"
    if sc and sc.get("big"):
        return "podcast", "podcast", "One person talking: closer in on them"
    return "centered", "gamer" if gaming else "clean", "No face on screen: the whole picture, centered"


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


def plan(clip, words, title="", db=None, scene=None, templates=None) -> dict:
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
        # a style's key alone when its label says the same thing ("gamer (Gamer)" -> "gamer")
        styles = [k if v.get("label", k).lower().replace(" ", "") == k.lower() else f"{k} ({v.get('label', k)})"
                  for k, v in render.PRESETS.items()]
        look_rules = LOOK_RULES.format(styles=", ".join(styles),
                                       templates="; ".join(f"{t['k']}: {t['name']} [{t.get('layout', '')}]" for t in templates)) if templates else ""
        prompt = PROMPT.format(dur=dur, title=brain._safe(title, 120) or "unknown", about=brain._safe(clip.get("reason") or clip.get("title") or "", 160),
                               lines=brain._fmt(lines), moods=", ".join(f"{s['name']} ({s['mood']})" for s in songs),
                               sounds=", ".join(x["name"] for x in sfx), faces=", ".join(f["name"] for f in faces),
                               look_rules=look_rules, look_part=LOOK_PART.format(scene=scene_text(scene)) if templates else "")
        out, tok, cached = _ask(prompt)
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
        look = {}
        if templates:
            keys = {t["k"] for t in templates}
            tk = str(out.get("template") or "").strip()
            sk = str(out.get("caption_style") or "").strip()
            r_t, r_s, r_w = rules_look(scene, title)
            look = {"kind": str(out.get("kind") or "")[:40],
                    "template": tk if tk in keys else (r_t if r_t in keys else ""),
                    "template_why": str(out.get("template_why") or "")[:160] if tk in keys else r_w,
                    "style": sk if sk in render.PRESETS else r_s,
                    "style_why": str(out.get("style_why") or "")[:160] if sk in render.PRESETS else ""}
        return {"song": song["id"], "zooms": zooms, "sounds": sounds, "reaction": reaction, "by": "ai", "tokens": tok, "cached": cached, **look}
    except Exception:  # noqa: BLE001 - no AI (or a bad answer): a plain, safe edit from loudness alone
        whoosh = by_name(sfx, "Whoosh Fast")
        pop = by_name(sfx, "Zoom Pop")
        peaks = _loud_peaks(db, start, end, 1)
        zooms = [(float(max(1, p - 0.4)), 1.8, 1.4) for p in peaks]
        sounds = ([(0.0, whoosh["id"])] if whoosh else []) + ([(z[0], pop["id"]) for z in zooms] if pop else [])
        look = {}
        if templates:
            keys = {t["k"] for t in templates}
            r_t, r_s, r_w = rules_look(scene, title)
            look = {"kind": "", "template": r_t if r_t in keys else "", "template_why": r_w, "style": r_s, "style_why": ""}
        return {"song": songs[0]["id"] if songs else "", "zooms": zooms, "sounds": sounds, "reaction": None, "by": "rules", **look}


def apply(clip, words, title="", db=None, src=None, templates=None) -> dict:
    """Plan the edit and write it into the clip's look (keeping everything else in it). Returns the plan. With the
    editor's templates, the plan also says which template and caption style suit the clip (the editor applies them)."""
    sc = None
    if templates and src:
        try:
            from . import facecam
            off = clip.get("src_offset", 0.0)
            sc = facecam.scene(src, clip["start"] - off, clip["end"] - off)
        except Exception:  # noqa: BLE001 - the picture can't be read: the AI goes by the words and the title
            sc = None
    p = plan(clip, words, title, db, sc, templates)
    p["scene"] = sc
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
