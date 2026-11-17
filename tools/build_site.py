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

from PIL import Image, ImageDraw, ImageFont

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
                "width": 220, "height": 220, "caption": "SocialShot"},
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
                  "description": "3 free clips on every video. More clips with credits: 1 credit makes 1 more clip, no subscription."},
       "featureList": ["Clips live streams while they are live", "AI picks the best moments", "Word-by-word captions",
                       "Vertical 9:16 clips", "Twitch, Kick and YouTube", "Posts to YouTube Shorts and Instagram Reels",
                       "3 free clips per video"]}


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
    OG.mkdir(parents=True, exist_ok=True)
    W, H, split = 1200, 630, 700
    card = Image.new("RGB", (W, H), (20, 20, 22))
    src = Image.open(WEB / "brand" / f"{photo}.jpg").convert("RGB")
    pw, ph = W - split, H
    scale = max(pw / src.width, ph / src.height)
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    x, y = (src.width - pw) // 2, round((src.height - ph) * pos)
    card.paste(src.crop((x, y, x + pw, y + ph)), (split, 0))
    d = ImageDraw.Draw(card)
    mark = Image.open(WEB / "brand" / "logo-mark.png").convert("RGBA").resize((48, 48), Image.LANCZOS)
    card.paste(mark, (64, 64), mark)
    d.text((124, 88), "SocialShot", font=ImageFont.truetype(str(FONT), 30), fill=(237, 237, 240), anchor="lm")
    size = 60
    while True:  # the largest size at which the headline fits in four lines
        font, lines = ImageFont.truetype(str(FONT), size), [""]
        for w in headline.split():
            t = (lines[-1] + " " + w).strip()
            if d.textlength(t, font=font) <= split - 128 or not lines[-1]:
                lines[-1] = t
            else:
                lines.append(w)
        if len(lines) <= 4 or size <= 36:
            break
        size -= 4
    lh = round(size * 1.14)
    top = 150 + (H - 150 - 110 - lh * len(lines)) // 2
    for i, line in enumerate(lines):
        d.text((64, top + i * lh), line, font=font, fill=(255, 255, 255))
    d.text((64, H - 64), "3 free clips on every video", font=ImageFont.truetype(str(FONT), 24), fill=(150, 150, 160), anchor="ls")
    out = OG / f"og-{name}.jpg"
    card.save(out, quality=86, optimize=True, progressive=True)
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
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg?v=5">
<link rel="preload" href="/brand/ApfelGrotezk-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/ui.css?v=3">
<link rel="stylesheet" href="/assets/site.css?v=13">
<script src="/assets/site.js?v=1" defer></script>
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


def cta(title="Try it on your next stream", text="Paste a link and see what gets picked. The first 3 clips on every video are free."):
    """The closing box on every page: the offer on the left, three finished clips on the right."""
    clips = [("stream-podcast", "0:41", ("best", "advice", "ever")), ("stream-shock", "0:24", ("no", "way", "that worked")),
             ("stream-gamer", "0:18", ("clutch", "win", ""))]
    art = "".join(f'<figure class="cl c{k + 1}"><img src="/brand/{img}.jpg" alt="" loading="lazy"><span class="dur">{dur}</span>'
                  f'<span class="cap">{a} <b>{b}</b> {c}</span></figure>' for k, (img, dur, (a, b, c)) in enumerate(clips))
    return (f'<section class="cta-band"><div class="wrap"><div class="cta-card"><div class="cta-copy"><h2>{E(title)}</h2><p>{E(text)}</p>'
            f'<div class="ctas"><a class="btn lg primary" href="/signup">Start for free{ARROW}</a><a class="btn lg outline" href="/#how">See how it works</a></div>'
            '<ul class="cta-fine"><li>3 free clips on every video</li><li>No card needed</li><li>Nothing to install</li></ul></div>'
            f'<div class="cta-art" aria-hidden="true">{art}</div></div></div></section>')


def home_schema(land):
    """The home page's structured data. Its questions are read from the page itself, so the two never drift apart."""
    og = og_card("home", "stream-gamer", "Turn long streams into short clips, while you are still live")
    title = html.unescape(re.search(r"<title>(.*?)</title>", land).group(1))
    desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', land).group(1))
    box = land[land.index('<div class="qs'):]
    faq = [(q, a) for q, a in re.findall(r"<summary>(.*?)<svg.*?</summary>\s*<p>(.*?)</p>", box[:box.index("</section>")], re.S)]
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
    return (f'<section class="pfaq"><div class="wrap"><div class="fq"><div class="fq-head"><span class="rk">{E(label)}</span>'
            '<h2>Common questions</h2><p>Not sure it fits your stream? Paste one link and see what gets picked. '
            f'The first 3 clips on every video are free.</p><a class="fq-link" href="/signup">Start for free{ARROW}</a></div>'
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


def page_card(p):
    icon = ICONS[ICON_FOR.get(p["slug"], "compare")]
    return (f'<a class="rcard" href="/{p["slug"]}"><span class="ric"><svg class="ti" viewBox="0 0 24 24">{icon}</svg></span>'
            f'<span class="rgo">{ARROW}</span><span class="rk">{E(p["eyebrow"])}</span><b>{E(p["nav"])}</b><small>{E(p["card"])}</small></a>')


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
               + f'<section class="phead tool"><div class="wrap"><span class="eyebrow">{E(p["eyebrow"])}</span><h1>{E(p["h1"])}</h1><p>{E(p["lede"])}</p>'
               f'<div class="ctas"><a class="btn lg primary" href="/signup">Start for free{ARROW}</a><a class="btn lg outline" href="/#how">How it works</a></div>'
               f'<ul class="fine"><li>3 free clips on every video</li><li>No card needed</li><li>Nothing to install</li></ul></div></section>'
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
               f'<div class="meta"><span class="by"><img src="/brand/favicon.svg?v=5" alt="">SocialShot team</span><i></i>'
               f'<span>{short(b["date"])}</span><i></i><span>{b["read"]} min read</span></div>'
               f'<figure class="cover"><img src="/brand/{b["image"]}.jpg" alt="{E(b.get("alt", ""))}" width="1200" height="675" fetchpriority="high" style="object-position:{b.get("pos", "50% 35%")}"></figure>'
               f'<div class="prose">{body}</div>'
               + (f'<section class="pqs"><h2>Questions</h2><div class="qlist">{faq}</div></section>' if faq else "")
               + '</div><aside class="side" aria-label="About this guide">'
               f'<div class="scard"><h3>Share this guide</h3><div class="shares">{share}</div></div>'
               + (f'<div class="scard"><h3>Related guides</h3><div class="sposts">{"".join(side_post(m) for m in more)}</div></div>' if more else "")
               + '<div class="sstick">'
               + (f'<nav class="scard toc" aria-label="On this page"><h3>On this page</h3><ol>{toc_list(toc)}</ol></nav>' if toc else "")
               + '<div class="scard stry"><b>Clip your next stream</b><p>Clips arrive while you are still live. The first 3 on every video are free.</p>'
               f'<a class="btn primary" href="/signup">Start for free{ARROW}</a></div></div></aside></div></div></article>'
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
    dates(posts)
    print(f"built {len(pages)} pages and {len(posts)} posts into {OUT.relative_to(ROOT)}")
    return pages, posts


if __name__ == "__main__":
    build()
