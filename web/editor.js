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
  "brand_kind", "brand_head", "brand_icon", "brand_handle", "brand_tag", "brand_tag_on", "brand_font", "brand_color",
  "brand_style", "brand_head_pct", "brand_align"];
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
  ["bw", "Black & white", "grayscale(1) contrast(1.1)"],
  ["lut_cinematic_teal_orange", "Teal & orange", "contrast(1.12) saturate(1.15) sepia(.12) hue-rotate(-8deg)"],
  ["lut_punchy_viral", "Punchy", "contrast(1.2) saturate(1.45) brightness(1.02)"],
  ["lut_moody_dark", "Moody", "contrast(1.15) brightness(.86) saturate(.85)"],
  ["lut_warm_film", "Warm film", "sepia(.28) saturate(1.1) contrast(1.05) brightness(1.02)"],
  ["lut_vintage_70s", "70s film", "sepia(.45) saturate(.9) contrast(.92) hue-rotate(-6deg)"],
  ["lut_punch_desaturated", "Muted punch", "contrast(1.22) saturate(.6)"],
  ["lut_mono_documentary", "Mono doc", "grayscale(1) contrast(1.18) brightness(.97)"]];
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
const CLIP_OWN = ["x", "y", "hook_x", "hook_y", "aspect", "split", "frame", "card", "volume", "music", "bg", "pad", "vradius", "stroke", "stroke_color", "outro", "overlays", "zooms"];
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
const SPLIT_DEFAULT = {game: [0, 0, 1, 1], cam: [0.68, 0.58, 0.30, 0.40], cam_at: "bottom", share: 50, pip_at: "br", pip_size: 36,
  pip_x: null, pip_y: null, pip_shape: "rounded", pip_radius: 10, pip_border: 6, pip_color: "#FFFFFF",
  trio: [[0, 0, 0.3333, 1], [0.3333, 0, 0.3333, 1], [0.6667, 0, 0.3333, 1]],
  faces: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]], grid_share: 50, scenes: [],
  pop_shape: "rounded", pop_size: 70, pop_x: null, pop_y: null, pop_radius: 8, pop_border: 8, pop_edge: "solid", pop_c1: "#FFFFFF",
  pop_c2: "#FF8A1F", pop_out: 22, pop_bg: "cam", pop_fill: "#FFFFFF", pop_fit: "face"};
// the layouts made of parts of the picture (the split boxes), not one framed shot (render.PARTS)
const PARTS = ["split", "pip", "trio", "grid", "pop"];
const POP_AT = [50, 57];               // the pop-out card's middle until it is dragged (render.POP_AT)
const POP_KEYS = ["pop_fit", "pop_shape", "pop_size", "pop_x", "pop_y", "pop_radius", "pop_border", "pop_edge", "pop_c1", "pop_c2", "pop_out", "pop_bg", "pop_fill"];
/* the pop-out card in frame pixels (render.pop_geometry): the face cam fills a w x t picture, the card shows its lower
   h rows at (x, y), and the cut-out person over the whole picture rises `pop` pixels above the card */
/* where the face is inside the face cam box, asked of the server once per box (render.pop_line uses the same) */
const popFaceKey = sp => `${E.jid}/${E.cid}/${sp.cam.map(v => (+v).toFixed(4)).join(",")}`;
function popFace(sp) {                  // the face as [x, y, w, h] of the box, null if none, undefined while asking
  const key = popFaceKey(sp);
  if (E.popFace?.key === key) return E.popFace.face;
  if (E.popFaceAsk !== key) {
    E.popFaceAsk = key;
    fetch(`/api/jobs/${E.jid}/clips/${E.cid}/popface?cam=${encodeURIComponent(sp.cam.map(v => (+v).toFixed(4)).join(","))}`)
      .then(r => r.ok ? r.json() : {face: null}).catch(() => ({face: null}))
      .then(j => { if (E.popFaceAsk !== key) return; E.popFace = {key, face: j.face || null}; E.lastKey = ""; if (E.layout === "pop") { placeSplit(); paintOverlay(); } });
  }
  return undefined;
}
/* render.pop_line: how much of the picture rises above the card. With the face found, "Head pops out" is how much of
   the head rises (the card's top edge crosses the forehead), whatever room is above the head in the box */
function popLine(sp) {
  const out = (sp.pop_out ?? 22) / 100, face = popFace(sp);
  if (!face || !out) return out;
  const [, fy, , fh] = face, line = fy - 0.45 * fh + (out / 0.9) * 1.45 * fh, c = sp.cam;
  const a = (c[3] * (E.sh || 9)) / Math.max(1e-6, c[2] * (E.sw || 16)), square = sp.pop_shape === "circle" || sp.pop_shape === "square";
  let p = Math.max(0.03, line);
  for (let i = 0; i < 8; i++) {
    const r = square ? 1 / Math.max(0.5, 1 - p) : Math.max(0.8, Math.min(1.6, a));
    const p2 = r >= a ? line : (line - (1 - r / a) / 2) / (r / a);
    p = Math.max(0.03, Math.min(square ? 0.5 : 0.6, p2));
  }
  return p;
}
/* render.pop_frame: the face framed in the card (centred, POP_FACE of its width, hair just below the top) and how
   much rises above it, so the card's top edge crosses the head at the head line. null: show the box as placed */
const POP_FACE = 0.42, POP_ROUND_H = 0.95;
function popFrame(sp, w, h) {
  const face = popFace(sp);
  if (!face || (sp.pop_fit || "face") !== "face") return null;
  const [fx, fy, fw, fh] = face, c = sp.cam, bw = c[2] * (E.sw || 16), bh = c[3] * (E.sh || 9), out = (sp.pop_out ?? 22) / 100;
  const top = fy - 0.45 * fh, line = top + (out / 0.9) * 1.45 * fh, cw0 = Math.min(1, Math.max(0.5, fw / POP_FACE));
  let p = out ? 0.2 : 0, cw = cw0, ch = 1, y0 = 0;
  for (let i = 0; i < 10; i++) {
    const tw = (h / w) / Math.max(0.4, 1 - p);
    cw = cw0; ch = cw0 * tw * bw / bh;
    if (ch > 1) { cw /= ch; ch = 1; }
    y0 = Math.min(Math.max(0, top - 0.06 * ch), 1 - ch);
    p = out ? Math.min(0.6, Math.max(0, (line - y0) / ch)) : 0;
  }
  const x0 = Math.min(Math.max(0, fx + fw / 2 - cw / 2), 1 - cw), t = Math.round(h / Math.max(0.4, 1 - p) / 2) * 2;
  const r4 = v => Math.round(v * 1e4) / 1e4;
  return {t, pop: t - h, crop: [r4(c[0] + x0 * c[2]), r4(c[1] + y0 * c[3]), r4(cw * c[2]), r4(ch * c[3])]};
}
function popGeo(sp = splitOf()) {
  const W = OUT_W, H = OUT_H, pw = Math.round(W * (sp.pop_size || 70) / 100 / 2) * 2, c = sp.cam, shape = sp.pop_shape || "rounded", out = popLine(sp) * 100;
  let t, pop, h, crop = c;
  const fr = popFrame(sp, pw, shape === "circle" || shape === "square" ? pw : Math.round(pw * POP_ROUND_H / 2) * 2);
  if (fr) { ({t, pop, crop} = fr); h = t - pop; }
  else if (shape === "circle" || shape === "square") { h = pw; t = Math.round(h / Math.max(0.5, 1 - out / 100) / 2) * 2; pop = t - h; }   // as tall as wide
  else {
    const ar = (c[3] * (E.sh || 9)) / Math.max(1e-6, c[2] * (E.sw || 16));
    t = Math.round(pw * Math.max(0.8, Math.min(1.6, ar)) / 2) * 2; pop = Math.round(t * out / 100 / 2) * 2; h = t - pop;
  }
  const b = Math.round((sp.pop_border ?? 8) * W / 1080);
  const cx = sp.pop_x ?? POP_AT[0], cy = sp.pop_y ?? POP_AT[1];
  let x = Math.round(W * cx / 100 - pw / 2), y = Math.round(H * cy / 100 - h / 2);
  x = Math.max(b, Math.min(W - pw - b, x)); y = Math.max(pop, b, Math.min(H - h - b, y));
  const c1 = sp.pop_c1 || "#FFFFFF", c2 = sp.pop_edge === "gradient" ? sp.pop_c2 || c1 : c1;
  const r = shape === "circle" ? pw / 2 : Math.round(pw * (sp.pop_radius ?? 8) / 100);
  return {x, y, w: pw, h, t, pop, b, r, c1, c2, fill: sp.pop_bg === "plain" ? sp.pop_fill || "#FFFFFF" : null, crop};
}
const isParts = l => PARTS.includes(l);
// picture in picture's small box, in frame pixels (render.pip_geometry)
function pipGeo(sp = splitOf()) {
  const W = OUT_W, H = OUT_H, pw = Math.round(W * (sp.pip_size || 36) / 100 / 2) * 2, c = sp.cam, shape = sp.pip_shape || "rounded";
  const ar = (c[3] * (E.sh || 9)) / Math.max(1e-6, c[2] * (E.sw || 16));
  const ph = shape === "circle" ? pw : Math.round(pw * Math.max(0.75, Math.min(1.5, ar)) / 2) * 2, m = Math.round(W * 0.045);
  const b = Math.round((sp.pip_border ?? 6) * W / 1080);
  let x, y;
  if (sp.pip_x != null && sp.pip_y != null) { x = Math.round(W * sp.pip_x / 100 - pw / 2); y = Math.round(H * sp.pip_y / 100 - ph / 2); }
  else { const at = sp.pip_at || "br"; x = at[1] === "r" ? W - m - pw : m; y = at[0] === "t" ? Math.round(H * 0.07) : H - ph - Math.round(H * 0.075); }
  x = Math.max(b, Math.min(W - pw - b, x)); y = Math.max(b, Math.min(H - ph - b, y));
  const r = shape === "circle" ? Math.floor(pw / 2) : shape === "square" ? 0 : Math.round(pw * (sp.pip_radius ?? 10) / 100);
  return {x, y, w: pw, h: ph, b, r, color: sp.pip_color || "#FFFFFF"};
}
const trioH = () => { const t = Math.round(OUT_H / 3 / 2) * 2; return [t, t, OUT_H - 2 * t]; };
/* ---------- the face grid: two to four people, each in a cell (render.grid_cells), and scenes: stretches of the clip
   that show one person full screen, or everyone with their own line between the rows (render.grid_segments) */
const GRID_COLS = ["#7CC8FF", "#FF8BD1", "#FACC15", "#86EFAC"];       // each person's colour, as in the Frame view
const GRID_V = [["edBandG", "edVid"], ["edBandC", "edVid2"], ["edBandT", "edVid3"], ["edBandQ", "edVid4"]];
const SCENE_IC = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 12h17M12 12v7.5"/>');
function gridCells(n, share) {
  const W = OUT_W, H = OUT_H, th = Math.round(H * share / 100 / 2) * 2, hw = Math.round(W / 2 / 2) * 2;
  if (n <= 2) return [[0, 0, W, th], [0, th, W, H - th]];
  if (n === 3) return [[0, 0, W, th], [0, th, hw, H - th], [hw, th, W - hw, H - th]];
  return [[0, 0, hw, th], [hw, 0, W - hw, th], [0, th, hw, H - th], [hw, th, W - hw, H - th]];
}
const evenFaces = n => Array.from({length: n}, (_, i) => [+(i / n).toFixed(4), 0, +(1 / n).toFixed(4), 1]);
const personName = i => `Person ${i + 1}`;
const sceneIdx = (t = nowT()) => (rawSplit().scenes || []).findIndex(s => t >= s.a && t < s.b);
function gridNow(t = nowT()) {          // what the grid shows at this moment: everyone ("all") or one person, and its line
  const sp = rawSplit(), i = sceneIdx(t), s = (sp.scenes || [])[i];
  const show = s && (s.v === "all" || s.v < sp.faces.length) ? s.v : "all";
  return {show, share: (s && show === "all" && s.share) || sp.grid_share || 50, scene: i};
}
// a small phone showing this clip's own frame in the grid
const gridMini = (sp, crop) => { const cs = gridCells(sp.faces.length, sp.grid_share || 50);
  return sp.faces.map((r, i) => `<i class="lp-cell" style="left:${cs[i][0] / OUT_W * 100}%;top:${cs[i][1] / OUT_H * 100}%;width:${cs[i][2] / OUT_W * 100}%;height:${cs[i][3] / OUT_H * 100}%;${crop(r)}"></i>`).join(""); };
