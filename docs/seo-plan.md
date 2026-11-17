# SocialShot SEO plan: keywords, pages and links

Researched 17 November 2026 with Keywords Everywhere (Google monthly searches, US unless marked IN = India).

## Keyword map

| Page | Main keyword | Supporting keywords |
|---|---|---|
| `/` home | ai clip maker (1,900 · IN 590) | clip maker (1,000), ai clip generator (720), ai clipping tool (590), youtube shorts maker (1,300 · IN 1,900), long video to short video ai (IN 1,600), turn long videos into shorts (70) |
| `/twitch-clip-maker` | twitch clip maker (140) | streamer clips (260), stream clipper (210), auto clip twitch (50), automatic clip maker twitch (50), twitch clip creator (50) |
| `/kick-clip-maker` | kick clips (590) | how to clip on kick (90), kick clip maker (20) |
| `/youtube-shorts-maker` | youtube shorts maker (1,300 · IN 1,900) | ai shorts generator (390 · IN 480), make shorts from youtube videos (70), long video to short video ai (IN 1,600) |
| `/podcast-clip-maker` | podcast clips (320 · IN 260) | podcast clip maker (90, high CPC), how to make podcast clips |
| `/auto-captions` | auto captions (2,400 · IN 14,800) | auto caption generator (1,000), ai auto caption (90), word by word captions |
| `/live-stream-clipper` | stream clipper (210) | clip farming (5,400), live stream highlights |
| `/opus-clip-alternative` | opus clip alternative (390 · IN 390) | opus clip free alternative (50), best ai clipping tool (140) |

## Comparison pages (footer "Compare" column)

Direct "vs" searches are tiny (10–40 a month); the value is in brand and pricing searches from people choosing a tool:
opus clip (90,500), opus clip pricing (880), opus clip free (320), vizard ai (6,600), streamladder (6,600),
eklipse (4,400), free ai clip maker (210).

| Page | Targets |
|---|---|
| `/socialshot-vs-opus-clip` | opus clip vs, opus clip pricing, opus clip free |
| `/socialshot-vs-vizard` | vizard alternative, vizard pricing, vizard ai |
| `/socialshot-vs-streamladder` | streamladder alternative, streamladder pricing |
| `/socialshot-vs-eklipse` | eklipse alternative, eklipse pricing, is eklipse free |

Competitor facts were checked on 17 November 2026 from public reviews and are dated and sourced on each page.
Sources disagreed on Vizard, StreamLadder and Eklipse prices, so those pages only state what sources agree on and
send readers to the competitor's own pricing page. Recheck every few months.

## Blog (informational, links up to the pages above)

| Post | Main keyword | Links to |
|---|---|---|
| How to clip on Twitch | how to clip on twitch (1,300) | /twitch-clip-maker, /live-stream-clipper |
| How to clip on Kick | how to clip on kick (90), kick clips (590) | /kick-clip-maker |
| GTA 6 launch week: how to clip it | gta 6 clips (260 · IN 110), gta 6 (1.8M) | /twitch-clip-maker, /live-stream-clipper |
| What is clip farming? | clip farming (5,400), how to make money clipping (260), clipping jobs (110) | /live-stream-clipper, /opus-clip-alternative |
| How to make podcast clips people watch | podcast clips (320) | /podcast-clip-maker, /auto-captions |
| Cricket Shorts and Reels without copyright strikes | cricket shorts (IN 4,400), cricket reels (IN 1,300) | /youtube-shorts-maker, /auto-captions |
| Clipping campaigns: how they work and what they pay | clipping campaigns (720 · IN 880), whop clipping (2,900) | /live-stream-clipper, /twitch-clip-maker |
| YouTube Shorts monetization and the 2027 changes | youtube shorts monetization (2,400 · IN 3,600) | /youtube-shorts-maker, /podcast-clip-maker |
| TikTok Creator Rewards Program | tiktok creator rewards program (74,000) | /live-stream-clipper, /auto-captions |
| How to clip YouTube videos (after Clips was removed) | how to clip youtube videos (3,600) | /youtube-shorts-maker, /live-stream-clipper |
| Best time to post YouTube Shorts | best time to post youtube shorts (1,300 · IN 480) | /youtube-shorts-maker, /auto-captions |

Added 17 November 2026. Time-sensitive facts (YouTube's February 2027 Partner Program change, the Clips removal,
TikTok's thresholds) need a recheck before February 2027.

## Linking rules

- Every page links to the home page, two or three sibling pages and one or two blog posts.
- Every post links to the page for its main keyword in the first third, and to two related posts at the end.
- The home page links to every page (a "Made for every kind of clip" section) and the three newest posts.
- Footer: a "Use cases" column with every page, and Blog in the Product column, on every public page.

## How it is built

Content lives in `content/pages/*.html` and `content/blog/*.html` (a JSON header, then the body).
`python tools/build_site.py` wraps them in the site's header and footer, adds titles, descriptions, canonical links,
Open Graph and JSON-LD (Breadcrumb, FAQ, BlogPosting), and writes `web/site/`. The server serves `web/site/` at
`/<page>`, `/blog` and `/blog/<post>` and lists every file in `/sitemap.xml`.

Facts in posts are checked on the day of writing and linked to sources; dates that may change (GTA 6, cricket
fixtures) say so and point to the official source.
