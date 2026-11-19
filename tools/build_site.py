"""Build the public use-case pages and the blog.

    python tools/build_site.py

Reads content/pages/*.html and content/blog/*.html. Each file starts with a comment holding a small JSON block
(title, description, headings, links), followed by the page's own HTML. Every page gets the home page's top bar
and footer, its search tags (title, description, canonical, Open Graph, structured data) and links to related pages,
and is written to web/site/. The server shows web/site/<name>.html at /<name> and lists every file in the sitemap.
Run it again after changing any content file or the home page's top bar or footer."""
import hashlib
import html
import json
import re
import shutil
from datetime import date
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CONTENT, WEB = ROOT / "content", ROOT / "web"
OUT = WEB / "site"
E = html.escape


def read(kind):
    items = []
    for f in sorted((CONTENT / kind).glob("*.html")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"\s*<!--(.*?)-->\s*", text, re.S)
        if not m:
            raise SystemExit(f"{f}: missing the JSON header comment")
        meta = json.loads(m.group(1))
        meta["slug"], meta["body"] = f.stem, text[m.end():].strip()
        words = len(re.sub(r"<[^>]+>", " ", meta["body"]).split())
        meta["read"] = max(2, round(words / 220))
        items.append(meta)
    return items


# the order the use-case pages appear in, on the home page and in the footer
ORDER = ["twitch-clip-maker", "kick-clip-maker", "youtube-shorts-maker", "podcast-clip-maker", "auto-captions",
         "live-stream-clipper", "opus-clip-alternative", "socialshot-vs-opus-clip", "socialshot-vs-vizard",
         "socialshot-vs-streamladder", "socialshot-vs-eklipse"]
HEADER = FOOTER = ""


def frame(landing):
    """The home page's top bar and footer, so every page matches it."""
    global HEADER, FOOTER
    h = landing[landing.index('<header class="nav"'):landing.index("</div></header>") + len("</div></header>")]
    HEADER = re.sub(r' data-auth="[^"]*"', "", h.replace('href="#', 'href="/#'))
    FOOTER = landing[landing.index('<footer class="site">'):landing.index("</footer>") + len("</footer>")]


def fill(text, name, inner):
    """Replace what sits between <!-- name:start --> and <!-- name:end -->."""
    a, b = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    i, j = text.index(a) + len(a), text.index(b)
    return text[:i] + inner + text[j:]
ARROW = '<svg class="ti" viewBox="0 0 24 24"><path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/></svg>'
PLUS = '<svg class="ti" viewBox="0 0 24 24"><path d="M12 5l0 14"/><path d="M5 12l14 0"/></svg>'
# ---------------------------------------------------------------- structured data
# Every page carries one block of structured data for search engines: a "graph" of linked records. The company,
# the website and the app are described once, each with a fixed id, and every page points at them by that id,
# so Google reads them as one connected site instead of many loose descriptions.
SITE = "{{SITE}}"   # the server swaps in the real address (PEAKCUT_PUBLIC_URL) when it sends a page
ORG_ID, SITE_ID, APP_ID, LOGO_ID = SITE + "/#organization", SITE + "/#website", SITE + "/#software", SITE + "/#logo"
ORG = {"@type": "Organization", "@id": ORG_ID, "name": "SocialShot", "url": SITE + "/",
       "logo": {"@type": "ImageObject", "@id": LOGO_ID, "url": SITE + "/brand/logo-mark.png", "contentUrl": SITE + "/brand/logo-mark.png",
                "width": 512, "height": 512, "caption": "SocialShot"},
       "image": {"@id": LOGO_ID}}
WEBSITE = {"@type": "WebSite", "@id": SITE_ID, "url": SITE + "/", "name": "SocialShot", "alternateName": "SocialShot AI clip maker",
           "description": "AI clip maker that turns live streams, podcasts and long videos into captioned vertical clips.",
           "publisher": {"@id": ORG_ID}, "inLanguage": "en"}
APP = {"@type": "SoftwareApplication", "@id": APP_ID, "name": "SocialShot", "url": SITE + "/",
       "applicationCategory": "MultimediaApplication", "applicationSubCategory": "Video editing", "operatingSystem": "Web browser",
       "description": "AI clip maker that turns Twitch, Kick and YouTube live streams and videos into captioned vertical clips "
                      "for YouTube Shorts, Instagram Reels and TikTok.",
       "image": SITE + "/brand/og-home.jpg", "publisher": {"@id": ORG_ID}, "isAccessibleForFree": True,
       "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD", "url": SITE + "/signup",
                  "description": "Free Windows app with every feature. Bring your own AI key; a cloud version follows."},
       "featureList": ["Clips live streams while they are live", "AI picks the best moments", "Word-by-word captions",
                       "Vertical 9:16 clips", "Twitch, Kick and YouTube", "Posts to YouTube Shorts and Instagram Reels",
                       "Free Windows app with your own AI key"]}


def ld(obj):
    # "</" is escaped so text inside the data can never close the script tag early
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def graph(*nodes):
    return ld({"@context": "https://schema.org", "@graph": [n for n in nodes if n]})


def plain(a):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", a))).strip()


def crumbs(path, items):
    return {"@type": "BreadcrumbList", "@id": SITE + path + "#breadcrumb",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u}
                                for i, (n, u) in enumerate(items)]}


def webpage(path, title, desc, og, kind="WebPage", **more):
    url = SITE + path
    node = {"@type": kind, "@id": url + "#webpage", "url": url, "name": title, "description": desc, "inLanguage": "en",
            "isPartOf": {"@id": SITE_ID}, "breadcrumb": {"@id": url + "#breadcrumb"},
            "primaryImageOfPage": {"@type": "ImageObject", "url": SITE + og, "width": 1200, "height": 630}}
    node.update(more)
    return node


def faq_ld(path, faq):
    if not faq:
        return None
    return {"@type": "FAQPage", "@id": SITE + path + "#faq", "isPartOf": {"@id": SITE + path + "#webpage"}, "inLanguage": "en",
            "mainEntity": [{"@type": "Question", "name": plain(q), "acceptedAnswer": {"@type": "Answer", "text": plain(a)}}
                           for q, a in faq]}


# ---------------------------------------------------------------- share cards
# A 1200x630 picture for each page, shown when a link is shared and offered to Google as the page's main picture:
# the page's headline on the left, its photo on the right. Most photos are tall, so they are cropped, never stretched.
OG = WEB / "brand"
FONT = WEB / "brand" / "MazzardH-SemiBold.otf"


