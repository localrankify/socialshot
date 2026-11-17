/* The clip editor: a full-screen editor for one clip, laid out like a video editor.
   Left: the transcript (click any word to jump there) and the subtitles, one line per row, to fix.
   Middle: a live preview of the original footage with the captions and the hook drawn on top, so every change
   shows at once. Right: the tools (subtitle style, the hook text, trim, post).
   Bottom: a timeline with zoom and speed, and tracks for the hook, the captions and the video.
   "Save and render" sends the changes to the server, which makes the clip again with them. */
(() => {
// the frame the clip is drawn on, which follows the clip's shape (render.ASPECTS)
const ASPECTS = {"9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080]};
let OUT_W = 1080, OUT_H = 1920;
const setFrame = () => { [OUT_W, OUT_H] = ASPECTS[E.look?.aspect] || ASPECTS["9:16"]; };
const E = {};            // everything about the clip being edited
/* A button that shows its own progress (Render, Export): the label rolls to the new words letter by letter, and a
   soft glow fills the button from the left. How long the work takes isn't known exactly, so the glow eases towards 90%
   over the expected time and only finishes when the work does. */
function rollLabel(btn, text) {
  const l = btn?.querySelector(".pf-l"); if (!l || l.dataset.t === text) return;
  l.dataset.t = text; l.setAttribute("aria-label", text);
  l.innerHTML = [...text].map((ch, i) => `<b style="animation-delay:${i * 22}ms">${ch === " " ? "&nbsp;" : esc(ch)}</b>`).join("");
}
function pfStart(btn, text, seconds) {
  if (btn._pf) return;
  const t0 = performance.now();
  btn.classList.add("going"); rollLabel(btn, text);
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    btn.style.setProperty("--p", (90 * (1 - Math.exp(-t / Math.max(1, seconds / 2)))).toFixed(1) + "%");
  };
  tick(); btn._pf = setInterval(tick, 120);
}
function pfStop(btn, doneText, restText) {
  clearInterval(btn._pf); btn._pf = 0;
  btn.style.setProperty("--p", "100%"); rollLabel(btn, doneText);
  setTimeout(() => { btn.classList.remove("going"); btn.style.setProperty("--p", "0%"); rollLabel(btn, restText); }, 1300);
}
// full screen: the play bar shows on any mouse move or tap and fades after a moment of stillness while playing;
// a click on the picture plays or pauses, like any video player
let fsT = 0;
// the preview full screen: the browser's own, or (where the browser won't allow it, like an app's built-in pane) the
// preview filling the window, with Esc or the same button to leave
const fsEl = () => document.fullscreenElement || document.querySelector(".ed.fsx #edPhone");
function fsWindow(on) {
  const root = document.querySelector("#clipdlg .ed"); if (!root) return;
  root.classList.toggle("fsx", on); $("#edPhone")?.classList.remove("awake");
  dispatchEvent(new Event("resize")); if (on) fsAwake();
}
function fsAwake() {
  const ph = fsEl(); if (!ph || ph.id !== "edPhone") return;
  ph.classList.add("awake"); clearTimeout(fsT);
  fsT = setTimeout(() => { const v = document.querySelector("#edVid"); if (v && !v.paused) ph.classList.remove("awake"); }, 2200);
}
document.addEventListener("pointermove", fsAwake, true);
document.addEventListener("fullscreenchange", () => { $("#edPhone")?.classList.remove("awake"); fsAwake(); });
document.addEventListener("click", e => {
  const ph = fsEl();
  if (!ph || ph.id !== "edPhone" || e.target.closest(".ed-fsbar, button, a, input")) return;
  e.stopPropagation(); ph.querySelector('.ed-fsbar [data-ed="play"]')?.click(); fsAwake();
}, true);
// once a panel scrolls, its pinned tabs get a thin line under them so the content reads as passing beneath
document.addEventListener("scroll", e => { const p = e.target; if (p.classList?.contains("ed-panel")) p.querySelector(".ed-stick")?.classList.toggle("stuck", p.scrollTop > 4); }, true);
let raf = 0;

const $e = s => $("#clipdlg").querySelector(s);
const $$e = s => [...$("#clipdlg").querySelectorAll(s)];
const clipNow = () => jobOf(E.jid)?.clips.find(c => c.id === E.cid);
const clone = x => JSON.parse(JSON.stringify(x));
const ts = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };
const FONTS = () => S.status.fonts || {};
const PRESETS = () => S.status.presets || {};
const SWATCHES = ["#FFFFFF", "#FFE500", "#FFF000", "#22E06B", "#7CC8FF", "#8B7CF6", "#FF4FD8", "#FF3C3C", "#FF8B33", "#141416"];
const HOOK_DEFAULT = {hook_font: "Mazzard H", hook_size: 88, hook_y: null, hook_dur: 3,    // the heading at the top, as the server draws it: 3 s by default (0 s = the whole clip)
  hook_box: "#FFFFFF", hook_ink: "#14100E", hook_op: 100, hook_round: 20, hook_sp: 0,   // its box and text colours, how solid the box is, corners, letter gaps
  sp: 0, wgap: 0, cap_box: "#000000", cap_op: 0, cap_round: 18,             // the captions' letter and word gaps, and a box behind each line (0 = none)
  effect: "none", fade_in: "none", fade_out: "none",                         // and the effects: a colour look, how it starts and ends
  volume: 100,                                                               // and the sound, in percent of its normal level
  brand_on: false, brand_logo: true, brand_text: "", brand_pos: "tr",       // and the person's brand: logo and name, where,
  brand_anim: "float", brand_size: 84, brand_op: 90,                         // how it moves, how big, how solid
  aspect: "9:16"};                                                           // and the clip's shape
const BRAND_KEYS = ["brand_on", "brand_logo", "brand_text", "brand_pos", "brand_anim", "brand_size", "brand_op",
  "brand_kind", "brand_head", "brand_icon", "brand_handle", "brand_tag", "brand_tag_on", "brand_font", "brand_color"];
// how the brand moves; the same motions as the render (render.brand_overlay)
const BRAND_ANIMS = [["none", "Still"], ["float", "Float"], ["slide", "Slide in"], ["drift", "Drift"], ["fade", "Fade in"]];
const BRAND_POSES = [["tl", "Top left"], ["tc", "Top centre"], ["tr", "Top right"], ["bl", "Bottom left"], ["bc", "Bottom centre"], ["br", "Bottom right"]];
const RATES = [1, 1.25, 1.5, 2, 0.5];
// ready-made hook looks: box colour, text colour, how solid the box is (0 = text only, with an outline)
const HOOK_STYLES = [["white", "White card", {hook_box: "#FFFFFF", hook_ink: "#14100E", hook_op: 100}],
  ["black", "Black card", {hook_box: "#141416", hook_ink: "#FFFFFF", hook_op: 100}],
  ["glass", "Dark glass", {hook_box: "#000000", hook_ink: "#FFFFFF", hook_op: 55}],
  ["frost", "Light glass", {hook_box: "#FFFFFF", hook_ink: "#14100E", hook_op: 70}],
  ["accent", "Purple", {hook_box: "#8B5CF6", hook_ink: "#FFFFFF", hook_op: 100}],
  ["none", "Text only", {hook_box: "#000000", hook_ink: "#FFFFFF", hook_op: 0}]];
// a box behind the caption line
const CAP_BGS = [["none", "None", {cap_op: 0}], ["dark", "Dark", {cap_box: "#000000", cap_op: 55}],
  ["black", "Black", {cap_box: "#000000", cap_op: 100}], ["white", "White", {cap_box: "#FFFFFF", cap_op: 100}]];
const rgba = (hex, op) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${op / 100})`; };
const PCT_KEYS = new Set(["y", "hook_y", "hook_op", "cap_op"]);
const COLOUR_KEYS = /^(base|active|hook_box|hook_ink|cap_box)$/;
const svg = d => `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// the tool rail's icons come from Reicon (RI in index.html); the old line drawing stays only as a fallback
const ri = (k, d) => typeof RI !== "undefined" && RI[k] ? `<svg class="ti ri" viewBox="0 0 24 24" fill="none" aria-hidden="true">${RI[k]}</svg>` : svg(d);
const TEXT_IC = ri("ed_text", '<path d="M6 5h12M12 5v14M9 19h6"/>');
const FX_IC = ri("ed_fx", '<path d="M15 4l1.5 3.5L20 9l-3.5 1.5L15 14l-1.5-3.5L10 9l3.5-1.5zM6 13l1 2.5L9.5 16.5L7 17.5L6 20l-1-2.5L2.5 16.5L5 15.5z"/>');
// the colour looks the server can render (render.EFFECTS), and how each one looks in the browser preview
const EFFECTS = [["none", "None", ""], ["vivid", "Vivid", "saturate(1.35) contrast(1.08)"], ["bright", "Bright", "brightness(1.08) contrast(1.05) saturate(1.1)"],
  ["warm", "Warm", "sepia(.18) saturate(1.15)"], ["cool", "Cool", "hue-rotate(-10deg) saturate(.95) brightness(1.03)"],
  ["cinematic", "Cinematic", "contrast(1.12) saturate(.85) brightness(.97)"], ["vintage", "Vintage", "sepia(.4) contrast(.92) saturate(.85)"],
  ["bw", "Black & white", "grayscale(1) contrast(1.1)"]];
const fxCss = k => (EFFECTS.find(x => x[0] === k) || EFFECTS[0])[2];
// a field slider: the label inside on the left, the value on the right, the filled part one shade lighter
const pctOf = (v, lo, hi) => `${Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)).toFixed(1)}%`;
const slider = (label, key, lo, hi, step, v, shown, id = "") =>
  `<label class="ed-sl" style="--p:${pctOf(v, lo, hi)}"><input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}" data-look="${key}" aria-label="${esc(label)}">` +
  `<span class="ed-sl-l">${esc(label)}</span><output${id ? ` id="${id}"` : ""}>${esc(String(shown))}</output></label>`;
const FILLER = /^(um+|uh+|umm+|hmm+|er+|ah+|uhh+)[,.!?]*$/i;      // filler words, tinted in the transcript
// a hook in normal case, the same rule as the server's (brain.sentence_case): only all-capitals text changes
const KEEP_CAPS = new Set("GTA AI PS5 PS4 PC FPS BGMI PUBG CEO USA UK OMG LOL IRL NPC MVP GG VR TV DM IPL WWE UFC NBA NFL FIFA OG 1V1 1V4 XP".split(" "));
const NAMES = {youtube: "YouTube", tiktok: "TikTok", twitch: "Twitch", instagram: "Instagram", minecraft: "Minecraft", fortnite: "Fortnite",
  valorant: "Valorant", iphone: "iPhone", xbox: "Xbox", playstation: "PlayStation"};
function sentenceCase(text) {
  if (!text) return text;
  if (/\p{Ll}/u.test(text)) return text.replace(/\p{L}/u, c => c.toUpperCase());     // has small letters: just a capital first letter
  let start = true;
  return text.split(/(\s+)/).map(tok => {
    if (!tok.trim()) return tok;
    const core = tok.replace(/\W/g, "");
    let w;
    if (KEEP_CAPS.has(core.toUpperCase()) || /\d/.test(core)) w = tok;
    else if (NAMES[core.toLowerCase()]) w = tok.toLowerCase().replace(core.toLowerCase(), NAMES[core.toLowerCase()]);
    else { w = tok.toLowerCase().replace(/^i(?=$|'|\W)/, "I"); if (start) w = w.replace(/[A-Za-z]/, c => c.toUpperCase()); }
    start = /[.!?]$/.test(tok);
    return w;
  }).join("");
}
const CAP_SHADOW = 4;          // the renderer's caption shadow (render.CAP_SHADOW), in the 1080-wide frame
const FADE_S = 0.5;
// what belongs to one clip, not to a look: where captions and hook sit, the video's shape, the split boxes (drawn
// for that clip's own video) and its volume. A brand kit look never carries these, and applying one never changes them.
const CLIP_OWN = ["x", "y", "hook_x", "hook_y", "aspect", "split", "frame", "card", "volume", "music", "bg", "pad", "vradius", "outro", "overlays", "zooms"];
const clipOwn = L => Object.fromEntries(CLIP_OWN.filter(k => k in L).map(k => [k, clone(L[k])]));
const styleOnly = L => Object.fromEntries(Object.entries(L).filter(([k]) => !CLIP_OWN.includes(k)));
const keepOwn = L => ({...hookOf(L), effect: L.effect || "none", fade_in: L.fade_in || "none", fade_out: L.fade_out || "none",
  volume: L.volume ?? 100, aspect: L.aspect || "9:16",
  ...Object.fromEntries(["split", "frame", "card", "music", "bg", "pad", "vradius", "outro", "overlays", "zooms"].filter(k => L[k] != null).map(k => [k, clone(L[k])])),
  ...Object.fromEntries(BRAND_KEYS.map(k => [k, L[k] ?? HOOK_DEFAULT[k]]))});   // what a new caption style must not undo

/* ---------- the sound: the preview plays through a gain (so it can go above 100%) and two level meters.
   Set up on the first play, as browsers only allow sound after a click. */
let AC = null;
function audioFor(v) {
  if (!v || v._a !== undefined) return v && v._a;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const src = AC.createMediaElementSource(v), g = AC.createGain(), sp = AC.createChannelSplitter(2);
    const aL = AC.createAnalyser(), aR = AC.createAnalyser();
    aL.fftSize = aR.fftSize = 1024;
    src.connect(g); g.connect(AC.destination); g.connect(sp); sp.connect(aL, 0); sp.connect(aR, 1);
    v._a = {g, aL, aR, buf: new Float32Array(1024)};
  } catch { v._a = null; }
  return v._a;
}
// the volume from any of its controls (the toolbar under the preview, the Audio panel): all of them follow
function setVolume(v, from) {
  E.look.volume = Math.max(0, Math.min(200, v)); E.lookTouched = true;
  $$e('input[data-look="volume"]').forEach(x => {
    if (x !== from) x.value = E.look.volume;
    const sl = x.closest(".ed-sl");
    if (sl) { sl.style.setProperty("--p", pctOf(E.look.volume, 0, 200)); const o = sl.querySelector("output"); if (o) o.textContent = E.look.volume + "%"; }
    else x.style.setProperty("--p", E.look.volume / 2 + "%");
  });
  const o = $e("#edVolOut"); if (o) o.textContent = E.look.volume + "%";
  const vb = $e(".ed-volbtn"); if (vb) vb.innerHTML = SOUND(!E.muted && E.look.volume > 0);
  applyVolume(); after("");
}
function applyVolume() {
  const v = vid(); if (!v) return;
  const vol = (E.look.volume ?? 100) / 100, a = v._a;
  if (a) { v.volume = 1; a.g.gain.value = vol; } else v.volume = Math.min(1, vol);
}
const peak = (an, buf) => { an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) { const x = Math.abs(buf[i]); if (x > p) p = x; } return p; };
const meterPct = p => Math.max(0, Math.min(1, (20 * Math.log10(p || 1e-6) + 60) / 60));     // -60 dB to 0 dB
function paintMeter(v) {
  const L = $e("#edMeterL"), R = $e("#edMeterR"); if (!L || !R) return;
  let l = 0, r = 0;
  if (v && !v.paused && v._a) {
    l = meterPct(peak(v._a.aL, v._a.buf)); r = meterPct(peak(v._a.aR, v._a.buf));
    if (!r && l) r = l;                      // a mono clip: both meters show its one channel
  }
  E.mL = Math.max(l, (E.mL || 0) - 0.018); E.mR = Math.max(r, (E.mR || 0) - 0.018);     // fall back slowly, like a real meter
  L.style.setProperty("--l", (E.mL * 100).toFixed(1) + "%"); R.style.setProperty("--l", (E.mR * 100).toFixed(1) + "%");
}

/* ---------- the same layout and caption grouping the server uses, so the preview matches the clip */
// the split layout: the stream part and the face cam part as [left, top, width, height] fractions (render.SPLIT_DEFAULT)
const SPLIT_DEFAULT = {game: [0, 0, 1, 1], cam: [0.68, 0.58, 0.30, 0.40], cam_at: "bottom", share: 50};
// the split layout's two parts: as placed here, else where the face cam was found in this clip, else the usual box
const splitOf = () => {
  return avoidCam(rawSplit());      // a stream part still the whole picture skips the face cam
};
// the split as saved (before that automatic crop): changes are written on top of this, so the stream part only
// counts as set by hand once it is actually moved
const rawSplit = () => ({...SPLIT_DEFAULT, ...(E.look?.split || clipNow()?.auto_split || {})});
/* ---------- the post card layout: the clip inside a social post. The same numbers as render.card_geometry, so the
   preview and the saved clip put the picture, name, words and video in the same places. */
const CARD_THEMES = {light: {bg: "#FFFFFF", ink: "#0F1419", sub: "#536471", acc: "#1D9BF0", kind: "x", label: "X light"},
  dark: {bg: "#000000", ink: "#E7E9EA", sub: "#71767B", acc: "#1D9BF0", kind: "x", label: "X dark"},
  linkedin: {bg: "#FFFFFF", ink: "#191919", sub: "#666666", acc: "#0A66C2", kind: "linkedin", label: "LinkedIn"},
  threads: {bg: "#FFFFFF", ink: "#000000", sub: "#999999", acc: "#0095F6", kind: "threads", label: "Threads"},
  threads_dark: {bg: "#101010", ink: "#F3F5F7", sub: "#777777", acc: "#0095F6", kind: "threads", label: "Threads dark"}};
// the bold line and the grey one, as render.card_account writes them
function cardAccount(c) {
  const th = CARD_THEMES[c.theme] || CARD_THEMES.light, name = c.name || cardName() || "SocialShot";
  const handle = c.handle || name.toLowerCase().replace(/[^a-z0-9_]/g, "") || "socialshot";
  if (th.kind === "linkedin") return [name, `${c.handle || "Creator"} · 1h`];
  if (th.kind === "threads") return [handle, "1h"];
  return [name, "@" + handle];
}
const CARD_BLUE = "#1D9BF0";
const cardName = () => { const j = jobOf(E.jid) || {}; return (j.uploader || j.creator_name || "").trim().slice(0, 40); };
const cardOf = () => ({theme: "light", name: "", handle: "", text: "", verified: true, radius: 28, avatar: "logo",
  back: "gradient", g1: "#0F172A", g2: "#334155", grain: true, scale: 100, dx: 0, dy: 0, pad: 40, ...(E.look?.card || {})});
// colour pairs for the backdrop behind a floating post card (top-left to bottom-right)
const CARD_BACKS = [["Slate", "#0F172A", "#334155"], ["Ember", "#2A120C", "#9A3412"], ["Forest", "#08251A", "#166534"],
  ["Ocean", "#082334", "#0E7490"], ["Sand", "#E9DFCF", "#B8A27F"], ["Mono", "#111114", "#3F3F46"]];
// fine film grain, made once in the browser, laid over the backdrop like render._card_backdrop's noise
let grainUrl = "";
function grain() {
  if (grainUrl) return grainUrl;
  try {
    const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d"), im = x.createImageData(96, 96);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 22; }
    x.putImageData(im, 0, 0); grainUrl = c.toDataURL();
  } catch {}
  return grainUrl;
}
const cardText = c => (c.text || "").trim() || (E.hook || "").trim();
function cardLines(text, width, size) {
  const per = Math.max(8, Math.floor(width / (size * 0.5)));
  let lines = [], cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > per) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines = lines.slice(0, 4); lines[3] = lines[3].slice(0, Math.max(1, per - 1)).trimEnd() + "…"; }
  return lines;
}
function cardGeo(Wd, Hd, fw, fh, text, floating, scale = 100, dx = 0, dy = 0, pad = 40) {
  const side = Math.min(Wd, Hd * 9 / 16) * scale / 100, u = side / 1080, m = floating ? (40 + pad) * u : 64 * u, cw = side - 2 * m;
  let x0 = (Wd - cw) / 2;
  const A = 112 * u, ts = 46 * u, lh = 62 * u, lines = cardLines(text, cw, ts);
  const vw = Math.floor(cw / 2) * 2, vh = Math.min(Math.floor(vw * fh / Math.max(1, fw) / 2) * 2, Math.floor(Hd * 0.52 / 2) * 2);
  const head = A + 36 * u + lines.length * lh, total = head + 40 * u + vh + 260 * u;
  let y0 = Math.max(48 * u, (Hd - total) / 2);
  x0 += Wd * dx / 100; y0 += Hd * dy / 100;                // moved in the editor
  const vy = Math.floor((y0 + head + 40 * u) / 2) * 2, vx = Math.floor(x0 / 2) * 2;
  const g = {u, x0, y0, cw, A, ts, lh, lines, vx, vy, vw, vh, cap: Math.round(vy + vh + 120 * u)};
  if (floating) { const p = pad * u; g.box = [Math.round(x0 - p), Math.round(y0 - p), Math.round(x0 + cw + p), Math.round(g.cap + 110 * u)]; }
  return g;
}
// the part of the picture shown (set in the Frame view), for every layout but split; null is the whole picture
const frameRegion = () => (E.layout !== "split" && Array.isArray(E.look?.frame)) ? E.look.frame : null;
// the Frame view's box when nothing was set yet: the whole picture, or for Fill screen the part that fills the frame
function frameDefault() {
  if (E.layout !== "crop" || !E.sw || !E.sh) return [0, 0, 1, 1];
  let w = Math.min(1, E.sh * OUT_W / OUT_H / E.sw), h = w * E.sw * OUT_H / (OUT_W * E.sh);
  if (h > 1) { h = 1; w = E.sh * OUT_W / OUT_H / E.sw; }
  return [(1 - w) / 2, (1 - h) / 2, w, h].map(n => Math.round(n * 1e4) / 1e4);
}
// same as render.avoid_cam: with a found face cam, the stream part is cropped so the face cam overlay isn't in it too
function avoidCam(sp) {
  const g = sp.game, c = sp.cam, sw = E.sw, sh = E.sh;
  if (!sw || !sh || g.join() !== "0,0,1,1") return sp;
  const gh = Math.round(OUT_H * sp.share / 100 / 2) * 2, w = sh * OUT_W / Math.max(1, gh);
  if (w >= sw) return sp;
  const cl = c[0] * sw, cr = (c[0] + c[2]) * sw;
  let x0 = (sw - w) / 2;
  x0 = (cl + cr) / 2 > sw / 2 ? Math.min(x0, cl - w) : Math.max(x0, cr);
  if (x0 < 0 || x0 + w > sw) return sp;
  return {...sp, game: [+(x0 / sw).toFixed(4), 0, +(w / sw).toFixed(4), 1]};
}
async function findFacecam() {
  const c = clipNow(); if (!c || c.auto_split !== undefined) return;
  try {
    const r = await send(`/api/jobs/${E.jid}/clips/${E.cid}/facecam`);
    c.auto_split = r.split || null;
    if (r.split && !E.look.split) { drawStage(); after("p"); toast("Found the face cam.", "ok"); }
  } catch {}
}
function geo(layout, sw, sh) {
  setFrame();
  const W = OUT_W, H = OUT_H, r = v => Math.round(H * v / 1920);
  if (layout === "split") {             // same as render.geometry: the hook just above the seam, captions on it
    const sp = splitOf(), gh = Math.round(H * sp.share / 100 / 2) * 2, ch = H - gh;
    const seam = sp.cam_at === "bottom" ? gh : ch;
    return {layout, fg: gh, ch, hook: seam - Math.round(H * 0.045), cap: seam};
  }
  const fr = frameRegion();
  if (fr) { sw *= fr[2]; sh *= fr[3]; }          // only the chosen part of the picture is shown
  if (layout === "card") { const cc = cardOf(), cg = cardGeo(W, H, sw || 16, sh || 9, cardText(cc), cc.back !== "none", cc.scale, cc.dx, cc.dy, cc.pad); return {layout, fg: cg.vh, hook: cg.vy, cap: cg.cap, card: cg}; }
  if (sh * W >= sw * H && layout !== "crop") layout = "crop";
  const iw = W - 2 * padPx();                     // room left and right of the video (Blurred fill and Zoomed)
  const fg = layout === "blur" ? Math.min(H, Math.round(iw * sh / sw / 2) * 2) : layout === "zoom" ? Math.min(H, Math.round((W < H ? H * 1000 / 1920 : H) * iw / W / 2) * 2) : H;
  const top = (H - fg) / 2;
  if (layout === "crop") return {layout, fg, hook: r(300), cap: r(1380)};
  return {layout, fg, hook: Math.max(r(230), top - r(190)), cap: Math.min(r(1640), top + fg + r(180))};
}
function groups(words, per) {
  const out = []; let cur = [];
  words.forEach((w, i) => {
    const last = cur.length ? words[cur[cur.length - 1]] : null;
    if (last && (cur.length >= per || cur.reduce((a, j) => a + words[j].w.length, 0) + w.w.length > 16
        || w.s - last.e > 0.45 || /[.?!]$/.test(last.w))) { out.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
}
const inClip = () => E.words.map((w, i) => [w, i]).filter(([w]) => w.s >= E.start - 0.05 && w.s < E.end);
// Speech cleanup: stretches taken out of the clip ([[from, to], ...] in seconds of the video)
const inCut = t => (E.cuts || []).some(([a, b]) => t >= a - 0.01 && t < b);
const wordCut = w => inCut((w.s + w.e) / 2);
const cutLen = () => (E.cuts || []).reduce((n, [a, b]) => n + Math.max(0, Math.min(b, E.end) - Math.max(a, E.start)), 0);
const keptLen = () => Math.max(0, E.end - E.start - cutLen());
function mergeCuts(list) {
  const out = [];
  list.map(c => [+c[0], +c[1]]).filter(([a, b]) => b - a >= 0.05).sort((x, y) => x[0] - y[0]).forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  });
  return out.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
}
// what one click of Speech cleanup would take out: filler words, and pauses longer than the chosen length
function findCuts() {
  const ws = inClip().map(([w]) => w), cl = E.cl, fill = [], pause = [];
  if (cl.fill) ws.forEach(w => { if (FILLER.test(w.w)) fill.push([w.s, w.e]); });
  if (cl.pause) for (let i = 1; i < ws.length; i++) {
    const g = ws[i].s - ws[i - 1].e;
    if (g >= cl.min) pause.push([ws[i - 1].e + 0.12, ws[i].s - 0.12]);      // a short breath stays on each side
  }
  return {fill, pause, all: mergeCuts([...fill, ...pause])};
}
// caption lines inside the clip: [[word index, ...], ...]. Worked out once and kept until the words, the trim or
// the words-per-line change, because the preview asks for them on every frame while it plays.
function lines() {
  const key = `${E.wv || 0}|${E.words.length}|${E.start}|${E.end}|${E.look.per}|${JSON.stringify(E.cuts || [])}`;
  if (E.linesKey === key) return E.linesMemo;
  const idx = inClip().filter(([w]) => !wordCut(w)).map(([, i]) => i);          // a word that was cut is not a caption
  const sub = idx.map(i => E.words[i]);
  E.linesMemo = groups(sub, E.look.per).map(g => g.map(k => idx[k]));
  E.linesKey = key;
  return E.linesMemo;
}
const wordsChanged = () => { E.wv = (E.wv || 0) + 1; };
const hookOf = L => ({hook_font: L.hook_font || "Mazzard H", hook_size: L.hook_size || 88, hook_y: L.hook_y ?? null, hook_dur: L.hook_dur == null ? 3 : +L.hook_dur || 0,
  hook_box: L.hook_box || "#FFFFFF", hook_ink: L.hook_ink || "#14100E", hook_op: L.hook_op ?? 100, hook_round: L.hook_round ?? 20, hook_sp: L.hook_sp || 0});
// a row of colour swatches plus a picker, for any colour in the look
const swatches = (k, label, cur) => `<div class="ed-f">${label}<div class="ed-sw">
  ${SWATCHES.map(h => `<button data-ed="colour" data-k="${k}" data-v="${h}" style="background:${h}" aria-pressed="${cur === h}" aria-label="${h}"></button>`).join("")}
  <label class="ed-pick" style="background:${cur}"><input type="color" value="${cur.toLowerCase()}" data-look="${k}" aria-label="Pick a ${label.toLowerCase()}"></label></div></div>`;
const hookEnd = () => { const d = hookOf(E.look).hook_dur; return d > 0 ? Math.min(E.end, E.start + d) : E.end; };   // when the hook leaves the screen
function lookFromStyle(style) {
  const p = PRESETS()[style] || PRESETS().studio || PRESETS().bounce;
  const {label, ...look} = p;
  return {...HOOK_DEFAULT, ...look, y: null, hook: true};      // a style's own box and spacing win over the defaults
}
// how big a font's letters come out per unit of caption size, as the renderer measures it (server: render.font_em)
let hookCanvas;
const hookMeasure = () => (hookCanvas ||= document.createElement("canvas").getContext("2d"));
const emOf = key => (FONTS()[key] || {}).em || 0.7;
// a font as the preview draws it; a picked weight loads that weight of the Google font the first time it's used
// (a bundled font has one weight: Semibold and up show bold, as the video does)
const webWeights = new Set();
const fontCss = (key, w) => {
  const f = FONTS()[key] || {google: "Poppins", weight: 800};
  if (!w) return {family: `'${f.google}'`, weight: f.weight};
  if (f.local) return {family: `'${f.google}'`, weight: w >= 600 ? 700 : f.weight};
  const tag = f.google + w;
  if (!webWeights.has(tag)) {
    webWeights.add(tag);
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${f.google.replace(/ /g, "+")}:wght@${w}&display=swap`;
    l.onload = () => { E.lastKey = ""; paintOverlay(); };        // redraw once the new weight has arrived
    document.head.append(l);
  }
  return {family: `'${f.google}'`, weight: w};
};
// the weight and style buttons, for the captions (prefix "") or the hook (prefix "hook_")
const WEIGHT_NAMES = [[300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Black"]];
// the brand kit as saved: the looks, and which one new clips start with (kept only while that look exists)
// saving the look to the brand kit: its own bar pinned to the bottom of the panel, apart from the settings.
// One button; pressing it opens the name field in the same bar.
function saveLook() {
  const n = (E.brand || []).length;
  if (!E.saveOpen) return `<div class="ed-savebar"><button class="ed-savego" data-ed="saveopen">
      <span class="ed-saveic">${svg('<path d="M6 3h12v18l-6-4-6 4z"/>')}</span><span class="ed-savet"><b>Save as a brand look</b><small>${n ? `${n} saved · use them on any clip` : "Use this caption and hook style on any clip"}</small></span>
      <span class="ed-savearr">${ic("plus")}</span></button></div>`;
  return `<div class="ed-savebar open"><div class="ed-savein"><input id="edBrandName" placeholder="Name this look, e.g. Podcast" maxlength="40" aria-label="Name this look">
      <button class="ed-btn sm primary" data-ed="brandsave">Save</button><button class="ed-qx" data-ed="saveclose" aria-label="Cancel" title="Cancel">${ic("x")}</button></div>
    <small class="ed-savenote">Keeps the captions and the hook exactly as they look now.</small></div>`;
}
function brandBody(styles) {
  const out = {styles};
  if (E.brandDef === "" || styles.some(x => x.name === E.brandDef)) out.default = E.brandDef;
  return out;
}
function brandDefRow() {
  if (!E.brand.length) return "";
  const cur = E.brandDef === "" ? "" : (E.brand.find(x => x.name === E.brandDef) || E.brand[0]).name;
  return `<div class="ed-f">New clips start with<div class="ed-seg ed-bdef">${E.brand.slice(0, 3).map(x => `<button data-ed="branddef" data-v="${esc(x.name)}" aria-pressed="${cur === x.name}">${esc(x.name)}</button>`).join("")}
    <button data-ed="branddef" data-v="" aria-pressed="${cur === ""}">Own style</button></div>
    ${E.brand.length > 3 && !E.brand.slice(0, 3).some(x => x.name === cur) && cur ? `<small class="ed-help">Now: ${esc(cur)}</small>` : ""}</div>`;
}
function typeCtl(L, fontKey, pre) {
  const f = FONTS()[fontKey] || {}, own = f.weight || 400, cur = L[pre + "weight"] || own;
  const list = f.local ? [[own, "Regular"], [700, "Bold"]] : WEIGHT_NAMES;      // a bundled font comes in one weight
  // one compact row: the weights as "Aa" drawn in each weight (the name beside the label), then italic and underline
  const on = v => f.local ? (v === 700) === (cur >= 600) : cur === v;
  const name = (list.find(([v]) => on(v)) || list[0])[1], fc = fontCss(fontKey, 400);
  return `<div class="ed-f ed-typerow"><span class="ed-fl">Weight and style <em>${name}${L[pre + "italic"] ? " · italic" : ""}${L[pre + "underline"] ? " · underline" : ""}</em></span>
    <div class="ed-typectl"><div class="ed-wt2" role="group" aria-label="Weight">${list.map(([v, l]) => `<button class="ed-tip" data-ed="weight" data-k="${pre}weight" data-v="${v}" aria-pressed="${on(v)}" aria-label="${l}" data-tip="${l}"><b style="font-weight:${v};font-family:${fc.family}">Aa</b></button>`).join("")}</div>
      <span class="ed-typesep"></span>
      <button class="ed-tog ed-tip" data-ed="fstyle" data-k="${pre}italic" aria-pressed="${!!L[pre + "italic"]}" aria-label="Italic" data-tip="Italic"><i>I</i></button>
      <button class="ed-tog ed-tip" data-ed="fstyle" data-k="${pre}underline" aria-pressed="${!!L[pre + "underline"]}" aria-label="Underline" data-tip="Underline"><u>U</u></button></div></div>`;
}
function loadFonts() {
  if (document.getElementById("edFonts")) return;
  // one small request per font (bundled ones are already on the page), so one font Google can't serve never
  // stops the others; the font files themselves only download when a caption or hook uses them
  const m = document.createElement("meta"); m.id = "edFonts"; document.head.append(m);
  Object.values(FONTS()).filter(f => !f.local).forEach(f => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${f.google.replace(/ /g, "+")}:wght@${f.weight}&display=swap`;
    document.head.append(l);
  });
}