// the split layout's two parts: as placed here, else where the face cam was found in this clip, else the usual box
const splitOf = () => {
  const sp = rawSplit();
  return E.layout === "split" ? avoidCam(sp) : sp;      // a stream part still the whole picture skips the face cam
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
const frameRegion = () => (!isParts(E.layout) && Array.isArray(E.look?.frame)) ? E.look.frame : null;
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
  if (layout === "trio") { const t = trioH(); return {layout, fg: H, hook: t[0] - Math.round(H * 0.045), cap: t[0] + t[1]}; }
  if (layout === "grid") { const th = gridCells(2, rawSplit().grid_share || 50)[0][3]; return {layout, fg: H, hook: th - Math.round(H * 0.045), cap: th}; }
  if (layout === "pip") return {layout, fg: H, hook: r(300), cap: r((splitOf().pip_at || "br")[0] === "t" ? 1380 : 1180)};
  if (layout === "pop") {               // render.geometry: the captions under the card, or on its lower part if no room
    const q = popGeo(), below = q.y + q.h + q.b + Math.round(H * 0.055);
    return {layout, fg: H, hook: r(300), cap: below < H * 0.88 ? below : q.y + q.h - Math.round(H * 0.07)};
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
/* shots: several stretches of the video joined into one clip (E.shots, [[from, to], ...] in order). The clip spans
   from the first to the last; the gaps between them are cut out, the same way Speech cleanup's cuts are. */
const hasShots = () => (E.shots || []).length > 1;
const shotGaps = () => hasShots() ? E.shots.slice(1).map((s, i) => [E.shots[i][1], s[0]]).filter(([a, b]) => b - a > 0.01) : [];
const allCuts = () => mergeCuts([...(E.cuts || []), ...shotGaps()]);
function fitShots() {                // the clip's start and end follow its shots
  if (!hasShots()) return;
  E.shots.sort((p, q) => p[0] - q[0]);
  E.start = E.shots[0][0]; E.end = E.shots[E.shots.length - 1][1];
}
const inCut = t => allCuts().some(([a, b]) => t >= a - 0.01 && t < b);
const wordCut = w => inCut((w.s + w.e) / 2);
const cutLen = () => allCuts().reduce((n, [a, b]) => n + Math.max(0, Math.min(b, E.end) - Math.max(a, E.start)), 0);
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
  if (!E.saveOpen) return `<div class="ed-savebar"><button class="ed-savego" data-ed="saveopen" title="Keep the captions and hook as they look now, for any clip">
      ${svg('<path d="M6 3h12v18l-6-4-6 4z"/>')}<b>Save as brand</b>${n ? `<small>${n} saved</small>` : ""}${ic("plus")}</button></div>`;
  return `<div class="ed-savebar open"><div class="ed-savein"><input id="edBrandName" placeholder="Name this look, e.g. Podcast" maxlength="40" aria-label="Name this look">
      <button class="ed-btn sm primary" data-ed="brandsave">Save</button><button class="ed-qx" data-ed="saveclose" aria-label="Cancel" title="Cancel">${ic("x")}</button></div>
    <small class="ed-savenote">Keeps the captions and hook as they look now. Every new clip starts with it, live ones too.</small></div>`;
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
  w: E.edited ? E.words : null, c: E.cuts || [], sh: E.shots || []});
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
    shots: clone(c.shots || []),
    cuts: clone(c.cuts || []).filter(([a, b]) => !(c.shots || []).some((s, i, L) => i && Math.abs(a - L[i - 1][1]) < 0.02 && Math.abs(b - s[0]) < 0.02)),
    cl: {fill: true, pause: true, min: 0.8}, cleanOpen: false, hideCut: false,
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
    E.music = [...(mus.tracks || []), ...(mus.pack || [])];
    api("/api/media").then(r => { E.media = [...(r.items || []), ...(r.faces || [])]; if (E.tab === "media" || E.tab === "fx") drawPanel(); E.picKey = ""; paintOverlay(); }).catch(() => {});
    api("/api/pack/sfx").then(r => { E.sfxLib = r; if (E.tab === "audio") drawPanel(); drawTimeline(); }).catch(() => { E.sfxLib = {groups: [], items: []}; });
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
          <button class="ed-ib ed-tip ed-safebtn" data-ed="safe" aria-pressed="${!!E.safe}" aria-label="Safe zones" data-tip="Safe zones: where the app's buttons and text cover the video">${svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8 6.5h8v9H8z" stroke-dasharray="2 1.6"/>')}</button>
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
    const vol = E.look.volume ?? 100, at = E.atab || "music", nS = (E.look.sfx || []).length, m0 = musicOf();
    const tab = (k, l, n) => `<button role="tab" data-ed="atab" data-t="${k}" aria-selected="${at === k}">${l}${n ? `<small class="ed-atn">${n}</small>` : ""}</button>`;
    p.innerHTML = head("Audio", "Music under the clip, sound effects on its moments, and how loud the voice is.") +
      `<div class="ed-stick"><div class="ed-ptabs pill wide ed-atabs" role="tablist">${tab("music", "Music", m0.id ? "1" : "")}${tab("sfx", "Sounds", nS || "")}${tab("voice", "Voice")}</div></div>` +
      (at === "voice" ? `<div class="ed-card ed-avoice"><div class="ed-h"><b>Voice level</b><small class="ed-pipnote">Every clip is evened out first; 100% is its normal level</small></div>
          ${slider("Volume", "volume", 0, 200, 5, vol, vol + "%")}
          <div class="ed-seg">${[[50, "Quieter"], [100, "Normal"], [150, "Louder"]].map(([v, l]) => `<button data-ed="vol" data-v="${v}" aria-pressed="${vol === v}">${l}</button>`).join("")}</div>
          <p class="ed-help">The meter beside the timeline shows the level as it plays.</p></div>`
        : at === "sfx" ? sfxCard() : musicCard());
  } else if (E.tab === "style") {
    const L = E.look, f = FONTS();
    // each style drawn over a frame of this very clip, where captions sit (the lower third), its name on a strip inside
    const tile = (key, look, label, del) => { const fc = fontCss(look.font, look.weight);
      const on = look.font === L.font && look.base === L.base && look.active === L.active && look.size === L.size && look.upper === L.upper;
      return `<button class="ed-preset ${on ? "on" : ""}" data-ed="${del ? "brandpick" : "preset"}" data-k="${esc(key)}" aria-pressed="${on}" title="${esc(label)}">
        <span class="ed-ps ${E.shot ? "raw" : ""}"><i style="background-image:url('${E.shot || `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`}')"></i>${on ?`<span class="ed-pck">${ic("check")}</span>` : ""}
          <span class="ed-pt" style="font-family:${fc.family};font-weight:${fc.weight};color:${look.base};${look.cap_op > 0
            ? `background:${rgba(look.cap_box || "#000000", look.cap_op)};padding:3px 8px;border-radius:6px;-webkit-text-stroke:0`
            : `-webkit-text-stroke:${look.outline ? Math.max(2, look.outline / 2.4).toFixed(1) : 0}px ${look.cap_line || "#000"}`}">
          ${look.upper ? "CLIP" : "Clip"} ${look.kw_font || look.kw_color
            ? `<em class="kw" style="color:${look.kw_color || look.active};${look.kw_font ? `font-family:${fontCss(look.kw_font).family};font-weight:${fontCss(look.kw_font).weight};` : ""}font-size:${Math.min(1.6, (look.kw_scale || 100) / 100)}em;${look.kw_italic ? "font-style:italic;" : ""}-webkit-text-stroke:0">${look.upper ? "THIS" : "this"}</em>`
            : `<em style="color:${look.active}">${look.upper ? "THIS" : "this"}</em>`}</span><b>${esc(label)}</b></span>
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
        ${slider("Outline", "outline", 0, 12, 1, L.outline, L.outline)}
        ${swatches("cap_line", "Outline colour", L.cap_line || "#000000")}`)}
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
      `<div class="ed-card ed-hookcard">
        <div class="ed-h"><b>Hook</b><label class="ed-sw2" title="Show the hook"><input type="checkbox" data-look="hook" ${L.hook ? "checked" : ""} aria-label="Show the hook"><span></span></label></div>
        <div class="ed-hookin ${L.hook ? "" : "off"}"><textarea id="edHook" rows="2" maxlength="60" placeholder="The big line at the top" ${L.hook ? "" : "disabled"}>${esc(E.hook)}</textarea>
          <div class="ed-hookbar"><button class="ed-emjbtn ed-tip ${E.emjOpen ? "on" : ""}" data-ed="emjopen" aria-expanded="${!!E.emjOpen}" aria-label="Add an emoji" data-tip="Emoji">${svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01"/>')}</button>
            <span class="ed-count ${E.hook.length > 50 ? "near" : ""}"><span id="edHookN">${E.hook.length}</span>/60</span></div></div>
        ${E.emjOpen ? emojiPicker() : ""}
      </div>
      <div class="ed-card"><b>Style</b>
        <div class="ed-hstyles">${HOOK_STYLES.map(([k, l, v]) => { const on = H.hook_box === v.hook_box && H.hook_ink === v.hook_ink && H.hook_op === v.hook_op;
          return `<button class="ed-hst ${on ? "on" : ""}" data-ed="hookstyle" data-k="${k}" aria-pressed="${on}">
          <i><s style="background-image:url('${stillOf()}')"></s><b style="background:${v.hook_op ? rgba(v.hook_box, v.hook_op) : "transparent"};color:${v.hook_ink};border-radius:4px;${v.hook_op < 35 ? "-webkit-text-stroke:2px #000;paint-order:stroke fill" : ""}">Hook</b></i><span>${l}</span></button>`; }).join("")}</div>
        <p class="ed-sub">Box</p>
        <div class="ed-f">Banner<div class="ed-seg">${[["fit", "Fitted"], ["full", "Full"], ["line", "Per line"], ["none", "None"]].map(([v, l]) =>
          `<button data-ed="hookbanner" data-v="${v}" aria-pressed="${(L.hook_banner || "fit") === v}">${l}</button>`).join("")}</div></div>
        ${swatches("hook_box", "Box colour", H.hook_box)}
        ${swatches("hook_ink", "Text colour", H.hook_ink)}
        ${slider("Box opacity", "hook_op", 0, 100, 5, H.hook_op, H.hook_op + "%")}
        ${slider("Corners", "hook_round", 0, 60, 2, H.hook_round, H.hook_round)}
      </div>
      <div class="ed-card"><b>Type</b>
        <label class="ed-f">Font<select data-look="hook_font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === H.hook_font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${slider("Size", "hook_size", 50, 140, 2, H.hook_size, H.hook_size)}
        ${typeCtl(L, H.hook_font, "hook_")}
        <div class="ed-f">Letters<div class="ed-seg">${[["asis", "As typed"], ["upper", "UPPER"], ["title", "Title"], ["lower", "lower"]].map(([v, l]) =>
          `<button data-ed="hookcase" data-v="${v}" aria-pressed="${(L.hook_case || "asis") === v}">${l}</button>`).join("")}</div></div>
        ${slider("Letter spacing", "hook_sp", -4, 24, 1, H.hook_sp, H.hook_sp)}
      </div>
      <div class="ed-card"><b>Position</b>${posCard("hook")}</div>
      <div class="ed-card"><b>On screen for</b>
        <div class="ed-f">
          <div class="ed-seg">${[[3, "3 s"], [5, "5 s"], [8, "8 s"], [0, "Whole clip"]].map(([v, l]) => `<button data-ed="hookdur" data-v="${v}" aria-pressed="${H.hook_dur === v}">${l}</button>`).join("")}</div>
          ${slider("Seconds on screen", "hook_dur", 0, Math.max(1, Math.min(60, Math.floor(E.end - E.start))), 0.5, H.hook_dur, H.hook_dur ? H.hook_dur + " s" : "Whole clip", "edHookDur")}</div>
        <p class="ed-help">The hook shows from the start of the clip, then fades away. Drag to the left end to keep it the whole time.</p>
        <button class="ed-link" data-ed="hookreset">Back to the default look</button>
      </div>
      ${saveLook()}`;
  } else if (E.tab === "layout") {
    const sp = splitOf(), split = E.layout === "split";
    const LAYS = [["blur", "Centered", "The whole video, a blurred copy behind it"], ["zoom", "Zoomed in", "Closer in, blurred above and below"],
      ["crop", "Solo", "One part of the video fills the screen"], ["split", "Face cam split", "The stream on top, the streamer's face cam below"],
      ["pip", "Picture in picture", "One part fills the screen, the face cam in a small box in a corner"], ["trio", "Trio", "Three parts stacked, for three people"],
      ["grid", "Face grid", "Two to four people, each in a cell. Scenes show one person for a stretch"],
      ["pop", "Pop-out", "The face cam in a card over the stream, the streamer cut out so their head rises over its top"],
      ["card", "Post card", "The clip inside a social post, with your name"]];
    const lic = k => ({blur: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 9h10M7 15h10"/>', zoom: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 7h10M7 17h10"/>',
      crop: '<rect x="7" y="3" width="10" height="18" rx="2" fill="currentColor" fill-opacity=".25"/>', split: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 12h10"/><circle cx="12" cy="16.5" r="1.8"/>'})[k];
    // each layout as a small phone showing this clip's own frame arranged that way
    const bg = `background-image:url('${stillOf()}')`;
    const cam = sp.cam, crop = r => `${bg};background-size:${(100 / r[2]).toFixed(1)}% ${(100 / r[3]).toFixed(1)}%;background-position:${(r[2] < 1 ? r[0] / (1 - r[2]) * 100 : 50).toFixed(1)}% ${(r[3] < 1 ? r[1] / (1 - r[3]) * 100 : 50).toFixed(1)}%`;
    const mini = k => k === "split"
      ? `<i class="lp-part" style="${crop(splitOf().game)}"></i><i class="lp-part" style="${crop(cam)}"></i>`
      : k === "pip" ? `<i class="lp-bg" style="${crop(sp.game)};filter:none"></i><i class="lp-pip ${sp.pip_at || "br"}" style="${crop(cam)}"></i>`
      : k === "trio" ? sp.trio.map(r => `<i class="lp-part t" style="${crop(r)}"></i>`).join("")
      : k === "grid" ? gridMini(sp, crop)
      : k === "pop" ? popMini(sp, crop)
      : k === "card" ? miniCard(bg, cardOf().theme)
      : `<i class="lp-bg" style="${bg}"></i><i class="lp-fg ${k}" style="${bg}"></i>`;
    const cd = cardOf();
    p.innerHTML = head("Layout", "How the video sits in the frame. Split puts the streamer's face cam under the stream.") + `
      <div class="ed-row ed-layacts"><button class="ed-btn" data-ed="tpl">${svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')}Templates</button>
        <button class="ed-btn" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Frame the video</button></div>
      <div class="ed-lays2">${LAYS.map(([k, l, s]) => `<button data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}" title="${esc(s)}">
        <span class="lp-ph ${k === "pop" ? "popout" : k} ${k === "split" && sp.cam_at === "top" ? "camtop" : ""}">${mini(k)}${E.layout === k ? `<span class="ed-pck">${ic("check")}</span>` : ""}</span>
        <b>${({split: "Face cam", pip: "PiP", zoom: "Zoomed", card: "Post card", grid: "Face grid", pop: "Pop-out"})[k] || l}</b></button>`).join("")}</div>
      <p class="ed-laynote">${esc((LAYS.find(x => x[0] === E.layout) || LAYS[0])[2])}</p>
      ${split ? `<div class="ed-card"><b>Face cam and stream</b>
        <p class="ed-help">Drag the boxes onto the stream and onto the face cam. Drag the corner to resize.</p>
        <div class="ed-pick" id="edPick" style="height:0;padding-bottom:${((E.sh || 9) / (E.sw || 16) * 100).toFixed(3)}%"><canvas id="edPickCv"></canvas>
          <div class="ed-rg game" data-rg="game"><span>Stream</span><i class="rz"></i></div>
          <div class="ed-rg cam" data-rg="cam"><span>Face cam</span><i class="rz"></i></div></div>
        <div class="ed-f">Face cam goes<div class="ed-seg">${[["bottom", "Below"], ["top", "Above"]].map(([v, l]) => `<button data-ed="splitpos" data-v="${v}" aria-pressed="${sp.cam_at === v}">${l}</button>`).join("")}</div></div>
        <div class="ed-f">Heights <small class="ed-help" style="margin:0">or drag the handle on the line in the video</small></div>
        <div class="ed-seg">${[[40, "Face bigger"], [50, "Half and half"], [60, "Stream bigger"]].map(([v, l]) => `<button data-ed="splitshare" data-v="${v}" aria-pressed="${sp.share === v}">${l}</button>`).join("")}</div>
        ${slider("Stream", "split_share", 30, 70, 1, sp.share, sp.share + "%")}
        <div class="ed-f">Line between them</div>
        <div class="ed-seg">${[[0, "None"], [4, "Thin"], [8, "Medium"], [14, "Bold"]].map(([v, l]) => `<button data-ed="splitline" data-v="${v}" aria-pressed="${(E.look.stroke || 0) === v}">${l}</button>`).join("")}</div>
        ${E.look.stroke ? `<div class="ed-swrow">${STROKE_COLS.map(c => `<button class="ed-dot" data-ed="strokecol" data-v="${c}" style="--c:${c}" aria-pressed="${(E.look.stroke_color || "#FFFFFF").toUpperCase() === c}" aria-label="Line colour ${c}"></button>`).join("")}</div>` : ""}
        <button class="ed-link" data-ed="splitreset">Back to the usual spots</button></div>` : ""}
      ${E.layout === "pip" ? pipCard(sp) : ""}
      ${E.layout === "trio" ? `<div class="ed-card"><b>Three parts</b>
        <p class="ed-help">Each band shows one part of the picture. Put a box on each person in the Frame view.</p>
        <div class="ed-row"><button class="ed-btn" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Place the three parts</button>
          <button class="ed-btn ghost" data-ed="trioreset">Back to thirds</button></div></div>` : ""}
      ${E.layout === "grid" ? gridCard(sp) : ""}
      ${E.layout === "pop" ? popCard(sp) : ""}
      ${E.layout === "blur" || E.layout === "zoom" ? bgCard() : ""}
      ${strokeCard()}
      ${E.layout === "card" ? cardPanel(cd) : ""}`;
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
        <div class="ed-bmot">${BRAND_ANIMS.map(([k, l]) => `<button data-ed="brandanim" data-v="${k}" aria-pressed="${(L.brand_anim || "float") === k}">
          <span class="ed-bmpv"><i class="ed-bmlogo m-${k}"></i></span><b>${l}</b></button>`).join("")}</div>
        <p class="ed-help">${{none: "Stays in one place.", float: "Bobs gently up and down.", slide: "Slides in from its side at the start.", drift: "Glides from one side to the other and back, so it's never in one fixed spot.", fade: "Fades in at the start."}[L.brand_anim || "float"]}</p>
      </div>
      <div class="ed-card"><b>Size and look</b>
        ${slider("Size", "brand_size", 40, 200, 2, L.brand_size || 84, L.brand_size || 84)}
        ${slider("Opacity", "brand_op", 20, 100, 5, L.brand_op ?? 90, (L.brand_op ?? 90) + "%")}
      </div>`;
  } else if (E.tab === "media") {
    p.innerHTML = head("Media", "Your pictures on the video, and an outro after it. Upload once, use on any clip.") + picsCard() + facesCard() + outroCard();
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
  } else if (E.tab === "trim" && hasShots()) {
    p.innerHTML = head("Trim", "This clip joins several shots from the video, played one after another.") +
      `<div class="ed-card ed-trim2"><div class="ed-tlen"><span>Clip length</span><b>${ts(keptLen())}</b></div>
        <div class="ed-trange" aria-hidden="true">${E.shots.map(([a, b]) => `<i style="left:${(a - E.min) / Math.max(0.1, E.max - E.min) * 100}%;width:${(b - a) / Math.max(0.1, E.max - E.min) * 100}%"></i>`).join("")}</div>
        <div class="ed-shots">${E.shots.map(([a, b], i) => `<div class="ed-shotrow ${i === E.shotSel ? "on" : ""}">
          <button class="ed-shotgo" data-ed="shotgo" data-v="${i}"><span class="ed-shotn">${i + 1}</span><span>${ts(a - E.min)} – ${ts(b - E.min)}</span><small>${ts(b - a)}</small></button>
          <button class="ed-ib sm ed-tip" data-ed="shotdel" data-v="${i}" aria-label="Remove shot ${i + 1}" data-tip="Remove">${ic("x")}</button></div>`).join("")}</div>
        <button class="ed-btn" data-ed="shotadd">${svg('<path d="M12 5v14M5 12h14"/>')}Add a shot at the playhead</button></div>
      <p class="ed-help ed-cfoot">Drag a shot's ends on the timeline to choose its moment, or the shot itself to move it. Double-click the film strip to add one there.</p>`;
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
      <button class="ed-aicard ed-shotoffer" data-ed="shotadd"><span class="ed-aiic">${svg('<rect x="3" y="6" width="7" height="12" rx="1.5"/><rect x="14" y="6" width="7" height="12" rx="1.5"/><path d="M10 12h4"/>')}</span>
        <span><b>Join another moment</b><small>Add a second shot from anywhere in the video; they play one after another.</small></span></button>
      <p class="ed-help ed-cfoot">3 seconds to 3 minutes. Or drag the yellow edges on the timeline.</p>`;
  } else {
    const c = clipNow();
    p.innerHTML = head("Post", "The words that go with the clip, and where it goes.") + postPanel(c);
  }
}

// the Post panel: the post's words with their room left, then where it goes (accounts as tiles) and how
function postPanel(c) {
  const mark = k => (typeof APP_MARK !== "undefined" && APP_MARK[k]) || "";
  const posts = Object.values(c?.posts || {}).filter(x => x.status !== "cancelled").sort((x, y) => (x.due_at || 0) - (y.due_at || 0));
  const st = x => x.status === "posted" ? ["ok", "Posted"] : x.status === "failed" ? ["bad", "Failed"] : x.status === "posting" ? ["warn", "Posting"]
    : ["warn", new Date((x.due_at || 0) * 1000).toLocaleString([], {weekday: "short", hour: "2-digit", minute: "2-digit"})];
  const accs = S.accounts || [], pick = E.postPick || new Set();
  return `<div class="ed-card ed-ptxt">
      <label class="ed-f"><span class="ed-flab">Title<small id="edTitleN">${E.title.length}/100</small></span>
        <input id="edTitle" value="${esc(E.title)}" maxlength="100" placeholder="What viewers see first"></label>
      <label class="ed-f"><span class="ed-flab">Description<small id="edDescN">${E.description.length}/2000</small></span>
        <textarea id="edDesc" rows="5" maxlength="2000" placeholder="A line or two, then hashtags">${esc(E.description)}</textarea></label>
      <button class="ed-btn sm ghost ed-pcopy" data-act="copy" data-j="${E.jid}" data-c="${esc(E.cid)}">${ic("copy")}Copy title and description</button>
    </div>
    ${posts.length ? `<div class="ed-card ed-plist"><b>Planned and posted</b>
      ${posts.map(x => { const [cls, t] = st(x); return `<div class="ed-prow"><span class="ed-pmk">${mark(x.platform)}</span>
        <span class="ed-pnm">${esc(x.account_name || x.platform || "")}</span><span class="ed-pst ${cls}" title="${esc(x.error || "")}">${esc(t)}</span>
        ${x.url ? `<a class="ed-ib sm" href="${esc(x.url)}" target="_blank" rel="noopener" aria-label="Open the post">${ic("arrowr")}</a>` : ""}</div>`; }).join("")}</div>` : ""}
    <div class="ed-card ed-pto"><b>Post to</b>
      ${accs.length ? `<div class="ed-paccs">${accs.map(a => `<label class="ed-pacc ${pick.has(a.id) ? "on" : ""}">
          <input type="checkbox" data-pacc value="${esc(a.id)}" ${pick.has(a.id) ? "checked" : ""}>
          <span class="ed-pmk">${mark(a.platform)}</span><span class="ed-pacct"><b>${esc(a.name)}</b><small>${esc(a.label)}</small></span>
          <i class="ed-pchk">${svg('<path d="M5 12l5 5L20 7"/>')}</i></label>`).join("")}</div>
        ${dirty() ? `<p class="ed-pwarn">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/>')}You have changes that aren't saved. The last saved version is what gets posted.</p>` : ""}
        <div class="ed-pacts"><button class="ed-btn primary" data-act="postnow" ${pick.size ? "" : "disabled"}>${ic("send")}Post now${pick.size > 1 ? ` to ${pick.size}` : ""}</button>
          <button class="ed-btn" data-act="schnew" data-j="${E.jid}" data-c="${esc(E.cid)}">${ic("calendar")}Schedule</button></div>
        <button class="ed-link ed-pq" data-act="postqueue" ${pick.size ? "" : "disabled"}>Or add it to the posting queue</button>`
      : `<div class="ed-pnone"><span class="ed-saveic">${ic("plug")}</span><div><b>No accounts connected</b>
          <p class="ed-help">Connect YouTube, Instagram, TikTok or X to post from here. You can still plan posts on the calendar.</p>
          <div class="ed-pacts"><button class="ed-btn sm primary" data-act="go" data-v="settings" data-tab="apps">Connect accounts</button>
            <button class="ed-btn sm" data-act="schnew" data-j="${E.jid}" data-c="${esc(E.cid)}">${ic("calendar")}Schedule</button></div></div></div>`}
    </div>`;
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
  const split = g.layout === "split", parts = isParts(g.layout), sp = splitOf();
  const band = (id, vidId, muted) => `<div class="ed-band" id="${id}"><video class="ed-bv" id="${vidId}" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto" ${muted ? "muted" : ""}></video></div>`;
  const asp = E.look.aspect || "9:16";
  const ASP = [["9:16", "Vertical", "Shorts, Reels, TikTok"], ["4:5", "Portrait", "Instagram and Facebook feed"],
    ["1:1", "Square", "Feeds and ads"], ["16:9", "Wide", "YouTube, X, LinkedIn"]];
  const aspIc = a => { const [w, h] = ASPECTS[a], s = 16 / Math.max(w, h); return svg(`<rect x="${12 - w * s / 2}" y="${12 - h * s / 2}" width="${w * s}" height="${h * s}" rx="2"/>`); };
  const frameLbl = {crop: `Fills the ${asp} frame`, blur: "Shown part", zoom: "Shown part", card: "Shown in the post"}[E.layout] || "Shown part";
  st.innerHTML = (E.view === "frame" ? `<div class="ed-fwrap"><div class="ed-fpic" style="--ar:${((E.sw || 16) / (E.sh || 9)).toFixed(4)}"><div class="ed-fview" id="edFview" style="aspect-ratio:${E.sw || 16}/${E.sh || 9}">
        <video class="ed-fvid" id="edVid" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto"></video>
        ${g.layout === "grid" ? sp.faces.map((_, i) => `<div class="ed-rg f${i}" data-rg="f${i}"><span>${personName(i)}</span><i class="rz"></i></div>`).join("")
          : g.layout === "trio" ? ["Top", "Middle", "Bottom"].map((l, i) => `<div class="ed-rg t${i}" data-rg="t${i}"><span>${l}</span><i class="rz"></i></div>`).join("")
          : g.layout === "pip" || g.layout === "pop" ? `<div class="ed-rg game" data-rg="game"><span>Full screen</span><i class="rz"></i></div>
          <div class="ed-rg cam" data-rg="cam"><span>${g.layout === "pop" ? "Face cam card" : "Small box"}</span><i class="rz"></i></div>`
          : split ? `<div class="ed-rg game" data-rg="game"><span>${sp.cam_at === "top" ? "Bottom" : "Top"} part</span><i class="rz"></i></div>
          <div class="ed-rg cam" data-rg="cam"><span>${sp.cam_at === "top" ? "Top" : "Bottom"} part</span><i class="rz"></i></div>`
          : `<div class="ed-rg frame" data-rg="frame"><span>${esc(frameLbl)}</span><i class="rz"></i></div>`}</div>
      <p class="ed-fhelp">${{trio: "Drag each box onto one person. Drag a corner to resize.", grid: "Drag each box onto one person. Drag a corner to resize.", pip: "Drag the boxes: one fills the screen, the other goes in the small box.",
        pop: "Drag the boxes: one fills the screen, the other goes in the card. Leave room above the head: the top part rises over the card.",
        split: "Drag the boxes onto the stream and onto the face cam. Drag a corner to resize."}[g.layout] || "Drag the box to choose what shows. Drag its corner to zoom in or out."}</p></div>
      <div class="ed-fdock" role="toolbar" aria-label="Frame tools">
        <div class="ed-fgrid" role="radiogroup" aria-label="Layout">${FRAME_LAYS.map(([k, l, v]) => {
          const duo = E.layout === "split" && rawSplit().game.join() === "0,0,0.5,1" && rawSplit().cam.join() === "0.5,0,0.5,1";
          const on = v ? duo : E.layout === k && !(k === "split" && duo);
          return `<button role="radio" data-ed="layout" data-v="${k}" ${v ? `data-kind="${v}"` : ""} aria-checked="${on}" title="${esc(LAY_TIP[v || k] || "")}">${svg(LAY_IC[v || k])}<span>${l}</span></button>`; }).join("")}</div>
        <span class="ed-fsep" aria-hidden="true"></span>
        ${g.layout === "pip" ? `<div class="ed-fcorner" role="group" aria-label="Small box corner"><span class="ed-fcgrid">${[["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]].map(([v, l]) =>
          `<button data-ed="pipat" data-v="${v}" aria-pressed="${sp.pip_x == null && (sp.pip_at || "br") === v}" aria-label="${l}" title="Small box: ${l.toLowerCase()}"></button>`).join("")}</span><span>Corner</span></div>` : ""}
        ${g.layout === "grid" ? `<div class="ed-fpeople" role="radiogroup" aria-label="People"><span>${[2, 3, 4].map(n => `<button role="radio" data-ed="gridn" data-v="${n}" aria-checked="${sp.faces.length === n}" title="${n} people">${n}</button>`).join("")}</span><small>People</small></div>` : ""}
        <button class="ed-tf" data-ed="framereset" title="Put the boxes back where they started">${svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>')}<span>Reset</span></button>
        <button class="ed-tf" data-ed="tab" data-t="layout" title="${{pip: "Face box settings: shape, size, corners, border", pop: "Card settings: size, corners, border, how far the head pops out", trio: "Settings for the three parts", grid: "Grid settings: people, rows and scenes", split: "Settings for the two parts"}[g.layout] || "Layout settings"}">${svg('<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>')}<span>Settings</span></button></div></div>`
    : `<div class="ed-phone" id="edPhone" style="--aw:${OUT_W};--ah:${OUT_H}">
      ${E.view === "live" ? `${g.layout === "pip" ? band("edBandG", "edVid", false) + `<div class="ed-band ed-pipb" id="edBandC"><video class="ed-bv" id="edVid2" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto" muted></video></div>`
        : g.layout === "pop" ? band("edBandG", "edVid", false) + `<i class="ed-popring" id="edPopRing" aria-hidden="true"></i>`
          + `<i class="ed-popfill" id="edPopFill" aria-hidden="true"></i><div class="ed-band ed-pipb ed-popb" id="edBandC"><video class="ed-bv" id="edVid2" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto" muted></video></div>`
          + `<div class="ed-band ed-popo" id="edBandO" title="Drag to move the card"><video class="ed-bv" id="edVid3" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto" muted></video></div>`
          + `<video class="ed-popcut" id="edPopCut" playsinline preload="auto" muted aria-hidden="true"></video><canvas class="ed-popcut" id="edPopCv" aria-hidden="true"></canvas>`
          + `<i class="ed-popguide" id="edPopGuide" aria-hidden="true"></i><button class="ed-gseam ed-popline" id="edPopLine" aria-label="Drag up or down to set where the card's top edge crosses the head" title="Drag up or down: where the card's edge crosses the head"><i></i></button>`
        : g.layout === "trio" ? band("edBandG", "edVid", false) + band("edBandC", "edVid2", true) + band("edBandT", "edVid3", true)
        : g.layout === "grid" ? GRID_V.slice(0, sp.faces.length).map(([b, v], i) => band(b, v, i > 0).replace('class="ed-band"', 'class="ed-band ed-gcell"')).join("")
          + `<button class="ed-gseam" id="edGseam" aria-label="Drag to resize the rows" title="Drag to resize the rows"><i></i></button>`
        : split
        ? (sp.cam_at === "bottom" ? band("edBandG", "edVid", false) + band("edBandC", "edVid2", true) : band("edBandC", "edVid2", true) + band("edBandG", "edVid", false))
          + `<button class="ed-gseam ed-sseam" id="edSseam" aria-label="Drag to change how much the stream and the face cam take" title="Drag to set the stream and face cam heights"><i></i></button>`
        : `${g.layout === "card" ? `<div class="ed-post" id="edPost"></div>` : `<img class="ed-bg ${g.layout === "crop" ? "none" : ""}" src="/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}" alt="">`}
        <div class="ed-band ed-fgb" id="edFgBox"><video class="ed-bv" id="edVid" src="/media/${E.jid}/${E.cid}/source?f=mp4" playsinline preload="auto"></video></div>`}
        ${E.safe ? safeHtml() : ""}<div class="ed-zgrain" id="edZgrain" hidden></div><span class="ed-zbadge" id="edZbadge" hidden></span><div class="ed-pics" id="edPics"></div><i class="ed-zdot" id="edZdot" hidden></i><div class="ed-outro" id="edOutro" hidden></div>
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
      <button class="ed-bar-lbl ed-aibtn ed-tip ${E.aiBusy ? "busy" : ""}" data-ed="aiedit" aria-label="AI edit" data-tip="Let the AI add music, zooms and sound effects" ${E.aiBusy ? "disabled" : ""}>${svg('<path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 9l1.6-4.2a1 1 0 0 1 1.2-.6L20 7.6M9.5 5.4l-1.8 3.6M14.8 6.8L13 9"/>')}<span>${E.aiBusy ? "Editing…" : "AI edit"}</span></button>
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
  placeSafePick();
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
    else if (E.view !== "rendered" && !v.paused && (E.cuts?.length || hasShots())) {   // playing over a cut part (or a gap between shots): jump past it
      const c = allCuts().find(([a, b]) => t >= a && t < b - 0.03); if (c) seek(c[1]);
    }
    paintOverlay(t);
    syncMusic(t, v); syncSfx(t, v);
    const ph = $e("#edHead"); if (ph) ph.style.left = pct(t) + "%";
    const now = ts(Math.max(0, t - E.start));
    if (now !== E.shownNow) { E.shownNow = now; const tl = $e("#edNow"); if (tl && !tl.querySelector("input")) tl.textContent = now;
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
const EX_PRESETS = [["reels", "Instagram Reels", "instagram", {fmt: "mp4", fps: 60, q: "1080", speed: 1}],
  ["shorts", "YouTube Shorts", "youtube", {fmt: "mp4", fps: 60, q: "1080", speed: 1}],
  ["tiktok", "TikTok", "tiktok", {fmt: "mp4", fps: 60, q: "1080", speed: 1}],
  ["x", "X", "x", {fmt: "mp4", fps: 30, q: "720", speed: 1}]];
const EX_RES = [["720", "720p"], ["1080", "1080p"], ["1440", "2K"], ["2160", "4K"]];
const EX_MBPS = {"720": 2.4, "1080": 4.5, "1440": 8, "2160": 14, web: 1.0, medium: 1.5, high: 2.1, ultra: 3.2};   // about what each comes to, for the estimate
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
      : `<div class="ed-ex-grp"><span>Quality</span>${seg("q", EX_RES)}</div>`}
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
    if (btn) { btn.disabled = true; btn.classList.add("going"); rollLabel(btn, "Exporting 0%"); btn.style.setProperty("--p", "0%"); }
    const {token} = await send(`/api/jobs/${E.jid}/clips/${E.cid}/export`, {fmt: x.fmt, fps: x.fps, q: x.q, speed: x.speed});
    let st = {pct: 0, done: false};
    while (!st.done) {                  // how far along it is, straight from the server, every half second
      await new Promise(r => setTimeout(r, 450));
      st = await api(`/api/exports/${token}`);
      if (btn) { btn.style.setProperty("--p", st.pct + "%"); const l = btn.querySelector(".pf-l"); if (l) l.textContent = `Exporting ${st.pct}%`; }
      E.exPct = st.pct;
    }
    if (st.error) throw new Error(st.error);
    const r = await fetch(`/api/exports/${token}/file`);
    if (!r.ok) throw new Error("The export didn't work.");
    const blob = await r.blob();
    if (blob.size < 1024) throw new Error("The export came back empty. Try exporting again.");
    const name = (c.title || c.hook || "clip").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + "." + x.fmt;
    exDoneClear();
    // the finished file stays in the page while the window is open: it plays below, and can be saved again
    E.exDone = {url: URL.createObjectURL(blob), blob, name, size: blob.size, fmt: x.fmt, fps: x.fmt === "gif" ? Math.min(x.fps, 15) : x.fps,
      q: x.q, speed: x.speed, secs: x.fmt === "gif" ? Math.min(20, keptLen() / x.speed) : keptLen() / x.speed};
    ok = true;
    exAutoSave();          // a folder chosen before: it goes straight into the creator's folder, no extra click
  } catch (er) { toast(er.message, "bad"); }
  if (btn) pfStop(btn, ok ? "Done 100%" : "Confirm and export", "Confirm and export");
  // finished: the full button and "Downloaded" stay a moment, then the window shows the finished file; a failure keeps the settings
  setTimeout(() => { E.exBusy = false; drawEx(); }, ok ? 900 : 300);
}
/* Exports are saved in one folder the person picks once (kept in this browser), each creator's clips in a folder
   of their own inside it, made the first time: "<your folder>/<creator>/<clip>.mp4". Where the browser can't
   write to folders, the file downloads with the creator's name in front. */
const exFolderName = () => {
  const job = typeof jobOf === "function" ? jobOf(E.jid) : null;
  const c = job?.creator && (S.creators || []).find(x => x.id === job.creator);
  const raw = c?.name || job?.uploader || (job?.source?.name || "").replace(/ live$/, "") || "SocialShot clips";
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "SocialShot clips";
};
function exDb(mode, fn) {               // a small store in this browser for the chosen folder (it can't go to the server)
  return new Promise((res, rej) => {
    const r = indexedDB.open("socialshot", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const t = r.result.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); };
  });
}
const exRootGet = () => exDb("readonly", s => s.get("exportRoot")).catch(() => null);
const exRootSet = h => exDb("readwrite", s => h ? s.put(h, "exportRoot") : s.delete("exportRoot")).catch(() => null);
async function exAutoSave() {          // only when the folder is already allowed: never a prompt the person didn't ask for
  if (!window.showDirectoryPicker) return;
  const root = await exRootGet();
  if (root && (await root.queryPermission({mode: "readwrite"}).catch(() => "")) === "granted") exSave();
}
async function exRoot(pickNew) {
  let root = pickNew ? null : await exRootGet();
  if (root && (await root.queryPermission({mode: "readwrite"})) !== "granted" && (await root.requestPermission({mode: "readwrite"})) !== "granted") root = null;
  if (!root) { root = await window.showDirectoryPicker({id: "socialshot-exports", mode: "readwrite", startIn: "videos"}); await exRootSet(root); }
  return root;
}
async function exSave(pickNew = false) {
  const d = E.exDone; if (!d) return;
  const folder = exFolderName();
  if (window.showDirectoryPicker) {
    try {
      const root = await exRoot(pickNew), dir = await root.getDirectoryHandle(folder, {create: true});
      const dot = d.name.lastIndexOf("."), stem = d.name.slice(0, dot), ext = d.name.slice(dot);
      let name = d.name;
      for (let n = 2; n < 100; n++) {      // never over an earlier export: "name (2).mp4" and so on
        try { await dir.getFileHandle(name); name = `${stem} (${n})${ext}`; } catch { break; }
      }
      const blob = d.blob || await (await fetch(d.url)).blob();
      if (!blob.size) throw new Error("empty");
      const h = await dir.getFileHandle(name, {create: true});
      try {                                // written whole, then checked; a failed write never leaves an empty file behind
        const w = await h.createWritable();
        try { await w.write(blob); await w.close(); } catch (er) { await w.abort?.().catch(() => {}); throw er; }
        if ((await h.getFile()).size !== blob.size) throw new Error("short");
      } catch (er) { await dir.removeEntry(name).catch(() => {}); throw er; }
      d.saved = `${root.name}/${folder}/${name}`; drawEx(); return toast(`Saved in ${root.name} › ${folder}`, "ok");
    } catch (er) {
      if (er.name === "AbortError") return;
      toast("Couldn't write into that folder, so it's downloading instead.", "bad");
    }
  }
  const a = document.createElement("a"); a.href = d.url; a.download = `${folder} - ${d.name}`;
  document.body.append(a); a.click(); a.remove(); d.saved = `${folder} - ${d.name}`; drawEx();
}
function exDoneClear() { if (E.exDone) { URL.revokeObjectURL(E.exDone.url); E.exDone = null; } }
// the finished export: the file playing, what it is, and what to do next
function exDoneHtml() {
  const d = E.exDone, gif = d.fmt === "gif";
  let [w, h] = gif ? [480, Math.round(480 * OUT_H / OUT_W)] : [OUT_W, OUT_H];
  const mb = d.size / 1e6, Q = {web: "Web", medium: "Medium", high: "High", ultra: "Ultra", "720": "720p", "1080": "1080p", "1440": "2K", "2160": "4K"};
  const R = {"720": [720, 1280], "1440": [1440, 2560], "2160": [2160, 3840]};
  if (!gif && R[d.q]) [w, h] = R[d.q];
  const res = gif ? "GIF" : ({"720": "720p", "1080": "1080p", "1440": "2K", "2160": "4K"}[d.q] || `${w}×${h}`);
  const tile = (l, v) => `<div class="ed-xt"><small>${l}</small><b>${v}</b></div>`;
  return `<header class="ed-xhead"><span class="ed-xok">${ic("check")}</span><div><h3>Your video is ready</h3>
      <p>${res} · ${d.fps} fps · ${gif ? "GIF" : "MP4"} · ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB</p></div>
      <button class="ed-ib" data-ed="exclose" aria-label="Close">${ic("x")}</button></header>
    <div class="ed-exdone">
      <div class="ed-expv" style="aspect-ratio:${w}/${h}">${gif ? `<img src="${d.url}" alt="The exported GIF">`
        : `<video src="${d.url}" controls autoplay muted loop playsinline></video>`}</div>
      <div class="ed-exinfo">
        <b class="ed-xname" title="${esc(d.name)}">${esc(d.name)}</b>
        <div class="ed-xtiles">${tile("Resolution", `${w}×${h}`)}${tile("Frame rate", `${d.fps} fps`)}${tile("Quality", Q[d.q] || (gif ? "GIF" : d.q))}
          ${tile("Length", ts(d.secs) + (d.speed !== 1 ? ` · ${d.speed}×` : ""))}${tile("Format", gif ? "GIF" : "MP4")}${tile("File size", `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`)}</div>
        ${d.saved ? `<p class="ed-xsaved">${ic("check")}Saved: ${esc(d.saved)}</p>` : ""}
        <button class="ed-xsave" data-ed="exagain">${ic("down")}${d.saved ? "Save another copy" : `Save to ${esc(exFolderName())} folder`}</button>
        ${window.showDirectoryPicker ? `<button class="ed-xmore" data-ed="exfolder">Choose a different main folder</button>` : ""}
        <button class="ed-xmore" data-ed="exnew">Export another way</button>
      </div></div>`;
}
/* ---------- a border on the video (Layout), drawn the way render._stroke draws it: around the video box
   (Centered, Zoomed), along the frame's edge (Solo, picture in picture), between the parts (Split, Trio) */
