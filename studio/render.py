"""Turns a time range into a vertical clip: 9:16 layout, bouncy word captions, hook title, cover."""
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from . import config, roman
from .media import NO_WINDOW, run

W, H = config.OUT_W, config.OUT_H
# The shapes a clip can be made in, and the frame each one is drawn on. 9:16 is the default (Shorts, Reels,
# TikTok); 4:5 suits Instagram's feed; 1:1 is square; 16:9 is a normal wide video.
ASPECTS = {"9:16": (1080, 1920), "4:5": (1080, 1350), "1:1": (1080, 1080), "16:9": (1920, 1080)}
_frame = threading.local()      # the frame of the clip being made right now, per render thread


def _wh() -> tuple[int, int]:
    """The width and height of the frame the current clip is drawn on."""
    return getattr(_frame, "wh", (W, H))

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
    "Poppins": {"google": "Poppins", "weight": 600},          # semibold: lighter and cleaner than extra-bold
    "Mazzard H": {"ass": "Mazzard H", "google": "Mazzard H", "weight": 700, "local": True},   # SocialShot's own heading font, shipped here
    "Apfel Grotezk": {"ass": "Apfel Grotezk", "google": "Apfel Grotezk", "weight": 400, "local": True},   # SocialShot's body font, shipped here
    "Anton": {"ass": "Anton", "google": "Anton", "weight": 400},
    "Archivo Black": {"ass": "Archivo Black", "google": "Archivo Black", "weight": 400},
    "Montserrat": {"google": "Montserrat", "weight": 600},
    "Bebas Neue": {"google": "Bebas Neue", "weight": 400},
    "Oswald": {"google": "Oswald", "weight": 600},
    "Bangers": {"google": "Bangers", "weight": 400},
    "Luckiest Guy": {"google": "Luckiest Guy", "weight": 400},
    "Lilita One": {"google": "Lilita One", "weight": 400},
    "Titan One": {"google": "Titan One", "weight": 400},
    "Fredoka": {"google": "Fredoka", "weight": 600},
    "Rubik": {"google": "Rubik", "weight": 600},
    "Inter": {"google": "Inter", "weight": 600},
    "Barlow Condensed": {"google": "Barlow Condensed", "weight": 600},
    "Russo One": {"google": "Russo One", "weight": 400},
    "Bungee": {"google": "Bungee", "weight": 400},
    "Permanent Marker": {"google": "Permanent Marker", "weight": 400},
    # more Google Fonts for captions: clean modern sans, bold display, a few with character
    "Outfit": {"google": "Outfit", "weight": 600},
    "Sora": {"google": "Sora", "weight": 600},
    "Plus Jakarta Sans": {"google": "Plus Jakarta Sans", "weight": 600},
    "Manrope": {"google": "Manrope", "weight": 600},
    "DM Sans": {"google": "DM Sans", "weight": 600},
    "Urbanist": {"google": "Urbanist", "weight": 600},
    "Lexend": {"google": "Lexend", "weight": 600},
    "Space Grotesk": {"google": "Space Grotesk", "weight": 600},
    "Archivo": {"google": "Archivo", "weight": 600},
    "Kanit": {"google": "Kanit", "weight": 600},
    "Unbounded": {"google": "Unbounded", "weight": 600},
    "Syne": {"google": "Syne", "weight": 600},
    "Righteous": {"google": "Righteous", "weight": 400},
    "Chakra Petch": {"google": "Chakra Petch", "weight": 600},
    "Paytone One": {"google": "Paytone One", "weight": 400},
    "Black Han Sans": {"google": "Black Han Sans", "weight": 400},
    # a hand-picked set from Google Fonts (all free for commercial use): modern sans, display, serif, script, mono
    "Bricolage Grotesque": {"google": "Bricolage Grotesque", "weight": 600},
    "Geist": {"google": "Geist", "weight": 600},
    "Instrument Sans": {"google": "Instrument Sans", "weight": 600},
    "Host Grotesk": {"google": "Host Grotesk", "weight": 600},
    "Funnel Sans": {"google": "Funnel Sans", "weight": 600},
    "Funnel Display": {"google": "Funnel Display", "weight": 600},
    "Parkinsans": {"google": "Parkinsans", "weight": 600},
    "Elms Sans": {"google": "Elms Sans", "weight": 600},
    "Public Sans": {"google": "Public Sans", "weight": 600},
    "Work Sans": {"google": "Work Sans", "weight": 600},
    "Mona Sans": {"google": "Mona Sans", "weight": 600},
    "Inter Tight": {"google": "Inter Tight", "weight": 600},
    "IBM Plex Sans": {"google": "IBM Plex Sans", "weight": 600},
    "Onest": {"google": "Onest", "weight": 600},
    "Rethink Sans": {"google": "Rethink Sans", "weight": 600},
    "Schibsted Grotesk": {"google": "Schibsted Grotesk", "weight": 600},
    "Hanken Grotesk": {"google": "Hanken Grotesk", "weight": 600},
    "Figtree": {"google": "Figtree", "weight": 600},
    "Albert Sans": {"google": "Albert Sans", "weight": 600},
    "Be Vietnam Pro": {"google": "Be Vietnam Pro", "weight": 600},
    "Epilogue": {"google": "Epilogue", "weight": 600},
    "Familjen Grotesk": {"google": "Familjen Grotesk", "weight": 600},
    "Golos Text": {"google": "Golos Text", "weight": 600},
    "Reddit Sans": {"google": "Reddit Sans", "weight": 600},
    "Anybody": {"google": "Anybody", "weight": 600},
    "Moderustic": {"google": "Moderustic", "weight": 600},
    "Afacad": {"google": "Afacad", "weight": 600},
    "Scoutie Sans": {"google": "Scoutie Sans", "weight": 600},
    "Dela Gothic One": {"google": "Dela Gothic One", "weight": 400},
    "BBH Bogle": {"google": "BBH Bogle", "weight": 400},
    "Climate Crisis": {"google": "Climate Crisis", "weight": 400},
    "Ultra": {"google": "Ultra", "weight": 400},
    "Caprasimo": {"google": "Caprasimo", "weight": 400},
    "Graduate": {"google": "Graduate", "weight": 400},
    "Faculty Glyphic": {"google": "Faculty Glyphic", "weight": 400},
    "Liter": {"google": "Liter", "weight": 400},
    "Instrument Serif": {"google": "Instrument Serif", "weight": 400},
    "DM Serif Display": {"google": "DM Serif Display", "weight": 400},
    "Gloock": {"google": "Gloock", "weight": 400},
    "Marcellus": {"google": "Marcellus", "weight": 400},
    "Libre Caslon Display": {"google": "Libre Caslon Display", "weight": 400},
    "Gilda Display": {"google": "Gilda Display", "weight": 400},
    "Fraunces": {"google": "Fraunces", "weight": 600},
    "Playfair Display": {"google": "Playfair Display", "weight": 600},
    "Bodoni Moda": {"google": "Bodoni Moda", "weight": 600},
    "Libre Bodoni": {"google": "Libre Bodoni", "weight": 600},
    "Noto Serif Display": {"google": "Noto Serif Display", "weight": 600},
    "Montagu Slab": {"google": "Montagu Slab", "weight": 600},
    "Roboto Slab": {"google": "Roboto Slab", "weight": 600},
    "Zilla Slab": {"google": "Zilla Slab", "weight": 600},
    "Besley": {"google": "Besley", "weight": 600},
    "Sour Gummy": {"google": "Sour Gummy", "weight": 600},
    "Playpen Sans": {"google": "Playpen Sans", "weight": 600},
    "Ms Madi": {"google": "Ms Madi", "weight": 400},
    "Oooh Baby": {"google": "Oooh Baby", "weight": 400},
    "Nothing You Could Do": {"google": "Nothing You Could Do", "weight": 400},
    "DM Mono": {"google": "DM Mono", "weight": 500},
    "Geist Mono": {"google": "Geist Mono", "weight": 600},
    "Martian Mono": {"google": "Martian Mono", "weight": 600},
}

