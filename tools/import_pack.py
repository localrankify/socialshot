"""Bring the Viral Reel Edit Pack into SocialShot: songs, sound effects, colour looks (LUTs) and reaction faces.

    python tools/import_pack.py "G:/clipingvideos/ViralReelEditPack"

Everything is copied into studio/pack/ in a web-friendly form (songs and sounds as AAC, faces as 512 px PNG) with a
pack.json that lists them. The pack's licence allows using its media inside the product; the pack itself is not
offered as a download.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "studio" / "pack"

# the sound effects in groups, as the pack's guide sorts them
SFX_GROUPS = [("transitions", "Transitions", ["Whoosh_Fast", "Whoosh_Deep", "Whoosh_Reverse", "Swish_Light", "Riser_Short", "Riser_Long", "Swipe_Up"]),
              ("impacts", "Impacts", ["Impact_Boom", "Impact_Hit", "Cinematic_Hit", "Bass_Drop", "Cymbal_Swell", "Drumroll", "Suspense_Sting"]),
              ("ui", "Pops and clicks", ["Pop", "Zoom_Pop", "Click", "Blip", "Ding", "Snap", "Glitch_Cut", "Typewriter", "Bubble_Pop", "Countdown_Beep"]),
              ("comic", "Comic", ["Boing", "Wobble", "Vinyl_Stop", "Tape_Stop", "Sparkle", "Coin", "Sad_Tritone", "Magic_Chime"])]
MOODS = {"01": "Dark and tense", "02": "Light and playful", "03": "Grand and orchestral", "04": "Synthwave, digital",
         "05": "Soft piano, bittersweet", "06": "Ticking build", "07": "Claps, uplifting", "08": "Ominous synth",
         "09": "Lo-fi, calm", "10": "Warm ambient"}
LOOKS = {"cinematic_teal_orange": "Teal & orange", "punchy_viral": "Punchy", "moody_dark": "Moody", "warm_film": "Warm film",
         "vintage_70s": "70s film", "punch_desaturated": "Muted punch", "mono_documentary": "Mono doc"}


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def dur(f: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                         check=True, capture_output=True, text=True).stdout
    return round(float(out.strip()), 2)


def nice(stem: str) -> str:
    return re.sub(r"\s+", " ", stem.replace("_", " ")).strip()


def main(src: Path):
    if OUT.exists():
        shutil.rmtree(OUT)
    for d in ("music", "sfx", "luts", "faces"):
        (OUT / d).mkdir(parents=True)
    pack = {"songs": [], "sfx_groups": [], "sfx": [], "looks": [], "faces": []}

    # songs: the seamless 2-minute loop where there is one, else the original
    for i, f in enumerate(sorted((src / "01_MUSIC").glob("MUSIC_*.mp3")), 1):
        num = f.stem.split("_")[1]
        loop = src / "01_MUSIC" / "LOOPS" / f"{f.stem}_LOOP.mp3"
        use = loop if loop.is_file() else f
        sid = f"a0a00000{i:04x}"
        out = OUT / "music" / f"{sid}.m4a"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(use), "-vn", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", str(out)])
        pack["songs"].append({"id": sid, "name": nice("_".join(f.stem.split("_")[2:])), "mood": MOODS.get(num, ""), "dur": dur(out)})

    # sound effects, short AAC files, in their groups
    files = {re.sub(r"^SFX_\d+_", "", f.stem): f for f in (src / "02_SFX").glob("SFX_*.wav")}
    n = 0
    for key, label, names in SFX_GROUPS:
        ids = []
        for name in names:
            f = files.pop(name, None)
            if not f:
                continue
            n += 1
            sid = f"5fc00000{n:04x}"
            out = OUT / "sfx" / f"{sid}.m4a"
            run(["ffmpeg", "-y", "-v", "error", "-i", str(f), "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", str(out)])
            pack["sfx"].append({"id": sid, "name": nice(name), "group": key, "dur": dur(out)})
            ids.append(sid)
        pack["sfx_groups"].append({"key": key, "label": label})
    for name, f in sorted(files.items()):                 # anything not in a group goes under its own
        n += 1
        sid = f"5fc00000{n:04x}"
        out = OUT / "sfx" / f"{sid}.m4a"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(f), "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", str(out)])
        pack["sfx"].append({"id": sid, "name": nice(name), "group": "ui", "dur": dur(out)})

    # colour looks
    for stem, label in LOOKS.items():
        f = src / "05_EFFECTS" / "LUTs" / f"{stem}.cube"
        if f.is_file():
            shutil.copyfile(f, OUT / "luts" / f"{stem}.cube")
            pack["looks"].append({"key": "lut_" + stem, "label": label, "file": f"{stem}.cube"})

    # reaction faces: 512 px transparent PNGs
    man = json.loads((src / "06_REACTIONS" / "manifest.json").read_text(encoding="utf-8"))
    for i, face in enumerate(man["faces"], 1):
        fid = f"fa0e0000{i:04x}"
        im = Image.open(src / "06_REACTIONS" / face["png"]).convert("RGBA")
        im.thumbnail((512, 512), Image.LANCZOS)
        im.save(OUT / "faces" / f"{fid}.png", "PNG", optimize=True)
        sfx = next((s["id"] for s in pack["sfx"] if s["name"].replace(" ", "_") == Path(face.get("suggested_sfx", "")).stem.split("_", 2)[-1]), "")
        pack["faces"].append({"id": fid, "name": re.sub(r"(?<!^)([A-Z])", r" \1", face["label"]), "when": face.get("expression", ""), "sfx": sfx})

    (OUT / "pack.json").write_text(json.dumps(pack, indent=1), encoding="utf-8")
    print(f"songs {len(pack['songs'])}, sounds {len(pack['sfx'])}, looks {len(pack['looks'])}, faces {len(pack['faces'])}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "G:/clipingvideos/ViralReelEditPack"))
