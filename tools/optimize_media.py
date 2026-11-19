"""Makes the website's pictures, fonts and films light enough for slow connections, without visible loss.

    python tools/optimize_media.py

Safe to run again: a file is only replaced when the new one is smaller. What it does:
- web/brand/yt/*.jpg (YouTube thumbnails shown small in the headline and grids): at most 640 pixels wide
- other photos in web/brand (not the og-* share images): at most 1280 pixels wide
- every photo saved as a progressive JPEG (it shows a whole, blurry picture first instead of top to bottom)
- logo-mark.png: 400 pixels, enough for the largest place it is shown (200 pixels on a sharp screen)
- the Mazzard fonts: a .woff2 copy next to each .otf (about 40% smaller; the .otf stays for the image tools)
- reel.mp4: 1280 x 720, re-encoded for the web, starts playing before it has fully loaded"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "web" / "brand"
saved = 0


def smaller(path, write):
    """Write a new version next to `path`; keep it only if it is smaller."""
    global saved
    tmp = path.with_name(path.stem + ".tmp" + path.suffix)
    write(tmp)
    before, after = path.stat().st_size, tmp.stat().st_size
    if after < before * .97:
        tmp.replace(path)
        saved += before - after
        print(f"  {path.relative_to(BRAND)}: {before // 1024} KB -> {after // 1024} KB")
    else:
        tmp.unlink()


def photo(path, max_w, quality=80):
    im = Image.open(path)
    im.load()
    if im.mode != "RGB":
        im = im.convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    smaller(path, lambda out: im.save(out, "JPEG", quality=quality, optimize=True, progressive=True))


print("photos")
for p in sorted(BRAND.rglob("*.jpg")):
    if p.name.startswith("og-") or ".tmp" in p.name:
        continue
    photo(p, 640 if p.parent.name == "yt" else 1280, 76 if p.name == "reel-poster.jpg" else 80)

print("logo")
logo = BRAND / "logo-mark.png"
im = Image.open(logo).convert("RGBA")
if im.width > 400:
    im = im.resize((400, 400), Image.LANCZOS)
smaller(logo, lambda out: im.save(out, "PNG", optimize=True))

print("fonts")
try:
    from fontTools.ttLib import TTFont
    for otf in sorted(BRAND.glob("MazzardH-*.otf")):
        w2 = otf.with_suffix(".woff2")
        f = TTFont(otf)
        f.flavor = "woff2"
        f.save(w2)
        saved += otf.stat().st_size - w2.stat().st_size
        print(f"  {otf.name}: {otf.stat().st_size // 1024} KB -> {w2.name} {w2.stat().st_size // 1024} KB")
except ImportError:
    print("  skipped: pip install fonttools brotli")

print("film")
reel = BRAND / "reel.mp4"
ffmpeg = shutil.which("ffmpeg")
if ffmpeg and reel.is_file():
    def encode(out):
        subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(reel), "-an", "-vf", "scale=1280:-2:flags=lanczos",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-profile:v", "high", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(out)], check=True)
    smaller(reel, encode)
else:
    print("  skipped: ffmpeg not found")

print(f"saved {saved / 1e6:.1f} MB in all")
sys.exit(0)