def og_card(name, photo, headline, pos=0.3):
    """The share image, in the hero's look: the page's near-black with its fine grain and the hero's violet and blue
    light, the SocialShot pill and the headline set like the hero heading, and four tilted product cards bleeding
    off the corners (captions, a clip rendering, the canvas, clips ready with real frames). Drawn at twice the size
    and scaled down, so the small text on the cards stays sharp."""
    OG.mkdir(parents=True, exist_ok=True)
    S, W, H = 2, 1200, 630
    B = WEB / "brand"
    fnt = lambda f, px: ImageFont.truetype(str(B / f), px * S)
    semi, med, reg = "MazzardH-SemiBold.otf", "MazzardH-Medium.otf", "MazzardH-Regular.otf"
    INK, MUTE, LINE = (240, 240, 244), (139, 139, 148), (52, 52, 60)
    PANEL, KEY = (23, 23, 27), (124, 58, 237)
    VIO_T, VIO_BG = (196, 176, 255), (46, 32, 84)

    # the ground: the page's grain, then the hero's lights
    tile = Image.open(B / "noise.png").convert("RGB").resize((192 * S, 192 * S), Image.NEAREST)
    card = Image.new("RGB", (W * S, H * S))
    for ty in range(0, H * S, tile.height):
        for tx in range(0, W * S, tile.width):
            card.paste(tile, (tx, ty))

    def light(cx, cy, rx, ry, rgb, a):
        m = Image.new("L", card.size, 0)
        ImageDraw.Draw(m).ellipse(((cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S), fill=round(255 * a))
        card.paste(Image.new("RGB", card.size, rgb), (0, 0), m.filter(ImageFilter.GaussianBlur(min(rx, ry) * S * .55)))

    light(W * .16, H * .04, 430, 300, (124, 58, 237), .34)
    light(W * .84, H * .02, 400, 280, (56, 152, 248), .2)
    light(W * .5, 0, 640, 330, (255, 255, 255), .06)

    def photo_fit(src, w, h, fx=.5, fy=.4):
        im = Image.open(src).convert("RGB")
        sc = max(w / im.width, h / im.height)
        im = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
        x, y = round((im.width - w) * fx), round((im.height - h) * fy)
        return im.crop((x, y, x + w, y + h))

    def rounded(im, r):
        m = Image.new("L", im.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        out.paste(im, (0, 0), m)
        return out

    def place(panel, x, y, angle):
        """A card with its shadow, shown at 80% so the corners stay quiet, turned by `angle` degrees, its top-left
        at (x, y) before turning."""
        panel = panel.resize((round(panel.width * .8), round(panel.height * .8)), Image.LANCZOS)
        w, h = panel.size
        pad = 60 * S
        layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        sh = Image.new("L", layer.size, 0)
        ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 16 * S, pad + w, pad + h + 16 * S), 18 * S, fill=170)
        layer.paste(Image.new("RGBA", layer.size, (0, 0, 0, 255)), (0, 0), sh.filter(ImageFilter.GaussianBlur(22 * S)))
        layer.alpha_composite(panel, (pad, pad))
        layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
        card.paste(layer, (round(x * S - (layer.width - w) / 2), round(y * S - (layer.height - h) / 2)), layer)

    def cursor(dr, x, y, name, tag):
        pts = [(0, 0), (0, 17), (4.5, 13), (7.5, 20), (10.2, 18.8), (7.2, 12.4), (12.6, 12.4)]
        dr.polygon([(x + px * S, y + py * S) for px, py in pts], fill=(139, 92, 246), outline=(255, 255, 255), width=round(1.6 * S))
        nf = fnt(semi, 11)
        tw = dr.textlength(name, font=nf)
        dr.rounded_rectangle((x + 13 * S, y + 15 * S, x + 13 * S + tw + 14 * S, y + 33 * S), 6 * S, fill=tag)
        dr.text((x + 20 * S, y + 24 * S), name, font=nf, fill=(255, 255, 255), anchor="lm")

    def panel(w, h):
        p = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(p)
        d.rounded_rectangle((0, 0, w * S - 1, h * S - 1), 18 * S, fill=PANEL, outline=(46, 46, 54), width=S)
        d.line((18 * S, S, (w - 18) * S, S), fill=(62, 62, 70), width=S)   # the light along the top edge
        return p, d

    # top left: captions, the spoken word lit in violet
    p, d = panel(360, 128)
    d.rounded_rectangle((20 * S, 20 * S, 46 * S, 40 * S), 6 * S, fill=VIO_BG)
    d.text((33 * S, 30 * S), "cc", font=fnt(semi, 11), fill=VIO_T, anchor="mm")
    d.text((56 * S, 30 * S), "Karaoke captions", font=fnt(med, 14), fill=MUTE, anchor="lm")
    f = fnt(semi, 26)
    d.text((20 * S, 74 * S), "Turn one stream into", font=f, fill=INK, anchor="lm")
    x = 20 * S + d.textlength("Turn one stream into ", font=f) + 6 * S
    tw = d.textlength("ten", font=f)
    d.rounded_rectangle((x - 6 * S, 58 * S, x + tw + 6 * S, 90 * S), 8 * S, fill=KEY)
    d.text((x, 74 * S), "ten", font=f, fill=(255, 255, 255), anchor="lm")
    d.text((20 * S, 106 * S), "short clips", font=f, fill=INK, anchor="lm")
    cursor(d, x + tw / 2 - 8 * S, 80 * S, "Maya", (236, 72, 153))
    place(p, -30, 40, -4)

    # top right: a clip rendering
    p, d = panel(330, 104)
    d.ellipse((20 * S, 20 * S, 52 * S, 52 * S), fill=KEY)
    d.polygon([(32 * S, 28 * S), (32 * S, 44 * S), (45 * S, 36 * S)], fill=(255, 255, 255))
    d.text((64 * S, 28 * S), "stream-clip-03.mp4", font=fnt(semi, 18), fill=INK, anchor="lm")
    d.text((64 * S, 48 * S), "Burning captions · 64%", font=fnt(reg, 13), fill=MUTE, anchor="lm")
    d.rounded_rectangle((20 * S, 74 * S, 310 * S, 82 * S), 4 * S, fill=(40, 40, 47))
    d.rounded_rectangle((20 * S, 74 * S, 206 * S, 82 * S), 4 * S, fill=KEY)
    place(p, 962, 26, 3)

    # bottom left: the canvas
    p, d = panel(300, 118)
    d.text((22 * S, 28 * S), "Canvas", font=fnt(med, 14), fill=MUTE, anchor="lm")
    for i, lab in enumerate(("9:16", "1:1", "16:9")):
        x0 = (22 + i * 90) * S
        on = i == 0
        d.rounded_rectangle((x0, 48 * S, x0 + 78 * S, 96 * S), 11 * S, fill=VIO_BG if on else (30, 30, 35),
                            outline=(139, 92, 246) if on else LINE, width=2 * S if on else S)
        d.text((x0 + 39 * S, 72 * S), lab, font=fnt(semi, 17), fill=VIO_T if on else (200, 200, 208), anchor="mm")
    cursor(d, 82 * S, 76 * S, "Leo", (245, 158, 11))
    place(p, -22, 510, 2.5)

    # bottom right: clips ready, with real frames
    p, d = panel(300, 196)
    d.ellipse((22 * S, 24 * S, 32 * S, 34 * S), fill=(34, 197, 94))
    d.text((42 * S, 29 * S), "3 clips ready", font=fnt(semi, 18), fill=INK, anchor="lm")
    frames = [(B / f"{photo}.jpg", .5, pos), (B / "yt" / "eQp4cDRghMA.jpg", .3, .4), (B / "yt" / "SXAwIHOLmjY.jpg", .76, .4)]
    for i, (src, fx, fy) in enumerate(frames):
        p.alpha_composite(rounded(photo_fit(src, 80 * S, 104 * S, fx, fy), 9 * S), ((22 + i * 88) * S, 46 * S))
    cx = 22 * S
    for lab, bg, fg in (("done", (20, 58, 36), (74, 222, 128)), ("rendering", VIO_BG, VIO_T), ("draft", (38, 38, 45), (165, 165, 175))):
        tw = d.textlength(lab, font=fnt(semi, 12))
        d.rounded_rectangle((cx, 162 * S, cx + tw + 20 * S, 184 * S), 11 * S, fill=bg)
        d.text((cx + 10 * S, 173 * S), lab, font=fnt(semi, 12), fill=fg, anchor="lm")
        cx += tw + 28 * S
    place(p, 972, 466, -3)

    # the middle: the pill, like the hero's, then the headline set like the hero heading
    d = ImageDraw.Draw(card)
    lf = ImageFont.truetype(str(B / "Geomini.woff2"), 22 * S)
    lf.set_variation_by_axes([600])
    pw = (16 + 30 + 10) * S + d.textlength("socialshot.io", font=lf) + 20 * S

    WHITE, DIM, RED = (255, 255, 255), (112, 112, 120), (255, 90, 103)
    # a row is a list of items: a run of text pieces [(text, colour), ...] or a picture chip ("chip", which)
    CHIPS = {   # like the hero's: a long video with its running time, and the short cut from it
        "wide": (B / "yt" / "AGofxM7xM2A.jpg", 1.5, .84, .5, .5, "1:12:45", (78, 78, 88)),
        "tall": (B / "yt" / "KVg3nJbDvh0.jpg", .52, .92, .1, .3, "0:42", (139, 92, 246)),
    }
    if name == "home":   # the hero heading itself: the two pictures, and the grey and red last line
        rows = [[[("Turn", WHITE)], ("chip", "wide"), [("long videos", WHITE)]],
                [[("into", WHITE)], ("chip", "tall"), [("short clips,", WHITE)]],
                [[("while you're ", DIM), ("still live.", RED)]]]
    else:
        rows = None

    def width(text, font, tr):
        return d.textlength(text, font=font) + tr * max(len(text) - 1, 0)

    def row_width(row, font, tr, size):
        gap = .24 * size * S
        ws = [CHIPS[it[1]][1] * size * S if isinstance(it, tuple) else width("".join(t for t, _ in it), font, tr) for it in row]
        return sum(ws) + gap * (len(row) - 1)

    size = 70
    while True:   # the largest size at which the headline fits in three lines
        font, tr = fnt(semi, size), -0.045 * size * S
        if rows:
            lines = rows
            if all(row_width(r, font, tr, size) <= 760 * S for r in rows) or size <= 40:
                break
        else:
            ws, lines = headline.split(), [""]
            for w in ws:
                t = (lines[-1] + " " + w).strip()
                lines[-1:] = [t] if width(t, font, tr) <= 700 * S or not lines[-1] else [lines[-1], w]
            if len(lines) <= 3 or size <= 40:
                n, lo, hi = len(lines), 0, 700 * S   # balance: the narrowest measure that still needs no more lines
                for _ in range(18):
                    mid = (lo + hi) / 2
                    trial = [""]
                    for w in ws:
                        tt = (trial[-1] + " " + w).strip()
                        trial[-1:] = [tt] if width(tt, font, tr) <= mid or not trial[-1] else [trial[-1], w]
                    if len(trial) <= n:
                        hi, lines = mid, trial
                    else:
                        lo = mid
                lines = [[[(l, WHITE)]] for l in lines]
                break
        size -= 4
    lh = round(size * 1.04) * S
    ICON, GAP = 40 * S, 12 * S
    block = 48 * S + 30 * S + lh * len(lines) + 34 * S + ICON
    py = (H * S - block) // 2
    px = (W * S - pw) / 2
    d.rounded_rectangle((px, py, px + pw, py + 48 * S), 24 * S, fill=(26, 26, 30), outline=(60, 60, 68), width=S)
    mark = Image.open(B / "logo-mark.png").convert("RGBA").resize((30 * S, 30 * S), Image.LANCZOS)
    card.paste(mark, (round(px + 16 * S), round(py + 9 * S)), mark)
    d.text((px + 56 * S, py + 24 * S), "socialshot.io", font=lf, fill=INK, anchor="lm")
    y0 = py + 48 * S + 30 * S - round(size * .12) * S

    # under the headline: the platforms, as their own small app icons
    keys = ("tw", "kk", "yt", "tt", "ig")
    ix = (W * S - (ICON * len(keys) + GAP * (len(keys) - 1))) // 2
    iy = py + block - ICON
    for k in keys:
        ic = rounded(Image.open(B / "og-icons" / f"{k}.png").convert("RGB").resize((ICON, ICON), Image.LANCZOS), 11 * S)
        sh = Image.new("L", (ICON + 24 * S, ICON + 24 * S), 0)
        ImageDraw.Draw(sh).rounded_rectangle((12 * S, 16 * S, 12 * S + ICON, 16 * S + ICON), 11 * S, fill=150)
        card.paste((0, 0, 0), (ix - 12 * S, iy - 12 * S), sh.filter(ImageFilter.GaussianBlur(6 * S)))
        card.paste(ic, (ix, iy), ic)
        ix += ICON + GAP

    bb = font.getbbox("Turnx")
    mid_y = (bb[1] + bb[3]) / 2              # the middle of the letters, where a chip sits
    gap = .24 * size * S
    for i, row in enumerate(lines):
        y = y0 + i * lh
        x = (W * S - row_width(row, font, tr, size)) / 2
        for it in row:
            if isinstance(it, tuple):         # a picture chip, centred on the letters, with its time in the corner
                src, cw, ch_, fx, fy, dur, edge = CHIPS[it[1]]
                w_, h_ = round(cw * size * S), round(ch_ * size * S)
                pic = rounded(photo_fit(src, w_, h_, fx, fy), round(.12 * size * S))
                pd = ImageDraw.Draw(pic)
                pd.rounded_rectangle((0, 0, w_ - 1, h_ - 1), round(.12 * size * S), outline=edge + (255,), width=round(1.5 * S))
                bf = fnt(semi, max(9, round(size * .15)))
                bw = pd.textlength(dur, font=bf) + 8 * S
                bh = round(size * .2 * S)
                bx = w_ - bw - 4 * S if it[1] == "wide" else (w_ - bw) / 2
                pd.rounded_rectangle((bx, h_ - bh - 4 * S, bx + bw, h_ - 4 * S), 3 * S, fill=(0, 0, 0, 215))
                pd.text((bx + bw / 2, h_ - 4 * S - bh / 2), dur, font=bf, fill=(255, 255, 255), anchor="mm")
                card.paste(pic, (round(x), round(y + mid_y - h_ / 2)), pic)
                x += w_ + gap
                continue
            full = "".join(t for t, _ in it)
            at = 0
            for text, col in it:
                sx = None
                for c in text:
                    cx = x + d.textlength(full[:at], font=font) + tr * at
                    sx = cx if sx is None else sx
                    d.text((cx, y), c, font=font, fill=col)
                    at += 1
                if col == RED:   # the hero's hand-drawn underline under "still live."
                    ex = x + width(full, font, tr)
                    by = y + round(size * 1.0) * S
                    pts = [(sx + (ex - sx) * k / 40, by - S * (6 * (1 - ((k / 40) * 2 - 1) ** 2))) for k in range(41)]
                    d.line(pts, fill=(255, 255, 255), width=5 * S, joint="curve")
                    for e in (pts[0], pts[-1]):
                        d.ellipse((e[0] - 2.5 * S, e[1] - 2.5 * S, e[0] + 2.5 * S, e[1] + 2.5 * S), fill=(255, 255, 255))
            x += width(full, font, tr) + gap

    final = card.resize((W, H), Image.LANCZOS)
    noise = Image.effect_noise((W, H), 48)
    up = noise.point(lambda v: max(0, v - 128) * .15).convert("RGB")
    down = noise.point(lambda v: max(0, 128 - v) * .15).convert("RGB")
    final = ImageChops.subtract(ImageChops.add(final, up), down)
    out = OG / f"og-{name}.jpg"
    final.save(out, quality=90, optimize=True, progressive=True)
    return f"/brand/og-{name}.jpg?v={hashlib.md5(out.read_bytes()).hexdigest()[:8]}"