/* ---------- open, close, dirty */
const snap = () => JSON.stringify({s: E.start, e: E.end, h: E.hook, t: E.title, d: E.description, l: E.layout, k: E.look,
  w: E.edited ? E.words : null, c: E.cuts || []});
const dirty = () => E.saved !== snap();

window.openClip = async function (jid, cid) {
  const j = jobOf(jid), c = j?.clips.find(x => x.id === cid);
  if (!c) return;
  Object.keys(E).forEach(k => delete E[k]);
  D.jid = jid; D.cid = cid;          // the page's refresh keeps the editor's status up to date while this is set
  Object.assign(E, {jid, cid, tab: "style", txTab: "transcript", view: "live", words: [], auto: [], edited: false,   // always the live preview: edits show at once
    start: c.start, end: c.end, hook: c.hook || "", title: c.title || "", description: c.description || "", layout: c.layout || "blur",
    look: c.look ? {...HOOK_DEFAULT, ...clone(c.look)} : lookFromStyle(c.style), lookTouched: !!c.look, off: c.src_offset || 0, min: c.src_offset || 0,
    max: c.src_end || j.duration || c.end, version: c.version || 0, waiting: 0, brand: [], sw: j.width || 1280, sh: j.height || 720, shot: null,
    cuts: clone(c.cuts || []), cl: {fill: true, pause: true, min: 0.8}, cleanOpen: false, hideCut: false,
    zoom: phone() ? 3 : 1, rate: 1, q: "", sheet: null,       // phones: a wider film strip that scrolls, like an editing app
    // phones start with the timeline folded (more room for the preview) until it is opened once; computers start with it open
    tlHidden: (() => { try { return phone() ? localStorage.getItem("ed_tl_phone") !== "shown" : !!localStorage.getItem("ed_tl_hidden"); } catch { return phone(); } })()});
  loadFonts();
  const dlg = $("#clipdlg");
  dlg.classList.add("ed-on");
  dlg.innerHTML = `<div class="ed"><div class="ed-loading">Opening the editor…</div></div>`;
  if (!dlg.open) dlg.showModal();
  try {
    const [cap, brand, mus] = await Promise.all([api(`/api/jobs/${jid}/clips/${cid}/captions`), api("/api/brand").catch(() => ({styles: []})),
      api("/api/music").catch(() => ({tracks: []}))]);
    E.music = mus.tracks || [];
    api("/api/media").then(r => { E.media = r.items || []; if (E.tab === "media") drawPanel(); E.picKey = ""; paintOverlay(); }).catch(() => {});
    if (E.cid !== cid) return;
    Object.assign(E, {words: clone(cap.words), auto: cap.edited ? [] : clone(cap.words), edited: cap.edited,
      off: cap.offset, min: cap.min, max: cap.max, brand: brand.styles || [], brandDef: brand.default, logoV: brand.logo || 0, chat: cap.chat || null});
  } catch (e) { toast(e.message, "bad"); }
  E.saved = snap(); E.lookKey = JSON.stringify(E.look);
  // A hook made before hooks were written in normal case: offered in normal case, as a change to save
  if (sentenceCase(E.hook) !== E.hook) E.hook = sentenceCase(E.hook);
  // the timeline opens on the clip itself (a little footage either side), not the whole stretch saved around it;
  // zooming out still shows everything, zooming in goes further
  const fit = (E.max - E.min) / Math.max(1, (E.end - E.start) * 1.2);
  E.zmax = Math.max(8, Math.ceil(fit * 3));
  E.zoom = Math.max(phone() ? 3 : 1, Math.min(E.zmax, Math.round(fit * 2) / 2));
  E.tplOpen = E.keysOpen = false;
  draw();
  histReset();                     // undo starts from the clip as it opened
  E.ro?.disconnect();             // the view switch follows the preview column as panels show and hide
  if (window.ResizeObserver && $e(".ed-center")) { E.ro = new ResizeObserver(placeViews); E.ro.observe($e(".ed-center")); }
  document.fonts?.ready.then(() => placeViews());      // widths settle once the fonts are in
  requestAnimationFrame(centreTimeline);
};
async function edClose() {
  const cid = E.cid;
  E.musEl?.pause(); exDoneClear();
  if (dirty()) { clearTimeout(E.asT); E.saving = false; await autoSave(); }    // changes save themselves, also on the way out
  if (E.cid === cid) $("#clipdlg").close();      // another clip opened while that save ran: leave it open
}
window.drawClipDlg = function () {          // called on every refresh of the page: only the clip's status changes here
  if (!E.cid || !$("#clipdlg").open) return;
  const c = clipNow();
  if (!c) return $("#clipdlg").close();
  const busy = c.status === "queued" || c.status === "rendering";
  if (E.waiting && c.status === "done" && (c.version || 0) > E.version) {
    // the video is made; the editor stays on the live preview (the Saved button above shows the file)
    E.waiting = 0; E.version = c.version; toast("Your clip is ready. Saved shows the video file.", "ok"); drawStage();
  } else if (E.waiting && c.status === "error") { E.waiting = 0; toast(c.error || "Couldn't make this clip.", "bad"); drawStage(); }
  else if (E.srcWait && c.status !== E.srcWait) { E.srcWait = ""; drawStage(); }   // a live clip's footage just arrived: try again
  const st = $e("#edState");
  // the save state, quietly: a mark and a word or two. Hover tells the rest.
  if (st) st.innerHTML = busy ? `<span class="ed-pill busy" title="The video is being made with your edits"><i></i>${c.status === "rendering" ? "Rendering" : "In line"}</span>`
    : dirty() || E.saving ? `<span class="ed-pill"><i class="ed-spin"></i>Saving</span>`
    : c.unrendered ? `<span class="ed-pill draft" title="Your edits are saved. The video file gets them when you Render or Export."><i></i>Saved · not in video yet</span>`
    : `<span class="ed-pill ok" title="Saved, and the video file is up to date">${ic("check")}Saved</span>`;
  // changes save by themselves a moment after the last one; Render makes the video
  clearTimeout(E.asT);
  if (dirty() && !busy) E.asT = setTimeout(autoSave, 1500);
  const sv = $e("#edSave");
  if (sv) {                                // Render: rolls to "Rendering" and fills softly while the clip is made
    sv.disabled = busy;
    if (busy && !sv._pf) pfStart(sv, "Rendering", Math.max(10, (E.end - E.start) * 0.45));
    else if (!busy && sv._pf) pfStop(sv, c.status === "done" ? "Done" : "Render", "Render");
  }
  const kp = $e("#edKeep"); if (kp) kp.disabled = busy || !dirty();
  const mk = $e("#edMaking"); if (mk) mk.hidden = !busy;
  const sc = $e("#edScan"); if (sc) sc.hidden = !busy || E.view !== "live";      // the scanning pass while it renders
};

/* ---------- the whole editor */
// the tools on the left rail open their settings in the panel on the right; the transcript is always under the preview
const LAYOUT_IC = ri("ed_layout", '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 12h12"/>');
const CLEAN_IC = ri("ed_clean", '<path d="M3 12h2M7 9v6M11 6v12M15 10v4M19 8v8"/><path d="M4 20L20 4" opacity=".55"/>');   // a sound wave with a cut through it
const BRAND_IC = typeof RI !== "undefined" && RI.ed_brand ? ri("ed_brand", "") : svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.5"/>');
const TOOLS = () => [["style", "Captions", ic("cc")], ["text", "Text", TEXT_IC], ["layout", "Layout", LAYOUT_IC], ["brand", "Brand", BRAND_IC], ["fx", "Effects", FX_IC],
  ["audio", "Audio", SOUND(true)], ["media", "Media", PIC_IC], ["trim", "Trim", ic("scissors")], ["clean", "Cleanup", CLEAN_IC], ["post", "Post", ic("send")]];
const toolOf = tab => tab;
function draw() {
  const c = clipNow(); if (!c) return;
  $("#clipdlg").innerHTML = `<div class="ed">
    <header class="ed-top">
      <div class="ed-left"><button class="ed-ib" data-ed="close" aria-label="Close editor">${ic("x")}</button>
        <div class="ed-name"><b title="${esc(E.title || E.hook || "")}">${esc(E.title || E.hook || "Untitled clip")}</b></div>
        <span class="ed-hsep" aria-hidden="true"></span>
        <button class="ed-ib" data-ed="tour" title="What's new in the editor" aria-label="What's new in the editor">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 17v.01M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4"/>')}</button>
        <span class="ed-undo"><button class="ed-ib ed-tip" id="edUndo" data-ed="undo" aria-label="Undo" data-tip="Undo (Ctrl Z)" disabled>${svg('<path d="M9 14l-4-4l4-4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/>')}</button>
          <button class="ed-ib ed-tip" id="edRedo" data-ed="redo" aria-label="Redo" data-tip="Redo (Ctrl Shift Z)" disabled>${svg('<path d="M15 14l4-4l-4-4"/><path d="M19 10H8a4 4 0 1 0 0 8h1"/>')}</button>
          <button class="ed-ib ed-tip" data-ed="keys" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts (?)">${svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>')}</button></span>
      </div>
      <div class="ed-views ed-hviews" id="edViews" role="group" aria-label="What the preview shows"></div>
      <div class="ed-acts"><span id="edState"></span>
        <button class="ed-btn" data-ed="exdlg" aria-haspopup="dialog">${ic("down")}Export</button>
        <button class="ed-btn primary ed-render pfx" id="edSave" data-ed="save" title="Make the video with your changes (they're already saved)"><i class="pf-fill"></i>${svg('<path d="M7 4v16l13-8z"/>')}<span class="pf-l">Render</span></button>
      </div>
    </header>
    <div class="ed-body">
      <nav class="ed-rail" role="tablist" aria-label="Editor tools">${TOOLS().map(([k, l, i]) =>
        `<button role="tab" aria-selected="${toolOf(E.tab) === k}" data-ed="tab" data-t="${k}">${i}<span>${l}</span></button>`).join("")}
        <button class="ed-mob" data-ed="sheet" data-v="tx" aria-label="Script">${svg('<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>')}<span>Script</span></button></nav>
      <div class="ed-scrim" data-ed="sheetclose"></div>
      <button class="ed-sheetx" data-ed="sheetclose" aria-label="Close">${ic("x")}</button>
      <aside class="ed-panel" id="edPanel"></aside>
      <section class="ed-center"><section class="ed-stage" id="edStage"></section></section>
      <aside class="ed-txcard" id="edTxCard"></aside>
    </div>
    <footer class="ed-tl" id="edTl"></footer>
    <input type="file" id="edSrtFile" accept=".srt,text/plain" hidden>
  </div>`;
  drawPanel(); drawStage(); drawTimeline(); drawClipDlg();
  syncSheet();
  let seen = false; try { seen = !!localStorage.getItem(TOUR_KEY); } catch {}
  if (!seen) setTimeout(() => { if ($("#clipdlg").open && !$e("#edTour")) tourShow(0); }, 700);      // the first time only
}

/* ---------- left panel */
function transcriptHtml() {
  // the words of the clip as running text: a pause of more than half a second shows as [1.2s],
  // a long one starts a new paragraph. Every word can be clicked to jump there.
  const ws = inClip(), q = E.q.trim().toLowerCase();
  if (!ws.length) return `<p class="ed-help">No words were heard in this part of the video.</p>`;
  let out = `<p>`, hits = 0;
  ws.forEach(([w, i], n) => {
    const prev = n ? ws[n - 1][0] : null, gap = prev ? w.s - prev.e : w.s - E.start;
    const gapCut = prev && inCut((prev.e + w.s) / 2) ? " cut" : "";        // what Speech cleanup took out is struck through
    if (!(gapCut && E.hideCut)) {
      if (prev && gap >= 2) out += `<i class="gap${gapCut}">[${gap.toFixed(1)}s]</i></p><p>`;
      else if (gap >= 0.5) out += `<i class="gap${gapCut}">[${gap.toFixed(1)}s]</i> `;
    }
    const cut = wordCut(w);
    if (cut && E.hideCut) return;
    const hit = q && w.w.toLowerCase().includes(q); if (hit) hits++;
    out += `<span class="tw${hit ? " hit" : ""}${FILLER.test(w.w) ? " fill" : ""}${cut ? " cut" : ""}" data-ed="seek" data-at="${w.s}" data-i="${i}">${esc(w.w)}</span> `;
  });
  E.hits = hits;
  return out + `</p>`;
}
/* the transcript card under the preview: the words as running text (the spoken one lit, click to jump), or the
   subtitle lines to fix, with search, copy and .srt */
