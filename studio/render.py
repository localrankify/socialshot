"""Turns a time range into a vertical clip: 9:16 layout, bouncy word captions, hook title, cover."""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import config, roman
from .media import NO_WINDOW, run

W, H = config.OUT_W, config.OUT_H

# ASS colours are &HBBGGRR. `size` is the ASS font size (line height); _Font turns it into real pixels.
STYLES = {
    # the default: SocialShot's own body font, white with a warm highlight, a thin edge and a soft shadow
    "studio": {"label": "Studio", "font": "Apfel Grotezk", "size": 104, "base": "FFFFFF", "active": "3BD4FF",
               "strong": "FFFFFF", "outline": 3, "pop": 106, "upper": False, "per": 3},
    "bounce": {"label": "Bounce", "font": "Poppins ExtraBold", "size": 132, "base": "FFFFFF", "active": "00F0FF",
               "strong": "FFFFFF", "outline": 7, "pop": 112, "upper": False, "per": 3},
    "hype": {"label": "Hype", "font": "Anton", "size": 152, "base": "FFFFFF", "active": "3C3CFF",
             "strong": "00D7FF", "outline": 7, "pop": 114, "upper": False, "per": 2},
    "clean": {"label": "Clean", "font": "Poppins ExtraBold", "size": 100, "base": "FFFFFF", "active": "6BD7FF",
              "strong": "FFFFFF", "outline": 5, "pop": 106, "upper": False, "per": 4},
}
HOOK = {"font": "Mazzard H", "size": 88, "ink": "14100E", "box": "FFFFFF", "pad_x": 40, "pad_y": 24, "radius": 20,
        "max_w": 940}
FONT_FILES = {"Poppins ExtraBold": "Poppins-ExtraBold.ttf", "Anton": "Anton-Regular.ttf", "Archivo Black": "ArchivoBlack-Regular.ttf",
              "Mazzard H": "MazzardH-Bold.otf", "Apfel Grotezk": "ApfelGrotezk-Regular.otf"}
CAP_MAX_W = 960   # captions never run wider than this, whatever is said
CAP_SHADOW = 4    # a soft half-black drop under the captions, for depth on any footage
_BUNDLED = Path(__file__).resolve().parent / "fonts"
_PATHS = {name: _BUNDLED / f for name, f in FONT_FILES.items()}   # the renderer's font name -> the font file

# Fonts people can pick in the clip editor. Three ship with SocialShot; the rest come from Google Fonts the first
# time someone uses them and are kept in the fonts folder after that.
FONTS = {
    "Poppins": {"ass": "Poppins ExtraBold", "google": "Poppins", "weight": 800},
    "Mazzard H": {"ass": "Mazzard H", "google": "Mazzard H", "weight": 700, "local": True},   # SocialShot's own heading font, shipped here
    "Apfel Grotezk": {"ass": "Apfel Grotezk", "google": "Apfel Grotezk", "weight": 400, "local": True},   # SocialShot's body font, shipped here
    "Anton": {"ass": "Anton", "google": "Anton", "weight": 400},
    "Archivo Black": {"ass": "Archivo Black", "google": "Archivo Black", "weight": 400},
    "Montserrat": {"google": "Montserrat", "weight": 800},
    "Bebas Neue": {"google": "Bebas Neue", "weight": 400},
    "Oswald": {"google": "Oswald", "weight": 700},
    "Bangers": {"google": "Bangers", "weight": 400},
    "Luckiest Guy": {"google": "Luckiest Guy", "weight": 400},
    "Lilita One": {"google": "Lilita One", "weight": 400},
    "Titan One": {"google": "Titan One", "weight": 400},
    "Fredoka": {"google": "Fredoka", "weight": 700},
    "Rubik": {"google": "Rubik", "weight": 800},
    "Inter": {"google": "Inter", "weight": 800},
    "Barlow Condensed": {"google": "Barlow Condensed", "weight": 800},
    "Russo One": {"google": "Russo One", "weight": 400},
    "Bungee": {"google": "Bungee", "weight": 400},
    "Permanent Marker": {"google": "Permanent Marker", "weight": 400},
    # more Google Fonts for captions: clean modern sans, bold display, a few with character
    "Outfit": {"google": "Outfit", "weight": 800},
    "Sora": {"google": "Sora", "weight": 800},
    "Plus Jakarta Sans": {"google": "Plus Jakarta Sans", "weight": 800},
    "Manrope": {"google": "Manrope", "weight": 800},
    "DM Sans": {"google": "DM Sans", "weight": 800},
    "Urbanist": {"google": "Urbanist", "weight": 800},
    "Lexend": {"google": "Lexend", "weight": 800},
    "Space Grotesk": {"google": "Space Grotesk", "weight": 700},
    "Archivo": {"google": "Archivo", "weight": 800},
    "Kanit": {"google": "Kanit", "weight": 800},
    "Unbounded": {"google": "Unbounded", "weight": 800},
    "Syne": {"google": "Syne", "weight": 800},
    "Righteous": {"google": "Righteous", "weight": 400},
    "Chakra Petch": {"google": "Chakra Petch", "weight": 700},
    "Paytone One": {"google": "Paytone One", "weight": 400},
    "Black Han Sans": {"google": "Black Han Sans", "weight": 400},
}