# Ready-made caption looks for the editor. A look is everything about the captions a person can change.
PRESETS = {
    "studio": {"label": "Studio", "font": "Apfel Grotezk", "size": 104, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 3, "outline": 3},
    "bounce": {"label": "Bounce", "font": "Poppins", "size": 132, "base": "#FFFFFF", "active": "#FFF000", "upper": False, "per": 3, "outline": 4},
    "hype": {"label": "Hype", "font": "Anton", "size": 152, "base": "#FFFFFF", "active": "#FF3C3C", "upper": False, "per": 2, "outline": 4},
    "clean": {"label": "Clean", "font": "Poppins", "size": 100, "base": "#FFFFFF", "active": "#FFD76B", "upper": False, "per": 4, "outline": 3},
    "boldpop": {"label": "Bold pop", "font": "Montserrat", "size": 122, "base": "#FFFFFF", "active": "#FFE500", "upper": False, "per": 3, "outline": 4},
    "headline": {"label": "Headline", "font": "Bebas Neue", "size": 176, "base": "#FFFFFF", "active": "#22E06B", "upper": True, "per": 3, "outline": 4},
    "comic": {"label": "Comic", "font": "Bangers", "size": 150, "base": "#FFFFFF", "active": "#FF4FD8", "upper": False, "per": 2, "outline": 5},
    "soft": {"label": "Soft", "font": "Fredoka", "size": 112, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 4, "outline": 4},
    "marker": {"label": "Marker", "font": "Permanent Marker", "size": 120, "base": "#FFFFFF", "active": "#FF8B33", "upper": False, "per": 3, "outline": 4},
    # newer looks, with Google Fonts; some sit on a box (cap_box / cap_op) instead of an outline
    "minimal": {"label": "Minimal", "font": "Outfit", "size": 98, "base": "#FFFFFF", "active": "#A3E635", "upper": False, "per": 3, "outline": 2},
    "boxed": {"label": "Boxed", "font": "Plus Jakarta Sans", "size": 96, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 3, "outline": 0,
              "cap_box": "#000000", "cap_op": 72},
    "paper": {"label": "Paper", "font": "Sora", "size": 92, "base": "#141416", "active": "#7C3AED", "upper": False, "per": 3, "outline": 0,
              "cap_box": "#FFFFFF", "cap_op": 100},
    "podcast": {"label": "Podcast", "font": "Manrope", "size": 92, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 4, "outline": 3},
    "tech": {"label": "Tech", "font": "Space Grotesk", "size": 104, "base": "#FFFFFF", "active": "#22E06B", "upper": False, "per": 3, "outline": 3},
    "street": {"label": "Street", "font": "Kanit", "size": 136, "base": "#FFFFFF", "active": "#FF3C3C", "upper": True, "per": 2, "outline": 4},
    "loud": {"label": "Loud", "font": "Unbounded", "size": 100, "base": "#FFFFFF", "active": "#FFE500", "upper": True, "per": 2, "outline": 4},
    "editorial": {"label": "Editorial", "font": "Instrument Serif", "size": 128, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 3, "outline": 3},
    "grotesk": {"label": "Grotesk", "font": "Bricolage Grotesque", "size": 108, "base": "#FFFFFF", "active": "#A3E635", "upper": False, "per": 3, "outline": 3},
    "geist": {"label": "Geist", "font": "Geist", "size": 100, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 3, "outline": 0,
              "cap_box": "#000000", "cap_op": 60},
    "poster": {"label": "Poster", "font": "Dela Gothic One", "size": 104, "base": "#FFFFFF", "active": "#FF3C3C", "upper": True, "per": 2, "outline": 4},
    "vogue": {"label": "Vogue", "font": "Bodoni Moda", "size": 116, "base": "#FFFFFF", "active": "#F5D0A9", "upper": False, "per": 3, "outline": 2},
    "gummy": {"label": "Gummy", "font": "Sour Gummy", "size": 116, "base": "#FFFFFF", "active": "#FF8BD1", "upper": False, "per": 3, "outline": 4},
    "neon": {"label": "Neon", "font": "Lexend", "size": 108, "base": "#FFFFFF", "active": "#FF4FD8", "upper": False, "per": 3, "outline": 3},
    # words on a soft rounded box behind each line, the spoken word in colour (the "subtitle pill" look)
    "pill": {"label": "Pill", "font": "Inter", "size": 84, "base": "#FFFFFF", "active": "#FFD43B", "upper": False, "per": 4, "outline": 0,
             "cap_box": "#111114", "cap_op": 62, "cap_round": 22, "weight": 700},
    "pillpop": {"label": "Pill pop", "font": "Montserrat", "size": 92, "base": "#FFFFFF", "active": "#22E06B", "upper": False, "per": 3, "outline": 0,
                "cap_box": "#000000", "cap_op": 78, "cap_round": 14, "weight": 800},
    "pilllight": {"label": "Pill light", "font": "Plus Jakarta Sans", "size": 86, "base": "#141416", "active": "#E11D48", "upper": False, "per": 4,
                  "outline": 0, "cap_box": "#FFFFFF", "cap_op": 94, "cap_round": 22, "weight": 700},
    "glassbox": {"label": "Glass box", "font": "Manrope", "size": 88, "base": "#FFFFFF", "active": "#7CC8FF", "upper": False, "per": 4, "outline": 0,
                 "cap_box": "#0B0B0F", "cap_op": 42, "cap_round": 28, "weight": 700},
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
from . import pack as _pack                        # noqa: E402 - the built-in edit pack
for _lk in _pack.looks():                          # its colour looks (LUTs), applied from a copy in the work folder
    EFFECTS[_lk["key"]] = "lut3d=look.cube"
FADES = ("none", "black", "white")      # how a clip starts and ends: straight in, or a short fade from or to a colour
FADE_SECONDS = 0.5


WEIGHTS = (300, 400, 500, 600, 700, 800)       # Light, Regular, Medium, Semibold, Bold, Black


def _weight(v):
    """A letter weight picked in the editor, or None for the font's own."""
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    return v if v in WEIGHTS else None


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
            # where across the frame they sit, as a percent of its width (None: the middle). Dragged in the editor.
            "x": _pct(look.get("x")), "hook_x": _pct(look.get("hook_x")),
            "hook_dur": _hook_dur(look.get("hook_dur")),     # seconds the hook stays on screen; 0 is the whole clip
            # the hook's box and text: colours, how solid the box is (0 = no box, text with an outline), corners, letter gaps
            "hook_box": _hex(look.get("hook_box"), "#FFFFFF"), "hook_ink": _hex(look.get("hook_ink"), "#14100E"),
            "hook_op": _num(look.get("hook_op"), 0, 100, 100), "hook_round": _num(look.get("hook_round"), 0, 60, HOOK["radius"]),
            "hook_sp": _num(look.get("hook_sp"), -4, 24, 0),
            # the hook's letters (as typed, CAPITALS, Title Case, lower) and its box: fitted to the text, the full
            # width of the frame, one box per line, or none (the text with an outline)
            "hook_case": look["hook_case"] if look.get("hook_case") in ("asis", "upper", "title", "lower") else "asis",
            "hook_banner": look["hook_banner"] if look.get("hook_banner") in ("fit", "full", "line", "none") else "fit",
            # the captions: extra room between letters and between words, and a box behind each line (0 = no box)
            "sp": _num(look.get("sp"), -4, 24, 0), "wgap": _num(look.get("wgap"), 0, 80, 0),
            "cap_box": _hex(look.get("cap_box"), "#000000"), "cap_op": _num(look.get("cap_op"), 0, 100, 0),
            "cap_round": _num(look.get("cap_round"), 0, 60, 18),
            # how heavy and in what style the letters are (None: the font's own weight), for captions and hook
            "weight": _weight(look.get("weight")), "italic": bool(look.get("italic")), "underline": bool(look.get("underline")),
            "hook_weight": _weight(look.get("hook_weight")), "hook_italic": bool(look.get("hook_italic")),
            "hook_underline": bool(look.get("hook_underline")),
            # the person's brand on the video: their logo and name, where it sits, how big, how solid, how it moves
            "brand_on": bool(look.get("brand_on", False)), "brand_logo": bool(look.get("brand_logo", True)),
            "brand_text": re.sub(r"[\x00-\x1f\x7f]", "", str(look.get("brand_text") or ""))[:40],
            "brand_pos": look["brand_pos"] if look.get("brand_pos") in BRAND_POS else "tr",
            "brand_anim": look["brand_anim"] if look.get("brand_anim") in BRAND_ANIM else "float",
            "brand_size": _num(look.get("brand_size"), 40, 200, 84), "brand_op": _num(look.get("brand_op"), 20, 100, 90),
            # the social watermark (brand_kind "social"): a small header line, a platform icon (or the logo) with the
            # handle, and a hashtag line under a dashed rule, in one font and colour
            "brand_kind": "social" if look.get("brand_kind") == "social" else "badge",
            "brand_head": _line(look.get("brand_head"), 40), "brand_handle": _line(look.get("brand_handle"), 40),
            "brand_icon": look["brand_icon"] if look.get("brand_icon") in WM_ICONS else "youtube",
            "brand_tag": _line(look.get("brand_tag"), 40), "brand_tag_on": bool(look.get("brand_tag_on", False)),
            "brand_font": look["brand_font"] if look.get("brand_font") in FONTS else "Inter",
            "brand_color": _hex(look.get("brand_color"), "#FFFFFF"),
            "aspect": look["aspect"] if look.get("aspect") in ASPECTS else "9:16",     # the clip's shape
            "split": clean_split(look.get("split")),           # the split layout's stream and face cam parts
            # the part of the picture shown (Frame view), for every layout but split; None is the whole picture
            "frame": _region(look["frame"], [0, 0, 1, 1]) if isinstance(look.get("frame"), list) else None,
            "card": clean_card(look.get("card")),              # the post card layout's account, words and look
            "music": clean_music(look.get("music")),           # a track from the music library under the clip
            "outro": clean_outro(look.get("outro")),           # a few seconds after the clip: a card or a file
            "overlays": clean_overlays(look.get("overlays")),  # pictures placed on the video for a while
            "zooms": clean_zooms(look.get("zooms")),           # moments the video punches in, on a face, with a look
            "sfx": clean_sfx(look.get("sfx")),                 # sound effects at moments of the video (the built-in pack)
            # Blurred fill and Zoomed: what is behind the video, room around it, and its corners
            "bg": clean_bg(look.get("bg")), "pad": _num(look.get("pad"), 0, 140, 0), "vradius": _num(look.get("vradius"), 0, 60, 0),
            # a border on the video (Layout): its width at 1080 wide (0: none) and colour
            "stroke": _num(look.get("stroke"), 0, 24, 0), "stroke_color": _hex(look.get("stroke_color"), "#FFFFFF"),
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
    if look.get("brand_kind") == "social":
        img = social_badge(look, logo_path)
        if img is None:
            return None
        if look["brand_op"] < 100:
            img.putalpha(img.getchannel("A").point(lambda v: round(v * look["brand_op"] / 100)))
        img.save(out, "PNG")
        return out
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


# ---------------------------------------------------------------- the post card layout ("card")
# The clip shown inside a social post, like a screenshot of an X post: the account's picture, name, blue check and
# handle, the post's words, then the video with rounded corners and the captions under it. The editor draws the
# same card from the same numbers (editor.js, cardGeo), so the preview and the saved clip match.
# kind: how the account line reads. "x": name, check, then @handle under it. "linkedin": name, check, then the
# headline (the handle field) and "1h". "threads": the handle alone in bold with the check, and "1h" beside it.
CARD_THEMES = {"light": {"bg": "#FFFFFF", "ink": "#0F1419", "sub": "#536471", "acc": "#1D9BF0", "kind": "x"},
               "dark": {"bg": "#000000", "ink": "#E7E9EA", "sub": "#71767B", "acc": "#1D9BF0", "kind": "x"},
               "linkedin": {"bg": "#FFFFFF", "ink": "#191919", "sub": "#666666", "acc": "#0A66C2", "kind": "linkedin"},
               "threads": {"bg": "#FFFFFF", "ink": "#000000", "sub": "#999999", "acc": "#0095F6", "kind": "threads"},
               "threads_dark": {"bg": "#101010", "ink": "#F3F5F7", "sub": "#777777", "acc": "#0095F6", "kind": "threads"}}
CARD_BLUE = "#1D9BF0"


def card_account(card: dict) -> tuple:
    """(the bold line, the grey line under it or beside it) for the card's style. Same in editor.js (cardAccount)."""
    th = CARD_THEMES[card["theme"]]
    name = card["name"] or "SocialShot"
    handle = card["handle"] or re.sub(r"[^a-z0-9_]", "", name.lower()) or "socialshot"
    if th["kind"] == "linkedin":
        return name, f"{card['handle'] or 'Creator'} · 1h"
    if th["kind"] == "threads":
        return handle, "1h"
    return name, "@" + handle


def clean_card(v) -> dict:
    v = v if isinstance(v, dict) else {}
    txt = lambda k, n: re.sub(r"[\x00-\x1f\x7f]", " ", str(v.get(k) or "")).strip()[:n]   # noqa: E731
    return {"theme": v["theme"] if v.get("theme") in CARD_THEMES else "light", "name": txt("name", 40),
            "handle": txt("handle", 30).lstrip("@"), "text": txt("text", 220), "verified": bool(v.get("verified", True)),
            "radius": _num(v.get("radius"), 0, 60, 28), "avatar": "initial" if v.get("avatar") == "initial" else "logo",
            # behind the card: nothing (the card fills the frame), a gradient with fine grain, or the video blurred.
            # With a backdrop the card floats as a rounded panel with a soft shadow.
            "back": v["back"] if v.get("back") in ("none", "gradient", "blur") else "gradient",
            "g1": _hex(v.get("g1"), "#0F172A"), "g2": _hex(v.get("g2"), "#334155"), "grain": bool(v.get("grain", True)),
            # where and how big: moved by dx/dy (% of the frame) and scaled (% of its normal size) by dragging it in the
            # editor; pad is the room inside the floating card
            "scale": _num(v.get("scale"), 50, 130, 100), "dx": _num(v.get("dx"), -60, 60, 0), "dy": _num(v.get("dy"), -60, 60, 0),
            "pad": _num(v.get("pad"), 16, 90, 40)}


# ---------------------------------------------------------------- background music
# A track from the person's music library (uploaded in the editor, kept as AAC under their folder) mixed under the
# clip. "duck" lowers the music while someone speaks (the voice drives a compressor on the music), so words stay
# clear. The music is evened out like the voice, then set to `vol` percent of it.
_MUSIC_ID = re.compile(r"^[a-f0-9]{8,24}$")


def clean_bg(v) -> dict:
    """Behind the video in Blurred fill and Zoomed: a blurred copy of it (the default), one colour, or a gradient
    from the first colour at the top to the second at the bottom."""
    v = v if isinstance(v, dict) else {}
    return {"kind": v["kind"] if v.get("kind") in ("blur", "color", "gradient") else "blur",
            "c1": _hex(v.get("c1"), "#111114"), "c2": _hex(v.get("c2"), "#3A1C24")}


def bg_picture(bg: dict, out: Path):
    """The gradient behind the video, as a picture the size of the frame."""
    from PIL import Image
    Wd, Hd = _wh()
    a, b = (tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in (bg["c1"], bg["c2"]))
    col = Image.new("RGB", (1, 256))
    for y in range(256):
        col.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * y / 255) for i in range(3)))
    col.resize((Wd, Hd), Image.BILINEAR).save(out, "PNG")


def round_mask(w: int, h: int, radius: int, out: Path):
    """A white rounded rectangle on black: the shape that rounds a video's corners."""
    from PIL import Image, ImageDraw
    m = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius=radius * 2, fill=255)
    m.resize((w, h), Image.LANCZOS).save(out, "PNG")


def pip_ring(g: dict, out: Path):
    """The white edge around picture in picture's small box: a white rounded rectangle a little bigger than the
    box (the video covers its middle), with a soft dark line outside so it stands off any picture."""
    from PIL import Image, ImageDraw
    b, w, h = g["b"], g["w"] + 2 * g["b"], g["h"] + 2 * g["b"]
    c = g.get("color") or "#FFFFFF"
    rgb = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    im = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius=(g["r"] + b) * 2 if g["r"] else 0, fill=rgb + (255 if b else 0,))
    im.resize((w, h), Image.LANCZOS).save(out, "PNG")


def music_path(uid: str, mid: str) -> Path:
    return _pack.song_path(mid) or config.user_dir(uid) / "music" / f"{mid}.m4a"


def media_path(uid: str, mid: str) -> Path:
    """A picture (PNG) or short video (MP4) from the person's media library."""
    p = _pack.face_path(mid)
    if p:
        return p
    d = config.user_dir(uid) / "media"
    png = d / f"{mid}.png"
    return png if png.is_file() else d / f"{mid}.mp4"


# ---------------------------------------------------------------- outro: a few seconds after the clip
# Either a card (a canvas colour, a picture, a title and a line under it) drawn here, or a picture or video from the
# media library. The music rises into it (music "rise"). The editor draws the same card from outro_geometry.
OUTRO_BG = {"black": "#0E0E10", "white": "#FFFFFF", "gray": "#2A2A2E"}