def head(title, desc, path, og, extra="", kind="website", alt="", art=None):
    """The top of every page. og is the share card from og_card(); art holds an article's dates and topic."""
    img = SITE + og
    arts = "".join(f'<meta property="article:{k}" content="{E(v)}">\n' for k, v in (art or {}).items())
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{{{{SITE}}}}{path}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<meta name="theme-color" content="#141416">
<meta property="og:type" content="{kind}">
<meta property="og:locale" content="en_US">
<meta property="og:site_name" content="SocialShot">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{{{{SITE}}}}{path}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{E(alt or title)}">
{arts}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{E(title)}">
<meta name="twitter:description" content="{E(desc)}">
<meta name="twitter:image" content="{img}">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg?v=6">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png?v=6">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png?v=6">
<link rel="manifest" href="/brand/site.webmanifest">
<link rel="preload" href="/brand/ApfelGrotezk-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/ui.css?v=7">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&display=swap">
<link rel="stylesheet" href="/assets/site.css?v=26">
<script src="/assets/site.js?v=4" defer></script>
{extra}
</head>
<body>
{HEADER}
<main>
'''


def tail():
    return f'''</main>
{FOOTER}
<script>
document.querySelectorAll(".fy").forEach(e => e.textContent = new Date().getFullYear());
(() => {{ const n = document.getElementById("nav"), f = () => n.classList.toggle("stuck", scrollY > 24); addEventListener("scroll", f, {{passive:true}}); f(); }})();
</script>
</body>
</html>
'''


def cta(title="Ready to clip your next stream?", text="Get the free Windows app, add your AI key and clip your next stream tonight."):
    """The closing box on every page, the same one the home page ends on."""
    head = E(title).replace("next", "<em>next</em>", 1)
    return ('<section class="cta-band"><div class="wrap"><div class="closer2">' + CL2_TILES +
            f'<h2>{head}</h2><p>{E(text)}</p>'
            f'<div class="ctas"><a class="btn lg primary" href="/#get-app">Get the Windows app{ARROW}</a><a class="btn lg outline" href="/#how">See how it works</a></div>'
            '<small class="cl2-note">* free, no card, cloud version in a few days</small>'
            '<img class="cl2-mascot" src="/brand/logo-mark.png" alt="" aria-hidden="true"></div></div></section>')


CL2_TILES = '<i class="cl2-grid" aria-hidden="true"></i><span class="gt g1" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 7m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M6 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M8.6 8.6l10.4 10.4"/><path d="M8.6 15.4l10.4 -10.4"/></svg></span><span class="gt g2" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M10.5 10.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0"/><path d="M16.5 10.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0"/></svg></span><span class="gt g3" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M5 15v4"/><path d="M9.5 12v7"/><path d="M14 13v6"/><path d="M18.5 9v10"/><path d="M5 11l5 -4l4 3l6 -5"/><path d="M16 5h4v4"/></svg></span><span class="gt g4" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 15l6 -6"/><path d="M11 6l.46 -.54a5 5 0 0 1 7.07 7.07l-.54 .47"/><path d="M13 18l-.4 .53a5.07 5.07 0 0 1 -7.12 0a4.97 4.97 0 0 1 0 -7.07l.52 -.46"/></svg></span>'


def home_schema(land):
    """The home page's structured data. Its questions are read from the page itself, so the two never drift apart."""
    og = og_card("home", "stream-gamer", "Turn long videos into short clips, while you're still live")
    title = html.unescape(re.search(r"<title>(.*?)</title>", land).group(1))
    desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', land).group(1))
    box = land[land.index('<div class="qlist'):]
    faq = re.findall(r'<span class="qt">(.*?)</span>.*?<div class="qa"><p>(.*?)</p>', box[:box.index("</section>")], re.S)
    page = webpage("/", title, desc, og, about={"@id": APP_ID}, mainEntity={"@id": APP_ID})
    page.pop("breadcrumb")
    return graph(ORG, WEBSITE, page, APP, faq_ld("/", faq))


def qa_items(faq):
    """Numbered questions that open in place; shared by the tool pages and the blog posts."""
    return "".join(f'<details><summary><span class="qn">{k:02d}</span><span class="qt">{E(q)}</span><span class="qi">{PLUS}</span></summary>'
                   f'<div class="qa"><p>{a}</p></div></details>' for k, (q, a) in enumerate(faq, 1))


def faq_block(faq, label):
    if not faq:
        return ""
    return ('<section class="pfaq"><div class="wrap"><div class="fq fq-c"><div class="fq-head">'
            '<h2>Common questions</h2><p>Not sure it fits your stream? Paste one link and see what gets picked.</p></div>'
            f'<div class="qlist">{qa_items(faq)}</div></div></div></section>')


ICONS = {  # one line icon per kind of tool page
    "live": '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>'
            '<path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    "game": '<path d="M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z"/><path d="M6 12h4"/><path d="M8 10v4"/>'
            '<path d="M15 13v.01"/><path d="M18 11v.01"/>',
    "phone": '<path d="M6 4a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"/><path d="M11 18h2"/>',
    "mic": '<path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1 -6 0z"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/>',
    "cc": '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M7 15h4"/><path d="M14 15h3"/>'
          '<path d="M7 11h2"/><path d="M12 11h5"/>',
    "compare": '<path d="M8 3l-4 4l4 4"/><path d="M4 7h16"/><path d="M16 21l4 -4l-4 -4"/><path d="M20 17h-16"/>',
}
ICON_FOR = {"live-stream-clipper": "live", "twitch-clip-maker": "game", "kick-clip-maker": "game",
            "youtube-shorts-maker": "phone", "podcast-clip-maker": "mic", "auto-captions": "cc"}


# the platform each tool page is about: its own logo in the card's corner tab, and its colour in the frame
BRAND = {  # simple glyphs, drawn filled; a page not listed uses its line icon instead
    "twitch": ('<path d="M4.3 3L3 6.3v13.4h4.6V22h2.6l2.4-2.3h3.7l5-4.9V3zm15.4 10.8l-2.9 2.8h-4.6l-2.4 2.4v-2.4H6V4.7h13.7zM16.8 7.6h-1.7v4.9h1.7zm-4.6 0h-1.7v4.9h1.7z"/>', "#9146FF"),
    "kick": ('<path d="M3 3h6v4h2V5h2V3h8v6h-2v2h-2v2h2v2h2v6h-8v-2h-2v-2H9v4H3z"/>', "#53FC18"),
    "youtube": ('<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>', "#FF0033"),
}
BRAND_FOR = {"twitch-clip-maker": "twitch", "kick-clip-maker": "kick", "youtube-shorts-maker": "youtube"}
TINT_FOR = {"podcast-clip-maker": "#E1306C", "auto-captions": "#FFE500", "live-stream-clipper": "#FF4D5E"}


# the platforms' own app icons, drawn the way the home page draws them
APP_ICON = {"tw": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>', "kk": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>', "yt": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>', "tt": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>', "ig": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.6 7.4h.01"/></svg>'}
MARK_FOR = {"twitch-clip-maker": "tw", "kick-clip-maker": "kk", "youtube-shorts-maker": "yt"}


def hero_mark(p):
    """The page's subject as an app icon above the headline: the platform's own, or the page's line icon on a violet tile."""
    k = MARK_FOR.get(p["slug"])
    if k:
        return f'<span class="ph-mark ai {k}" aria-hidden="true">{APP_ICON[k]}</span>'
    ic = ICONS[ICON_FOR.get(p["slug"], "compare")]
    return f'<span class="ph-mark ai ln" aria-hidden="true"><svg class="ti" viewBox="0 0 24 24">{ic}</svg></span>'


def hero_deco():
    """Brand app icons drifting around the page's hero, as on the home page."""
    spots = [("tw", 9, 26), ("yt", 15, 62), ("tt", 88, 22), ("ig", 83, 58), ("kk", 92, 82)]
    return ('<div class="ph-deco" aria-hidden="true">' + "".join(
        f'<span class="ai {k}" style="--x:{x}%;--y:{y}%;--i:{i}">{APP_ICON[k]}</span>' for i, (k, x, y) in enumerate(spots)) + '</div>')


def page_card(p):
    """A tool page as a card: a dark panel in a frame tinted with the platform's colour, the platform's mark in a tab
    notched into the top-right corner."""
    s = p["slug"]
    if s in BRAND_FOR:
        glyph, col = BRAND[BRAND_FOR[s]]
        mark = f'<svg class="rc-br" viewBox="0 0 24 24" style="fill:{col}">{glyph}</svg>'
    else:
        col = TINT_FOR.get(s, "#8B5CF6")
        mark = f'<svg class="ti" viewBox="0 0 24 24" style="color:{col}">{ICONS[ICON_FOR.get(s, "compare")]}</svg>'
    return (f'<a class="rcard" href="/{s}" style="--pc:{col}"><span class="rc-tab">{mark}</span><span class="rc-in">'
            f'<span class="rk">{E(p["eyebrow"])}</span><b>{E(p["nav"])}</b><small>{E(p["card"])}</small>'
            f'<span class="rc-go">Open{ARROW}</span></span></a>')


LINK = ('<svg class="ti" viewBox="0 0 24 24"><path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/>'
        '<path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/></svg>')
SHARE = [  # name, address that opens the share box (filled in with the page's address), icon
    ("X", "https://x.com/intent/post?url={u}&text={t}",
     "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"),
    ("LinkedIn", "https://www.linkedin.com/sharing/share-offsite/?url={u}",
     "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"),
    ("Facebook", "https://www.facebook.com/sharer/sharer.php?u={u}",
     "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"),
]


def post_card(b, big=False):
    """A blog card: picture, topic and date, title, reading time. The big one (top of /blog) also has the summary."""
    img = (f'<span class="pimg"><img src="/brand/{b["image"]}.jpg" alt="" loading="lazy" '
           f'style="object-position:{b.get("pos", "50% 35%")}"></span>')
    tag = f'<span class="ptag">{E(b["tag"])}</span>'
    meta = f'<span class="pmeta">{short(b["date"])}<i></i>{b["read"]} min read</span>'
    if big:  # the top of /blog: load the picture straight away
        img = img.replace('loading="lazy"', 'fetchpriority="high"')
        return (f'<a class="pcard feat" href="/blog/{b["slug"]}" data-tag="{E(b["tag"])}"><span class="pc">{tag}<b>{E(b["h1"])}</b>'
                f'<small>{E(b["excerpt"])}</small>{meta}<span class="btn primary">Read the guide{ARROW}</span></span>{img}</a>')
    return (f'<a class="pcard" href="/blog/{b["slug"]}" data-tag="{E(b["tag"])}">{img}<span class="pc">{tag}<b>{E(b["h1"])}</b>{meta}</span></a>')


def nice(d):
    y, m, dd = map(int, d.split("-"))
    return date(y, m, dd).strftime("%d %B %Y").lstrip("0")


def short(d):
    y, m, dd = map(int, d.split("-"))
    return date(y, m, dd).strftime("%d %b %Y").lstrip("0")


def anchors(body):
    """Give every h2 in a post an id, and return the list for the 'On this page' box."""
    toc = []

    def tag(m):
        text = re.sub(r"<[^>]+>", "", m.group(1))
        slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48].rstrip("-")
        toc.append((slug, text))
        return f'<h2 id="{slug}">{m.group(1)}</h2>'
    return re.sub(r"<h2>(.*?)</h2>", tag, body), toc


def toc_list(toc):
    return "".join(f'<li><a href="#{s}">{E(t)}</a></li>' for s, t in toc)


# a post page: fill in the share links, copy the address, and mark the section being read in "On this page"
POST_JS = '''<script>
(() => {
  const url = location.origin + location.pathname, title = document.querySelector("h1").textContent;
  document.querySelectorAll("[data-share]").forEach(a => a.href = a.dataset.share
    .replace("{u}", encodeURIComponent(url)).replace("{t}", encodeURIComponent(title)));
  const copy = document.getElementById("copy");
  copy.addEventListener("click", () => navigator.clipboard.writeText(url).then(() => {
    copy.classList.add("done"); copy.setAttribute("aria-label", "Link copied");
    setTimeout(() => { copy.classList.remove("done"); copy.setAttribute("aria-label", "Copy link"); }, 1600);
  }));
  const links = [...document.querySelectorAll(".toc a")];
  if (!links.length) return;
  const heads = links.map(a => document.getElementById(a.hash.slice(1)));
  const mark = () => {
    let i = 0;
    heads.forEach((h, k) => { if (h.getBoundingClientRect().top < 140) i = k; });
    links.forEach((a, k) => a.classList.toggle("on", k === i));
  };
  addEventListener("scroll", mark, {passive: true}); mark();
})();
</script>'''

# the blog list: pick a topic to show only its guides
INDEX_JS = '''<script>
(() => {
  const btns = document.querySelectorAll(".tags button"), feat = document.querySelector(".feat");
  btns.forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.tag;
    btns.forEach(x => x.classList.toggle("on", x === b));
    feat.hidden = !!t;
    document.querySelectorAll("#all .pcard").forEach(c => c.hidden = t ? c.dataset.tag !== t : c.classList.contains("dup"));
  }));
})();
</script>'''


def side_post(b):
    return (f'<a class="spost" href="/blog/{b["slug"]}"><img src="/brand/{b["image"]}.jpg" alt="" loading="lazy" '
            f'style="object-position:{b.get("pos", "50% 35%")}"><span><em>{E(b["tag"])}</em><b>{E(b["h1"])}</b></span></a>')


DATES = WEB / "sitemap-dates.json"


def dates(posts):
    """The sitemap tells Google when each page last changed. A page's date only moves when its text really changes
    (a new stylesheet version does not count), and a post uses the dates written in its own header, so Google can
    trust the dates and come back for the pages that are new."""
    old = json.loads(DATES.read_text(encoding="utf-8")) if DATES.exists() else {}
    today, new = date.today().isoformat(), {}
    files = {"/": WEB / "landing.html", "/legal": WEB / "legal.html", "/blog": OUT / "blog" / "index.html"}
    files.update({"/" + f.stem: f for f in OUT.glob("*.html")})
    for path, f in files.items():
        text = re.sub(r"\?v=[0-9a-f]+", "", f.read_text(encoding="utf-8"))
        h = hashlib.md5(text.encode()).hexdigest()
        prev = old.get(path, {})
        new[path] = {"hash": h, "date": prev.get("date", today) if prev.get("hash") == h else today}
    for b in posts:
        new["/blog/" + b["slug"]] = {"date": b.get("updated", b["date"])}
    new["/blog"]["date"] = max(new["/blog"]["date"], *(v["date"] for k, v in new.items() if k.startswith("/blog/")))
    DATES.write_text(json.dumps(new, indent=1, sort_keys=True), encoding="utf-8")


def changelog_page():
    """/changelog: every release, newest first. Each shows its version and date, a short summary, and its features
    in groups as cards with a picture. Written in content/changelog.json, so a new release is a new entry there."""
    data = json.loads((ROOT / "content" / "changelog.json").read_text(encoding="utf-8"))
    rels = data["releases"]
    latest = rels[0]
    title = f"Changelog: What's New in SocialShot {latest['version']} | SocialShot"
    desc = (f"Everything new in SocialShot {latest['version']}: {latest['title']}. " + latest["summary"])[:300]
    og = og_card("changelog", "reel-poster", f"What's new in SocialShot {latest['version']}")
    path = "/changelog"
    blocks = []
    for n, r in enumerate(rels):
        when = nice(r["date"])
        total = sum(len(g["items"]) for g in r["groups"])
        chips = "".join(f'<a href="#{E(r["version"])}-{E(g["id"])}">{E(g["name"])}<span>{len(g["items"])}</span></a>' for g in r["groups"])
        groups = ""
        for g in r["groups"]:
            cards = "".join(
                f'<article class="cl-card">'
                f'<span class="cl-pic"><img src="/brand/{E(it["img"])}" alt="" loading="lazy" decoding="async"></span>'
                f'<span class="cl-tx">{"<em class=cl-new>New</em>" if it.get("new") else ""}<b>{E(it["title"])}</b><small>{E(it["text"])}</small></span>'
                f'</article>' for it in g["items"])
            groups += (f'<section class="cl-group" id="{E(r["version"])}-{E(g["id"])}"><h3>{E(g["name"])}<span>{len(g["items"])}</span></h3>'
                       f'<div class="cl-grid">{cards}</div></section>')
        hl = "".join(f"<li>{E(h)}</li>" for h in r.get("highlights", []))
        blocks.append(
            f'<div class="cl-rel" id="v{E(r["version"])}">'
            f'<aside class="cl-side"><span class="cl-ver">v{E(r["version"])}</span>'
            + ('<span class="cl-latest"><i></i>Latest</span>' if n == 0 else "")
            + f'<time datetime="{E(r["date"])}">{E(when)}</time><small>{total} features</small></aside>'
            f'<div class="cl-body"><h2>{E(r["title"])}</h2><p class="cl-sum">{E(r["summary"])}</p>'
            + (f'<ul class="cl-hl">{hl}</ul>' if hl else "")
            + f'<nav class="cl-chips" aria-label="Parts of this release">{chips}</nav>{groups}</div></div>')
    extra = graph(ORG, WEBSITE, webpage(path, title, desc, og), crumbs(path, [("Home", "/"), ("Changelog", path)]))
    out = (head(title, desc, path, og, extra)
           + '<section class="bhead cl-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><b>Changelog</b></nav>'
           f'<h1>Changelog</h1><p>What is new in SocialShot. The latest is version {E(latest["version"])}, from {E(nice(latest["date"]))}.</p></div></section>'
           f'<section class="clog"><div class="wrap">{"".join(blocks)}</div></section>'
           + cta() + tail())
    (OUT / "changelog.html").write_text(out, encoding="utf-8")


def build():
    pages, posts = read("pages"), read("blog")
    by_page, by_post = {p["slug"]: p for p in pages}, {b["slug"]: b for b in posts}
    pages.sort(key=lambda p: ORDER.index(p["slug"]) if p["slug"] in ORDER else len(ORDER))
    posts.sort(key=lambda b: b["date"], reverse=True)

    # the home page links to every page and the newest posts; its footer lists every page
    lf = WEB / "landing.html"
    land = lf.read_text(encoding="utf-8")
    uses = [p for p in pages if p.get("group") != "compare"]
    compares = [p for p in pages if p.get("group") == "compare"]
    link = lambda p: f'<li><a href="/{p["slug"]}">{E(p["nav"])}</a></li>'
    land = fill(land, "use-cases", "".join(page_card(p) for p in uses))
    land = fill(land, "blog", "".join(post_card(b) for b in posts[:3]))
    land = fill(land, "footer-pages", "".join(link(p) for p in uses))
    land = fill(land, "footer-compare", "".join(link(p) for p in compares))
    land = fill(land, "schema", home_schema(land))
    lf.write_text(land, encoding="utf-8")
    frame(land)
    # the legal pages carry the same footer
    gf = WEB / "legal.html"
    legal = gf.read_text(encoding="utf-8")
    a, b = legal.index('<footer class="site">'), legal.index("</footer>") + len("</footer>")
    gf.write_text(legal[:a] + FOOTER + legal[b:], encoding="utf-8")
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "blog").mkdir(parents=True)

    for p in pages:
        path = "/" + p["slug"]
        og = og_card(p["slug"], p["image"], p["h1"], p.get("og_pos", 0.3))
        extra = graph(ORG, WEBSITE, APP,
                      webpage(path, p["title"], p["description"], og, about={"@id": APP_ID}, mainEntity={"@id": APP_ID}),
                      crumbs(path, [("Home", "/"), (p["nav"], path)]), faq_ld(path, p.get("faq")))
        rel_pages = "".join(page_card(by_page[s]) for s in p["related"])
        rel_posts = "".join(post_card(by_post[s]) for s in p.get("posts", []))
        out = (head(p["title"], p["description"], path, og, extra)
               + f'<section class="phead tool">{hero_deco()}<div class="wrap">{hero_mark(p)}<span class="sr">{E(p["eyebrow"])}</span><h1>{E(p["h1"])}</h1><p>{E(p["lede"])}</p>'
               f'<div class="ctas"><a class="btn lg primary" href="/#get-app">Get the Windows app{ARROW}</a><a class="btn lg outline" href="/#how">How it works</a></div>'
               f'<ul class="fine"><li>Free, no card</li><li>Your own AI key</li><li>Cloud version in a few days</li></ul></div></section>'
               + f'<section class="pbody"><div class="wrap">{p["body"]}</div></section>'
               + faq_block(p.get("faq"), p["nav"])
               + f'<section class="rel"><div class="wrap"><h2 class="sec">More ways to clip</h2><div class="rgrid">{rel_pages}</div>'
               + (f'<h2 class="sec">From the blog</h2><div class="pgrid">{rel_posts}</div>' if rel_posts else "")
               + '</div></section>' + cta() + tail())
        (OUT / f'{p["slug"]}.html').write_text(out, encoding="utf-8")

    for b in posts:
        path = "/blog/" + b["slug"]
        og = og_card("blog-" + b["slug"], b["image"], b["h1"], b.get("og_pos", 0.3))
        url, words = SITE + path, len(plain(b["body"]).split())
        changed = b.get("updated", b["date"])
        cw, ch = Image.open(WEB / "brand" / f'{b["image"]}.jpg').size
        art = {"@type": "BlogPosting", "@id": url + "#article", "isPartOf": {"@id": url + "#webpage"},
               "mainEntityOfPage": {"@id": url + "#webpage"}, "headline": b["h1"][:110], "description": b["description"],
               "image": [{"@type": "ImageObject", "url": SITE + og, "width": 1200, "height": 630},
                         {"@type": "ImageObject", "url": f'{SITE}/brand/{b["image"]}.jpg', "width": cw, "height": ch}],
               "datePublished": b["date"], "dateModified": changed, "author": {"@id": ORG_ID}, "publisher": {"@id": ORG_ID},
               "articleSection": b["tag"], "keywords": b.get("keywords", []), "wordCount": words, "inLanguage": "en"}
        if b.get("related_pages"):
            art["about"] = {"@id": APP_ID}
        extra = graph(ORG, WEBSITE, webpage(path, b["title"], b["description"], og, datePublished=b["date"], dateModified=changed),
                      art, crumbs(path, [("Home", "/"), ("Blog", "/blog"), (b["h1"], path)]), faq_ld(path, b.get("faq")),
                      APP if b.get("related_pages") else None)
        more = [by_post[s] for s in b.get("related_posts", [])]
        more += [p for p in posts if p is not b and p not in more][:3 - len(more)]
        tools = [by_page[s] for s in b.get("related_pages", [])]
        body, toc = anchors(b["body"])
        share = "".join(f'<a class="sh" href="{{{{SITE}}}}{path}" data-share="{E(u)}" target="_blank" rel="noopener" aria-label="Share on {n}">'
                        f'<svg viewBox="0 0 24 24"><path d="{d}"/></svg></a>' for n, u, d in SHARE)
        share += f'<button class="sh" type="button" id="copy" aria-label="Copy link">{LINK}</button>'
        faq = qa_items(b.get("faq", []))
        out = (head(b["title"], b["description"], path, og, extra, kind="article", alt=b.get("alt", ""),
                    art={"published_time": b["date"], "modified_time": changed, "section": b["tag"]})
               + '<article class="post"><div class="wrap"><div class="pwrap"><div class="pmain">'
               f'<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/blog">Blog</a><span>/</span><b>{E(b["tag"])}</b></nav>'
               f'<h1>{E(b["h1"])}</h1><p class="lede">{E(b["excerpt"])}</p>'
               f'<div class="meta"><span class="by"><img src="/brand/favicon.svg?v=6" alt="">SocialShot team</span><i></i>'
               f'<span>{short(b["date"])}</span><i></i><span>{b["read"]} min read</span></div>'
               f'<figure class="cover"><img src="/brand/{b["image"]}.jpg" alt="{E(b.get("alt", ""))}" width="1200" height="675" fetchpriority="high" style="object-position:{b.get("pos", "50% 35%")}"></figure>'
               f'<div class="prose">{body}</div>'
               + (f'<section class="pqs"><h2>Questions</h2><div class="qlist">{faq}</div></section>' if faq else "")
               + '</div><aside class="side" aria-label="About this guide">'
               f'<div class="scard"><h3>Share this guide</h3><div class="shares">{share}</div></div>'
               + (f'<div class="scard"><h3>Related guides</h3><div class="sposts">{"".join(side_post(m) for m in more)}</div></div>' if more else "")
               + '<div class="sstick">'
               + (f'<nav class="scard toc" aria-label="On this page"><h3>On this page</h3><ol>{toc_list(toc)}</ol></nav>' if toc else "")
               + '<div class="scard stry"><b>Clip your next stream</b><p>Clips arrive while you are still live. Free on Windows with your own AI key.</p>'
               f'<a class="btn primary" href="/#get-app">Get the Windows app{ARROW}</a></div></div></aside></div></div></article>'
               + (f'<section class="rel"><div class="wrap"><h2 class="sec">Tools for this</h2><div class="rgrid">{"".join(page_card(t) for t in tools)}</div></div></section>' if tools else "")
               + cta() + POST_JS + tail())
        (OUT / "blog" / f'{b["slug"]}.html').write_text(out, encoding="utf-8")

    first, rest = posts[0], posts[1:]
    bt = "SocialShot Blog: Clipping, Streaming and Short-Form Video Guides"
    bd = "Guides for streamers, clippers and podcasters: how to clip on Twitch and Kick, make podcast clips and grow with Shorts and Reels."
    og = og_card("blog", first["image"], "Guides for clippers and creators", first.get("og_pos", 0.3))
    blog = {"@type": "Blog", "@id": SITE + "/blog#blog", "url": SITE + "/blog", "name": "SocialShot Blog", "description": bd,
            "publisher": {"@id": ORG_ID}, "isPartOf": {"@id": SITE_ID}, "inLanguage": "en",
            "blogPost": [{"@type": "BlogPosting", "@id": f'{SITE}/blog/{b["slug"]}#article', "url": f'{SITE}/blog/{b["slug"]}',
                          "headline": b["h1"][:110], "datePublished": b["date"], "dateModified": b.get("updated", b["date"]),
                          "image": f'{SITE}/brand/og-blog-{b["slug"]}.jpg', "author": {"@id": ORG_ID}} for b in posts]}
    idx = (head(bt, bd, "/blog", og, graph(ORG, WEBSITE, webpage("/blog", bt, bd, og, kind="CollectionPage", mainEntity={"@id": SITE + "/blog#blog"}),
                                           blog, crumbs("/blog", [("Home", "/"), ("Blog", "/blog")])))
           + '<section class="bhead"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><b>Blog</b></nav>'
             '<h1>Guides for clippers and creators</h1>'
             '<p>How to clip streams, podcasts and big moments, and what is working in short-form video right now.</p></div></section>'
           + f'<section class="bindex"><div class="wrap">{post_card(first, big=True)}'
           + f'<div class="bbar"><h2>All guides <span>{len(posts)}</span></h2><div class="tags" role="group" aria-label="Filter by topic">'
           + '<button type="button" class="on" data-tag="">All</button>'
           + "".join(f'<button type="button" data-tag="{E(t)}">{E(t)}</button>' for t in sorted({b["tag"] for b in posts}))
           # the newest post is the big card at the top, so its grid copy only shows while a topic is picked
           + f'</div></div><div class="pgrid" id="all">{post_card(first).replace(chr(34) + "pcard" + chr(34), chr(34) + "pcard dup" + chr(34) + " hidden", 1)}'
           + f'{"".join(post_card(b) for b in rest)}</div></div></section>'
           + cta() + INDEX_JS + tail())
    (OUT / "blog" / "index.html").write_text(idx, encoding="utf-8")
    changelog_page()
    dates(posts)
    print(f"built {len(pages)} pages and {len(posts)} posts into {OUT.relative_to(ROOT)}")
    return pages, posts


if __name__ == "__main__":
    build()