# Ready-made caption looks for the editor. A look is everything about the captions a person can change.
PRESETS = {
    "studio": {"label": "Studio", "font": "Apfel Grotezk", "size": 104, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 3, "outline": 3},
    "bounce": {"label": "Bounce", "font": "Poppins", "size": 132, "base": "#FFFFFF", "active": "#FFF000", "upper": False, "per": 3, "outline": 7},
    "hype": {"label": "Hype", "font": "Anton", "size": 152, "base": "#FFFFFF", "active": "#FF3C3C", "upper": False, "per": 2, "outline": 7},
    "clean": {"label": "Clean", "font": "Poppins", "size": 100, "base": "#FFFFFF", "active": "#FFD76B", "upper": False, "per": 4, "outline": 5},
    "boldpop": {"label": "Bold pop", "font": "Montserrat", "size": 122, "base": "#FFFFFF", "active": "#FFE500", "upper": False, "per": 3, "outline": 8},
    "headline": {"label": "Headline", "font": "Bebas Neue", "size": 176, "base": "#FFFFFF", "active": "#22E06B", "upper": True, "per": 3, "outline": 6},
    "comic": {"label": "Comic", "font": "Bangers", "size": 150, "base": "#FFFFFF", "active": "#FF4FD8", "upper": False, "per": 2, "outline": 8},
    "soft": {"label": "Soft", "font": "Fredoka", "size": 112, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 4, "outline": 6},
    "marker": {"label": "Marker", "font": "Permanent Marker", "size": 120, "base": "#FFFFFF", "active": "#FF8B33", "upper": False, "per": 3, "outline": 6},
    # newer looks, with Google Fonts; some sit on a box (cap_box / cap_op) instead of an outline
    "minimal": {"label": "Minimal", "font": "Outfit", "size": 98, "base": "#FFFFFF", "active": "#A3E635", "upper": False, "per": 3, "outline": 2},
    "boxed": {"label": "Boxed", "font": "Plus Jakarta Sans", "size": 96, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 3, "outline": 0,
              "cap_box": "#000000", "cap_op": 72},
    "paper": {"label": "Paper", "font": "Sora", "size": 92, "base": "#141416", "active": "#7C3AED", "upper": False, "per": 3, "outline": 0,
              "cap_box": "#FFFFFF", "cap_op": 100},
    "podcast": {"label": "Podcast", "font": "Manrope", "size": 92, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 4, "outline": 3},
    "tech": {"label": "Tech", "font": "Space Grotesk", "size": 104, "base": "#FFFFFF", "active": "#22E06B", "upper": False, "per": 3, "outline": 4},
    "street": {"label": "Street", "font": "Kanit", "size": 136, "base": "#FFFFFF", "active": "#FF3C3C", "upper": True, "per": 2, "outline": 7},
    "loud": {"label": "Loud", "font": "Unbounded", "size": 100, "base": "#FFFFFF", "active": "#FFE500", "upper": True, "per": 2, "outline": 6},
    "neon": {"label": "Neon", "font": "Lexend", "size": 108, "base": "#FFFFFF", "active": "#FF4FD8", "upper": False, "per": 3, "outline": 5},
}
_HEX = re.compile(r"#[0-9A-Fa-f]{6}")

# Colour looks for the whole video, picked in the editor's Effects. Applied before the captions are drawn,
# so the captions keep their own colours.
EFFECTS = {
    "none": "",
    "vivid": "eq=saturation=1.35:contrast=1.08",
    "bright": "eq=brightness=0.06:contrast=1.05:saturation=1.1",
    "warm": "colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06,eq=saturation=1.1",
    "cool": "colorbalance=rs=-0.06:bs=0.1:rm=-0.04:bm=0.08",
    "cinematic": "eq=contrast=1.12:saturation=0.85:brightness=-0.02,colorbalance=bs=0.05:rh=0.05",
    "vintage": "curves=preset=vintage",
    "bw": "hue=s=0,eq=contrast=1.1",
}
FADES = ("none", "black", "white")      # how a clip starts and ends: straight in, or a short fade from or to a colour
FADE_SECONDS = 0.5