def clean_outro(v) -> dict:
    v = v if isinstance(v, dict) else {}
    pic, f = str(v.get("pic") or ""), str(v.get("file") or "")
    try:
        secs = max(1.5, min(8.0, float(v.get("secs") or 3)))
    except (TypeError, ValueError):
        secs = 3.0
    return {"on": bool(v.get("on")), "kind": "file" if v.get("kind") == "file" else "card", "secs": round(secs, 1),
            "bg": _hex(v.get("bg"), OUTRO_BG["black"]), "pic": pic if pic == "logo" or _MUSIC_ID.match(pic) else "",
            "pic_size": _num(v.get("pic_size"), 60, 600, 270), "pic_round": _num(v.get("pic_round"), 0, 50, 0),
            "title": _line(v.get("title"), 60), "sub": _line(v.get("sub"), 60), "file": f if _MUSIC_ID.match(f) else ""}


def outro_geometry(Wd, Hd, o: dict, has_pic: bool) -> dict:
    """Where the outro card's picture, title and line go (centred as one block). Same in editor.js (outroGeo)."""
    u = min(Wd, Hd * 9 / 16) / 1080
    ps = round(o["pic_size"] * u) if has_pic else 0
    parts = [ps] if has_pic else []
    if o["title"]:
        parts.append(round(64 * u))
    if o["sub"]:
        parts.append(round(44 * u))
    gaps = {"pic": round(36 * u), "text": round(10 * u)}
    total = sum(parts) + (gaps["pic"] if has_pic and (o["title"] or o["sub"]) else 0) + (gaps["text"] if o["title"] and o["sub"] else 0)
    y = (Hd - total) / 2
    g = {"u": u, "ps": ps, "pic_y": round(y)}
    y += ps + (gaps["pic"] if has_pic and (o["title"] or o["sub"]) else 0)
    g["title_y"] = round(y + 32 * u)                 # the middle of each text line
    y += (round(64 * u) + (gaps["text"] if o["sub"] else 0)) if o["title"] else 0
    g["sub_y"] = round(y + 22 * u)
    return g


def _ink_for(bg: str) -> tuple:
    """Text colours that read on a canvas: dark on light ones, white on dark ones."""
    r, gg, b = (int(bg[i:i + 2], 16) for i in (1, 3, 5))
    light = 0.299 * r + 0.587 * gg + 0.114 * b > 150
    return ("#111114", "#55555C") if light else ("#FFFFFF", "#A1A1AA")


def outro_card(o: dict, pic_path: str, out: Path):
    from PIL import Image, ImageDraw, ImageFont
    Wd, Hd = _wh()
    pic = None
    if pic_path and Path(pic_path).is_file():
        try:
            pic = Image.open(pic_path).convert("RGBA")
        except Exception:  # noqa: BLE001
            pic = None
    g = outro_geometry(Wd, Hd, o, pic is not None)
    img = Image.new("RGB", (Wd, Hd), o["bg"])
    ink, sub = _ink_for(o["bg"])
    if pic is not None:
        ps = g["ps"]
        pic.thumbnail((ps, ps), Image.LANCZOS)
        mask = Image.new("L", (pic.width * 4, pic.height * 4), 0)
        rad = min(pic.width, pic.height) * 4 * o["pic_round"] / 100
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, pic.width * 4 - 1, pic.height * 4 - 1), radius=rad, fill=255)
        mask = mask.resize(pic.size, Image.LANCZOS)
        alpha = Image.composite(pic.getchannel("A"), Image.new("L", pic.size, 0), mask)
        img.paste(pic.convert("RGB"), (round((Wd - pic.width) / 2), g["pic_y"] + round((ps - pic.height) / 2)), alpha)
    d = ImageDraw.Draw(img)
    u = g["u"]
    if o["title"]:
        d.text((Wd / 2, g["title_y"]), o["title"], font=ImageFont.truetype(_font_file("Inter", 700), round(52 * u)), fill=ink, anchor="mm")
    if o["sub"]:
        d.text((Wd / 2, g["sub_y"]), o["sub"], font=ImageFont.truetype(_font_file("Inter", 500), round(34 * u)), fill=sub, anchor="mm")
    img.save(out, "PNG")


# ---------------------------------------------------------------- zoom moments
# The video (not the captions, hook, pictures or brand) punches in on a point for a moment, easing in and out, with
# its own look. x/y is the point in % of the frame. The editor shows the same zoom (editor.js, zoomAt) and the same
# looks (ZOOM_FX there).
ZOOM_FX = {"none": "", "bw": "hue=s=0", "warm": "colorbalance=rs=.12:gs=.03:bs=-.1", "cool": "colorbalance=rs=-.08:bs=.12",
           "punch": "eq=contrast=1.22:saturation=1.4", "vintage": "curves=preset=vintage", "grain": "noise=alls=22:allf=t"}
ZOOM_EASE = 0.6          # seconds to glide in and out (less on short zooms), on an S-curve


def clean_zooms(v) -> list:
    out = []
    for z in (v if isinstance(v, list) else [])[:12]:
        if not isinstance(z, dict):
            continue
        try:
            a, b = float(z.get("a")), float(z.get("b"))
        except (TypeError, ValueError):
            continue
        if b - a < 0.3:
            continue
        pct = lambda k, d: max(0.0, min(100.0, float(z.get(k, d))))   # noqa: E731
        out.append({"a": round(a, 2), "b": round(b, 2), "s": round(max(1.1, min(3.0, float(z.get("s") or 1.8))), 2),
                    "x": round(pct("x", 50), 2), "y": round(pct("y", 40), 2),
                    "fx": z["fx"] if z.get("fx") in ZOOM_FX else "none", "ease": bool(z.get("ease", True)),
                    # a reaction face that pops in for the zoom (a built-in face id), with its sound
                    "react": z["react"] if _pack.face_path(str(z.get("react") or "")) else ""})
    out.sort(key=lambda z: z["a"])
    return out


def clean_sfx(v) -> list:
    """Sound effects from the built-in pack: which one, when (seconds of the video) and how loud (%)."""
    out = []
    for x in (v if isinstance(v, list) else [])[:60]:
        if not isinstance(x, dict) or not _pack.sfx_path(str(x.get("id") or "")):
            continue
        try:
            t = float(x.get("t"))
        except (TypeError, ValueError):
            continue
        out.append({"id": x["id"], "t": round(max(0.0, t), 2), "vol": _num(x.get("vol"), 0, 200, 100)})
    out.sort(key=lambda x: x["t"])
    return out


def zoom_filter(zooms: list, W: int, H: int, fps: int) -> str:
    """The zooms as one zoompan step (how far in at each moment and where), then each zoom's look for its time.
    `zooms`: [(from, to, strength, x 0-1, y 0-1, look, ease)] in seconds of the finished clip."""
    def ramp(a, b, ease):
        if not ease:
            return f"between(it,{a:.2f},{b:.2f})"
        e = max(0.05, min(ZOOM_EASE, (b - a) / 2))
        p = f"max(0,min(1,min((it-{a:.2f})/{e:.3f},({b:.2f}-it)/{e:.3f})))"
        return f"({p}*{p}*(3-2*{p}))"           # smoothstep: starts and lands softly, like the editor's zoomAt
    z = "1+" + "+".join(f"({s - 1:.3f})*{ramp(a, b, ease)}" for a, b, s, x, y, fx, ease in zooms)
    fx_ = "0.5"
    fy_ = "0.5"
    for a, b, s, x, y, fx, ease in reversed(zooms):     # the point of whichever zoom is on (the middle otherwise)
        fx_ = f"if(between(it,{a - 0.01:.2f},{b + 0.01:.2f}),{x:.4f},{fx_})"
        fy_ = f"if(between(it,{a - 0.01:.2f},{b + 0.01:.2f}),{y:.4f},{fy_})"
    # the window stays inside the picture: its middle is kept at least half a window from each edge
    xs = f"max(0,min(iw-iw/zoom,({fx_})*iw-iw/zoom/2))"
    ys = f"max(0,min(ih-ih/zoom,({fy_})*ih-ih/zoom/2))"
    out = f"zoompan=z='{z}':x='{xs}':y='{ys}':d=1:s={W}x{H}:fps={fps}"
    for a, b, s, x, y, fx, ease in zooms:
        if ZOOM_FX.get(fx):
            out += f",{ZOOM_FX[fx]}:enable='between(t,{a:.2f},{b:.2f})'"
    return out


# ---------------------------------------------------------------- pictures placed on the video
def clean_overlays(v) -> list:
    """Up to 8 pictures from the media library: where (the middle, in % of the frame), how wide (% of the frame's
    width), from and to (seconds of the video) and how solid."""
    out = []
    for o in (v if isinstance(v, list) else [])[:8]:
        if not isinstance(o, dict) or not _MUSIC_ID.match(str(o.get("id") or "")):
            continue
        try:
            a, b = float(o.get("a")), float(o.get("b"))
        except (TypeError, ValueError):
            continue
        if b - a < 0.2:
            continue
        pct = lambda k, lo, hi, d: max(lo, min(hi, float(o.get(k, d))))   # noqa: E731
        out.append({"id": o["id"], "x": round(pct("x", 0, 100, 50), 2), "y": round(pct("y", 0, 100, 50), 2),
                    "w": round(pct("w", 3, 100, 30), 2), "a": round(a, 2), "b": round(b, 2), "op": _num(o.get("op"), 10, 100, 100)})
    return out


def clean_music(v) -> dict:
    v = v if isinstance(v, dict) else {}
    mid = str(v.get("id") or "")
    try:
        at = max(0.0, min(3600.0, float(v.get("at") or 0)))
    except (TypeError, ValueError):
        at = 0.0
    try:
        peak_at = None if v.get("peak_at") in (None, "") else max(0.0, min(3600.0, float(v["peak_at"])))
    except (TypeError, ValueError):
        peak_at = None
    try:
        off = max(0.0, min(3600.0, float(v.get("off") or 0)))
    except (TypeError, ValueError):
        off = 0.0
    try:
        till = None if v.get("till") in (None, "") else max(off + 0.5, min(3600.0, float(v["till"])))
    except (TypeError, ValueError):
        till = None
    return {"id": mid if _MUSIC_ID.match(mid) else "", "vol": _num(v.get("vol"), 0, 100, 25), "duck": bool(v.get("duck", True)),
            "loop": bool(v.get("loop", True)), "fade": bool(v.get("fade", True)), "at": round(at, 2),
            # the rise into the outro: from `vol` to `peak` over `rise` seconds, ending as the outro starts. `peak_at`
            # is the moment in the song (its drop) that should land right on the outro; it sets where the song starts.
            "peak": _num(v.get("peak"), 0, 100, 100), "rise": _secs(v.get("rise"), 0, 10, 3),
            # rise at the end of the clip itself, when there is no outro to rise into
            "rise_on": bool(v.get("rise_on", False)),
            "peak_at": None if peak_at is None else round(peak_at, 2),
            # where the music sits on the timeline: it starts `off` seconds into the clip and stops at `till` (None: the end)
            "off": round(off, 2), "till": None if till is None else round(till, 2)}


def _secs(v, lo, hi, default) -> float:
    try:
        return round(max(lo, min(hi, float(v))), 1)
    except (TypeError, ValueError):
        return default


def music_graph(m: dict, idx: int, dur: float, voice: str, main: float = 0.0) -> str:
    """The sound step with music: the clip's own sound (already evened out, as `voice` says) and the track mixed under
    it, ducked while someone talks. `main` is where the outro starts (0: no outro); the music rises into it. Ends as [a]."""
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
    v, p = m["vol"] / 100, m["peak"] / 100
    s = min(m.get("off") or 0.0, max(0.0, dur - 0.5))                  # the music's own stretch of the timeline
    e = dur if m.get("till") is None else max(s + 0.5, min(dur, m["till"]))
    level = f"volume={v:.2f}"
    if main and m["rise"] and p != v:            # the rise: a straight climb that finishes as the outro begins
        t0, t1 = max(0.0, main - m["rise"]), main
        level = f"volume='if(lt(t,{t0:.2f}),{v:.2f},if(lt(t,{t1:.2f}),{v:.2f}+({p - v:.2f})*(t-{t0:.2f})/{max(.01, t1 - t0):.2f},{p:.2f}))':eval=frame"
    elif main:
        level = f"volume='if(lt(t,{main:.2f}),{v:.2f},{p:.2f})':eval=frame"
    # loudnorm hands a short song over in one big piece; cut it back into small ones, so the volume below (checked
    # once per piece) really rises over time instead of staying where it started
    mus = [fmt, f"atrim=0:{e - s:.2f}", "asetpts=PTS-STARTPTS", "loudnorm=I=-14:TP=-2:LRA=11", "aresample=48000", "asetnsamples=n=1024:p=0"]
    if m["fade"]:
        out_d = 0.3 if m.get("rise_on") and main >= dur - 0.05 else 1.5     # rising to the end: only a short fade
        mus += ["afade=t=in:st=0:d=0.6", f"afade=t=out:st={max(0.0, e - s - out_d):.2f}:d={out_d}"]
    if s > 0:                                  # silence before it, so the level below runs on the clip's own time
        mus.append(f"adelay={int(s * 1000)}:all=1")
    mus.append(level)
    g = f"[0:a]{voice},{fmt}[vo];[{idx}:a]{','.join(mus)}[mz];"
    if m["duck"]:
        g += ("[vo]asplit=2[v1][v2];[mz][v2]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=400[md];"
              "[v1][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]")
    else:
        g += "[vo][mz]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]"
    return g