const STROKE_COLS = ["#FFFFFF", "#0A0A0A", "#EA580C", "#FACC15", "#22C55E", "#3B82F6", "#EC4899"];
function paintStroke() {
  const ph = $e("#edPhone"); if (!ph) return;
  let el = $e("#edStroke");
  const w = E.look.stroke || 0, col = E.look.stroke_color || "#FFFFFF", L = geo(E.layout, E.sw, E.sh).layout;   // a tall video in Centered is shown as Solo
  const key = [w, col, L, ph.clientWidth, E.look.pad, E.look.vradius, JSON.stringify(E.look.split || {}), E.sw, E.sh, L === "grid" ? JSON.stringify(gridNow()) : ""].join("|");
  if (el && el.dataset.k === key) return;
  if (!el) { el = document.createElement("div"); el.id = "edStroke"; el.className = "ed-stroke"; el.setAttribute("aria-hidden", "true"); ph.append(el); }
  el.dataset.k = key;
  ph.classList.toggle("sq", !!w && (L === "crop" || L === "pip" || L === "pop") && E.view === "live");   // the video is square: so is its border
  if (!w || L === "card" || E.view !== "live") { el.innerHTML = ""; return; }
  const k = ph.clientWidth / OUT_W, b = Math.max(2, Math.round(w * OUT_W / 1080 / 2) * 2) * k;
  const line = y => `<i style="left:0;right:0;top:${y * k - b / 2}px;height:${b}px;background:${col}"></i>`;
  if (L === "split") { const sp = splitOf(), gh = Math.round(OUT_H * sp.share / 100 / 2) * 2; el.innerHTML = line(sp.cam_at === "bottom" ? gh : OUT_H - gh); return; }
  if (L === "trio") { const t = trioH(); el.innerHTML = line(t[0]) + line(t[0] + t[1]); return; }
  if (L === "grid") {                   // render.grid_seams: under the top row, and between the people side by side
    const gn = gridNow(), n = rawSplit().faces.length; if (gn.show !== "all") { el.innerHTML = ""; return; }
    const th = gridCells(n, gn.share)[0][3], hw = Math.round(OUT_W / 2 / 2) * 2;
    const vline = (y0, y1) => `<i style="left:${hw * k - b / 2}px;width:${b}px;top:${y0 * k}px;height:${(y1 - y0) * k}px;background:${col}"></i>`;
    el.innerHTML = line(th) + (n === 3 ? vline(th, OUT_H) : n >= 4 ? vline(0, OUT_H) : ""); return;
  }
  if (L === "crop" || L === "pip" || L === "pop") { el.innerHTML = `<i style="inset:0;box-shadow:inset 0 0 0 ${b}px ${col}"></i>`; return; }
  const box = $e("#edFgBox"); if (!box) { el.innerHTML = ""; return; }
  const r = box.getBoundingClientRect(), P = ph.getBoundingClientRect(), rad = parseFloat(box.style.borderRadius) || 0;
  el.innerHTML = r.width >= P.width - 1 ? line((r.top - P.top) / k - b / k / 2) + line((r.bottom - P.top) / k + b / k / 2)
    : `<i style="left:${r.left - P.left - b}px;top:${r.top - P.top - b}px;width:${r.width + 2 * b}px;height:${r.height + 2 * b}px;border-radius:${rad ? rad + b : 0}px;box-shadow:inset 0 0 0 ${b}px ${col}"></i>`;
}
function strokeCard() {
  if (E.layout === "card") return "";
  const w = E.look.stroke || 0, col = E.look.stroke_color || "#FFFFFF";
  const where = {blur: "Around the video", zoom: "Around the video", crop: "Along the edge of the frame", pip: "Along the edge of the frame", pop: "Along the edge of the frame",
    split: "On the line between the two parts", trio: "On the lines between the parts", grid: "On the lines between the people"}[E.layout] || "";
  return `<div class="ed-card ed-strokeset"><div class="ed-h"><b>Border</b><small class="ed-pipnote">${where}</small></div>
    <label class="ed-sl" style="--p:${pctOf(w, 0, 24)}"><input type="range" min="0" max="24" step="1" value="${w}" data-stroke aria-label="Border width"><span class="ed-sl-l">Width</span><output>${w || "None"}</output></label>
    ${w ? `<div class="ed-piprow"><span class="ed-pipl">Colour</span><div class="ed-pipcols">${STROKE_COLS.map(c => `<button data-ed="strokecol" data-v="${c}" style="--c:${c}" aria-pressed="${col === c}" aria-label="${c}"></button>`).join("")}
      <label class="ed-pipcp" style="--c:${col}" title="Any colour"><input type="color" value="${col.toLowerCase()}" data-strokecol aria-label="Any border colour"></label></div></div>` : ""}</div>`;
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
    E.media = [...r.items, ...(E.media || []).filter(m => m.pack)];
    const it = r.items.find(x => x.id === r.id);
    if (forWhat === "outro") { E.look.outro = {...outroOf(), on: true, kind: it?.kind === "video" ? "file" : outroOf().kind, ...(it?.kind === "video" ? {file: r.id} : {pic: r.id})}; E.lookTouched = true; }
    else if (it?.kind === "image") picAdd(r.id);
    toast("Added to your library", "ok");
  } catch (er) { toast(er.message, "bad"); }
  E.medBusy = false; drawPanel(); after("");
}
function facesCard() {
  const F = (E.media || []).filter(m => m.pack); if (!F.length) return "";
  return `<div class="ed-card"><div class="ed-h"><b>Reaction faces</b><small class="ed-pipnote">Tap one to put it on the video</small></div>
    <div class="ed-faces">${F.map(f => `<button class="ed-face" data-ed="picadd" data-v="${f.id}" title="${esc(f.name)}: ${esc(f.when || "")}"><img src="${mediaUrl(f.id)}" alt="" loading="lazy"><span>${esc(f.name)}</span></button>`).join("")}</div></div>`;
}
function picAdd(id) {
  const m = (E.media || []).find(x => x.id === id); if (!m || m.kind !== "image") return;
  const L = E.look.overlays || [];
  if (E.picSwap != null && L[E.picSwap]) {          // replacing: the new picture keeps the old one's place, size and time
    L[E.picSwap].id = id; E.picSel = E.picSwap; E.picSwap = null; E.look.overlays = L; E.lookTouched = true;
    drawPanel(); drawTimeline(); E.picKey = ""; after(""); return toast("Picture replaced", "ok");
  }
  if (L.length >= 8) return toast("Up to 8 pictures on one clip.", "bad");
  if (m.pack) {
    const a = Math.max(E.start, Math.min(E.end - 0.5, nowT()));
    L.push({id, x: 74, y: 22, w: 34, a: Math.round(a * 100) / 100, b: Math.round(Math.min(E.end, a + 1.5) * 100) / 100, op: 100});
    if (m.sfx) { const S2 = E.look.sfx || []; S2.push({id: m.sfx, t: Math.round(a * 100) / 100, vol: 90}); S2.sort((p, q) => p.t - q.t); E.look.sfx = S2; sfxTry(m.sfx); }
  } else
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
  const lib = (E.media || []).filter(m => m.kind === "image" && !m.pack), on = E.look.overlays || [], sel = on[E.picSel];
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
  const own = E.look.overlays || [];
  const L = [...own, ...(E.look.zooms || []).filter(z => z.react).map(z => ({id: z.react, x: 74, y: 22, w: 34, a: z.a, b: z.b, op: 100, zoom: true}))];
  const key = JSON.stringify(L) + "|" + E.picSel + "|" + phone.clientWidth;
  if (E.picKey !== key) {
    E.picKey = key;
    box.innerHTML = L.map((o, i) => `<div class="ed-pic ${i === E.picSel ? "sel" : ""} ${o.zoom ? "zr" : ""}" data-pi="${o.zoom ? -1 : i}" style="left:${o.x}%;top:${o.y}%;width:${o.w}%;opacity:${o.op / 100}">
      <img src="${mediaUrl(o.id)}" alt="" draggable="false">${i === E.picSel ? `<i class="rz"></i>` : ""}</div>`).join("");
  }
  [...box.children].forEach((el, i) => { const o = L[i]; if (o) el.hidden = !(t >= o.a && t <= o.b); });
}
let picDrag = null;
dlg_on("pointerdown", e => {
  const el = e.target.closest(".ed-pic"); if (!el || E.view !== "live" || el.classList.contains("zr")) return;
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
// an empty row: a quiet dashed hint across the clip that opens the tool that fills it
const emptyRow = (cls, tab, icon, text) => `<div class="ed-lane ${cls} znone"><button class="ed-ehint ${cls}" data-ed="tab" data-t="${tab}"
  style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%">${icon}<span>${text}</span></button></div>`;
function picsLane() {
  const L = E.look.overlays || []; if (!L.length) return emptyRow("pics", "media", PIC_IC, "Add a picture or a reaction face");
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
const outroOf = () => ({on: false, kind: "card", secs: 3, bg: OUTRO_BG.black, pic: "", pic_size: 270, pic_round: 0, title: "", sub: "", file: "",
  bg_kind: "solid", fx: false, icons: false, ...(E.look?.outro || {})});
const OUTRO_ICONS = ["youtube", "tiktok", "instagram"];     // the same as render.OUTRO_ICONS
function outroGeo(Wd, Hd, o, hasPic) {
  const u = Math.min(Wd, Hd * 9 / 16) / 1080, ps = hasPic ? Math.round(o.pic_size * u) : 0;
  const parts = [...(hasPic ? [ps] : []), ...(o.title ? [Math.round(64 * u)] : []), ...(o.sub ? [Math.round(44 * u)] : [])];
  const gp = Math.round(36 * u), gt = Math.round((o.fx && o.sub ? 26 : 10) * u);
  const total = parts.reduce((a, b) => a + b, 0) + (hasPic && (o.title || o.sub) ? gp : 0) + (o.title && o.sub ? gt : 0)
    + (o.icons ? Math.round(64 * u) + Math.round(92 * u) : 0);
  let y = (Hd - total) / 2; const g = {u, ps, pic_y: Math.round(y)};
  y += ps + (hasPic && (o.title || o.sub) ? gp : 0); g.title_y = Math.round(y + 32 * u);
  y += o.title ? Math.round(64 * u) + (o.sub ? gt : 0) : 0; g.sub_y = Math.round(y + 22 * u);
  y += o.sub ? Math.round(44 * u) : 0; g.icons_y = Math.round(y + 64 * u);
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
  const picSrc = o.pic === "logo" ? (E.logoV ? `/api/brand/logo?v=${E.logoV}` : "") : o.pic === "socialshot" ? "/brand/logo-mark.png" : o.pic ? mediaUrl(o.pic) : "";
  const g = outroGeo(OUT_W, OUT_H, o, !!picSrc), dark = o.bg_kind === "blur" || o.fx, [ink, sub] = dark ? ["#FFFFFF", "#E4E4E7"] : inkFor(o.bg || "#0E0E10"), u = g.u * k;
  const cover = `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`;
  const disc = 92 * u, gap = 24 * u, row = OUTRO_ICONS.length * disc + (OUTRO_ICONS.length - 1) * gap;
  return `<div class="ed-outro-c ${o.fx ? "fx" : ""}" style="background:${o.bg}">
    ${o.bg_kind === "blur" ? `<i class="ob" style="background-image:url('${cover}');filter:blur(${Math.max(3, 56 * u)}px) brightness(.38)"></i>` : ""}
    ${o.fx ? `<i class="og"></i><i class="ogr" style="--s:${108 * u}px"></i><i class="on"></i><i class="ol" style="inset:${56 * u}px;border-radius:${48 * u}px"></i>` : ""}
    ${picSrc ? `<img class="op" src="${picSrc}" alt="" style="top:${g.pic_y * k}px;width:${g.ps * k}px;height:${g.ps * k}px;border-radius:${o.pic_round}%${o.fx ? `;filter:drop-shadow(0 ${18 * u}px ${22 * u}px rgba(6,4,12,.6))` : ""}">` : ""}
    ${o.title ? `<b style="top:${g.title_y * k}px;font-size:${52 * u}px;color:${ink}">${esc(o.title)}</b>` : ""}
    ${o.sub ? `<span class="${o.fx ? "pill" : ""}" style="top:${g.sub_y * k}px;font-size:${34 * u}px;color:${sub}${o.fx ? `;height:${64 * u}px;line-height:${64 * u}px;padding:0 ${28 * u}px;border-radius:${32 * u}px` : ""}">${esc(o.sub)}</span>` : ""}
    ${o.icons ? `<div class="oi" style="top:${g.icons_y * k}px;gap:${gap}px;width:${row}px">${OUTRO_ICONS.map(i => `<em style="width:${disc}px;height:${disc}px">${
      WM_ICONS[i][1].replace("<svg ", `<svg style="height:${40 * u}px;width:auto" `)}</em>`).join("")}</div>` : ""}</div>`;
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
  const tog = k => `<div class="ed-seg sm">${[["0", "Off"], ["1", "On"]].map(([v, l]) => `<button data-ed="outroset" data-k="${k}" data-v="${v}" aria-pressed="${(o[k] ? "1" : "0") === v}">${l}</button>`).join("")}</div>`;
  const picBtn = (v, inner, title) => `<button class="ed-med sm" data-ed="outroset" data-k="pic" data-v="${v}" aria-pressed="${o.pic === v}" title="${title}">${inner}</button>`;
  return `<div class="ed-card"><div class="ed-h"><b>Outro</b>${seg("on", [["0", "Off"], ["1", "On"]]).replace('class="ed-seg"', 'class="ed-seg sm"')}</div>
    ${o.on ? `${seg("kind", [["card", "Outro card"], ["file", "Your own file"]])}
      <div class="ed-outro-pv"><div class="ed-outro-ph" id="edOutroPv" style="aspect-ratio:${OUT_W}/${OUT_H}">${outroHtml(o, 0.16)}</div>
        <button class="ed-btn ghost sm" data-ed="outroplay">${ic("play")}Play outro</button></div>
      ${sl("secs", "Length", 1.5, 8, 0.5, o.secs + " s")}
      ${o.kind === "card" ? `
        <div class="ed-f">Canvas${seg("bg", [[OUTRO_BG.white, "White"], [OUTRO_BG.black, "Black"], [OUTRO_BG.gray, "Gray"]])}
          <label class="ed-f ed-colf" style="margin-top:6px">Your colour<span class="ed-swc" style="background:${o.bg}"><input type="color" data-outro="bg" value="${o.bg}" aria-label="Canvas colour"></span></label></div>
        <div class="ed-f">Background${seg("bg_kind", [["solid", "Canvas colour"], ["blur", "Blurred video"]])}</div>
        <div class="ed-f">Glow, grain and lines${tog("fx")}</div>
        <div class="ed-f">YouTube, TikTok and Instagram icons${tog("icons")}</div>
        <div class="ed-f">Picture<div class="ed-medgrid sm">${picBtn("", "None", "No picture")}${picBtn("socialshot", `<img src="/brand/logo-mark.png" alt="">`, "SocialShot")}${E.logoV ? picBtn("logo", `<img src="/api/brand/logo?v=${E.logoV}" alt="">`, "Your logo") : ""}
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
/* the score: one song under the clip, low under the voice, rising to its peak in the final seconds. A picture of
   the song (its real loudness, the stretch that plays), the volume line, and the three numbers that shape it. */
function musicPeaks(id) {
  E.musPeaks = E.musPeaks || {};
  if (E.musPeaks[id] !== undefined) return E.musPeaks[id];
  E.musPeaks[id] = null;
  fetch(`/api/music/${id}`).then(r => r.arrayBuffer()).then(b => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(b)).then(buf => {
    const ch = buf.getChannelData(0), per = Math.max(1, Math.floor(buf.sampleRate / 4)), out = [];   // a quarter of a second each
    for (let i = 0; i < ch.length; i += per) { let pk = 0; for (let j = i; j < Math.min(ch.length, i + per); j += 16) pk = Math.max(pk, Math.abs(ch[j])); out.push(pk); }
    E.musPeaks[id] = out;
    if (E.tab === "audio") drawPanel();
  }).catch(() => { E.musPeaks[id] = []; });
  return null;
}
function scoreCard(m, cur) {
  const o = outroOf(), len = (E.end - E.start) + (o.on ? o.secs : 0), riseOn = o.on || m.rise_on;
  const pk = musicPeaks(m.id), N = 72, bars = [];
  for (let i = 0; i < N; i++) {                    // the stretch of the song that plays under the clip (it loops if short)
    let v = 0.25;
    if (pk && pk.length) { const t = (m.at || 0) + len * (i + 0.5) / N, k = Math.floor((t % Math.max(0.25, cur.dur)) * 4); v = pk[Math.min(pk.length - 1, k)] || 0; }
    bars.push(v);
  }
  const top = Math.max(0.05, ...bars), rf = riseOn ? Math.min(1, m.rise / Math.max(0.1, len)) : 0;
  const yv = 100 - m.vol * 0.86, yp = 100 - m.peak * 0.86, x0 = (1 - rf) * 100;
  const line = riseOn && m.rise > 0 ? `M0 ${yv} L${x0} ${yv} L100 ${yp}` : `M0 ${yv} L100 ${yv}`;
  return `<div class="ed-score" id="edScore">
    <div class="ed-sch"><button class="ed-scplay" data-ed="scoreplay" aria-label="Play from the start">${ic("play")}</button>
      <div><b>${esc(cur.name)}</b><small>${ts(len)} · ${m.vol}% under the voice${riseOn && m.rise ? ` · peaks at ${m.peak}%` : ""}</small></div></div>
    <div class="ed-scg" aria-label="Drag the line to set the volume, the bend to set the rise, the end to set the peak">
      <div class="ed-scbars">${bars.map((v, i) => `<i class="${riseOn && i / N >= 1 - rf ? "r" : ""}" style="height:${Math.max(10, Math.sqrt(v / top) * 100).toFixed(0)}%"></i>`).join("")}</div>
      <svg class="ed-scline" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${line}"/></svg>
      <span class="ed-sctag v" style="top:min(calc(100% - 26px), calc(${yv}% + 4px))">Volume ${m.vol}%</span>
      <i class="ed-sch1 vol" style="left:calc(8px + (100% - 16px) * ${(riseOn && m.rise ? x0 : 100) / 2} / 100);top:calc(8px + (100% - 16px) * ${yv} / 100)" title="Drag up or down: the volume under the voice"></i>
      ${riseOn ? `<i class="ed-sch1 knee" style="left:calc(8px + (100% - 16px) * ${x0} / 100);top:calc(8px + (100% - 16px) * ${yv} / 100)" title="Drag left or right: when the rise starts"></i>
      <i class="ed-sch1 peak" style="left:calc(100% - 8px);top:calc(8px + (100% - 16px) * ${yp} / 100)" title="Drag up or down: the peak"></i>` : ""}
      ${riseOn && m.rise ? `<span class="ed-sctag p" style="top:max(6px, calc(${yp}% - 24px))">Peak ${m.peak}%</span>` : ""}
      <i class="ed-scph"></i></div>
    <label class="ed-ck ed-scsw"><input type="checkbox" data-mus="rise_on" ${riseOn ? "checked" : ""} ${o.on ? "disabled" : ""}><span>${o.on ? "Rises into the outro" : "Rise at the end"}<small>${o.on ? "The outro is on, so the music always peaks as it starts" : "Low under the voice, then up to its peak in the last seconds"}</small></span></label>
    ${slider("Volume", "mus_vol", 0, 100, 5, m.vol, m.vol + "%")}
    ${riseOn ? `${slider("Peak", "mus_peak", 0, 100, 5, m.peak, m.peak + "%")}${slider("Riser", "mus_rise", 0, 10, 0.5, m.rise, m.rise + " s")}` : ""}
  </div>`;
}
/* drag on the score: the flat line up and down is the volume, the bend left and right is how long the rise takes,
   the end point up and down is the peak. The picture follows as you drag; the sliders catch up when you let go. */
let scDrag = null;
dlg_on("pointerdown", e => {
  const g = e.target.closest(".ed-scg"); if (!g) return;
  e.preventDefault();
  const r = g.getBoundingClientRect(), box = {l: r.left + 8, t: r.top + 8, w: r.width - 16, h: r.height - 16};
  const m = musicOf(), o = outroOf(), len = (E.end - E.start) + (o.on ? o.secs : 0), riseOn = o.on || m.rise_on;
  const px = x => box.l + box.w * x / 100, py = y => box.t + box.h * y / 100;
  const yv = 100 - m.vol * 0.86, yp = 100 - m.peak * 0.86, x0 = (1 - Math.min(1, m.rise / Math.max(0.1, len))) * 100;
  const near = (x, y) => Math.hypot(e.clientX - x, e.clientY - y) < 16;
  const mode = riseOn && near(px(100), py(yp)) ? "peak" : riseOn && m.rise && near(px(x0), py(yv)) ? "knee"
    : riseOn && e.clientX > px(x0) + 6 ? "peak" : "vol";
  scDrag = {mode, box, len};
  g.setPointerCapture?.(e.pointerId); g.classList.add("drag", mode);
  scoreMove(e);
});
function scoreMove(e) {
  const d = scDrag; if (!d) return;
  const fx = Math.max(0, Math.min(1, (e.clientX - d.box.l) / d.box.w)), fy = Math.max(0, Math.min(1, (e.clientY - d.box.t) / d.box.h));
  const level = Math.round(Math.max(0, Math.min(100, (1 - fy) * 100 / 0.86)) / 5) * 5;
  const m = musicOf();
  if (d.mode === "vol") m.vol = level;
  else if (d.mode === "peak") m.peak = level;
  else { m.rise = Math.round(Math.max(0, Math.min(10, (1 - fx) * d.len)) * 2) / 2; }
  E.look.music = m; E.lookTouched = true;
  redrawScore();
}
dlg_on("pointermove", scoreMove);
dlg_on("pointerup", () => {
  if (!scDrag) return;
  scDrag = null; E.lookTouched = true; drawPanel(); after("");
});
// the score picture follows a slider without redrawing the whole panel (the slider keeps its drag)
function redrawScore() {
  const old = $e("#edScore"), m = musicOf(), cur = (E.music || []).find(t => t.id === m.id); if (!old || !cur) return;
  const tmp = document.createElement("div"); tmp.innerHTML = scoreCard(m, cur);
  const nw = tmp.firstElementChild;
  old.querySelector(".ed-sch")?.replaceWith(nw.querySelector(".ed-sch"));
  const g = old.querySelector(".ed-scg"), ng = nw.querySelector(".ed-scg");
  if (g && ng) g.innerHTML = ng.innerHTML;
}
/* ---------- sound effects from the built-in pack: placed at moments of the video (look.sfx: [{id, t, vol}]).
   render mixes them in at those moments; the preview plays each one as the playhead passes it. */
const SFX_IC = svg('<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2"/>');
const sfxOf = id => (E.sfxLib?.items || []).find(x => x.id === id);
const sfxUrl = id => `/api/pack/sfx/${id}`;
function sfxTry(id) {                  // hear a sound in the list
  try { E.sfxTry?.pause(); const a = new Audio(sfxUrl(id)); a.volume = 0.8; a.play().catch(() => {}); E.sfxTry = a; } catch {}
}
function sfxCard() {
  const lib = E.sfxLib; if (!lib) return `<div class="ed-card"><b>Sounds</b><p class="ed-help">Loading the sounds…</p></div>`;
  const grp = E.sfxGrp || lib.groups[0]?.key, L = E.look.sfx || [], sel = L[E.sfxSel];
  const id = name => lib.items.find(x => x.name === name)?.id;
  const zooms = E.look.zooms || [], pop = id("Zoom Pop"), whoosh = id("Whoosh Fast");
  const popped = zooms.length && zooms.every(z => L.some(x => x.id === pop && Math.abs(x.t - z.a) < 0.05));
  const hooked = L.some(x => x.id === whoosh && Math.abs(x.t - E.start) < 0.3);
  const sw = (k, on, label, sub, off) => `<label class="ed-ck ed-cksw"><span>${label}<small>${sub}</small></span>
      <span class="ed-sw2"><input type="checkbox" data-ed="${k}" ${on ? "checked" : ""} ${off ? "disabled" : ""}><span></span></span></label>`;
  return `${aiCard()}
    <div class="ed-card ed-sfxeasy"><b>Quick sounds</b>
      ${sw("sfxhook", hooked, "A whoosh as the clip starts", "Grabs attention in the first second")}
      ${sw("sfxzoom", popped, "A pop on every zoom", zooms.length ? `${zooms.length} zoom${zooms.length === 1 ? "" : "s"} in this clip` : "Add a zoom in Effects first", !zooms.length)}</div>
    ${L.length ? `<div class="ed-card ed-sfx"><div class="ed-h"><b>On this clip</b><small class="ed-pipnote">${L.length} sound${L.length === 1 ? "" : "s"} · drag them on the timeline</small></div>
      <div class="ed-sfxon">${L.map((x, i) => `<div class="ed-sfxrow ${i === E.sfxSel ? "on" : ""}">
        <button class="ed-sfxname" data-ed="sfxsel" data-v="${i}">${SFX_IC}<span>${esc(sfxOf(x.id)?.name || "Sound")}</span><small>${ts(x.t - E.start)}</small></button>
        <button class="ed-ib sm ed-tip" data-ed="sfxdel" data-v="${i}" aria-label="Remove this sound" data-tip="Remove">${ic("x")}</button></div>`).join("")}</div>
      ${sel ? slider("Loudness", "sfx_vol", 0, 200, 5, sel.vol ?? 100, (sel.vol ?? 100) + "%") : ""}</div>` : ""}
    <details class="ed-more" ${E.sfxMore ? "open" : ""} data-more="sfx"><summary>Add a sound yourself<small>32 sounds: whooshes, hits, pops</small></summary>
      <div class="ed-sfx">
      <div class="ed-seg ed-sfxg" role="tablist">${lib.groups.map(g => `<button role="tab" data-ed="sfxgrp" data-v="${g.key}" aria-selected="${grp === g.key}" aria-pressed="${grp === g.key}" title="${esc(g.label)}">${esc({transitions: "Whoosh", impacts: "Impact", ui: "Pops", comic: "Comic"}[g.key] || g.label)}</button>`).join("")}</div>
      <div class="ed-sfxlist">${lib.items.filter(x => x.group === grp).map(x => `<div class="ed-sfxi">
        <button class="ed-sfxp" data-ed="sfxtry" data-v="${x.id}" title="Listen">${ic("play")}</button><span>${esc(x.name)}<small>${x.dur.toFixed(1)} s</small></span>
        <button class="ed-btn sm ghost" data-ed="sfxadd" data-v="${x.id}" title="Add at the playhead">${ic("plus")}Add</button></div>`).join("")}</div>
      <p class="ed-help">Add puts the sound where the playhead is.</p></div></details>`;
}
function sfxLane() {
  const L = E.look.sfx || []; if (!L.length) return emptyRow("sfx", "audio", SFX_IC, "Add a sound effect").replace('data-t="audio"', 'data-t="audio" data-at="sfx"');
  return `<div class="ed-lane sfx">${L.map((x, i) => `<button class="ed-sfxbar ${i === E.sfxSel ? "on" : ""}" data-sb="${i}" data-ed="sfxsel" data-v="${i}"
    style="left:${pct(x.t)}%;width:${Math.max(0.5, pct(x.t + (sfxOf(x.id)?.dur || 0.6)) - pct(x.t))}%" title="${esc(sfxOf(x.id)?.name || "Sound")}">${SFX_IC}<span>${esc(sfxOf(x.id)?.name || "")}</span></button>`).join("")}</div>`;
}
// the preview: each sound plays once as the playhead passes its moment
function syncSfx(t, v) {
  const L = E.look.sfx || [], last = E.sfxT ?? t;
  E.sfxT = t;
  if (!L.length || v.paused || E.muted || t < last || t - last > 0.5) return;
  for (const x of L) if (x.t > last && x.t <= t) {
    try { const a = new Audio(sfxUrl(x.id)); a.volume = Math.min(1, (x.vol ?? 100) / 100 * 0.8); a.play().catch(() => {}); } catch {}
  }
}
let sfxDrag = null;
dlg_on("pointerdown", e => {
  const bar = e.target.closest(".ed-sfxbar"); if (!bar) return;
  const i = +bar.dataset.sb, x = (E.look.sfx || [])[i]; if (!x) return;
  const tr = $e("#edTrack").getBoundingClientRect();
  sfxDrag = {i, sx: e.clientX, t0: x.t, k: (E.max - E.min) / tr.width, moved: false, bar};
  bar.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = sfxDrag; if (!d) return;
  if (Math.abs(e.clientX - d.sx) > 3) d.moved = true; if (!d.moved) return;
  const x = E.look.sfx[d.i]; x.t = Math.round(Math.max(E.start, Math.min(E.end - 0.1, d.t0 + (e.clientX - d.sx) * d.k)) * 100) / 100;
  d.bar.style.left = pct(x.t) + "%";
});
dlg_on("pointerup", () => {
  const d = sfxDrag; sfxDrag = null; if (!d || !d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; E.look.sfx.sort((p, q) => p.t - q.t); E.sfxSel = -1;
  if (E.tab === "audio") drawPanel(); drawTimeline(); after("");
});
function riseCard(m, cur) {
  const o = outroOf(), total = (E.end - E.start) + (o.on ? o.secs : 0), at = m.peak_at != null && o.on ? Math.max(0, m.peak_at - Math.max(0, E.end - E.start - (m.off || 0))) : m.at;
  const loops = cur && cur.dur - at < total;
  return `${o.on ? `<label class="ed-ck"><input type="checkbox" data-ed="musdrop" ${m.peak_at != null ? "checked" : ""}><span>Drop lands on the outro<small>Pick the moment in the song that should hit as the outro starts</small></span></label>
      ${m.peak_at != null ? slider("Drop at", "mus_drop", 0, Math.max(1, Math.floor(cur.dur)), 0.5, m.peak_at, mmss(m.peak_at)) : ""}` : ""}
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
</div>`;
}
const hookCase = (t, how) => how === "upper" ? t.toUpperCase() : how === "lower" ? t.toLowerCase()
  : how === "title" ? t.split(" ").map(w => /^\p{L}/u.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(" ") : t;
/* ---------- safe zones: where each app's own buttons, names and captions sit on top of a short. Only shown in the
   preview, never in the video, so text and faces can be kept clear of them. */
// Each app's safe area on a 9:16 frame, in %: [name, top, right, bottom, left, right beside the buttons, where the buttons
// start]. The upper part runs almost to the right edge; from the buttons down, their column on the right is kept clear
// (Instagram's own Reels guide: 12% top, 15% bottom, the like/comment/share column the lower half's right 18%).
const SAFE_ZONES = {instagram: ["Instagram Reels", 12, 4, 15, 3.5, 18, 50], tiktok: ["TikTok", 8.5, 4, 20, 4, 15, 42],
  youtube: ["YouTube Shorts", 8, 4, 20, 4, 16, 45]};
const safePick = () => { try { const v = localStorage.getItem("ed_safe"); return SAFE_ZONES[v] ? v : "instagram"; } catch { return "instagram"; } };
// the AI editor's last step: the hook and the captions moved inside the safe area of the app chosen (Instagram by default),
// kept from covering each other, and lines too wide for their part of the safe area made to fit. Works for every layout.
function aiSafe() {
  const k = SAFE_ZONES[E.safe] ? E.safe : safePick(), [name, t, r, b, l, rr, rf] = SAFE_ZONES[k];
  const L = E.look, g = geo(E.layout, E.sw, E.sh), ph = $e("#edPhone"), P = ph && ph.getBoundingClientRect();
  const meas = (sel, fb) => { const el = $e(sel), q = el && !el.hidden && el.textContent.trim() ? el.getBoundingClientRect() : null;
    return q && q.height > 2 && P ? [q.width / P.width * 100, q.height / P.height * 100] : fb; };
  const [hw, hh] = meas("#edHookBox", [80, (L.hook_size || 88) * 1.6 / OUT_H * 100]);
  const [cw, ch] = meas("#edCap", [80, (L.size || 96) * 1.4 / OUT_H * 100]);
  const top = t + 1, bot = 100 - b - 1;
  const fit = (y, h) => Math.max(top + h / 2, Math.min(bot - h / 2, y));
  const moved = new Set(), r1 = v => Math.round(v * 10) / 10;
  let hy = L.hook !== false ? (L.hook_y ?? g.hook / OUT_H * 100) : null;
  if (hy != null) { const n = fit(hy, hh); if (Math.abs(n - hy) > 0.4) { L.hook_y = r1(n); hy = n; moved.add("hook"); } }
  const cy = L.y ?? g.cap / OUT_H * 100;
  let ny = fit(cy, ch);
  if (hy != null && Math.abs(ny - hy) < (hh + ch) / 2 + 1) {           // on top of the hook: just under it, or above if no room
    const under = hy + (hh + ch) / 2 + 2;
    ny = under + ch / 2 <= bot ? under : fit(hy - (hh + ch) / 2 - 2, ch);
  }
  if (Math.abs(ny - cy) > 0.4) { L.y = r1(ny); moved.add("captions"); }
  // how wide the safe area is at a height: narrower beside the app's buttons
  const span = (y, h) => { const right = y + h / 2 > rf ? 100 - rr : 100 - r; return [l, right]; };
  const fitW = (key, y, h, w, sizeKey, base, min, xKey) => {
    const [lo, hi] = span(y, h), room = hi - lo - 3, mid = r1((lo + hi) / 2);
    if (w > room) { L[sizeKey] = Math.max(min, Math.floor((L[sizeKey] || base) * room / w)); moved.add(key); }
    if (Math.min(w, room) > room * 0.7 && Math.abs((L[xKey] ?? 50) - mid) > 0.5) { L[xKey] = mid; moved.add(key); }
  };
  fitW("captions", L.y ?? cy, ch, cw, "size", 96, 48, "x");
  if (hy != null && L.hook_banner !== "full") fitW("hook", hy, hh, hw, "hook_size", 88, 50, "hook_x");
  return {name, moved: [...moved]};
}
// the safe zones drawn on the preview (only there, never in the video): the covered parts striped, the safe area outlined
function safeHtml() {
  const k = SAFE_ZONES[E.safe] ? E.safe : "instagram", [, t, r, b, l, rr, rf] = SAFE_ZONES[k];
  const path = `M${l} ${t}H${100 - r}V${rf}H${100 - rr}V${100 - b}H${l}Z`;
  return `<div class="ed-safe" id="edSafe" style="--st:${t}%;--sr:${r}%;--sb:${b}%;--sl:${l}%;--srr:${rr}%;--srf:${rf}%" aria-hidden="true">
    <i class="sz t"></i><i class="sz b"></i><i class="sz l"></i><i class="sz r"></i><i class="sz rr"></i>
    <svg class="ed-safeline" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${path}"/></svg><em class="ed-safetag">Safe area</em>
    <span class="ed-saferail"><i></i><i></i><i></i><i></i></span>
    <span class="ed-safecap"><b></b><i></i><i class="s"></i></span></div>`;
}
// the app picker sits above the video, not on it
function placeSafePick() {
  $e("#edSafePick")?.remove();
  const st = $e("#edStage"); if (!st || !E.safe || E.view !== "live") return;
  const k = SAFE_ZONES[E.safe] ? E.safe : "instagram";
  st.insertAdjacentHTML("beforeend", `<div class="ed-safepick" id="edSafePick" role="radiogroup" aria-label="Safe zones for">${Object.entries(SAFE_ZONES).map(([key, [name]]) =>
    `<button role="radio" data-ed="safeset" data-v="${key}" aria-checked="${key === k}">${name.split(" ")[0]}</button>`).join("")}</div>`);
}
/* ---------- AI edit at work: a team of small cursors, each in its own colour and each working in its own part of
   the editor (captions on the caption row and the captions on the video, music on the music row, the layout in the
   Layout panel...). A guide walks the side panel through Captions, Layout, Effects and Audio so the panel work shows.
   When the plan arrives the ones with a result drop it on their row and say what they did, then all of them leave. */
const AI_HANDS = [
  {l: "Captions", c: "#F472B6", zone: [".ed-lane.caps .ed-chip", "#edCap"], item: ".ed-lane.caps .ed-chip"},
  {l: "Caption style", c: "#FB7185", tab: "style", zone: ["#edCap", ".ed-lane.caps .ed-chip"]},
  {l: "Hook", c: "#FACC15", zone: ["#edHookBox", ".ed-lane.hook"], item: ".ed-lane.hook"},
  {l: "Music", c: "#22C55E", tab: "audio", zone: [".ed-lane.music"], item: ".ed-lane.music .ed-mbar"},
  {l: "Mix", c: "#34D399", zone: [".ed-meter", ".ed-lane.music"]},
  {l: "Sounds", c: "#38BDF8", zone: [".ed-lane.sfx"], item: ".ed-lane.sfx .ed-sfxbar"},
  {l: "Zooms", c: "#F59E0B", tab: "fx", zone: [".ed-lane.zooms"], item: ".ed-lane.zooms .ed-zbar"},
  {l: "Framing", c: "#60A5FA", zone: ["#edPhone", ".ed-bar > button"]},
  {l: "Layout", c: "#2DD4BF", tab: "layout", zone: [".ed-bar > button", "#edPhone"]},
  {l: "Colour", c: "#F97316", tab: "fx", zone: ["#edPhone"]},
  {l: "Cuts", c: "#A3E635", zone: [".ed-lane.film"], item: ".ed-lane.film"},
  {l: "Timing", c: "#E879F9", zone: [".ed-ruler", ".ed-lane.film"]},
  {l: "Transcript", c: "#93C5FD", zone: ["#edTxBody"], item: "#edTxBody"},
  {l: "Pacing", c: "#FDBA74", zone: [".ed-lane.caps", ".ed-ruler"]},
  {l: "Brand", c: "#CBD5E1", tab: "brand", zone: ["#edPhone"]},
  {l: "Review", c: "#FFFFFF", zone: ["#edPhone", "#edTxBody", ".ed-lane.film"]},
  {l: "Safe zones", c: "#F87171", zone: ["#edSafe .ed-safeline", "#edHookBox", "#edCap", "#edSafePick"], item: "#edSafe .ed-safetag"}];
const AI_TABS = ["style", "layout", "fx", "audio"];
const aiWait = ms => new Promise(r => setTimeout(r, ms));
function aiPoint(el, wide) {
  // a point inside the element, kept to the part of it on screen (timeline rows run past the view)
  let r = el.getBoundingClientRect();
  const sc = el.closest("#edScroll, #edPanel, #edTxBody");
  if (sc) { const v = sc.getBoundingClientRect(); r = {left: Math.max(r.left, v.left + 8), right: Math.min(r.right, v.right - 8), top: Math.max(r.top, v.top + 4), bottom: Math.min(r.bottom, v.bottom - 4)}; }
  if (r.right - r.left < 6 || r.bottom - r.top < 6 || r.bottom < 0 || r.top > innerHeight) return null;
  const f = wide ? Math.random() * .7 + .15 : .5;
  return {x: r.left + (r.right - r.left) * f, y: r.top + (r.bottom - r.top) * (wide ? .3 + Math.random() * .4 : .5), el};
}
// where a hand works now: the side panel while its section is open there, otherwise its own part of the editor
function aiSpot(h) {
  const pool = h.tab && toolOf(E.tab) === toolOf(h.tab) ? ["#edPanel .ed-card", "#edPanel button", "#edPanel .ed-card"] : h.zone;
  for (let n = 0; n < 6; n++) {
    const els = $$e(pool[Math.floor(Math.random() * pool.length)]);
    const el = els[Math.floor(Math.random() * els.length)], p = el && aiPoint(el, true);
    if (p) return p;
  }
  return null;
}
function aiHands() {
  const dlg = $("#clipdlg"), ph = $e("#edPhone");
  if (!dlg || !ph || matchMedia("(prefers-reduced-motion: reduce)").matches) return {deliver: async () => {}, stop() {}};
  const o = ph.getBoundingClientRect(), ctl = {done: false}, tab0 = E.tab;
  const mk = (h, i) => {
    const el = document.createElement("div");
    el.className = "ed-aih"; el.style.setProperty("--c", h.c);
    el.innerHTML = `<svg viewBox="0 0 20 22" aria-hidden="true"><path d="M3 2.2l14.2 7.6c.6.3.5 1.2-.2 1.4l-6 1.6-2.9 5.8c-.3.6-1.2.6-1.4-.1z"/></svg><b>${h.l}</b>`;
    const x = o.left + o.width * (.3 + Math.random() * .4), y = o.top + o.height * (.3 + Math.random() * .4);
    el.style.transform = `translate(${x}px,${y}px)`;
    dlg.append(el);
    return {...h, el, x, y, i};
  };
  const hands = AI_HANDS.map(mk);
  const guide = mk({l: "Editor", c: "#E4E4E7"}, 99);
  const move = async (h, x, y, ms) => {
    ms = ms || Math.max(320, Math.min(900, Math.hypot(x - h.x, y - h.y) * 1.1));
    h.el.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1), opacity .25s`;
    h.el.style.transform = `translate(${x}px,${y}px)`; h.x = x; h.y = y;
    await aiWait(ms);
  };
  const ring = h => {
    const r = document.createElement("i");
    r.className = "ed-aiping"; r.style.cssText = `--c:${h.c};left:${h.x}px;top:${h.y}px`;
    dlg.append(r); setTimeout(() => r.remove(), 650);
  };
  const press = (h, el) => {
    h.el.classList.add("press"); setTimeout(() => h.el.classList.remove("press"), 160); ring(h);
    if (el && !el.matches("#edPhone, .ed-lane, #edTxBody, .ed-ruler, .ed-meter, #edCap, #edHookBox")) {
      el.style.setProperty("--aic", h.c); el.classList.add("ed-aihl"); setTimeout(() => el.classList.remove("ed-aihl"), 520);
    }
  };
  const run = async h => {
    await aiWait(40 + h.i * 70); h.el.classList.add("in");
    while (!ctl.done) {
      const p = aiSpot(h);
      if (!p) { await aiWait(250); continue; }
      await move(h, p.x, p.y); if (ctl.done) break;
      await aiWait(80 + Math.random() * 220);
      if (p.el.closest(".ed-lane") && Math.random() < .35) {          // on a timeline row: press and drag a little, like trimming
        h.el.classList.add("press"); ring(h);
        await move(h, p.x + (Math.random() < .5 ? -1 : 1) * (24 + Math.random() * 40), p.y, 420);
        h.el.classList.remove("press");
      } else press(h, p.el);
      await aiWait(140 + Math.random() * 320);
    }
  };
  // the guide walks the side panel through the sections the others work in, one after another
  const walk = async () => {
    await aiWait(300); guide.el.classList.add("in");
    for (let k = 0; !ctl.done; k++) {
      const t = AI_TABS[k % AI_TABS.length], b = $e(`.ed-rail [data-t="${t}"]`);
      const p = b && aiPoint(b, false);
      if (p) { await move(guide, p.x, p.y, 520); if (ctl.done) break; press(guide, b); b.click(); }
      await aiWait(1500);
    }
  };
  const loops = [...hands.map(run), walk()];
  const all = [...hands, guide];
  const leave = () => {
    all.forEach(h => h.el.classList.remove("in"));
    setTimeout(() => all.forEach(h => h.el.remove()), 400);
    if (E.tab !== tab0) { const b = $e(`.ed-rail [data-t="${toolOf(tab0)}"]`); if (b) b.click(); else { E.tab = tab0; drawPanel(); } }
  };
  return {
    stop() { ctl.done = true; leave(); },
    // the result is in: each hand with something to show goes to it on its row and says what it did
    async deliver(said) {
      ctl.done = true; await Promise.race([Promise.all(loops), aiWait(1000)]);
      await Promise.all(all.map(async (h, i) => {
        await aiWait(i * 50);
        const el = h.item && $e(h.item), p = el && aiPoint(el, h.item === ".ed-lane.film" || h.item === "#edTxBody");
        if (p) { await move(h, p.x, p.y); press(h, el); }
        const t = said[h.l];
        if (t) { h.el.querySelector("b").textContent = t; h.el.classList.add("done"); }
        else if (!p) h.el.classList.remove("in");
      }));
      await aiWait(1300); leave();
    }};
}
/* ---------- AI edit, live: a log over the transcript side that says what the AI is doing as it does it, line by line,
   each with the colour of the part it works on (the same colours as the cursors and the timeline rows) */
const AI_TAGS = {read: ["Reading", "#93C5FD"], plan: ["Planning", "#E879F9"], music: ["Music", "#22C55E"], zoom: ["Zoom", "#F59E0B"],
  sound: ["Sound", "#38BDF8"], cut: ["Cut", "#A3E635"], safe: ["Safe zone", "#F87171"], done: ["Done", "#FFFFFF"]};
const aiLog = {
  el: null, t0: 0,
  open() {
    this.close(true);
    const box = $e("#edTxCard"), dlg = $("#clipdlg"); if (!box || !dlg) return;
    const r = box.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "ed-ailog"; el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    el.innerHTML = `<header><i class="jp-spin"></i><b>AI edit</b><span>working on this clip</span><button class="ed-ib sm" data-ed="ailogclose" aria-label="Close">${ic("x")}</button></header>
      <ol class="ed-ailines"></ol><div class="ed-aibar"><i></i></div>`;
    dlg.append(el); this.el = el; this.t0 = performance.now();
    requestAnimationFrame(() => el.classList.add("in"));
  },
  add(kind, text, pct) {
    if (!this.el) return;
    const [tag, c] = AI_TAGS[kind] || AI_TAGS.plan, t = (performance.now() - this.t0) / 1000;
    const li = document.createElement("li");
    li.style.setProperty("--c", c);
    li.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}</time><em>${tag}</em><span>${esc(text)}</span>`;
    const ol = this.el.querySelector(".ed-ailines"); ol.append(li); ol.scrollTop = ol.scrollHeight;
    if (pct != null) this.el.querySelector(".ed-aibar i").style.width = Math.min(100, pct) + "%";
  },
  done(text) {
    if (!this.el) return;
    this.add("done", text, 100);
    this.el.classList.add("finished");
    this.el.querySelector("header span").textContent = "finished";
    this.el.querySelector("header .jp-spin")?.replaceWith(Object.assign(document.createElement("i"), {className: "ed-aiok", innerHTML: ic("check")}));
    clearTimeout(this.tm); this.tm = setTimeout(() => this.close(), 7000);
  },
  close(now) {
    const el = this.el; this.el = null; clearTimeout(this.tm); if (!el) return;
    if (now) return el.remove();
    el.classList.remove("in"); setTimeout(() => el.remove(), 250);
  }};
// while the AI thinks: what it is looking at, a line every so often (real facts about this clip)
async function aiThinking(until) {
  const ws = inClip().map(([w]) => w), steps = [
    ["read", `Reading ${ws.length} words of the transcript`], ["read", `Listening to ${ts(keptLen())} of sound for loud moments`],
    ["plan", "Finding the punchline and the reactions"], ["plan", "Choosing a music bed for the mood"],
    ["plan", "Looking for the face, to aim the zooms"], ["plan", "Planning sound effects on the beats"], ["plan", "Checking the pacing"]];
  for (let i = 0; !until(); i++) {
    if (i < steps.length) aiLog.add(steps[i][0], steps[i][1], 8 + i * 6);
    await aiWait(i < steps.length ? 650 : 400);
  }
}
// the clean-up an editor does by hand: dead air off the start and the end, filler words and long pauses cut out
function aiTidy() {
  const ws = inClip().map(([w]) => w); if (ws.length < 3) return {cuts: 0, trimmed: 0};
  let trimmed = 0;
  if (!hasShots()) {
    // only true dead air, and at most 3 s each end: a quiet stretch in gameplay can be the best part
    const a = Math.min(ws[0].s - 0.15, E.start + 3), b = Math.max(ws[ws.length - 1].e + 0.4, E.end - 3);
    if (a - E.start > 0.6 && E.end - a >= 6) { trimmed += a - E.start; E.start = Math.round(a * 100) / 100; }
    if (E.end - b > 0.8 && b - E.start >= 6) { trimmed += E.end - b; E.end = Math.round(b * 100) / 100; }
  }
  const keep = E.cl; E.cl = {fill: true, pause: true, min: 0.8};
  const f = findCuts(); E.cl = keep;
  const next = mergeCuts([...(E.cuts || []).filter(([x, y]) => y > E.start && x < E.end), ...f.all]);
  const kept = E.end - E.start - next.reduce((n, [x, y]) => n + (y - x), 0);
  if (f.all.length && kept >= 6) E.cuts = next;
  return {cuts: f.all.length && kept >= 6 ? f.all.length : 0, trimmed};
}
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
  const c = clipNow(), pic = c && c.cover ? `/media/${E.jid}/${esc(c.cover)}?v=${c.version || 0}` : "", span = Math.max(0.1, E.end - E.start);
  const amt = v => ZOOM_AMT.reduce((b, q) => Math.abs(q[0] - v) < Math.abs(b[0] - v) ? q : b)[1];
  const row = (q, i) => {
    const f = ZOOM_FX.find(x => x[0] === q.fx) || ZOOM_FX[0], face = q.react && (E.media || []).find(m => m.id === q.react);
    return `<div class="ed-zrow ${i === E.zSel ? "on" : ""}">
      <button class="ed-zpick" data-ed="zoomsel" data-v="${i}" aria-pressed="${i === E.zSel}">
        <span class="ed-zthumb">${pic ? `<img src="${pic}" alt="" loading="lazy" style="filter:${f[2] || "none"};transform:scale(${Math.min(2.2, q.s)});transform-origin:${q.x}% ${q.y}%">` : ""}
          <em>${q.s.toFixed(1)}×</em>${face ? `<img class="ed-zrface" src="${mediaUrl(face.id)}" alt="">` : ""}</span>
        <span class="ed-zmeta"><b>${amt(q.s)} zoom${f[0] !== "none" ? ` · ${f[1]}` : ""}</b>
          <small>At ${mmss(q.a - E.start)} · ${(q.b - q.a).toFixed(1)} s${q.ease === false ? " · hard cut" : ""}</small>
          <i class="ed-zpos"><u style="left:${((q.a - E.start) / span * 100).toFixed(1)}%;width:${Math.max(2, (q.b - q.a) / span * 100).toFixed(1)}%"></u></i></span></button>
      <button class="ed-ib sm ed-tip ed-zdel" data-ed="zoomdel" data-v="${i}" aria-label="Remove this zoom" data-tip="Remove">${svg('<path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')}</button></div>`;
  };
  return `<div class="ed-card ed-zcard"><div class="ed-h"><b>Zoom moments <small class="ed-atn">${L.length}</small></b><button class="ed-btn ghost sm" data-ed="zoomadd">${ic("plus")}Add at playhead</button></div>
    <div class="ed-zlist">${L.map(row).join("")}</div>
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
    ${(E.media || []).some(m => m.pack) ? `<div class="ed-zsec"><div class="ed-zhd"><span>Reaction face</span><em>${esc((E.media || []).find(m => m.id === z.react)?.name || "None")}</em></div>
      <div class="ed-zfaces"><button class="ed-zface none" data-ed="facepick" data-v="" aria-pressed="${!z.react}" title="No face">${svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>')}</button>
        ${(E.media || []).filter(m => m.pack).map(f => `<button class="ed-zface" data-ed="facepick" data-v="${f.id}" aria-pressed="${z.react === f.id}" title="${esc(f.name)}"><img src="${mediaUrl(f.id)}" alt="${esc(f.name)}"></button>`).join("")}</div></div>` : ""}
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
function scenesLane() {
  const L = rawSplit().scenes || [];
  if (!L.length) return `<div class="ed-lane scenes znone" title="Click to add a scene at that moment"><span class="ed-zhint ed-schint" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%">${SCENE_IC}Click to add a scene: one person full screen for a stretch</span></div>`;
  return `<div class="ed-lane scenes" title="Click an empty spot to add a scene there">${L.map((s, i) => `<button class="ed-scbar ${i === E.scSel ? "on" : ""}" data-scb="${i}" data-ed="scenesel" data-v="${i}"
    style="left:${pct(s.a)}%;width:${Math.max(0.6, pct(s.b) - pct(s.a))}%"><i class="pe l"></i>${s.v === "all" ? `<span>Everyone${s.share ? ` · top ${s.share}%` : ""}</span>`
    : `<i class="ed-scdot" style="--c:${GRID_COLS[s.v]}"></i><span>${personName(s.v)}</span>`}<i class="pe r"></i></button>`).join("")}</div>`;
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
  if (ml) { e.stopPropagation(); E.tab = "audio"; E.atab = "music"; drawPanel(); if (phone()) { E.sheet = "panel"; syncSheet(); } return; }
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
const MUSIC_DEFAULT = {id: "", vol: 25, duck: true, loop: true, fade: true, at: 0, peak: 100, rise: 3, peak_at: null, off: 0, till: null, rise_on: false};
const musicOf = () => ({...MUSIC_DEFAULT, ...(E.look.music || {})});
// where the music plays, in source seconds: from `off` after the clip's start to `till` (null: the end, outro included)
function musSpan(m = musicOf()) {
  const o = outroOf(), total = (E.end - E.start) + (o.on ? o.secs : 0);
  const s = Math.min(m.off || 0, Math.max(0, total - 0.5)), e = m.till == null ? total : Math.max(s + 0.5, Math.min(total, m.till));
  return [E.start + s, Math.min(E.max, E.start + e)];
}
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function musicCard() {
  const m = musicOf(), list = E.music || [], cur = list.find(t => t.id === m.id), picking = !cur || E.musLib;
  const sw = (k, label, help) => `<label class="ed-ck"><input type="checkbox" data-mus="${k}" ${m[k] ? "checked" : ""}><span>${label}<small>${help}</small></span></label>`;
  const row = t => `<button role="radio" class="ed-mrow" data-ed="muspick" data-v="${t.id}" aria-checked="${m.id === t.id}">
      <i class="ed-mtry" data-ed="mustry" data-v="${t.id}" title="Listen">${ic(E.musTry === t.id ? "pause" : "play")}</i>
      <span>${esc(t.name)}<small>${esc(t.mood || "Your song")}</small></span><small>${mmss(t.dur)}</small>
      ${t.pack ? "" : `<i class="ed-x" data-ed="musdel" data-v="${t.id}" title="Remove from your library">${ic("x")}</i>`}</button>`;
  const lib = `<div class="ed-card ed-mlib"><div class="ed-h"><b>${cur ? "Change the song" : "Pick a song"}</b>${cur ? `<button class="ed-link" data-ed="muslib">Done</button>` : ""}</div>
      ${list.some(t => !t.pack) ? `<p class="ed-grp">Your songs</p><div class="ed-mlist" role="radiogroup" aria-label="Your songs">${list.filter(t => !t.pack).map(row).join("")}</div>` : ""}
      <p class="ed-grp">SocialShot library <small>Free to use, no copyright claims</small></p>
      <div class="ed-mlist ed-mpack" role="radiogroup" aria-label="SocialShot library">${list.filter(t => t.pack).map(row).join("")}</div>
      ${dropCard("edMusIn", "audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac", E.musBusy ? "Adding the song…" : "Upload your own", "MP3, M4A or WAV · kept for every clip", E.musBusy)}
      ${cur ? `<button class="ed-btn ghost sm ed-mnone" data-ed="muspick" data-v="">Remove the music</button>` : ""}</div>`;
  if (picking) return aiCard() + lib;
  const now = musFeel(m);
  return `<div class="ed-card ed-msong"><button class="ed-mtry big" data-ed="mustry" data-v="${cur.id}" title="Listen">${ic(E.musTry === cur.id ? "pause" : "play")}</button>
      <div><b>${esc(cur.name)}</b><small>${esc(cur.mood || "Your song")}</small></div><button class="ed-btn sm" data-ed="muslib">Change</button></div>
    <div class="ed-card ed-feel"><b>How should the music sit?</b>
      <div class="ed-feels" role="radiogroup" aria-label="How the music sits">${MUS_FEELS.map(([k, l, d, ic2]) => `<button role="radio" data-ed="musfeel" data-v="${k}" aria-checked="${now === k}">
        ${svg(ic2)}<span><b>${l}</b><small>${d}</small></span></button>`).join("")}</div></div>
    ${aiCard()}
    <details class="ed-more" ${E.musMore ? "open" : ""} data-more="mus"><summary>Fine-tune the music<small>volume curve, start point, loop</small></summary>
      ${scoreCard(m, cur)}
      <div class="ed-mset">${slider("Start the song at", "mus_at", 0, Math.max(1, Math.floor(cur.dur - 1)), 1, Math.min(m.at, cur.dur), mmss(Math.min(m.at, cur.dur)))}
        ${sw("duck", "Lower it while someone talks", "Words stay clear")}${sw("loop", "Loop it", "Plays again if the clip is longer")}${sw("fade", "Fade in and out", "Starts softly and ends smoothly")}
        ${riseCard(m, cur)}</div></details>`;
}
// three plain ways the music can sit under the voice; the numbers behind each are set for the person
const MUS_FEELS = [
  ["soft", "Soft background", "Quiet the whole time, lower while someone talks", '<path d="M3 15h18"/><path d="M3 15c3-1.5 6-1.5 9 0s6 1.5 9 0" opacity=".5"/>'],
  ["build", "Builds to the end", "Quiet under the voice, then rises for the finish", '<path d="M3 17h11l7-10"/>'],
  ["upfront", "Upfront", "Loud and clear, like a montage", '<path d="M3 8h18"/><path d="M3 8c3 2 6 2 9 0s6-2 9 0" opacity=".5"/>']];
const MUS_FEEL_SET = {soft: {vol: 10, duck: true, rise_on: false}, build: {vol: 14, duck: true, rise_on: true, peak: 60, rise: 3},
  upfront: {vol: 40, duck: false, rise_on: false}};
const musFeel = m => m.rise_on && m.vol <= 25 ? "build" : !m.rise_on && m.vol <= 18 ? "soft" : !m.rise_on && m.vol >= 30 ? "upfront" : "";
// the AI editor, offered where people choose sound
function aiCard() {
  return `<button class="ed-aicard" data-ed="aiedit" ${E.aiBusy ? "disabled" : ""}>
    <span class="ed-aiic">${svg('<path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 9l1.6-4.2a1 1 0 0 1 1.2-.6L20 7.6M9.5 5.4l-1.8 3.6M14.8 6.8L13 9"/>')}</span>
    <span><b>${E.aiBusy ? "The AI is editing…" : "Let the AI edit the whole clip"}</b><small>It picks the music, adds zooms and sound effects. You can change anything after.</small></span></button>`;
}
async function musicAdd(file) {
  if (!file) return;
  if (file.size > 25e6) return toast("That file is too big. Use one under 25 MB.", "bad");
  const fd = new FormData(); fd.append("file", file);
  E.musBusy = true; drawPanel();
  try {
    const r = await api("/api/music", {method: "POST", body: fd});
    E.music = [...r.tracks, ...(E.music || []).filter(t => t.pack)]; E.look.music = {...musicOf(), id: r.id, at: 0}; E.lookTouched = true;
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
  if ((ot.on || m.rise_on) && m.rise > 0) { const r0 = E.end - m.rise; if (t >= r0) g = (m.vol + (m.peak - m.vol) * Math.min(1, (t - r0) / m.rise)) / 100 * 0.7; }
  const sc = $e("#edScore"); if (sc) sc.style.setProperty("--ph", Math.max(0, Math.min(100, (t - E.start) / Math.max(0.1, E.end - E.start) * 100)) + "%");
  if (m.duck && E.words.some(w => t >= w.s - 0.05 && t < w.e + 0.2)) g *= 0.3;      // someone is talking: lower it
  if (m.fade) g *= Math.min(1, Math.max(0, rel / 0.6), Math.max(0, (Math.min(me, E.end + (ot.on ? ot.secs : 0)) - t) / (m.rise_on && !ot.on ? 0.3 : 1.5)));
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
const wmGeo = (s, st = "plain") => ({pad: st === "pill" || st === "glass" ? Math.round(s * 0.22) : 8, r: Math.round(s * 0.24),
  hs: Math.round(s * 0.36), ts: Math.round(s * 0.5), ic: Math.round(s * 0.6), gs: Math.round(s * 0.44), g: Math.round(s * 0.12)});
const WM_PRESETS = [["promo", "Episode promo"], ["tag", "Hashtag"], ["dual", "Dual"], ["handle", "Handle only"]];
const WM_STYLES = [["plain", "Plain"], ["outline", "Outline"], ["pill", "Dark pill"], ["glass", "Glass"]];   // the same as render.WM_STYLES
// the social watermark's inner HTML at scale k (frame pixels to screen pixels)
function wmHtml(L, k, logoV) {
  const st = L.brand_style || "plain", q = wmGeo(L.brand_size || 84, st), col = L.brand_color || "#FFFFFF", fam = fontCss(L.brand_font || "Inter", 700).family;
  const hs = Math.max(8, Math.round(q.hs * (L.brand_head_pct || 100) / 100)), al = L.brand_align || "left";
  const jc = {left: "flex-start", center: "center", right: "flex-end"}[al];
  const icon = L.brand_icon || "youtube", tag = L.brand_tag_on && (L.brand_tag || "").trim();
  const head = (L.brand_head || "").trim(), handle = (L.brand_handle || "").trim();
  const ic = icon === "none" ? "" : icon === "logo" ? (logoV ? `<img src="/api/brand/logo?v=${logoV}" alt="" style="height:${q.ic * k}px">` : "")
    : (WM_ICONS[icon] ? WM_ICONS[icon][1].replace("<svg ", `<svg style="height:${q.ic * k}px;width:auto;display:block" `) : "");
  if (!head && !handle && !tag && !ic) return "";
  const sh = st === "outline" ? `-webkit-text-stroke:${2 * Math.max(2, Math.round(q.ts / 12)) * k}px #000;paint-order:stroke fill`
    : st === "pill" ? "" : `text-shadow:0 ${2 * k}px ${6 * k}px rgba(0,0,0,.55)`;
  const box = st === "pill" ? `background:rgba(10,10,12,.65);border-radius:${q.r * k}px;`
    : st === "glass" ? `background:rgba(255,255,255,.18);box-shadow:inset 0 0 0 ${Math.max(1, 2 * k)}px rgba(255,255,255,.27);border-radius:${q.r * k}px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);` : "";
  return `<div class="wm" style="padding:${q.pad * k}px;color:${col};font-family:${fam};text-align:${al};${box}${sh}">
    ${head ? `<div style="font-weight:500;font-size:${hs * k}px;line-height:${hs * 1.25 * k}px">${esc(head)}</div>` : ""}
    ${handle || ic ? `<div style="display:flex;justify-content:${jc};align-items:center;gap:${handle && ic ? q.g * k : 0}px;height:${Math.max(q.ic, q.ts * 1.25) * k}px;margin-top:${head ? q.g / 2 * k : 0}px;font-weight:700;font-size:${q.ts * k}px">${ic}${handle ? `<span>${esc(handle)}</span>` : ""}</div>` : ""}
    ${tag ? `<div style="margin:${q.g * k}px 0;border-top:${2 * k}px dashed ${col}99"></div><div style="font-weight:700;font-size:${q.gs * k}px;line-height:${q.gs * 1.25 * k}px">${esc(tag)}</div>` : ""}</div>`;
}
// the Brand panel's social watermark: presets, a preview of exactly what goes on the video, and its parts
const slug = () => (cardName() || "yourchannel").toLowerCase().replace(/[^a-z0-9_]/g, "") || "yourchannel";
function wmPreset(k) {
  const L = E.look, h = slug();
  Object.assign(L, {brand_on: true, brand_kind: "social", brand_font: L.brand_font || "Inter", brand_color: L.brand_color || "#FFFFFF",
    brand_size: L.brand_size || 84, brand_pos: L.brand_pos || "tr"});
  if (k === "promo") Object.assign(L, {brand_head: "Full video on", brand_icon: "youtube", brand_handle: "/" + h, brand_tag_on: false});
  if (k === "tag") Object.assign(L, {brand_head: "", brand_icon: "none", brand_handle: "", brand_tag_on: true, brand_tag: "#" + h});
  if (k === "dual") Object.assign(L, {brand_head: "Full video on", brand_icon: "youtube", brand_handle: "/" + h, brand_tag_on: true, brand_tag: L.brand_tag || "#" + h});
  if (k === "handle") Object.assign(L, {brand_head: "", brand_icon: L.brand_icon && L.brand_icon !== "none" ? L.brand_icon : "youtube", brand_handle: "@" + h, brand_tag_on: false});
}
const wmPvHtml = L => L.brand_on && L.brand_kind === "social" ? (wmHtml(L, 0.5, E.logoV) || "<span>Add a header, handle or hashtag</span>") : "<span>Turned off</span>";
function wmCards(L) {
  const f = FONTS(), icon = L.brand_icon || "youtube";
  const ico = k => k === "none" ? "None" : k === "logo" ? (E.logoV ? `<img src="/api/brand/logo?v=${E.logoV}" alt="">` : "Logo") : WM_ICONS[k][1];
  const st = L.brand_style || "plain", al = L.brand_align || "left";
  const cover = `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`;
  const sample = {...L, brand_on: true, brand_kind: "social", brand_size: 64, brand_tag_on: false,
    brand_head: L.brand_head || "Full video on", brand_handle: L.brand_handle || "/" + slug(), brand_icon: icon};
  return `<div class="ed-card"><b>Style</b>
      <div class="ed-wmstyles">${WM_STYLES.map(([k, l]) => `<button data-ed="wmstyle" data-v="${k}" aria-pressed="${st === k}">
        <span class="ed-wmst-pv"><i style="background-image:url('${E.shot || cover}')"></i>${wmHtml({...sample, brand_style: k}, 0.42, E.logoV)}</span><b>${l}</b></button>`).join("")}</div>
      <div class="ed-wmpv" id="edWmPv" aria-label="What goes on the video">${wmPvHtml(L)}</div>
      <p class="ed-sub">Presets</p>
      <div class="ed-chips">${WM_PRESETS.map(([k, l]) => `<button data-ed="wmpreset" data-v="${k}">${l}</button>`).join("")}</div></div>
    <div class="ed-card"><b>Words</b>
      <label class="ed-f">Header<input class="ed-text" data-look="brand_head" value="${esc(L.brand_head || "")}" maxlength="40" placeholder="Full video on"></label>
      <div class="ed-f">Icon<div class="ed-wmicons">${["none", "logo", ...Object.keys(WM_ICONS)].map(k =>
        `<button data-ed="wmicon" data-v="${k}" aria-pressed="${icon === k}" title="${k === "none" ? "No icon" : k === "logo" ? "Your logo" : WM_ICONS[k][0]}">${ico(k)}</button>`).join("")}</div></div>
      <label class="ed-f">Handle<input class="ed-text" data-look="brand_handle" value="${esc(L.brand_handle || "")}" maxlength="40" placeholder="/${esc(slug())}"></label>
      <div class="ed-row">
        <label class="ed-f" style="flex:1">Font<select data-look="brand_font">${Object.keys(f).sort((a, b) => a.localeCompare(b)).map(k => `<option ${k === (L.brand_font || "Inter") ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="ed-f ed-colf" style="flex:none;width:72px">Colour<span class="ed-swc" style="background:${L.brand_color || "#FFFFFF"}"><input type="color" data-look="brand_color" value="${L.brand_color || "#FFFFFF"}" aria-label="Colour"></span></label></div>
      ${slider("Header size", "brand_head_pct", 50, 160, 5, L.brand_head_pct || 100, (L.brand_head_pct || 100) + "%")}
      <div class="ed-f">Align<div class="ed-seg">${[["left", "Left"], ["center", "Centre"], ["right", "Right"]].map(([v, l]) =>
        `<button data-ed="wmalign" data-v="${v}" aria-pressed="${al === v}">${l}</button>`).join("")}</div></div></div>
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
  card: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.6"/><circle cx="7.4" cy="7.6" r="1.4"/><path d="M10.2 7.6h6.3"/><rect x="6.3" y="11" width="11.4" height="6.6" rx="1.2" fill="currentColor" stroke="none"/>',
  pip: '<rect x="6" y="2.5" width="12" height="19" rx="2.6" fill="currentColor" fill-opacity=".22"/><rect x="11.2" y="13.6" width="5" height="5.6" rx="1.2" fill="currentColor" stroke="none"/>',
  trio: PH + '<path d="M6 8.8h12M6 15.2h12"/>'};
// picture in picture's settings: the box's shape, where it sits, its size, corners and edge
const PIP_COLS = ["#FFFFFF", "#0A0A0A", "#EA580C", "#FACC15", "#22C55E", "#3B82F6", "#EC4899"];
function pipCard(sp) {
  const shape = sp.pip_shape || "rounded", free = sp.pip_x != null, at = sp.pip_at || "br", col = sp.pip_color || "#FFFFFF";
  const SH = [["rounded", "Rounded", '<rect x="4" y="5" width="16" height="14" rx="4"/>'], ["circle", "Circle", '<circle cx="12" cy="12" r="8"/>'],
    ["square", "Square", '<rect x="4" y="5" width="16" height="14" rx=".5"/>']];
  const ARR = {tl: '<path d="M17 17L7 7M7 15V7h8"/>', tr: '<path d="M7 17L17 7M9 7h8v8"/>', bl: '<path d="M17 7L7 17M7 9v8h8"/>', br: '<path d="M7 7l10 10M17 9v8H9"/>'};
  return `<div class="ed-card ed-pipset"><div class="ed-h"><b>Face box</b><small class="ed-pipnote">Drag it on the video to move it, its corner to resize</small></div>
    <div class="ed-pipshapes" role="radiogroup" aria-label="Shape">${SH.map(([v, l, d]) => `<button role="radio" data-ed="pipshape" data-v="${v}" aria-checked="${shape === v}">${svg(d)}<span>${l}</span></button>`).join("")}</div>
    <div class="ed-piprow"><span class="ed-pipl">Snap to a corner</span>
      <div class="ed-pipcorn" role="group" aria-label="Corner">${["tl", "tr", "bl", "br"].map(v => `<button data-ed="pipat" data-v="${v}" aria-pressed="${!free && at === v}"
        aria-label="${{tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right"}[v]}" title="${{tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right"}[v]}">${svg(ARR[v])}</button>`).join("")}</div></div>
    ${slider("Size", "pip_size", 22, 50, 1, sp.pip_size || 36, (sp.pip_size || 36) + "%")}
    ${shape === "rounded" ? slider("Corners", "pip_radius", 0, 30, 1, sp.pip_radius ?? 10, sp.pip_radius ?? 10) : ""}
    ${slider("Border", "pip_border", 0, 16, 1, sp.pip_border ?? 6, (sp.pip_border ?? 6) ? sp.pip_border ?? 6 : "None")}
    ${(sp.pip_border ?? 6) ? `<div class="ed-piprow"><span class="ed-pipl">Border colour</span><div class="ed-pipcols">${PIP_COLS.map(c => `<button data-ed="pipcol" data-v="${c}" style="--c:${c}" aria-pressed="${col === c}" aria-label="${c}"></button>`).join("")}
      <label class="ed-pipcp" style="--c:${col}" title="Any colour"><input type="color" value="${col.toLowerCase()}" data-pipcol aria-label="Any border colour"></label></div></div>` : ""}
    <button class="ed-btn ed-pipframe" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Choose what fills the screen and the box</button></div>`;
}
/* the pop-out card's settings: its size, place, corners, edge (one colour or a gradient) and how far the head rises */
const POP_EDGES = [["Sunset", "#FF3EA5", "#FF8A1F"], ["Gold", "#FACC15", "#F97316"], ["Ocean", "#22D3EE", "#3B82F6"], ["Lime", "#A3E635", "#16A34A"],
  ["White", "#FFFFFF", ""], ["Black", "#0A0A0A", ""]];
const popMini = (sp, crop) => { const c1 = sp.pop_c1 || "#FFFFFF", c2 = sp.pop_edge === "gradient" ? sp.pop_c2 || c1 : c1, plain = sp.pop_bg === "plain";
  return `<i class="lp-bg" style="${crop(sp.game)};filter:none"></i><i class="lp-pop ${sp.pop_shape || "rounded"}" style="--c1:${c1};--c2:${c2}">` +
    `<i class="${plain ? "plain" : ""}" style="${crop(sp.cam)}${plain ? `;background-color:${sp.pop_fill || "#FFFFFF"}` : ""}"></i></i>`; };
const POP_SOLIDS = ["#FFFFFF", "#0A0A0A", "#EA580C", "#FACC15", "#22C55E", "#3B82F6", "#EC4899"];
const POP_FILLS = [["White", "#FFFFFF"], ["Paper", "#F4F1EA"], ["Grey", "#E4E4E7"], ["Sky", "#DBEAFE"], ["Blush", "#FCE7F3"], ["Black", "#0A0A0A"]];
const POP_SHAPES = [["circle", "Circle", '<circle cx="12" cy="13.5" r="7"/><circle cx="12" cy="7.2" r="2.6" fill="currentColor" stroke="none"/>'],
  ["rounded", "Rectangle", '<rect x="4" y="8" width="16" height="12" rx="3"/><circle cx="12" cy="7.6" r="2.6" fill="currentColor" stroke="none"/>'],
  ["square", "Square", '<rect x="5.5" y="7.5" width="13" height="13" rx="1.5"/><circle cx="12" cy="7.4" r="2.6" fill="currentColor" stroke="none"/>']];
function popCard(sp) {
  const shape = sp.pop_shape || "rounded", b = sp.pop_border ?? 8, out = sp.pop_out ?? 22, grad = sp.pop_edge === "gradient";
  const c1 = sp.pop_c1 || "#FFFFFF", c2 = sp.pop_c2 || "#FF8A1F", plain = sp.pop_bg === "plain", fill = sp.pop_fill || "#FFFFFF";
  const spot = sp.pop_x == null ? "c" : sp.pop_x === 50 && [40, 70].includes(sp.pop_y) ? String(sp.pop_y) : "";
  const seg = (k, opts, cur) => `<div class="ed-seg">${opts.map(([v, l]) => `<button data-ed="popset" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>`;
  const dot = (k, c, on, label = c) => `<button data-ed="popset" data-k="${k}" data-v="${c}" style="--c:${c}" aria-pressed="${on}" aria-label="${label}" title="${label}"></button>`;
  const pick = (k, c, label) => `<label class="ed-pipcp" style="--c:${c}" title="${label}"><input type="color" value="${c.toLowerCase()}" data-popc="${k}" aria-label="${label}"></label>`;
  return `<div class="ed-card ed-pipset ed-popset"><div class="ed-h"><b>Pop-out card</b><small class="ed-pipnote">Drag it on the video to move it, its corner to resize</small></div>
    <div class="ed-pipshapes" role="radiogroup" aria-label="Shape">${POP_SHAPES.map(([v, l, d]) => `<button role="radio" data-ed="popset" data-k="pop_shape" data-v="${v}" aria-checked="${shape === v}">${svg(d)}<span>${l}</span></button>`).join("")}</div>
    <div class="ed-piprow"><span class="ed-pipl">Face</span>${seg("pop_fit", [["face", "Centred"], ["box", "As placed"]], sp.pop_fit === "box" ? "box" : "face")}</div>
    <div class="ed-piprow"><span class="ed-pipl">Place</span><div class="ed-seg">${[["40", "Higher"], ["c", "Middle"], ["70", "Lower"]].map(([v, l]) =>
      `<button data-ed="popat" data-v="${v}" aria-pressed="${spot === v}">${l}</button>`).join("")}</div></div>
    ${slider("Size", "pop_size", 40, 90, 1, sp.pop_size || 70, (sp.pop_size || 70) + "%")}
    ${slider("Head line", "pop_out", 0, 45, 1, out, out ? out + "%" : "None")}
    <p class="ed-help">How much of the head rises over the card. Or drag the handle beside the card's top edge.</p>
    ${shape !== "circle" ? slider("Corners", "pop_radius", 0, 30, 1, sp.pop_radius ?? 8, sp.pop_radius ?? 8) : ""}</div>
  <div class="ed-card ed-pipset ed-popset"><div class="ed-h"><b>Card border</b></div>
    ${slider("Width", "pop_border", 0, 20, 1, b, b || "None")}
    ${b ? `${seg("pop_edge", [["solid", "Solid"], ["gradient", "Gradient"]], grad ? "gradient" : "solid")}
      ${grad ? `<div class="ed-piprow"><span class="ed-pipl">Presets</span><div class="ed-pipcols">${POP_EDGES.filter(e => e[2]).map(([l, a, z]) =>
        `<button data-ed="popset" data-k="grad" data-a="${a}" data-b="${z}" title="${l}" aria-label="${l}" aria-pressed="${c1 === a && c2 === z}" style="--c:linear-gradient(90deg,${a},${z})"></button>`).join("")}</div></div>
        <div class="ed-piprow"><span class="ed-pipl">From and to</span><div class="ed-pipcols ed-popft">${pick("pop_c1", c1, "Left colour")}<i aria-hidden="true" style="--c1:${c1};--c2:${c2}"></i>${pick("pop_c2", c2, "Right colour")}</div></div>`
      : `<div class="ed-piprow"><span class="ed-pipl">Colour</span><div class="ed-pipcols">${POP_SOLIDS.map(c => dot("pop_c1", c, c1 === c)).join("")}${pick("pop_c1", c1, "Any colour")}</div></div>`}` : ""}</div>
  <div class="ed-card ed-pipset ed-popset"><div class="ed-h"><b>Behind the person</b><small class="ed-pipnote">${plain ? "Only the streamer shows, on a plain colour" : "The face cam as it is, room and all"}</small></div>
    ${seg("pop_bg", [["cam", "Face cam"], ["plain", "Plain"]], plain ? "plain" : "cam")}
    ${plain ? `<div class="ed-piprow"><span class="ed-pipl">Colour</span><div class="ed-pipcols">${POP_FILLS.map(([l, c]) => dot("pop_fill", c, fill === c, l)).join("")}${pick("pop_fill", fill, "Any colour")}</div></div>` : ""}
    <p class="ed-help">The preview shows the real cut-out a few seconds after a change, the same one the finished clip uses. Leave room above the head in the face cam box.</p>
    <button class="ed-btn ed-pipframe" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Choose the stream and the face cam</button></div>`;
}
/* the Post card's settings, in groups: the style (big tiles, like picking a template), the account on it, the post's
   words, what is behind the card, and its size and place */
const SUN_IC = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON_IC = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
function cardPanel(cd) {
  const OWN = {linkedin: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5v6M8 7.6v.01M11.5 16.5v-6M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1.9 2.1 2.5v3.6"/>'),
    threads: svg('<path d="M16.2 11.3c-.5-2.4-2.2-3.6-4.4-3.6-2.6 0-4.3 1.9-4.3 4.6 0 2.9 1.8 4.7 4.6 4.7 2.4 0 4-1.4 4-3.3 0-1.7-1.3-2.7-3.4-2.7-1.8 0-3 .8-3 2.1 0 1.1 1 1.9 2.4 1.9 2.4 0 3.6-1.9 3.6-4.7"/><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/>')};
  const mark = k => OWN[k] || (typeof APP_MARK !== "undefined" && APP_MARK[k]) || "";
  const dark = t => /^#(0|1)/i.test(t.bg);
  const sw = (k, on, label, sub) => `<label class="ed-ck ed-cksw"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="ed-sw2"><input type="checkbox" data-ed="cardsw" data-k="${k}" ${on ? "checked" : ""}><span></span></span></label>`;
  const nTpl = (typeof TPLS !== "undefined" ? TPLS.length : 0);
  return `<div class="ed-card ed-cstyle"><div class="ed-h"><b>Card style</b><small class="ed-pipnote">The clip inside a real-looking post</small></div>
      <div class="ed-cgrid" role="radiogroup" aria-label="Card style">${Object.entries(CARD_THEMES).map(([v, t]) => `<button role="radio" data-ed="cardset" data-k="theme" data-v="${v}" aria-checked="${cd.theme === v}">
        <span class="ed-cgic">${mark(t.kind) || svg(dark(t) ? MOON_IC : SUN_IC)}</span><span>${esc(t.label)}</span><i class="ed-cgtone">${svg(dark(t) ? MOON_IC : SUN_IC)}</i></button>`).join("")}
        <button class="ed-cgmore ${Object.keys(CARD_THEMES).length % 2 ? "half" : ""}" data-ed="tpl">${svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')}<span>+${Math.max(0, nTpl - 5)} more templates</span></button></div></div>
    <div class="ed-card ed-cgroup"><b>Account</b>
      <div class="ed-cacc"><span class="ed-cav">${cd.avatar !== "initial" && E.logoV ? `<img src="/api/brand/logo?v=${E.logoV}" alt="">` : `<b>${esc(((cd.name || cardName() || "S")[0] || "S").toUpperCase())}</b>`}</span>
        <div class="ed-cfields"><input class="ed-text" data-card="name" value="${esc(cd.name)}" maxlength="40" placeholder="${esc(cardName() || "Your name")}" aria-label="Name">
          <input class="ed-text" data-card="handle" value="${esc(cd.handle)}" maxlength="30" placeholder="${(CARD_THEMES[cd.theme] || {}).kind === "linkedin" ? "Your headline" : "@" + esc((cardName() || "yourname").toLowerCase().replace(/[^a-z0-9_]/g, ""))}" aria-label="${(CARD_THEMES[cd.theme] || {}).kind === "linkedin" ? "Headline" : "Handle"}"></div></div>
      <div class="ed-seg"><button data-ed="cardset" data-k="avatar" data-v="logo" aria-pressed="${cd.avatar !== "initial" && !!E.logoV}" ${E.logoV ? "" : 'disabled title="Upload a logo in Brand first"'}>My logo</button>
        <button data-ed="cardset" data-k="avatar" data-v="initial" aria-pressed="${cd.avatar === "initial" || !E.logoV}">First letter</button></div>
      ${sw("verified", cd.verified, "Blue check", "Shown next to the name")}</div>
    <div class="ed-card ed-cgroup"><b>Post text</b>
      <textarea class="ed-text" data-card="text" maxlength="220" rows="3" placeholder="${esc(E.hook || "What the post says")}" aria-label="Post text">${esc(cd.text)}</textarea>
      <p class="ed-help">Left empty, the post says the clip's hook.</p></div>
    <div class="ed-card ed-cgroup"><b>Behind the card</b>
      <div class="ed-seg">${[["none", "Plain"], ["gradient", "Gradient"], ["blur", "Blurred video"]].map(([v, l]) =>
        `<button data-ed="cardset" data-k="back" data-v="${v}" aria-pressed="${cd.back === v}">${l}</button>`).join("")}</div>
      ${cd.back === "gradient" ? `<div class="ed-gradsw">${CARD_BACKS.map(([l, a, b]) => `<button data-ed="cardgrad" data-a="${a}" data-b="${b}" title="${l}" aria-pressed="${cd.g1 === a && cd.g2 === b}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join("")}</div>
        <div class="ed-row"><label class="ed-f ed-colf">From<span class="ed-swc" style="background:${cd.g1}"><input type="color" data-card="g1" value="${cd.g1}" aria-label="Gradient from"></span></label>
          <label class="ed-f ed-colf">To<span class="ed-swc" style="background:${cd.g2}"><input type="color" data-card="g2" value="${cd.g2}" aria-label="Gradient to"></span></label></div>
        <label class="ed-ck"><input type="checkbox" data-ed="cardgrain" ${cd.grain ? "checked" : ""}><span>Film grain<small>A fine texture so the colour doesn't look flat</small></span></label>` : ""}
      ${cd.back === "none" ? `<p class="ed-help">The card fills the whole frame, like a screenshot of the post.</p>` : ""}</div>
    <div class="ed-card ed-cgroup"><div class="ed-h"><b>Size and place</b>${cd.dx || cd.dy ? `<button class="ed-link" data-ed="cardcentre">Centre it</button>` : ""}</div>
      <label class="ed-sl" style="--p:${pctOf(cd.scale, 50, 130)}"><input type="range" min="50" max="130" step="1" value="${cd.scale}" data-card="scale" aria-label="Card size"><span class="ed-sl-l">Card size</span><output>${cd.scale}</output></label>
      ${cd.back !== "none" ? `<label class="ed-sl" style="--p:${pctOf(cd.pad, 16, 90)}"><input type="range" min="16" max="90" step="2" value="${cd.pad}" data-card="pad" aria-label="Room inside the card"><span class="ed-sl-l">Room inside</span><output>${cd.pad}</output></label>` : ""}
      <label class="ed-sl" style="--p:${pctOf(cd.radius, 0, 60)}"><input type="range" min="0" max="60" step="2" value="${cd.radius}" data-card="radius" aria-label="Video corners"><span class="ed-sl-l">Video corners</span><output>${cd.radius}</output></label>
      <p class="ed-help">Or drag the card on the video, and its corner to resize it.</p></div>`;
}
// the Frame view's layout grid: Duo is the split with a person in each half
const FRAME_LAYS = [["crop", "Solo"], ["split", "Split"], ["pip", "PiP"], ["pop", "Pop-out"], ["trio", "Trio"], ["grid", "Grid"], ["split", "Duo", "duo"], ["blur", "Centered"], ["zoom", "Zoomed"], ["card", "Post card"]];
LAY_IC.pop = '<rect x="6" y="2.5" width="12" height="19" rx="2.6" fill="currentColor" fill-opacity=".22"/><rect x="8" y="11" width="8" height="7.5" rx="1.6"/><circle cx="12" cy="10" r="2.2" fill="currentColor" stroke="none"/><path d="M8.8 18.5c.5-2.4 1.7-3.4 3.2-3.4s2.7 1 3.2 3.4" fill="currentColor" stroke="none"/>';
LAY_IC.duo = PH + '<path d="M6 12h12"/><circle cx="12" cy="7" r="1.5"/><circle cx="12" cy="16.8" r="1.5"/>';
LAY_IC.grid = PH + '<path d="M6 11h12M12 11v10.5"/><circle cx="12" cy="6.8" r="1.3"/><circle cx="9" cy="16" r="1.2"/><circle cx="15" cy="16" r="1.2"/>';
const LAY_TIP = {crop: "One part of the video fills the screen", split: "Two parts stacked: the stream, the face cam", pip: "One part fills the screen, the face cam in a small box",
  pop: "The face cam in a card, the streamer's head rising over its top",
  trio: "Three parts stacked: three people", grid: "Two to four people, each in a cell of their own", duo: "Two people: the left half on top, the right half below", blur: "The whole video on a blurred copy",
  zoom: "Closer in, blurred above and below", card: "The clip inside a social post"};
/* ---------- templates: a layout, a shape and a caption look chosen together in one click. The clip's own words,
   trim and brand stay; caption and hook positions go back to automatic for the new layout. */
const POST_CAPS = {font: "Inter", size: 64, outline: 0, per: 3, upper: false, active: CARD_BLUE, weight: 600};
const TPLS = [
  // news: a strong banner that reads like a broadcast
  {k: "breaking", tag: "Breaking news", cat: "news", name: "Breaking news", sub: "A red BREAKING-style bar on top, boxed captions", layout: "zoom", style: "boxed",
    hook: {hook_font: "Bebas Neue", hook_size: 104, hook_box: "#DC2626", hook_ink: "#FFFFFF", hook_op: 100, hook_round: 0, hook_y: 13, hook_dur: 0, hook_banner: "full", hook_case: "upper"},
    extra: {y: 74, bg: {kind: "color", c1: "#0A0A0C"}, stroke: 6, stroke_color: "#DC2626"}},
  {k: "headline", tag: "Top story", cat: "news", name: "Headline story", sub: "A white headline card over the video, calm captions", layout: "blur", style: "editorial",
    hook: {hook_font: "DM Serif Display", hook_size: 84, hook_box: "#FFFFFF", hook_ink: "#111111", hook_op: 100, hook_round: 6, hook_y: 16, hook_dur: 0},
    extra: {effect: "lut_mono_documentary"}},
  {k: "explainer", tag: "Here's why", cat: "news", name: "Explainer", sub: "Numbers and facts, a clean caption box", layout: "zoom", style: "pill",
    hook: {hook_font: "Inter Tight", hook_size: 80, hook_box: "#0F172A", hook_ink: "#F8FAFC", hook_op: 92, hook_round: 14, hook_y: 14, hook_dur: 5},
    extra: {effect: "lut_cinematic_teal_orange", bg: {kind: "gradient", c1: "#0B1220", c2: "#1E293B"}}},
  // real estate: warm, clean, premium
  {k: "justlisted", tag: "Just listed", cat: "realestate", name: "Just listed", sub: "A gold JUST LISTED bar, warm film look", layout: "crop", style: "minimal",
    hook: {hook_font: "Marcellus", hook_size: 90, hook_box: "#B8892B", hook_ink: "#FFFFFF", hook_op: 100, hook_round: 0, hook_y: 12, hook_dur: 0, hook_banner: "full", hook_case: "upper"},
    extra: {effect: "lut_warm_film", stroke: 8, stroke_color: "#B8892B"}},
  {k: "hometour", tag: "Home tour", cat: "realestate", name: "Home tour", sub: "Elegant serif title, soft captions, frame edge", layout: "crop", style: "soft",
    hook: {hook_font: "Playfair Display", hook_size: 92, hook_box: "#FFFFFF", hook_ink: "#1C1917", hook_op: 94, hook_round: 18, hook_y: 14, hook_dur: 4},
    extra: {effect: "bright", stroke: 10, stroke_color: "#FFFFFF"}},
  {k: "market", tag: "Market update", cat: "realestate", name: "Market update", sub: "Agent talking, navy title, the video in a card", layout: "blur", style: "clean",
    hook: {hook_font: "Montserrat", hook_size: 82, hook_box: "#1E3A8A", hook_ink: "#FFFFFF", hook_op: 100, hook_round: 12, hook_y: 15, hook_dur: 0},
    extra: {bg: {kind: "gradient", c1: "#0F172A", c2: "#1E3A8A"}, pad: 40, vradius: 28}},
  // creators
  {k: "motivation", tag: "Keep going", cat: "creators", name: "Motivation", sub: "Black and white, big bold words", layout: "crop", style: "poster",
    hook: {hook_font: "Anton", hook_size: 110, hook_box: "#000000", hook_ink: "#FFFFFF", hook_op: 0, hook_round: 0, hook_y: 16, hook_dur: 0, hook_case: "upper"},
    extra: {effect: "lut_mono_documentary"}},
  {k: "tutorial", tag: "Step 1", cat: "creators", name: "How-to", sub: "Clear steps: a tidy title, boxed captions", layout: "zoom", style: "boxed",
    hook: {hook_font: "Lexend", hook_size: 80, hook_box: "#FACC15", hook_ink: "#111111", hook_op: 100, hook_round: 14, hook_y: 14, hook_dur: 5}},
  {k: "story", tag: "So this happened", cat: "creators", name: "Storytime", sub: "Moody colour, captions low, face cam corner", layout: "pip", style: "headline",
    hook: {hook_font: "Bricolage Grotesque", hook_size: 86, hook_box: "#FFFFFF", hook_ink: "#111111", hook_op: 100, hook_round: 20, hook_y: 13, hook_dur: 3},
    extra: {effect: "lut_moody_dark"}},
  // gaming
  {k: "gameclutch", tag: "1v4 clutch", cat: "gaming", name: "Clutch highlight", sub: "Punchy colour, loud captions, face cam split", layout: "split", cam_at: "bottom", style: "hype",
    hook: {hook_font: "Bungee", hook_size: 84, hook_box: "#111111", hook_ink: "#FACC15", hook_op: 90, hook_round: 10, hook_y: 46, hook_dur: 3},
    extra: {effect: "lut_punchy_viral"}},
  {k: "stream", cat: "streams", name: "Stream + face cam", sub: "Gameplay on top, the face cam under it", layout: "split", cam_at: "bottom", style: "boldpop"},
  {k: "camtop", cat: "streams", name: "Face cam on top", sub: "The streamer first, the game below", layout: "split", cam_at: "top", style: "studio"},
  {k: "solo", cat: "streams", name: "Solo full screen", sub: "One part of the stream fills the phone", layout: "crop", style: "hype"},
  {k: "pipcam", cat: "streams", name: "Face cam corner", sub: "The game full screen, the streamer in a small box", layout: "pip", style: "boldpop"},
  {k: "popcam", cat: "streams", name: "Pop-out face cam", sub: "The streamer cut out, their head rising over a card", layout: "pop", style: "boldpop"},
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
  {k: "trio", cat: "podcasts", name: "Three people", sub: "Each person in a band of their own", layout: "trio", style: "podcast"},
  {k: "grid", cat: "podcasts", name: "Face grid", sub: "Up to four people, each in a cell, scenes for who is talking", layout: "grid", style: "podcast"},
  {k: "pipguest", cat: "podcasts", name: "Guest corner", sub: "The host full screen, the guest in a small box", layout: "pip", style: "podcast",
    split: {game: [0, 0, 0.5, 1], cam: [0.5, 0, 0.5, 1], pip_at: "br"}},
  {k: "centered", cat: "simple", name: "Centered", sub: "The whole video on a blurred copy", layout: "blur", style: "clean"},
  {k: "wide", cat: "simple", name: "Wide 16:9", sub: "For YouTube and desktop", layout: "crop", aspect: "16:9", style: "studio"}];
const TPL_CATS = [["all", "All"], ["news", "News"], ["realestate", "Real estate"], ["creators", "Creators"], ["gaming", "Gaming"], ["streams", "Streams"],
  ["posts", "Social posts"], ["podcasts", "Podcasts"], ["simple", "Simple"]];
// a small post card for the layout and template tiles
// a still of this clip for the small tiles: the clean frame once grabbed, else the saved clip's cover (a live
// recording has no thumbnail of its own), else the video's thumbnail
const stillOf = () => E.shot || (clipNow()?.cover ? `/media/${E.jid}/${clipNow().cover}?v=${clipNow().version || 0}` : `/media/${E.jid}/thumb.jpg`);
const miniCard = (bg, theme) => `<i class="lp-card ${theme === "dark" ? "dark" : ""}"><i class="lp-cav"></i><i class="lp-cln"></i><i class="lp-cln s"></i><i class="lp-cv" style="${bg}"></i><i class="lp-ccap"></i></i>`;
function miniTpl(t) {
  const bg = `background-image:url('${stillOf()}')`, sp = rawSplit();
  const crop = r => `${bg};background-size:${(100 / r[2]).toFixed(1)}% ${(100 / r[3]).toFixed(1)}%;background-position:${(r[2] < 1 ? r[0] / (1 - r[2]) * 100 : 50).toFixed(1)}% ${(r[3] < 1 ? r[1] / (1 - r[3]) * 100 : 50).toFixed(1)}%`;
  const ts = {...sp, ...(t.split || {})};
  const inner = t.layout === "split" ? `<i class="lp-part" style="${crop(sp.game)}"></i><i class="lp-part" style="${crop(sp.cam)}"></i>`
    : t.layout === "pip" ? `<i class="lp-bg" style="${crop(ts.game)};filter:none"></i><i class="lp-pip ${ts.pip_at || "br"}" style="${crop(ts.cam)}"></i>`
    : t.layout === "trio" ? ts.trio.map(r => `<i class="lp-part t" style="${crop(r)}"></i>`).join("")
    : t.layout === "grid" ? gridMini(ts, crop)
    : t.layout === "pop" ? popMini(ts, crop)
    : t.layout === "card" ? miniCard(bg, t.theme) : `<i class="lp-bg" style="${bg}"></i><i class="lp-fg ${t.layout}" style="${bg}"></i>`;
  const [w, h] = ASPECTS[t.aspect || "9:16"], x = t.extra || {}, k = t.hook;
  // the template's own look on the preview: its colour, its border and its hook banner with sample words
  const fx = x.effect ? fxCss(x.effect) : "";
  const hk = k ? (() => {
    const box = k.hook_op > 0 ? `background:${k.hook_box};opacity:1;` : "text-shadow:0 1px 3px rgba(0,0,0,.8);";
    const wide = k.hook_banner === "full", up = k.hook_case === "upper";
    return `<b class="lp-hook${wide ? " full" : ""}" style="top:${k.hook_y}%;${box}color:${k.hook_ink};font-family:'${k.hook_font}',Inter,sans-serif;` +
      `font-size:${(k.hook_size * 0.064).toFixed(1)}px;border-radius:${wide ? 0 : Math.min(6, k.hook_round / 4)}px">${esc(up ? (t.tag || "Your hook").toUpperCase() : t.tag || "Your hook")}</b>`;
  })() : "";
  const ring = x.stroke ? `<i class="lp-ring" style="box-shadow:inset 0 0 0 ${Math.max(1.5, x.stroke / 4)}px ${x.stroke_color || "#fff"}"></i>` : "";
  return `<span class="lp-ph ${t.layout === "pop" ? "popout" : t.layout} ${t.cam_at === "top" ? "camtop" : ""}" style="aspect-ratio:${w}/${h}${fx ? `;filter:${fx}` : ""}">${inner}${ring}${hk}</span>`;
}
function drawTpl() {
  if (!E.tplOpen) return $e("#edTpl")?.remove();
  const cat = E.tplCat || "all", list = TPLS.filter(t => cat === "all" || t.cat === cat);
  const inner = `<header><div><h3>Templates</h3><p>A layout, shape and caption look in one click. Your words, trim and brand stay.</p></div>
      <button class="ed-ib" data-ed="tplclose" aria-label="Close">${ic("x")}</button></header>
    <div class="ed-tpl-cats" role="tablist">${TPL_CATS.map(([k, l]) => `<button role="tab" data-ed="tplcat" data-v="${k}" aria-selected="${cat === k}">${l}</button>`).join("")}</div>
    <div class="ed-tpl-grid">${list.map(t => `<button class="ed-tpl" data-ed="tplpick" data-v="${t.k}" aria-pressed="${E.tplOn === t.k}">
      <span class="ed-tpl-pv">${miniTpl(t)}</span><span class="ed-tpl-t"><b>${esc(t.name)}</b><small>${esc(t.sub)}</small>
        <em>${esc((TPL_CATS.find(c => c[0] === t.cat) || [])[1] || "")}${t.aspect && t.aspect !== "9:16" ? " · " + t.aspect : ""}</em></span>
      ${E.tplOn === t.k ? `<i class="ed-tpl-on">${ic("check")}</i>` : ""}</button>`).join("")}</div>`;
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
  if (isParts(t.layout)) E.look.split = {...rawSplit(), ...(t.split ? clone(t.split) : {}), cam_at: t.cam_at || "bottom"};
  if (t.layout === "card") E.look.card = {...cardOf(), theme: t.theme};
  E.layout = t.layout; E.tplOn = k; E.lookTouched = true; E.tplOpen = false;
  setFrame(); drawTpl(); E.tab = "layout"; drawPanel(); drawStage();
  if (t.layout === "split" || (t.layout === "pip" || t.layout === "pop") && !t.split) findFacecam();
  after("pt"); toast(`${t.name} applied`, "ok");
}
/* ---------- the split layout in the preview: two bands, each showing one part of the same video.
   Each band crops its part and fills its band exactly like render._filter: crop the part, cover the band, centre. */
function placeSplit() {
  if (!isParts(E.layout) || E.view !== "live") return;
  const ph = $e("#edPhone"); if (!ph || !E.sw || !E.sh) return;
  const W = ph.clientWidth, H = ph.clientHeight, sp = splitOf(), k = W / OUT_W;
  const fit = (b, v, r, bw, bh) => {             // the part covers its band and is centred, like render._filter
    const rw = r[2] * E.sw, rh = r[3] * E.sh, s = Math.max(bw / rw, bh / rh);
    v.style.cssText = `width:${E.sw * s}px;height:${E.sh * s}px;left:${-r[0] * E.sw * s - (rw * s - bw) / 2}px;top:${-r[1] * E.sh * s - (rh * s - bh) / 2}px`;
  };
  if (E.layout === "pip") {
    const G = $e("#edBandG"), C = $e("#edBandC"), q = pipGeo(sp);
    if (G) { G.style.height = H + "px"; fit(G, $e("#edVid"), sp.game, W, H); }
    if (C) {
      C.style.cssText = `left:${q.x * k}px;top:${q.y * k}px;width:${q.w * k}px;height:${q.h * k}px;border-radius:${q.r * k}px;box-shadow:0 0 0 ${q.b * k}px ${q.b ? q.color : "transparent"}`;
      if (!C.querySelector(".ed-pipz")) C.insertAdjacentHTML("beforeend", `<i class="ed-pipz" title="Drag to resize"></i>`);
      fit(C, $e("#edVid2"), sp.cam, q.w * k, q.h * k);
    }
    return;
  }
  if (E.layout === "pop") {
    const G = $e("#edBandG"), C = $e("#edBandC"), O = $e("#edBandO"), R = $e("#edPopRing"), F = $e("#edPopFill"), q = popGeo(sp);
    // until the real cut-out has loaded, the head is shown roughly: a soft oval whose middle sits just inside the
    // card's top edge and that fades out before the top of the face cam picture, so no straight edge ever shows
    const lip = Math.min(Math.max(q.r, q.b), q.w * 0.08) * k, hb = q.pop * k + lip;
    const hx = Math.min(q.w * 0.22, q.w * 0.3) * k, hy = Math.min(Math.max(q.pop * 1.25, q.w * 0.22) * k, hb * 0.9);
    const cut = popCut(q, sp, k);         // the real cut-out, from the same cut-out as the finished clip
    const L = $e("#edPopLine"), GD = $e("#edPopGuide");    // the head line: its handle beside the card, its guide across it
    if (L) { L.style.left = `${Math.min(W - 34, (q.x + q.w + q.b) * k + 8)}px`; L.style.top = `${q.y * k}px`; }
    if (GD) GD.style.cssText = `left:${(q.x - q.b) * k}px;top:${q.y * k}px;width:${(q.w + 2 * q.b) * k}px`;
    if (G) { G.style.height = H + "px"; fit(G, $e("#edVid"), sp.game, W, H); }
    if (R) R.style.cssText = `left:${(q.x - q.b) * k}px;top:${(q.y - q.b) * k}px;width:${(q.w + 2 * q.b) * k}px;height:${(q.h + 2 * q.b) * k}px;` +
      `border-radius:${q.r ? (q.r + q.b) * k : 0}px;background:${!q.b ? "transparent" : q.c1 === q.c2 ? q.c1 : `linear-gradient(90deg,${q.c1},${q.c2})`}`;
    if (F) F.style.cssText = q.fill ? `left:${q.x * k}px;top:${q.y * k}px;width:${q.w * k}px;height:${q.h * k}px;border-radius:${q.r * k}px;background:${q.fill}` : "display:none";
    if (C) {                            // the card: the lower part of the face cam picture, so the video sits pop px higher
      // plain: only the person (roughly: the head and the body below it) on the fill; the clip cuts them out exactly
      const m = q.fill && !cut ? `radial-gradient(${hx.toFixed(1)}px ${hy.toFixed(1)}px at 50% ${lip.toFixed(1)}px,#000 80%,transparent 100%),` +
        `radial-gradient(${(q.w * 0.47 * k).toFixed(1)}px ${(q.h * 0.62 * k).toFixed(1)}px at 50% 100%,#000 84%,transparent 100%)` : "none";
      C.style.cssText = `left:${q.x * k}px;top:${q.y * k}px;width:${q.w * k}px;height:${q.h * k}px;border-radius:${q.r * k}px;-webkit-mask-image:${m};mask-image:${m}${q.fill ? ";background:transparent" : ""}`;
      if (!C.querySelector(".ed-pipz")) C.insertAdjacentHTML("beforeend", `<i class="ed-pipz" title="Drag to resize"></i>`);
      fit(C, $e("#edVid2"), q.crop, q.w * k, q.t * k);
      $e("#edVid2").style.top = parseFloat($e("#edVid2").style.top) - q.pop * k + "px";
      $e("#edVid2").style.visibility = cut && q.fill ? "hidden" : "";    // plain: the fill, and the cut-out person on it
    }
    if (O) {                            // above the card: the head, shown roughly (the clip cuts the person out exactly)
      const sh = q.pop + Math.max(q.r, q.b);
      O.hidden = !q.pop;
      O.style.cssText = `left:${q.x * k}px;top:${(q.y - q.pop) * k}px;width:${q.w * k}px;height:${sh * k}px;` +
        `--hx:${hx.toFixed(1)}px;--hy:${hy.toFixed(1)}px;--hb:${hb.toFixed(1)}px${cut ? ";opacity:0" : ""}`;
      fit(O, $e("#edVid3"), q.crop, q.w * k, q.t * k);
    }
    return;
  }
  if (E.layout === "grid") {
    const n = sp.faces.length, gn = gridNow(), cells = gn.show === "all" ? gridCells(n, gn.share) : null;
    GRID_V.forEach(([bid, vid], i) => {
      const b = $e("#" + bid), v = $e("#" + vid); if (!b || !v) return;
      const c = cells ? cells[i] : i === 0 ? [0, 0, OUT_W, OUT_H] : null;      // one person: the first cell fills the frame
      if (!c) { b.style.cssText = "display:none"; return; }
      b.style.cssText = `left:${c[0] * k}px;top:${c[1] * k}px;width:${c[2] * k}px;height:${c[3] * k}px`;
      fit(b, v, sp.faces[cells ? i : gn.show], c[2] * k, c[3] * k);
    });
    const sm = $e("#edGseam");
    if (sm) { sm.hidden = !cells; if (cells) sm.style.top = cells[0][3] * k + "px"; sm.classList.toggle("own", gn.scene >= 0); }
    if (gn.scene !== E.scLit) { E.scLit = gn.scene; $$e(".ed-scbar").forEach(x => x.classList.toggle("live", +x.dataset.scb === gn.scene)); }
    return;
  }
  if (E.layout === "trio") {
    trioH().forEach((h, i) => { const b = $e(["#edBandG", "#edBandC", "#edBandT"][i]), v = $e(["#edVid", "#edVid2", "#edVid3"][i]);
      if (b && v) { b.style.height = h * k + "px"; fit(b, v, sp.trio[i], W, h * k); } });
    return;
  }
  const g = geo("split", E.sw, E.sh);
  const set = (bandId, vidId, r, h) => {
    const b = $e("#" + bandId), v = $e("#" + vidId); if (!b || !v) return;
    const bh = H * h / OUT_H, rw = r[2] * E.sw, rh = r[3] * E.sh, s = Math.max(W / rw, bh / rh);
    b.style.height = bh + "px";
    v.style.cssText = `width:${E.sw * s}px;height:${E.sh * s}px;left:${-r[0] * E.sw * s - (rw * s - W) / 2}px;top:${-r[1] * E.sh * s - (rh * s - bh) / 2}px`;
  };
  set("edBandG", "edVid", sp.game, g.fg); set("edBandC", "edVid2", sp.cam, g.ch);
  const sm = $e("#edSseam");
  if (sm) sm.style.top = H * (sp.cam_at === "bottom" ? g.fg : OUT_H - g.fg) / OUT_H + "px";
}
/* the pop-out's real cut-out for the preview: asked of the server (the same cut-out as the finished clip, kept there
   per setting) a moment after the settings stop changing, and shown once it has loaded. Size and place don't change
   it, so dragging the card never asks for a new one. True when it is showing. */
function popCut(q, sp, k) {
  const cut = $e("#edPopCut"); if (!cut) return false;
  if (!q.pop && !q.fill) { cut.style.display = "none"; return false; }
  if ((sp.pop_out ?? 22) && popFace(sp) === undefined) return false;   // the card's edge isn't settled until the face is known
  const s = 256 / q.w, a = Math.max(0, E.start - 0.5);
  const p = new URLSearchParams({a: a.toFixed(2), b: (E.end + 0.5).toFixed(2), cam: q.crop.map(v => (+v).toFixed(4)).join(","),
    t: Math.max(128, Math.min(640, Math.round(q.t * s / 2) * 2)), keep: Math.round((q.pop + Math.max(q.r, q.b)) * s)});
  p.set("ch", Math.round(q.h * s)); p.set("cr", Math.round(q.r * s)); p.set("cb", Math.round(q.b * s));   // nothing shows inside the card
  if (q.fill) p.set("plain", 1);
  const url = `/api/jobs/${E.jid}/clips/${E.cid}/popcut?${p}`;
  if (cut.dataset.want !== url) {
    cut.dataset.want = url; clearTimeout(E.popCutT);
    E.popCutT = setTimeout(() => {
      if (!cut.isConnected || cut.dataset.want !== url) return;
      cut.dataset.src = url; cut.dataset.a = a;
      cut.onloadeddata = () => { if (cut.dataset.src === url) { cut.dataset.ok = url; placeSplit(); syncSplit(); } };
      cut.src = url;
    }, cut.dataset.ok ? 900 : 250);
  }
  const on = cut.dataset.ok === url, box = `left:${q.x * k}px;top:${(q.y - q.pop) * k}px;width:${q.w * k}px;height:${q.t * k}px`;
  // the server's cut-out is small and 12 frames a second: it only gives the outline. The person is drawn from the
  // full-quality video, so the head is as sharp as the face in the card and moves with it.
  cut.style.cssText = `${box};opacity:0;display:${on ? "block" : "none"}`;
  const cv = $e("#edPopCv");
  if (cv) {
    const dpr = window.devicePixelRatio || 1, cw = Math.round(q.w * k * dpr), ch = Math.round(q.t * k * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    cv.style.cssText = `${box};display:${on ? "block" : "none"}`;
    E.popDraw = {cam: q.crop, ar: q.w / q.t};
    if (on) {
      cut.onseeked = popPaint;          // paused and moved: the new moment is drawn at once
      popPaint();
      if (!E.popRaf || performance.now() - (E.popRafAt || 0) > 400) { cancelAnimationFrame(E.popRaf); E.popRaf = requestAnimationFrame(popLoop); }
    }
  }
  return on;
}
function popLoop() {                    // while the pop-out is on screen: draw every screen frame
  E.popRaf = 0;
  if (!$e("#edPopCv") || E.layout !== "pop") return;
  popPaint();
  E.popRafAt = performance.now(); E.popRaf = requestAnimationFrame(popLoop);
}
function popPaint() {                   // the face cam picture, kept only where the cut-out is
  const cv = $e("#edPopCv"), cut = $e("#edPopCut"), v = $e("#edVid3") || $e("#edVid");
  if (!cv || !cut || !v || !E.popDraw) return;
  if (cv.style.display === "none" || v.readyState < 2 || cut.readyState < 2 || !v.videoWidth) return;
  const at = v.currentTime + (E.off || 0) - (+cut.dataset.a || 0);   // outside what the cut-out covers: nothing
  if (at < 0 || at > (cut.duration || Infinity) + 0.1) { cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); return; }
  const ctx = cv.getContext("2d"), c = E.popDraw.cam, vw = v.videoWidth, vh = v.videoHeight;
  let sx = c[0] * vw, sy = c[1] * vh, sw = c[2] * vw, sh = c[3] * vh;            // render: cover the box, centred
  if (sw / sh > E.popDraw.ar) { const n = sh * E.popDraw.ar; sx += (sw - n) / 2; sw = n; } else { const n = sw / E.popDraw.ar; sy += (sh - n) / 2; sh = n; }
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(cut, 0, 0, cv.width, cv.height);
}
function syncSplit() {                  // the other bands play the same moment as the main one
  const a = $e("#edVid"); if (!a) return;
  const pc = $e("#edPopCut");
  if (pc && pc.dataset.ok && pc.readyState >= 1) {     // the cut-out loop starts at its own second: clip time minus its start
    const want = a.currentTime + (E.off || 0) - (+pc.dataset.a || 0);
    if (want >= 0 && Math.abs(pc.currentTime - want) > 0.12) pc.currentTime = want;
    pc.playbackRate = a.playbackRate;
    if (a.paused && !pc.paused) pc.pause(); else if (!a.paused && pc.paused) pc.play().catch(() => {});
  }
  for (const id of ["#edVid2", "#edVid3", "#edVid4"]) {
    const b = $e(id); if (!b || b.readyState < 1) continue;
    if (Math.abs(b.currentTime - a.currentTime) > 0.15) b.currentTime = a.currentTime;
    b.playbackRate = a.playbackRate;
    if (a.paused && !b.paused) b.pause(); else if (!a.paused && b.paused) b.play().catch(() => {});
  }
}
/* the pop-out's head line: dragging its handle down lets more of the head rise over the card, up lets less ("Head
   line", sp.pop_out, 0 to 45) */
let plDrag = null;
dlg_on("pointerdown", e => {
  const h = e.target.closest("#edPopLine"); if (!h || E.layout !== "pop") return;
  e.preventDefault(); e.stopPropagation();
  const k = $e("#edPhone").clientWidth / OUT_W;
  plDrag = {sy: e.clientY, k, pw: popGeo().w, v0: rawSplit().pop_out ?? 22, moved: false};
  h.setPointerCapture?.(e.pointerId); h.classList.add("drag"); $e("#edPhone").classList.add("popline");
  h.dataset.v = `Head line ${plDrag.v0}%`;
});
dlg_on("pointermove", e => {
  const d = plDrag; if (!d) return;
  const v = Math.round(Math.max(0, Math.min(45, d.v0 + (e.clientY - d.sy) / d.k / d.pw * 90)));
  if (v === (rawSplit().pop_out ?? 22) && d.moved) return;
  d.moved = true;
  E.look.split = {...rawSplit(), pop_out: v};
  const h = $e("#edPopLine"); if (h) h.dataset.v = `Head line ${v}%`;
  E.lastKey = ""; placeSplit(); paintOverlay();
});
dlg_on("pointerup", () => {
  const d = plDrag; plDrag = null; if (!d) return;
  $e("#edPopLine")?.classList.remove("drag"); $e("#edPhone")?.classList.remove("popline");
  if (!d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; if (E.tab === "layout") drawPanel(); after("");
});
$("#clipdlg").addEventListener("click", e => { if (e.target.closest("#edPopLine")) { e.stopPropagation(); e.preventDefault(); } }, true);
/* the face cam split's line: dragging its handle sets how much of the frame the stream takes (the face cam gets the rest) */
let ssDrag = null;
dlg_on("pointerdown", e => {
  const h = e.target.closest("#edSseam"); if (!h || E.layout !== "split") return;
  e.preventDefault(); e.stopPropagation();
  ssDrag = {ph: $e("#edPhone").getBoundingClientRect(), moved: false};
  h.setPointerCapture?.(e.pointerId); h.classList.add("drag");
  const sp = rawSplit(); h.dataset.v = `Stream ${sp.share}% · Face ${100 - sp.share}%`;
});
dlg_on("pointermove", e => {
  const d = ssDrag; if (!d) return;
  d.moved = true;
  const y = Math.round((e.clientY - d.ph.top) / d.ph.height * 100), sp = rawSplit();
  const v = Math.max(30, Math.min(70, sp.cam_at === "bottom" ? y : 100 - y));
  E.look.split = {...sp, share: v};
  const h = $e("#edSseam"); if (h) h.dataset.v = `Stream ${v}% · Face ${100 - v}%`;
  E.lastKey = ""; E.zKey = ""; paintOverlay(); paintStroke?.();
});
dlg_on("pointerup", () => {
  const d = ssDrag; ssDrag = null; if (!d) return;
  $e("#edSseam")?.classList.remove("drag");
  if (!d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; if (E.tab === "layout") drawPanel(); after("");
});
$("#clipdlg").addEventListener("click", e => { if (e.target.closest("#edSseam")) { e.stopPropagation(); e.preventDefault(); } }, true);
/* the face grid's line between the rows: its handle on the preview moves it, like the slider in the Layout panel. While
   the playhead is in a scene that shows everyone, that scene gets its own line; elsewhere the clip's line moves. */
let gsDrag = null;
dlg_on("pointerdown", e => {
  const h = e.target.closest("#edGseam"); if (!h || E.layout !== "grid") return;
  e.preventDefault(); e.stopPropagation();
  gsDrag = {ph: $e("#edPhone").getBoundingClientRect(), i: gridNow().scene, moved: false};
  h.setPointerCapture?.(e.pointerId); h.classList.add("drag"); h.dataset.v = `Top ${gridNow().share}%`;
});
dlg_on("pointermove", e => {
  const d = gsDrag; if (!d) return;
  d.moved = true;
  const v = Math.round(Math.max(20, Math.min(80, (e.clientY - d.ph.top) / d.ph.height * 100))), sp = rawSplit();
  if (d.i >= 0 && (sp.scenes || [])[d.i]?.v === "all") { const L = clone(sp.scenes); L[d.i].share = v; E.look.split = {...sp, scenes: L}; }
  else E.look.split = {...sp, grid_share: v};
  const h = $e("#edGseam"); if (h) h.dataset.v = `Top ${v}%`;
  E.lastKey = ""; paintOverlay();
});
dlg_on("pointerup", () => {
  const d = gsDrag; gsDrag = null; if (!d) return;
  $e("#edGseam")?.classList.remove("drag");
  if (!d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; if (E.tab === "layout") drawPanel(); if (d.i >= 0) drawTimeline(); after("");
});
$("#clipdlg").addEventListener("click", e => { if (e.target.closest("#edGseam")) { e.stopPropagation(); e.preventDefault(); } }, true);
/* the Scenes lane: click an empty spot to add a scene there; drag a scene to move it, its ends to change how long it
   runs. Scenes never overlap: each one stops at its neighbours. */
function sceneAdd(at) {
  const sp = rawSplit(), L = clone(sp.scenes || []), r1 = v => Math.round(v * 10) / 10;
  if (L.length >= 40) return toast("Up to 40 scenes on one clip.", "bad");
  let t = Math.max(E.start, Math.min(E.end - 0.5, at ?? nowT()));
  const inside = L.find(x => t >= x.a && t < x.b); if (inside) t = inside.b;      // on a scene: the new one follows it
  const next = L.filter(x => x.a >= t).sort((p, q) => p.a - q.a)[0];
  const b = Math.min(E.end, next ? next.a : Infinity, t + 3);
  if (b - t < 0.5) return toast("No room for a scene here. Move or shorten the next one.", "bad");
  const prev = L.filter(x => x.b <= t + 0.05).sort((p, q) => q.b - p.b)[0];     // the next person after the one before
  const s = {a: r1(t), b: r1(b), v: prev && prev.v !== "all" ? (prev.v + 1) % sp.faces.length : 0, share: null};
  L.push(s); L.sort((p, q) => p.a - q.a);
  E.look.split = {...sp, scenes: L}; E.scSel = L.indexOf(s); E.lookTouched = true; E.scLit = null;
  E.tab = "layout"; drawPanel(); drawTimeline(); after(""); showAt(s.a + 0.05);
}
$("#clipdlg").addEventListener("click", e => {
  const lane = e.target.closest(".ed-lane.scenes"); if (!lane || e.target.closest(".ed-scbar")) return;
  if (E.justMoved && Date.now() - E.justMoved < 300) return;
  const r = $e("#edTrack").getBoundingClientRect(), t = E.min + (e.clientX - r.left) / r.width * (E.max - E.min);
  e.stopPropagation();
  if (t < E.start || t > E.end) return toast("Scenes go inside the clip", "bad");
  sceneAdd(t);
});
let sceneDrag = null;
dlg_on("pointerdown", e => {
  const bar = e.target.closest(".ed-scbar"); if (!bar) return;
  const i = +bar.dataset.scb, s = (rawSplit().scenes || [])[i]; if (!s) return;
  const tr = $e("#edTrack").getBoundingClientRect();
  sceneDrag = {i, bar, mode: e.target.closest(".pe.l") ? "a" : e.target.closest(".pe.r") ? "b" : "move", sx: e.clientX, a0: s.a, b0: s.b,
    k: (E.max - E.min) / tr.width, moved: false};
  bar.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = sceneDrag; if (!d) return;
  const dt = (e.clientX - d.sx) * d.k; if (Math.abs(e.clientX - d.sx) > 3) d.moved = true; if (!d.moved) return;
  const sp = rawSplit(), L = clone(sp.scenes || []), s = L[d.i]; if (!s) return;
  const lo = d.i > 0 ? L[d.i - 1].b : E.start, hi = d.i < L.length - 1 ? L[d.i + 1].a : E.end;
  const r = v => Math.round(v * 10) / 10, len = d.b0 - d.a0;
  if (d.mode === "a") s.a = r(Math.max(lo, Math.min(s.b - 0.5, d.a0 + dt)));
  else if (d.mode === "b") s.b = r(Math.min(hi, Math.max(s.a + 0.5, d.b0 + dt)));
  else { s.a = r(Math.max(lo, Math.min(hi - len, d.a0 + dt))); s.b = r(s.a + len); }
  E.look.split = {...sp, scenes: L};
  d.bar.style.left = pct(s.a) + "%"; d.bar.style.width = Math.max(0.6, pct(s.b) - pct(s.a)) + "%";
  showAt(d.mode === "b" ? s.b - 0.05 : s.a + 0.05);
});
dlg_on("pointerup", () => {
  const d = sceneDrag; sceneDrag = null; if (!d || !d.moved) return;
  E.justMoved = Date.now(); E.lookTouched = true; E.scLit = null;
  if (E.tab === "layout") drawPanel(); drawTimeline(); after("");
});
// the face grid's settings: how many people, the line between the rows, where each one is, and the scenes
function gridCard(sp) {
  const n = sp.faces.length, L = sp.scenes || [];
  return `<div class="ed-card ed-gridset"><div class="ed-h"><b>Face grid</b><small class="ed-pipnote">Or drag the handle on the video</small></div>
    <div class="ed-piprow"><span class="ed-pipl">People</span><div class="ed-seg ed-gn" role="radiogroup" aria-label="People">${[2, 3, 4].map(k =>
      `<button role="radio" data-ed="gridn" data-v="${k}" aria-checked="${n === k}" aria-pressed="${n === k}">${k}</button>`).join("")}</div></div>
    ${slider("Top row", "grid_share", 20, 80, 1, sp.grid_share || 50, (sp.grid_share || 50) + "%")}
    <div class="ed-row"><button class="ed-btn" data-ed="view" data-v="frame">${svg('<path d="M7 3v14h14M3 7h14v14"/>')}Place the people</button>
      <button class="ed-btn ghost" data-ed="gridreset">Even slices</button></div></div>
  <div class="ed-card ed-scenes"><div class="ed-h"><b>Scenes</b>${L.length ? `<button class="ed-link" data-ed="sceneadd">Add at playhead</button>` : ""}</div>
    <p class="ed-help">A scene shows one person full screen, or everyone with its own row size, for a stretch of the clip. The rest of the clip shows everyone.</p>
    ${L.length ? `<ol class="ed-sclist">${L.map((s, i) => `<li class="${i === E.scSel ? "on" : ""}">
      <button class="ed-sctime" data-ed="scenesel" data-v="${i}" title="Go to this scene">${ts(s.a - E.start)}<i>–</i>${ts(s.b - E.start)}</button>
      <div class="ed-seg ed-scwho" role="radiogroup" aria-label="Who this scene shows">${["all", ...sp.faces.map((_, k) => k)].map(v =>
        `<button role="radio" data-ed="sceneshow" data-i="${i}" data-v="${v}" aria-checked="${s.v === v}" aria-pressed="${s.v === v}" title="${v === "all" ? "Everyone" : personName(v)}">${v === "all" ? "All" : `<i style="--c:${GRID_COLS[v]}"></i>${v + 1}`}</button>`).join("")}</div>
      <button class="ed-ib sm ed-scx" data-ed="scenedel" data-v="${i}" aria-label="Remove this scene" title="Remove this scene">${ic("x")}</button></li>`).join("")}</ol>`
    : `<button class="ed-scempty" data-ed="sceneadd">${SCENE_IC}<span><b>Add a scene at the playhead</b><small>Show one person while they talk, then back to everyone</small></span></button>`}</div>`;
}
/* picture in picture: drag the small box anywhere on the video, or its corner to resize it. Stored as its middle
   (% of the frame) and its width (% of the frame), the numbers render.pip_geometry uses. */
let pipDrag = null;
const dragKeys = () => E.layout === "pop" ? {s: "pop_size", x: "pop_x", y: "pop_y", lo: 40, hi: 90, geo: popGeo} : {s: "pip_size", x: "pip_x", y: "pip_y", lo: 22, hi: 50, geo: pipGeo};
dlg_on("pointerdown", e => {
  if ((E.layout !== "pip" && E.layout !== "pop") || E.view !== "live") return;
  const box = e.target.closest("#edBandC, #edBandO"); if (!box) return;
  e.preventDefault(); e.stopPropagation();
  const K = dragKeys(), ph = $e("#edPhone").getBoundingClientRect(), q = K.geo();
  pipDrag = {rz: !!e.target.closest(".ed-pipz"), sx: e.clientX, sy: e.clientY, pw: ph.width, ph: ph.height, K,
    cx: (q.x + q.w / 2) / OUT_W * 100, cy: (q.y + q.h / 2) / OUT_H * 100, s0: splitOf()[K.s] || SPLIT_DEFAULT[K.s], moved: false};
  box.setPointerCapture?.(e.pointerId);
});
dlg_on("pointermove", e => {
  const d = pipDrag; if (!d) return;
  const mx = e.clientX - d.sx, my = e.clientY - d.sy;
  if (!d.moved && Math.hypot(mx, my) < 3) return;
  d.moved = true;
  const sp = rawSplit(), K = d.K;
  if (d.rz) E.look.split = {...sp, [K.s]: Math.round(Math.max(K.lo, Math.min(K.hi, d.s0 + mx / d.pw * 100 * 2))), [K.x]: d.cx, [K.y]: d.cy};
  else E.look.split = {...sp, [K.x]: Math.round((d.cx + mx / d.pw * 100) * 10) / 10, [K.y]: Math.round((d.cy + my / d.ph * 100) * 10) / 10};
  placeSplit(); if (E.layout === "pop") { E.lastKey = ""; paintOverlay(); }
});
dlg_on("pointerup", () => {
  const d = pipDrag; pipDrag = null; if (!d || !d.moved) return;
  const K = d.K, q = K.geo();   // keep what was shown: the middle of the box as it sits, inside the frame
  E.look.split = {...rawSplit(), [K.x]: Math.round((q.x + q.w / 2) / OUT_W * 1000) / 10, [K.y]: Math.round((q.y + q.h / 2) / OUT_H * 1000) / 10};
  E.justMoved = Date.now(); E.lookTouched = true; if (E.tab === "layout") drawPanel(); after("");
});
$("#clipdlg").addEventListener("click", e => {      // the click that ends a drag doesn't also play or pause
  if (E.justMoved && Date.now() - E.justMoved < 350 && e.target.closest("#edBandC, #edBandO")) { e.stopPropagation(); e.preventDefault(); }
}, true);
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
  const sp = splitOf(), at = {...sp, frame: E.look.frame || frameDefault(), t0: sp.trio[0], t1: sp.trio[1], t2: sp.trio[2],
    ...Object.fromEntries(sp.faces.map((r, i) => ["f" + i, r]))};
  for (const k of ["game", "cam", "frame", "t0", "t1", "t2", ...sp.faces.map((_, i) => "f" + i)]) {
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
  const r0 = k === "frame" ? [...(E.look.frame || frameDefault())] : /^f\d$/.test(k) ? [...rawSplit().faces[+k[1]]]
    : k[0] === "t" ? [...splitOf().trio[+k[1]]] : [...splitOf()[k]];
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
  if (d.k === "frame") E.look.frame = r;
  else if (/^f\d$/.test(d.k)) { const f = clone(rawSplit().faces); f[+d.k[1]] = r; E.look.split = {...rawSplit(), faces: f}; }
  else if (d.k[0] === "t") { const t = clone(rawSplit().trio); t[+d.k[1]] = r; E.look.split = {...rawSplit(), trio: t}; }
  else E.look.split = {...rawSplit(), [d.k]: r};
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
// the word of a caption line that gets the key-word look (render.accent_index): a punch word the AI marked, else the longest
function accentIndex(texts) {
  const strong = new Set((clipNow()?.highlight_words || []).map(h => h.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean));
  const i = texts.findIndex(t => strong.has(t.toLowerCase().replace(/[^a-z0-9']/g, "")));
  if (i >= 0) return i;
  let best = -1, n = 3;
  texts.forEach((t, j) => { if (t.length > n) { best = j; n = t.length; } });
  return best;
}
function paintOverlay(t = nowT()) {
  if (E.view !== "live") return;
  const cap = $e("#edCap"), hook = $e("#edHookBox"), phone = $e("#edPhone");
  if (!cap || !phone) return;
  const k = phone.clientWidth / OUT_W, L = E.look, H = hookOf(L), g = geo(E.layout, E.sw, E.sh);
  paintFx(t, phone);
  paintBrand(t - E.start, phone, k);
  paintPics(t, phone, k);
  if (isParts(E.layout)) { placeSplit(); syncSplit(); } else placeFg();
  paintStroke();
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
  const shown = gi < 0 || L.caps === false ? [] : typing ? E.editText.trim().split(/\s+/).filter(Boolean) : ls[gi].map(i => E.words[i].w);
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
    `-webkit-text-stroke:${L.outline * 2 * k}px ${L.cap_line || "#000"};column-gap:${gapPx}px;letter-spacing:${(L.sp || 0) * k}px;${capBox}text-shadow:${CAP_SHADOW * k}px ${CAP_SHADOW * k}px 0 rgba(0,0,0,.5);`;
  const texts = shown.map((w, n) => { w = w.replace(/[.,;:]+$/, "");
    return L.upper ? w.toUpperCase() : n === 0 ? w.replace(/^\p{Ll}/u, c => c.toUpperCase()) : w; });     // normal case: each line starts with a capital
  const kwi = L.kw_font || L.kw_color ? accentIndex(texts) : -1, kfc = L.kw_font ? fontCss(L.kw_font) : null;
  cap.innerHTML = texts.map((w, n) => {
    if (n === kwi) return `<span class="${n === act ? "on" : ""} kw" style="color:${L.kw_color || (n === act ? L.active : L.base)};${kfc ? `font-family:${kfc.family};font-weight:${kfc.weight};` : ""}` +
      `font-size:${(L.size * (L.kw_scale || 100) / 100 * emOf(L.kw_font || L.font) * k).toFixed(1)}px;${L.kw_italic ? "font-style:italic;" : ""}">${esc(w)}</span>`;
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
  const old = $e("#edScroll"), keep = old && old.scrollWidth > old.clientWidth && E.tlZoomWas === E.zoom ? old.scrollLeft : null;
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
      <div class="ed-play"><span class="ed-now ed-tedit" id="edNow" title="Double-click to go to an exact time">0:00.0</span>
        <button class="ed-pbtn" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
        <span class="ed-dur ed-tedit" title="${E.cuts?.length ? "Length after Speech cleanup" : "Length"} · double-click to type a new length">${ts(keptLen())}</span></div>
      <div class="ed-tl-right"><button class="ed-rate" data-ed="rate" title="Playback speed">${E.rate}x</button></div>
    </div>
    <div class="ed-tlw">
      <div class="ed-heads">
        <div class="ed-tbox" id="edNow2">${clock(nowT() - E.start, true)}</div>
        <div class="ed-thp">
          ${head("hook", TEXT_IC, "Hook", hasHook ? `<button class="ed-tb" data-ed="hookvis" aria-pressed="${!!E.look.hook}" title="${E.look.hook ? "Hide" : "Show"} the hook">${EYE(E.look.hook)}</button>` : "")}
          ${head("caps", ic("cc"), `Captions <small class="ed-thn" id="edCapNow">${lines().length}</small>`, `<button class="ed-tb" data-ed="capvis" aria-pressed="${E.look.caps !== false}" title="${E.look.caps !== false ? "Hide" : "Show"} the captions">${EYE(E.look.caps !== false)}</button>`)}
          ${head("pics", PIC_IC, "Pictures", `<button class="ed-tb" data-ed="tab" data-t="media" title="Add a picture or a reaction face" aria-label="Pictures">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${head("music", MUSIC_IC, "Music", `<button class="ed-tb" data-ed="tab" data-t="audio" data-at="music" title="Add or change the music" aria-label="Music">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${head("sfx", SFX_IC, "Sounds", `<button class="ed-tb" data-ed="tab" data-t="audio" data-at="sfx" title="Add a sound effect" aria-label="Sounds">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${head("zooms", ZOOM_IC, "Zooms", `<button class="ed-tb" data-ed="zoomadd" title="Add a zoom at the playhead (Z)" aria-label="Add a zoom">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`)}
          ${E.layout === "grid" ? head("scenes", SCENE_IC, "Scenes", `<button class="ed-tb" data-ed="sceneadd" title="Add a scene at the playhead" aria-label="Add a scene">${svg('<path d="M12 5v14M5 12h14"/>')}</button>`) : ""}
          ${E.chat?.counts?.length ? head("chat", ic("chat"), "Chat") : ""}
          ${head("film", ic("film"), "Video", `<button class="ed-tb" data-ed="shotadd" title="Add another shot from the video at the playhead (double-click the strip works too)" aria-label="Add a shot">${svg('<path d="M12 5v14M5 12h14"/>')}</button><button class="ed-tb" data-ed="mute" aria-pressed="${!E.muted}" title="${E.muted ? "Turn the preview's sound on" : "Mute the preview"}">${SOUND(!E.muted)}</button>`)}
        </div>
      </div>
      <div class="ed-scroll" id="edScroll">
        <div class="ed-track" id="edTrack" style="width:${E.zoom * 100}%">
          <div class="ed-ruler">${ticks.join("")}</div>
          <div class="ed-lanes" style="--gs:${step / span * 100}%">
            <div class="ed-lane hook ${hasHook ? "" : "znone"}">${!hasHook ? `<button class="ed-ehint hook" data-ed="tab" data-t="text" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%">${TEXT_IC}<span>Add a hook: the line that stops the scroll</span></button>` : ""}${hasHook ? `<button class="ed-hchip ${E.look.hook ? "" : "off"}" data-ed="tab" data-t="text" style="left:${pct(E.start)}%;width:${pct(hookEnd()) - pct(E.start)}%"><i>${TEXT_IC}</i><span>Hook: ${esc(E.hook)}</span></button>` : ""}
              ${fx !== "None" ? `<button class="ed-fxchip" data-ed="tab" data-t="fx" style="left:${pct(hookEnd())}%;width:${Math.max(6, pct(E.end) - pct(hookEnd()))}%"><i>${FX_IC}</i><span>Filter: ${esc(fx)}</span></button>` : ""}</div>
            <div class="ed-lane caps"><i class="ed-cbar" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"></i>${chips}</div>${picsLane()}${musicLane()}${sfxLane()}${zoomsLane()}${E.layout === "grid" ? scenesLane() : ""}${chatLane()}
            <div class="ed-lane film" style="background-image:url('/media/${E.jid}/thumb.jpg'),url('/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}')">
              <div class="ed-shade l" style="width:${pct(E.start)}%"></div><div class="ed-shade r" style="left:${pct(E.end)}%"></div>
              ${(E.cuts || []).map(([a, b]) => `<i class="ed-cutmark" style="left:${pct(a)}%;width:${Math.max(0.2, pct(b) - pct(a))}%" title="Cut by Speech cleanup"></i>`).join("")}
              ${hasShots() ? `${shotGaps().map(([a, b]) => `<i class="ed-gap" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%"></i>`).join("")}
                ${E.shots.map(([a, b], i) => `<div class="ed-win ed-shot ${i === E.shotSel ? "on" : ""}" data-shot="${i}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%">
                  <i class="ed-hd" data-sh="${i}:a"></i><span class="ed-shn">${i + 1}</span><button class="ed-shx" data-ed="shotdel" data-v="${i}" title="Remove this shot" aria-label="Remove shot ${i + 1}">${ic("x")}</button><i class="ed-hd" data-sh="${i}:b"></i></div>`).join("")}`
              : `<div class="ed-win" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"><i class="ed-hd" data-h="start"></i><i class="ed-hd" data-h="end"></i></div>`}
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
  // the view: where it was (a redraw never jumps), on the playhead after a zoom, or on the clip the first time
  const sc = $e("#edScroll"), first = !E.tlViewed;
  E.tlZoomWas = E.zoom;
  if (!sc || E.zoom <= 1) return;
  if (keep != null) sc.scrollLeft = keep;
  else if (first) centreTimeline();
  else sc.scrollLeft = pct(nowT()) / 100 * sc.scrollWidth - sc.clientWidth / 3;
}
function setZoom(z) {
  E.zoom = Math.max(1, Math.min(E.zmax || 8, Math.round(z * 2) / 2));
  drawTimeline();
}
// one zoom step: half a step at low zoom, a fifth of the current zoom when far in, so it never feels slow
const zoomStep = dir => setZoom(E.zoom + dir * Math.max(0.5, E.zoom * 0.2));
// the clip in the middle of the timeline's view
// (when the clip fits in the view it starts a little in from the left edge; a longer one starts at the edge)
function centreTimeline(tries = 0) {
  const sc = $e("#edScroll"); if (!sc) return;
  if (sc.scrollWidth <= sc.clientWidth) { if (tries < 30) requestAnimationFrame(() => centreTimeline(tries + 1)); return; }   // not laid out yet
  const a = pct(E.start) / 100 * sc.scrollWidth, b = pct(E.end) / 100 * sc.scrollWidth, room = sc.clientWidth - (b - a);
  sc.scrollLeft = Math.max(0, a - Math.max(16, Math.min(room / 2, sc.clientWidth * 0.06)));
  E.tlViewed = true;
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
// double-click the time or the length under the preview to type it: go to an exact moment, or set how long the clip is
const parseTime = t => { const m = String(t).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); return m ? (+(m[1] || 0)) * 60 + +m[2] : null; };
dlg_on("dblclick", e => {
  const el = e.target.closest("#edTl .ed-tedit"); if (!el || el.querySelector("input")) return;
  const dur = el.classList.contains("ed-dur"), old = el.textContent;
  el.innerHTML = `<input class="ed-tin" value="${esc(old)}" aria-label="${dur ? "Clip length" : "Go to time"}" spellcheck="false">`;
  const i = el.querySelector("input"); i.focus(); i.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = ok ? parseTime(i.value) : null;
    el.textContent = old; E.shownNow = "";          // the time label fills in again on the next frame
    if (v == null) { if (ok && i.value.trim() !== old) toast("Type a time like 0:45 or 1:05.5", "bad"); return; }
    if (dur) {
      const want = Math.max(3, Math.min(180, v)); setTrim("end", E.start + want);
      if (Math.abs(E.end - E.start - want) > 0.06) toast(`The clip can be ${ts(E.end - E.start)} at most here`, "");
      E.lookTouched = true; after("pt");
    } else showAt(Math.max(E.start, Math.min(E.end, E.start + v)));
  };
  i.addEventListener("keydown", k => { if (k.key === "Enter") { k.preventDefault(); finish(true); } else if (k.key === "Escape") { k.preventDefault(); k.stopPropagation(); finish(false); } });
  i.addEventListener("blur", () => finish(true));
});
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
  w: E.edited ? E.words : null, ed: !!E.edited, c: E.cuts || [], sh: clone(E.shots || []), lt: !!E.lookTouched});
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
  Object.assign(E, {start: x.s, end: x.e, hook: x.h, title: x.t, description: x.d, layout: x.l, look: x.k, cuts: x.c, shots: x.sh || [], edited: x.ed, lookTouched: x.lt});
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
// the same shortcuts in groups, for the window
const KEY_GROUPS = [["Playback", ["Space", "← →", "Shift ← →", ", .", "Home End", "M"]], ["Trim and edit", ["I", "O", "Z", "Ctrl Z", "Ctrl Shift Z"]],
  ["Save and render", ["Ctrl S", "Ctrl Enter"]], ["View", ["F", "T", "?", "Esc"]]];
function drawKeys() {
  if (!E.keysOpen) return $e("#edKeys")?.remove();
  if ($e("#edKeys")) return;
  const el = document.createElement("div");
  el.id = "edKeys"; el.className = "ed-tplw";
  el.innerHTML = `<div class="ed-tplbox ed-keysbox" role="dialog" aria-label="Keyboard shortcuts"><header><div><h3>Keyboard shortcuts</h3>
      <p>They work anywhere in the editor except while typing.</p></div><button class="ed-ib" data-ed="keysclose" aria-label="Close">${ic("x")}</button></header>
    <div class="ed-keys2">${[[0, 2], [1, 3]].map(col => `<div class="ed-kcol">${col.map(i => { const [g, list] = KEY_GROUPS[i];
      return `<section><h4>${g}</h4>${list.map(k => { const l = (KEYS.find(x => x[0] === k) || [k, ""])[1];
        return `<div class="ed-krow"><span>${esc(l)}</span><span class="ed-kk">${k.split(" ").map(x => `<kbd>${esc(x)}</kbd>`).join("")}</span></div>`; }).join("")}</section>`; }).join("")}</div>`).join("")}</div></div>`;
  el.addEventListener("click", e => { if (e.target === el) { E.keysOpen = false; drawKeys(); } });
  $e(".ed").append(el);
}
function changes() {
  const body = {start: E.start, end: E.end, hook: E.hook, title: E.title, description: E.description, layout: E.layout,
    captions: E.edited ? E.words : null, cuts: allCuts(), shots: hasShots() ? E.shots : null};
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
  if (a === "tab" && d.at) E.atab = d.at;           // a shortcut straight to Audio's Music or Sounds tab
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
    const CAP = ["font", "size", "base", "active", "upper", "per", "outline", "cap_line", "y"];
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
  if (a === "capvis") { E.look.caps = E.look.caps === false; E.lookTouched = true; E.lastKey = ""; after("pt"); return paintOverlay(); }   // the eye on the Captions track: hidden captions stay out of the video too
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
    try {
      E.brandDef = name;          // the look just saved is the one new clips start with: videos and live streams alike
      E.brand = (await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(brandBody([...E.brand.filter(x => x.name !== name), {name, look: styleOnly(E.look)}]))})).styles;
      E.saveOpen = false; toast(`“${name}” saved. New clips start with it, live ones too.`, "ok");
    } catch (er) { toast(er.message, "bad"); }
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
  if (a === "layout") {
    const was = E.layout;
    E.layout = d.v; E.splitKind = d.kind || "";
    if (d.kind === "duo") E.look.split = {...rawSplit(), game: [0, 0, 0.5, 1], cam: [0.5, 0, 0.5, 1], share: 50, cam_at: "bottom"};
    else if (d.v === "split" && E.look.split && E.look.split.game?.join() === "0,0,0.5,1" && E.look.split.cam?.join() === "0.5,0,0.5,1")
      E.look.split = {...SPLIT_DEFAULT, ...(clipNow()?.auto_split || {})};      // back from Duo: the stream and face cam spots
    if ((isParts(d.v) || d.v === "card") && !b.closest("#edPanel") && E.view !== "frame") E.tab = "layout";
    E.lookTouched = true; drawPanel(); drawStage(); if (d.v === "split" && !d.kind || d.v === "pip" || d.v === "pop") findFacecam();
    return after(was === "grid" || d.v === "grid" ? "t" : "");      // the Scenes lane comes and goes with the face grid
  }
  if (a === "splitline") { E.look.stroke = +d.v; E.lookTouched = true; paintStroke(); drawPanel(); return after(""); }
  if (a === "strokecol") { E.look.stroke_color = d.v; E.lookTouched = true; paintStroke(); drawPanel(); return after(""); }
  if (a === "pipat") { E.look.split = {...rawSplit(), pip_at: d.v, pip_x: null, pip_y: null}; E.lookTouched = true; placeSplit(); drawPanel(); return after("p"); }
  if (a === "popset") {                 // one pop-out setting from a button: shape, border kind, background, a colour
    const sp = rawSplit(), v = d.v;
    E.look.split = d.k === "grad" ? {...sp, pop_edge: "gradient", pop_c1: d.a, pop_c2: d.b} : {...sp, [d.k]: v};
    E.lookTouched = true; E.lastKey = ""; placeSplit(); paintOverlay(); drawPanel(); return after("");
  }
  if (a === "popat") { E.look.split = {...rawSplit(), pop_x: d.v === "c" ? null : 50, pop_y: d.v === "c" ? null : +d.v}; E.lookTouched = true; placeSplit(); paintOverlay(); drawPanel(); return after(""); }
  if (a === "pipshape" || a === "pipcol") { E.look.split = {...rawSplit(), [a === "pipshape" ? "pip_shape" : "pip_color"]: d.v}; E.lookTouched = true; placeSplit(); drawPanel(); return after(""); }
  if (a === "gridn") {                  // how many people: boxes placed by hand stay, new ones get a slice
    const n = +d.v, sp = rawSplit(), was = sp.faces; if (n === was.length) return;
    const even = JSON.stringify(was) === JSON.stringify(evenFaces(was.length));
    const faces = even ? evenFaces(n) : [...clone(was).slice(0, n), ...evenFaces(n).slice(was.length)];
    E.look.split = {...sp, faces, scenes: clone(sp.scenes || []).filter(x => x.v === "all" || x.v < n)};
    E.lookTouched = true; drawStage(); drawPanel(); drawTimeline(); return after("p");
  }
  if (a === "gridreset") { E.look.split = {...rawSplit(), faces: evenFaces(rawSplit().faces.length)}; E.lookTouched = true; placeRegions(); placeSplit(); drawPanel(); return after("p"); }
  if (a === "sceneadd") return sceneAdd();
  if (a === "scenesel") {
    const s = (rawSplit().scenes || [])[+d.v]; if (!s) return;
    E.scSel = +d.v; if (E.tab !== "layout") E.tab = "layout"; drawPanel(); drawTimeline(); return showAt(s.a + 0.05);
  }
  if (a === "sceneshow") {
    const sp = rawSplit(), L = clone(sp.scenes || []), s = L[+d.i]; if (!s) return;
    s.v = d.v === "all" ? "all" : +d.v; if (s.v !== "all") s.share = null;
    E.look.split = {...sp, scenes: L}; E.scSel = +d.i; E.lookTouched = true; E.scLit = null;
    drawPanel(); drawTimeline(); placeSplit(); paintOverlay(); return after("");
  }
  if (a === "scenedel") {
    const sp = rawSplit(), L = clone(sp.scenes || []); L.splice(+d.v, 1);
    E.look.split = {...sp, scenes: L}; E.scSel = -1; E.lookTouched = true; E.scLit = null;
    drawPanel(); drawTimeline(); placeSplit(); paintOverlay(); return after("");
  }
  if (a === "trioreset") { E.look.split = {...rawSplit(), trio: clone(SPLIT_DEFAULT.trio)}; E.lookTouched = true; drawStage(); drawPanel(); return after("p"); }
  if (a === "framereset") {             // the Frame view's Reset: the whole picture (or the usual face cam spots)
    if (E.layout === "trio") E.look.split = {...rawSplit(), trio: clone(SPLIT_DEFAULT.trio)};
    else if (E.layout === "grid") E.look.split = {...rawSplit(), faces: evenFaces(rawSplit().faces.length)};
    else if (isParts(E.layout)) E.look.split = {...SPLIT_DEFAULT, ...(clipNow()?.auto_split || {}), pip_at: rawSplit().pip_at, pip_size: rawSplit().pip_size,
      ...Object.fromEntries(POP_KEYS.map(k => [k, rawSplit()[k]]))};
    else delete E.look.frame;
    E.lookTouched = true; placeRegions(); return after("p");
  }
  if (a === "muspick") { E.musLib = false; }
  if (a === "muspick") {
    if (e.target.closest("[data-ed=musdel]")) return;
    E.look.music = {...musicOf(), id: d.v, at: d.v === musicOf().id ? musicOf().at : 0}; E.lookTouched = true; drawPanel(); drawTimeline(); return after("");
  }
  if (a === "musdel") {
    e.stopPropagation();
    const t = (E.music || []).find(x => x.id === d.v); if (!t || !confirm(`Remove "${t.name}" from your library? Clips already made keep their sound.`)) return;
    try { E.music = [...(await api(`/api/music/${d.v}`, {method: "DELETE"})).tracks, ...(E.music || []).filter(t => t.pack)]; } catch (er) { return toast(er.message, "bad"); }
    if (musicOf().id === d.v) { E.look.music = {...musicOf(), id: ""}; E.lookTouched = true; }
    drawPanel(); return after("");
  }
  if (a === "bgkind") { E.look.bg = {...bgOf(), kind: d.v}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after(""); }
  if (a === "brandkind") { E.look.brand_kind = d.v; if (d.v === "social" && !E.look.brand_head && !E.look.brand_handle) wmPreset("dual"); E.lookTouched = true; drawPanel(); return wmRefresh(); }
  if (a === "wmpreset") { wmPreset(d.v); E.lookTouched = true; drawPanel(); return wmRefresh(); }
  if (a === "wmstyle" || a === "wmalign") {        // the watermark's look, or how its lines line up
    E.look[a === "wmstyle" ? "brand_style" : "brand_align"] = d.v; Object.assign(E.look, {brand_on: true, brand_kind: "social"});
    $$e(`[data-ed=${a}]`).forEach(x => x.setAttribute("aria-pressed", String(x === b))); return wmRefresh();
  }
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
    try { E.media = [...(await api(`/api/media/${d.v}`, {method: "DELETE"})).items, ...(E.media || []).filter(m => m.pack)]; } catch (er) { return toast(er.message, "bad"); }
    E.look.overlays = (E.look.overlays || []).filter(o => o.id !== d.v); E.picSel = -1; E.lookTouched = true; drawPanel(); drawTimeline(); return after("");
  }
  if (a === "outroset") {
    const o = outroOf(), v = d.k === "on" || d.k === "fx" || d.k === "icons" ? d.v === "1" : d.v;
    E.look.outro = {...o, [d.k]: v}; E.lookTouched = true; drawPanel(); after("");
    drawTimeline();
    return;
  }
  if (a === "outroplay") return playOutro(false);
  if (a === "outrojump") { E.tab = "media"; drawPanel(); return playOutro(false); }
  if (a === "scoreplay") { showAt(E.start); const v = $e("#edVid"); if (v && v.paused) togglePlay(); return; }
  if (a === "aiedit") {                 // the AI editor on this clip: its plan replaces the music, zooms and sounds
    if (E.aiBusy) return;
    const safe0 = E.safe; if (!E.safe) E.safe = safePick();
    $e('[data-ed="safe"]')?.setAttribute("aria-pressed", "true");
    E.aiBusy = true; drawStage();
    const t0 = Date.now(), hands = aiHands();
    aiLog.open();
    const safeOff = () => setTimeout(() => { if (!safe0 && E.safe) { E.safe = null; drawStage(); $e('[data-ed="safe"]')?.setAttribute("aria-pressed", "false"); } }, 4200);
    const pop = sel => { const el = $e(sel); if (el) { el.classList.remove("ed-popin"); void el.offsetWidth; el.classList.add("ed-popin"); } };
    let got = null;
    try {
      const req = api(`/api/jobs/${E.jid}/clips/${E.cid}/autoedit`, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({start: E.start, end: E.end, look: E.look})}).then(r => (got = r));
      const thinking = aiThinking(() => got);
      const r = await req; await thinking;
      await aiWait(Math.max(0, 2200 - (Date.now() - t0)));
      histPush?.();
      E.zSel = -1; E.sfxSel = -1; E.lookTouched = true; E.picKey = "";
      const zs = r.zooms || [], fx = r.sfx || [], total = 2 + zs.length + fx.length + 2;
      let n = 0; const pc = () => 50 + (++n) / total * 50;
      E.look.zooms = []; E.look.sfx = [];
      // the music first: its bar grows across its row
      if (r.music) {
        E.look.music = r.music; drawTimeline(); pop(".ed-lane.music .ed-mbar");
        const song = (E.music || []).find(t => t.id === r.music.id);
        aiLog.add("music", `${song ? song.name : "A music bed"} under the voice at ${r.music.vol}%, rising to ${r.music.peak}% at the end`, pc());
        await aiWait(650);
      }
      // each zoom: on the timeline, the playhead there, the preview zooming in
      for (const z of zs.sort((p, q) => p.a - q.a)) {
        E.look.zooms.push(z); E.zKey = ""; drawTimeline(); pop(`.ed-zbar[data-zb="${E.look.zooms.length - 1}"]`);
        showAt(Math.min(z.b, z.a + 0.5)); paintOverlay();
        aiLog.add("zoom", `${z.s.toFixed(1)}× punch-in at ${ts(z.a - E.start)}${z.react ? " with a reaction face" : ""}`, pc());
        await aiWait(520);
      }
      // each sound on its beat
      for (const x of fx.sort((p, q) => p.t - q.t)) {
        E.look.sfx.push(x); drawTimeline(); pop(`.ed-sfxbar[data-sb="${E.look.sfx.length - 1}"]`);
        aiLog.add("sound", `${sfxOf(x.id)?.name || "Sound effect"} at ${ts(x.t - E.start)}`, pc());
        await aiWait(320);
      }
      const tidy = aiTidy();                // the clean-up: dead air trimmed, fillers and long pauses cut
      drawTimeline();
      aiLog.add("cut", tidy.cuts || tidy.trimmed > 0.3 ? [tidy.cuts ? `Cut ${tidy.cuts} pause${tidy.cuts > 1 ? "s" : ""}` : "", tidy.trimmed > 0.3 ? `trimmed ${tidy.trimmed.toFixed(1)} s of dead air` : ""].filter(Boolean).join(", ") : "No dead air or long pauses to cut", pc());
      await aiWait(450);
      const safe = aiSafe();                // the hook and captions where the app won't cover them
      E.lastKey = ""; paintOverlay();
      aiLog.add("safe", safe.moved.length ? `Moved the ${safe.moved.join(" and ")} inside ${safe.name}${safe.name.endsWith("s") ? "'" : "'s"} safe area` : `Hook and captions already inside ${safe.name}${safe.name.endsWith("s") ? "'" : "'s"} safe area`, pc());
      E.zKey = ""; drawPanel(); drawTimeline(); paintOverlay(); after("p"); showAt(E.start);
      const nz = E.look.zooms.length, ns = E.look.sfx.length, song = (E.music || []).find(t => t.id === E.look.music?.id);
      hands.deliver({Music: song ? `Added ${song.name}` : "", Zooms: nz ? `${nz} zoom${nz > 1 ? "s" : ""}` : "", Sounds: ns ? `${ns} sound${ns > 1 ? "s" : ""}` : "",
        Cuts: tidy.cuts ? `Cut ${tidy.cuts} pause${tidy.cuts > 1 ? "s" : ""}` : "", Timing: tidy.trimmed > 0.3 ? `Trimmed ${tidy.trimmed.toFixed(1)} s` : "",
        Captions: "Synced", Transcript: "Checked", Review: "Ready",
        "Safe zones": safe.moved.length ? `Moved the ${safe.moved.join(" and ")} in` : `All inside ${safe.name.split(" ")[0]}'s safe area`});
      safeOff();
      aiLog.done(`${[song ? "music" : "", nz ? `${nz} zoom${nz > 1 ? "s" : ""}` : "", ns ? `${ns} sound${ns > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || "Edit"} added in ${((Date.now() - t0) / 1000).toFixed(1)} s. Change anything you like.`);
    } catch (er) { hands.stop(); aiLog.close(); toast(er.message, "bad"); safeOff(); }
    E.aiBusy = false; drawStage(); return;
  }
  if (a === "ailogclose") return aiLog.close();
  if (a === "splitshare") { E.look.split = {...rawSplit(), share: +d.v}; E.lookTouched = true; E.lastKey = ""; paintOverlay(); drawPanel(); return after(""); }
  if (a === "safe") { E.safe = E.safe ? null : (() => { try { return localStorage.getItem("ed_safe") || "instagram"; } catch { return "instagram"; } })(); E.lastKey = ""; $e('[data-ed="safe"]')?.setAttribute("aria-pressed", String(!!E.safe)); return drawStage(); }
  if (a === "safeset") { E.safe = d.v; try { localStorage.setItem("ed_safe", d.v); } catch {} return drawStage(); }
  if (a === "atab") { E.atab = d.t; return drawPanel(); }
  if (a === "shotadd") return shotAdd();
  if (a === "shotdel") {
    e.stopPropagation(); if (!hasShots()) return;
    E.shots.splice(+d.v, 1); if (E.shots.length < 2) { const [x] = E.shots; E.shots = []; if (x) { E.start = x[0]; E.end = x[1]; } } else fitShots();
    E.shotSel = -1; drawTimeline(); if (E.tab === "trim") drawPanel(); after("pt"); return;
  }
  if (a === "shotgo") { E.shotSel = +d.v; seek(E.shots[+d.v][0]); drawTimeline(); return drawPanel(); }
  if (a === "musfeel") { E.look.music = {...musicOf(), ...MUS_FEEL_SET[d.v]}; E.lookTouched = true; drawPanel(); return after(""); }
  if (a === "muslib") { E.musLib = !E.musLib; return drawPanel(); }
  if (a === "sfxgrp") { E.sfxGrp = d.v; return drawPanel(); }
  if (a === "sfxtry") { e.stopPropagation(); return sfxTry(d.v); }
  if (a === "sfxadd") {
    const L = E.look.sfx || [], t = Math.round(Math.max(E.start, Math.min(E.end - 0.1, nowT())) * 100) / 100;
    if (L.length >= 60) return toast("Up to 60 sounds on one clip.", "bad");
    L.push({id: d.v, t, vol: 100}); L.sort((p, q) => p.t - q.t); E.look.sfx = L; E.sfxSel = L.findIndex(x => x.t === t && x.id === d.v);
    E.lookTouched = true; sfxTry(d.v); drawPanel(); drawTimeline(); after(""); return toast(`${sfxOf(d.v)?.name || "Sound"} at ${ts(t - E.start)}`, "ok");
  }
  if (a === "sfxsel") { E.sfxSel = +d.v; E.atab = "sfx"; if (E.tab !== "audio") E.tab = "audio"; drawPanel(); drawTimeline(); const x = (E.look.sfx || [])[E.sfxSel]; if (x) showAt(x.t); return; }
  if (a === "sfxdel") { const L = E.look.sfx || []; L.splice(+d.v, 1); E.look.sfx = L; E.sfxSel = -1; E.lookTouched = true; drawPanel(); drawTimeline(); return after(""); }
  if (a === "mustry") {                 // hear a library song without choosing it
    e.stopPropagation();
    if (E.musTry === d.v) { E.musTryEl?.pause(); E.musTry = null; return drawPanel(); }
    try { E.musTryEl?.pause(); E.musTryEl = new Audio(`/api/music/${d.v}`); E.musTryEl.volume = 0.6; E.musTryEl.play().catch(() => {}); E.musTry = d.v;
      E.musTryEl.onended = () => { E.musTry = null; if (E.tab === "audio") drawPanel(); }; } catch {}
    return drawPanel();
  }
  if (a === "facepick") {              // a reaction face for the chosen zoom ("" takes it away)
    const z = (E.look.zooms || [])[E.zSel]; if (!z) return;
    z.react = d.v; E.lookTouched = true; E.picKey = ""; drawPanel(); paintOverlay(); after("");
    const f = (E.media || []).find(m => m.id === d.v); if (f?.sfx) sfxTry(f.sfx);
    return;
  }
  if (a === "musauto") { E.look.music = {...musicOf(), vol: 18, peak: 95, rise: 3, duck: true}; E.lookTouched = true; drawPanel(); return after(""); }
  if (a === "musdrop") { const m = musicOf(); E.look.music = {...m, peak_at: m.peak_at == null ? Math.max(0, (m.at || 0) + (E.end - E.start)) : null}; E.lookTouched = true; drawPanel(); return after(""); }
  if (a === "hookbanner" || a === "hookcase") { E.look[a === "hookbanner" ? "hook_banner" : "hook_case"] = d.v; E.lookTouched = true; drawPanel(); after(""); return showHook(); }
  if (a === "emjopen") {                   // the emoji popover: a click anywhere else closes it
    E.emjOpen = !E.emjOpen; drawPanel();
    if (E.emjOpen) setTimeout(() => document.addEventListener("pointerdown", function off(ev) {
      if (ev.target.closest?.(".ed-emj, .ed-emjbtn")) return;
      document.removeEventListener("pointerdown", off, true);
      if (E.emjOpen) { E.emjOpen = false; if (E.tab === "text") drawPanel(); }
    }, true));
    return;
  }
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
  if (a === "cardsw") { E.look.card = {...cardOf(), [d.k]: e.target.checked}; E.lookTouched = true; E.fgKey = ""; drawPanel(); return after("p"); }
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
  if (a === "exdlg") { if (E.exOpen) { E.exOpen = false; exDoneClear(); return drawEx(); } E.ex ||= {preset: "shorts", fmt: "mp4", fps: 60, q: "1080", speed: 1}; if (!EX_RES.some(r => r[0] === E.ex.q) && E.ex.fmt !== "gif") E.ex.q = "1080"; E.exOpen = true; return drawEx(); }
  if (a === "exclose") { E.exOpen = false; exDoneClear(); return drawEx(); }
  if (a === "exagain") return exSave();
  if (a === "exfolder") return exSave(true);         // pick the main folder again; each creator's folder is made inside it
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
  if (e.target.matches?.('[data-look="sfx_vol"]')) {     // the chosen sound's loudness
    const x = (E.look.sfx || [])[E.sfxSel]; if (!x) return;
    x.vol = +e.target.value; e.target.parentElement.style.setProperty("--p", pctOf(x.vol, 0, 200));
    const o = e.target.parentElement.querySelector("output"); if (o) o.textContent = x.vol + "%";
    E.lookTouched = true; return after("");
  }
  if (e.target.matches?.("[data-stroke]")) {        // the border's width: seen at once; the colour row shows with a border
    const v = +e.target.value, had = (E.look.stroke || 0) > 0;
    E.look.stroke = v; E.lookTouched = true;
    e.target.parentElement.style.setProperty("--p", pctOf(v, 0, 24));
    const o = e.target.parentElement.querySelector("output"); if (o) o.textContent = v || "None";
    paintStroke(); if (had !== v > 0) drawPanel(); return after("");
  }
  if (e.target.matches?.("[data-strokecol]")) {
    E.look.stroke_color = e.target.value.toUpperCase(); e.target.parentElement.style.setProperty("--c", e.target.value);
    E.lookTouched = true; paintStroke(); return after("");
  }
  if (e.target.matches?.("[data-popc]")) {          // the card's edge or fill colour, any colour
    const sp = rawSplit(), k = e.target.dataset.popc, v = e.target.value.toUpperCase();
    E.look.split = {...sp, [k]: v}; e.target.parentElement.style.setProperty("--c", e.target.value);
    e.target.closest(".ed-popft")?.querySelector("i")?.style.setProperty(k === "pop_c1" ? "--c1" : "--c2", e.target.value);
    E.lookTouched = true; placeSplit(); return after("");
  }
  if (e.target.matches?.("[data-pipcol]")) {        // the face box's border colour, any colour
    E.look.split = {...rawSplit(), pip_color: e.target.value.toUpperCase()}; e.target.parentElement.style.setProperty("--c", e.target.value);
    E.lookTouched = true; placeSplit(); return after("");
  }
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
    redrawScore(); return after("");
  }
  if (el.dataset.mus) {                   // music switches: duck, loop, fade
    E.look.music = {...musicOf(), [el.dataset.mus]: el.checked}; E.lookTouched = true;
    if (el.dataset.mus === "rise_on") drawPanel();
    return after("");
  }
  if (k === "mus_vol" || k === "mus_at") {  // music volume and where in the song it starts
    const v = +el.value, o = el.parentElement.querySelector("output");
    el.closest(".ed-sl")?.style.setProperty("--p", pctOf(v, +el.min, +el.max));
    E.look.music = {...musicOf(), [k === "mus_vol" ? "vol" : "at"]: v}; E.lookTouched = true;
    if (o) o.textContent = k === "mus_vol" ? v + "%" : mmss(v);
    redrawScore(); return after("");
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
    if (k === "brand_head_pct") { E.look.brand_head_pct = +el.value; const o = sl?.querySelector("output"); if (o) o.textContent = el.value + "%"; return wmRefresh(); }
    if (k === "brand_tag_on") { E.look.brand_tag_on = el.checked; drawPanel(); return wmRefresh(); }
    if (k === "pip_size" || k === "pip_radius" || k === "pip_border") {
      const lim = {pip_size: [22, 50], pip_radius: [0, 30], pip_border: [0, 16]}[k], v = +el.value;
      const had = (rawSplit().pip_border ?? 6) > 0;
      E.look.split = {...rawSplit(), [k]: v}; const o = el.parentElement.querySelector("output");
      if (o) o.textContent = k === "pip_size" ? v + "%" : k === "pip_border" && !v ? "None" : v;
      el.parentElement.style.setProperty("--p", pctOf(v, lim[0], lim[1])); E.lookTouched = true; placeSplit(); paintOverlay();
      if (k === "pip_border" && had !== v > 0) drawPanel();            // the colour row shows only with a border
      return after("");
    }
    if (k === "pop_size" || k === "pop_radius" || k === "pop_border" || k === "pop_out") {
      const lim = {pop_size: [40, 90], pop_radius: [0, 30], pop_border: [0, 20], pop_out: [0, 45]}[k], v = +el.value;
      const had = (rawSplit().pop_border ?? 8) > 0;
      E.look.split = {...rawSplit(), [k]: v}; const o = el.parentElement.querySelector("output");
      if (o) o.textContent = k === "pop_size" || k === "pop_out" ? (v || k === "pop_size" ? v + "%" : "None") : k === "pop_border" && !v ? "None" : v;
      el.parentElement.style.setProperty("--p", pctOf(v, lim[0], lim[1])); E.lookTouched = true; E.lastKey = ""; placeSplit(); paintOverlay();
      if (k === "pop_border" && had !== v > 0) drawPanel();            // the colours show only with a border
      return after("");
    }
    if (k === "grid_share") {               // the face grid's top row, the rest goes to the people below
      E.look.split = {...rawSplit(), grid_share: +el.value}; const o = el.parentElement.querySelector("output"); if (o) o.textContent = el.value + "%";
      el.parentElement.style.setProperty("--p", pctOf(+el.value, 20, 80)); E.lookTouched = true; E.lastKey = ""; placeSplit(); paintOverlay(); after(""); return;
    }
    if (k === "split_share") {              // how much of the frame the stream takes; the face cam gets the rest
      E.look.split = {...rawSplit(), share: +el.value}; const o = el.parentElement.querySelector("output"); if (o) o.textContent = el.value + "%";
      E.lastKey = ""; placeSplit(); after(""); return;
    }
    if (k === "font" || k === "hook_font") E.look[k] = el.value;
    else if (COLOUR_KEYS.test(k)) { E.look[k] = el.value.toUpperCase(); el.parentElement.style.background = el.value; }
    else if (k === "hook") { E.look.hook = el.checked; const h = $e("#edHook"); if (h) { h.disabled = !el.checked; h.parentElement.classList.toggle("off", !el.checked); } return after("t"); }
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
  if (el.id === "edHook") { E.hook = el.value.replace(/\n/g, " "); const n = $e("#edHookN"); if (n) { n.textContent = E.hook.length; n.parentElement.classList.toggle("near", E.hook.length > 50); }
    const hc = $e(".ed-hchip span"); if (hc) hc.textContent = E.hook; return after(""); }
  if (el.id === "edTitle") { E.title = el.value; const n = $e("#edTitleN"); if (n) n.textContent = `${el.value.length}/100`; return drawClipDlg(); }
  if (el.id === "edDesc") { E.description = el.value; const n = $e("#edDescN"); if (n) n.textContent = `${el.value.length}/2000`; return drawClipDlg(); }
});
dlg.addEventListener("change", e => {
  if (e.target.matches?.('[data-ed="sfxhook"]')) {         // a whoosh as the clip starts
    const w = (E.sfxLib?.items || []).find(x => x.name === "Whoosh Fast")?.id; if (!w) return;
    const L = (E.look.sfx || []).filter(x => !(x.id === w && Math.abs(x.t - E.start) < 0.3));
    if (e.target.checked) L.push({id: w, t: Math.round(E.start * 100) / 100, vol: 90});
    L.sort((p, q) => p.t - q.t); E.look.sfx = L; E.lookTouched = true; drawPanel(); drawTimeline(); return after("");
  }
  if (e.target.matches?.('[data-ed="sfxzoom"]')) {        // a pop on every zoom: added (or taken away) in one go
    const pop = (E.sfxLib?.items || []).find(x => x.name === "Zoom Pop")?.id; if (!pop) return;
    const L = (E.look.sfx || []).filter(x => !(x.id === pop && (E.look.zooms || []).some(z => Math.abs(x.t - z.a) < 0.05)));
    if (e.target.checked) for (const z of E.look.zooms || []) L.push({id: pop, t: z.a, vol: 100});
    L.sort((p, q) => p.t - q.t); E.look.sfx = L; E.lookTouched = true; drawPanel(); drawTimeline(); return after("");
  }
  if (e.target.matches?.("[data-pacc]")) {          // an account tile ticked: remember it, and wake the post buttons
    const set = E.postPick || (E.postPick = new Set());
    e.target.checked ? set.add(e.target.value) : set.delete(e.target.value);
    return drawPanel();
  }
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
  const sh = e.target.closest(".ed-hd")?.dataset.sh, body = !sh && e.target.closest(".ed-shot");
  if ((sh || body) && !e.target.closest("[data-ed]")) {                  // a shot: its end, or the whole shot
    e.preventDefault(); track.setPointerCapture(e.pointerId);
    const i = sh ? +sh.split(":")[0] : +body.dataset.shot, side = sh ? sh.split(":")[1] : "move", x0 = e.clientX, s0 = [...E.shots[i]];
    const lo = i ? E.shots[i - 1][1] + 0.2 : E.min, hi = i < E.shots.length - 1 ? E.shots[i + 1][0] - 0.2 : E.max;
    E.shotSel = i; let moved = false;
    const move = ev => {
      const dt = at(ev.clientX) - at(x0); if (Math.abs(ev.clientX - x0) > 3) moved = true; if (!moved) return;
      const r2 = v => Math.round(v * 20) / 20, sh2 = E.shots[i];
      if (side === "a") sh2[0] = r2(Math.max(lo, Math.min(sh2[1] - 0.5, s0[0] + dt)));
      else if (side === "b") sh2[1] = r2(Math.min(hi, Math.max(sh2[0] + 0.5, s0[1] + dt)));
      else { const len = s0[1] - s0[0]; sh2[0] = r2(Math.max(lo, Math.min(hi - len, s0[0] + dt))); sh2[1] = r2(sh2[0] + len); }
      const w = track.querySelector(`.ed-shot[data-shot="${i}"]`); if (w) { w.style.left = pct(sh2[0]) + "%"; w.style.width = pct(sh2[1]) - pct(sh2[0]) + "%"; }
      seek(side === "b" ? sh2[1] - 0.05 : sh2[0]);
    };
    const up = () => { track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", up);
      if (!moved) { seek(E.shots[i][0]); drawTimeline(); return; }
      fitShots(); drawTimeline(); if (E.tab === "trim") drawPanel(); after("pt"); };
    track.addEventListener("pointermove", move); track.addEventListener("pointerup", up);
    return;
  }
  const h = e.target.closest(".ed-hd")?.dataset.h;
  if (!h) { if (!e.target.closest("[data-ed]")) { if (E.view === "rendered") { E.view = "live"; drawStage(); } seek(at(e.clientX)); } return; }
  e.preventDefault(); track.setPointerCapture(e.pointerId);
  const move = ev => { setTrim(h, at(ev.clientX)); const w = $e(".ed-win"), sl = $e(".ed-shade.l"), sr = $e(".ed-shade.r");
    w.style.left = pct(E.start) + "%"; w.style.width = pct(E.end) - pct(E.start) + "%"; sl.style.width = pct(E.start) + "%"; sr.style.left = pct(E.end) + "%";
    seek(h === "start" ? E.start : E.end - 0.05); };
  const up = () => { track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", up); after("pt"); };
  track.addEventListener("pointermove", move); track.addEventListener("pointerup", up);
});
dlg.addEventListener("dblclick", e => {         // double-click the film strip outside the shots: a new shot there
  const lane = e.target.closest(".ed-lane.film"); if (!lane || e.target.closest(".ed-shot, .ed-win, [data-ed]")) return;
  const r = $e("#edTrack").getBoundingClientRect();
  shotAdd(E.min + (e.clientX - r.left) / r.width * (E.max - E.min));
});
// a new shot of about five seconds where asked (or at the playhead), fitted into the free room there
function shotAdd(t) {
  if (!hasShots()) E.shots = [[E.start, E.end]];
  if (E.shots.length >= 20) return toast("Up to 20 shots in one clip.", "bad");
  t = Math.max(E.min, Math.min(E.max - 0.5, t ?? nowT()));
  if (E.shots.some(([a, b]) => t >= a && t <= b)) {     // inside a shot already: the next free room after it
    const s0 = E.shots.find(([a, b]) => t >= a && t <= b); t = s0[1] + 0.5;
  }
  const prev = [...E.shots].reverse().find(([, b]) => b <= t), next = E.shots.find(([a]) => a >= t);
  const lo = prev ? prev[1] + 0.2 : E.min, hi = next ? next[0] - 0.2 : E.max;
  if (hi - lo < 1) return toast("No room there. Move a shot first.", "bad");
  const a = Math.max(lo, Math.min(t, hi - 1)), b = Math.min(hi, a + 5);
  const kept = keptLen() + (b - a);
  if (kept > 180) return toast("Together the shots would be over 3 minutes. Shorten one first.", "bad");
  E.shots.push([Math.round(a * 20) / 20, Math.round(b * 20) / 20]); fitShots();
  E.shotSel = E.shots.findIndex(s => s[0] === Math.round(a * 20) / 20);
  drawTimeline(); if (E.tab === "trim") drawPanel(); seek(a); after("pt");
  toast(`Shot ${E.shotSel + 1} added. Drag its ends to choose the moment.`, "ok");
}
dlg.addEventListener("wheel", e => {           // ctrl or pinch on the timeline zooms it
  if (!e.ctrlKey || !e.target.closest("#edScroll")) return;
  e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1);
}, {passive: false});
dlg.addEventListener("toggle", e => {
  const m = e.target.closest?.("[data-more]"); if (!m) return;
  if (m.dataset.more === "mus") E.musMore = m.open; else E.sfxMore = m.open;
}, true);
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
    if (E.emjOpen && E.tab === "text") { E.emjOpen = false; drawPanel(); } else if (E.keysOpen) { E.keysOpen = false; drawKeys(); } else if (E.tplOpen) { E.tplOpen = false; drawTpl(); }
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