def clean_look(look) -> dict | None:
    """A caption look from the editor, checked and limited. None means "use the clip's style as it is"."""
    if not isinstance(look, dict):
        return None
    base = PRESETS["studio"]
    num = lambda k, lo, hi: max(lo, min(hi, int(float(look.get(k, base.get(k, lo))))))   # noqa: E731
    colour = lambda k: look[k] if isinstance(look.get(k), str) and _HEX.fullmatch(look[k]) else base[k]   # noqa: E731
    y, hy = look.get("y"), look.get("hook_y")
    try:
        hook_size = max(50, min(140, int(float(look.get("hook_size", HOOK["size"])))))
    except (TypeError, ValueError):
        hook_size = HOOK["size"]
    return {"font": look["font"] if look.get("font") in FONTS else base["font"],
            "size": num("size", 60, 220), "outline": num("outline", 0, 12), "per": num("per", 1, 5),
            "base": colour("base").upper(), "active": colour("active").upper(), "upper": bool(look.get("upper", True)),
            "y": None if y is None else max(8.0, min(92.0, float(y))), "hook": bool(look.get("hook", True)),
            # the heading at the top: its own font, size and height
            "hook_font": look["hook_font"] if look.get("hook_font") in FONTS else "Mazzard H", "hook_size": hook_size,
            "hook_y": None if hy is None else max(5.0, min(95.0, float(hy))),
            "hook_dur": _hook_dur(look.get("hook_dur")),     # seconds the hook stays on screen; 0 is the whole clip
            # the hook's box and text: colours, how solid the box is (0 = no box, text with an outline), corners, letter gaps
            "hook_box": _hex(look.get("hook_box"), "#FFFFFF"), "hook_ink": _hex(look.get("hook_ink"), "#14100E"),
            "hook_op": _num(look.get("hook_op"), 0, 100, 100), "hook_round": _num(look.get("hook_round"), 0, 60, HOOK["radius"]),
            "hook_sp": _num(look.get("hook_sp"), -4, 24, 0),
            # the captions: extra room between letters and between words, and a box behind each line (0 = no box)
            "sp": _num(look.get("sp"), -4, 24, 0), "wgap": _num(look.get("wgap"), 0, 80, 0),
            "cap_box": _hex(look.get("cap_box"), "#000000"), "cap_op": _num(look.get("cap_op"), 0, 100, 0),
            "cap_round": _num(look.get("cap_round"), 0, 60, 18),
            # the person's brand on the video: their logo and name, where it sits, how big, how solid, how it moves
            "brand_on": bool(look.get("brand_on", False)), "brand_logo": bool(look.get("brand_logo", True)),
            "brand_text": re.sub(r"[\x00-\x1f\x7f]", "", str(look.get("brand_text") or ""))[:40],
            "brand_pos": look["brand_pos"] if look.get("brand_pos") in BRAND_POS else "tr",
            "brand_anim": look["brand_anim"] if look.get("brand_anim") in BRAND_ANIM else "float",
            "brand_size": _num(look.get("brand_size"), 40, 200, 84), "brand_op": _num(look.get("brand_op"), 20, 100, 90),
            # effects: a colour look, and how the clip starts and ends
            "effect": look["effect"] if look.get("effect") in EFFECTS else "none",
            "fade_in": look["fade_in"] if look.get("fade_in") in FADES else "none",
            "fade_out": look["fade_out"] if look.get("fade_out") in FADES else "none",
            "volume": _volume(look.get("volume"))}       # the sound, in percent of the normal level: 0 is silent, 200 twice as loud


BRAND_POS = ("tl", "tc", "tr", "bl", "bc", "br")
BRAND_ANIM = ("none", "float", "slide", "drift", "fade")
BRAND_MARGIN = 54


def brand_logo_path(uid: str) -> Path:
    """Where a person's logo is kept (a PNG they uploaded in the editor)."""
    return config.user_dir(uid) / "brand" / "logo.png"


def brand_badge(look: dict, logo_path: str, out: Path):
    """Draws the brand as one picture: the logo, then the name beside it in white with a soft shadow, at the
    chosen size and see-through level. Returns the file, or None when there is nothing to show."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    size, text = look["brand_size"], look["brand_text"].strip()
    logo = None
    if look["brand_logo"] and logo_path and Path(logo_path).is_file():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo = logo.resize((max(1, round(logo.width * size / logo.height)), size), Image.LANCZOS)
        except Exception:  # noqa: BLE001 - a broken logo file: show the name alone
            logo = None
    if not logo and not text:
        return None
    font = ImageFont.truetype(str(_PATHS.get("Mazzard H") or _PATHS["Poppins ExtraBold"]), max(18, round(size * 0.42)))
    tw = th = 0
    if text:
        box = font.getbbox(text)
        tw, th = box[2] - box[0], box[3] - box[1]
    gap = round(size * 0.22) if logo and text else 0
    pad = 8
    w = (logo.width if logo else 0) + gap + tw + pad * 2
    h = max(size if logo else 0, th) + pad * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = pad
    if logo:
        img.alpha_composite(logo, (x, (h - logo.height) // 2))
        x += logo.width + gap
    if text:
        ty = (h - th) // 2 - font.getbbox(text)[1]
        shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).text((x + 2, ty + 3), text, font=font, fill=(0, 0, 0, 150))
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3)))
        ImageDraw.Draw(img).text((x, ty), text, font=font, fill=(255, 255, 255, 255))
    if look["brand_op"] < 100:
        img.putalpha(img.getchannel("A").point(lambda v: round(v * look["brand_op"] / 100)))
    img.save(out, "PNG")
    return out


def brand_overlay(look: dict) -> tuple[str, str]:
    """ffmpeg pieces that lay the badge on the video and move it: (what the badge picture goes through, the overlay).
    The same motions are drawn in the editor's preview (editor.js, brandXY)."""
    m, pos, anim = BRAND_MARGIN, look["brand_pos"], look["brand_anim"]
    xs = {"l": f"{m}", "c": "(W-w)/2", "r": f"W-w-{m}"}
    ys = {"t": f"{m + 20}", "b": f"H-h-{m + 60}"}
    x, y = xs[pos[1]], ys[pos[0]]
    pre = "format=rgba"
    if anim == "float":                                    # a slow up-and-down, like it is resting on water
        y = f"{y}+10*sin(2*PI*t/2.6)"
    elif anim == "slide":                                  # comes in from its own side in the first 0.7 s
        k = "pow(max(0,1-t/0.7),3)"
        x = {"l": f"{m}-({m}+w)*{k}", "c": x, "r": f"W-w-{m}+({m}+w)*{k}"}[pos[1]]
        if pos[1] == "c":
            y = f"{y}-({m + 20}+h)*{k}" if pos[0] == "t" else f"{y}+({m + 60}+h)*{k}"
    elif anim == "drift":                                  # glides from one side to the other and back, every 14 s
        x = f"{m}+(W-w-{2 * m})*(0.5-0.5*cos(2*PI*t/14))"
    elif anim == "fade":                                   # fades in at the start
        pre += ",fade=t=in:st=0:d=0.8:alpha=1"
    return pre, f"overlay=x='{x}':y='{y}':shortest=1:format=auto"