def card_lines(text: str, width: float, size: float) -> list:
    """The post's words cut into lines by a simple count of letters, the same way in the editor, at most 4 lines."""
    per = max(8, int(width / (size * 0.5)))
    lines, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > per:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    if len(lines) > 4:
        lines = lines[:4]
        lines[3] = lines[3][: max(1, per - 1)].rstrip() + "…"
    return lines


def card_geometry(Wd, Hd, fw, fh, text, floating=False, scale=100, dx=0, dy=0, pad=40) -> dict:
    """Where everything on the post card goes, in pixels of a Wd x Hd frame. fw x fh is the shape of the video.
    `floating`: the card is a panel on a backdrop, so its content sits further in and `box` is the panel.
    scale (%), dx and dy (% of the frame) and pad (the panel's inner room) come from the editor."""
    side = min(Wd, Hd * 9 / 16) * scale / 100
    u = side / 1080
    m = (40 + pad) * u if floating else 64 * u
    cw = side - 2 * m
    x0 = (Wd - cw) / 2
    A, ts, lh = 112 * u, 46 * u, 62 * u
    lines = card_lines(text, cw, ts)
    vw = int(cw / 2) * 2
    vh = min(int(vw * fh / max(1, fw) / 2) * 2, int(Hd * 0.52 / 2) * 2)
    head = A + 36 * u + len(lines) * lh
    total = head + 40 * u + vh + 260 * u
    y0 = max(48 * u, (Hd - total) / 2)
    x0 += Wd * dx / 100                          # moved in the editor
    y0 += Hd * dy / 100
    vy = int((y0 + head + 40 * u) / 2) * 2
    vx = int(x0 / 2) * 2
    g = {"u": u, "x0": x0, "y0": y0, "cw": cw, "A": A, "ts": ts, "lh": lh, "lines": lines,
         "vx": vx, "vy": vy, "vw": vw, "vh": vh, "cap": round(vy + vh + 120 * u)}
    if floating:                                 # the panel: `pad` round the content, down past the captions
        p = pad * u
        g["box"] = [round(x0 - p), round(y0 - p), round(x0 + cw + p), round(g["cap"] + 110 * u)]
    return g