function drawTx() {
  const box = $e("#edTxCard"); if (!box) return;
  E.gi = -1; E.wi = -1;
  const ls = lines(), tr = E.txTab !== "subs", nWords = inClip().length;
  // two short rows: the tabs with the word count beside them, then search and the small tools
  // the tabs, then the search button beside the word count; the search opens full width under them. The tools
  // sit in a bar along the bottom, each with its name.
  const qOpen = E.qOpen || !!E.q.trim();
  box.innerHTML = `<div class="ed-txhead compact">
      <div class="ed-txrow"><div class="ed-ptabs pill" role="tablist"><button role="tab" data-ed="ptab" data-t="transcript" aria-selected="${tr}">Transcript</button>
        <button role="tab" data-ed="ptab" data-t="subs" aria-selected="${!tr}">Subtitles</button></div>
        <button class="ed-ib ed-tip ed-qbtn ${qOpen ? "on" : ""}" data-ed="txsearch" aria-expanded="${qOpen}" aria-label="Search the words" data-tip="Search the words (Ctrl F)">${ic("search")}</button>
        <span class="ed-txmeta" title="${nWords} words">${nWords} words · ${ts(keptLen())}${E.cuts?.length ? ` · ${ts(cutLen())} cut` : ""}${E.edited ? " · edited" : ""}</span></div>
      ${qOpen ? `<label class="ed-search ed-qfull">${ic("search")}<input id="edQ" value="${esc(E.q)}" placeholder="Search the words" aria-label="Search the words"><small id="edHits"></small>
        <button class="ed-qx" data-ed="txsearchx" aria-label="Close the search" title="Close (Esc)">${ic("x")}</button></label>` : ""}
    </div>
    <div class="ed-txbody" id="edTxBody">${tr ? `<div class="ed-tx" id="edTx">${transcriptHtml()}</div>`
      : `<div class="ed-lines">${ls.length ? ls.map((g, gi) => {
          const text = g.map(i => E.words[i].w).join(" "), hit = E.q.trim() && text.toLowerCase().includes(E.q.trim().toLowerCase());
          return `<div class="ed-line${hit ? " hit" : ""}" data-g="${gi}"><button class="ed-t" data-ed="seek" data-at="${E.words[g[0]].s}">${ts(E.words[g[0]].s - E.start)}</button>
            <input value="${esc(text)}" data-line="${gi}" aria-label="Subtitle line ${gi + 1}"></div>`; }).join("")
        : `<p class="ed-help">No words were heard in this part of the video.</p>`}</div>`}</div>
    <div class="ed-txfoot" role="toolbar" aria-label="Script tools">
      <button class="ed-tf ${E.hideCut ? "on" : ""}" data-ed="hidecut" aria-pressed="${E.hideCut}" title="${E.hideCut ? "Show the words that were cut" : "Hide the words that were cut"}">${svg('<path d="M4 6h16l-6 7v5l-4 2v-7z"/>')}<span>${E.hideCut ? "Show cuts" : "Hide cuts"}</span></button>
      <button class="ed-tf" data-ed="copytx" title="Copy the text">${ic("copy")}<span>Copy</span></button>
      <button class="ed-tf" data-ed="dlscript" title="Download the script">${ic("down")}<span>Download</span></button>
      <button class="ed-tf${E.rehear ? " busy" : ""}" data-ed="rehear" title="Words wrong? Listen to this clip again" ${E.rehear ? "disabled" : ""}>${svg('<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>')}<span>${E.rehear ? "Listening…" : "Re-listen"}</span></button>
      ${E.edited ? `<button class="ed-tf" data-ed="resetcaps" title="Use the original words">${svg('<path d="M9 14l-4 -4l4 -4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/>')}<span>Original</span></button>` : ""}
    </div>`;
  const h = $e("#edHits"); if (h) h.textContent = E.q.trim() ? (tr ? `${E.hits || 0}` : `${$$e(".ed-line.hit").length}`) : "";
}
function drawPanel() {
  const p = $e("#edPanel"); if (!p) return;
  $$e(".ed-rail [data-t]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === toolOf(E.tab))));
  E.gi = -1; E.wi = -1;
  // every tool opens with the same header card: its icon in an accent tile, its name and one line, on a soft glow
  const toolIc = (TOOLS().find(t => t[0] === toolOf(E.tab)) || TOOLS()[0])[2];
  const head = (title, sub) => `<div class="ed-hero"><span class="ed-hero-ic">${toolIc}</span><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div></div>`;
  drawTx();
  if (E.tab === "audio") {
    const vol = E.look.volume ?? 100;
    p.innerHTML = head("Audio", "How loud the clip is. Every clip is evened out first, so 100% is its normal level.") +
      `<div class="ed-card"><b>Volume</b>${slider("Volume", "volume", 0, 200, 5, vol, vol + "%")}
        <div class="ed-seg">${[[50, "Quieter"], [100, "Normal"], [150, "Louder"]].map(([v, l]) => `<button data-ed="vol" data-v="${v}" aria-pressed="${vol === v}">${l}</button>`).join("")}</div>
        <p class="ed-help">Heard in the preview right away, and in the video when you save and render. On a computer, the meter beside the timeline shows the level as it plays.</p></div>` + musicCard();
  } else if (E.tab === "style") {
    const L = E.look, f = FONTS();
    // each style drawn over a frame of this very clip, where captions sit (the lower third), its name on a strip inside
    const tile = (key, look, label, del) => { const fc = fontCss(look.font, look.weight);
      const on = look.font === L.font && look.base === L.base && look.active === L.active && look.size === L.size && look.upper === L.upper;
      return `<button class="ed-preset ${on ? "on" : ""}" data-ed="${del ? "brandpick" : "preset"}" data-k="${esc(key)}" aria-pressed="${on}" title="${esc(label)}">
        <span class="ed-ps ${E.shot ? "raw" : ""}"><i style="background-image:url('${E.shot || `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`}')"></i>${on ?`<span class="ed-pck">${ic("check")}</span>` : ""}
          <span class="ed-pt" style="font-family:${fc.family};font-weight:${fc.weight};color:${look.base};${look.cap_op > 0
            ? `background:${rgba(look.cap_box || "#000000", look.cap_op)};padding:3px 8px;border-radius:6px;-webkit-text-stroke:0`
            : `-webkit-text-stroke:${look.outline ? Math.max(2, look.outline / 2.4).toFixed(1) : 0}px #000`}">
          ${look.upper ? "CLIP" : "Clip"} <em style="color:${look.active}">${look.upper ? "THIS" : "this"}</em></span><b>${esc(label)}</b></span>
        ${del ? `<i class="ed-x" data-ed="branddel" data-k="${esc(key)}" title="Remove from brand kit">${ic("x")}</i>` : ""}</button>`; };
    const fold = (k, title, note, body) => `<details class="ed-fold" data-fold="${k}" ${E.shut?.has(k) ? "" : "open"}><summary>${title}${note ? `<small>${note}</small>` : ""}</summary><div>${body}</div></details>`;
    const st = E.stab || "presets";
    const tabs = `<div class="ed-ptabs pill wide" role="tablist"><button role="tab" data-ed="stab" data-t="presets" aria-selected="${st === "presets"}">${ic("cc")}Styles</button>
      <button role="tab" data-ed="stab" data-t="settings" aria-selected="${st === "settings"}">${svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')}Customize</button></div>`;
    const shead = head("Captions", "How the captions look. Pick a style, then fine-tune it.");
    if (st === "presets") {
      const q = (E.sq || "").trim().toLowerCase();
      const presets = Object.entries(PRESETS()).filter(([, v]) => !q || `${v.label} ${v.font}`.toLowerCase().includes(q));
      const posNow = L.y == null ? "bottom" : L.y < 35 ? "top" : L.y < 65 ? "middle" : "bottom";
      // the tabs and the search stay pinned at the top while the styles scroll under them
      p.innerHTML = shead + `<div class="ed-stick">${tabs}<label class="ed-search ed-ssearch">${ic("search")}<input id="edSq" value="${esc(E.sq || "")}" placeholder="Search styles and fonts…" aria-label="Search caption styles"></label></div>
        <div class="ed-presets big">${presets.map(([k, v]) => tile(k, v, v.label)).join("") || `<p class="ed-help">No style matches.</p>`}</div>
        ${E.brand.length ? `<p class="ed-grp">Your brand kit</p><div class="ed-presets big">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>` : ""}
        <div class="ed-quick"><p class="ed-qt">Quick adjust</p>
          <div class="ed-qrow"><span>Font</span><select data-look="font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div>
          <div class="ed-qrow"><span>Size</span>${slider("Size", "size", 60, 220, 2, L.size, L.size)}</div>
          <div class="ed-qrow"><span>Position</span><div class="ed-seg">${[["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].map(([v, l]) => `<button data-ed="capos" data-v="${v}" aria-pressed="${posNow === v}">${l}</button>`).join("")}</div></div>
          <button class="ed-btn primary ed-applyall" data-ed="applyall">${ic("check")}Apply to all captions</button>
        </div>
        ${saveLook()}`;
      return;
    }
    p.innerHTML = shead + `<div class="ed-stick">${tabs}</div>` + `
      ${fold("text", "Font and size", esc(L.font), `
        <label class="ed-f">Font<select data-look="font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${slider("Size", "size", 60, 220, 2, L.size, L.size)}
        ${typeCtl(L, L.font, "")}
        <div class="ed-f">Words per line<div class="ed-seg">${[1, 2, 3, 4, 5].map(n => `<button data-ed="per" data-n="${n}" aria-pressed="${L.per === n}">${n}</button>`).join("")}</div></div>
        <div class="ed-f">Letters<div class="ed-seg"><button data-ed="upper" data-v="1" aria-pressed="${L.upper}">AA</button><button data-ed="upper" data-v="0" aria-pressed="${!L.upper}">Aa</button></div></div>`)}
      ${fold("colour", "Colours", "", `
        ${[["base", "Text"], ["active", "Highlight"]].map(([k, l]) => `<div class="ed-f">${l}<div class="ed-sw">
          ${SWATCHES.map(h => `<button data-ed="colour" data-k="${k}" data-v="${h}" style="background:${h}" aria-pressed="${L[k] === h}" aria-label="${h}"></button>`).join("")}
          <label class="ed-pick" style="background:${L[k]}"><input type="color" value="${L[k].toLowerCase()}" data-look="${k}" aria-label="Pick a ${l.toLowerCase()} colour"></label></div></div>`).join("")}
        ${slider("Outline", "outline", 0, 12, 1, L.outline, L.outline)}`)}
      ${fold("space", "Spacing", (L.sp || L.wgap) ? "Custom" : "Normal", `
        ${slider("Letter spacing", "sp", -4, 24, 1, L.sp || 0, L.sp || 0)}
        ${slider("Word spacing", "wgap", 0, 80, 2, L.wgap || 0, L.wgap || 0)}`)}
      ${fold("bg", "Background", (L.cap_op || 0) > 0 ? Math.round(L.cap_op) + "%" : "None", `
        <div class="ed-seg">${CAP_BGS.map(([k, l, v]) => `<button data-ed="capbg" data-k="${k}" aria-pressed="${k === "none" ? !(L.cap_op > 0) : L.cap_op === v.cap_op && L.cap_box === v.cap_box}">${l}</button>`).join("")}</div>
        ${swatches("cap_box", "Box colour", L.cap_box || "#000000")}
        ${slider("Box opacity", "cap_op", 0, 100, 5, L.cap_op || 0, (L.cap_op || 0) + "%")}
        ${slider("Corners", "cap_round", 0, 60, 2, L.cap_round ?? 18, L.cap_round ?? 18)}`)}
      ${fold("pos", "Position", L.y == null ? "Auto" : Math.round(L.y) + "%", `
        ${posCard("cap")}`)}
      ${fold("brand", "Brand kit", `${E.brand.length}/12`, `
        ${E.brand.length ? `<div class="ed-presets">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>${brandDefRow()}`
          : `<p class="ed-help">Save the look you like and it's used on every new clip.</p>`}
        <div class="ed-row"><input id="edBrandName" placeholder="Name this look" maxlength="40"><button class="ed-btn" data-ed="brandsave">${ic("plus")}Save look</button></div>`)}`;
  } else if (E.tab === "text") {
    const L = E.look, H = hookOf(L), f = FONTS(), autoY = Math.round(geo(E.layout, E.sw, E.sh).hook / OUT_H * 100);
    p.innerHTML = head("Text", "The hook: the big line at the top that makes people stop scrolling.") +
      `<div class="ed-card">
        <div class="ed-h"><b>Show the hook</b><label class="ed-sw2"><input type="checkbox" data-look="hook" ${L.hook ? "checked" : ""}><span></span></label></div>
        <div class="ed-hookin"><textarea id="edHook" rows="2" maxlength="60" placeholder="The big line at the top" ${L.hook ? "" : "disabled"}>${esc(E.hook)}</textarea>
          <button class="ed-emjbtn ${E.emjOpen ? "on" : ""}" data-ed="emjopen" aria-expanded="${!!E.emjOpen}" title="Add an emoji">${emojiImg("1f525", "")}Emoji</button></div>
        <span class="ed-count"><span id="edHookN">${E.hook.length}</span>/60</span>
        ${E.emjOpen ? emojiPicker() : ""}
      </div>
      <div class="ed-card"><b>Style</b>
        <div class="ed-hstyles">${HOOK_STYLES.map(([k, l, v]) => `<button class="ed-hst ${H.hook_box === v.hook_box && H.hook_ink === v.hook_ink && H.hook_op === v.hook_op ? "on" : ""}" data-ed="hookstyle" data-k="${k}">
          <i><b style="background:${v.hook_op ? rgba(v.hook_box, v.hook_op) : "transparent"};color:${v.hook_ink};border-radius:4px;${v.hook_op < 35 ? "-webkit-text-stroke:2px #000;paint-order:stroke fill" : ""}">Hook</b></i>${l}</button>`).join("")}</div>
        <div class="ed-f">Banner<div class="ed-seg">${[["fit", "Fitted"], ["full", "Full"], ["line", "Per line"], ["none", "None"]].map(([v, l]) =>
          `<button data-ed="hookbanner" data-v="${v}" aria-pressed="${(L.hook_banner || "fit") === v}">${l}</button>`).join("")}</div></div>
        ${swatches("hook_box", "Box colour", H.hook_box)}
        ${swatches("hook_ink", "Text colour", H.hook_ink)}
        ${slider("Box opacity", "hook_op", 0, 100, 5, H.hook_op, H.hook_op + "%")}
        ${slider("Corners", "hook_round", 0, 60, 2, H.hook_round, H.hook_round)}
      </div>
      <div class="ed-card"><b>Font and spacing</b>
        <label class="ed-f">Font<select data-look="hook_font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === H.hook_font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${slider("Size", "hook_size", 50, 140, 2, H.hook_size, H.hook_size)}
        ${typeCtl(L, H.hook_font, "hook_")}
        <div class="ed-f">Letters<div class="ed-seg">${[["asis", "As typed"], ["upper", "UPPER"], ["title", "Title"], ["lower", "lower"]].map(([v, l]) =>
          `<button data-ed="hookcase" data-v="${v}" aria-pressed="${(L.hook_case || "asis") === v}">${l}</button>`).join("")}</div></div>
        ${slider("Letter spacing", "hook_sp", -4, 24, 1, H.hook_sp, H.hook_sp)}
        ${posCard("hook")}
        <button class="ed-link" data-ed="hookreset">Back to the default look</button>
      </div>
      <div class="ed-card"><b>Show for</b>
        <div class="ed-f">
          <div class="ed-seg">${[[3, "3 s"], [5, "5 s"], [8, "8 s"], [0, "Whole clip"]].map(([v, l]) => `<button data-ed="hookdur" data-v="${v}" aria-pressed="${H.hook_dur === v}">${l}</button>`).join("")}</div>
          ${slider("Seconds on screen", "hook_dur", 0, Math.max(1, Math.min(60, Math.floor(E.end - E.start))), 0.5, H.hook_dur, H.hook_dur ? H.hook_dur + " s" : "Whole clip", "edHookDur")}</div>
        <p class="ed-help">The hook shows from the start of the clip, then fades away. Drag to the left end to keep it the whole time.</p>
      </div>
      ${saveLook()}`;
  } else if (E.tab === "layout") {
    const sp = splitOf(), split = E.layout === "split";
    const LAYS = [["blur", "Centered", "The whole video, a blurred copy behind it"], ["zoom", "Zoomed in", "Closer in, blurred above and below"],
      ["crop", "Solo", "One part of the video fills the screen"], ["split", "Face cam split", "The stream on top, the streamer's face cam below"],
      ["card", "Post card", "The clip inside a social post, with your name"]];
    const lic = k => ({blur: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 9h10M7 15h10"/>', zoom: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 7h10M7 17h10"/>',
      crop: '<rect x="7" y="3" width="10" height="18" rx="2" fill="currentColor" fill-opacity=".25"/>', split: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 12h10"/><circle cx="12" cy="16.5" r="1.8"/>'})[k];
    // each layout as a small phone showing this clip's own frame arranged that way
    const bg = `background-image:url('${stillOf()}')`;
    const cam = sp.cam, crop = r => `${bg};background-size:${(100 / r[2]).toFixed(1)}% ${(100 / r[3]).toFixed(1)}%;background-position:${(r[2] < 1 ? r[0] / (1 - r[2]) * 100 : 50).toFixed(1)}% ${(r[3] < 1 ? r[1] / (1 - r[3]) * 100 : 50).toFixed(1)}%`;
    const mini = k => k === "split"
      ? `<i class="lp-part" style="${crop(splitOf().game)}"></i><i class="lp-part" style="${crop(cam)}"></i>`
      : k === "card" ? miniCard(bg, cardOf().theme)
      : `<i class="lp-bg" style="${bg}"></i><i class="lp-fg ${k}" style="${bg}"></i>`;
    const cd = cardOf();
    p.innerHTML = head("Layout", "How the video sits in the frame. Split puts the streamer's face cam under the stream.") + `
      <div class="ed-row ed-layacts"><button class="ed-btn" data-ed="tpl">${svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')}Templates</button>
        <button class="ed-btn" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Frame the video</button></div>
      <div class="ed-lays2">${LAYS.map(([k, l, s]) => `<button data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}" title="${esc(s)}">
        <span class="lp-ph ${k} ${k === "split" && sp.cam_at === "top" ? "camtop" : ""}">${mini(k)}${E.layout === k ? `<span class="ed-pck">${ic("check")}</span>` : ""}</span>
        <b>${l}</b></button>`).join("")}</div>
      <p class="ed-laynote">${esc((LAYS.find(x => x[0] === E.layout) || LAYS[0])[2])}</p>
      ${split ? `<div class="ed-card"><b>Face cam and stream</b>
        <p class="ed-help">Drag the boxes onto the stream and onto the face cam. Drag the corner to resize.</p>
        <div class="ed-pick" id="edPick" style="height:0;padding-bottom:${((E.sh || 9) / (E.sw || 16) * 100).toFixed(3)}%"><canvas id="edPickCv"></canvas>
          <div class="ed-rg game" data-rg="game"><span>Stream</span><i class="rz"></i></div>
          <div class="ed-rg cam" data-rg="cam"><span>Face cam</span><i class="rz"></i></div></div>
        <div class="ed-f">Face cam goes<div class="ed-seg">${[["bottom", "Below"], ["top", "Above"]].map(([v, l]) => `<button data-ed="splitpos" data-v="${v}" aria-pressed="${sp.cam_at === v}">${l}</button>`).join("")}</div></div>
        ${slider("Stream part", "split_share", 30, 70, 5, sp.share, sp.share + "%")}
        <button class="ed-link" data-ed="splitreset">Back to the usual spots</button></div>` : ""}
      ${E.layout === "blur" || E.layout === "zoom" ? bgCard() : ""}
      ${E.layout === "card" ? `<div class="ed-card"><b>Post card</b>
        <div class="ed-f">Style<div class="ed-ctiles">${Object.entries(CARD_THEMES).map(([v, t]) => `<button class="ed-ctile" data-ed="cardset" data-k="theme" data-v="${v}" aria-pressed="${cd.theme === v}">
          <span class="ed-ctile-pv" style="background:${t.bg}"><i style="background:${t.acc}"></i><b style="background:${t.ink}"></b><b class="s" style="background:${t.sub}"></b><em></em></span>${t.label}</button>`).join("")}</div></div>
        <div class="ed-f">Behind the card<div class="ed-seg">${[["none", "Plain"], ["gradient", "Gradient"], ["blur", "Blurred video"]].map(([v, l]) =>
          `<button data-ed="cardset" data-k="back" data-v="${v}" aria-pressed="${cd.back === v}">${l}</button>`).join("")}</div></div>
        ${cd.back === "gradient" ? `<div class="ed-gradsw">${CARD_BACKS.map(([l, a, b]) => `<button data-ed="cardgrad" data-a="${a}" data-b="${b}" title="${l}" aria-pressed="${cd.g1 === a && cd.g2 === b}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join("")}</div>
          <div class="ed-row"><label class="ed-f ed-colf">From<span class="ed-swc" style="background:${cd.g1}"><input type="color" data-card="g1" value="${cd.g1}" aria-label="Gradient from"></span></label>
            <label class="ed-f ed-colf">To<span class="ed-swc" style="background:${cd.g2}"><input type="color" data-card="g2" value="${cd.g2}" aria-label="Gradient to"></span></label></div>
          <label class="ed-ck"><input type="checkbox" data-ed="cardgrain" ${cd.grain ? "checked" : ""}><span>Film grain<small>A fine texture so the colour doesn't look flat</small></span></label>` : ""}
        <label class="ed-f">Name<input class="ed-text" data-card="name" value="${esc(cd.name)}" maxlength="40" placeholder="${esc(cardName() || "Your name")}"></label>
        <label class="ed-f">${(CARD_THEMES[cd.theme] || {}).kind === "linkedin" ? "Headline" : "Handle"}<input class="ed-text" data-card="handle" value="${esc(cd.handle)}" maxlength="30" placeholder="@${esc((cardName() || "yourname").toLowerCase().replace(/[^a-z0-9_]/g, ""))}"></label>
        <label class="ed-f">Post text<textarea class="ed-text" data-card="text" maxlength="220" rows="3" placeholder="${esc(E.hook || "What the post says")}">${esc(cd.text)}</textarea></label>
        <p class="ed-help">Left empty, the post says the clip's hook.</p>
        <div class="ed-f">Picture<div class="ed-seg"><button data-ed="cardset" data-k="avatar" data-v="logo" aria-pressed="${cd.avatar !== "initial"}" ${E.logoV ? "" : "disabled title=\"Upload a logo in Brand first\""}>My logo</button>
          <button data-ed="cardset" data-k="avatar" data-v="initial" aria-pressed="${cd.avatar === "initial" || !E.logoV}">First letter</button></div></div>
        <div class="ed-f">Blue check<div class="ed-seg"><button data-ed="cardset" data-k="verified" data-v="1" aria-pressed="${cd.verified}">Show</button>
          <button data-ed="cardset" data-k="verified" data-v="0" aria-pressed="${!cd.verified}">Hide</button></div></div>
        <label class="ed-sl" style="--p:${pctOf(cd.scale, 50, 130)}"><input type="range" min="50" max="130" step="1" value="${cd.scale}" data-card="scale" aria-label="Card size">
          <span class="ed-sl-l">Card size</span><output>${cd.scale}</output></label>
        ${cd.back !== "none" ? `<label class="ed-sl" style="--p:${pctOf(cd.pad, 16, 90)}"><input type="range" min="16" max="90" step="2" value="${cd.pad}" data-card="pad" aria-label="Room inside the card">
          <span class="ed-sl-l">Room inside</span><output>${cd.pad}</output></label>` : ""}
        <div class="ed-row"><button class="ed-btn ghost sm" data-ed="cardcentre" ${cd.dx || cd.dy ? "" : "disabled"}>Centre the card</button>
          <span class="ed-help" style="margin:0">Drag the card on the video to move it, its corner to resize.</span></div>
        <label class="ed-sl" style="--p:${pctOf(cd.radius, 0, 60)}"><input type="range" min="0" max="60" step="2" value="${cd.radius}" data-card="radius" aria-label="Video corners">
          <span class="ed-sl-l">Video corners</span><output>${cd.radius}</output></label></div>` : ""}`;
    if (split) { placeRegions(); drawPickFrame(); }
  } else if (E.tab === "brand") {
    const L = E.look, on = !!L.brand_on;
    p.innerHTML = head("Brand", "Your logo and name on every clip, so it's always yours, even when it's shared.") + `
      <div class="ed-card">
        <div class="ed-h"><b>Show my brand</b><label class="ed-sw2"><input type="checkbox" data-look="brand_on" ${on ? "checked" : ""}><span></span></label></div>
      </div>
      <div class="ed-card"><div class="ed-seg">${[["badge", "Logo and name"], ["social", "Social watermark"]].map(([v, l]) =>
        `<button data-ed="brandkind" data-v="${v}" aria-pressed="${(L.brand_kind || "badge") === v}">${l}</button>`).join("")}</div></div>
      ${L.brand_kind === "social" ? wmCards(L) : `<div class="ed-card"><b>Logo</b>
        ${E.logoV ? `<div class="ed-logo2">
            <span class="ed-logo2-pv"><img src="/api/brand/logo?v=${E.logoV}" alt="Your logo"></span>
            <span class="ed-logo2-t"><b>Your logo</b><small>Saved for every clip</small></span>
            <label class="ed-btn sm" title="Upload a different logo">Replace<input type="file" accept="image/png,image/jpeg,image/webp" id="edLogoIn" hidden></label>
            <button class="ed-ib sm ed-tip" data-ed="logodel" aria-label="Remove the logo" data-tip="Remove">${svg('<path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')}</button></div>
          <label class="ed-ck"><input type="checkbox" data-look="brand_logo" ${L.brand_logo !== false ? "checked" : ""}><span>Show the logo on the video</span></label>`
          : dropCard("edLogoIn", "image/png,image/jpeg,image/webp", "Upload your logo", "Drop it here or browse · a PNG with a clear background works best")}
      </div>
      <div class="ed-card"><b>Name</b>
        <input class="ed-text" data-look="brand_text" value="${esc(L.brand_text || "")}" maxlength="40" placeholder="@yourname">
      </div>`}
      <div class="ed-card"><b>Where</b>
        <div class="ed-posgrid">${BRAND_POSES.map(([k, l]) => `<button data-ed="brandpos" data-v="${k}" aria-pressed="${(L.brand_pos || "tr") === k}" aria-label="${l}" title="${l}"><i></i></button>`).join("")}</div>
      </div>
      <div class="ed-card"><b>Motion</b>
        <div class="ed-chips">${BRAND_ANIMS.map(([k, l]) => `<button data-ed="brandanim" data-v="${k}" aria-pressed="${(L.brand_anim || "float") === k}">${l}</button>`).join("")}</div>
        <p class="ed-help">${{none: "Stays in one place.", float: "Bobs gently up and down.", slide: "Slides in from its side at the start.", drift: "Glides from one side to the other and back, so it's never in one fixed spot.", fade: "Fades in at the start."}[L.brand_anim || "float"]}</p>
      </div>
      <div class="ed-card"><b>Size and look</b>
        ${slider("Size", "brand_size", 40, 200, 2, L.brand_size || 84, L.brand_size || 84)}
        ${slider("Opacity", "brand_op", 20, 100, 5, L.brand_op ?? 90, (L.brand_op ?? 90) + "%")}
      </div>`;
  } else if (E.tab === "media") {
    p.innerHTML = head("Media", "Your pictures on the video, and an outro after it. Upload once, use on any clip.") + picsCard() + outroCard();
  } else if (E.tab === "fx") {
    const L = E.look, cover = `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`;
    const fade = (k, label, opts) => `<p class="ed-grp">${label}</p><div class="ed-fx three">${opts.map(([v, l]) =>
      `<button class="ed-fxt ${(L[k] || "none") === v ? "on" : ""}" data-ed="fade" data-k="${k}" data-v="${v}">
        <span class="ed-fxi ${v === "none" ? "none" : ""}">${v === "none" ? svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>')
          : `<img src="${cover}" alt=""><i style="background:linear-gradient(${k === "fade_in" ? "90deg" : "270deg"},${v === "black" ? "#000" : "#fff"} 0%,transparent 70%)"></i>`}</span><b>${l}</b></button>`).join("")}</div>`;
    p.innerHTML = head("Effects", "Zoom moments, a colour look for the whole clip, and how it starts and ends.") + zoomCard() +
      `<p class="ed-grp">Colour look</p>
      <div class="ed-fx">${EFFECTS.map(([k, l, css]) => `<button class="ed-fxt ${(L.effect || "none") === k ? "on" : ""}" data-ed="effect" data-v="${k}">
        <span class="ed-fxi ${k === "none" ? "none" : ""}">${k === "none" ? svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>') : `<img src="${cover}" alt="" style="filter:${css}">`}</span><b>${l}</b></button>`).join("")}</div>
      ${fade("fade_in", "Start", [["none", "Cut in"], ["black", "From black"], ["white", "From white"]])}
      ${fade("fade_out", "End", [["none", "Cut out"], ["black", "To black"], ["white", "To white"]])}`;
  } else if (E.tab === "clean") {
    // Speech cleanup: what to look for, how much it finds, then one button to cut it all
    const f = findCuts(), cutS = f.all.reduce((n, [a, b]) => n + (b - a), 0);
    p.innerHTML = head("Speech cleanup", "Take out filler words and long pauses. What gets cut shows struck through in the transcript.") +
      `<div class="ed-card ed-clean2">
        <label class="ed-ck"><input type="checkbox" data-cl="fill" ${E.cl.fill ? "checked" : ""}><span>Filler words <small>um, uh, hmm</small></span><b>${f.fill.length}</b></label>
        <label class="ed-ck"><input type="checkbox" data-cl="pause" ${E.cl.pause ? "checked" : ""}><span>Pauses over
          <select data-cl="min">${[0.5, 0.8, 1, 1.5, 2].map(v => `<option value="${v}" ${E.cl.min === v ? "selected" : ""}>${v} s</option>`).join("")}</select></span><b>${f.pause.length}</b></label>
      </div>
      ${f.all.length ? `<div class="ed-card ed-cres">
          <div class="ed-cnum"><b>${cutS.toFixed(1)} s</b><span>in ${f.all.length} place${f.all.length === 1 ? "" : "s"}</span></div>
          <div class="ed-cbar2"><i style="width:${Math.max(2, Math.min(100, (keptLen() - cutS) / Math.max(0.1, keptLen()) * 100))}%"></i></div>
          <p class="ed-help">The clip goes from ${ts(keptLen())} to ${ts(Math.max(0, keptLen() - cutS))}. Each cut shows struck through in the transcript.</p>
          <button class="ed-btn primary ed-cgo" data-ed="cleanapply">${svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>')}Cut ${f.all.length} place${f.all.length === 1 ? "" : "s"}</button></div>`
        : `<div class="ed-card ed-cempty"><span class="ed-cok">${svg('<path d="M5 12l5 5L20 7"/>')}</span>
          <div><b>${!E.words.length ? "No speech in this clip" : !E.cl.fill && !E.cl.pause ? "Nothing chosen" : "Nothing to clean up"}</b>
          <p class="ed-help">${!E.words.length ? "No words were heard, so there are no fillers or pauses to take out."
            : !E.cl.fill && !E.cl.pause ? "Tick filler words or pauses above to look for them."
            : `No ${[E.cl.fill && "filler words", E.cl.pause && `pauses over ${E.cl.min} s`].filter(Boolean).join(" or ")} in this clip. It's ${ts(keptLen())}.`}</p></div></div>`}
      ${E.cuts?.length ? `<div class="ed-card ed-cdone"><span>Already cut <b>${ts(cutLen())}</b></span><button class="ed-btn sm ghost" data-ed="cleanundo">Undo all</button></div>` : ""}
      <p class="ed-help ed-cfoot">Cuts can be undone any time before you render.</p>`;
  } else if (E.tab === "trim") {
    p.innerHTML = head("Trim", "Set where the clip starts and ends here, or drag the yellow edges on the timeline.") +
      `<div class="ed-card ed-trim2">
        <div class="ed-tlen"><span>Clip length</span><b>${ts(E.end - E.start)}</b></div>
        <div class="ed-trange" aria-hidden="true"><i style="left:${(E.start - E.min) / Math.max(0.1, E.max - E.min) * 100}%;width:${(E.end - E.start) / Math.max(0.1, E.max - E.min) * 100}%"></i></div>
        <div class="ed-trange-l"><span>0:00</span><span>${ts(E.max - E.min)} saved</span></div>
        ${[["start", "Start"], ["end", "End"]].map(([k, l]) => `<div class="ed-trow">
          <span class="ed-tl">${l}</span><b>${ts(E[k] - E.min)}</b>
          <span class="ed-step" role="group" aria-label="${l}"><button data-ed="nudge" data-k="${k}" data-d="-0.5" aria-label="${l} half a second earlier" title="Half a second earlier">−0.5</button><button data-ed="nudge" data-k="${k}" data-d="0.5" aria-label="${l} half a second later" title="Half a second later">+0.5</button></span>
          <button class="ed-ib sm ed-tip ed-tph" data-ed="toplayhead" data-k="${k}" aria-label="${l} at the playhead" data-tip="${l} at the playhead">${svg('<path d="M12 3v18M7 3h10l-5 5z"/>')}</button></div>`).join("")}
      </div>
      <p class="ed-help ed-cfoot">3 seconds to 3 minutes. Or drag the yellow edges on the timeline.</p>`;
  } else {
    const c = clipNow();
    p.innerHTML = head("Post", "The words that go with the clip, and where it goes.") +
      `<div class="ed-card">
        <label class="ed-f">Title<input id="edTitle" value="${esc(E.title)}" maxlength="100"></label>
        <label class="ed-f">Description<textarea id="edDesc" rows="5" maxlength="2000">${esc(E.description)}</textarea></label>
        <button class="ed-btn" data-act="copy" data-j="${E.jid}" data-c="${esc(E.cid)}">${ic("copy")}Copy post text</button></div>
      <div class="ed-card"><b>Post it</b><div class="ed-posts">${postPills(c) || ""}</div>
        ${S.accounts.length ? `<div class="ed-accs">${S.accounts.map(a => `<label class="ed-acc"><input type="checkbox" data-pacc value="${esc(a.id)}"><span>${esc(a.label)} · ${esc(a.name)}</span></label>`).join("")}</div>
          <div class="ed-row"><button class="ed-btn primary" data-act="postnow">${ic("send")}Post now</button><button class="ed-btn" data-act="postqueue">Add to queue</button></div>
          <p class="ed-help">Posts the last saved version. Save first if you changed anything.</p>`
          : `<p class="ed-help">No accounts connected yet. Connect YouTube, Instagram, TikTok or X in Settings.</p>`}</div>`;
  }
}

/* ---------- the preview */
function drawStage() {
  const st = $e("#edStage"), c = clipNow(); if (!st || !c) return;
  const g = geo(E.layout, E.sw, E.sh);
  const busy = c.status === "queued" || c.status === "rendering";
  // each icon is the phone and what fills it, so the five read apart at a glance
  const LAY = {blur: ["Centered: the whole video, a blurred copy behind it", LAY_IC.blur],
               zoom: ["Zoomed in: closer, blurred above and below", LAY_IC.zoom],
               crop: ["Solo: one part fills the screen", LAY_IC.crop],
               split: ["Face cam split: the stream on top, the face cam below", LAY_IC.split],
               card: ["Post card: the clip inside a social post", LAY_IC.card]};
  const LAY_SHORT = {blur: "Centered", zoom: "Zoomed in", crop: "Solo", split: "Face cam split", card: "Post card"};
  const split = g.layout === "split", sp = splitOf();
  const band = (id, vidId, muted) => `<div class="ed-band" id="${id}"><video class="ed-bv" id="${vidId}" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto" ${muted ? "muted" : ""}></video></div>`;
  const asp = E.look.aspect || "9:16";
  const ASP = [["9:16", "Vertical", "Shorts, Reels, TikTok"], ["4:5", "Portrait", "Instagram and Facebook feed"],
    ["1:1", "Square", "Feeds and ads"], ["16:9", "Wide", "YouTube, X, LinkedIn"]];
  const aspIc = a => { const [w, h] = ASPECTS[a], s = 16 / Math.max(w, h); return svg(`<rect x="${12 - w * s / 2}" y="${12 - h * s / 2}" width="${w * s}" height="${h * s}" rx="2"/>`); };
  const frameLbl = {crop: `Fills the ${asp} frame`, blur: "Shown part", zoom: "Shown part", card: "Shown in the post"}[E.layout] || "Shown part";
  st.innerHTML = (E.view === "frame" ? `<div class="ed-fwrap"><div class="ed-fview" id="edFview" style="aspect-ratio:${E.sw || 16}/${E.sh || 9}">
        <video class="ed-fvid" id="edVid" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto"></video>
        ${split ? `<div class="ed-rg game" data-rg="game"><span>${sp.cam_at === "top" ? "Bottom" : "Top"} part</span><i class="rz"></i></div>
          <div class="ed-rg cam" data-rg="cam"><span>${sp.cam_at === "top" ? "Top" : "Bottom"} part</span><i class="rz"></i></div>`
          : `<div class="ed-rg frame" data-rg="frame"><span>${esc(frameLbl)}</span><i class="rz"></i></div>`}</div>
      <div class="ed-fpre" role="group" aria-label="Layout">${Object.entries(LAY).map(([k, [l, d]]) =>
        `<button data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}">${svg(d)}<span>${esc(LAY_SHORT[k])}</span></button>`).join("")}
        <span class="grow"></span><button class="ed-link" data-ed="framereset">Reset</button></div>
      <p class="ed-fhelp">${split ? "Drag the boxes onto the stream and onto the face cam. Drag a corner to resize." : "Drag the box to choose what shows. Drag its corner to zoom in or out."}</p></div>`
    : `<div class="ed-phone" id="edPhone" style="--aw:${OUT_W};--ah:${OUT_H}">
      ${E.view === "live" ? `${split
        ? (sp.cam_at === "bottom" ? band("edBandG", "edVid", false) + band("edBandC", "edVid2", true) : band("edBandC", "edVid2", true) + band("edBandG", "edVid", false))
        : `${g.layout === "card" ? `<div class="ed-post" id="edPost"></div>` : `<img class="ed-bg ${g.layout === "crop" ? "none" : ""}" src="/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}" alt="">`}
        <div class="ed-band ed-fgb" id="edFgBox"><video class="ed-bv" id="edVid" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto"></video></div>`}
        <div class="ed-zgrain" id="edZgrain" hidden></div><span class="ed-zbadge" id="edZbadge" hidden></span><div class="ed-pics" id="edPics"></div><i class="ed-zdot" id="edZdot" hidden></i><div class="ed-outro" id="edOutro" hidden></div>
        <button class="ed-hook" id="edHookBox" data-ed="tab" data-t="text" title="Edit the hook"></button>
        <button class="ed-brand" id="edBrand" data-ed="tab" data-t="brand" title="Edit your brand" hidden></button>
        <div class="ed-cap" id="edCap" title="Drag to move the captions · double-click to change how they look"></div><div class="ed-fade" id="edFade"></div>
        <i class="ed-guide v" id="edGuideV"></i><i class="ed-guide h" id="edGuideH"></i>`
      : `<video class="ed-done" id="edVid" src="/media/${E.jid}/${esc(c.file)}?v=${c.version}" playsinline preload="auto"></video>`}
      <div class="ed-scan" id="edScan" aria-hidden="true" ${busy && E.view === "live" ? "" : "hidden"}><i></i></div>
      <div class="ed-making ${E.view === "live" ? "badge" : ""}" id="edMaking" ${busy ? "" : "hidden"}><i></i>Making your clip…</div>
      <div class="ed-fsbar" aria-label="Playback">
        <button class="ed-pbtn" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
        <span class="ed-fstime"><b id="edNowF">${ts(Math.max(0, nowT() - E.start))}</b> / ${ts(keptLen())}</span><span class="grow"></span>
        <button class="ed-ib" data-ed="fs" aria-label="Leave full screen" title="Leave full screen (Esc)">${svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>')}</button></div>
    </div>`) + `
    <div class="ed-mplay"><span class="ed-now" id="edNowM">${ts(Math.max(0, nowT() - E.start))}</span>
      <button class="ed-pbtn" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
      <span class="ed-dur" id="edDurM">${ts(keptLen())}</span></div>
    <div class="ed-bar">
      <button class="ed-bar-lbl ed-tpbtn ed-tip" data-ed="tpl" aria-label="Templates" data-tip="Ready-made layouts and looks">${svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')}Templates</button>
      <div class="ed-asp"><button class="ed-bar-lbl ed-aspbtn ed-tip" data-ed="aspmenu" aria-haspopup="menu" aria-label="Shape of the video: ${asp}" data-tip="Shape of the video">${aspIc(asp)}${asp}${svg('<path d="M7 10l5 5l5-5"/>')}</button>
        <div class="ed-aspop" id="edAsp" role="menu" hidden>${ASP.map(([k, l, u]) => `<button role="menuitemradio" data-ed="aspect" data-v="${k}" aria-checked="${asp === k}">
          ${aspIc(k)}<span><b>${l} <em>${k}</em></b><small>${u}</small></span>${asp === k ? ic("check") : ""}</button>`).join("")}</div></div>
      <button class="ed-lay ed-tip" data-ed="fs" aria-label="Full screen" data-tip="Full screen (Esc to leave)">${svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
      <span class="ed-bar-sep"></span>
      ${Object.entries(LAY).map(([k, [l, d]]) => `<button class="ed-lay ed-tip" data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}" aria-label="${l}" data-tip="${l}">${svg(d)}</button>`).join("")}
      <span class="ed-bar-sep"></span>
      <div class="ed-vol"><button class="ed-lay ed-volbtn" data-ed="mute" aria-label="Sound on or off (M). Hover for the volume" aria-pressed="${!!E.muted}">${SOUND(!E.muted && (E.look.volume ?? 100) > 0)}</button></div>
    </div>`;
  $e("#edVolPop")?.remove();
  $e(".ed")?.insertAdjacentHTML("beforeend", `<div class="ed-volpop" id="edVolPop" role="group" aria-label="Volume of the clip, heard here and in the saved video">
    <output id="edVolOut">${E.look.volume ?? 100}%</output>
    <input type="range" min="0" max="200" step="5" value="${E.look.volume ?? 100}" data-look="volume" aria-label="Volume" aria-orientation="vertical" style="--p:${(E.look.volume ?? 100) / 2}%">
    <button class="ed-link" data-ed="vol100">100%</button></div>`);
  requestAnimationFrame(placeViews);
  const hv = $e("#edViews"); if (hv) hv.innerHTML = `<button class="ed-tip" data-ed="view" data-v="live" aria-pressed="${E.view === "live"}" aria-label="Live preview" data-tip="Live preview"><i class="ed-livedot" aria-hidden="true"></i><span>Live</span></button>
        <button class="ed-tip" data-ed="view" data-v="frame" aria-pressed="${E.view === "frame"}" aria-label="Frame" data-tip="Choose the part of the video shown">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}<span>Frame</span></button>
        <button class="ed-tip" data-ed="view" data-v="rendered" aria-pressed="${E.view === "rendered"}" ${c.file ? "" : "disabled"} aria-label="Saved clip" data-tip="${c.file ? "The saved video file" : "Not saved yet"}">${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>')}<span>Saved</span></button>`;
  $e(".ed")?.classList.toggle("framing", E.view === "frame");      // framing: the side panel steps aside for the picture
  const v = $e("#edVid");
  v.playbackRate = E.rate; v.muted = !!E.muted; applyVolume();
  v.addEventListener("loadedmetadata", () => { if (E.view !== "rendered") v.currentTime = Math.max(0, E.start - E.off); v.playbackRate = E.rate;
    if (E.view === "frame") placeRegions(); });
  v.addEventListener("error", () => {
    if (E.view === "rendered") return;
    const cs = clipNow()?.status, coming = cs === "queued" || cs === "rendering";
    if (coming) E.srcWait = cs;         // a clip from a live stream: its footage is still being saved; shown when it is
    st.querySelector(".ed-phone, .ed-fview")?.insertAdjacentHTML("beforeend", coming
      ? `<div class="ed-making"><i></i>Getting this moment from the stream…</div>`
      : `<div class="ed-making">The original footage for this clip isn't here any more. Use “Saved”.</div>`);
  });
  if (E.view === "frame") placeRegions();
  E.fgKey = "";
  v.addEventListener("click", togglePlay);
  v.addEventListener("seeked", () => paintOverlay());      // also when animation frames are paused (a background tab)
  // a clean still of the footage (no captions or hook burned in) for the caption style tiles, taken once per clip
  v.addEventListener("loadeddata", () => { if (!E.shot && E.view === "live") grabShot(v.currentSrc || v.src); }, {once: true});
  E.lastKey = ""; E.shownPaused = null; E.fxShown = null; paintOverlay(); loop();
}
// effects in the preview: the colour look as a CSS filter on the footage, the start and end fades as a coloured layer
function paintFx(t, phone) {
  const L = E.look;
  // "none" would break the background's blur filter, so no effect is a filter that changes nothing
  if (E.fxShown !== L.effect) { E.fxShown = L.effect; E.zKey = ""; phone.style.setProperty("--fx", fxCss(L.effect) || "contrast(1)"); }   // a zoom's look is laid on again after
  const f = $e("#edFade"); if (!f) return;
  const into = t - E.start, left = E.end - t;
  let col = "", op = 0;
  if ((L.fade_in || "none") !== "none" && into < FADE_S) { col = L.fade_in; op = 1 - Math.max(0, into) / FADE_S; }
  else if ((L.fade_out || "none") !== "none" && left < FADE_S) { col = L.fade_out; op = 1 - Math.max(0, left) / FADE_S; }
  const v = `${col}|${op.toFixed(2)}`;
  if (v === E.fadeShown) return;
  E.fadeShown = v;
  f.style.background = col === "white" ? "#fff" : "#000";
  f.style.opacity = op.toFixed(2);
}
const vid = () => $e("#edVid");
const nowT = () => { const v = vid(); if (!v) return E.start; return E.view !== "rendered" ? E.off + v.currentTime : E.start + v.currentTime; };
function seek(t) {
  const v = vid(); if (!v) return;
  t = Math.max(E.min, Math.min(E.max, t));
  v.currentTime = E.view !== "rendered" ? t - E.off : Math.max(0, Math.min(t, E.end) - E.start);
}
function togglePlay() {
  const v = vid(); if (!v) return;
  if (v.paused) { audioFor(v); AC?.resume?.(); applyVolume(); }
  if (v.paused) { if (E.view !== "rendered" && (nowT() >= E.end - 0.05 || nowT() < E.start - 0.2)) seek(E.start); v.play().catch(() => {}); } else v.pause();
}
// one light loop while the editor is open: it only touches what changed since the last frame
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!$("#clipdlg").open || !vid()) return;
    const v = vid(), t = nowT();
    if (E.view !== "rendered" && !v.paused && t >= E.end) { v.pause(); if (outroOf().on) playOutro(true); else seek(E.start); }
    else if (E.view !== "rendered" && !v.paused && E.cuts?.length) {          // playing over a cut part: jump past it
      const c = E.cuts.find(([a, b]) => t >= a && t < b - 0.03); if (c) seek(c[1]);
    }
    paintOverlay(t);
    syncMusic(t, v);
    const ph = $e("#edHead"); if (ph) ph.style.left = pct(t) + "%";
    const now = ts(Math.max(0, t - E.start));
    if (now !== E.shownNow) { E.shownNow = now; const tl = $e("#edNow"); if (tl) tl.textContent = now;
      const tm = $e("#edNowM"); if (tm) tm.textContent = now;      // the phone's play row under the video
      const tf = $e("#edNowF"); if (tf) tf.textContent = now;      // the bar shown in full screen
      const tb = $e("#edNow2"); if (tb) tb.textContent = clock(t - E.start, true); }
    if (v.paused !== E.shownPaused) { E.shownPaused = v.paused; $$e("[data-ed=play]").forEach(pb => { pb.innerHTML = ic(v.paused ? "play" : "pause"); }); }
    if (!v.paused && E.zoom > 1) follow(t);
    if (!v.paused || E.mL > 0 || E.mR > 0) paintMeter(v);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function follow(t) {             // when zoomed in, keep the playhead in sight while it plays
  const sc = $e("#edScroll"); if (!sc) return;
  const x = pct(t) / 100 * sc.scrollWidth;
  if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = x - sc.clientWidth / 3;
}
/* ---------- export settings: the saved clip made again as MP4 or GIF, at a frame rate, quality and speed.
   A preset per platform picks good settings in one click. The server does the work (/api/.../export). */
const EX_PRESETS = [["reels", "Instagram Reels", "instagram", {fmt: "mp4", fps: 30, q: "high", speed: 1}],
  ["shorts", "YouTube Shorts", "youtube", {fmt: "mp4", fps: 30, q: "ultra", speed: 1}],
  ["tiktok", "TikTok", "tiktok", {fmt: "mp4", fps: 30, q: "high", speed: 1}],
  ["x", "X", "x", {fmt: "mp4", fps: 30, q: "medium", speed: 1}]];
const EX_MBPS = {web: 1.0, medium: 1.5, high: 2.1, ultra: 3.2};       // about what each quality comes to (measured), for the estimate
function exSizeMB() {
  const x = E.ex, secs = keptLen() / x.speed;
  if (x.fmt === "gif") return Math.max(0.5, Math.min(secs, 20) * 0.55 * Math.min(x.fps, 15) / 15);
  return Math.max(0.3, secs * (EX_MBPS[x.q] * (x.fps === 60 ? 1.35 : x.fps === 24 ? 0.85 : 1) + 0.16) / 8);
}
function drawEx() {
  if (!E.exOpen) return $e("#edEx")?.remove();
  if (E.exBusy && $e("#edEx")) return;          // exporting: leave the button's progress alone
  const c = clipNow(), x = E.ex, ready = c?.status === "done";
  const seg = (k, opts) => `<div class="ed-ex-seg">${opts.map(([v, l]) => `<button data-ed="exset" data-k="${k}" data-v="${v}" aria-pressed="${String(x[k]) === String(v)}">${l}</button>`).join("")}</div>`;
  const mark = k => (typeof APP_MARK !== "undefined" && APP_MARK[k]) || "";
  const inner = E.exDone ? exDoneHtml() : `<header><h3>Export settings</h3><button class="ed-ib" data-ed="exclose" aria-label="Close">${ic("x")}</button></header>
    <p class="ed-ex-size">Estimated size about <b>${exSizeMB() < 10 ? exSizeMB().toFixed(1) : Math.round(exSizeMB())} MB</b> · ${ts(keptLen() / x.speed)}</p>
    <div class="ed-ex-grp"><span>Made for</span><div class="ed-ex-plats">${EX_PRESETS.map(([k, l, m]) =>
      `<button data-ed="expreset" data-v="${k}" aria-pressed="${x.preset === k}"><i>${mark(m)}</i>${l}</button>`).join("")}</div></div>
    <div class="ed-ex-row"><div class="ed-ex-grp"><span>Format</span>${seg("fmt", [["mp4", "MP4"], ["gif", "GIF"]])}</div>
      <div class="ed-ex-grp"><span>Frame rate</span>${seg("fps", [[24, "24"], [30, "30"], [60, "60 fps"]])}</div></div>
    ${x.fmt === "gif" ? `<p class="ed-ex-note">GIFs have no sound, are 480 px wide and keep the first 20 seconds.</p>`
      : `<div class="ed-ex-grp"><span>Quality</span>${seg("q", [["web", "Web"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"]])}</div>`}
    <div class="ed-ex-grp"><span>Speed</span>${seg("speed", [[1, "Normal"], [1.25, "1.25×"], [1.5, "1.5×"], [2, "2×"]])}</div>
    ${ready && !c?.unrendered && !dirty() ? "" : `<p class="ed-ex-note">Your latest edits aren't in the video yet. Export renders them first, so you get exactly what the preview shows.</p>`}
    <button class="ed-ex-go pfx" data-ed="exgo" ${!E.exBusy && c?.status !== "rendering" && c?.status !== "queued" ? "" : "disabled"}><i class="pf-fill"></i><span class="pf-l">Confirm and export</span>${ic("arrowr")}</button>
    <div class="ed-ex-cap"><span>Captions</span><button data-ed="srt">${ic("down")}Download .srt</button><button data-ed="importsrt">${ic("up")}Import .srt</button></div>`;
  // already open: change only what is inside, so the popup doesn't flash or replay its opening
  const box = $e("#edEx .ed-ex");
  if (box) { box.innerHTML = inner; return; }
  const el = document.createElement("div");
  el.id = "edEx"; el.className = "ed-exw";
  el.innerHTML = `<div class="ed-ex" role="dialog" aria-label="Export settings">${inner}</div>`;
  $e(".ed").append(el);
}
async function exGo() {
  const c = clipNow(), x = E.ex; if (!c || E.exBusy) return;
  // the button itself shows the export: "Exporting" with a soft fill, then "Downloaded"; the popup isn't redrawn meanwhile
  const btn = $e("#edEx .ed-ex-go");
  E.exBusy = true;
  let ok = false;
  try {
    // the export is the clip exactly as edited here: changes not in the video yet are rendered first
    if (dirty() || c.unrendered || c.status !== "done") {
      if (btn) { btn.disabled = true; pfStart(btn, "Rendering your edits", Math.max(8, keptLen() * 0.6)); }
      await renderNow();
      if (btn) { clearInterval(btn._pf); btn._pf = 0; }          // the same button carries on with the export
    }
    if (btn) { btn.disabled = true; pfStart(btn, "Exporting", x.fmt === "gif" ? 8 : Math.max(5, keptLen() * 0.25 / x.speed)); }
    const q = new URLSearchParams({fmt: x.fmt, fps: x.fps, q: x.q, speed: x.speed});
    const r = await fetch(`/api/jobs/${E.jid}/clips/${E.cid}/export?${q}`);
    if (!r.ok) { let m = "The export didn't work."; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
    const blob = await r.blob();
    const name = (c.title || c.hook || "clip").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + "." + x.fmt;
    exDoneClear();
    // the finished file stays in the page while the window is open: it plays below, and can be saved again
    E.exDone = {url: URL.createObjectURL(blob), name, size: blob.size, fmt: x.fmt, fps: x.fmt === "gif" ? Math.min(x.fps, 15) : x.fps,
      q: x.q, speed: x.speed, secs: x.fmt === "gif" ? Math.min(20, keptLen() / x.speed) : keptLen() / x.speed};
    exSave();
    ok = true;
  } catch (er) { toast(er.message, "bad"); }
  if (btn) pfStop(btn, ok ? "Downloaded" : "Confirm and export", "Confirm and export");
  // finished: the full button and "Downloaded" stay a moment, then the window shows the finished file; a failure keeps the settings
  setTimeout(() => { E.exBusy = false; drawEx(); }, ok ? 900 : 300);
}
function exSave() {                     // the browser's download of the finished file
  const d = E.exDone; if (!d) return;
  const a = document.createElement("a"); a.href = d.url; a.download = d.name;
  document.body.append(a); a.click(); a.remove();
}
function exDoneClear() { if (E.exDone) { URL.revokeObjectURL(E.exDone.url); E.exDone = null; } }
// the finished export: the file playing, what it is, and what to do next
function exDoneHtml() {
  const d = E.exDone, gif = d.fmt === "gif", [w, h] = gif ? [480, Math.round(480 * OUT_H / OUT_W)] : [OUT_W, OUT_H];
  const mb = d.size / 1e6, Q = {web: "Web", medium: "Medium", high: "High", ultra: "Ultra"};
  return `<header><h3>Your export is ready</h3><button class="ed-ib" data-ed="exclose" aria-label="Close">${ic("x")}</button></header>
    <div class="ed-exdone">
      <div class="ed-expv" style="aspect-ratio:${w}/${h}">${gif ? `<img src="${d.url}" alt="The exported GIF">`
        : `<video src="${d.url}" controls autoplay muted loop playsinline></video>`}</div>
      <div class="ed-exinfo">
        <p class="ed-exok">${ic("check")}Saved to your downloads</p>
        <b title="${esc(d.name)}">${esc(d.name)}</b>
        <dl><dt>Format</dt><dd>${gif ? "GIF, no sound" : "MP4"}</dd><dt>Size</dt><dd>${w} × ${h}</dd>
          <dt>Frame rate</dt><dd>${d.fps} fps</dd>${gif ? "" : `<dt>Quality</dt><dd>${Q[d.q] || d.q}</dd>`}
          <dt>Length</dt><dd>${ts(d.secs)}${d.speed !== 1 ? ` · ${d.speed}× speed` : ""}</dd><dt>File</dt><dd>${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB</dd></dl>
        <div class="ed-exacts"><button class="ed-btn" data-ed="exagain">${ic("down")}Download again</button>
          <button class="ed-btn ghost" data-ed="exnew">Export another way</button></div>
      </div></div>`;
}
/* ---------- what is behind the video in Blurred fill and Zoomed, the room around it, and its corners */
function bgCard() {
  const b = bgOf(), pad = E.look.pad || 0, vr = E.look.vradius || 0;
  const col = (k, label) => `<label class="ed-f ed-colf">${label}<span class="ed-swc" style="background:${b[k]}"><input type="color" value="${b[k]}" data-bg="${k}" aria-label="${label}"></span></label>`;
  return `<div class="ed-card"><b>Background</b>
    <div class="ed-seg">${[["blur", "Blurred video"], ["color", "Colour"], ["gradient", "Gradient"]].map(([v, l]) =>
      `<button data-ed="bgkind" data-v="${v}" aria-pressed="${b.kind === v}">${l}</button>`).join("")}</div>
    ${b.kind === "blur" ? "" : `<div class="ed-row">${col("c1", b.kind === "gradient" ? "Top" : "Colour")}${b.kind === "gradient" ? col("c2", "Bottom") : ""}</div>`}
    ${slider("Space around the video", "pad", 0, 140, 4, pad, pad)}
    ${slider("Video corners", "vradius", 0, 60, 2, vr, vr)}</div>`;
}
/* ---------- pictures on the video (Media > Pictures): from the media library, placed by dragging on the preview,
   timed on the timeline's Pictures row. render.py draws them the same way: the middle at x/y % of the frame,
   w % of the frame's width, shown from a to b (seconds of the video). */
const PIC_IC = svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5L6 20"/>');
const mediaUrl = id => `/api/media/${id}`;
async function mediaAdd(file, forWhat) {
  if (!file) return;
  if (file.size > 60e6) return toast("That file is too big. Use one under 60 MB.", "bad");
  const fd = new FormData(); fd.append("file", file);
  E.medBusy = true; drawPanel();
  try {
    const r = await api("/api/media", {method: "POST", body: fd});
    E.media = r.items;
    const it = r.items.find(x => x.id === r.id);
    if (forWhat === "outro") { E.look.outro = {...outroOf(), on: true, kind: it?.kind === "video" ? "file" : outroOf().kind, ...(it?.kind === "video" ? {file: r.id} : {pic: r.id})}; E.lookTouched = true; }
    else if (it?.kind === "image") picAdd(r.id);
    toast("Added to your library", "ok");
  } catch (er) { toast(er.message, "bad"); }
  E.medBusy = false; drawPanel(); after("");
}
function picAdd(id) {
  const m = (E.media || []).find(x => x.id === id); if (!m || m.kind !== "image") return;
  const L = E.look.overlays || [];
  if (E.picSwap != null && L[E.picSwap]) {          // replacing: the new picture keeps the old one's place, size and time
    L[E.picSwap].id = id; E.picSel = E.picSwap; E.picSwap = null; E.look.overlays = L; E.lookTouched = true;
    drawPanel(); drawTimeline(); E.picKey = ""; after(""); return toast("Picture replaced", "ok");
  }
  if (L.length >= 8) return toast("Up to 8 pictures on one clip.", "bad");
  L.push({id, x: 50, y: 30, w: 30, a: Math.round(E.start * 100) / 100, b: Math.round(E.end * 100) / 100, op: 100});
  E.look.overlays = L; E.picSel = L.length - 1; E.lookTouched = true;
  drawPanel(); drawTimeline(); E.picKey = ""; after(""); toast("Drag it on the video to place it", "ok");
}
// a large upload card: click to pick a file, or drop one on it
function dropCard(id, accept, title, sub, busy) {
  return `<label class="ed-drop${busy ? " busy" : ""}"><input type="file" accept="${accept}" id="${id}" hidden ${busy ? "disabled" : ""}>
    <span class="ed-dropic">${ic("up")}</span><span class="ed-dropt"><b>${title}</b><small>${sub}</small></span></label>`;
}
dlg_on("dragover", e => {
  const z = e.target.closest?.(".ed-drop"); if (!z) return;
  e.preventDefault(); z.classList.add("over");
});
dlg_on("dragleave", e => { const z = e.target.closest?.(".ed-drop"); if (z && !z.contains(e.relatedTarget)) z.classList.remove("over"); });
dlg_on("drop", e => {
  const z = e.target.closest?.(".ed-drop"); if (!z) return;
  e.preventDefault(); z.classList.remove("over");
  const f = e.dataTransfer?.files?.[0], el = z.querySelector("input"); if (!f || !el || el.disabled) return;
  try { const dt = new DataTransfer(); dt.items.add(f); el.files = dt.files; el.dispatchEvent(new Event("change", {bubbles: true})); }
  catch { if (el.id === "edMusIn") musicAdd(f); else mediaAdd(f, el.dataset.for || ""); }
});
function picsCard() {
  const lib = (E.media || []).filter(m => m.kind === "image"), on = E.look.overlays || [], sel = on[E.picSel];
  const nameOf = id => (E.media || []).find(m => m.id === id)?.name || "Picture";
  return `<div class="ed-card"><div class="ed-h"><b>Pictures on the video</b></div>
    ${dropCard("edMedIn", "image/png,image/jpeg,image/webp", E.medBusy ? "Adding the picture…" : "Upload a picture", "Drop it here or browse · PNG, JPG or WebP", E.medBusy)}
    ${lib.length ? `<div class="ed-medgrid">${lib.map(m => `<button class="ed-med" data-ed="picadd" data-v="${m.id}" title="Put ${esc(m.name)} on the video">
        <img src="${mediaUrl(m.id)}" alt="" loading="lazy"><i class="ed-x" data-ed="medialdel" data-v="${m.id}" title="Remove from your library">${ic("x")}</i></button>`).join("")}</div>
      <p class="ed-help">Tap a picture to put it on the clip. Drag it on the video to move it, drag its corner to resize.</p>`
      : `<p class="ed-help">It stays in your library for every clip.</p>`}
    ${on.length ? `<p class="ed-grp">On this clip</p><div class="ed-piclist">${on.map((o, i) => `<div class="ed-picrow ${i === E.picSel ? "on" : ""} ${E.picSwap === i ? "swap" : ""}">
        <button class="ed-picpick" data-ed="picsel" data-v="${i}" aria-pressed="${i === E.picSel}"><img src="${mediaUrl(o.id)}" alt=""><span>${esc(nameOf(o.id))}</span><small>${ts(o.a - E.start)}–${ts(o.b - E.start)}</small></button>
        <button class="ed-ib sm ed-tip" data-ed="picswap" data-v="${i}" aria-label="Replace this picture" data-tip="Replace">${svg('<path d="M4 9h13l-3-3M20 15H7l3 3"/>')}</button>
        <button class="ed-ib sm ed-tip" data-ed="picdel" data-v="${i}" aria-label="Remove from the clip" data-tip="Remove">${svg('<path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')}</button></div>`).join("")}</div>
      ${E.picSwap != null && on[E.picSwap] ? `<p class="ed-note">Tap a picture above to put it in place of “${esc(nameOf(on[E.picSwap].id))}”. <button class="ed-link" data-ed="picswap" data-v="-1">Cancel</button></p>` : ""}` : ""}
    ${sel ? `<div class="ed-picset">
        <label class="ed-sl" style="--p:${pctOf(sel.w, 3, 100)}"><input type="range" min="3" max="100" step="1" value="${sel.w}" data-pic="w" aria-label="Size"><span class="ed-sl-l">Size</span><output>${sel.w}%</output></label>
        <label class="ed-sl" style="--p:${pctOf(sel.op, 10, 100)}"><input type="range" min="10" max="100" step="5" value="${sel.op}" data-pic="op" aria-label="Opacity"><span class="ed-sl-l">Opacity</span><output>${sel.op}%</output></label>
        <label class="ed-sl" style="--p:${pctOf(sel.a, E.start, E.end)}"><input type="range" min="${E.start}" max="${E.end}" step="0.1" value="${sel.a}" data-pic="a" aria-label="Shows from"><span class="ed-sl-l">From</span><output>${ts(sel.a - E.start)}</output></label>
        <label class="ed-sl" style="--p:${pctOf(sel.b, E.start, E.end)}"><input type="range" min="${E.start}" max="${E.end}" step="0.1" value="${sel.b}" data-pic="b" aria-label="Shows until"><span class="ed-sl-l">Until</span><output>${ts(sel.b - E.start)}</output></label>
        <div class="ed-row"><button class="ed-btn" data-ed="picfill" data-v="${E.picSel}">Whole clip</button><button class="ed-btn ghost" data-ed="picdel" data-v="${E.picSel}">${ic("x")}Remove</button></div></div>` : ""}
  </div>`;
}
// the pictures on the preview: one image each, shown while the playhead is inside its time; the chosen one is outlined
function paintPics(t, phone, k) {
  const box = $e("#edPics"); if (!box) return;
  const L = E.look.overlays || [];
  const key = JSON.stringify(L) + "|" + E.picSel + "|" + phone.clientWidth;
  if (E.picKey !== key) {
    E.picKey = key;
    box.innerHTML = L.map((o, i) => `<div class="ed-pic ${i === E.picSel ? "sel" : ""}" data-pi="${i}" style="left:${o.x}%;top:${o.y}%;width:${o.w}%;opacity:${o.op / 100}">
      <img src="${mediaUrl(o.id)}" alt="" draggable="false">${i === E.picSel ? `<i class="rz"></i>` : ""}</div>`).join("");
  }
  [...box.children].forEach((el, i) => { const o = L[i]; if (o) el.hidden = !(t >= o.a && t <= o.b); });
}
let picDrag = null;
dlg_on("pointerdown", e => {
  const el = e.target.closest(".ed-pic"); if (!el || E.view !== "live") return;
  e.preventDefault(); e.stopPropagation();
  const i = +el.dataset.pi, o = (E.look.overlays || [])[i]; if (!o) return;
  if (E.picSel !== i) { E.picSel = i; E.picKey = ""; if (E.tab === "media") drawPanel(); }
  const ph = $e("#edPhone").getBoundingClientRect();
  picDrag = {i, resize: !!e.target.closest(".rz"), sx: e.clientX, sy: e.clientY, x0: o.x, y0: o.y, w0: o.w, pw: ph.width, ph: ph.height, moved: false};
  el.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = picDrag; if (!d) return;
  const o = (E.look.overlays || [])[d.i]; if (!o) return;
  const dx = (e.clientX - d.sx) / d.pw * 100, dy = (e.clientY - d.sy) / d.ph * 100;
  if (Math.abs(dx) + Math.abs(dy) > 0.3) d.moved = true;
  if (d.resize) o.w = Math.round(Math.max(3, Math.min(100, d.w0 + dx * 2)) * 10) / 10;
  else { o.x = Math.round(Math.max(0, Math.min(100, d.x0 + dx)) * 10) / 10; o.y = Math.round(Math.max(0, Math.min(100, d.y0 + dy)) * 10) / 10; }
  E.picKey = ""; paintPics(nowT(), $e("#edPhone"), 1);
});
dlg_on("pointerup", () => {
  const d = picDrag; picDrag = null; if (!d) return;
  E.lookTouched = true; if (E.tab !== "media") { E.tab = "media"; } drawPanel(); after("");
});
// the timeline's Pictures row: a bar per picture, dragged to move it in time or by an end to change when it shows
function picsLane() {
  const L = E.look.overlays || []; if (!L.length) return "";
  return `<div class="ed-lane pics">${L.map((o, i) => `<button class="ed-picbar ${i === E.picSel ? "on" : ""}" data-pb="${i}" data-ed="picsel" data-v="${i}"
    style="left:${pct(o.a)}%;width:${Math.max(0.6, pct(o.b) - pct(o.a))}%"><i class="pe l"></i><img src="${mediaUrl(o.id)}" alt=""><i class="pe r"></i></button>`).join("")}</div>`;
}
let barDrag = null;
dlg_on("pointerdown", e => {
  const bar = e.target.closest(".ed-picbar"); if (!bar) return;
  const i = +bar.dataset.pb, o = (E.look.overlays || [])[i]; if (!o) return;
  const tr = $e("#edTrack").getBoundingClientRect();
  barDrag = {i, mode: e.target.closest(".pe.l") ? "a" : e.target.closest(".pe.r") ? "b" : "move", sx: e.clientX, a0: o.a, b0: o.b, k: (E.max - E.min) / tr.width, moved: false};
  bar.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = barDrag; if (!d) return;
  const o = (E.look.overlays || [])[d.i]; if (!o) return;
  const dt = (e.clientX - d.sx) * d.k; if (Math.abs(e.clientX - d.sx) > 3) d.moved = true; if (!d.moved) return;
  const r = v => Math.round(v * 10) / 10, len = d.b0 - d.a0;
  if (d.mode === "a") o.a = r(Math.max(E.start, Math.min(o.b - 0.2, d.a0 + dt)));
  else if (d.mode === "b") o.b = r(Math.min(E.end, Math.max(o.a + 0.2, d.b0 + dt)));
  else { o.a = r(Math.max(E.start, Math.min(E.end - len, d.a0 + dt))); o.b = r(o.a + len); }
  const bar = $e(`.ed-picbar[data-pb="${d.i}"]`); if (bar) { bar.style.left = pct(o.a) + "%"; bar.style.width = Math.max(0.6, pct(o.b) - pct(o.a)) + "%"; }
});
dlg_on("pointerup", () => {
  const d = barDrag; barDrag = null; if (!d || !d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; E.picKey = ""; paintOverlay(); if (E.tab === "media") drawPanel(); after("");
});

/* ---------- the outro (Media > Outro): a card or a file, a few seconds after the clip. The same card as
   render.outro_card, from the same numbers (outroGeo = render.outro_geometry). */
const OUTRO_BG = {black: "#0E0E10", white: "#FFFFFF", gray: "#2A2A2E"};
const outroOf = () => ({on: false, kind: "card", secs: 3, bg: OUTRO_BG.black, pic: "", pic_size: 270, pic_round: 0, title: "", sub: "", file: "", ...(E.look?.outro || {})});
function outroGeo(Wd, Hd, o, hasPic) {
  const u = Math.min(Wd, Hd * 9 / 16) / 1080, ps = hasPic ? Math.round(o.pic_size * u) : 0;
  const parts = [...(hasPic ? [ps] : []), ...(o.title ? [Math.round(64 * u)] : []), ...(o.sub ? [Math.round(44 * u)] : [])];
  const gp = Math.round(36 * u), gt = Math.round(10 * u);
  const total = parts.reduce((a, b) => a + b, 0) + (hasPic && (o.title || o.sub) ? gp : 0) + (o.title && o.sub ? gt : 0);
  let y = (Hd - total) / 2; const g = {u, ps, pic_y: Math.round(y)};
  y += ps + (hasPic && (o.title || o.sub) ? gp : 0); g.title_y = Math.round(y + 32 * u);
  y += o.title ? Math.round(64 * u) + (o.sub ? gt : 0) : 0; g.sub_y = Math.round(y + 22 * u);
  return g;
}
const inkFor = bg => { const n = parseInt(bg.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 150 ? ["#111114", "#55555C"] : ["#FFFFFF", "#A1A1AA"]; };
// the outro drawn at scale k (frame pixels to screen pixels)
function outroHtml(o, k) {
  if (o.kind === "file") {
    const m = (E.media || []).find(x => x.id === o.file);
    if (!m) return `<div class="ed-outro-c" style="background:#000"><span style="color:#888;font-size:12px">Pick or upload a file</span></div>`;
    return `<div class="ed-outro-c" style="background:#000">${m.kind === "video" ? `<video src="${mediaUrl(m.id)}" muted autoplay loop playsinline></video>` : `<img src="${mediaUrl(m.id)}" alt="">`}</div>`;
  }
  const picSrc = o.pic === "logo" ? (E.logoV ? `/api/brand/logo?v=${E.logoV}` : "") : o.pic ? mediaUrl(o.pic) : "";
  const g = outroGeo(OUT_W, OUT_H, o, !!picSrc), [ink, sub] = inkFor(o.bg || "#0E0E10"), u = g.u * k;
  return `<div class="ed-outro-c" style="background:${o.bg}">
    ${picSrc ? `<img class="op" src="${picSrc}" alt="" style="top:${g.pic_y * k}px;width:${g.ps * k}px;height:${g.ps * k}px;border-radius:${o.pic_round}%">` : ""}
    ${o.title ? `<b style="top:${g.title_y * k}px;font-size:${52 * u}px;color:${ink}">${esc(o.title)}</b>` : ""}
    ${o.sub ? `<span style="top:${g.sub_y * k}px;font-size:${34 * u}px;color:${sub}">${esc(o.sub)}</span>` : ""}</div>`;
}
// show the outro on the preview for its length; at the end of playback the clip then starts again
function playOutro(fromEnd) {
  const el = $e("#edOutro"), ph = $e("#edPhone"), o = outroOf(); if (!el || !ph || !o.on) { if (fromEnd) seek(E.start); return; }
  clearTimeout(E.outroT);
  el.innerHTML = outroHtml(o, ph.clientWidth / OUT_W); el.hidden = false; el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
  E.outroT = setTimeout(() => { el.hidden = true; if (fromEnd) seek(E.start); }, o.secs * 1000);
}
function outroCard() {
  const o = outroOf(), imgs = (E.media || []).filter(m => m.kind === "image"), all = E.media || [];
  const seg = (k, opts) => `<div class="ed-seg">${opts.map(([v, l]) => `<button data-ed="outroset" data-k="${k}" data-v="${v}" aria-pressed="${String(o[k]) === String(v)}">${l}</button>`).join("")}</div>`;
  const sl = (k, label, lo, hi, step, shown) => `<label class="ed-sl" style="--p:${pctOf(o[k], lo, hi)}"><input type="range" min="${lo}" max="${hi}" step="${step}" value="${o[k]}" data-outro="${k}" aria-label="${label}"><span class="ed-sl-l">${label}</span><output>${shown}</output></label>`;
  const picBtn = (v, inner, title) => `<button class="ed-med sm" data-ed="outroset" data-k="pic" data-v="${v}" aria-pressed="${o.pic === v}" title="${title}">${inner}</button>`;
  return `<div class="ed-card"><div class="ed-h"><b>Outro</b>${seg("on", [["0", "Off"], ["1", "On"]]).replace('class="ed-seg"', 'class="ed-seg sm"')}</div>
    ${o.on ? `${seg("kind", [["card", "Outro card"], ["file", "Your own file"]])}
      <div class="ed-outro-pv"><div class="ed-outro-ph" id="edOutroPv" style="aspect-ratio:${OUT_W}/${OUT_H}">${outroHtml(o, 0.16)}</div>
        <button class="ed-btn ghost sm" data-ed="outroplay">${ic("play")}Play outro</button></div>
      ${sl("secs", "Length", 1.5, 8, 0.5, o.secs + " s")}
      ${o.kind === "card" ? `
        <div class="ed-f">Canvas${seg("bg", [[OUTRO_BG.white, "White"], [OUTRO_BG.black, "Black"], [OUTRO_BG.gray, "Gray"]])}
          <label class="ed-f ed-colf" style="margin-top:6px">Your colour<span class="ed-swc" style="background:${o.bg}"><input type="color" data-outro="bg" value="${o.bg}" aria-label="Canvas colour"></span></label></div>
        <div class="ed-f">Picture<div class="ed-medgrid sm">${picBtn("", "None", "No picture")}${E.logoV ? picBtn("logo", `<img src="/api/brand/logo?v=${E.logoV}" alt="">`, "Your logo") : ""}
          ${imgs.map(m => picBtn(m.id, `<img src="${mediaUrl(m.id)}" alt="">`, esc(m.name))).join("")}
          <label class="ed-med sm add" title="Upload a picture">${ic("up")}<input type="file" accept="image/png,image/jpeg,image/webp" id="edMedIn" data-for="outro" hidden></label></div></div>
        ${o.pic ? sl("pic_size", "Picture size", 60, 600, 10, o.pic_size) + sl("pic_round", "Roundness", 0, 50, 1, o.pic_round + "%") : ""}
        <label class="ed-f">Title<input class="ed-text" data-outro="title" value="${esc(o.title)}" maxlength="60" placeholder="Made with SocialShot"></label>
        <label class="ed-f">Line under it<input class="ed-text" data-outro="sub" value="${esc(o.sub)}" maxlength="60" placeholder="Link in bio"></label>`
      : `<div class="ed-f">File<div class="ed-medgrid sm">${all.map(m => `<button class="ed-med sm" data-ed="outroset" data-k="file" data-v="${m.id}" aria-pressed="${o.file === m.id}" title="${esc(m.name)}">
            ${m.kind === "video" ? `<video src="${mediaUrl(m.id)}#t=0.5" muted preload="metadata"></video><em>${ts(m.dur || 0)}</em>` : `<img src="${mediaUrl(m.id)}" alt="">`}</button>`).join("")}
          <label class="ed-med sm add" title="Upload a picture or video">${ic("up")}<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" id="edMedIn" data-for="outro" hidden></label></div></div>
        <p class="ed-help">A picture or a short video (up to 30 s). It plays after the clip for the length set above.</p>`}` : `<p class="ed-help">A few seconds after the clip: your logo or a picture, a title and a line like "Link in bio", or your own video. The music rises into it.</p>`}
  </div>`;
}
// the Audio panel's rise into the outro
function riseCard(m, cur) {
  const o = outroOf(), total = (E.end - E.start) + (o.on ? o.secs : 0), at = m.peak_at != null && o.on ? Math.max(0, m.peak_at - Math.max(0, E.end - E.start - (m.off || 0))) : m.at;
  const loops = cur && cur.dur - at < total;
  return `<p class="ed-grp">Rise into the outro</p>
    ${o.on ? `${slider("Peak volume", "mus_peak", 0, 100, 5, m.peak, m.peak + "%")}
      ${slider("Rise time", "mus_rise", 0, 10, 0.5, m.rise, m.rise + " s")}
      <label class="ed-ck"><input type="checkbox" data-ed="musdrop" ${m.peak_at != null ? "checked" : ""}><span>Drop lands on the outro<small>Pick the moment in the song that should hit as the outro starts</small></span></label>
      ${m.peak_at != null ? slider("Drop at", "mus_drop", 0, Math.max(1, Math.floor(cur.dur)), 0.5, m.peak_at, mmss(m.peak_at)) : ""}
      <div class="ed-note ok">${ic("check")}Volume rises from ${m.vol}% to ${m.peak}% over ${m.rise} s, just as the outro starts</div>`
      : `<p class="ed-help">Turn on an outro in Media and the music rises into it.</p>`}
    ${loops ? `<div class="ed-note">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}The song is ${Math.round(total - (cur.dur - at))} s shorter than the clip${o.on ? " and outro" : ""}, so it loops</div>` : ""}
    <button class="ed-btn ghost sm" data-ed="musauto">Suggest levels</button>`;
}
/* ---------- Fluent 3D emoji in the hook. The list comes from the server (render draws the same pictures, from
   studio/emoji.py); each one is a picture, so it looks the same on every device and in the video. */
const EMOJI = () => S.status.emoji || [];
const emojiKey = ch => [...ch].filter(c => c.codePointAt(0) !== 0xFE0F).map(c => c.codePointAt(0).toString(16)).join("-");
const emojiImg = (k, alt) => `<img class="emj" src="/api/emoji/${k}.png" alt="${esc(alt)}" draggable="false">`;
let emjRe = null;
function emojiRe() {
  if (emjRe) return emjRe;
  const chars = EMOJI().flatMap(g => g[2].map(x => x[0])).sort((a, b) => b.length - a.length);
  const alts = [...chars, ...chars.filter(c => c.includes("️")).map(c => c.replace(/️/g, ""))];
  emjRe = alts.length ? new RegExp(alts.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu") : /$^/g;
  return emjRe;
}
// text with its emoji as pictures (already escaped text in, HTML out)
const withEmoji = text => esc(text).replace(emojiRe(), m => emojiImg(emojiKey(m), m));
function emojiPicker() {
  const groups = EMOJI(); if (!groups.length) return "";
  const cat = E.emjCat || groups[0][0], q = (E.emjQ || "").trim().toLowerCase();
  const items = q ? groups.flatMap(g => g[2]).filter(x => x[2].toLowerCase().includes(q)) : (groups.find(g => g[0] === cat) || groups[0])[2];
  return `<div class="ed-emj" role="dialog" aria-label="Emoji">
    <label class="ed-search">${ic("search")}<input id="edEmjQ" value="${esc(E.emjQ || "")}" placeholder="Search emoji" aria-label="Search emoji"></label>
    ${q ? "" : `<div class="ed-emjcats" role="tablist">${groups.map(g => `<button role="tab" data-ed="emjcat" data-v="${g[0]}" aria-selected="${g[0] === cat}" title="${g[1]}">${emojiImg(g[2][0][1], g[1])}</button>`).join("")}</div>`}
    <div class="ed-emjgrid">${items.length ? items.map(x => `<button data-ed="emjput" data-v="${x[0]}" title="${esc(x[2])}">${emojiImg(x[1], x[0])}</button>`).join("") : `<p class="ed-help">No emoji found</p>`}</div>
    <p class="ed-emjnote">Fluent 3D emoji by Microsoft</p></div>`;
}
const hookCase = (t, how) => how === "upper" ? t.toUpperCase() : how === "lower" ? t.toLowerCase()
  : how === "title" ? t.split(" ").map(w => /^\p{L}/u.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(" ") : t;
/* ---------- zoom moments (Effects > Zoom moments; the timeline's Zooms row). The video only (not captions, hook,
   pictures or brand) punches in on a point for a moment, easing in and out, with its own look. The same as
   render.zoom_filter: the point moves toward the middle of the frame and the window stays inside the picture. */
const ZOOM_IC = svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>');
const ZOOM_FX = [["none", "None", ""], ["bw", "B&W", "grayscale(1)"], ["warm", "Warm", "sepia(.16) saturate(1.18) hue-rotate(-6deg)"],
  ["cool", "Cool", "hue-rotate(10deg) saturate(.9) brightness(1.03)"], ["punch", "Punch", "contrast(1.22) saturate(1.4)"],
  ["vintage", "Vintage", "sepia(.4) contrast(.9) saturate(.85)"], ["grain", "Grain", "contrast(1.05)"]];
const ZOOM_EASE = 0.6;          // seconds to glide in and out (less on short zooms), on an S-curve; render.zoom_filter matches
// how far in, where and with which look at moment t
function zoomAt(t) {
  let z = 1, cur = null;
  for (const zm of E.look.zooms || []) {
    const e = Math.max(0.05, Math.min(ZOOM_EASE, (zm.b - zm.a) / 2)), p = Math.max(0, Math.min(1, (t - zm.a) / e, (zm.b - t) / e));
    const r = zm.ease === false ? (t >= zm.a && t <= zm.b ? 1 : 0) : p * p * (3 - 2 * p);
    z += (zm.s - 1) * r;
    if (t >= zm.a - 0.01 && t <= zm.b + 0.01) cur = zm;
  }
  return {z, x: cur ? cur.x / 100 : 0.5, y: cur ? cur.y / 100 : 0.5, fx: cur ? cur.fx || "none" : "none"};
}
function applyZoom(t, phone) {
  const Z = E.zoomOff ? {z: 1, x: .5, y: .5, fx: "none"} : zoomAt(t), W = phone.clientWidth, H = phone.clientHeight;
  const key = `${Z.z.toFixed(4)}|${Z.x}|${Z.y}|${Z.fx}|${W}|${H}|${E.layout}`;
  if (key !== E.zKey) {
    E.zKey = key;
    // the window's middle, kept half a window from each edge (render: max(0, min(iw-iw/zoom, x*iw-iw/zoom/2)))
    const cx = Math.max(1 / (2 * Z.z), Math.min(1 - 1 / (2 * Z.z), Z.x)) * W, cy = Math.max(1 / (2 * Z.z), Math.min(1 - 1 / (2 * Z.z), Z.y)) * H;
    [...phone.querySelectorAll(":scope > .ed-bg, :scope > .ed-post, :scope > .ed-fgb, :scope > .ed-band")].forEach(el => {
      if (Z.z <= 1.0001) { el.style.transform = ""; el.style.transformOrigin = ""; return; }
      const ox = el.offsetLeft, oy = el.offsetTop;
      el.style.transformOrigin = "0 0";
      el.style.transform = `translate(${(ox - cx) * Z.z + W / 2 - ox}px,${(oy - cy) * Z.z + H / 2 - oy}px) scale(${Z.z})`;
    });
    const look = (ZOOM_FX.find(f => f[0] === Z.fx) || ZOOM_FX[0])[2];
    phone.style.setProperty("--fx", [fxCss(E.look.effect) || "", look].join(" ").trim() || "contrast(1)");
    E.fxShown = E.look.effect;
    const gr = $e("#edZgrain"); if (gr) { gr.hidden = Z.fx !== "grain"; if (!gr.hidden && !gr.style.backgroundImage) gr.style.backgroundImage = `url(${grain()})`; }
  }
  const zb = $e("#edZbadge"), live = Z.z > 1.01;
  if (zb) { zb.hidden = !live; if (live) zb.innerHTML = `${ZOOM_IC}Zoom ${Z.z.toFixed(1)}×${Z.fx !== "none" ? " · " + (ZOOM_FX.find(f => f[0] === Z.fx) || [])[1] : ""}`; }
  const zi = (E.look.zooms || []).findIndex(q => t >= q.a && t <= q.b);
  if (zi !== E.zLit) { E.zLit = zi; $$e(".ed-zbar").forEach(b => b.classList.toggle("live", +b.dataset.zb === zi)); }
  // the aim dot of the chosen zoom, while the playhead is inside it
  const dot = $e("#edZdot"), zs = (E.look.zooms || [])[E.zSel];
  if (dot) { const on = !!zs && t >= zs.a - 0.05 && t <= zs.b + 0.05; dot.hidden = !on; if (on) { dot.style.left = zs.x + "%"; dot.style.top = zs.y + "%"; } }
}
function zoomAdd(at) {
  const t = Math.max(E.start, Math.min(E.end - 0.6, at ?? nowT())), L = E.look.zooms || [];
  if (L.length >= 12) return toast("Up to 12 zooms on one clip.", "bad");
  const z = {a: Math.round(t * 10) / 10, b: Math.round(Math.min(E.end, t + 2.5) * 10) / 10, s: 1.8, x: 50, y: 40, fx: "none", ease: true};
  L.push(z); L.sort((p, q) => p.a - q.a); E.look.zooms = L; E.zSel = L.indexOf(z); E.lookTouched = true;
  E.tab = "fx"; drawPanel(); drawTimeline(); after(""); zoomFace(true);
}
// aim the chosen zoom at the face: the server finds it in the source picture; the preview says where that is in the frame
async function zoomFace(quiet) {
  const z = (E.look.zooms || [])[E.zSel]; if (!z) return;
  E.zBusy = true; if (!quiet) drawPanel();
  try {
    const r = await send(`/api/jobs/${E.jid}/clips/${E.cid}/face`, {a: z.a, b: z.b});
    if (r.x == null) { if (!quiet) toast("No face found in this moment. Drag the dot on the video to aim.", "bad"); }
    else {
      const p = srcToFrame(r.x, r.y);
      if (p) { z.x = Math.round(p[0] * 10) / 10; z.y = Math.round(p[1] * 10) / 10; E.lookTouched = true; after(""); toast("Aimed at the face", "ok"); }
    }
  } catch (er) { if (!quiet) toast(er.message, "bad"); }
  E.zBusy = false; drawPanel(); E.zKey = ""; paintOverlay();
}
// a point of the source picture (fractions) to % of the frame, read from where the preview draws the video
function srcToFrame(fx, fy) {
  const ph = $e("#edPhone"); if (!ph) return null;
  E.zoomOff = true; E.zKey = ""; applyZoom(nowT(), ph);
  const P = ph.getBoundingClientRect();
  let best = null;
  for (const id of ["#edVid2", "#edVid"]) {          // the face cam band first in a split
    const v = $e(id); if (!v) continue;
    const r = v.getBoundingClientRect(), box = (v.parentElement || v).getBoundingClientRect();
    const x = r.left + fx * r.width, y = r.top + fy * r.height;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) { best = [(x - P.left) / P.width * 100, (y - P.top) / P.height * 100]; break; }
  }
  E.zoomOff = false; E.zKey = "";
  return best && best.map(n => Math.max(0, Math.min(100, n)));
}
function zoomCard() {
  const L = E.look.zooms || [], z = L[E.zSel];
  if (!L.length) return `<div class="ed-card ed-zempty"><span class="ed-zeic">${ZOOM_IC}</span>
      <div><b>No zoom moments yet</b><p class="ed-help">Punch in on a reaction: the video zooms toward a face for a moment, with its own look.</p>
        <div class="ed-zeact"><button class="ed-btn primary sm" data-ed="zoomadd">${ic("plus")}Add at the playhead</button><span>or press <kbd>Z</kbd> while it plays</span></div></div></div>`;
  return `<div class="ed-card"><div class="ed-h"><b>Zoom moments</b><button class="ed-btn ghost sm" data-ed="zoomadd">${ZOOM_IC}Add at playhead</button></div>
    ${L.length ? `<div class="ed-piclist">${L.map((q, i) => `<div class="ed-picrow ${i === E.zSel ? "on" : ""}">
        <button class="ed-picpick" data-ed="zoomsel" data-v="${i}" aria-pressed="${i === E.zSel}"><i class="ed-zi">${q.s.toFixed(1)}×</i><span>${(ZOOM_FX.find(f => f[0] === q.fx) || ZOOM_FX[0])[1] === "None" ? "Zoom" : (ZOOM_FX.find(f => f[0] === q.fx))[1] + " zoom"}</span><small>${ts(q.a - E.start)}–${ts(q.b - E.start)}</small></button>
        <button class="ed-ib sm ed-tip" data-ed="zoomdel" data-v="${i}" aria-label="Remove this zoom" data-tip="Remove">${svg('<path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')}</button></div>`).join("")}</div>`
      : `<p class="ed-help">Punch in on a reaction: the video zooms toward a face for a moment, with its own look. Press Z while it plays to add one.</p>`}
    ${z ? zoomSet(z) : ""}
  </div>`;
}
const ZOOM_AMT = [[1.2, "Subtle"], [1.5, "Punch"], [2, "Close"], [2.6, "Tight"]];
function zoomSet(z) {
  const c = clipNow(), pic = c && c.cover ? `/media/${E.jid}/${esc(c.cover)}?v=${c.version || 0}` : "";
  const fx = z.fx || "none", len = Math.max(0, z.b - z.a);
  const tile = ([k, l, f]) => `<button class="ed-ztile" data-ed="zoomfx" data-v="${k}" aria-pressed="${fx === k}">
      <span class="ed-ztp${k === "grain" ? " grain" : ""}">${pic ? `<img src="${pic}" alt="" loading="lazy" style="filter:${f || "none"};transform:scale(${Math.min(1.8, z.s)});transform-origin:${z.x}% ${z.y}%">` : ""}</span><b>${l}</b></button>`;
  return `<div class="ed-zset">
    <div class="ed-zsec"><div class="ed-zhd"><span>How far in</span><em>${z.s.toFixed(1)}×</em></div>
      <div class="ed-zamt">${ZOOM_AMT.map(([v, l]) => `<button data-ed="zoomamt" data-v="${v}" aria-pressed="${Math.abs(z.s - v) < 0.05}"><b>${v}×</b><small>${l}</small></button>`).join("")}</div>
      <label class="ed-sl" style="--p:${pctOf(z.s, 1.1, 3)}"><input type="range" min="1.1" max="3" step="0.1" value="${z.s}" data-zm="s" aria-label="How far in"><span class="ed-sl-l">Fine-tune</span><output>${z.s.toFixed(1)}×</output></label></div>
    <div class="ed-zsec"><div class="ed-zhd"><span>Look</span><em>${(ZOOM_FX.find(f => f[0] === fx) || ZOOM_FX[0])[1]}</em></div>
      <div class="ed-zlooks">${ZOOM_FX.map(tile).join("")}</div></div>
    <div class="ed-zsec"><div class="ed-zhd"><span>Motion</span><em>${len.toFixed(1)} s</em></div>
      <div class="ed-seg" role="radiogroup" aria-label="Motion"><button role="radio" data-ed="zoomeaseset" data-v="1" aria-checked="${z.ease !== false}">Smooth in and out</button>
        <button role="radio" data-ed="zoomeaseset" data-v="0" aria-checked="${z.ease === false}">Hard cut</button></div></div>
    <div class="ed-zsec"><div class="ed-zhd"><span>Aim</span><em>${Math.round(z.x)}% · ${Math.round(z.y)}%</em></div>
      <div class="ed-zaim"><button class="ed-btn" data-ed="zoomface" ${E.zBusy ? "disabled" : ""}>${E.zBusy ? "Looking…" : "Find the face"}</button>
        <button class="ed-btn ghost" data-ed="zoomcentre" ${z.x === 50 && z.y === 50 ? "disabled" : ""}>Centre</button></div>
      <p class="ed-help">Or drag the dot on the video. On the timeline, drag the bar to move it and its ends to change how long.</p></div>
  </div>`;
}
const MUSIC_IC = svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>');
function musicLane() {
  const m = musicOf(), tr = (E.music || []).find(x => x.id === m.id), o = outroOf();
  if (!tr) return `<div class="ed-lane music znone" title="Add a song from your library"><span class="ed-mhint" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%">${MUSIC_IC}Click to add music</span></div>`;
  const [a, b] = musSpan();
  return `<div class="ed-lane music" title="${esc(tr.name)}: drag to move it, drag its ends to trim, click to change it"><span class="ed-mbar" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%">
    <i class="pe l"></i>${MUSIC_IC}<b>${esc(tr.name)}</b><small>${m.vol}%${o.on && m.rise ? ` → ${m.peak}%` : ""}${m.duck ? " · lowers for speech" : ""}</small><i class="pe r"></i></span></div>`;
}
function zoomsLane() {
  const L = E.look.zooms || [];
  if (!L.length) return `<div class="ed-lane zooms znone" title="Click to add a zoom at that moment"><span class="ed-zhint" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%">${ZOOM_IC}Click to add a zoom here · or press Z</span></div>`;
  return `<div class="ed-lane zooms" title="Click an empty spot to add a zoom there">${L.map((z, i) => `<button class="ed-zbar ${i === E.zSel ? "on" : ""}" data-zb="${i}" data-ed="zoomsel" data-v="${i}"
    style="left:${pct(z.a)}%;width:${Math.max(0.6, pct(z.b) - pct(z.a))}%"><i class="pe l"></i><span>${z.s.toFixed(1)}× ${z.fx && z.fx !== "none" ? (ZOOM_FX.find(f => f[0] === z.fx) || [])[1] : ""}</span><i class="pe r"></i></button>`).join("")}</div>`;
}
$("#clipdlg").addEventListener("click", e => {
  const ml = e.target.closest(".ed-lane.music");
  if (ml && E.justMoved && Date.now() - E.justMoved < 300) return e.stopPropagation();
  if (ml) { e.stopPropagation(); E.tab = "audio"; drawPanel(); if (phone()) { E.sheet = "panel"; syncSheet(); } return; }
  const lane = e.target.closest(".ed-lane.zooms"); if (!lane || e.target.closest(".ed-zbar")) return;
  if (E.justMoved && Date.now() - E.justMoved < 300) return;
  const r = $e("#edTrack").getBoundingClientRect(), t = E.min + (e.clientX - r.left) / r.width * (E.max - E.min);
  if (t < E.start || t > E.end) return toast("Zooms go inside the clip", "bad");
  e.stopPropagation(); zoomAdd(t); showAt(Math.min(E.end, t + 0.4));
});
let mDrag = null;
dlg_on("pointerdown", e => {
  const bar = e.target.closest(".ed-mbar"); if (!bar) return;
  const tr = $e("#edTrack").getBoundingClientRect(), [a, b] = musSpan();
  mDrag = {mode: e.target.closest(".pe.l") ? "a" : e.target.closest(".pe.r") ? "b" : "move", sx: e.clientX, a0: a, b0: b,
    k: (E.max - E.min) / tr.width, moved: false, bar};
  bar.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = mDrag; if (!d) return;
  if (Math.abs(e.clientX - d.sx) > 3) d.moved = true; if (!d.moved) return;
  const o = outroOf(), endAll = Math.min(E.max, E.end + (o.on ? o.secs : 0)), dt = (e.clientX - d.sx) * d.k, r = v => Math.round(v * 10) / 10;
  let a = d.a0, b = d.b0;
  if (d.mode === "a") a = Math.max(E.start, Math.min(b - 0.5, d.a0 + dt));
  else if (d.mode === "b") b = Math.min(endAll, Math.max(a + 0.5, d.b0 + dt));
  else { const len = d.b0 - d.a0; a = Math.max(E.start, Math.min(endAll - len, d.a0 + dt)); b = a + len; }
  const m = musicOf();
  E.look.music = {...m, off: r(a - E.start), till: b >= endAll - 0.05 ? null : r(b - E.start)};
  d.bar.style.left = pct(a) + "%"; d.bar.style.width = (pct(b) - pct(a)) + "%";
  if (d.mode !== "b") showAt(Math.max(E.start, Math.min(E.end, a)));
});
dlg_on("pointerup", () => {
  const d = mDrag; mDrag = null; if (!d || !d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true;
  if (E.tab === "audio") drawPanel(); drawTimeline(); after("");
});
let zDrag = null;
dlg_on("pointerdown", e => {
  const bar = e.target.closest(".ed-zbar");
  if (bar) {
    const i = +bar.dataset.zb, z = (E.look.zooms || [])[i]; if (!z) return;
    const tr = $e("#edTrack").getBoundingClientRect();
    zDrag = {i, mode: e.target.closest(".pe.l") ? "a" : e.target.closest(".pe.r") ? "b" : "move", sx: e.clientX, a0: z.a, b0: z.b, k: (E.max - E.min) / tr.width, moved: false};
    bar.setPointerCapture?.(e.pointerId); return;
  }
  const dot = e.target.closest("#edZdot"); if (!dot) return;
  e.preventDefault(); e.stopPropagation();
  const ph = $e("#edPhone").getBoundingClientRect();
  zDrag = {dot: true, ph}; dot.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = zDrag; if (!d) return;
  const z = (E.look.zooms || [])[d.dot ? E.zSel : d.i]; if (!z) return;
  if (d.dot) {
    z.x = Math.round(Math.max(0, Math.min(100, (e.clientX - d.ph.left) / d.ph.width * 100)) * 10) / 10;
    z.y = Math.round(Math.max(0, Math.min(100, (e.clientY - d.ph.top) / d.ph.height * 100)) * 10) / 10;
    d.moved = true; E.zKey = ""; return applyZoom(nowT(), $e("#edPhone"));
  }
  const dt = (e.clientX - d.sx) * d.k; if (Math.abs(e.clientX - d.sx) > 3) d.moved = true; if (!d.moved) return;
  const r = v => Math.round(v * 10) / 10, len = d.b0 - d.a0;
  if (d.mode === "a") z.a = r(Math.max(E.start, Math.min(z.b - 0.3, d.a0 + dt)));
  else if (d.mode === "b") z.b = r(Math.min(E.end, Math.max(z.a + 0.3, d.b0 + dt)));
  else { z.a = r(Math.max(E.start, Math.min(E.end - len, d.a0 + dt))); z.b = r(z.a + len); }
  const bar = $e(`.ed-zbar[data-zb="${d.i}"]`); if (bar) { bar.style.left = pct(z.a) + "%"; bar.style.width = Math.max(0.6, pct(z.b) - pct(z.a)) + "%"; }
});
dlg_on("pointerup", () => {
  const d = zDrag; zDrag = null; if (!d || !d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; E.zKey = ""; (E.look.zooms || []).sort((p, q) => p.a - q.a);
  if (E.tab === "fx") drawPanel(); if (!d.dot) drawTimeline(); after("");
});
/* ---------- the post card on the preview: drag it anywhere, drag its corner to resize. Stored as dx/dy (% of the
   frame) and scale (%), the same numbers render.card_geometry uses. */
let cardDrag = null;
$("#clipdlg").addEventListener("pointerdown", e => {
  if (E.layout !== "card" || E.view !== "live") return;
  const t = e.target;
  if (t.closest("#edCap, #edHookBox, #edBrand, .ed-pic, #edZdot, .ed-pbtn")) return;
  const rz = t.closest(".ed-crz"), on = rz || t.closest("#edPost") && !t.closest(".ed-pbk") || t.closest("#edFgBox");
  if (!on) return;
  const ph = $e("#edPhone").getBoundingClientRect(), c = cardOf(), g = geo("card", E.sw, E.sh).card;
  const w = ((g.box ? g.box[2] - g.box[0] : g.vw) / OUT_W) * ph.width;
  cardDrag = {rz: !!rz, sx: e.clientX, sy: e.clientY, dx0: c.dx, dy0: c.dy, s0: c.scale, pw: ph.width, ph: ph.height, w, moved: false};
  if (rz) { e.preventDefault(); e.stopPropagation(); }
}, true);
$("#clipdlg").addEventListener("pointermove", e => {
  const d = cardDrag; if (!d) return;
  const mx = e.clientX - d.sx, my = e.clientY - d.sy;
  if (!d.moved && Math.hypot(mx, my) < 4) return;
  d.moved = true;
  const c = cardOf();
  if (d.rz) c.scale = Math.round(Math.max(50, Math.min(130, d.s0 * (1 + mx * 2 / d.w))));
  else { c.dx = Math.round(Math.max(-60, Math.min(60, d.dx0 + mx / d.pw * 100)) * 10) / 10; c.dy = Math.round(Math.max(-60, Math.min(60, d.dy0 + my / d.ph * 100)) * 10) / 10; }
  E.look.card = c; E.fgKey = ""; E.lastKey = ""; paintOverlay();
});
$("#clipdlg").addEventListener("pointerup", () => {
  const d = cardDrag; cardDrag = null; if (!d || !d.moved) return;
  E.cardMovedAt = Date.now(); E.lookTouched = true; if (E.tab === "layout") drawPanel(); after("");
});
$("#clipdlg").addEventListener("click", e => {             // the click that ends a drag doesn't also play or pause
  if (E.cardMovedAt && Date.now() - E.cardMovedAt < 350 && e.target.closest("#edPhone")) { e.stopPropagation(); e.preventDefault(); }
}, true);
// double-click anything on the preview to open its settings (the captions already do this)
$("#clipdlg").addEventListener("dblclick", e => {
  if (E.view !== "live" || !e.target.closest("#edPhone") || e.target.closest("#edCap")) return;
  const t = e.target;
  const tab = t.closest("#edHookBox") ? "text" : t.closest("#edBrand") ? "brand" : t.closest(".ed-pic") ? "media"
    : t.closest("#edZdot") ? "fx" : "layout";
  if (tab === "media") { const p = t.closest(".ed-pic"); if (p) E.picSel = +p.dataset.pi; }
  E.tab = tab; drawPanel();
  if (phone()) { E.sheet = "panel"; syncSheet?.(); }
});
/* ---------- background music: a track from the person's library under the clip. The preview plays it beside the
   video with the same steps as render.music_graph: evened out, set to a share of the voice, lowered while someone
   speaks (ducking), looped, faded in and out. */
const MUSIC_DEFAULT = {id: "", vol: 25, duck: true, loop: true, fade: true, at: 0, peak: 100, rise: 3, peak_at: null, off: 0, till: null};
const musicOf = () => ({...MUSIC_DEFAULT, ...(E.look.music || {})});
// where the music plays, in source seconds: from `off` after the clip's start to `till` (null: the end, outro included)
function musSpan(m = musicOf()) {
  const o = outroOf(), total = (E.end - E.start) + (o.on ? o.secs : 0);
  const s = Math.min(m.off || 0, Math.max(0, total - 0.5)), e = m.till == null ? total : Math.max(s + 0.5, Math.min(total, m.till));
  return [E.start + s, Math.min(E.max, E.start + e)];
}
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function musicCard() {
  const m = musicOf(), list = E.music || [], cur = list.find(t => t.id === m.id);
  const sw = (k, label, help) => `<label class="ed-ck"><input type="checkbox" data-mus="${k}" ${m[k] ? "checked" : ""}><span>${label}<small>${help}</small></span></label>`;
  return `<div class="ed-card"><div class="ed-h"><b>Background music</b></div>
    ${dropCard("edMusIn", "audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac", E.musBusy ? "Adding the song…" : "Upload a song", "Drop it here or browse · MP3, M4A or WAV", E.musBusy)}
    <div class="ed-mlist" role="radiogroup" aria-label="Music">
      <button role="radio" class="ed-mrow" data-ed="muspick" data-v="" aria-checked="${!m.id}"><span>No music</span></button>
      ${list.map(t => `<button role="radio" class="ed-mrow" data-ed="muspick" data-v="${t.id}" aria-checked="${m.id === t.id}">
        ${svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>')}<span>${esc(t.name)}</span><small>${mmss(t.dur)}</small>
        <i class="ed-x" data-ed="musdel" data-v="${t.id}" title="Remove from your library">${ic("x")}</i></button>`).join("")}</div>
    ${list.length ? "" : `<p class="ed-help">It's kept in your library for every clip.</p>`}
    ${cur ? `${slider("Music volume", "mus_vol", 0, 100, 5, m.vol, m.vol + "%")}
      ${slider("Start the song at", "mus_at", 0, Math.max(1, Math.floor(cur.dur - 1)), 1, Math.min(m.at, cur.dur), mmss(Math.min(m.at, cur.dur)))}
      ${sw("duck", "Lower it while someone talks", "Words stay clear")}${sw("loop", "Loop it", "Plays again if the clip is longer")}${sw("fade", "Fade in and out", "Starts softly and ends smoothly")}
      ${riseCard(m, cur)}` : ""}
  </div>`;
}
async function musicAdd(file) {
  if (!file) return;
  if (file.size > 25e6) return toast("That file is too big. Use one under 25 MB.", "bad");
  const fd = new FormData(); fd.append("file", file);
  E.musBusy = true; drawPanel();
  try {
    const r = await api("/api/music", {method: "POST", body: fd});
    E.music = r.tracks; E.look.music = {...musicOf(), id: r.id, at: 0}; E.lookTouched = true;
    toast("Song added", "ok");
  } catch (er) { toast(er.message, "bad"); }
  E.musBusy = false; drawPanel(); after("");
}
function musicEl() {
  if (!E.musEl) { E.musEl = new Audio(); E.musEl.preload = "auto"; }
  return E.musEl;
}
// the music in the preview, kept in step with the video on every frame
function syncMusic(t, v) {
  const m = musicOf(), el = E.musEl, track = (E.music || []).find(x => x.id === m.id);
  const on = track && E.view !== "rendered" && !E.muted;
  if (!on) { if (el && !el.paused) el.pause(); return; }
  const a = musicEl(), src = `/api/music/${m.id}`;
  if (!a.src.endsWith(src)) a.src = src;
  const [ms, me] = musSpan(m), rel = t - ms, len = track.dur;
  let pos = m.at + Math.max(0, rel);
  if (pos >= len) { if (!m.loop) { if (!a.paused) a.pause(); return; } pos = m.at < len ? m.at + (pos - m.at) % Math.max(0.5, len - m.at) : pos % len; }
  if (v.paused || rel < 0 || t > E.end || t > me) { if (!a.paused) a.pause(); return; }
  if (Math.abs(a.currentTime - pos) > 0.3) a.currentTime = pos;
  if (a.paused) a.play().catch(() => {});
  let g = m.vol / 100 * 0.7;
  const ot = outroOf();
  if (ot.on && m.rise > 0) { const r0 = E.end - m.rise; if (t >= r0) g = (m.vol + (m.peak - m.vol) * Math.min(1, (t - r0) / m.rise)) / 100 * 0.7; }
  if (m.duck && E.words.some(w => t >= w.s - 0.05 && t < w.e + 0.2)) g *= 0.3;      // someone is talking: lower it
  if (m.fade) g *= Math.min(1, Math.max(0, rel / 0.6), Math.max(0, (Math.min(me, E.end + (ot.on ? ot.secs : 0)) - t) / 1.5));
  a.volume = Math.max(0, Math.min(1, g));
}
/* ---------- the social watermark (Brand > Social watermark): header, platform icon + handle, hashtag line.
   The platform icons are the real marks without their tiles. render.py draws the same thing from PNG copies of
   these (studio/marks), with the same sizes (render.social_geometry). */
const TT = "M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";
const WM_ICONS = {
  youtube: ["YouTube", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 17"><path fill="#FF0033" d="M23.5 2.65a3.02 3.02 0 0 0-2.12-2.14C19.5 0 12 0 12 0S4.5 0 2.62.5A3.02 3.02 0 0 0 .5 2.65C0 4.53 0 8.46 0 8.46s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 12.39 24 8.46 24 8.46s0-3.93-.5-5.81z"/><path fill="#fff" d="M9.55 12.03V4.89l6.27 3.57z"/></svg>'],
  tiktok: ["TikTok", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26"><path transform="translate(-.6 -.5)" fill="#25F4EE" d="${TT}"/><path transform="translate(.6 .5)" fill="#FE2C55" d="${TT}"/><path fill="#fff" d="${TT}"/></svg>`],
  instagram: ["Instagram", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><defs><radialGradient id="wmIg" cx="28%" cy="108%" r="140%"><stop offset="0" stop-color="#FFD776"/><stop offset=".1" stop-color="#F3A554"/><stop offset=".45" stop-color="#F13F79"/><stop offset=".75" stop-color="#C02DB0"/><stop offset="1" stop-color="#5C4BDF"/></radialGradient></defs><rect width="28" height="28" rx="7" fill="url(#wmIg)"/><rect x="7" y="7" width="14" height="14" rx="4.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="14" r="3.3" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="18.25" cy="9.75" r="1.05" fill="#fff"/></svg>'],
  x: ["X", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>'],
  twitch: ["Twitch", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9146FF" d="M6 0 1.71 4.29v15.42h5.15V24l4.28-4.29h3.43L22.29 12V0z"/><path fill="#fff" d="M20.57 11.14l-3.43 3.43h-3.43l-3 3v-3H6.86V1.71h13.71z"/><path fill="#9146FF" d="M11.57 4.71h1.72v5.15h-1.72zm4.72 0H18v5.15h-1.71z"/></svg>'],
  kick: ["Kick", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#53FC18" d="M1.5 1.5h7v6h2.5V5h2.5V2.5H16v-1h6.5v7H20V11h-2.5v2H20v2.5h2.5v7H16v-1h-2.5V19H11v-2.5H8.5v6h-7z"/></svg>']};
const wmGeo = s => ({pad: 8, hs: Math.round(s * 0.36), ts: Math.round(s * 0.5), ic: Math.round(s * 0.6), gs: Math.round(s * 0.44), g: Math.round(s * 0.12)});
const WM_PRESETS = [["off", "Off"], ["promo", "Episode promo"], ["tag", "Hashtag"], ["dual", "Dual"]];
// the social watermark's inner HTML at scale k (frame pixels to screen pixels)
function wmHtml(L, k, logoV) {
  const q = wmGeo(L.brand_size || 84), col = L.brand_color || "#FFFFFF", fam = fontCss(L.brand_font || "Inter", 700).family;
  const icon = L.brand_icon || "youtube", tag = L.brand_tag_on && (L.brand_tag || "").trim();
  const head = (L.brand_head || "").trim(), handle = (L.brand_handle || "").trim();
  const ic = icon === "none" ? "" : icon === "logo" ? (logoV ? `<img src="/api/brand/logo?v=${logoV}" alt="" style="height:${q.ic * k}px">` : "")
    : (WM_ICONS[icon] ? WM_ICONS[icon][1].replace("<svg ", `<svg style="height:${q.ic * k}px;width:auto;display:block" `) : "");
  if (!head && !handle && !tag && !ic) return "";
  const sh = `text-shadow:0 ${2 * k}px ${6 * k}px rgba(0,0,0,.55)`;
  return `<div class="wm" style="padding:${q.pad * k}px;color:${col};font-family:${fam};${sh}">
    ${head ? `<div style="font-weight:500;font-size:${q.hs * k}px;line-height:${q.hs * 1.25 * k}px">${esc(head)}</div>` : ""}
    ${handle || ic ? `<div style="display:flex;align-items:center;gap:${handle && ic ? q.g * k : 0}px;height:${Math.max(q.ic, q.ts * 1.25) * k}px;margin-top:${head ? q.g / 2 * k : 0}px;font-weight:700;font-size:${q.ts * k}px">${ic}${handle ? `<span>${esc(handle)}</span>` : ""}</div>` : ""}
    ${tag ? `<div style="margin:${q.g * k}px 0;border-top:${2 * k}px dashed ${col}99"></div><div style="font-weight:700;font-size:${q.gs * k}px;line-height:${q.gs * 1.25 * k}px">${esc(tag)}</div>` : ""}</div>`;
}
// the Brand panel's social watermark: presets, a preview of exactly what goes on the video, and its parts
const slug = () => (cardName() || "yourchannel").toLowerCase().replace(/[^a-z0-9_]/g, "") || "yourchannel";
function wmPreset(k) {
  const L = E.look, h = slug();
  if (k === "off") { L.brand_on = false; return; }
  Object.assign(L, {brand_on: true, brand_kind: "social", brand_font: L.brand_font || "Inter", brand_color: L.brand_color || "#FFFFFF",
    brand_size: L.brand_size || 84, brand_pos: L.brand_pos || "tr"});
  if (k === "promo") Object.assign(L, {brand_head: "Full video on", brand_icon: "youtube", brand_handle: "/" + h, brand_tag_on: false});
  if (k === "tag") Object.assign(L, {brand_head: "", brand_icon: "none", brand_handle: "", brand_tag_on: true, brand_tag: "#" + h});
  if (k === "dual") Object.assign(L, {brand_head: "Full video on", brand_icon: "youtube", brand_handle: "/" + h, brand_tag_on: true, brand_tag: L.brand_tag || "#" + h});
}
const wmPvHtml = L => L.brand_on && L.brand_kind === "social" ? (wmHtml(L, 0.5, E.logoV) || "<span>Add a header, handle or hashtag</span>") : "<span>Turned off</span>";
function wmCards(L) {
  const f = FONTS(), icon = L.brand_icon || "youtube";
  const ico = k => k === "none" ? "None" : k === "logo" ? (E.logoV ? `<img src="/api/brand/logo?v=${E.logoV}" alt="">` : "Logo") : WM_ICONS[k][1];
  return `<div class="ed-card"><b>Presets</b>
      <div class="ed-chips">${WM_PRESETS.map(([k, l]) => `<button data-ed="wmpreset" data-v="${k}">${l}</button>`).join("")}</div>
      <div class="ed-wmpv" id="edWmPv" aria-label="What goes on the video">${wmPvHtml(L)}</div></div>
    <div class="ed-card"><b>Watermark</b>
      <label class="ed-f">Header<input class="ed-text" data-look="brand_head" value="${esc(L.brand_head || "")}" maxlength="40" placeholder="Full video on"></label>
      <div class="ed-f">Icon<div class="ed-wmicons">${["none", "logo", ...Object.keys(WM_ICONS)].map(k =>
        `<button data-ed="wmicon" data-v="${k}" aria-pressed="${icon === k}" title="${k === "none" ? "No icon" : k === "logo" ? "Your logo" : WM_ICONS[k][0]}">${ico(k)}</button>`).join("")}</div></div>
      <label class="ed-f">Handle<input class="ed-text" data-look="brand_handle" value="${esc(L.brand_handle || "")}" maxlength="40" placeholder="/${esc(slug())}"></label>
      <div class="ed-row">
        <label class="ed-f" style="flex:1">Font<select data-look="brand_font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === (L.brand_font || "Inter") ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="ed-f ed-colf" style="flex:none;width:72px">Colour<span class="ed-swc" style="background:${L.brand_color || "#FFFFFF"}"><input type="color" data-look="brand_color" value="${L.brand_color || "#FFFFFF"}" aria-label="Colour"></span></label></div></div>
    <div class="ed-card"><label class="ed-ck"><input type="checkbox" data-look="brand_tag_on" ${L.brand_tag_on ? "checked" : ""}><span>Hashtag line<small>Under a dashed rule</small></span></label>
      ${L.brand_tag_on ? `<input class="ed-text" data-look="brand_tag" value="${esc(L.brand_tag || "")}" maxlength="40" placeholder="#YourHashtag">` : ""}</div>`;
}
function wmRefresh() {             // the panel's preview and the video preview, after a change
  const pv = $e("#edWmPv"); if (pv) pv.innerHTML = wmPvHtml(E.look);
  const sw = $e('[data-look="brand_on"]'); if (sw) sw.checked = !!E.look.brand_on;
  E.lookTouched = true; after(""); paintOverlay();
}
// the five layouts as icons: the phone, and what fills it (filled parts are the video)
const PH = '<rect x="6" y="2.5" width="12" height="19" rx="2.6"/>';
const LAY_IC = {
  blur: PH + '<rect x="6" y="9" width="12" height="6" fill="currentColor" stroke="none"/>',
  zoom: PH + '<rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none"/><path d="M9.5 4.3h5M9.5 19.7h5" stroke-opacity=".5"/>',
  crop: '<rect x="6" y="2.5" width="12" height="19" rx="2.6" fill="currentColor" fill-opacity=".22"/><circle cx="12" cy="10" r="2.3"/><path d="M8 17.5c.5-2.5 2.1-3.7 4-3.7s3.5 1.2 4 3.7"/>',
  split: PH + '<path d="M6 2.5h12v9.5H6z" fill="currentColor" stroke="none" fill-opacity=".85"/><circle cx="12" cy="15.4" r="1.6"/><path d="M9.4 19.6c.4-1.3 1.4-1.9 2.6-1.9s2.2.6 2.6 1.9"/>',
  card: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.6"/><circle cx="7.4" cy="7.6" r="1.4"/><path d="M10.2 7.6h6.3"/><rect x="6.3" y="11" width="11.4" height="6.6" rx="1.2" fill="currentColor" stroke="none"/>'};
/* ---------- templates: a layout, a shape and a caption look chosen together in one click. The clip's own words,
   trim and brand stay; caption and hook positions go back to automatic for the new layout. */
const POST_CAPS = {font: "Inter", size: 64, outline: 0, per: 3, upper: false, active: CARD_BLUE, weight: 600};
const TPLS = [
  {k: "stream", cat: "streams", name: "Stream + face cam", sub: "Gameplay on top, the face cam under it", layout: "split", cam_at: "bottom", style: "boldpop"},
  {k: "camtop", cat: "streams", name: "Face cam on top", sub: "The streamer first, the game below", layout: "split", cam_at: "top", style: "studio"},
  {k: "solo", cat: "streams", name: "Solo full screen", sub: "One part of the stream fills the phone", layout: "crop", style: "hype"},
  {k: "xlight", cat: "posts", name: "X post, light", sub: "The clip inside a post, white card", layout: "card", theme: "light", caps: {...POST_CAPS, base: "#0F1419"}},
  {k: "xdark", cat: "posts", name: "X post, dark", sub: "The clip inside a post, black card", layout: "card", theme: "dark", caps: {...POST_CAPS, base: "#E7E9EA"}},
  {k: "linkedin", cat: "posts", name: "LinkedIn post", sub: "A professional post with your headline", layout: "card", theme: "linkedin", caps: {...POST_CAPS, base: "#191919", active: "#0A66C2"}},
  {k: "threads", cat: "posts", name: "Threads post", sub: "Handle, time and the clip, white", layout: "card", theme: "threads", caps: {...POST_CAPS, base: "#000000", active: "#0095F6"}},
  {k: "threadsd", cat: "posts", name: "Threads post, dark", sub: "The same on black", layout: "card", theme: "threads_dark", caps: {...POST_CAPS, base: "#F3F5F7", active: "#0095F6"}},
  {k: "square", cat: "posts", name: "Square feed", sub: "1:1 with a blurred fill, for feeds", layout: "blur", aspect: "1:1", style: "clean"},
  {k: "duo", cat: "podcasts", name: "Two speakers", sub: "Left speaker on top, right speaker below", layout: "split", cam_at: "bottom", style: "podcast",
    split: {game: [0, 0, 0.5, 1], cam: [0.5, 0, 0.5, 1], share: 50}},
  {k: "news", cat: "simple", name: "News lower third", sub: "A bold red banner low on the screen, boxed captions", layout: "blur", style: "boxed",
    hook: {hook_font: "Bebas Neue", hook_size: 96, hook_box: "#C8102E", hook_ink: "#FFFFFF", hook_op: 100, hook_round: 0, hook_y: 72, hook_dur: 0},
    extra: {y: 22, bg: {kind: "color", c1: "#0B0D12"}}},
  {k: "podcast", cat: "podcasts", name: "Podcast close-up", sub: "Closer in on the speakers", layout: "zoom", style: "podcast"},
  {k: "centered", cat: "simple", name: "Centered", sub: "The whole video on a blurred copy", layout: "blur", style: "clean"},
  {k: "wide", cat: "simple", name: "Wide 16:9", sub: "For YouTube and desktop", layout: "crop", aspect: "16:9", style: "studio"}];
const TPL_CATS = [["all", "All"], ["streams", "Streams"], ["posts", "Social posts"], ["podcasts", "Podcasts"], ["simple", "Simple"]];
// a small post card for the layout and template tiles
// a still of this clip for the small tiles: the clean frame once grabbed, else the saved clip's cover (a live
// recording has no thumbnail of its own), else the video's thumbnail
const stillOf = () => E.shot || (clipNow()?.cover ? `/media/${E.jid}/${clipNow().cover}?v=${clipNow().version || 0}` : `/media/${E.jid}/thumb.jpg`);
const miniCard = (bg, theme) => `<i class="lp-card ${theme === "dark" ? "dark" : ""}"><i class="lp-cav"></i><i class="lp-cln"></i><i class="lp-cln s"></i><i class="lp-cv" style="${bg}"></i><i class="lp-ccap"></i></i>`;
function miniTpl(t) {
  const bg = `background-image:url('${stillOf()}')`, sp = rawSplit();
  const crop = r => `${bg};background-size:${(100 / r[2]).toFixed(1)}% ${(100 / r[3]).toFixed(1)}%;background-position:${(r[2] < 1 ? r[0] / (1 - r[2]) * 100 : 50).toFixed(1)}% ${(r[3] < 1 ? r[1] / (1 - r[3]) * 100 : 50).toFixed(1)}%`;
  const inner = t.layout === "split" ? `<i class="lp-part" style="${crop(sp.game)}"></i><i class="lp-part" style="${crop(sp.cam)}"></i>`
    : t.layout === "card" ? miniCard(bg, t.theme) : `<i class="lp-bg" style="${bg}"></i><i class="lp-fg ${t.layout}" style="${bg}"></i>`;
  const [w, h] = ASPECTS[t.aspect || "9:16"];
  return `<span class="lp-ph ${t.layout} ${t.cam_at === "top" ? "camtop" : ""}" style="aspect-ratio:${w}/${h}">${inner}</span>`;
}
function drawTpl() {
  if (!E.tplOpen) return $e("#edTpl")?.remove();
  const cat = E.tplCat || "all", list = TPLS.filter(t => cat === "all" || t.cat === cat);
  const inner = `<header><div><h3>Templates</h3><p>A layout, shape and caption look in one click. Your words, trim and brand stay.</p></div>
      <button class="ed-ib" data-ed="tplclose" aria-label="Close">${ic("x")}</button></header>
    <div class="ed-tpl-cats" role="tablist">${TPL_CATS.map(([k, l]) => `<button role="tab" data-ed="tplcat" data-v="${k}" aria-selected="${cat === k}">${l}</button>`).join("")}</div>
    <div class="ed-tpl-grid">${list.map(t => `<button class="ed-tpl" data-ed="tplpick" data-v="${t.k}" aria-pressed="${E.tplOn === t.k}">
      <span class="ed-tpl-pv">${miniTpl(t)}</span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small></button>`).join("")}</div>`;
  const box = $e("#edTpl .ed-tplbox");
  if (box) { box.innerHTML = inner; return; }
  const el = document.createElement("div");
  el.id = "edTpl"; el.className = "ed-tplw";
  el.innerHTML = `<div class="ed-tplbox" role="dialog" aria-label="Templates">${inner}</div>`;
  el.addEventListener("click", e => { if (e.target === el) { E.tplOpen = false; drawTpl(); } });   // a click beside it closes it
  $e(".ed").append(el);
}
function applyTpl(k) {
  const t = TPLS.find(x => x.k === k); if (!t) return;
  const L = E.look;
  const caps = t.caps ? {...lookFromStyle("clean"), ...t.caps} : lookFromStyle(t.style);
  E.look = {...caps, hook: L.hook ?? true, ...keepOwn(L), aspect: t.aspect || "9:16", x: null, y: null, hook_x: null, hook_y: null};
  delete E.look.frame;                                  // a new layout starts from the whole picture
  if (t.hook) Object.assign(E.look, t.hook);
  if (t.extra) Object.assign(E.look, clone(t.extra));
  if (t.layout === "split") E.look.split = {...rawSplit(), ...(t.split ? clone(t.split) : {}), cam_at: t.cam_at || "bottom"};
  if (t.layout === "card") E.look.card = {...cardOf(), theme: t.theme};
  E.layout = t.layout; E.tplOn = k; E.lookTouched = true; E.tplOpen = false;
  setFrame(); drawTpl(); E.tab = "layout"; drawPanel(); drawStage();
  if (t.layout === "split") findFacecam();
  after("p"); toast(`${t.name} applied`, "ok");
}
/* ---------- the split layout in the preview: two bands, each showing one part of the same video.
   Each band crops its part and fills its band exactly like render._filter: crop the part, cover the band, centre. */
function placeSplit() {
  if (E.layout !== "split" || E.view !== "live") return;
  const ph = $e("#edPhone"); if (!ph || !E.sw || !E.sh) return;
  const W = ph.clientWidth, H = ph.clientHeight, sp = splitOf(), g = geo("split", E.sw, E.sh);
  const set = (bandId, vidId, r, h) => {
    const b = $e("#" + bandId), v = $e("#" + vidId); if (!b || !v) return;
    const bh = H * h / OUT_H, rw = r[2] * E.sw, rh = r[3] * E.sh, s = Math.max(W / rw, bh / rh);
    b.style.height = bh + "px";
    v.style.cssText = `width:${E.sw * s}px;height:${E.sh * s}px;left:${-r[0] * E.sw * s - (rw * s - W) / 2}px;top:${-r[1] * E.sh * s - (rh * s - bh) / 2}px`;
  };
  set("edBandG", "edVid", sp.game, g.fg); set("edBandC", "edVid2", sp.cam, g.ch);
}
function syncSplit() {                  // the face cam band plays the same moment as the main one
  const a = $e("#edVid"), b = $e("#edVid2"); if (!a || !b || b.readyState < 1) return;
  if (Math.abs(b.currentTime - a.currentTime) > 0.15) b.currentTime = a.currentTime;
  b.playbackRate = a.playbackRate;
  if (a.paused && !b.paused) b.pause(); else if (!a.paused && b.paused) b.play().catch(() => {});
}
/* the Layout tool's picker: a frame of the video with two boxes, Stream and Face cam, to move and resize */
/* A clean still of the footage for the caption style tiles: a hidden copy of the video jumps a third of the way into
   the clip (the playhead stays put); a frame that's nearly black (an intro, a fade) is skipped for a later one. */
function grabShot(src) {
  const jid = E.jid, cid = E.cid, len = Math.max(1, E.end - E.start), t0 = Math.max(0, E.start - (E.off || 0));
  const tries = [0.33, 0.6, 0.15, 0.85].map(f => t0 + len * f);
  const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = src;
  const cv = document.createElement("canvas"), x = cv.getContext("2d", {willReadFrequently: true});
  const next = () => { if (!tries.length) return v.removeAttribute("src"); v.currentTime = tries.shift(); };
  v.addEventListener("seeked", () => {
    if (E.jid !== jid || E.cid !== cid) return v.removeAttribute("src");      // another clip was opened meanwhile
    try {
      cv.width = 360; cv.height = Math.round(360 * (v.videoHeight || 9) / (v.videoWidth || 16));
      x.drawImage(v, 0, 0, cv.width, cv.height);
      const d = x.getImageData(0, 0, cv.width, cv.height).data; let s = 0;
      for (let i = 0; i < d.length; i += 64) s += d[i] + d[i + 1] + d[i + 2];
      if (s / (d.length / 64) / 3 < 28 && tries.length) return next();      // too dark: try another moment
      E.shot = cv.toDataURL("image/jpeg", 0.72); v.removeAttribute("src");
      if ((E.tab === "style" && (E.stab || "presets") === "presets") || E.tab === "layout") drawPanel();
      if (E.tplOpen) drawTpl();
    } catch { v.removeAttribute("src"); }
  });
  v.addEventListener("loadedmetadata", next, {once: true});
}
function drawPickFrame() {
  const cv = $e("#edPickCv"); if (!cv) return;
  const x = cv.getContext("2d"), v = $e("#edVid");
  cv.width = 640; cv.height = Math.round(640 * (E.sh || 9) / (E.sw || 16));
  if (v && v.readyState >= 2) { try { x.drawImage(v, 0, 0, cv.width, cv.height); return; } catch {} }
  const img = new Image(); img.onload = () => x.drawImage(img, 0, 0, cv.width, cv.height); img.src = `/media/${E.jid}/thumb.jpg`;
}
function placeRegions() {               // the boxes in the Layout panel's picker and in the Frame view
  const sp = splitOf(), at = {...sp, frame: E.look.frame || frameDefault()};
  for (const k of ["game", "cam", "frame"]) {
    const [x, y, w, h] = at[k];
    $$e(`.ed-rg[data-rg="${k}"]`).forEach(el => { el.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`; });
  }
}
/* the video in Fill, Blurred, Zoomed and Post card: a box that shows the chosen part of the picture, covering the
   box and centred, exactly like render._filter (crop the part, then cover). On the post card the box is the card's
   video, with rounded corners, and the card itself is drawn around it. Redone only when something changes. */
function placeFg() {
  const ph = $e("#edPhone"), box = $e("#edFgBox"), v = $e("#edVid"); if (!ph || !box || !v || !E.sw || !E.sh) return;
  const W = ph.clientWidth, H = ph.clientHeight, k = W / OUT_W, g = geo(E.layout, E.sw, E.sh), r = frameRegion() || [0, 0, 1, 1];
  const c = g.card ? cardOf() : null;
  const key = [W, H, E.layout, r.join(), g.fg, OUT_W, OUT_H, c ? JSON.stringify(c) + cardText(c) + E.logoV : "", JSON.stringify(E.look.bg || {}), E.look.pad, E.look.vradius].join("|");
  if (key === E.fgKey) return;
  E.fgKey = key;
  let bx = 0, by, bw = W, bh = g.fg * k;
  const framed = g.layout === "blur" || g.layout === "zoom", pad = framed ? padPx() : 0;
  if (g.card) { bx = g.card.vx * k; by = g.card.vy * k; bw = g.card.vw * k; bh = g.card.vh * k; }
  else { bx = pad * k; bw = W - 2 * pad * k; by = (H - bh) / 2; }
  const rad = c ? c.radius * g.card.u * k : framed ? (E.look.vradius || 0) * OUT_W / 1080 * k : 0;
  box.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;border-radius:${rad}px`;
  paintBg(framed);
  const rw = r[2] * E.sw, rh = r[3] * E.sh, s = Math.max(bw / rw, bh / rh);
  v.style.cssText = `width:${E.sw * s}px;height:${E.sh * s}px;left:${-r[0] * E.sw * s - (rw * s - bw) / 2}px;top:${-r[1] * E.sh * s - (rh * s - bh) / 2}px`;
  if (c) drawPost(c, g.card, k);
}
// Blurred fill and Zoomed: padding in frame pixels (render._frame.pad), and what is behind the video
const padPx = () => (E.layout === "blur" || E.layout === "zoom") ? Math.round((E.look.pad || 0) * OUT_W / 1080 / 2) * 2 : 0;
const bgOf = () => ({kind: "blur", c1: "#111114", c2: "#3A1C24", ...(E.look.bg || {})});
function paintBg(framed) {
  const ph = $e("#edPhone"), img = $e("#edPhone .ed-bg"); if (!ph) return;
  const b = bgOf(), plain = framed && b.kind !== "blur";
  if (img) img.style.display = plain ? "none" : "";
  ph.style.background = !plain ? "#000" : b.kind === "gradient" ? `linear-gradient(${b.c1},${b.c2})` : b.c1;
}
// the post card around the video, from the same numbers as render.card_images
function drawPost(c, g, k) {
  const el = $e("#edPost"); if (!el) return;
  const th = CARD_THEMES[c.theme] || CARD_THEMES.light, u = g.u * k, [name, sub] = cardAccount(c), one = th.kind === "threads";
  const mid = (g.y0 + g.A / 2) * k, nx = (g.x0 + g.A + 24 * g.u) * k, A = g.A * k, ny = one ? mid + 14 * u : mid - 4 * u;
  const pic = c.avatar !== "initial" && E.logoV ? `<img src="/api/brand/logo?v=${E.logoV}" alt="">` : `<b style="font-size:${A * 0.44}px">${esc((c.name || cardName() || "S")[0].toUpperCase())}</b>`;
  const base = (y, size) => `top:${y - size * 0.93}px;font-size:${size}px;line-height:${size * 1.2}px`;     // a baseline at y, like the render
  const bx = g.box, back = bx ? c.back : "none";
  el.style.background = back === "none" ? th.bg : "#000";
  const backdrop = back === "gradient" ? `<i class="ed-pbk" style="background:${c.grain ? `url(${grain()}),` : ""}linear-gradient(135deg,${c.g1},${c.g2})"></i>`
    : back === "blur" ? `<i class="ed-pbk blur" style="background-image:url('${stillOf()}')"></i>` : "";
  const panel = bx ? `<i class="ed-ppanel" style="left:${bx[0] * k}px;top:${bx[1] * k}px;width:${(bx[2] - bx[0]) * k}px;height:${(bx[3] - bx[1]) * k}px;border-radius:${44 * u}px;background:${th.bg};
    box-shadow:0 ${18 * u}px ${56 * u}px rgba(0,0,0,.45),inset 0 0 0 ${Math.max(1, 2 * u)}px ${th.bg === "#FFFFFF" ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.1)"}"></i>` : "";
  const cr = bx ? [bx[2], bx[3]] : [g.vx + g.vw, g.vy + g.vh];
  const handle = `<i class="ed-crz" title="Drag to resize the card" style="left:${cr[0] * k}px;top:${cr[1] * k}px"></i>`;
  el.innerHTML = backdrop + panel + handle + `<span class="ed-pav" style="left:${g.x0 * k}px;top:${g.y0 * k}px;width:${A}px;height:${A}px;background:${th.acc}">${pic}</span>
    <span class="ed-pnm" style="left:${nx}px;${base(ny, 42 * u)};color:${th.ink}">${esc(name)}${c.verified ? `<svg viewBox="0 0 24 24" style="width:${38 * u}px;height:${38 * u}px;margin-left:${10 * u}px"><circle cx="12" cy="12" r="12" fill="${th.acc}"/><path d="M6.6 12.2l3.4 3.4 7.2-7.2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}${one
      ? `<span style="margin-left:${14 * u}px;font-weight:400;font-size:${36 * u}px;color:${th.sub}">${esc(sub)}</span>` : ""}</span>
    ${one ? "" : `<span class="ed-phd" style="left:${nx}px;${base(mid + 40 * u, 36 * u)};color:${th.sub}">${esc(sub)}</span>`}
    ${g.lines.map((l, i) => `<span class="ed-ptx" style="left:${g.x0 * k}px;${base((g.y0 + g.A + 36 * g.u + i * g.lh + g.ts) * k, g.ts * k)};color:${th.ink}">${withEmoji(l)}</span>`).join("")}`;
}
// a dragged hook or caption line stays fully inside the frame, as the render keeps it (render._hook_events / build_ass)
function keepInside(el, xPct, margin, phone) {
  if (xPct == null || !el) return;
  const W = phone.clientWidth, w = Math.min(el.getBoundingClientRect().width, W);
  const cx = Math.max(w / 2 + margin, Math.min(W - w / 2 - margin, W * xPct / 100));
  el.style.left = (w < W - 2 * margin ? cx / W * 100 : 50) + "%";
}
// where the hook or the captions sit, with the two quick fixes; the moving itself is done by dragging on the video
function posCard(kind) {
  const L = E.look, hook = kind === "hook", g = geo(E.layout, E.sw, E.sh);
  const x = hook ? L.hook_x : L.x, y = hook ? L.hook_y : L.y, auto = x == null && y == null;
  const ay = Math.round((hook ? g.hook : g.cap) / OUT_H * 100);
  const cx = x == null ? 50 : x, cy = y == null ? ay : y;
  const spots = [["Top", hook ? 14 : 22], ["Middle", 50], ["Bottom", hook ? 80 : 76]];
  const pressed = v => y != null && Math.abs(y - v) < 1.5;
  return `<div class="ed-posc">
    <div class="ed-posmini" data-k="${kind}" title="Click or drag to place the ${hook ? "hook" : "captions"}" role="img" aria-label="Where the ${hook ? "hook" : "captions"} sit">
      <i class="ed-posguide"></i><span class="ed-posmark ${hook ? "hook" : ""}" style="left:${cx}%;top:${cy}%"></span></div>
    <div class="ed-posside">
      <div class="ed-posspots" role="group" aria-label="Height">${spots.map(([l, v]) => `<button data-ed="posy" data-k="${kind}" data-v="${v}" aria-pressed="${pressed(v)}">${l}</button>`).join("")}
        <button data-ed="posreset" data-k="${kind}" aria-pressed="${auto}">Auto</button></div>
      <div class="ed-posc-v"><span>Across <b>${Math.round(cx)}%</b></span><span>Down <b>${Math.round(cy)}%</b></span></div>
      <button class="ed-link" data-ed="centerx" data-k="${kind}" ${x == null || Math.round(x) === 50 ? "disabled" : ""}>Centre across</button>
    </div>
    <p class="ed-posnote">Or drag the ${hook ? "hook" : "captions"} on the video.</p></div>`;
}
// the small frame in Position: click or drag inside it to place the hook or captions
let miniDrag = null;
function miniSet(e, el) {
  const r = el.getBoundingClientRect(), k = el.dataset.k;
  const x = Math.round(Math.max(5, Math.min(95, (e.clientX - r.left) / r.width * 100)));
  const y = Math.round(Math.max(5, Math.min(95, (e.clientY - r.top) / r.height * 100)));
  const nx = Math.abs(x - 50) < 4 ? 50 : x;                      // snaps to the middle across
  Object.assign(E.look, k === "hook" ? {hook_x: nx, hook_y: y} : {x: nx, y});
  const m = el.querySelector(".ed-posmark"); if (m) { m.style.left = nx + "%"; m.style.top = y + "%"; }
  E.lookTouched = true; k === "hook" ? showHook() : showCaptions();
}
dlg_on("pointerdown", e => {
  const el = e.target.closest(".ed-posmini"); if (!el) return;
  e.preventDefault(); miniDrag = el; el.setPointerCapture?.(e.pointerId); miniSet(e, el);
});
dlg_on("pointermove", e => { if (miniDrag) miniSet(e, miniDrag); });
dlg_on("pointerup", () => { if (!miniDrag) return; miniDrag = null; after("p"); });
/* moving the hook or the captions: drag them on the video, anywhere. Right in the middle across (or down) they snap
   to it and a guide line shows. A click without moving still opens their settings. */
let posDrag = null;
$("#clipdlg").addEventListener("pointerdown", e => {
  const el = e.target.closest("#edHookBox, #edCap"); if (!el || E.view !== "live") return;
  const ph = $e("#edPhone").getBoundingClientRect(), hook = el.id === "edHookBox", L = E.look, g = geo(E.layout, E.sw, E.sh);
  posDrag = {hook, sx: e.clientX, sy: e.clientY, pw: ph.width, ph: ph.height, moved: false,
    x0: hook ? (L.hook_x ?? 50) : (L.x ?? 50), y0: hook ? (L.hook_y ?? g.hook / OUT_H * 100) : (L.y ?? g.cap / OUT_H * 100)};
  el.setPointerCapture(e.pointerId);
});
$("#clipdlg").addEventListener("pointermove", e => {
  const d = posDrag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  d.moved = true;
  let x = Math.max(8, Math.min(92, d.x0 + (e.clientX - d.sx) / d.pw * 100));
  let y = Math.max(d.hook ? 5 : 8, Math.min(d.hook ? 95 : 92, d.y0 + (e.clientY - d.sy) / d.ph * 100));
  if (Math.abs(x - 50) < 2.5) x = 50;
  if (Math.abs(y - 50) < 1.5) y = 50;
  x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10;
  if (d.hook) Object.assign(E.look, {hook_x: x, hook_y: y}); else Object.assign(E.look, {x, y});
  $e("#edGuideV")?.classList.toggle("on", x === 50); $e("#edGuideH")?.classList.toggle("on", y === 50);
  E.lookKey = JSON.stringify(E.look); E.lastKey = ""; paintOverlay();
});
$("#clipdlg").addEventListener("pointerup", () => {
  const d = posDrag; posDrag = null; if (!d) return;
  $$e(".ed-guide.on").forEach(x => x.classList.remove("on"));
  if (d.moved) { E.justMoved = Date.now(); E.lookTouched = true; after("p"); }
});
let rgDrag = null;
$("#clipdlg").addEventListener("pointerdown", e => {
  const box = e.target.closest(".ed-rg"); if (!box) return;
  e.preventDefault();
  const pick = box.parentElement.getBoundingClientRect(), k = box.dataset.rg;
  const r0 = k === "frame" ? [...(E.look.frame || frameDefault())] : [...splitOf()[k]];
  rgDrag = {k, resize: !!e.target.closest(".rz"), x0: e.clientX, y0: e.clientY, r0, pw: pick.width, ph: pick.height};
  box.setPointerCapture(e.pointerId);
});
$("#clipdlg").addEventListener("pointermove", e => {
  if (!rgDrag) return;
  const d = rgDrag, dx = (e.clientX - d.x0) / d.pw, dy = (e.clientY - d.y0) / d.ph;
  let [x, y, w, h] = d.r0;
  // Fill screen: the box keeps the clip's shape, so what it shows is exactly what fills the frame
  const lock = d.k === "frame" && E.layout === "crop" && E.sw && E.sh ? E.sw * OUT_H / (OUT_W * E.sh) : 0;
  if (d.resize) {
    w = Math.max(0.08, Math.min(1 - x, w + dx));
    if (lock) { h = w * lock; if (y + h > 1) { h = 1 - y; w = h / lock; } } else h = Math.max(0.08, Math.min(1 - y, h + dy));
  } else { x = Math.max(0, Math.min(1 - w, x + dx)); y = Math.max(0, Math.min(1 - h, y + dy)); }
  const r = [x, y, w, h].map(n => Math.round(n * 1e4) / 1e4);
  if (d.k === "frame") E.look.frame = r; else E.look.split = {...rawSplit(), [d.k]: r};
  placeRegions(); placeSplit();
});
$("#clipdlg").addEventListener("pointerup", () => { if (rgDrag) { rgDrag = null; E.lookTouched = true; after(""); } });
/* phones: the editor works like an editing app. The video and the film strip stay on screen; a tool's settings
   (or the script) slide up from the bottom over them, and Done or a tap above puts them away. */
const phone = () => matchMedia("(max-width:760px)").matches;
function syncSheet() {
  const ed = $e(".ed"); if (!ed) return;
  ed.dataset.sheet = E.sheet || "";
  $$e(".ed-rail [data-ed=sheet]").forEach(b => b.setAttribute("aria-selected", String(E.sheet === b.dataset.v)));
}
/* the person's brand on the preview: built once per change, then moved every frame exactly like render.brand_overlay */
function paintBrand(t, phone, k) {
  const el = $e("#edBrand"); if (!el) return;
  const L = E.look, text = (L.brand_text || "").trim(), logo = L.brand_logo !== false && E.logoV;
  const social = L.brand_kind === "social", wm = social ? wmHtml(L, k, E.logoV) : "";
  const on = !!L.brand_on && (social ? !!wm : !!(text || logo));
  el.hidden = !on; if (!on) return;
  const size = (L.brand_size || 84) * k;
  const key = social ? "s|" + wm : [text, logo, size.toFixed(2), E.logoV].join("|");
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    if (social) { el.innerHTML = wm; el.style.gap = "0"; el.style.padding = "0"; }     // the social watermark brings its own padding
    else {
      el.innerHTML = (logo ? `<img src="/api/brand/logo?v=${E.logoV}" alt="" style="height:${size}px">` : "") +
        (text ? `<span style="font-size:${Math.max(18, size / k * 0.42) * k}px">${esc(text)}</span>` : "");
      el.style.gap = logo && text ? `${size * 0.22}px` : "0";
      el.style.padding = `${8 * k}px`;
    }
  }
  const W = phone.clientWidth, Hh = phone.clientHeight, w = el.offsetWidth, h = el.offsetHeight, m = 54 * k;
  const pos = L.brand_pos || "tr", anim = L.brand_anim || "float";
  let x = pos[1] === "l" ? m : pos[1] === "c" ? (W - w) / 2 : W - w - m;
  let y = pos[0] === "t" ? (54 + 20) * k : Hh - h - (54 + 60) * k;
  let a = (L.brand_op ?? 90) / 100;
  if (anim === "float") y += 10 * k * Math.sin(2 * Math.PI * t / 2.6);
  else if (anim === "slide") {
    const s = Math.pow(Math.max(0, 1 - t / 0.7), 3);
    if (pos[1] === "l") x -= (m + w) * s; else if (pos[1] === "r") x += (m + w) * s;
    else y += (pos[0] === "t" ? -1 : 1) * ((pos[0] === "t" ? 74 : 114) * k + h) * s;
  } else if (anim === "drift") x = m + (W - w - 2 * m) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / 14));
  else if (anim === "fade") a *= Math.min(1, Math.max(0, t / 0.8));
  el.style.transform = `translate(${x}px,${y}px)`;
  el.style.opacity = a;
}
async function uploadLogo(file) {
  if (!file) return;
  if (file.size > 4e6) return toast("That image is too big. Use one under 4 MB.", "bad");
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await api("/api/brand/logo", {method: "POST", body: fd});
    E.logoV = r.logo; E.look.brand_on = true; E.look.brand_logo = true; E.lookTouched = true;
    toast("Logo added", "ok"); after("p"); paintOverlay();
  } catch (er) { toast(er.message, "bad"); }
}
function paintOverlay(t = nowT()) {
  if (E.view !== "live") return;
  const cap = $e("#edCap"), hook = $e("#edHookBox"), phone = $e("#edPhone");
  if (!cap || !phone) return;
  const k = phone.clientWidth / OUT_W, L = E.look, H = hookOf(L), g = geo(E.layout, E.sw, E.sh);
  paintFx(t, phone);
  paintBrand(t - E.start, phone, k);
  paintPics(t, phone, k);
  if (E.layout === "split") { placeSplit(); syncSplit(); } else placeFg();
  applyZoom(t, phone);
  const ls = lines();
  let gi = -1;
  for (let i = 0; i < ls.length; i++) {
    const first = E.words[ls[i][0]], last = E.words[ls[i][ls[i].length - 1]];
    const endG = Math.min(last.e + 0.25, i + 1 < ls.length ? E.words[ls[i + 1][0]].s : E.end);
    if (t >= first.s && t < endG) { gi = i; break; }
  }
  let act = -1;
  if (gi >= 0) ls[gi].forEach((wi, n) => { if (E.words[wi].s <= t) act = n; });
  if (gi !== E.gi) markLine(gi);
  const wi = gi >= 0 && act >= 0 ? ls[gi][act] : -1;
  if (wi !== E.wi) markWord(wi);
  const hookNow = t < hookEnd();       // a hook with a set time leaves the screen after it
  const typing = gi >= 0 && E.editG === gi && E.editText != null;    // the line being typed shows as it is typed
  const shown = gi < 0 ? [] : typing ? E.editText.trim().split(/\s+/).filter(Boolean) : ls[gi].map(i => E.words[i].w);
  if (typing) act = shown.length - 1;
  const key = [gi, act, k.toFixed(3), E.lookKey, E.hook, E.layout, hookNow, shown.join(" ")].join("|");
  if (key === E.lastKey) return;
  E.lastKey = key;
  const fc = fontCss(L.font, L.weight);
  const y = L.y == null ? g.cap / OUT_H * 100 : L.y;
  // the renderer's spacing (a space plus room for both outlines) and its soft half-black shadow, at preview scale
  const gapPx = (0.26 * emOf(L.font) * L.size + L.outline + 2 + (L.wgap || 0) + (L.italic ? L.size * 0.14 : 0)) * k;   // a normal space, as the render does
  const capBox = L.cap_op > 0 ? `background:${rgba(L.cap_box || "#000000", L.cap_op)};padding:${0.12 * emOf(L.font) * L.size * k}px ${0.3 * L.size * k}px;border-radius:${(L.cap_round ?? 18) * k}px;` : "";
  cap.style.cssText = `top:${y}%;left:${L.x ?? 50}%;font-family:${fc.family};font-weight:${fc.weight};font-size:${L.size * emOf(L.font) * k}px;color:${L.base};` +
    `font-style:${L.italic ? "italic" : "normal"};text-decoration:${L.underline ? "underline" : "none"};text-underline-offset:.12em;` +
    `-webkit-text-stroke:${L.outline * 2 * k}px #000;column-gap:${gapPx}px;letter-spacing:${(L.sp || 0) * k}px;${capBox}text-shadow:${CAP_SHADOW * k}px ${CAP_SHADOW * k}px 0 rgba(0,0,0,.5);`;
  cap.innerHTML = shown.map((w, n) => { w = w.replace(/[.,;:]+$/, "");
    w = L.upper ? w.toUpperCase() : n === 0 ? w.replace(/^\p{Ll}/u, c => c.toUpperCase()) : w;     // normal case: each line starts with a capital
    return `<span class="${n === act ? "on" : ""}" style="${n === act ? `color:${L.active}` : ""}">${esc(w)}</span>`; }).join("");
  cap.style.transform = "translate(-50%,-50%)";
  const maxW = phone.clientWidth * 960 / OUT_W;
  if (cap.scrollWidth > maxW) cap.style.transform = `translate(-50%,-50%) scale(${maxW / cap.scrollWidth})`;
  keepInside(cap, L.x, 24 * k, phone);
  if (hook) {
    const hf = fontCss(H.hook_font, L.hook_weight);
    hook.hidden = !L.hook || !E.hook.trim() || E.layout === "card";     // the post card shows the words on the card instead
    // the same lines as the video: one line, or two split where they come out most even (render._hook_events)
    const px = H.hook_size * emOf(H.hook_font), mc = hookMeasure(), ban = L.hook_banner || "fit";
    mc.font = `${L.hook_italic ? "italic " : ""}${hf.weight} ${px}px ${hf.family}, sans-serif`;
    // an emoji counts as about one letter-height wide, as in the video (render._hook_events leaves that gap)
    const wd = t => { const n = (t.match(emojiRe()) || []).length, r = t.replace(emojiRe(), ""); return mc.measureText(r).width + n * px * 1.08 + H.hook_sp * Math.max(0, r.length + n - 1); };
    const ws = hookCase(E.hook.trim(), L.hook_case || "asis").split(/\s+/);
    let hl = [ws.join(" ")];
    if (wd(hl[0]) * 0.6 > 940 && ws.length > 1) {        // one line unless it would get too small to read (render._hook_events)
      const worst = ws.slice(1).map((_, j) => Math.max(wd(ws.slice(0, j + 1).join(" ")), wd(ws.slice(j + 1).join(" "))));
      const lo = Math.min(...worst), best = worst.reduce((b, m, j) => m <= lo * 1.03 ? j + 1 : b, 1);   // near ties go to the fuller top line, as the video does
      hl = [ws.slice(0, best).join(" "), ws.slice(best).join(" ")];
    }
    const shrink = Math.min(1, 940 / Math.max(...hl.map(wd)));      // still too wide: smaller, as the video does
    hook.innerHTML = ban === "line" ? hl.map(l => `<span class="hl" style="background:${H.hook_op ? rgba(H.hook_box, H.hook_op) : "transparent"};padding:${12 * k}px ${40 * k}px;border-radius:${H.hook_round * k}px">${withEmoji(l)}</span>`).join("<br>")
      : hl.map(withEmoji).join("<br>");
    hook.classList.toggle("perline", ban === "line");
    hook.style.cssText = `top:${H.hook_y == null ? g.hook / OUT_H * 100 : H.hook_y}%;left:${L.hook_x ?? 50}%;font-family:${hf.family};font-weight:${hf.weight};` +
      `font-style:${L.hook_italic ? "italic" : "normal"};text-decoration:${L.hook_underline ? "underline" : "none"};text-underline-offset:.12em;` +
      `font-size:${px * shrink * k}px;padding:${ban === "line" ? 0 : 24 * k}px ${ban === "line" ? 0 : 40 * k}px;border-radius:${ban === "full" ? 0 : H.hook_round * k}px;` +
      `width:${ban === "full" ? "100%" : "max-content"};max-width:${ban === "full" ? "none" : 1020 * k + "px"};box-sizing:border-box;white-space:nowrap;` +
      `background:${H.hook_op && ban !== "line" && ban !== "none" ? rgba(H.hook_box, H.hook_op) : "transparent"};color:${H.hook_ink};letter-spacing:${H.hook_sp * k}px;` +
      (H.hook_op < 35 || ban === "none" ? `-webkit-text-stroke:${Math.max(3, H.hook_size / 22) * 2 * k}px #000;paint-order:stroke fill;text-shadow:${CAP_SHADOW * k}px ${CAP_SHADOW * k}px 0 rgba(0,0,0,.5);` : "") +
      `opacity:${hookNow ? 1 : 0};pointer-events:${hookNow ? "auto" : "none"}`;
    keepInside(hook, L.hook_x, 12 * k, phone);
  }
}

/* the caption being spoken lights up in the subtitles and on the timeline, the word in the transcript;
   the list follows along while it plays */
function keepInView(row) {
  const panel = $e("#edTxBody"), v = vid();          // the transcript card scrolls to keep the spoken part in sight
  if (!row || !panel || !panel.contains(row) || !v || v.paused || panel.contains(document.activeElement)) return;
  const r = row.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  if (r.top < pr.top + 120 || r.bottom > pr.bottom - 24) panel.scrollTo({top: panel.scrollTop + r.top - pr.top - pr.height / 3, behavior: "smooth"});
}
function markLine(gi) {
  E.gi = gi;
  const cn = $e("#edCapNow");            // the caption track's name shows how many lines there are
  if (cn) cn.textContent = String(lines().length);
  $$e(".ed-line.on, .ed-chip.on").forEach(x => x.classList.remove("on"));
  if (gi < 0) return;
  $e(`.ed-chip[data-g="${gi}"]`)?.classList.add("on");
  const row = $e(`.ed-line[data-g="${gi}"]`);
  if (row) { row.classList.add("on"); keepInView(row); }
}
function markWord(wi) {
  E.wi = wi;
  $e(".tw.on")?.classList.remove("on");
  if (wi < 0) return;
  const w = $e(`.tw[data-i="${wi}"]`);
  if (w) { w.classList.add("on"); keepInView(w); }
}

/* the chat lane: how busy chat was along the timeline, with its spikes. A spike jumps to 20 s before it,
   where the moment chat reacted to begins. */
function chatLane() {
  const ch = E.chat; if (!ch || !ch.counts?.length) return "";
  const span = E.max - E.min, bars = Math.min(240, Math.max(20, Math.round(span / 5))), per = span / bars;
  const vals = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(E.min + i * per - ch.from), b = Math.max(a + 1, Math.floor(E.min + (i + 1) * per - ch.from));
    let s = 0; for (let k = Math.max(0, a); k < Math.min(ch.counts.length, b); k++) s += ch.counts[k];
    vals.push(s / Math.max(1, b - a));
  }
  const top = Math.max(...vals, 0.01);
  return `<div class="ed-lane chat" title="Chat activity">
    <svg viewBox="0 0 ${bars} 20" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => v > 0 ? `<rect x="${i + 0.12}" y="${20 - Math.max(1, v / top * 20)}" width="0.76" height="${Math.max(1, v / top * 20)}"/>` : "").join("")}</svg>
    ${(ch.spikes || []).filter(t => t >= E.min && t <= E.max).map(t => `<button class="ed-spike" data-ed="seek" data-at="${Math.max(E.min, t - 20)}" style="left:${pct(t)}%" title="Chat spike: jump to the moment">${ic("chat")}</button>`).join("")}
  </div>`;
}

/* ---------- the timeline */
const pct = t => (Math.max(E.min, Math.min(E.max, t)) - E.min) / Math.max(0.1, E.max - E.min) * 100;
// times on the ruler and in the time box: 00:20, or 1:02:20 past an hour
const clock = (t, tenths) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return (h ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${ss}`; };
const EYE = on => svg(on ? '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  : '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.1 3.9M6.6 6.6A17.7 17.7 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');
const SOUND = on => on ? ri("ed_audio", '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>')
  : ri("ed_mute", '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>');
function drawTimeline() {
  const tl = $e("#edTl"), c = clipNow(); if (!tl || !c) return;
  const span = E.max - E.min, want = span / (8 * E.zoom), step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s >= want) || 600;
  const ticks = []; for (let s = 0; s <= span; s += step) ticks.push(`<span style="left:${s / span * 100}%">${clock(s)}</span>`);
  const chips = lines().map((g, gi) => { const a = E.words[g[0]], b = E.words[g[g.length - 1]], text = esc(g.map(i => E.words[i].w).join(" "));
    return `<button class="ed-chip" data-ed="seek" data-g="${gi}" data-at="${a.s}" style="left:${pct(a.s)}%;width:${Math.max(0.4, pct(b.e) - pct(a.s))}%" title="${text}"><span>${text}</span></button>`; }).join("");
  E.gi = -1; E.shownPaused = null; E.shownNow = "";
  const hasHook = !!E.hook.trim(), fx = (EFFECTS.find(x => x[0] === (E.look.effect || "none")) || EFFECTS[0])[1];
  // one row per track: its name on the left, its blocks on the right. The rows on both sides share one height.
  const head = (cls, icon, name, ctl = "") => `<div class="ed-th ${cls}"><span class="ed-ti">${icon}</span><b>${name}</b>${ctl}</div>`;
  tl.classList.toggle("folded", !!E.tlHidden);
  const dm = $e("#edDurM"); if (dm) dm.textContent = ts(keptLen());   // the phone's play row shows the length after cuts too
  tl.innerHTML = `<div class="ed-tl-head">
      <div class="ed-zoom"><button class="ed-tltog" data-ed="tltog" aria-expanded="${!E.tlHidden}" title="${E.tlHidden ? "Show the timeline" : "Hide the timeline for a bigger preview"}">
          ${svg(E.tlHidden ? '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h4"/>' : '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h4M9 9l3-3 3 3"/>')}<span>${E.tlHidden ? "Show timeline" : "Hide timeline"}</span></button>
        <span class="ed-tlsep"></span><button class="ed-ib sm" data-ed="zoom" data-d="-1" aria-label="Zoom out">${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10h6M21 21l-6-6"/>')}</button>
        <input type="range" id="edZoom" min="1" max="${E.zmax || 8}" step="0.5" value="${E.zoom}" aria-label="Zoom the timeline">
        <button class="ed-ib sm" data-ed="zoom" data-d="1" aria-label="Zoom in">${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10h6M10 7v6M21 21l-6-6"/>')}</button></div>
      <div class="ed-play"><span class="ed-now" id="edNow">0:00.0</span>
        <button class="ed-pbtn" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
        <span class="ed-dur" title="${E.cuts?.length ? "Length after Speech cleanup" : "Length"}">${ts(keptLen())}</span></div>
      <div class="ed-tl-right"><button class="ed-rate" data-ed="rate" title="Playback speed">${E.rate}x</button></div>
    </div>
    <div class="ed-tlw">
      <div class="ed-heads">
        <div class="ed-tbox" id="edNow2">${clock(nowT() - E.start, true)}</div>
        <div class="ed-thp">
          ${head("hook", TEXT_IC, "Hook", hasHook ? `<button class="ed-tb" data-ed="hookvis" aria-pressed="${!!E.look.hook}" title="${E.look.hook ? "Hide" : "Show"} the hook">${EYE(E.look.hook)}</button>` : "")}
          ${head("caps", ic("cc"), `Captions <small class="ed-thn" id="edCapNow">${lines().length}</small>`)}
          ${(E.look.overlays || []).length ? head("pics", PIC_IC, "Pictures") : ""}
          ${head("music", MUSIC_IC, "Music", `<button class="ed-tb" data-ed="tab" data-t="audio" title="Add or change the music" aria-label="Music">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${head("zooms", ZOOM_IC, "Zooms", `<button class="ed-tb" data-ed="zoomadd" title="Add a zoom at the playhead (Z)" aria-label="Add a zoom">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${E.chat?.counts?.length ? head("chat", ic("chat"), "Chat") : ""}
          ${head("film", ic("film"), "Video", `<button class="ed-tb" data-ed="mute" aria-pressed="${!E.muted}" title="${E.muted ? "Turn the preview's sound on" : "Mute the preview"}">${SOUND(!E.muted)}</button>`)}
        </div>
      </div>
      <div class="ed-scroll" id="edScroll">
        <div class="ed-track" id="edTrack" style="width:${E.zoom * 100}%">
          <div class="ed-ruler">${ticks.join("")}</div>
          <div class="ed-lanes" style="--gs:${step / span * 100}%">
            <div class="ed-lane hook">${hasHook ? `<button class="ed-hchip ${E.look.hook ? "" : "off"}" data-ed="tab" data-t="text" style="left:${pct(E.start)}%;width:${pct(hookEnd()) - pct(E.start)}%"><i>${TEXT_IC}</i><span>Hook: ${esc(E.hook)}</span></button>` : ""}
              ${fx !== "None" ? `<button class="ed-fxchip" data-ed="tab" data-t="fx" style="left:${pct(hookEnd())}%;width:${Math.max(6, pct(E.end) - pct(hookEnd()))}%"><i>${FX_IC}</i><span>Filter: ${esc(fx)}</span></button>` : ""}</div>
            <div class="ed-lane caps"><i class="ed-cbar" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"></i>${chips}</div>${picsLane()}${musicLane()}${zoomsLane()}${chatLane()}
            <div class="ed-lane film" style="background-image:url('/media/${E.jid}/thumb.jpg'),url('/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}')">
              <div class="ed-shade l" style="width:${pct(E.start)}%"></div><div class="ed-shade r" style="left:${pct(E.end)}%"></div>
              ${(E.cuts || []).map(([a, b]) => `<i class="ed-cutmark" style="left:${pct(a)}%;width:${Math.max(0.2, pct(b) - pct(a))}%" title="Cut by Speech cleanup"></i>`).join("")}
              <div class="ed-win" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"><i class="ed-hd" data-h="start"></i><i class="ed-hd" data-h="end"></i></div>
              ${outroOf().on ? `<button class="ed-outchip" data-ed="outrojump" title="The outro plays here, after the clip" style="left:${pct(E.end)}%;width:${Math.max(3, pct(Math.min(E.max, E.end + outroOf().secs)) - pct(E.end))}%">
                <span>Outro · ${outroOf().secs} s</span></button>` : ""}
            </div>
          </div>
          <div class="ed-head" id="edHead"></div>
        </div>
      </div>
      <div class="ed-meter" title="Sound level of the preview, left and right">
        <div class="ed-mscale">${[0, -10, -20, -30, -40, -50].map(db => `<span style="top:${-db / 60 * 100}%">${db}</span>`).join("")}<span class="db">dB</span></div>
        <div class="ed-mbars"><i id="edMeterL"></i><i id="edMeterR"></i></div>
        <div class="ed-mlr"><span>L</span><span>R</span></div>
      </div>
    </div>`;
  const sc = $e("#edScroll");
  if (sc && E.zoom > 1) sc.scrollLeft = pct(nowT()) / 100 * sc.scrollWidth - sc.clientWidth / 3;
}
function setZoom(z) {
  E.zoom = Math.max(1, Math.min(E.zmax || 8, Math.round(z * 2) / 2));
  drawTimeline();
}
// one zoom step: half a step at low zoom, a fifth of the current zoom when far in, so it never feels slow
const zoomStep = dir => setZoom(E.zoom + dir * Math.max(0.5, E.zoom * 0.2));
// the clip in the middle of the timeline's view
function centreTimeline() {
  const sc = $e("#edScroll"); if (!sc) return;
  const mid = (pct(E.start) + pct(E.end)) / 200;
  sc.scrollLeft = Math.max(0, mid * sc.scrollWidth - sc.clientWidth / 2);
}

/* ---------- what's new: a short tour of the editor's new tools, a card pointing at each one in turn.
   Shown once; the ? in the top bar plays it again. */
const TOUR = [
  {sel: '.ed-rail [data-t="clean"]', t: "One tool. Cleaner speech.", x: "Take out filler words and long pauses in one click, and see exactly what got cut.", art: "clean"},
  {sel: "#edTxCard .ed-ptools", t: "New script tools are here", x: "Search the words, hide what was cut, and download the script in one click.", art: "script"},
  {sel: '[data-ed="fs"]', t: "Watch it full screen", x: "See the clip the way viewers will. Press Esc to come back.", art: "fs"},
  {sel: '.ed-rail [data-t="audio"]', t: "Turn the sound up or down", x: "Set how loud the clip is, and watch the level beside the timeline as it plays.", art: "audio"},
  {sel: '[data-ed="tltog"]', t: "More room for the preview", x: "Hide the timeline when you don't need it, and bring it back with one click.", art: "tl"},
];
const TOUR_KEY = "ed_tour_v1";
function tourArt(k) {
  if (k === "clean") return `<div class="tr-art clean">${["uhm, um", "0.4s", "you know", "0.2s", "like"].map((w, i) => `<span class="${i % 2 ? "p" : "w"}">${w}</span>`).join("")}</div>`;
  if (k === "script") return `<div class="tr-art script"><i></i><i class="hl"></i><i></i><b>${ic("search")}</b></div>`;
  const icon = {fs: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), audio: SOUND(true), tl: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h4"/>')}[k];
  return `<div class="tr-art icon"><span>${icon}</span></div>`;
}
function tourShow(i) {
  $e("#edTour")?.remove();
  try { localStorage.setItem(TOUR_KEY, "1"); } catch {}      // seen once is enough: it won't open by itself again
  const steps = TOUR.filter(s => $e(s.sel));
  if (i >= steps.length) { try { localStorage.setItem(TOUR_KEY, "1"); } catch {} return; }
  const s = steps[i], a = $e(s.sel).getBoundingClientRect();
  const el = document.createElement("div");
  el.id = "edTour"; el.className = "ed-tour"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", s.t);
  el.innerHTML = `${tourArt(s.art)}<h4>${esc(s.t)}</h4><p>${esc(s.x)}</p>
    <div class="tr-foot"><span>Step: ${i + 1}/${steps.length}</span><button data-ed="tourexit">Exit</button><button class="nx" data-ed="tournext" data-i="${i + 1}">${i + 1 === steps.length ? "Done" : "Next"}</button></div>`;
  $e(".ed").append(el);
  const w = el.offsetWidth, h = el.offsetHeight, side = a.left < 90;          // rail tools: the card sits to the right
  let left, top, arrow;
  if (side) { left = a.right + 14; top = Math.min(innerHeight - h - 12, Math.max(12, a.top + a.height / 2 - 40)); arrow = "left"; }
  else {
    left = Math.max(12, Math.min(innerWidth - w - 12, a.left + a.width / 2 - w / 2));
    top = a.bottom + 14; arrow = "top";
    if (top + h > innerHeight - 12) { top = a.top - h - 14; arrow = "bottom"; }
  }
  el.style.left = left + "px"; el.style.top = top + "px"; el.dataset.arrow = arrow;
  el.style.setProperty("--ax", (side ? 0 : a.left + a.width / 2 - left) + "px");
  el.style.setProperty("--ay", (side ? a.top + a.height / 2 - top : 0) + "px");
  requestAnimationFrame(() => el.classList.add("on"));
}
function tourEnd() { $e("#edTour")?.remove(); try { localStorage.setItem(TOUR_KEY, "1"); } catch {} }

/* ---------- changes */
function setTrim(k, v) {
  v = Math.round(v * 20) / 20;
  if (k === "start") E.start = Math.max(E.min, Math.min(v, E.end - 3));
  else E.end = Math.min(E.max, Math.max(v, E.start + 3));
  if (E.end - E.start > 180) { if (k === "start") E.end = E.start + 180; else E.start = E.end - 180; }
}
function aspClose() { document.querySelectorAll("#clipdlg > .ed-aspop").forEach(x => x.remove()); }
function dlg_on(type, fn) { $("#clipdlg").addEventListener(type, fn); }   // safe to use above where `dlg` is set
/* one word of the transcript, fixed in place: a new spelling, several words for a missing one (they share its time),
   or nothing to remove it. The captions follow straight away. */
function editWord(i, text) {
  const w = E.words[i]; if (!w) return;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && tokens[0] === w.w) return;
  const d = (w.e - w.s) / Math.max(1, tokens.length);
  E.words.splice(i, 1, ...tokens.map((t, n) => ({...w, w: t, s: +(w.s + n * d).toFixed(2), e: +(w.s + (n + 1) * d).toFixed(2)})));
  E.edited = true; wordsChanged();
}
// a double click on the captions in the preview opens their settings: Captions, Customize, font and size unfolded
dlg_on("dblclick", e => {
  if (!e.target.closest("#edCap") || E.view !== "live") return;
  e.preventDefault();
  E.tab = "style"; E.stab = "settings"; E.shut?.delete("text");
  if (phone()) { E.sheet = "panel"; syncSheet(); }
  drawPanel();
  $e("#edPanel")?.scrollTo({top: 0, behavior: "smooth"});
});
dlg_on("dblclick", e => {
  const sp = e.target.closest("#edTx .tw"); if (!sp || sp.querySelector("input")) return;
  e.preventDefault();
  const i = +sp.dataset.i, w = E.words[i]; if (!w) return;
  const inp = document.createElement("input");
  inp.className = "tw-edit"; inp.value = w.w; inp.setAttribute("aria-label", "Fix this word");
  inp.style.width = Math.max(4, w.w.length + 2) + "ch";
  sp.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = keep => {
    if (done) return; done = true;
    if (keep) { editWord(i, inp.value); E.lastKey = ""; after("t"); }
    drawTx();
  };
  inp.addEventListener("input", () => { inp.style.width = Math.max(4, inp.value.length + 2) + "ch"; });
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); finish(true); } else if (ev.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
});
function editLine(gi, text) {
  const g = lines()[gi]; if (!g) return;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const old = g.map(i => E.words[i]);
  let fresh;
  if (tokens.length === old.length) fresh = old.map((w, n) => ({...w, w: tokens[n]}));
  else {
    const a = old[0].s, b = old[old.length - 1].e, d = (b - a) / Math.max(1, tokens.length);
    fresh = tokens.map((w, n) => ({w, s: +(a + n * d).toFixed(2), e: +(a + (n + 1) * d).toFixed(2)}));
  }
  E.words.splice(g[0], g.length, ...fresh);
  E.edited = true; wordsChanged();
}
function srtOut() {
  const t = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")},${String(Math.min(999, ms)).padStart(3, "0")}`; };
  const ls = lines();
  return ls.map((g, i) => { const a = E.words[g[0]].s, b = Math.min(E.words[g[g.length - 1]].e + 0.25, i + 1 < ls.length ? E.words[ls[i + 1][0]].s : E.end);
    return `${i + 1}\n${t(a - E.start)} --> ${t(b - E.start)}\n${g.map(x => E.words[x].w).join(" ")}\n`; }).join("\n");
}
function srtIn(text) {
  const sec = s => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN; };
  const words = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const ln = block.trim().split("\n"); const at = ln.findIndex(l => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = ln[at].split("-->").map(sec);
    const tokens = ln.slice(at + 1).join(" ").replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean);
    if (!tokens.length || !isFinite(a) || !isFinite(b) || b <= a) continue;
    const d = (b - a) / tokens.length;
    tokens.forEach((w, n) => words.push({w: w.slice(0, 40), s: +(E.start + a + n * d).toFixed(2), e: +(E.start + a + (n + 1) * d).toFixed(2)}));
  }
  return words;
}
const keepAuto = () => { if (!E.edited && !E.auto.length) E.auto = clone(E.words); };
function after(what) {          // redraw what a change affects
  E.lookKey = JSON.stringify(E.look);
  if (what.includes("p")) drawPanel();
  if (what.includes("t")) drawTimeline();
  E.lastKey = ""; paintOverlay(); drawClipDlg();
  histMark();
}
/* ---------- undo and redo: every change to the clip (trim, words, hook, layout, look, cuts) is a step. A step is
   written a moment after the change settles, so dragging a slider is one step, not fifty. Up to 100 steps per clip;
   they last while the clip is open. Undoing also saves, like any other change. */
const histState = () => JSON.stringify({s: E.start, e: E.end, h: E.hook, t: E.title, d: E.description, l: E.layout, k: E.look,
  w: E.edited ? E.words : null, ed: !!E.edited, c: E.cuts || [], lt: !!E.lookTouched});
function histReset() { clearTimeout(E.histT); E.hist = {list: [histState()], at: 0}; drawUndo(); }
function histMark() { if (!E.hist) return; clearTimeout(E.histT); E.histT = setTimeout(histPush, 350); }
function histPush() {
  const H = E.hist; if (!H || !E.cid) return;
  clearTimeout(E.histT);
  const s = histState();
  if (H.list[H.at] === s) return;
  H.list = H.list.slice(0, H.at + 1); H.list.push(s);
  if (H.list.length > 100) H.list.shift();
  H.at = H.list.length - 1; drawUndo();
}
function histGo(d) {
  const H = E.hist; if (!H) return;
  histPush();                               // a change still settling counts as the latest step
  const i = H.at + d; if (i < 0 || i >= H.list.length) return;
  H.at = i;
  const x = JSON.parse(H.list[i]);
  Object.assign(E, {start: x.s, end: x.e, hook: x.h, title: x.t, description: x.d, layout: x.l, look: x.k, cuts: x.c, edited: x.ed, lookTouched: x.lt});
  if (x.ed) E.words = x.w; else if (E.auto?.length) E.words = clone(E.auto);
  wordsChanged(); setFrame(); E.fgKey = ""; E.linesKey = "";
  drawPanel(); drawStage(); drawTimeline(); drawTx(); after(""); drawUndo();
  toast(d < 0 ? "Undone" : "Redone", "ok");
}
function drawUndo() {
  const H = E.hist, u = $e("#edUndo"), r = $e("#edRedo");
  if (u) u.disabled = !H || H.at <= 0;
  if (r) r.disabled = !H || H.at >= H.list.length - 1;
}
// the keyboard shortcuts, also listed in the editor (the keyboard button at the top, or press ?)
const KEYS = [["Space", "Play or pause"], ["Ctrl Z", "Undo"], ["Ctrl Shift Z", "Redo (also Ctrl Y)"], ["Ctrl S", "Save now"],
  ["Ctrl Enter", "Render the clip"], ["I", "Start the clip here"], ["O", "End the clip here"], ["← →", "Back or forward 1 second"],
  ["Shift ← →", "Back or forward 5 seconds"], [", .", "One frame back or forward"], ["Home End", "Go to the clip's start or end"],
  ["M", "Sound on or off"], ["Z", "Add a zoom here"], ["F", "Full screen"], ["T", "Templates"], ["?", "This list"], ["Esc", "Close a window"]];
function drawKeys() {
  if (!E.keysOpen) return $e("#edKeys")?.remove();
  if ($e("#edKeys")) return;
  const el = document.createElement("div");
  el.id = "edKeys"; el.className = "ed-tplw";
  el.innerHTML = `<div class="ed-tplbox ed-keysbox" role="dialog" aria-label="Keyboard shortcuts"><header><div><h3>Keyboard shortcuts</h3>
      <p>They work anywhere in the editor except while typing.</p></div><button class="ed-ib" data-ed="keysclose" aria-label="Close">${ic("x")}</button></header>
    <dl class="ed-keys">${KEYS.map(([k, l]) => `<dt>${k.split(" ").map(x => `<kbd>${esc(x)}</kbd>`).join("")}</dt><dd>${esc(l)}</dd>`).join("")}</dl></div>`;
  el.addEventListener("click", e => { if (e.target === el) { E.keysOpen = false; drawKeys(); } });
  $e(".ed").append(el);
}
function changes() {
  const body = {start: E.start, end: E.end, hook: E.hook, title: E.title, description: E.description, layout: E.layout,
    captions: E.edited ? E.words : null, cuts: E.cuts || []};
  if (E.lookTouched) body.look = E.look;
  return body;
}
// render the clip with everything as it is now and wait until the video is made (used by Export)
async function renderNow() {
  const jid = E.jid, cid = E.cid, v0 = clipNow()?.version || 0;
  clearTimeout(E.asT);
  await send(`/api/jobs/${jid}/clips/${cid}/render`, changes());
  E.saved = snap(); E.waiting = 1;
  for (let i = 0; i < 400; i++) {                // up to 10 minutes; a clip usually takes well under one
    await new Promise(r => setTimeout(r, 1500));
    const c = (await api(`/api/jobs/${jid}`)).clips.find(x => x.id === cid);
    if (c?.status === "error") throw new Error(c.error || "Couldn't make this clip.");
    if (c?.status === "done" && (c.version || 0) > v0) { await tick(); return; }
  }
  throw new Error("The render is taking too long. Try Export again in a minute.");
}
async function save() {          // keep the changes and make the video again with them
  try {
    await send(`/api/jobs/${E.jid}/clips/${E.cid}/render`, changes());
    E.saved = snap(); E.waiting = 1; E.version = clipNow()?.version || E.version;
    toast("Saved. Making your clip…", "ok"); await tick(); drawClipDlg();
  } catch (e) { toast(e.message, "bad"); }
}
async function autoSave() {      // the quiet save after each change: kept on the server, no message unless it fails
  if (!dirty() || E.saving || !$("#clipdlg").open) return;
  E.saving = true;
  try { await send(`/api/jobs/${E.jid}/clips/${E.cid}/save`, changes()); E.saved = snap(); }
  catch (e) { toast("Couldn't save your changes: " + e.message, "bad"); }
  E.saving = false; await tick(); drawClipDlg();
}
async function keep() {          // keep the changes only; the video is made with them on the next render
  try {
    await send(`/api/jobs/${E.jid}/clips/${E.cid}/save`, changes());
    E.saved = snap();
    toast("Saved. Render when you're ready.", "ok"); await tick(); drawClipDlg();
  } catch (e) { toast(e.message, "bad"); }
}

/* ---------- the preview follows what is being edited */
function showAt(t) {              // jump the preview there, in the live preview, without starting it
  if (E.view === "rendered") { E.view = "live"; drawStage(); }
  const v = vid(); if (v && !v.paused) v.pause();
  seek(t); E.lastKey = ""; paintOverlay(t);
}
function showLine(gi) {           // a subtitle line being edited: show it on screen
  const g = lines()[gi]; if (!g) return;
  const t = E.words[g[0]].s + 0.05, now = nowT();
  if (E.gi !== gi || now < E.words[g[0]].s || now > E.words[g[g.length - 1]].e + 0.2) showAt(t);
}
function showHook() {             // the hook being edited: make sure it is on screen
  const t = nowT();
  if (t < E.start || t >= hookEnd() - 0.1) showAt(E.start + 0.1);
}
function showCaptions() {         // a caption style change: show a line if none is on screen
  if (E.gi >= 0) return;
  const g = lines()[0]; if (g) showAt(E.words[g[0]].s + 0.05);
}

/* ---------- events, all inside the editor */
const dlg = $("#clipdlg");
dlg.addEventListener("click", async e => {
  const b = e.target.closest("[data-ed]");
  if (!e.target.closest(".ed-asp, .ed-aspop")) aspClose();
  if (!b) return;
  const a = b.dataset.ed, d = b.dataset;
  if (a === "close") return edClose();
  if (a === "sheet" || a === "sheetclose") {   // phones: the settings and the script slide up from the bottom
    E.sheet = a === "sheet" && E.sheet !== d.v ? d.v : null; return syncSheet();
  }
  if (a === "tab" && b.closest("#edPhone") && Date.now() - (E.justMoved || 0) < 400) return;   // that was a drag, not a click
  if (a === "posreset") {               // back to the automatic spot for this layout, in the middle across
    if (d.k === "hook") Object.assign(E.look, {hook_x: null, hook_y: null}); else Object.assign(E.look, {x: null, y: null});
    E.lookTouched = true; after("p"); return d.k === "hook" ? showHook() : showCaptions();
  }
  if (a === "posy") {
    const k = d.k === "hook"; Object.assign(E.look, k ? {hook_y: +d.v, hook_x: E.look.hook_x ?? 50} : {y: +d.v, x: E.look.x ?? 50});
    E.lookTouched = true; after("p"); return k ? showHook() : showCaptions();
  }
  if (a === "centerx") { E.look[d.k === "hook" ? "hook_x" : "x"] = 50; E.lookTouched = true; after("p"); return d.k === "hook" ? showHook() : showCaptions(); }
  if (a === "tab" && E.view === "frame") { E.view = "live"; drawStage(); }   // a tool's panel needs the live preview beside it
  if (a === "tab") {
    const again = E.tab === d.t && E.sheet === "panel";
    E.tab = d.t;
    if (phone()) { E.sheet = again && b.closest(".ed-rail") ? null : "panel"; syncSheet(); }
    drawPanel();
    if (d.t === "text") setTimeout(() => $e("#edHook")?.focus(), 0);
    return;
  }
  if (a === "ptab") { E.txTab = d.t; return drawTx(); }
  if (a === "capos") {                    // captions at the top, the middle, or their usual place at the bottom
    E.look.y = {top: 22, middle: 50, bottom: null}[d.v]; E.lookTouched = true; after("p"); return showCaptions();
  }
  if (a === "vol") { setVolume(+d.v); return drawPanel(); }
  if (a === "applyall") {                 // this caption look onto every other clip of the video: saved, not rendered
    const job = jobOf(E.jid), others = (job?.clips || []).filter(x => x.id !== E.cid && x.status === "done");
    if (!others.length) return toast("This is the only clip of this video.");
    if (!await ask("Apply this caption style to every clip?", `The captions of the other ${others.length} clips of this video get this font, size, colours and place. Their hooks, effects and sound stay as they are. They are saved, not made again: press Save and render on each to see it in the video.`, "Apply to all")) return;
    const CAP = ["font", "size", "base", "active", "upper", "per", "outline", "y"];
    let done = 0;
    for (const x of others) {
      const look = {...(x.look || lookFromStyle(x.style)), ...Object.fromEntries(CAP.map(k => [k, E.look[k]]))};
      try { await send(`/api/jobs/${E.jid}/clips/${x.id}/save`, {look}); done++; } catch {}
    }
    E.lookTouched = true; drawClipDlg();
    return toast(done === others.length ? `Applied to all ${done} other clips. Save this one too.` : `Applied to ${done} of ${others.length} clips. The rest are busy right now.`, done ? "ok" : "bad");
  }
  if (a === "view") { E.view = d.v; return drawStage(); }
  if (a === "play") return togglePlay();
  if (a === "seek") { if (E.view === "rendered") { E.view = "live"; drawStage(); } return seek(+d.at); }
  if (a === "save") return save();
  if (a === "keep") return keep();
  if (a === "zoom") return zoomStep(+d.d);
  if (a === "fs") {                      // the preview full screen; Esc (or the button) brings it back
    const ph = $e("#edPhone");
    if (document.fullscreenElement) return document.exitFullscreen?.();
    if (document.querySelector(".ed.fsx")) return fsWindow(false);
    if (!ph?.requestFullscreen) return fsWindow(true);
    let done = false;
    ph.requestFullscreen().then(() => { done = true; fsAwake(); }).catch(() => { done = true; fsWindow(true); });
    setTimeout(() => { if (!done && !document.fullscreenElement) fsWindow(true); }, 500);   // ignored without a word: fill the window
    return;
  }
  if (a === "tournext") return tourShow(+d.i);
  if (a === "tourexit") return tourEnd();
  if (a === "tour") return tourShow(0);
  if (a === "cleanapply") {              // take out the filler words and pauses found, on top of what was already cut
    const f = findCuts(); if (!f.all.length) return toast("Nothing to cut with these settings.");
    const next = mergeCuts([...(E.cuts || []), ...f.all]);
    if (E.end - E.start - next.reduce((n, [x, y]) => n + (y - x), 0) < 3) return toast("That would cut almost the whole clip.", "bad");
    E.cuts = next; drawTimeline(); after("p");
    return toast(`Cut ${f.fill.length} filler word${f.fill.length === 1 ? "" : "s"} and ${f.pause.length} pause${f.pause.length === 1 ? "" : "s"}. The clip is now ${ts(keptLen())}.`, "ok");
  }
  if (a === "cleanundo") { E.cuts = []; drawTimeline(); after("p"); return toast("Everything is back in the clip.", "ok"); }
  if (a === "hidecut") { E.hideCut = !E.hideCut; return drawTx(); }
  if (a === "txsearch") {               // the search button: open the field (and put the cursor in it), or close it
    if (E.qOpen || E.q.trim()) { E.qOpen = false; E.q = ""; drawTx(); return; }
    E.qOpen = true; drawTx(); $e("#edQ")?.focus(); return;
  }
  if (a === "txsearchx") { E.qOpen = false; E.q = ""; return drawTx(); }
  if (a === "dlscript") {                // the script as plain text: what is left after the cuts, a paragraph per long pause
    const ws = inClip().map(([w]) => w).filter(w => !wordCut(w));
    let text = ""; ws.forEach((w, i) => { text += (i && w.s - ws[i - 1].e >= 2 ? "\n\n" : i ? " " : "") + w.w; });
    const url = URL.createObjectURL(new Blob([text + "\n"], {type: "text/plain"}));
    const l = document.createElement("a"); l.href = url; l.download = `${(E.title || E.hook || "clip").replace(/[^\w\- ]+/g, "").trim() || "clip"} script.txt`; l.click();
    return setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === "tltog") {                   // fold the timeline down to its play bar, for a bigger preview; remembered
    E.tlHidden = !E.tlHidden;
    try { if (phone()) localStorage.setItem("ed_tl_phone", E.tlHidden ? "hidden" : "shown"); else localStorage.setItem("ed_tl_hidden", E.tlHidden ? "1" : ""); } catch {}
    drawTimeline();
    return requestAnimationFrame(() => { E.lastKey = ""; paintOverlay(); });     // the preview grew: redraw its captions to size
  }
  if (a === "hookvis") { E.look.hook = !E.look.hook; E.lookTouched = true; after("pt"); return E.look.hook && showHook(); }   // the eye on the Hook track
  if (a === "mute") {               // the preview's sound only: the toolbar's speaker and the Video row follow
    E.muted = !E.muted; const v = vid(); if (v) v.muted = E.muted;
    const vb = $e(".ed-volbtn"); if (vb) { vb.setAttribute("aria-pressed", String(E.muted)); vb.innerHTML = SOUND(!E.muted && (E.look.volume ?? 100) > 0); }
    return drawTimeline();
  }
  if (a === "rate") { E.rate = RATES[(RATES.indexOf(E.rate) + 1) % RATES.length]; const v = vid(); if (v) v.playbackRate = E.rate; b.textContent = E.rate + "x"; return; }
  if (a === "copytx") { await navigator.clipboard.writeText(inClip().map(([w]) => w.w).join(" ")); return toast("The text is copied", "ok"); }
  if (a === "srt") {
    const url = URL.createObjectURL(new Blob([srtOut()], {type: "text/plain"}));
    const l = document.createElement("a"); l.href = url; l.download = `${(E.title || E.hook || "clip").replace(/[^\w\- ]+/g, "").trim() || "clip"}.srt`; l.click();
    return setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === "importsrt") return $e("#edSrtFile").click();
  if (a === "rehear") {
    // only this clip's audio is heard again (a few seconds either side), never the whole video
    if (E.rehear) return;
    if (E.edited && !confirm("Listen to this clip again? The words you typed will be replaced by what is heard now.")) return;
    const cid = E.cid; E.rehear = true; drawTx();
    try {
      const cap = await send(`/api/jobs/${E.jid}/clips/${cid}/retranscribe`);
      if (E.cid !== cid) return;
      Object.assign(E, {words: clone(cap.words), auto: clone(cap.words), edited: false});
      try { const s = JSON.parse(E.saved); s.w = null; E.saved = JSON.stringify(s); } catch {}   // already saved on the server
      wordsChanged(); after("pt");
      toast(`Heard ${inClip().length} words again. Render to put them in the video`, "ok");
    } catch (err) { toast(err.message, "bad"); }
    finally { if (E.cid === cid) { E.rehear = false; drawTx(); } }
    return;
  }
  if (a === "resetcaps") { E.words = clone(E.auto.length ? E.auto : E.words); E.edited = false; wordsChanged(); return after("pt"); }
  if (a === "preset") { E.look = {...lookFromStyle(d.k), y: E.look.y, hook: E.look.hook, ...keepOwn(E.look)}; E.lookTouched = true; after("pt"); return showCaptions(); }
  if (a === "brandpick") { if (e.target.closest("[data-ed=branddel]")) return; const s = E.brand[+d.k]; if (s) { E.look = {...keepOwn(E.look), ...styleOnly(clone(s.look)), ...clipOwn(E.look)}; E.lookTouched = true; } return after("pt"); }
  if (a === "stab") { E.stab = d.t; return drawPanel(); }
  if (a === "effect") { E.look.effect = d.v; E.lookTouched = true; return after("p"); }
  if (a === "fade") { E.look[d.k] = d.v; E.lookTouched = true; E.fadeShown = null; seek(d.k === "fade_in" ? E.start : E.end - FADE_S - 0.3); return after("p"); }
  if (a === "saveopen") { E.saveOpen = true; drawPanel(); const i = $e("#edBrandName"); if (i) { i.focus(); i.closest(".ed-savebar")?.scrollIntoView({block: "nearest"}); } return; }
  if (a === "saveclose") { E.saveOpen = false; return drawPanel(); }
  if (a === "branddef") {
    E.brandDef = d.v;
    try { await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(brandBody(E.brand))}); toast(d.v ? `New clips start with “${d.v}”` : "New clips use their own style", "ok"); }
    catch (er) { toast(er.message, "bad"); }
    return drawPanel();
  }
  if (a === "branddel") {
    e.stopPropagation();
    E.brand.splice(+d.k, 1);
    try { E.brand = (await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(brandBody(E.brand))})).styles; } catch (er) { toast(er.message, "bad"); }
    return drawPanel();
  }
  if (a === "brandsave") {
    const name = $e("#edBrandName").value.trim();
    if (!name) return $e("#edBrandName").focus();
    if (E.brand.length >= 12) return toast("Your brand kit holds 12 looks. Remove one first.", "bad");
    try { E.brand = (await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(brandBody([...E.brand, {name, look: styleOnly(E.look)}]))})).styles;
      E.saveOpen = false; toast(`“${name}” is in your brand kit`, "ok"); } catch (er) { toast(er.message, "bad"); }
    return drawPanel();
  }
  if (a === "hookreset") { const {hook_font, hook_size, hook_y, hook_dur, hook_box, hook_ink, hook_op, hook_round, hook_sp} = HOOK_DEFAULT;
    Object.assign(E.look, {hook_font, hook_size, hook_y, hook_dur, hook_box, hook_ink, hook_op, hook_round, hook_sp}); E.lookTouched = true; after("pt"); return showHook(); }
  if (a === "hookstyle") { Object.assign(E.look, HOOK_STYLES.find(x => x[0] === d.k)[2]); E.lookTouched = true; after("p"); return showHook(); }
  if (a === "capbg") { Object.assign(E.look, CAP_BGS.find(x => x[0] === d.k)[2]); E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "hookdur") { E.look.hook_dur = +d.v; E.lookTouched = true; return after("pt"); }
  if (a === "per") { E.look.per = +d.n; E.lookTouched = true; after("pt"); return showCaptions(); }
  if (a === "upper") { E.look.upper = d.v === "1"; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "weight") { E.look[d.k] = +d.v; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "fstyle") { E.look[d.k] = !E.look[d.k]; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "colour") { E.look[d.k] = d.v; E.lookTouched = true; after("p"); return d.k.startsWith("hook") ? showHook() : showCaptions(); }
  if (a === "layout" && d.v === "card" && E.layout !== "card") {     // light card, light captions: make them readable
    const th = CARD_THEMES[cardOf().theme] || CARD_THEMES.light, lightCard = parseInt(th.bg.slice(1), 16) > 0x888888;
    if (lightCard && /^#F/i.test(E.look.base || "#FFFFFF")) { Object.assign(E.look, {base: th.ink, active: th.acc, outline: 0}); E.lookTouched = true; }
  }
  if (a === "layout") { E.layout = d.v; if ((d.v === "split" || d.v === "card") && !b.closest("#edPanel")) E.tab = "layout"; drawPanel(); drawStage(); if (d.v === "split") findFacecam(); return after(""); }
  if (a === "framereset") {             // the Frame view's Reset: the whole picture (or the usual face cam spots)
    if (E.layout === "split") E.look.split = {...SPLIT_DEFAULT, ...(clipNow()?.auto_split || {})}; else delete E.look.frame;
    E.lookTouched = true; placeRegions(); return after("p");
  }
  if (a === "muspick") {
    if (e.target.closest("[data-ed=musdel]")) return;
    E.look.music = {...musicOf(), id: d.v, at: d.v === musicOf().id ? musicOf().at : 0}; E.lookTouched = true; drawPanel(); return after("");
  }
  if (a === "musdel") {
    e.stopPropagation();
    const t = (E.music || []).find(x => x.id === d.v); if (!t || !confirm(`Remove "${t.name}" from your library? Clips already made keep their sound.`)) return;
    try { E.music = (await api(`/api/music/${d.v}`, {method: "DELETE"})).tracks; } catch (er) { return toast(er.message, "bad"); }
    if (musicOf().id === d.v) { E.look.music = {...musicOf(), id: ""}; E.lookTouched = true; }
    drawPanel(); return after("");
  }
  if (a === "bgkind") { E.look.bg = {...bgOf(), kind: d.v}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after(""); }
  if (a === "brandkind") { E.look.brand_kind = d.v; if (d.v === "social" && !E.look.brand_head && !E.look.brand_handle) wmPreset("dual"); E.lookTouched = true; drawPanel(); return wmRefresh(); }
  if (a === "wmpreset") { wmPreset(d.v); E.lookTouched = true; drawPanel(); return wmRefresh(); }
  if (a === "wmicon") { E.look.brand_icon = d.v; E.look.brand_on = true; $$e("[data-ed=wmicon]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); return wmRefresh(); }
  if (a === "picadd") return picAdd(d.v);
  if (a === "zoomadd") return zoomAdd();
  if (a === "zoomsel") { E.zSel = +d.v; if (E.tab !== "fx") E.tab = "fx"; drawPanel(); drawTimeline(); const z = (E.look.zooms || [])[E.zSel]; if (z) showAt(z.a + Math.min(0.6, (z.b - z.a) / 2)); return; }
  if (a === "zoomdel") { const L = E.look.zooms || []; L.splice(+d.v, 1); E.look.zooms = L; E.zSel = -1; E.lookTouched = true; drawPanel(); drawTimeline(); return after(""); }
  if (a === "zoomfx") { const z = (E.look.zooms || [])[E.zSel]; if (z) { z.fx = d.v; E.lookTouched = true; drawPanel(); after(""); paintOverlay(); } return; }
  if (a === "zoomamt" || a === "zoomeaseset" || a === "zoomcentre") {
    const z = (E.look.zooms || [])[E.zSel]; if (!z) return;
    if (a === "zoomamt") z.s = +d.v; else if (a === "zoomeaseset") z.ease = d.v === "1"; else { z.x = 50; z.y = 50; }
    E.lookTouched = true; E.zKey = ""; drawPanel(); drawTimeline(); after(""); paintOverlay(); return;
  }
  if (a === "zoomease") { const z = (E.look.zooms || [])[E.zSel]; if (z) { z.ease = !z.ease; E.lookTouched = true; drawPanel(); after(""); } return; }
  if (a === "zoomface") return zoomFace();
  if (a === "picswap") { E.picSwap = +d.v >= 0 ? +d.v : null; if (E.picSwap != null) E.picSel = E.picSwap; return drawPanel(); }
  if (a === "picsel") { E.picSel = +d.v; if (E.tab !== "media") E.tab = "media"; drawPanel(); E.picKey = ""; paintOverlay(); return drawTimeline(); }
  if (a === "picdel") { const L = E.look.overlays || []; L.splice(+d.v, 1); E.look.overlays = L; E.picSel = -1; E.picSwap = null; E.lookTouched = true; drawPanel(); drawTimeline(); E.picKey = ""; return after(""); }
  if (a === "picfill") { const o = (E.look.overlays || [])[+d.v]; if (o) { o.a = E.start; o.b = E.end; E.lookTouched = true; drawPanel(); drawTimeline(); E.picKey = ""; after(""); } return; }
  if (a === "medialdel") {
    e.stopPropagation();
    const m = (E.media || []).find(x => x.id === d.v); if (!m || !confirm(`Remove "${m.name}" from your library? Clips already made keep it.`)) return;
    try { E.media = (await api(`/api/media/${d.v}`, {method: "DELETE"})).items; } catch (er) { return toast(er.message, "bad"); }
    E.look.overlays = (E.look.overlays || []).filter(o => o.id !== d.v); E.picSel = -1; E.lookTouched = true; drawPanel(); drawTimeline(); return after("");
  }
  if (a === "outroset") {
    const o = outroOf(), v = d.k === "on" ? d.v === "1" : d.v;
    E.look.outro = {...o, [d.k]: v}; E.lookTouched = true; drawPanel(); after("");
    drawTimeline();
    return;
  }
  if (a === "outroplay") return playOutro(false);
  if (a === "outrojump") { E.tab = "media"; drawPanel(); return playOutro(false); }
  if (a === "musauto") { E.look.music = {...musicOf(), vol: 18, peak: 95, rise: 3, duck: true}; E.lookTouched = true; drawPanel(); return after(""); }
  if (a === "musdrop") { const m = musicOf(); E.look.music = {...m, peak_at: m.peak_at == null ? Math.max(0, (m.at || 0) + (E.end - E.start)) : null}; E.lookTouched = true; drawPanel(); return after(""); }
  if (a === "hookbanner" || a === "hookcase") { E.look[a === "hookbanner" ? "hook_banner" : "hook_case"] = d.v; E.lookTouched = true; drawPanel(); after(""); return showHook(); }
  if (a === "emjopen") { E.emjOpen = !E.emjOpen; return drawPanel(); }
  if (a === "emjcat") { E.emjCat = d.v; E.emjQ = ""; return drawPanel(); }
  if (a === "emjput") {                      // put the emoji where the cursor is in the hook
    const ta = $e("#edHook"); if (!ta || ta.disabled) return;
    const at = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? at, ch = d.v;
    const pad = at > 0 && !/\s$/.test(ta.value.slice(0, at)) ? " " : "";
    ta.value = (ta.value.slice(0, at) + pad + ch + " " + ta.value.slice(end)).replace(/\s{2,}/g, " ").slice(0, 60);
    ta.dispatchEvent(new Event("input", {bubbles: true}));
    const pos = Math.min(ta.value.length, at + pad.length + ch.length + 1); ta.focus(); ta.setSelectionRange(pos, pos);
    return;
  }
  if (a === "undo" || a === "redo") return histGo(a === "undo" ? -1 : 1);
  if (a === "keys") { E.keysOpen = !E.keysOpen; return drawKeys(); }
  if (a === "keysclose") { E.keysOpen = false; return drawKeys(); }
  if (a === "tpl") { E.tplOpen = !E.tplOpen; return drawTpl(); }
  if (a === "tplclose") { E.tplOpen = false; return drawTpl(); }
  if (a === "tplcat") { E.tplCat = d.v; return drawTpl(); }
  if (a === "tplpick") return applyTpl(d.v);
  if (a === "cardset") { E.look.card = {...cardOf(), [d.k]: d.k === "verified" ? d.v === "1" : d.v}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after("p"); }
  if (a === "cardcentre") { E.look.card = {...cardOf(), dx: 0, dy: 0}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after("p"); }
  if (a === "cardgrad") { E.look.card = {...cardOf(), g1: d.a, g2: d.b}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after("p"); }
  if (a === "cardgrain") { E.look.card = {...cardOf(), grain: !cardOf().grain}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after("p"); }
  if (a === "splitpos") { E.look.split = {...rawSplit(), cam_at: d.v}; E.lookTouched = true; drawStage(); return after("p"); }
  if (a === "splitreset") { E.look.split = {...SPLIT_DEFAULT, ...(clipNow()?.auto_split || {})}; E.lookTouched = true; drawStage(); return after("p"); }
  if (a === "aspmenu") {                // the shape menu floats above everything: the bar under the preview clips its own overflow
    const open = $("#clipdlg > .ed-aspop"); aspClose(); if (open) return;
    const m = $e(".ed-asp #edAsp"); if (!m) return;
    const r = b.getBoundingClientRect(), menu = m.cloneNode(true);
    menu.hidden = false; menu.removeAttribute("id");
    if (!phone()) menu.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;bottom:${innerHeight - r.top + 10}px;top:auto;z-index:60`;
    $("#clipdlg").append(menu); return;
  }
  if (a === "exdlg") { if (E.exOpen) { E.exOpen = false; exDoneClear(); return drawEx(); } E.ex ||= {preset: "reels", fmt: "mp4", fps: 30, q: "high", speed: 1}; E.exOpen = true; return drawEx(); }
  if (a === "exclose") { E.exOpen = false; exDoneClear(); return drawEx(); }
  if (a === "exagain") return exSave();
  if (a === "vol100") return setVolume(100);
  if (a === "exnew") { exDoneClear(); return drawEx(); }
  if (a === "expreset") { E.ex = {...E.ex, ...EX_PRESETS.find(p => p[0] === d.v)[3], preset: d.v}; return drawEx(); }
  if (a === "exset") { const v = d.k === "fmt" || d.k === "q" ? d.v : +d.v; E.ex = {...E.ex, [d.k]: v, preset: null}; return drawEx(); }
  if (a === "exgo") return exGo();
  if (a === "aspect") { aspClose();                 // the clip's shape: the preview changes at once, the render on save
    E.look.aspect = d.v; E.lookTouched = true; setFrame();
    E.lastKey = ""; drawStage(); return after("p");
  }
  if (a === "brandpos" || a === "brandanim") {   // where the brand sits, and how it moves: shown straight away
    E.look[a === "brandpos" ? "brand_pos" : "brand_anim"] = d.v; E.look.brand_on = true; E.lookTouched = true;
    after("p"); return paintOverlay();
  }
  if (a === "logodel") {
    try { await api("/api/brand/logo", {method: "DELETE"}); E.logoV = 0; toast("Logo removed", "ok"); } catch (er) { toast(er.message, "bad"); }
    after("p"); return paintOverlay();
  }
  if (a === "nudge") { setTrim(d.k, E[d.k] + +d.d); return after("pt"); }
  if (a === "toplayhead") { setTrim(d.k, nowT()); return after("pt"); }
});
dlg.addEventListener("input", e => {
  const el = e.target, k = el.dataset.look;
  if (el.dataset.bg) {                    // a background colour: the preview follows as it is picked
    E.look.bg = {...bgOf(), [el.dataset.bg]: el.value.toUpperCase()}; el.parentElement.style.background = el.value;
    E.lookTouched = true; E.fgKey = ""; paintOverlay(); return after("");
  }
  if (el.dataset.zm) {                    // the selected zoom: how far in
    const z = (E.look.zooms || [])[E.zSel]; if (!z) return;
    z.s = +el.value; el.closest(".ed-sl")?.style.setProperty("--p", pctOf(z.s, 1.1, 3)); const out = el.closest(".ed-sl")?.querySelector("output"); if (out) out.textContent = z.s.toFixed(1) + "×";
    E.lookTouched = true; paintOverlay(); return after("");
  }
  if (el.dataset.pic) {                   // the selected picture: size, opacity, from and to
    const o = (E.look.overlays || [])[E.picSel]; if (!o) return;
    const v = +el.value, k = el.dataset.pic, sl = el.closest(".ed-sl");
    if (k === "a") o.a = Math.min(v, o.b - 0.2); else if (k === "b") o.b = Math.max(v, o.a + 0.2); else o[k] = v;
    if (sl) { sl.style.setProperty("--p", pctOf(v, +el.min, +el.max)); const out = sl.querySelector("output"); if (out) out.textContent = k === "a" || k === "b" ? ts(v - E.start) : v + "%"; }
    E.lookTouched = true; E.picKey = ""; paintOverlay(); drawTimeline(); return after("");
  }
  if (el.dataset.outro) {                 // the outro's words, length, picture size and roundness, canvas colour
    const k = el.dataset.outro, v = el.type === "range" ? +el.value : el.value, sl = el.closest(".ed-sl");
    E.look.outro = {...outroOf(), [k]: k === "bg" ? v.toUpperCase() : v};
    if (sl) { sl.style.setProperty("--p", pctOf(+el.value, +el.min, +el.max)); const out = sl.querySelector("output"); if (out) out.textContent = k === "secs" ? v + " s" : k === "pic_round" ? v + "%" : v; }
    if (k === "bg") el.parentElement.style.background = el.value;
    const pv = $e("#edOutroPv"); if (pv) pv.innerHTML = outroHtml(outroOf(), 0.16);
    E.lookTouched = true; return after("");
  }
  if (k === "mus_peak" || k === "mus_rise" || k === "mus_drop") {   // the rise into the outro
    const v = +el.value, out = el.parentElement.querySelector("output");
    el.closest(".ed-sl")?.style.setProperty("--p", pctOf(v, +el.min, +el.max));
    E.look.music = {...musicOf(), [{mus_peak: "peak", mus_rise: "rise", mus_drop: "peak_at"}[k]]: v}; E.lookTouched = true;
    if (out) out.textContent = k === "mus_peak" ? v + "%" : k === "mus_rise" ? v + " s" : mmss(v);
    return after("");
  }
  if (el.dataset.mus) {                   // music switches: duck, loop, fade
    E.look.music = {...musicOf(), [el.dataset.mus]: el.checked}; E.lookTouched = true; return after("");
  }
  if (k === "mus_vol" || k === "mus_at") {  // music volume and where in the song it starts
    const v = +el.value, o = el.parentElement.querySelector("output");
    el.closest(".ed-sl")?.style.setProperty("--p", pctOf(v, +el.min, +el.max));
    E.look.music = {...musicOf(), [k === "mus_vol" ? "vol" : "at"]: v}; E.lookTouched = true;
    if (o) o.textContent = k === "mus_vol" ? v + "%" : mmss(v);
    return after("");
  }
  if (el.dataset.card) {                  // the post card's name, handle, words and corners: seen on the preview at once
    const ck = el.dataset.card, sl = el.closest(".ed-sl");
    E.look.card = {...cardOf(), [ck]: el.type === "range" ? +el.value : el.type === "color" ? el.value.toUpperCase() : el.value};
    if (el.type === "color") el.parentElement.style.background = el.value;
    E.fgKey = "";
    if (sl) { sl.style.setProperty("--p", pctOf(+el.value, +el.min, +el.max)); const o = sl.querySelector("output"); if (o) o.textContent = el.value; }
    E.lookTouched = true; E.lastKey = ""; paintOverlay(); return after("");
  }
  const sl = el.type === "range" && el.closest(".ed-sl");
  if (sl) sl.style.setProperty("--p", pctOf(+el.value, +el.min, +el.max));      // the filled part follows the thumb
  if (k) {
    E.lookTouched = true;
    if (k === "brand_text") {                 // typing a name turns the brand on, and its switch with it
      E.look.brand_text = el.value.slice(0, 40);
      if (el.value.trim()) { E.look.brand_on = true; const sw = $e('[data-look="brand_on"]'); if (sw) sw.checked = true; }
      after(""); return paintOverlay();
    }
    if (k === "brand_on" || k === "brand_logo") { E.look[k] = el.checked; after(""); return paintOverlay(); }
    if (k === "brand_head" || k === "brand_handle" || k === "brand_tag" || k === "brand_font") {   // the social watermark's words and font
      E.look[k] = el.value.slice(0, 40); E.look.brand_on = true; return wmRefresh();
    }
    if (k === "brand_color") { E.look.brand_color = el.value.toUpperCase(); el.parentElement.style.background = el.value; return wmRefresh(); }
    if (k === "brand_tag_on") { E.look.brand_tag_on = el.checked; drawPanel(); return wmRefresh(); }
    if (k === "split_share") {              // how much of the frame the stream takes; the face cam gets the rest
      E.look.split = {...rawSplit(), share: +el.value}; const o = el.parentElement.querySelector("output"); if (o) o.textContent = el.value + "%";
      E.lastKey = ""; placeSplit(); after(""); return;
    }
    if (k === "font" || k === "hook_font") E.look[k] = el.value;
    else if (COLOUR_KEYS.test(k)) { E.look[k] = el.value.toUpperCase(); el.parentElement.style.background = el.value; }
    else if (k === "hook") { E.look.hook = el.checked; const h = $e("#edHook"); if (h) h.disabled = !el.checked; return after("t"); }
    else if (k === "volume") { setVolume(+el.value, el); return; }    // the sound: heard at once, rendered into the clip on save
    else if (k === "hook_dur") {
      E.look.hook_dur = +el.value; const o = $e("#edHookDur"); if (o) o.textContent = +el.value ? el.value + " s" : "Whole clip";
      $$e("[data-ed=hookdur]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === +el.value)));
      after("t"); return showHook();
    }
    else { E.look[k] = +el.value; const o = el.parentElement.querySelector("output"); if (o) o.textContent = PCT_KEYS.has(k) ? el.value + "%" : el.value; }
    after("");
    return k.startsWith("hook") ? showHook() : showCaptions();   // keep what is being changed on screen
  }
  if (el.dataset.line != null) {          // a subtitle line being typed: the preview shows it right away
    E.editG = +el.dataset.line; E.editText = el.value; E.lastKey = ""; paintOverlay();
    const chip = $e(`.ed-chip[data-g="${el.dataset.line}"] span`); if (chip) chip.textContent = el.value;
    return;
  }
  if (el.id === "edZoom") return setZoom(+el.value);
  if (el.id === "edQ") {          // search: redraw the list, keep typing where it was
    E.q = el.value; const at = el.selectionStart;
    drawTx(); const q = $e("#edQ"); if (q) { q.focus(); q.setSelectionRange(at, at); }
    $e(".tw.hit, .ed-line.hit")?.scrollIntoView({block: "nearest"});
    return;
  }
  if (el.id === "edEmjQ") {       // the emoji search
    E.emjQ = el.value; const at = el.selectionStart;
    drawPanel(); const q = $e("#edEmjQ"); if (q) { q.focus(); q.setSelectionRange(at, at); }
    return;
  }
  if (el.id === "edSq") {         // the style search
    E.sq = el.value; const at = el.selectionStart;
    drawPanel(); const q = $e("#edSq"); if (q) { q.focus(); q.setSelectionRange(at, at); }
    return;
  }
  if (el.id === "edHook") { E.hook = el.value.replace(/\n/g, " "); const n = $e("#edHookN"); if (n) n.textContent = E.hook.length;
    const hc = $e(".ed-hchip span"); if (hc) hc.textContent = E.hook; return after(""); }
  if (el.id === "edTitle") { E.title = el.value; return drawClipDlg(); }
  if (el.id === "edDesc") { E.description = el.value; return drawClipDlg(); }
});
dlg.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "edLogoIn") return uploadLogo(el.files?.[0]);
  if (el.id === "edMusIn") { const f = el.files?.[0]; el.value = ""; return musicAdd(f); }
  if (el.id === "edMedIn") { const f = el.files?.[0]; el.value = ""; return mediaAdd(f, el.dataset.for || ""); }   // a logo picked from the computer
  if (el.dataset.cl) {                   // the Speech cleanup choices: the counts update as they change
    if (el.dataset.cl === "min") E.cl.min = +el.value; else E.cl[el.dataset.cl] = el.checked;
    return drawPanel();
  }
  if (el.dataset.line != null) { keepAuto(); editLine(+el.dataset.line, el.value); E.editG = -1; E.editText = null; return after("pt"); }
  if (el.id === "edHook") return drawTimeline();
  if (el.dataset.look === "base" || el.dataset.look === "active") return drawPanel();
  if (el.id === "edSrtFile" && el.files[0]) {
    el.files[0].text().then(t => { const w = srtIn(t); el.value = "";
      if (!w.length) return toast("No captions found in that file.", "bad");
      keepAuto(); E.words = w; E.edited = true; wordsChanged(); E.txTab = "subs"; after("pt"); toast(`Imported ${w.length} words`, "ok"); });
  }
});
dlg.addEventListener("focusin", e => {          // start editing a line or the hook: the preview jumps to where it shows
  const el = e.target;
  if (el.dataset?.line != null) { E.editG = +el.dataset.line; E.editText = el.value; return showLine(+el.dataset.line); }
  if (el.id === "edHook") showHook();
});
dlg.addEventListener("focusout", e => {
  if (e.target.dataset?.line != null && E.editG === +e.target.dataset.line) { E.editG = -1; E.editText = null; E.lastKey = ""; paintOverlay(); }
});
dlg.addEventListener("pointerdown", e => {      // drag the trim handles, or click the track to jump
  const track = e.target.closest("#edTrack"); if (!track) return;
  const r = track.getBoundingClientRect(), at = x => E.min + (x - r.left) / r.width * (E.max - E.min);
  const h = e.target.closest(".ed-hd")?.dataset.h;
  if (!h) { if (!e.target.closest("[data-ed]")) { if (E.view === "rendered") { E.view = "live"; drawStage(); } seek(at(e.clientX)); } return; }
  e.preventDefault(); track.setPointerCapture(e.pointerId);
  const move = ev => { setTrim(h, at(ev.clientX)); const w = $e(".ed-win"), sl = $e(".ed-shade.l"), sr = $e(".ed-shade.r");
    w.style.left = pct(E.start) + "%"; w.style.width = pct(E.end) - pct(E.start) + "%"; sl.style.width = pct(E.start) + "%"; sr.style.left = pct(E.end) + "%";
    seek(h === "start" ? E.start : E.end - 0.05); };
  const up = () => { track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", up); after("pt"); };
  track.addEventListener("pointermove", move); track.addEventListener("pointerup", up);
});
dlg.addEventListener("wheel", e => {           // ctrl or pinch on the timeline zooms it
  if (!e.ctrlKey || !e.target.closest("#edScroll")) return;
  e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1);
}, {passive: false});
dlg.addEventListener("toggle", e => {          // remember which style sections are open across redraws
  const f = e.target.closest?.("[data-fold]"); if (!f) return;
  E.shut = E.shut || new Set();      // every section starts open; this keeps the ones closed by hand
  f.open ? E.shut.delete(f.dataset.fold) : E.shut.add(f.dataset.fold);
}, true);
dlg.addEventListener("cancel", e => { e.preventDefault(); if (document.querySelector(".ed.fsx")) return fsWindow(false); edClose(); });
dlg.addEventListener("close", () => { cancelAnimationFrame(raf); dlg.classList.remove("ed-on"); dlg.innerHTML = ""; E.cid = null; D.jid = null; });
document.addEventListener("keydown", e => {
  if (!dlg.open || !E.cid) return;
  const mod = e.ctrlKey || e.metaKey, typing = e.target.closest?.("input,textarea,select,[contenteditable]");
  const k = e.key.toLowerCase();
  if (mod && k === "s") { e.preventDefault(); clearTimeout(E.asT); return dirty() ? keep() : toast("Everything is saved", "ok"); }
  if (mod && k === "enter") { e.preventDefault(); return save(); }
  if (typing) return;                       // typing in a box: its own undo, arrows and letters
  if (mod && (k === "z" || k === "y")) { e.preventDefault(); return histGo(k === "y" || e.shiftKey ? 1 : -1); }
  if (mod || e.altKey) return;
  if (e.key === "Escape") {                 // the topmost small window closes first; the editor itself stays open
    if (E.keysOpen) { E.keysOpen = false; drawKeys(); } else if (E.tplOpen) { E.tplOpen = false; drawTpl(); }
    else if (E.exOpen) { E.exOpen = false; drawEx(); } else return;
    e.preventDefault(); return;
  }
  if (e.code === "Space" && !e.target.closest?.("button")) { e.preventDefault(); return togglePlay(); }
  const t = nowT(), step = 1 / 30;
  const go = at => { e.preventDefault(); if (E.view === "rendered") { E.view = "live"; drawStage(); } seek(at); };
  if (e.key === "ArrowLeft") return go(t - (e.shiftKey ? 5 : 1));
  if (e.key === "ArrowRight") return go(t + (e.shiftKey ? 5 : 1));
  if (e.key === ",") return go(t - step);
  if (e.key === ".") return go(t + step);
  if (e.key === "Home") return go(E.start);
  if (e.key === "End") return go(E.end - 0.05);
  if (k === "i" || k === "o") {             // the clip starts or ends where the playhead is
    e.preventDefault(); setTrim(k === "i" ? "start" : "end", t); drawTimeline(); after("");
    return toast(k === "i" ? "The clip starts here" : "The clip ends here", "ok");
  }
  if (k === "m") { e.preventDefault(); return $e(".ed-volbtn")?.click(); }
  if (k === "f") { e.preventDefault(); return $e("[data-ed=fs]")?.click(); }
  if (k === "t") { e.preventDefault(); E.tplOpen = !E.tplOpen; return drawTpl(); }
  if (k === "z") { e.preventDefault(); return zoomAdd(); }
  if (e.key === "?") { e.preventDefault(); E.keysOpen = !E.keysOpen; return drawKeys(); }
});
addEventListener("resize", () => { if (dlg.open) { E.lastKey = ""; paintOverlay(); placeViews(); } });
// Live / Frame / Saved sit in the header right above the middle of the preview column
function placeViews() {
  const v = $e("#edViews"), mid = $e(".ed-center"), top = $e(".ed-top"); if (!v || !mid || !top) return;
  const m = mid.getBoundingClientRect(), t = top.getBoundingClientRect();
  if (!m.width) { v.style.left = ""; return; }
  const acts = $e(".ed-acts")?.getBoundingClientRect(), half = v.offsetWidth / 2;
  let x = m.left - t.left + m.width / 2;
  if (acts && getComputedStyle(v).position === "absolute") x = Math.min(x, acts.left - t.left - 12 - half);   // never over Export
  v.style.left = x + "px";
  // the title gives way, so the tools after it never slide under the switch
  const L = $e(".ed-left"), nm = L?.querySelector(".ed-name"); if (!nm || getComputedStyle(v).position !== "absolute") return;
  const kids = [...L.children].filter(k => k !== nm && k.offsetParent);
  const others = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0) + 8 * kids.length + 14;
  nm.style.maxWidth = Math.max(60, v.getBoundingClientRect().left - t.left - 16 - others) + "px";
}
/* the volume: a small upright slider that opens above the speaker button on hover (or keyboard focus), and stays
   while the pointer is on it */
function volShow() {
  const btn = $e(".ed-volbtn"), pop = $e("#edVolPop"); if (!btn || !pop) return;
  clearTimeout(E.volT);
  const r = btn.getBoundingClientRect(), o = (pop.offsetParent || document.body).getBoundingClientRect();
  pop.style.left = (r.left - o.left + r.width / 2) + "px"; pop.style.top = (r.top - o.top - 8) + "px";
  pop.classList.add("on");
}
function volHideSoon() { clearTimeout(E.volT); E.volT = setTimeout(() => $e("#edVolPop")?.classList.remove("on"), 280); }
dlg.addEventListener("pointerover", e => { if (e.target.closest?.(".ed-vol, #edVolPop")) volShow(); });
dlg.addEventListener("pointerout", e => {
  const from = e.target.closest?.(".ed-vol, #edVolPop"), to = e.relatedTarget?.closest?.(".ed-vol, #edVolPop");
  if (from && !to) volHideSoon();
});
dlg.addEventListener("focusin", e => { if (e.target.closest?.(".ed-vol, #edVolPop")) volShow(); });
dlg.addEventListener("focusout", e => { if (e.target.closest?.(".ed-vol, #edVolPop") && !e.relatedTarget?.closest?.(".ed-vol, #edVolPop")) volHideSoon(); });
})();