def _hex(v, default) -> str:
    return v.upper() if isinstance(v, str) and _HEX.fullmatch(v) else default


def _num(v, lo, hi, default) -> int:
    try:
        return max(lo, min(hi, int(round(float(default if v is None else v)))))
    except (TypeError, ValueError):
        return default


def _bgr(h) -> str:
    """#RRGGBB to the BBGGRR order ASS colours use."""
    return h[5:7] + h[3:5] + h[1:3]


def _alpha(op) -> str:
    """Opacity in percent to an ASS alpha (00 is solid, FF is clear)."""
    return f"{round(255 * (1 - op / 100)):02X}"


def _rounded(x0, y0, x1, y1, r) -> str:
    """A rounded box as ASS drawing commands."""
    n = lambda v: f"{v:.0f}"                                                         # noqa: E731
    r = max(0.0, min(r, (y1 - y0) / 2, (x1 - x0) / 2))
    return (f"m {n(x0 + r)} {n(y0)} l {n(x1 - r)} {n(y0)} b {n(x1)} {n(y0)} {n(x1)} {n(y0)} {n(x1)} {n(y0 + r)} "
            f"l {n(x1)} {n(y1 - r)} b {n(x1)} {n(y1)} {n(x1)} {n(y1)} {n(x1 - r)} {n(y1)} "
            f"l {n(x0 + r)} {n(y1)} b {n(x0)} {n(y1)} {n(x0)} {n(y1)} {n(x0)} {n(y1 - r)} "
            f"l {n(x0)} {n(y0 + r)} b {n(x0)} {n(y0)} {n(x0)} {n(y0)} {n(x0 + r)} {n(y0)}")


def _volume(v) -> int:
    try:
        return max(0, min(200, int(round(float(100 if v is None else v)))))
    except (TypeError, ValueError):
        return 100


def _hook_dur(v) -> float:
    try:
        return max(0.0, min(60.0, round(float(v or 0) * 2) / 2))
    except (TypeError, ValueError):
        return 0.0


def effect_filters(look, dur) -> tuple[str, str, str]:
    """The ffmpeg pieces for a look's effects: (before the captions, after them, for the sound)."""
    if not look:
        return "", "", ""
    pre = EFFECTS.get(look.get("effect", "none"), "")
    post, audio, d = [], [], min(FADE_SECONDS, dur / 4)
    vol = look.get("volume", 100)
    if vol != 100:                     # after the level is evened out, so 100 is the normal loudness of every clip
        audio.append(f"volume={vol / 100:.2f}")
    if look.get("fade_in", "none") != "none":
        post.append(f"fade=t=in:st=0:d={d:.2f}:color={look['fade_in']}")
        audio.append(f"afade=t=in:st=0:d={d:.2f}")
    if look.get("fade_out", "none") != "none":
        post.append(f"fade=t=out:st={dur - d:.2f}:d={d:.2f}:color={look['fade_out']}")
        audio.append(f"afade=t=out:st={dur - d:.2f}:d={d:.2f}")
    return pre, ",".join(post), ",".join(audio)


def _family_name(path: Path) -> str:
    """The family name stored inside a font file, which is the name the caption renderer looks fonts up by."""
    import struct
    d = path.read_bytes()
    for i in range(struct.unpack(">H", d[4:6])[0]):
        tag, _, off, _ = struct.unpack(">4sIII", d[12 + 16 * i: 28 + 16 * i])
        if tag != b"name":
            continue
        _, count, strings = struct.unpack(">HHH", d[off: off + 6])
        for r in range(count):
            plat, enc, _, nid, ln, so = struct.unpack(">HHHHHH", d[off + 6 + 12 * r: off + 18 + 12 * r])
            if nid == 1 and plat == 3 and enc in (0, 1):
                return d[off + strings + so: off + strings + so + ln].decode("utf-16-be")
    raise ValueError("That font file has no name.")


_font_lock = __import__("threading").Lock()


def font_em(key: str) -> float | None:
    """How big a font's letters come out for each unit of caption size (the renderer sizes fonts by their full
    height, so this differs per font). The editor's preview uses it to draw text at the size the video will have.
    None for a Google font that has not been fetched yet."""
    f = FONTS.get(key)
    if not f:
        return None
    try:
        if "ass" in f and f["ass"] in _PATHS:
            return round(_Font.get(f["ass"]).em(1000) / 1000, 4)
        slug = re.sub(r"[^a-z0-9]+", "-", f["google"].lower()).strip("-")
        path = config.FONTS_DIR / f"g-{slug}-{f['weight']}.ttf"
        if path.is_file():
            name = _PATHS.setdefault(_family_name(path), path) and _family_name(path)
            return round(_Font.get(name).em(1000) / 1000, 4)
    except Exception:  # noqa: BLE001 - a font that cannot be read: the preview falls back to an estimate
        return None
    return None


def ensure_font(key: str) -> str:
    """Makes sure a font from FONTS is on this machine and returns its name for the caption renderer."""
    f = FONTS.get(key) or FONTS["Poppins"]
    if "ass" in f:
        return f["ass"]
    slug = re.sub(r"[^a-z0-9]+", "-", f["google"].lower()).strip("-")
    path = config.FONTS_DIR / f"g-{slug}-{f['weight']}.ttf"
    with _font_lock:
        if not path.is_file():
            import httpx
            family = f["google"].replace(" ", "+")
            css = httpx.get(f"https://fonts.googleapis.com/css2?family={family}:wght@{f['weight']}",
                            headers={"User-Agent": "SocialShot-fonts"}, timeout=20).text
            m = re.search(r"url\((https://fonts\.gstatic\.com/[^)\s]+\.ttf)\)", css)
            if not m:
                raise RuntimeError(f"Couldn't get the {key} font from Google Fonts.")
            r = httpx.get(m.group(1), timeout=30)
            r.raise_for_status()
            if len(r.content) > 5_000_000:
                raise RuntimeError(f"The {key} font is too large.")
            tmp = path.with_suffix(".part")
            tmp.write_bytes(r.content)
            tmp.replace(path)
        name = _family_name(path)
        _PATHS[name] = path
        return name