def _card_backdrop(card: dict, Wd: int, Hd: int):
    """Behind a floating post card: a gradient from the top-left colour to the bottom-right one with fine grain,
    or nothing (see-through) when the blurred video goes there instead."""
    from PIL import Image
    if card["back"] == "blur":
        return Image.new("RGBA", (Wd, Hd), (0, 0, 0, 0))
    a, b = (tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in (card["g1"], card["g2"]))
    small = Image.new("RGB", (64, 64))
    for yy in range(64):
        for xx in range(64):
            t = (xx + yy) / 126
            small.putpixel((xx, yy), tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3)))
    img = small.resize((Wd, Hd), Image.BICUBIC).convert("RGBA")
    if card["grain"]:                            # fine film grain, so the colour doesn't look flat
        noise = Image.effect_noise((Wd // 2, Hd // 2), 64).resize((Wd, Hd), Image.NEAREST).convert("RGBA")
        noise.putalpha(22)
        img.alpha_composite(noise)
    return img


def _rich_text(img, d, x, base, text, font, fill, size):
    """A line of text with its emoji drawn as Fluent 3D pictures, the text's baseline at `base`."""
    from . import emoji as _em
    from PIL import Image
    pos = 0
    for a, b, k in _em.find(text) + [(len(text), len(text), None)]:
        seg = text[pos:a]
        if seg:
            d.text((x, base), seg, font=font, fill=fill, anchor="ls")
            x += d.textlength(seg, font=font)
        if k:
            f = _em.picture(k)
            e = round(size * 1.08)
            if f:
                pic = Image.open(f).convert("RGBA").resize((e, e), Image.LANCZOS)
                img.alpha_composite(pic, (round(x), round(base - size * 0.92)))
            x += e + size * 0.08
        pos = b


def _font_file(key: str, weight: int) -> str:
    """A font file for drawing with Pillow: the Google font in that weight, else the bundled bold one."""
    try:
        f = FONTS.get(key) or {}
        ensure_font(key, weight)
        slug = re.sub(r"[^a-z0-9]+", "-", f["google"].lower()).strip("-")
        for w in (weight, f.get("weight")):
            p = config.FONTS_DIR / f"g-{slug}-{w}.ttf"
            if p.is_file():
                return str(p)
    except Exception:  # noqa: BLE001 - no internet for the font: the bundled one
        pass
    return str(_PATHS["Poppins ExtraBold"])


def card_images(card: dict, g: dict, logo_path: str, bg_out: Path, mask_out: Path):
    """The card behind the video (the whole frame) and the shape that rounds the video's corners."""
    from PIL import Image, ImageDraw, ImageFont
    Wd, Hd = _wh()
    th = CARD_THEMES[card["theme"]]
    u, x0, y0, A = g["u"], g["x0"], g["y0"], g["A"]
    if g.get("box"):                             # the card as a panel on its backdrop
        img = _card_backdrop(card, Wd, Hd)
        bx = g["box"]
        rad = round(44 * u)
        shadow = Image.new("RGBA", (Wd, Hd), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((bx[0], bx[1] + round(18 * u), bx[2], bx[3] + round(18 * u)), radius=rad, fill=(0, 0, 0, 120))
        from PIL import ImageFilter
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(28 * u))))
        panel = Image.new("RGBA", (Wd, Hd), (0, 0, 0, 0))
        pd = ImageDraw.Draw(panel)
        pd.rounded_rectangle(bx, radius=rad, fill=th["bg"])
        pd.rounded_rectangle(bx, radius=rad, outline=(255, 255, 255, 26) if th["kind"] != "linkedin" and th["bg"] != "#FFFFFF" else (0, 0, 0, 20), width=max(1, round(2 * u)))
        img.alpha_composite(panel)
    else:
        img = Image.new("RGBA", (Wd, Hd), th["bg"])
    d = ImageDraw.Draw(img)
    bold, regular = ImageFont.truetype(_font_file("Inter", 700), round(42 * u)), ImageFont.truetype(_font_file("Inter", 400), round(36 * u))
    body = ImageFont.truetype(_font_file("Inter", 400), round(g["ts"]))
    a = round(A)
    pic = None
    if card["avatar"] == "logo" and logo_path and Path(logo_path).is_file():
        try:
            pic = Image.open(logo_path).convert("RGBA")
            s = min(pic.size)
            pic = pic.crop(((pic.width - s) // 2, (pic.height - s) // 2, (pic.width + s) // 2, (pic.height + s) // 2)).resize((a, a), Image.LANCZOS)
        except Exception:  # noqa: BLE001 - a broken logo: the first letter instead
            pic = None
    ring = Image.new("L", (a * 4, a * 4), 0)
    ImageDraw.Draw(ring).ellipse((0, 0, a * 4 - 1, a * 4 - 1), fill=255)
    ring = ring.resize((a, a), Image.LANCZOS)
    if pic is None:
        pic = Image.new("RGBA", (a, a), th["acc"])
        letter = (card["name"] or "S")[:1].upper()
        lf = ImageFont.truetype(_font_file("Inter", 700), round(a * 0.44))
        ImageDraw.Draw(pic).text((a / 2, a / 2), letter, font=lf, fill="#FFFFFF", anchor="mm")
    img.paste(pic.convert("RGB"), (round(x0), round(y0)), ring)
    nx, mid = x0 + A + 24 * u, y0 + A / 2
    name, sub = card_account(card)
    one = th["kind"] == "threads"                 # Threads: one line, the handle with "1h" beside it
    ny = mid + 14 * u if one else mid - 4 * u
    d.text((nx, ny), name, font=bold, fill=th["ink"], anchor="ls")
    end = nx + d.textlength(name, font=bold)
    if card["verified"]:
        bx = end + 10 * u
        r = 19 * u
        cy = ny - 15 * u
        d.ellipse((bx, cy - r, bx + 2 * r, cy + r), fill=th["acc"])
        d.line([(bx + r * 0.55, cy + r * 0.02), (bx + r * 0.88, cy + r * 0.36), (bx + r * 1.48, cy - r * 0.34)],
               fill="#FFFFFF", width=max(2, round(5 * u)), joint="curve")
        end = bx + 2 * r
    if one:
        d.text((end + 14 * u, ny), sub, font=regular, fill=th["sub"], anchor="ls")
    else:
        d.text((nx, mid + 40 * u), sub, font=regular, fill=th["sub"], anchor="ls")
    ty = y0 + A + 36 * u
    for i, line in enumerate(g["lines"]):
        _rich_text(img, d, x0, ty + i * g["lh"] + g["ts"], line, body, th["ink"], g["ts"])
    (img if card["back"] == "blur" and g.get("box") else img.convert("RGB")).save(bg_out, "PNG")
    vw, vh, rad = g["vw"], g["vh"], round(card["radius"] * u)
    mask = Image.new("L", (vw * 2, vh * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, vw * 2 - 1, vh * 2 - 1), radius=rad * 2, fill=255)
    mask.resize((vw, vh), Image.LANCZOS).save(mask_out, "PNG")


WM_ICONS = ("none", "logo", "youtube", "tiktok", "instagram", "x", "twitch", "kick")


def _path_polys(d: str) -> list:
    """An SVG path (M L H V C S Z, absolute and relative) as lists of points, one per piece, curves in short steps."""
    toks = re.findall(r"[MmLlHhVvCcSsZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", d)
    polys, cur, i, cmd = [], [], 0, ""
    x = y = sx = sy = 0.0
    last_c = None
    num = lambda: float(toks[i])   # noqa: E731

    def bez(p0, p1, p2, p3):
        return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
                 (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
                for t in (k / 12 for k in range(1, 13))]
    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
            if cmd in "Zz":
                if cur:
                    polys.append(cur)
                cur, x, y = [], sx, sy
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            nx, ny = num(), float(toks[i + 1])
            i += 2
            x, y = (x + nx, y + ny) if rel else (nx, ny)
            if cur:
                polys.append(cur)
            cur, sx, sy = [(x, y)], x, y
            cmd = "l" if rel else "L"              # more pairs after a move are lines
            last_c = None
        elif c == "L":
            nx, ny = num(), float(toks[i + 1])
            i += 2
            x, y = (x + nx, y + ny) if rel else (nx, ny)
            cur.append((x, y))
            last_c = None
        elif c == "H":
            x = x + num() if rel else num()
            i += 1
            cur.append((x, y))
            last_c = None
        elif c == "V":
            y = y + num() if rel else num()
            i += 1
            cur.append((x, y))
            last_c = None
        elif c in "CS":
            n = 6 if c == "C" else 4
            v = [float(t) for t in toks[i:i + n]]
            i += n
            if rel:
                v = [v[k] + (x if k % 2 == 0 else y) for k in range(n)]
            if c == "C":
                p1, p2, p3 = (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
            else:
                p1 = (2 * x - last_c[0], 2 * y - last_c[1]) if last_c else (x, y)
                p2, p3 = (v[0], v[1]), (v[2], v[3])
            cur += bez((x, y), p1, p2, p3)
            last_c, (x, y) = p2, p3
        else:
            i += 1                                  # a command this drawer doesn't know: skip its number
    if cur:
        polys.append(cur)
    return polys


def draw_mark(k: str, h: int):
    """A platform icon `h` pixels tall, drawn large and scaled down so its edges are smooth."""
    from PIL import Image, ImageDraw
    from .marks import MARK_PATHS
    S = 4
    if k == "instagram":                            # the gradient tile, rounded square and lens, as editor.js draws it
        n = h * S
        grad = Image.new("RGB", (n, n))
        stops = [(0, (255, 215, 118)), (.1, (243, 165, 84)), (.45, (241, 63, 121)), (.75, (192, 45, 176)), (1, (92, 75, 223))]
        px = grad.load()
        for yy in range(0, n, 2):
            for xx in range(0, n, 2):
                t = min(1.0, ((xx / n - .28) ** 2 + (yy / n - 1.08) ** 2) ** .5 / 1.4)
                a, b = next((stops[j], stops[j + 1]) for j in range(len(stops) - 1) if stops[j + 1][0] >= t)
                f = (t - a[0]) / max(1e-6, b[0] - a[0])
                c = tuple(round(a[1][q] + (b[1][q] - a[1][q]) * f) for q in range(3))
                for dy in (0, 1):
                    for dx in (0, 1):
                        if xx + dx < n and yy + dy < n:
                            px[xx + dx, yy + dy] = c
        img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        mask = Image.new("L", (n, n), 0)
        u = n / 28
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1), radius=7 * u, fill=255)
        img.paste(grad, (0, 0), mask)
        d = ImageDraw.Draw(img)
        w = max(1, round(1.8 * u))
        d.rounded_rectangle((7 * u, 7 * u, 21 * u, 21 * u), radius=4.2 * u, outline="#FFFFFF", width=w)
        d.ellipse((10.7 * u, 10.7 * u, 17.3 * u, 17.3 * u), outline="#FFFFFF", width=w)
        d.ellipse((17.2 * u, 8.7 * u, 19.3 * u, 10.8 * u), fill="#FFFFFF")
        return img.resize((h, h), Image.LANCZOS)
    if k == "youtube":                              # the red rounded badge and the white play mark (24 x 17)
        sc = h * S / 17
        img = Image.new("RGBA", (round(24 * sc), h * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, 24 * sc - 1, 17 * sc - 1), radius=4.2 * sc, fill="#FF0033")
        d.polygon([(9.55 * sc, 4.89 * sc), (15.82 * sc, 8.46 * sc), (9.55 * sc, 12.03 * sc)], fill="#FFFFFF")
        return img.resize((round(24 * sc / S), h), Image.LANCZOS)
    m = MARK_PATHS.get(k)
    if not m:
        return None
    vx, vy, vw, vh = m["vb"]
    sc = h * S / vh
    img = Image.new("RGBA", (round(vw * sc), h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for path, fill, tx, ty in m["paths"]:
        for poly in _path_polys(path):
            if len(poly) > 2:
                d.polygon([((px_ + tx - vx) * sc, (py_ + ty - vy) * sc) for px_, py_ in poly], fill=fill)
    return img.resize((max(1, round(vw * sc / S)), h), Image.LANCZOS)


def _line(v, n: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", "", str(v or "")).strip()[:n]


def social_geometry(s: int) -> dict:
    """Sizes in the social watermark, from its size setting. The same numbers in editor.js (wmGeo)."""
    return {"pad": 8, "hs": round(s * 0.36), "ts": round(s * 0.5), "ic": round(s * 0.6), "gs": round(s * 0.44), "g": round(s * 0.12)}


def social_badge(look: dict, logo_path: str):
    """The social watermark as one picture: header, icon and handle, then a dashed rule and the hashtag."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    q = social_geometry(look["brand_size"])
    col = look["brand_color"]
    f_head = ImageFont.truetype(_font_file(look["brand_font"], 500), q["hs"])
    f_bold = ImageFont.truetype(_font_file(look["brand_font"], 700), q["ts"])
    f_tag = ImageFont.truetype(_font_file(look["brand_font"], 700), q["gs"])
    head, handle = look["brand_head"], look["brand_handle"]
    tag = look["brand_tag"] if look["brand_tag_on"] else ""
    icon = None
    k = look["brand_icon"]
    try:
        if k == "logo" and logo_path and Path(logo_path).is_file():
            icon = Image.open(logo_path).convert("RGBA")
            icon = icon.resize((max(1, round(icon.width * q["ic"] / icon.height)), q["ic"]), Image.LANCZOS)
        elif k not in ("none", "logo"):
            icon = draw_mark(k, q["ic"])
    except Exception:  # noqa: BLE001 - an unreadable icon: the handle alone
        icon = None
    if not (head or handle or tag or icon):
        return None
    meas = ImageDraw.Draw(Image.new("L", (1, 1)))
    tw = lambda t, f: meas.textlength(t, font=f) if t else 0   # noqa: E731
    row_w = (icon.width if icon else 0) + (q["g"] if icon and handle else 0) + tw(handle, f_bold)
    w = round(max(tw(head, f_head), row_w, tw(tag, f_tag))) + q["pad"] * 2
    lh_head, lh_row, lh_tag = round(q["hs"] * 1.25), max(q["ic"], round(q["ts"] * 1.25)), round(q["gs"] * 1.25)
    h = q["pad"] * 2 + (lh_head if head else 0) + ((q["g"] // 2) if head and (handle or icon) else 0) + (lh_row if handle or icon else 0) \
        + ((2 + q["g"] * 2 + lh_tag) if tag else 0)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ink = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)
    x, y = q["pad"], q["pad"]
    if head:
        d.text((x, y + lh_head / 2), head, font=f_head, fill=col, anchor="lm")
        y += lh_head + ((q["g"] // 2) if handle or icon else 0)
    if handle or icon:
        cx = x
        if icon:
            ink.alpha_composite(icon, (cx, round(y + (lh_row - icon.height) / 2)))
            cx += icon.width + (q["g"] if handle else 0)
        if handle:
            d.text((cx, y + lh_row / 2), handle, font=f_bold, fill=col, anchor="lm")
        y += lh_row
    if tag:
        y += q["g"]
        for dx in range(x, w - q["pad"], 8):                  # a dashed rule, like the reference
            d.line([(dx, y), (min(dx + 4, w - q["pad"]), y)], fill=col + "99", width=2)
        y += 2 + q["g"]
        d.text((x, y + lh_tag / 2), tag, font=f_tag, fill=col, anchor="lm")
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))            # a soft shadow under the words, so they read on any picture
    shadow.putalpha(ink.getchannel("A").point(lambda v: round(v * 0.55)))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3)), (0, 0))
    img.alpha_composite(ink)
    return img


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


def _pct(v):
    """A left-to-right position in percent of the frame's width, or None for the middle."""
    try:
        return None if v is None else max(8.0, min(92.0, float(v)))
    except (TypeError, ValueError):
        return None


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


HOOK_SHOW = 3.0      # seconds the hook stays on screen unless the editor says otherwise (0 means the whole clip)


def _hook_dur(v) -> float:
    if v is None:
        return HOOK_SHOW
    try:
        return max(0.0, min(60.0, round(float(v) * 2) / 2))
    except (TypeError, ValueError):
        return HOOK_SHOW


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


def ensure_font(key: str, weight=None) -> str:
    """Makes sure a font from FONTS is on this machine and returns its name for the caption renderer.
    weight asks for another weight of a Google font (300 to 800); a font that doesn't come in it keeps its own."""
    f = FONTS.get(key) or FONTS["Poppins"]
    if "ass" in f:
        return f["ass"]
    if weight and weight != f["weight"]:
        try:
            return _fetch_font(key, f, weight)
        except Exception:  # noqa: BLE001 - not made in that weight: the font's own weight instead
            pass
    return _fetch_font(key, f, f["weight"])


def _fetch_font(key, f, weight) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f["google"].lower()).strip("-")
    path = config.FONTS_DIR / f"g-{slug}-{weight}.ttf"
    with _font_lock:
        if not path.is_file():
            import httpx
            family = f["google"].replace(" ", "+")
            css = httpx.get(f"https://fonts.googleapis.com/css2?family={family}:wght@{weight}",
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
    w = look.get("weight")
    local = "ass" in FONTS.get(look["font"], {})
    return {"font": ensure_font(look["font"], w), "size": look["size"],
            # a bundled font has one weight: Semibold and up are drawn bold by the renderer itself
            "bold": bool(local and w and w >= 600), "italic": look.get("italic", False), "underline": look.get("underline", False), "base": bgr(look["base"]), "active": bgr(look["active"]),
            "strong": bgr(look["base"]), "outline": look["outline"], "pop": 112, "upper": look["upper"], "per": look["per"],
            "sp": look["sp"], "wgap": look["wgap"], "box": bgr(look["cap_box"]), "box_op": look["cap_op"], "box_r": look["cap_round"],
            "x": look.get("x")}


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


LAYOUTS = {"blur": "Full frame + blurred fill", "zoom": "Zoomed in + blurred fill", "crop": "Fill the screen (centre crop)",
           "split": "Split: the stream on top, the face cam below", "card": "Post card: the clip inside a social post",
           "pip": "Picture in picture: one part fills the frame, the face cam in a small box in a corner",
           "trio": "Trio: three parts of the picture stacked, for podcasts with three people"}
PARTS = ("split", "pip", "trio")      # the layouts made of parts of the picture (the split boxes), not one framed shot
# The split layout cuts two parts out of the source: the gameplay (or whatever is on stream) and the streamer's face
# cam, and stacks them. Each part is [left, top, width, height] as fractions of the source picture. Most streamers
# keep their face cam in the bottom-right corner, so that's where it starts; the editor can move both.
SPLIT_DEFAULT = {"game": [0.0, 0.0, 1.0, 1.0], "cam": [0.68, 0.58, 0.30, 0.40], "cam_at": "bottom", "share": 50,
                 # picture in picture: which corner the small box sits in, and how wide it is (% of the frame)
                 "pip_at": "br", "pip_size": 36,
                 # its place once dragged (the middle of the box, % of the frame; None: the corner above), its shape,
                 # how round its corners are (% of its width), and its edge (width at 1080 wide, colour)
                 "pip_x": None, "pip_y": None, "pip_shape": "rounded", "pip_radius": 10, "pip_border": 6, "pip_color": "#FFFFFF",
                 # trio: the three parts, top to bottom (a third of the picture each, to start)
                 "trio": [[0.0, 0.0, 0.3333, 1.0], [0.3333, 0.0, 0.3333, 1.0], [0.6667, 0.0, 0.3333, 1.0]]}


def _region(v, default):
    """A part of the picture as [left, top, width, height] fractions, kept inside the picture and not too small."""
    try:
        x, y, w, h = (max(0.0, min(1.0, float(n))) for n in v)
    except (TypeError, ValueError):
        return list(default)
    w, h = max(0.05, min(w, 1 - x)), max(0.05, min(h, 1 - y))
    return [round(min(x, 0.95), 4), round(min(y, 0.95), 4), round(w, 4), round(h, 4)]


def clean_split(v) -> dict:
    v = v if isinstance(v, dict) else {}
    share = v.get("share", SPLIT_DEFAULT["share"])
    try:
        share = max(30, min(70, int(share)))
    except (TypeError, ValueError):
        share = SPLIT_DEFAULT["share"]
    try:
        size = max(22, min(50, int(v.get("pip_size", SPLIT_DEFAULT["pip_size"]))))
    except (TypeError, ValueError):
        size = SPLIT_DEFAULT["pip_size"]
    trio = v.get("trio") if isinstance(v.get("trio"), list) and len(v.get("trio")) == 3 else SPLIT_DEFAULT["trio"]

    def pct(k, lo, hi):
        try:
            return None if v.get(k) is None else round(max(lo, min(hi, float(v[k]))), 2)
        except (TypeError, ValueError):
            return None
    col = str(v.get("pip_color") or "#FFFFFF")
    return {"game": _region(v.get("game"), SPLIT_DEFAULT["game"]), "cam": _region(v.get("cam"), SPLIT_DEFAULT["cam"]),
            "cam_at": "top" if v.get("cam_at") == "top" else "bottom", "share": share,
            "pip_at": v.get("pip_at") if v.get("pip_at") in ("tl", "tr", "bl", "br") else "br", "pip_size": size,
            "pip_x": pct("pip_x", 0, 100), "pip_y": pct("pip_y", 0, 100),
            "pip_shape": v.get("pip_shape") if v.get("pip_shape") in ("rounded", "circle", "square") else "rounded",
            "pip_radius": int(pct("pip_radius", 0, 30) if pct("pip_radius", 0, 30) is not None else 10),
            "pip_border": int(pct("pip_border", 0, 16) if pct("pip_border", 0, 16) is not None else 6),
            "pip_color": col.upper() if re.fullmatch(r"#[0-9A-Fa-f]{6}", col) else "#FFFFFF",
            "trio": [_region(r, d) for r, d in zip(trio, SPLIT_DEFAULT["trio"])]}


def pip_geometry(W, H, split, src_w, src_h) -> dict:
    """Where the small box of picture in picture goes, in pixels of the frame: its place and size (the face cam's
    own shape, kept between wide and tall), the white edge around it and how round its corners are."""
    sp = split or SPLIT_DEFAULT
    pw = int(round(W * sp.get("pip_size", 36) / 100 / 2)) * 2
    cam, shape = sp["cam"], sp.get("pip_shape", "rounded")
    ar = (cam[3] * (src_h or 9)) / max(1e-6, cam[2] * (src_w or 16))
    ph = pw if shape == "circle" else int(round(pw * max(0.75, min(1.5, ar)) / 2)) * 2
    m = round(W * 0.045)
    b = int(round(sp.get("pip_border", 6) * W / 1080))
    if sp.get("pip_x") is not None and sp.get("pip_y") is not None:      # dragged: its middle where it was let go
        x = round(W * sp["pip_x"] / 100 - pw / 2)
        y = round(H * sp["pip_y"] / 100 - ph / 2)
    else:
        at = sp.get("pip_at", "br")
        x = W - m - pw if at[1] == "r" else m
        y = round(H * 0.07) if at[0] == "t" else H - ph - round(H * 0.075)
    x, y = max(b, min(W - pw - b, x)), max(b, min(H - ph - b, y))       # always whole on the frame, edge too
    r = pw // 2 if shape == "circle" else 0 if shape == "square" else round(pw * sp.get("pip_radius", 10) / 100)
    return {"x": x, "y": y, "w": pw, "h": ph, "b": b, "r": r, "color": sp.get("pip_color", "#FFFFFF")}


def _trio_heights(H):
    t = int(round(H / 3 / 2)) * 2
    return t, t, H - 2 * t


def avoid_cam(split, src_w, src_h, W, H):
    """While the stream part is still the whole picture (nobody changed it), crop it so it doesn't show the face cam
    overlay too. The crop keeps the stream band's shape and full height, starting from the middle and sliding away
    from the face cam's side until it no longer covers it. A face cam too wide to avoid leaves the crop centred.
    A stream part someone set by hand is left exactly as it is."""
    game, cam = split["game"], split["cam"]
    if game != [0.0, 0.0, 1.0, 1.0] and game != [0, 0, 1, 1] or not src_w or not src_h:
        return split
    gh, _ = _split_heights(split, H)
    w = src_h * W / max(1, gh)                  # the widest crop with the band's shape at full height
    if w >= src_w:
        return split                            # the band is wider than the picture: it already crops top and bottom
    cl, cr = cam[0] * src_w, (cam[0] + cam[2]) * src_w
    x0 = (src_w - w) / 2
    if (cl + cr) / 2 > src_w / 2:
        x0 = min(x0, cl - w)                    # face cam on the right: end the crop where it starts
    else:
        x0 = max(x0, cr)                        # on the left: start the crop where it ends
    if x0 < 0 or x0 + w > src_w:
        return split
    return dict(split, game=[round(x0 / src_w, 4), 0.0, round(w / src_w, 4), 1.0])


def _split_heights(split, H):
    """(height of the stream part, height of the face cam part), even numbers that add up to the frame."""
    gh = int(round(H * split["share"] / 100 / 2)) * 2
    return gh, H - gh


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


def geometry(src_w, src_h, layout, split=None):
    """Where the video sits in the frame (1080x1920 for 9:16), and where hook and captions go.
    The numbers are tuned for 9:16 and kept in proportion for the other shapes.
    Split: the hook sits just above the seam between the two parts, the captions right on the seam under it."""
    W, H = _wh()
    if layout == "split":
        sp = split or SPLIT_DEFAULT
        gh, ch = _split_heights(sp, H)
        seam = gh if sp["cam_at"] == "bottom" else ch
        return layout, gh, seam - round(H * 0.045), seam     # both in the middle: hook just above, captions on the seam
    if layout == "trio":                 # the hook just above the first seam, the captions on the second
        a, b, _ = _trio_heights(H)
        return layout, H, a - round(H * 0.045), a + b
    if layout == "pip":                  # like Solo; the captions move up when the small box is at the bottom
        sp = split or SPLIT_DEFAULT
        return layout, H, round(H * 300 / 1920), round(H * (1380 if sp.get("pip_at", "br")[0] == "t" else 1180) / 1920)
    if src_h * W >= src_w * H and layout != "crop":
        layout = "crop"  # as tall as the frame or taller: nothing to gain from a blurred fill
    iw = W - 2 * getattr(_frame, "pad", 0)      # room left and right of the video (Blurred fill and Zoomed)
    if layout == "blur":
        fg_h = min(H, int(round(iw * src_h / src_w / 2)) * 2)
    elif layout == "zoom":
        fg_h = min(H, int(round((H * 1000 / 1920 if W < H else H) * iw / W / 2)) * 2)
    else:
        fg_h = H
    top = (H - fg_h) // 2
    if layout == "crop":
        return layout, fg_h, round(H * 300 / 1920), round(H * 1380 / 1920)
    return layout, fg_h, max(round(H * 230 / 1920), top - round(H * 190 / 1920)), min(round(H * 1640 / 1920), top + fg_h + round(H * 180 / 1920))


def _hook_events(hook, dur, y, font=None, size=None, show=0.0, hk=None):
    """The heading: text in a rounded box that fits it, on one line or two balanced ones.
    `show` is how many seconds it stays (then it fades away); 0 keeps it for the whole clip.
    `hk` is the look from the editor: box and text colours, how solid the box is, its corners, the letter gaps.
    With little or no box the text gets a dark outline, so it still reads on any picture."""
    hk = hk or {}
    W, _ = _wh()
    f, size = _Font.get(font or HOOK["font"]), size or HOOK["size"]
    sp, op = hk.get("hook_sp", 0), hk.get("hook_op", 100)
    banner = hk.get("hook_banner", "fit")
    if banner == "none":
        op = 0                                    # no box: the text gets its outline, as with a see-through box
    _frame.hook_emoji = []
    out = 0
    if show and show < dur:
        dur, out = show, 250                      # gone after `show` seconds, with a short fade
    hook = _case(hook, hk.get("hook_case", "asis"))
    # each emoji becomes one stand-in letter; it is measured and written as a gap as wide as the emoji, and the
    # emoji's picture is laid in that gap (see _render_clip)
    from . import emoji as _em
    keys = []
    for a, b, k in reversed(_em.find(hook)):
        hook = hook[:a] + _EMJ + hook[b:]
        keys.insert(0, k)
    words = hook.split()
    if not words:
        return []
    gap_n = lambda z: max(1, round(f.em(z) * 1.08 / max(1, f.width(" ", z) + sp)))     # noqa: E731 - spaces per emoji
    wid = lambda t, z: f.width(t.replace(_EMJ, " " * gap_n(z)), z) + sp * max(0, len(t.replace(_EMJ, " " * gap_n(z))) - 1)   # noqa: E731
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
    if banner == "full":
        bw = W                                    # the box runs the full width of the frame
    # across: where it was dragged in the editor (its middle), kept fully inside the frame; the middle otherwise
    cx = W / 2 if hk.get("hook_x") is None else W * hk["hook_x"] / 100
    cx = max(bw / 2 + 12, min(W - bw / 2 - 12, cx)) if bw < W - 24 else W / 2
    x0, y0 = cx - bw / 2, y - bh / 2
    span = f"{_ts(0)},{_ts(dur)}"
    ink = _bgr(hk["hook_ink"]) if "hook_ink" in hk else HOOK["ink"]
    ev = []
    fill = _bgr(hk["hook_box"]) if "hook_box" in hk else HOOK["box"]
    if op > 0 and banner == "line":               # one box for each line, fitted to it
        for i, line in enumerate(lines):
            lw = wid(line, size) + 2 * HOOK["pad_x"]
            ly = y - line_h * (len(lines) - 1) / 2 + i * line_h
            box = _rounded(cx - lw / 2, ly - line_h / 2 - HOOK["pad_y"] * 0.45, cx + lw / 2, ly + line_h / 2 + HOOK["pad_y"] * 0.45,
                           hk.get("hook_round", HOOK["radius"]))
            ev.append(f"Dialogue: 3,{span},Hook,,0,0,0,,{{\\an7\\pos(0,0)\\fad(160,{out})\\c&H{fill}&\\1a&H{_alpha(op)}&\\p1}}{box}{{\\p0}}")
    elif op > 0:
        box = _rounded(x0, y0, x0 + bw, y0 + bh, 0 if banner == "full" else hk.get("hook_round", HOOK["radius"]))
        ev.append(f"Dialogue: 3,{span},Hook,,0,0,0,,{{\\an7\\pos(0,0)\\fad(160,{out})\\c&H{fill}&\\1a&H{_alpha(op)}&\\p1}}{box}{{\\p0}}")
    edge = "" if op >= 35 else f"\\bord{max(3, size // 22)}\\3c&H000000&\\shad{CAP_SHADOW}\\4c&H000000&\\4a&H80&"
    tag = (f"\\fsp{sp}" if sp else "") + (f"\\c&H{ink}&" if ink != HOOK["ink"] else "") + edge
    ki = 0
    for i, line in enumerate(lines):
        mid = y - line_h * (len(lines) - 1) / 2 + i * line_h
        cy = mid - f.cap_shift(size)
        left = cx - wid(line, size) / 2
        for j, ch in enumerate(line):             # where each emoji's gap is on this line
            if ch == _EMJ and ki < len(keys):
                gw = wid(_EMJ, size)
                x_mid = left + (wid(line[:j], size) + sp if j else 0) + gw / 2
                _frame.hook_emoji.append((keys[ki], round(x_mid), round(mid), round(f.em(size) * 1.0), dur))
                ki += 1
        text = line.replace(_EMJ, "\\h" * gap_n(size))
        ev.append(f"Dialogue: 4,{span},Hook,,0,0,0,,{{\\an5\\pos({cx:.0f},{cy:.0f})\\fad(160,{out})\\fs{size}{tag}}}{text}")
    return ev


_EMJ = "\ue000"                                     # stands in for an emoji while the hook is laid out


def _case(text: str, how: str) -> str:
    """The hook's letters: as typed, all capitals, Each Word Capitalised, or all small."""
    if how == "upper":
        return text.upper()
    if how == "lower":
        return text.lower()
    if how == "title":
        return " ".join(w[:1].upper() + w[1:].lower() if w[:1].isalpha() else w for w in text.split(" "))
    return text


def build_ass(words, start, end, hook, style_name, highlight, hook_y, cap_y, hook_font=None, hook_size=None, hook_show=0.0, hk=None) -> str:
    """`style_name` is a key of STYLES, or a full style made from an editor look (see look_style).
    `hook_font` is the renderer's font name for the heading and `hook_size` its size; both default to HOOK."""
    W, H = _wh()
    st = style_name if isinstance(style_name, dict) else STYLES.get(style_name, STYLES["studio"])
    hook_font, hook_size = hook_font or HOOK["font"], hook_size or HOOK["size"]
    words = [dict(w, s=w["s"] - CAPTION_LEAD, e=w["e"] - CAPTION_LEAD) for w in words]
    strong = {_key(h) for h in highlight if _key(h)}
    on = lambda v: -1 if v else 0      # noqa: E731 - bold, italic and underline are -1 (on) or 0 in a caption style
    hk = hk or {}
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{st['font']},{st['size']},&H00{st['base']},&H00{st['base']},&H00000000,&H80000000,{on(st.get('bold'))},{on(st.get('italic'))},{on(st.get('underline'))},0,100,100,0,0,1,{st['outline']},{CAP_SHADOW},5,0,0,0,1
Style: Hook,{hook_font},{hook_size},&H00{HOOK['ink']},&H00{HOOK['ink']},&H00000000,&H00000000,{on(hk.get('hook_bold'))},{on(hk.get('hook_italic'))},{on(hk.get('hook_underline'))},0,100,100,0,0,1,0,0,5,0,0,0,1

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
            lx = W / 2 if st.get("x") is None else W * st["x"] / 100
            ev.append(f"Dialogue: 1,{_ts(g_start)},{_ts(g_end)},Cap,,60,60,0,,{{\\an5\\pos({lx:.0f},{cap_y:.0f})\\q0\\fs{fs}}}{line}")
            continue
        size, sp, wgap = st["size"], st.get("sp", 0), st.get("wgap", 0)     # extra room between letters and between words
        if st.get("italic"):
            wgap += st["size"] * 0.14       # slanted letters lean past their width: a little more room so words don't touch
        wid = lambda t, z, sp=sp: f.width(t, z) + sp * max(0, len(t) - 1)          # noqa: E731
        gap = f.width("n n", size) - 2 * f.width("n", size) + (st["outline"] + 2) * size / st["size"] + wgap   # a normal space, a little room for the outline, and any extra
        total = sum(wid(t, size) for t in texts) + gap * (len(texts) - 1)
        if total > CAP_MAX_W:                                  # a long phrase: shrink it to fit, never run off the frame
            k = CAP_MAX_W / total
            size, sp, wgap = max(36, int(size * k)), sp * k, wgap * k
            wid = lambda t, z, sp=sp: f.width(t, z) + sp * max(0, len(t) - 1)      # noqa: E731
            gap = f.width("n n", size) - 2 * f.width("n", size) + (st["outline"] + 2) * size / st["size"] + wgap
            total = sum(wid(t, size) for t in texts) + gap * (len(texts) - 1)
        cy = cap_y - f.cap_shift(size)
        # across: where the captions were dragged in the editor (their middle), kept inside the frame
        ccx = W / 2 if st.get("x") is None else W * st["x"] / 100
        ccx = max(total / 2 + 24, min(W - total / 2 - 24, ccx)) if total < W - 48 else W / 2
        x = ccx - total / 2
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


def _out_time(t: float, keeps) -> float:
    """A moment of the clip (seconds from its start) on the finished clip, once cut parts are taken out."""
    if not keeps:
        return max(0.0, t)
    before = 0.0
    for a, b in keeps:
        if t < a:
            return before                          # inside a cut: where the next kept part begins
        if t <= b:
            return before + t - a
        before += b - a
    return before


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


def _filter(layout, fg_h, sel="", split=None):
    """`sel`: a select step that keeps only some parts (Speech cleanup), put right after the frame rate is set.
    With a border chosen in Layout, it is drawn on the finished picture (see _stroke)."""
    out = _filter_in(layout, fg_h, sel, split)
    st = getattr(_frame, "stroke", None)
    if st and out.endswith("[v0];"):
        boxes = _stroke(layout, fg_h, st, split)
        if boxes:
            out = out[:-len("[v0];")] + "," + boxes + "[v0];"
    return out


def _stroke(layout, fg_h, st, split=None) -> str:
    """The border, as drawbox steps: around the video box (Centered, Zoomed), along the edge of the frame (Solo,
    picture in picture) or as lines between the parts (Split, Trio). Square corners only; a rounded video box
    gets its border from the ring picture under it instead."""
    W, H = _wh()
    b = max(2, int(round(st["w"] * W / 1080 / 2)) * 2)
    c = "0x" + st["color"][1:]
    if layout in ("blur", "zoom"):
        if getattr(_frame, "vround", 0):
            return ""
        iw = W - 2 * getattr(_frame, "pad", 0)
        x, y = (W - iw) // 2, (H - fg_h) // 2
        if iw >= W:                          # the video is as wide as the frame: lines above and below it
            return f"drawbox=x=0:y={max(0, y - b)}:w={W}:h={b}:color={c}:t=fill,drawbox=x=0:y={min(H - b, y + fg_h)}:w={W}:h={b}:color={c}:t=fill"
        return f"drawbox=x={x - b}:y={y - b}:w={iw + 2 * b}:h={fg_h + 2 * b}:color={c}:t={b}"
    if layout in ("crop", "pip"):
        return f"drawbox=x=0:y=0:w={W}:h={H}:color={c}:t={b}"
    if layout == "split":
        sp = split or getattr(_frame, "split", None) or SPLIT_DEFAULT
        gh, ch = _split_heights(sp, H)
        seam = gh if sp["cam_at"] == "bottom" else ch
        return f"drawbox=x=0:y={seam - b // 2}:w={W}:h={b}:color={c}:t=fill"
    if layout == "trio":
        a, m, _ = _trio_heights(H)
        return ",".join(f"drawbox=x=0:y={y - b // 2}:w={W}:h={b}:color={c}:t=fill" for y in (a, a + m))
    return ""


def _filter_in(layout, fg_h, sel="", split=None):
    W, H = _wh()
    if layout == "split":                # two parts of the source, each filling its band, stacked
        sp = split or getattr(_frame, "split", None) or SPLIT_DEFAULT
        gh, ch = _split_heights(sp, H)

        def part(r, h, tag, src):
            x, y, w, hh = r
            return (f"[{src}]crop=iw*{w}:ih*{hh}:iw*{x}:ih*{y},scale={W}:{h}:force_original_aspect_ratio=increase,"
                    f"crop={W}:{h},setsar=1[{tag}];")
        order = "[g][c]" if sp["cam_at"] == "bottom" else "[c][g]"
        return (f"[0:v]fps={config.OUT_FPS},{sel}split=2[a][b];" + part(sp["game"], gh, "g", "a") + part(sp["cam"], ch, "c", "b")
                + f"{order}vstack=inputs=2,setsar=1[v0];")
    if layout in ("pip", "trio"):
        sp = split or getattr(_frame, "split", None) or SPLIT_DEFAULT
        fps = config.OUT_FPS

        def fill(r, w, h, src, tag, end=",setsar=1"):
            x, y, rw, rh = r
            return (f"[{src}]crop=iw*{rw}:ih*{rh}:iw*{x}:ih*{y},scale={w}:{h}:force_original_aspect_ratio=increase,"
                    f"crop={w}:{h}{end}[{tag}];")
        if layout == "trio":
            hs = _trio_heights(H)
            return (f"[0:v]fps={fps},{sel}split=3[a][b][c];" + fill(sp["trio"][0], W, hs[0], "a", "t0")
                    + fill(sp["trio"][1], W, hs[1], "b", "t1") + fill(sp["trio"][2], W, hs[2], "c", "t2")
                    + "[t0][t1][t2]vstack=inputs=3,setsar=1[v0];")
        g, inp = _frame.pip_geo, getattr(_frame, "inputs", None) or {}
        return (f"[0:v]fps={fps},{sel}split=2[a][b];" + fill(sp["game"], W, H, "a", "pg")
                + fill(sp["cam"], g["w"], g["h"], "b", "pq", ",setsar=1,format=yuva420p")
                + f"[{inp['round']}:v]format=gray,scale={g['w']}:{g['h']}[pm];[pq][pm]alphamerge=shortest=1[pc];"
                + f"[{inp['ring']}:v]fps={fps},format=rgba[pr];[pg][pr]overlay={g['x'] - g['b']}:{g['y'] - g['b']}:shortest=1[pg2];"
                + f"[pg2][pc]overlay={g['x']}:{g['y']}:shortest=1,setsar=1[v0];")
    r = getattr(_frame, "region", None)             # the part of the picture chosen in the Frame view
    if r and r != [0, 0, 1, 1]:
        sel += f"crop=iw*{r[2]}:ih*{r[3]}:iw*{r[0]}:ih*{r[1]},"
    inp = getattr(_frame, "inputs", None) or {}     # the still pictures given to ffmpeg, by name -> input number
    fps = config.OUT_FPS
    if layout == "card":                            # the video inside the post card: rounded, placed on the card
        g = _frame.card_geo
        vw, vh = g["vw"], g["vh"]
        if getattr(_frame, "card_blur", False):    # the blurred video behind a floating card
            head = (f"[0:v]fps={fps},{sel}split=2[ca][cz];"
                    f"[cz]scale={W // 8 * 2}:{H // 8 * 2}:force_original_aspect_ratio=increase,crop={W // 8 * 2}:{H // 8 * 2},boxblur=8:2,"
                    f"scale={W}:{H},eq=brightness=-0.12:saturation=1.1[cbk];[{inp['card']}:v]fps={fps},format=rgba[cpic];"
                    f"[cbk][cpic]overlay=0:0:shortest=1,format=yuv420p,setsar=1[cb];[ca]")
        else:
            head = f"[{inp['card']}:v]fps={fps},format=yuv420p,setsar=1[cb];[0:v]fps={fps},{sel}"
        return (head + f"scale={vw}:{vh}:force_original_aspect_ratio=increase,crop={vw}:{vh},"
                f"setsar=1,format=yuva420p[cv];[{inp['round']}:v]format=gray,scale={vw}:{vh}[cm];[cv][cm]alphamerge=shortest=1[cr];"
                f"[cb][cr]overlay={g['vx']}:{g['vy']}:shortest=1,setsar=1[v0];")
    if layout == "crop":
        return f"[0:v]fps={fps},{sel}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[v0];"
    # Blurred fill and Zoomed: the video in the middle, with room around it if asked, rounded if asked, over a
    # blurred copy of itself, one colour or a gradient
    bg = getattr(_frame, "bg", None) or {"kind": "blur"}
    iw = W - 2 * getattr(_frame, "pad", 0)
    if bg["kind"] == "blur":
        head = (f"[0:v]fps={fps},{sel}split=2[a][b];"
                f"[a]scale={W // 8 * 2}:{H // 8 * 2}:force_original_aspect_ratio=increase,crop={W // 8 * 2}:{H // 8 * 2},boxblur=6:2,"
                f"scale={W}:{H},eq=brightness=-0.14:saturation=1.15[bg];")
    elif bg["kind"] == "gradient":
        head = f"[0:v]fps={fps},{sel}null[b];[{inp['bg']}:v]fps={fps},format=yuv420p,setsar=1[bg];"
    else:
        head = f"[0:v]fps={fps},{sel}null[b];color=c=0x{bg['c1'][1:]}:s={W}x{H}:r={fps},format=yuv420p[bg];"
    fg = f"[b]scale={iw}:{fg_h}:force_original_aspect_ratio=increase,crop={iw}:{fg_h},setsar=1"
    bgl = "bg"
    if "vring" in inp:                   # the rounded border: a ring under the video, as big as the box and its edge
        head += f"[{inp['vring']}:v]fps={fps},format=rgba[vr];[bg][vr]overlay=(W-w)/2:(H-h)/2:shortest=1[bgr];"
        bgl = "bgr"
    if "round" in inp:
        fg += f",format=yuva420p[fq];[{inp['round']}:v]format=gray,scale={iw}:{fg_h}[fm];[fq][fm]alphamerge=shortest=1[fg];"
    else:
        fg += "[fg];"
    return head + fg + f"[{bgl}][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[v0];"


_qsv_ok = None
RENDER_SECONDS = 600      # one clip's video encode; far beyond normal, so a frozen encoder is stopped, not waited on


def render_clip(src: Path, out_dir: Path, name: str, clip: dict, words: list, src_w: int, src_h: int) -> dict:
    """Writes <name>.mp4, <name>.jpg and <name>.ass into out_dir. Returns file names.
    The clip is made in the shape its look asks for (9:16 unless the editor chose 4:5, 1:1 or 16:9)."""
    look = clean_look(clip.get("look"))
    _frame.wh = ASPECTS[look["aspect"]] if look else (W, H)
    try:
        return _render_clip(src, out_dir, name, clip, words, src_w, src_h, look)
    finally:
        _frame.wh, _frame.split, _frame.region, _frame.card_geo, _frame.pip_geo = (W, H), None, None, None, None
        _frame.pad, _frame.bg, _frame.inputs, _frame.hook_emoji, _frame.card_blur = 0, None, None, [], False
        _frame.stroke, _frame.vround, _frame.vring_b = None, 0, 0


def _render_clip(src, out_dir, name, clip, words, src_w, src_h, look) -> dict:
    W, H = _wh()
    out_dir.mkdir(parents=True, exist_ok=True)
    start, end = clip["start"], clip["end"]
    # the two parts of the split layout: as placed in the editor, else where the face cam was found, else the usual box
    placed = (clip.get("look") or {}).get("split")
    split = look["split"] if look and placed else clean_split(clip["auto_split"]) if clip.get("auto_split") else look["split"] if look else SPLIT_DEFAULT
    if clip.get("layout") == "split":
        split = avoid_cam(split, src_w, src_h, W, H)   # stream part still the whole picture: keep the face cam out of it
    _frame.split = split                       # the split layout's two parts, for the picture step below
    _frame.pip_geo = pip_geometry(W, H, split, src_w, src_h) if clip.get("layout") == "pip" else None
    region = look["frame"] if look and clip.get("layout") not in PARTS else None
    _frame.region = region
    fw, fh = (src_w * region[2], src_h * region[3]) if region else (src_w, src_h)   # the shape of what is shown
    # Blurred fill and Zoomed: what is behind the video, the room around it and its corners
    framed = look and clip.get("layout") in ("blur", "zoom")
    _frame.pad = round(look["pad"] * W / 1080 / 2) * 2 if framed else 0
    _frame.bg = look["bg"] if framed else None
    _frame.stroke = {"w": look["stroke"], "color": look["stroke_color"]} if look and look.get("stroke") and clip.get("layout") != "card" else None
    _frame.vround = look["vradius"] if framed else 0
    style, hook = clip.get("style", "studio"), clip.get("hook", "")
    card = None
    if clip.get("layout") == "card":           # the post card: its own places; the post's words stand in for the hook
        card = look["card"] if look else clean_card(None)
        card = dict(card, name=card["name"] or _clean(clip.get("card_name") or "")[:40])   # no name typed: the channel's
        g = card_geometry(W, H, fw, fh, card["text"] or roman.to_roman(hook or ""), floating=card["back"] != "none",
                          scale=card["scale"], dx=card["dx"], dy=card["dy"], pad=card["pad"])
        _frame.card_geo = g
        _frame.card_blur = card["back"] == "blur"
        layout, fg_h, hook_y, cap_y = "card", g["vh"], g["vy"], g["cap"]
    else:
        layout, fg_h, hook_y, cap_y = geometry(fw, fh, clip.get("layout", "blur"), split)
    hook_font = hook_size = None
    hook_show = HOOK_SHOW                       # not changed in the editor: the hook shows for the first few seconds
    hk = brand = None
    if not look and style in PRESETS:           # not changed in the editor: the ready-made look of that name
        base = {k: v for k, v in PRESETS[style].items() if k != "label"}
        style = look_style(clean_look(base))
    if look:                                    # changed in the editor: its own font, colours, size and place
        style = look_style(look)
        if look["y"] is not None:
            cap_y = round(H * look["y"] / 100)
        if look["hook_y"] is not None:
            hook_y = round(H * look["hook_y"] / 100)
        hook_font, hook_size, hook_show = ensure_font(look["hook_font"], look["hook_weight"]), look["hook_size"], look["hook_dur"]
        hk = {k: look[k] for k in ("hook_box", "hook_ink", "hook_op", "hook_round", "hook_sp", "hook_x", "hook_italic", "hook_underline",
                                   "hook_case", "hook_banner")}
        hk["hook_bold"] = bool("ass" in FONTS.get(look["hook_font"], {}) and (look["hook_weight"] or 0) >= 600)
        brand = look if look["brand_on"] else None
        if not look["hook"]:
            hook = ""
    if card:
        hook = ""                               # written on the card itself
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
        # the still pictures the picture step uses, in the order ffmpeg gets them (input 1, 2, ...)
        stills = []
        if card:
            card_images(card, _frame.card_geo, clip.get("logo_path", ""), work / "card.png", work / "round.png")
            stills = ["card", "round"]
        elif _frame.bg and layout in ("blur", "zoom"):
            if _frame.bg["kind"] == "gradient":
                bg_picture(_frame.bg, work / "bg.png")
                stills.append("bg")
            if look["vradius"]:
                round_mask(W - 2 * _frame.pad, fg_h, round(look["vradius"] * W / 1080), work / "round.png")
                stills.append("round")
                if _frame.stroke:            # a rounded box: its border is a rounded ring under the video
                    b = max(2, int(round(_frame.stroke["w"] * W / 1080 / 2)) * 2)
                    pip_ring({"w": W - 2 * _frame.pad, "h": fg_h, "b": b, "r": round(look["vradius"] * W / 1080),
                              "color": _frame.stroke["color"]}, work / "vring.png")
                    stills.append("vring")
                    _frame.vring_b = b
        elif layout == "pip":
            g = _frame.pip_geo
            round_mask(g["w"], g["h"], g["r"], work / "round.png")     # radius 0: square
            pip_ring(g, work / "ring.png")
            stills = ["round", "ring"]
        _frame.inputs = {k: i + 1 for i, k in enumerate(stills)}
        main = out_end - start                       # the clip's length once cuts are out
        mdir = Path(clip.get("media_dir") or "")
        from . import emoji as _em
        zms = []
        for zm in (look["zooms"] if look else []):    # zoom moments, on the finished clip's timeline
            a, b = _out_time(zm["a"] - start, keeps), _out_time(zm["b"] - start, keeps)
            if b - a >= 0.3 and a < main:
                zms.append((a, min(b, main), zm["s"], zm["x"] / 100, zm["y"] / 100, zm["fx"], zm["ease"]))
        hook_pics = []
        for i, (k, x, y, size, show) in enumerate(getattr(_frame, "hook_emoji", None) or []):
            f = _em.picture(k)
            if f:
                shutil.copyfile(f, work / f"em{i}.png")
                hook_pics.append((f"em{i}.png", x, y, max(8, round(size / 2) * 2), 0.0, min(show, main), 100))
        lut = _pack.look_path(look["effect"]) if look else None
        if lut and lut.is_file():
            shutil.copyfile(lut, work / "look.cube")
        # pictures placed on the video: frame pixels, and times on the finished clip (cut parts skipped)
        ovs = []
        placed = list(look["overlays"] if look else [])
        for zm in (look["zooms"] if look else []):    # a zoom's reaction face: top right, popping in for the zoom
            if zm.get("react"):
                placed.append({"id": zm["react"], "x": 74.0, "y": 22.0, "w": 34.0, "a": zm["a"], "b": zm["b"], "op": 100})
        for i, o in enumerate(placed):
            f = _pack.face_path(o["id"]) or mdir / f"{o['id']}.png"
            if not f.is_file():
                continue
            shutil.copyfile(f, work / f"ov{i}.png")
            a, b = _out_time(o["a"] - start, keeps), _out_time(o["b"] - start, keeps)
            if b - a >= 0.1 and a < main:
                ovs.append((f"ov{i}.png", round(W * o["x"] / 100), round(H * o["y"] / 100), max(8, round(W * o["w"] / 100 / 2) * 2),
                            a, min(b, main), o["op"]))
        # the outro: the card drawn here, or a picture or video from the library
        outro = None
        ot = look["outro"] if look else None
        if ot and ot["on"]:
            if ot["kind"] == "file" and ot["file"]:
                f = mdir / f"{ot['file']}.png"
                f = f if f.is_file() else mdir / f"{ot['file']}.mp4"
                if f.is_file():
                    shutil.copyfile(f, work / f"outro{f.suffix}")
                    outro = {"file": f"outro{f.suffix}", "video": f.suffix == ".mp4", "secs": ot["secs"], "main": main}
            else:
                pic = clip.get("logo_path", "") if ot["pic"] == "logo" else str(mdir / f"{ot['pic']}.png") if ot["pic"] else ""
                outro_card(ot, pic, work / "outro.png")
                outro = {"file": "outro.png", "video": False, "secs": ot["secs"], "main": main}
        music = None
        mp = Path(clip.get("music_path") or "")
        if look and look["music"]["id"] and mp.is_file():
            shutil.copyfile(mp, work / "music.m4a")
            music = dict(look["music"], dur=main)
            if outro and music["peak_at"] is not None:      # the song's drop lands right on the outro
                music["at"] = max(0.0, music["peak_at"] - max(0.0, main - music["off"]))
        # sound effects: the pack's sounds at their moments on the finished clip, and a zoom's reaction sound
        hits = [(x["id"], x["t"], x["vol"]) for x in (look["sfx"] if look else [])]
        for zm in (look["zooms"] if look else []):
            face = next((f for f in _pack.faces() if f["id"] == zm.get("react")), None)
            if face and face.get("sfx"):
                hits.append((face["sfx"], zm["a"], 90))
        sfx = []
        for i, (sid, t, vol) in enumerate(hits):
            at = _out_time(t - start, keeps)
            if 0 <= at < main and t >= start - 0.05:
                shutil.copyfile(_pack.sfx_path(sid), work / f"sfx{i}.m4a")
                sfx.append((f"sfx{i}.m4a", at, vol))
        return _render_in(work, src, out_dir, name, start, end, layout, fg_h, ass, fx, sel, asel,
                          brand_overlay(brand) if badge else None, stills=stills, music=music, overlays=ovs, outro=outro, over=hook_pics, zooms=zms,
                          sfx=sfx)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _render_in(work: Path, src: Path, out_dir: Path, name: str, start, end, layout, fg_h, ass: str, fx=("", "", ""), sel="", asel="",
               brand=None, stills=(), music=None, overlays=(), outro=None, over=(), zooms=(), sfx=()) -> dict:
    """`overlays`: pictures on the video, [(file, x, y, width, from, to, opacity)] in frame pixels and output seconds.
    `outro`: {"file", "video", "secs", "main"}: a card picture or a video joined after the clip (main = clip length)."""
    global _qsv_ok
    Wd, Hd = _wh()
    fps = config.OUT_FPS
    (work / f"{name}.ass").write_text(ass, encoding="utf-8")
    (work / "f").mkdir()
    for f in [*config.FONTS_DIR.glob("*.ttf"), *config.FONTS_DIR.glob("*.otf")]:
        shutil.copyfile(f, work / "f" / f.name)
    pre, post, audio = fx
    still = lambda f: ["-loop", "1", "-framerate", str(fps), "-i", f]   # noqa: E731 - a picture held as video
    # extra inputs, in order: the layout's stills (card, gradient, rounded-corner shape), the placed pictures, the
    # brand badge, the outro, then the music. `n` is the next input's number.
    extra = [x for k in stills for x in still(f"{k}.png")]
    n = 1 + len(stills)
    fc = _filter(layout, fg_h, sel)
    cur = "v0"
    if zooms:                                  # the zoom moments: on the video only, before anything is laid on it
        fc += f"[v0]{zoom_filter(zooms, Wd, Hd, fps)},setsar=1[vz];"
        cur = "vz"
    for i, (f, x, y, w, a, b, op) in enumerate(overlays):       # pictures on the video, under the captions
        extra += still(f)
        alpha = f",colorchannelmixer=aa={op / 100:.2f}" if op < 100 else ""
        fc += (f"[{n}:v]format=rgba,scale={w}:-1{alpha}[p{i}];"
               f"[{cur}][p{i}]overlay=x={x}-w/2:y={y}-h/2:enable='between(t,{a:.2f},{b:.2f})':shortest=1[o{i}];")
        cur, n = f"o{i}", n + 1
    fc += f"[{cur}]{pre + ',' if pre else ''}ass={name}.ass:fontsdir=f[vc];"
    cur = "vc"
    for i, (f, x, y, w, a, b, op) in enumerate(over):           # the hook's emoji: on top of the hook, in their gaps
        extra += still(f)
        fc += (f"[{n}:v]format=rgba,scale={w}:-1[e{i}];"
               f"[{cur}][e{i}]overlay=x={x}-w/2:y={y}-h/2:enable='between(t,{a:.2f},{b:.2f})':shortest=1[h{i}];")
        cur, n = f"h{i}", n + 1
    if brand:                                  # the brand badge goes on top of the captions, then the fades
        bpre, bover = brand
        fc += f"[{n}:v]{bpre}[lg];[{cur}][lg]{bover}{',' + post if post else ''}[vm]"
        extra += still("badge.png")
        n += 1
    else:
        fc += f"[{cur}]{post if post else 'null'}[vm]"
    total = end - start if not outro else outro["main"]
    if outro:                                  # the outro joined after the clip, fading in from the clip's last frame
        secs = outro["secs"]
        extra += (["-t", f"{secs:.2f}", "-i", outro["file"]] if outro["video"] else still(outro["file"]))
        fc += (f";[{n}:v]trim=duration={secs:.2f},setpts=PTS-STARTPTS,fps={fps},scale={Wd}:{Hd}:force_original_aspect_ratio=decrease,"
               f"pad={Wd}:{Hd}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,setsar=1,fade=t=in:st=0:d=0.35[ov];"
               f"[vm]format=yuv420p,setsar=1[vk];[vk][ov]concat=n=2:v=1:a=0[v]")
        n += 1
        total = outro["main"] + secs
    else:
        fc += ";[vm]null[v]"
    voice = asel + "loudnorm=I=-14:TP=-1.5:LRA=11" + (f",{audio}" if audio else "")
    if outro:
        voice += f",apad=whole_dur={total:.2f}"     # silence under the outro, so the music carries it
    if music:                                  # the music goes in last, and the sound is mixed in the same graph
        extra += (["-stream_loop", "-1"] if music["loop"] else []) + ["-ss", f"{music['at']:.2f}", "-i", "music.m4a"]
        fc += ";" + music_graph(music, n, total, voice, outro["main"] if outro else (total if music.get("rise_on") else 0.0))
        sound = ["-map", "[a]"]
    elif outro:
        fc += f";[0:a]{voice}[a]"
        sound = ["-map", "[a]"]
    else:
        sound = ["-map", "0:a:0", "-af", voice]
    if sfx:                                    # sound effects on top, each from its moment, at its level
        if sound[1] != "[a]":
            fc += f";[0:a]{voice}[a]"
        k = n + (1 if music else 0)
        for i, (f, at, vol) in enumerate(sfx):
            extra += ["-i", f]
            ms = int(round(at * 1000))
            fc += f";[{k + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol / 100 * 0.8:.2f},adelay={ms}:all=1[x{i}]"
        fc += f";[a]{''.join(f'[x{i}]' for i in range(len(sfx)))}amix=inputs={len(sfx) + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a2]"
        sound = ["-map", "[a2]"]
    base = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(src), *extra,
            "-filter_complex", fc, "-map", "[v]", *sound,
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
