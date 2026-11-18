"""The built-in edit pack: songs, sound effects, colour looks (LUTs) and reaction faces that come with SocialShot
for every user (studio/pack, made by tools/import_pack.py). Ids look like the ones in a user's own library, so a
clip can name a built-in song or face exactly the way it names its own."""
import json
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "pack"


@lru_cache(maxsize=1)
def _data() -> dict:
    try:
        return json.loads((DIR / "pack.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"songs": [], "sfx": [], "sfx_groups": [], "looks": [], "faces": []}


def songs() -> list:
    return [dict(s, pack=True) for s in _data()["songs"]]


def song_path(sid: str) -> Path | None:
    return DIR / "music" / f"{sid}.m4a" if any(s["id"] == sid for s in _data()["songs"]) else None


def sfx() -> dict:
    return {"groups": _data()["sfx_groups"], "items": _data()["sfx"]}


def sfx_path(sid: str) -> Path | None:
    return DIR / "sfx" / f"{sid}.m4a" if any(s["id"] == sid for s in _data()["sfx"]) else None


def faces() -> list:
    return [dict(f, kind="image", pack=True, w=512, h=512) for f in _data()["faces"]]


def face_path(fid: str) -> Path | None:
    return DIR / "faces" / f"{fid}.png" if any(f["id"] == fid for f in _data()["faces"]) else None


def looks() -> list:
    return _data()["looks"]


def look_path(key: str) -> Path | None:
    f = next((x["file"] for x in _data()["looks"] if x["key"] == key), None)
    return DIR / "luts" / f if f else None