def look_style(look: dict) -> dict:
    """Turns an editor look into the style the caption builder draws with (ASS colours are BBGGRR)."""
    bgr = lambda h: h[5:7] + h[3:5] + h[1:3]   # noqa: E731
    return {"font": ensure_font(look["font"]), "size": look["size"], "base": bgr(look["base"]), "active": bgr(look["active"]),
            "strong": bgr(look["base"]), "outline": look["outline"], "pop": 112, "upper": look["upper"], "per": look["per"],
            "sp": look["sp"], "wgap": look["wgap"], "box": bgr(look["cap_box"]), "box_op": look["cap_op"], "box_r": look["cap_round"]}


class _Font:
    """Measures text exactly as the renderer will draw it, so every word can be placed by hand: the highlighted
    word can grow without pushing its neighbours, and the heading box fits its text."""
    _cache: dict = {}

    def __init__(self, name):
        import struct
        path = _PATHS.get(name) or _PATHS["Poppins ExtraBold"]
        d = path.read_bytes()
        tables = {}
        for i in range(struct.unpack(">H", d[4:6])[0]):
            tag, _, off, _ = struct.unpack(">4sIII", d[12 + 16 * i: 28 + 16 * i])
            tables[tag] = off
        self.upm = struct.unpack(">H", d[tables[b"head"] + 18: tables[b"head"] + 20])[0]
        o = tables[b"OS/2"]
        self.asc, self.desc = struct.unpack(">HH", d[o + 74: o + 78])      # what the renderer sizes the font by
        self.cap = struct.unpack(">h", d[o + 88: o + 90])[0] or int(self.upm * 0.7)
        self.path = str(path)
        self._pil = {}

    @classmethod
    def get(cls, name):
        if name not in cls._cache:
            cls._cache[name] = cls(name)
        return cls._cache[name]

    def em(self, size):
        return size * self.upm / (self.asc + self.desc)

    def width(self, text, size):
        """Pixels wide at this ASS size."""
        try:
            from PIL import ImageFont
            if "f" not in self._pil:
                self._pil["f"] = ImageFont.truetype(self.path, 200)
            return self._pil["f"].getlength(text) * self.em(size) / 200
        except Exception:  # noqa: BLE001 - no measuring library: a fair estimate keeps clips rendering
            return len(text) * self.em(size) * 0.62

    def cap_shift(self, size):
        """How far below the anchor the middle of a capital letter sits when text is centred on a point."""
        return ((self.asc - self.desc) / 2 - self.cap / 2) * size / (self.asc + self.desc)


CAPTION_LEAD = 0.0  # measured: word stamps are within 0.15 s of the voice, so no shift is needed
def install_fonts():
    """Copy the bundled caption fonts next to the data, so captions look the same on every machine and server."""
    src = Path(__file__).resolve().parent / "fonts"
    for f in [*src.glob("*.ttf"), *src.glob("*.otf")]:
        if not (config.FONTS_DIR / f.name).exists():
            shutil.copyfile(f, config.FONTS_DIR / f.name)


LAYOUTS = {"blur": "Full frame + blurred fill", "zoom": "Zoomed in + blurred fill", "crop": "Fill the screen (centre crop)"}


def _ts(t):
    t = max(0.0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    return f"{h}:{m:02d}:{t % 60:05.2f}"


def _clean(text):
    return re.sub(r"[\x00-\x1f\x7f]+", " ", re.sub(r"[{}\\]", "", str(text))).strip()


def _key(word):
    return re.sub(r"[^a-z0-9']", "", word.lower())


def _groups(words, per):
    out, cur = [], []
    for w in words:
        if cur and (len(cur) >= per or sum(len(x["w"]) for x in cur) + len(w["w"]) > 16
                    or w["s"] - cur[-1]["e"] > 0.45 or cur[-1]["w"][-1:] in ".?!"):
            out.append(cur)
            cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return out


def geometry(src_w, src_h, layout):
    """Where the video sits in the 1080x1920 frame, and where hook and captions go."""
    if src_h >= src_w and layout != "crop":
        layout = "crop"  # already vertical or square: nothing to gain from a blurred fill
    if layout == "blur":
        fg_h = min(H, int(round(W * src_h / src_w / 2)) * 2)
    elif layout == "zoom":
        fg_h = 1000
    else:
        fg_h = H
    top = (H - fg_h) // 2
    if layout == "crop":
        return layout, fg_h, 300, 1380
    return layout, fg_h, max(230, top - 190), min(1640, top + fg_h + 180)


def _hook_events(hook, dur, y, font=None, size=None, show=0.0, hk=None):
    """The heading: text in a rounded box that fits it, on one line or two balanced ones.
    `show` is how many seconds it stays (then it fades away); 0 keeps it for the whole clip.
    `hk` is the look from the editor: box and text colours, how solid the box is, its corners, the letter gaps.
    With little or no box the text gets a dark outline, so it still reads on any picture."""
    hk = hk or {}
    f, size = _Font.get(font or HOOK["font"]), size or HOOK["size"]
    sp, op = hk.get("hook_sp", 0), hk.get("hook_op", 100)
    out = 0
    if show and show < dur:
        dur, out = show, 250                      # gone after `show` seconds, with a short fade
    words = hook.split()
    if not words:
        return []
    wid = lambda t, z: f.width(t, z) + sp * max(0, len(t) - 1)                       # noqa: E731
    lines = [" ".join(words)]
    # one line, made a little smaller if it has to; only a hook too long to stay readable that way (under 60% of its
    # size) goes onto two lines, split where they come out most even
    if wid(lines[0], size) * 0.6 > HOOK["max_w"] and len(words) > 1:
        worst = {i: max(wid(" ".join(words[:i]), size), wid(" ".join(words[i:]), size)) for i in range(1, len(words))}
        best = min(worst.values())       # near ties (within 3%) go to the fuller top line, the same rule as the editor's preview
        cut = max(i for i, m in worst.items() if m <= best * 1.03)
        lines = [" ".join(words[:cut]), " ".join(words[cut:])]
    widest = max(wid(l, size) for l in lines)
    if widest > HOOK["max_w"]:
        size = max(40, int(size * HOOK["max_w"] / widest))
        widest = max(wid(l, size) for l in lines)
    line_h = f.em(size) * 1.16
    bw, bh = widest + 2 * HOOK["pad_x"], line_h * len(lines) + 2 * HOOK["pad_y"]
    x0, y0 = (W - bw) / 2, y - bh / 2
    span = f"{_ts(0)},{_ts(dur)}"
    ink = _bgr(hk["hook_ink"]) if "hook_ink" in hk else HOOK["ink"]
    ev = []
    if op > 0:
        box = _rounded(x0, y0, x0 + bw, y0 + bh, hk.get("hook_round", HOOK["radius"]))
        fill = _bgr(hk["hook_box"]) if "hook_box" in hk else HOOK["box"]
        ev.append(f"Dialogue: 3,{span},Hook,,0,0,0,,{{\\an7\\pos(0,0)\\fad(160,{out})\\c&H{fill}&\\1a&H{_alpha(op)}&\\p1}}{box}{{\\p0}}")
    edge = "" if op >= 35 else f"\\bord{max(3, size // 22)}\\3c&H000000&\\shad{CAP_SHADOW}\\4c&H000000&\\4a&H80&"
    tag = (f"\\fsp{sp}" if sp else "") + (f"\\c&H{ink}&" if ink != HOOK["ink"] else "") + edge
    for i, line in enumerate(lines):
        cy = y - line_h * (len(lines) - 1) / 2 + i * line_h - f.cap_shift(size)
        ev.append(f"Dialogue: 4,{span},Hook,,0,0,0,,{{\\an5\\pos({W // 2},{cy:.0f})\\fad(160,{out})\\fs{size}{tag}}}{line}")
    return ev


def build_ass(words, start, end, hook, style_name, highlight, hook_y, cap_y, hook_font=None, hook_size=None, hook_show=0.0, hk=None) -> str:
    """`style_name` is a key of STYLES, or a full style made from an editor look (see look_style).
    `hook_font` is the renderer's font name for the heading and `hook_size` its size; both default to HOOK."""
    st = style_name if isinstance(style_name, dict) else STYLES.get(style_name, STYLES["studio"])
    hook_font, hook_size = hook_font or HOOK["font"], hook_size or HOOK["size"]
    words = [dict(w, s=w["s"] - CAPTION_LEAD, e=w["e"] - CAPTION_LEAD) for w in words]
    strong = {_key(h) for h in highlight if _key(h)}
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{st['font']},{st['size']},&H00{st['base']},&H00{st['base']},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,{st['outline']},{CAP_SHADOW},5,0,0,0,1
Style: Hook,{hook_font},{hook_size},&H00{HOOK['ink']},&H00{HOOK['ink']},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    dur = end - start
    ev = _hook_events(_clean(hook), dur, hook_y, hook_font, hook_size, hook_show, hk)
    f = _Font.get(st["font"])
    inside = [dict(w, w=_clean(w["w"])) for w in words if w["s"] >= start - 0.05 and w["s"] < end]
    inside = sorted((w for w in inside if w["w"]), key=lambda w: w["s"])
    for i, w in enumerate(inside[:-1]):
        w["e"] = max(w["s"], min(w["e"], inside[i + 1]["s"]))
    groups = _groups(inside, st["per"])
    for gi, g in enumerate(groups):
        g_start = max(0.0, g[0]["s"] - start)
        g_end = min(g[-1]["e"] + 0.25, groups[gi + 1][0]["s"] if gi + 1 < len(groups) else end) - start
        if g_end - g_start < 0.02:
            continue
        texts = []
        for x in g:
            t = re.sub(r"[.,;:]+$", "", x["w"])
            texts.append(t.upper() if st["upper"] else t)
        if not st["upper"] and texts and texts[0][:1].islower():    # normal case: each line starts with a capital
            texts[0] = texts[0][0].upper() + texts[0][1:]
        if not all(roman.drawable(t) for t in texts):
            # A script the caption font cannot draw (Japanese, Thai, Chinese...): its words cannot be measured, so
            # they are not placed one by one. The line is drawn whole and centred, in a font the system has for it.
            line = " ".join(texts)
            fs = max(44, min(int(st["size"] * 0.7), int(1500 / max(1, len(line)) * 1.6)))
            ev.append(f"Dialogue: 1,{_ts(g_start)},{_ts(g_end)},Cap,,60,60,0,,{{\\an5\\pos({W // 2},{cap_y:.0f})\\q0\\fs{fs}}}{line}")
            continue
        size, sp, wgap = st["size"], st.get("sp", 0), st.get("wgap", 0)     # extra room between letters and between words
        wid = lambda t, z, sp=sp: f.width(t, z) + sp * max(0, len(t) - 1)          # noqa: E731
        gap = f.width("n n", size) - 2 * f.width("n", size) + (2 * st["outline"] + 6) * size / st["size"] + wgap   # a space, room for both outlines, and any extra
        total = sum(wid(t, size) for t in texts) + gap * (len(texts) - 1)
        if total > CAP_MAX_W:                                  # a long phrase: shrink it to fit, never run off the frame
            k = CAP_MAX_W / total
            size, sp, wgap = max(36, int(size * k)), sp * k, wgap * k
            wid = lambda t, z, sp=sp: f.width(t, z) + sp * max(0, len(t) - 1)      # noqa: E731
            gap = f.width("n n", size) - 2 * f.width("n", size) + (2 * st["outline"] + 6) * size / st["size"] + wgap
            total = sum(wid(t, size) for t in texts) + gap * (len(texts) - 1)
        cy = cap_y - f.cap_shift(size)
        x = (W - total) / 2
        if st.get("box_op", 0) > 0:                            # a box behind the whole line, under the words
            px, half = 0.3 * size, f.em(size) * 0.62
            box = _rounded(x - px, cap_y - half, x + total + px, cap_y + half, st.get("box_r", 18))
            ev.append(f"Dialogue: 0,{_ts(g_start)},{_ts(g_end)},Cap,,0,0,0,,{{\\an7\\pos(0,0)\\bord0\\shad0\\c&H{st['box']}&\\1a&H{_alpha(st['box_op'])}&\\p1}}{box}{{\\p0}}")
        p = st["pop"]
        for i, (w, t) in enumerate(zip(g, texts)):
            wd = wid(t, size)
            p = max(104, min(st["pop"], 100 + int(2200 / max(wd, 1))))   # long words grow less, so they never touch their neighbours
            pos = f"\\an5\\pos({x + wd / 2:.0f},{cy:.0f})\\fs{size}" + (f"\\fsp{sp:.1f}" if sp else "")
            x += wd + gap
            a = max(g_start, w["s"] - start)
            b = (g[i + 1]["s"] - start) if i + 1 < len(g) else g_end
            base = st["strong"] if _key(w["w"]) in strong else st["base"]
            if a - g_start >= 0.02:                                                   # waiting to be said
                ev.append(f"Dialogue: 1,{_ts(g_start)},{_ts(a)},Cap,,0,0,0,,{{{pos}\\c&H{base}&}}{t}")
            if b - a >= 0.02:                                                         # being said: colour and a quick pop, in front
                ev.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Cap,,0,0,0,,{{{pos}\\c&H{st['active']}&\\fscx94\\fscy94"
                          f"\\t(0,90,\\fscx{p}\\fscy{p})\\t(90,200,\\fscx{p - 5}\\fscy{p - 5})}}{t}")
            if g_end - b >= 0.02:                                                     # said
                ev.append(f"Dialogue: 1,{_ts(b)},{_ts(g_end)},Cap,,0,0,0,,{{{pos}\\c&H{base}&\\fscx{p - 5}\\fscy{p - 5}"
                          f"\\t(0,90,\\fscx100\\fscy100)}}{t}")
    return head + "\n".join(ev) + "\n"


def _keeps(cuts, dur):
    """The parts that stay, as (from, to) in seconds of the clip, when `cuts` (in seconds of the clip) are taken out."""
    keep, t = [], 0.0
    for a, b in sorted((max(0.0, a), min(dur, b)) for a, b in cuts):
        if b - a < 0.05:
            continue
        if a > t:
            keep.append((t, a))
        t = max(t, b)
    if t < dur:
        keep.append((t, dur))
    return keep


def _cut_words(words, start, keeps):
    """Words moved onto the shorter timeline once the cuts are gone; a word inside a cut is left out."""
    out = []
    for w in words:
        rs = w["s"] - start
        before, inside = 0.0, None
        for a, b in keeps:
            if a - 0.02 <= rs < b:
                inside = (a, b)
                break
            if rs >= b:
                before += b - a
        if inside is None:
            continue
        a, b = inside
        ns = before + (rs - a)
        ne = before + (min(w["e"] - start, b) - a)
        out.append(dict(w, s=round(start + ns, 3), e=round(start + max(ns, ne), 3)))
    return out


def _filter(layout, fg_h, sel=""):
    """`sel`: a select step that keeps only some parts (Speech cleanup), put right after the frame rate is set."""
    if layout == "crop":
        return f"[0:v]fps={config.OUT_FPS},{sel}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[v0];"
    return (f"[0:v]fps={config.OUT_FPS},{sel}split=2[a][b];"
            f"[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=6:2,"
            f"scale={W}:{H},eq=brightness=-0.14:saturation=1.15[bg];"
            f"[b]scale={W}:{fg_h}:force_original_aspect_ratio=increase,crop={W}:{fg_h}[fg];"
            f"[bg][fg]overlay=0:(H-h)/2,setsar=1[v0];")


_qsv_ok = None
RENDER_SECONDS = 600      # one clip's video encode; far beyond normal, so a frozen encoder is stopped, not waited on


def render_clip(src: Path, out_dir: Path, name: str, clip: dict, words: list, src_w: int, src_h: int) -> dict:
    """Writes <name>.mp4, <name>.jpg and <name>.ass into out_dir. Returns file names."""
    out_dir.mkdir(parents=True, exist_ok=True)
    start, end = clip["start"], clip["end"]
    layout, fg_h, hook_y, cap_y = geometry(src_w, src_h, clip.get("layout", "blur"))
    look = clean_look(clip.get("look"))
    style, hook = clip.get("style", "studio"), clip.get("hook", "")
    hook_font = hook_size = None
    hook_show = 0.0
    hk = brand = None
    if look:                                    # changed in the editor: its own font, colours, size and place
        style = look_style(look)
        if look["y"] is not None:
            cap_y = round(H * look["y"] / 100)
        if look["hook_y"] is not None:
            hook_y = round(H * look["hook_y"] / 100)
        hook_font, hook_size, hook_show = ensure_font(look["hook_font"]), look["hook_size"], look["hook_dur"]
        hk = {k: look[k] for k in ("hook_box", "hook_ink", "hook_op", "hook_round", "hook_sp")}
        brand = look if look["brand_on"] else None
        if not look["hook"]:
            hook = ""
    # Speech cleanup: the parts taken out are dropped from picture and sound, and the captions, the hook and the
    # fades are laid on the shorter clip that is left
    cuts = [(a - start, b - start) for a, b in clip.get("cuts") or []]
    keeps = _keeps(cuts, end - start) if cuts else None
    sel = asel = ""
    out_end = end
    if keeps and len(keeps) > 1 or (keeps and keeps[0] != (0.0, end - start)):
        expr = "+".join(f"between(t\\,{a:.3f}\\,{b:.3f})" for a, b in keeps)
        sel, asel = f"select='{expr}',setpts=N/FRAME_RATE/TB,", f"aselect='{expr}',asetpts=N/SR/TB,"
        words = _cut_words(words, start, keeps)
        out_end = start + sum(b - a for a, b in keeps)
    ass = build_ass(words, start, out_end, hook, style, clip.get("highlight_words", []), hook_y, cap_y, hook_font, hook_size, hook_show, hk)
    # The clip is made in a short work folder and moved into place afterwards. The caption step of ffmpeg cannot
    # open files whose full path is longer than 260 characters on Windows, which a data folder deep inside other
    # folders easily reaches. Inside the work folder every name is short and relative (a drive colon would also
    # break the filter syntax).
    fx = effect_filters(look, out_end - start)
    work = Path(tempfile.mkdtemp(prefix="pk"))
    try:
        badge = brand_badge(brand, clip.get("logo_path", ""), work / "badge.png") if brand else None
        return _render_in(work, src, out_dir, name, start, end, layout, fg_h, ass, fx, sel, asel,
                          brand_overlay(brand) if badge else None)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _render_in(work: Path, src: Path, out_dir: Path, name: str, start, end, layout, fg_h, ass: str, fx=("", "", ""), sel="", asel="",
               brand=None) -> dict:
    global _qsv_ok
    (work / f"{name}.ass").write_text(ass, encoding="utf-8")
    (work / "f").mkdir()
    for f in [*config.FONTS_DIR.glob("*.ttf"), *config.FONTS_DIR.glob("*.otf")]:
        shutil.copyfile(f, work / "f" / f.name)
    pre, post, audio = fx
    if brand:                                  # the brand badge goes on top of the captions, then the fades
        bpre, bover = brand
        fc = (_filter(layout, fg_h, sel) + f"[v0]{pre + ',' if pre else ''}ass={name}.ass:fontsdir=f[vc];"
              f"[1:v]{bpre}[lg];[vc][lg]{bover}{',' + post if post else ''}[v]")
        extra = ["-loop", "1", "-framerate", str(config.OUT_FPS), "-i", "badge.png"]
    else:
        fc = _filter(layout, fg_h, sel) + f"[v0]{pre + ',' if pre else ''}ass={name}.ass:fontsdir=f{',' + post if post else ''}[v]"
        extra = []
    base = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(src), *extra,
            "-filter_complex", fc, "-map", "[v]", "-map", "0:a:0", "-af", asel + "loudnorm=I=-14:TP=-1.5:LRA=11" + (f",{audio}" if audio else ""),
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-pix_fmt"]
    encoders = []
    if _qsv_ok is not False:
        encoders.append(("qsv", ["nv12", "-c:v", "h264_qsv", "-global_quality", "23", "-preset", "fast"]))
    encoders.append(("x264", ["yuv420p", "-c:v", "libx264", "-crf", "21", "-preset", "veryfast"]))
    err = None
    for label, enc in encoders:
        p = subprocess.run(base + enc + [f"{name}.mp4"], cwd=work, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", creationflags=NO_WINDOW, timeout=RENDER_SECONDS)
        if p.returncode == 0:
            if label == "qsv":
                _qsv_ok = True
            break
        err = p.stderr[-1200:]
        if label == "qsv":
            _qsv_ok = False
    else:
        raise RuntimeError(f"Render failed: {err}")
    cover_t = min(1.2, (end - start) / 2)
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{cover_t:.2f}", "-i", f"{name}.mp4", "-frames:v", "1",
         "-q:v", "3", f"{name}.jpg"], cwd=work)
    for ext in ("mp4", "jpg", "ass"):
        shutil.move(str(work / f"{name}.{ext}"), str(out_dir / f"{name}.{ext}"))
    return {"file": f"{name}.mp4", "cover": f"{name}.jpg", "layout": layout}
