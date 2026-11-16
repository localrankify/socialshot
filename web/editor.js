/* The clip editor: a full-screen editor for one clip, laid out like a video editor.
   Left: the transcript (click any word to jump there) and the subtitles, one line per row, to fix.
   Middle: a live preview of the original footage with the captions and the hook drawn on top, so every change
   shows at once. Right: the tools (subtitle style, the hook text, trim, post).
   Bottom: a timeline with zoom and speed, and tracks for the hook, the captions and the video.
   "Save and render" sends the changes to the server, which makes the clip again with them. */
(() => {
const OUT_W = 1080, OUT_H = 1920;
const E = {};            // everything about the clip being edited
let raf = 0;

const $e = s => $("#clipdlg").querySelector(s);
const $$e = s => [...$("#clipdlg").querySelectorAll(s)];
const clipNow = () => jobOf(E.jid)?.clips.find(c => c.id === E.cid);
const clone = x => JSON.parse(JSON.stringify(x));
const ts = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };
const FONTS = () => S.status.fonts || {};
const PRESETS = () => S.status.presets || {};
const SWATCHES = ["#FFFFFF", "#FFE500", "#FFF000", "#22E06B", "#7CC8FF", "#8B7CF6", "#FF4FD8", "#FF3C3C", "#FF8B33", "#141416"];
const HOOK_DEFAULT = {hook_font: "Mazzard H", hook_size: 88, hook_y: null, hook_dur: 0,    // the heading at the top, as the server draws it (0 s = the whole clip)
  hook_box: "#FFFFFF", hook_ink: "#14100E", hook_op: 100, hook_round: 20, hook_sp: 0,   // its box and text colours, how solid the box is, corners, letter gaps
  sp: 0, wgap: 0, cap_box: "#000000", cap_op: 0, cap_round: 18,             // the captions' letter and word gaps, and a box behind each line (0 = none)
  effect: "none", fade_in: "none", fade_out: "none",                         // and the effects: a colour look, how it starts and ends
  volume: 100,                                                               // and the sound, in percent of its normal level
  brand_on: false, brand_logo: true, brand_text: "", brand_pos: "tr",       // and the person's brand: logo and name, where,
  brand_anim: "float", brand_size: 84, brand_op: 90};                        // how it moves, how big, how solid
const BRAND_KEYS = ["brand_on", "brand_logo", "brand_text", "brand_pos", "brand_anim", "brand_size", "brand_op"];
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
const TEXT_IC = svg('<path d="M6 5h12M12 5v14M9 19h6"/>');
const FX_IC = svg('<path d="M15 4l1.5 3.5L20 9l-3.5 1.5L15 14l-1.5-3.5L10 9l3.5-1.5zM6 13l1 2.5L9.5 16.5L7 17.5L6 20l-1-2.5L2.5 16.5L5 15.5z"/>');
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
const keepOwn = L => ({...hookOf(L), effect: L.effect || "none", fade_in: L.fade_in || "none", fade_out: L.fade_out || "none",
  volume: L.volume ?? 100, ...Object.fromEntries(BRAND_KEYS.map(k => [k, L[k] ?? HOOK_DEFAULT[k]]))});   // what a new caption style must not undo

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
function geo(layout, sw, sh) {
  if (sh >= sw && layout !== "crop") layout = "crop";
  const fg = layout === "blur" ? Math.min(OUT_H, Math.round(OUT_W * sh / sw / 2) * 2) : layout === "zoom" ? 1000 : OUT_H;
  const top = (OUT_H - fg) / 2;
  if (layout === "crop") return {layout, fg, hook: 300, cap: 1380};
  return {layout, fg, hook: Math.max(230, top - 190), cap: Math.min(1640, top + fg + 180)};
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
const hookOf = L => ({hook_font: L.hook_font || "Mazzard H", hook_size: L.hook_size || 88, hook_y: L.hook_y ?? null, hook_dur: +L.hook_dur || 0,
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
const fontCss = key => { const f = FONTS()[key] || {google: "Poppins", weight: 800}; return {family: `'${f.google}'`, weight: f.weight}; };
function loadFonts() {
  if (document.getElementById("edFonts")) return;
  const fams = Object.values(FONTS()).filter(f => !f.local).map(f => `family=${f.google.replace(/ /g, "+")}:wght@${f.weight}`).join("&");   // bundled fonts are already on the page
  const l = document.createElement("link");
  l.id = "edFonts"; l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
  document.head.append(l);
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
  Object.assign(E, {jid, cid, tab: "style", txTab: "transcript", view: c.status === "done" ? "live" : "rendered", words: [], auto: [], edited: false,
    start: c.start, end: c.end, hook: c.hook || "", title: c.title || "", description: c.description || "", layout: c.layout || "blur",
    look: c.look ? {...HOOK_DEFAULT, ...clone(c.look)} : lookFromStyle(c.style), lookTouched: !!c.look, off: c.src_offset || 0, min: c.src_offset || 0,
    max: c.src_end || j.duration || c.end, version: c.version || 0, waiting: 0, brand: [], sw: j.width || 1280, sh: j.height || 720,
    cuts: clone(c.cuts || []), cl: {fill: true, pause: true, min: 0.8}, cleanOpen: false, hideCut: false,
    zoom: 1, rate: 1, q: "", tlHidden: (() => { try { return !!localStorage.getItem("ed_tl_hidden"); } catch { return false; } })()});
  loadFonts();
  const dlg = $("#clipdlg");
  dlg.classList.add("ed-on");
  dlg.innerHTML = `<div class="ed"><div class="ed-loading">Opening the editor…</div></div>`;
  if (!dlg.open) dlg.showModal();
  try {
    const [cap, brand] = await Promise.all([api(`/api/jobs/${jid}/clips/${cid}/captions`), api("/api/brand").catch(() => ({styles: []}))]);
    if (E.cid !== cid) return;
    Object.assign(E, {words: clone(cap.words), auto: cap.edited ? [] : clone(cap.words), edited: cap.edited,
      off: cap.offset, min: cap.min, max: cap.max, brand: brand.styles || [], logoV: brand.logo || 0, chat: cap.chat || null});
  } catch (e) { toast(e.message, "bad"); }
  E.saved = snap(); E.lookKey = JSON.stringify(E.look);
  // A hook made before hooks were written in normal case: offered in normal case, as a change to save
  if (sentenceCase(E.hook) !== E.hook) E.hook = sentenceCase(E.hook);
  draw();
};
async function edClose() {
  if (dirty() && !await ask("Leave without saving?", "Your changes to this clip haven't been saved.", "Leave", true)) return;
  $("#clipdlg").close();
}
window.drawClipDlg = function () {          // called on every refresh of the page: only the clip's status changes here
  if (!E.cid || !$("#clipdlg").open) return;
  const c = clipNow();
  if (!c) return $("#clipdlg").close();
  const busy = c.status === "queued" || c.status === "rendering";
  if (E.waiting && c.status === "done" && (c.version || 0) > E.version) {
    E.waiting = 0; E.version = c.version; E.view = "rendered"; toast("Your clip is ready", "ok"); drawStage();
  } else if (E.waiting && c.status === "error") { E.waiting = 0; toast(c.error || "Couldn't make this clip.", "bad"); drawStage(); }
  const st = $e("#edState");
  if (st) st.innerHTML = busy ? `<span class="ed-pill busy"><i></i>${c.status === "rendering" ? "Rendering" : "Waiting its turn"}</span>`
    : dirty() ? `<span class="ed-pill">Unsaved changes</span>`
    : c.unrendered ? `<span class="ed-pill draft" title="Your changes are kept. Press Save and render to put them in the video.">${ic("check")}Saved, not rendered yet</span>`
    : `<span class="ed-pill ok">${ic("check")}Saved</span>`;
  const sv = $e("#edSave"); if (sv) sv.disabled = busy;
  const kp = $e("#edKeep"); if (kp) kp.disabled = busy || !dirty();
  const mk = $e(".ed-making"); if (mk) mk.hidden = !busy;
};

/* ---------- the whole editor */
// the tools on the left rail open their settings in the panel on the right; the transcript is always under the preview
const BRAND_IC = svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.5"/>');
const TOOLS = () => [["style", "Captions", ic("cc")], ["text", "Text", TEXT_IC], ["brand", "Brand", BRAND_IC], ["fx", "Effects", FX_IC],
  ["audio", "Audio", SOUND(true)], ["trim", "Trim", ic("scissors")], ["post", "Post", ic("send")]];
const toolOf = tab => tab;
function draw() {
  const c = clipNow(); if (!c) return;
  $("#clipdlg").innerHTML = `<div class="ed">
    <header class="ed-top">
      <div class="ed-left"><button class="ed-ib" data-ed="close" aria-label="Close editor">${ic("x")}</button>
        <button class="ed-ib" data-ed="tour" title="What's new in the editor" aria-label="What's new in the editor">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 17v.01M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4"/>')}</button><span id="edState"></span></div>
      <div class="ed-name"><b title="${esc(E.title || E.hook || "")}">${esc(E.title || E.hook || "Untitled clip")}</b></div>
      <div class="ed-acts">
        <div class="ed-menu"><button class="ed-btn" data-ed="exportmenu" aria-haspopup="menu">${ic("down")}Export</button>
          <div class="ed-pop" id="edExport" hidden role="menu">
            ${c.status === "done" ? `<a role="menuitem" href="/media/${E.jid}/${esc(c.file)}?download=1">${ic("film")}<span><b>Video (MP4)</b><small>The last saved version</small></span></a>` : ""}
            <button role="menuitem" data-ed="srt">${ic("down")}<span><b>Captions (.srt)</b><small>For any other editor</small></span></button>
            <button role="menuitem" data-ed="importsrt">${ic("up")}<span><b>Import captions (.srt)</b><small>Replace the caption text</small></span></button>
          </div></div>
        <button class="ed-btn" id="edKeep" data-ed="keep" title="Keep your changes without making the video again">${svg('<path d="M6 4h10l4 4v12H4V4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>')}Save</button>
        <button class="ed-btn primary" id="edSave" data-ed="save">${ic("check")}Save and render</button>
      </div>
    </header>
    <div class="ed-body">
      <nav class="ed-rail" role="tablist" aria-label="Editor tools">${TOOLS().map(([k, l, i]) =>
        `<button role="tab" aria-selected="${toolOf(E.tab) === k}" data-ed="tab" data-t="${k}">${i}<span>${l}</span></button>`).join("")}</nav>
      <aside class="ed-panel" id="edPanel"></aside>
      <section class="ed-center"><section class="ed-stage" id="edStage"></section></section>
      <aside class="ed-txcard" id="edTxCard"></aside>
    </div>
    <footer class="ed-tl" id="edTl"></footer>
    <input type="file" id="edSrtFile" accept=".srt,text/plain" hidden>
  </div>`;
  drawPanel(); drawStage(); drawTimeline(); drawClipDlg();
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
  const f = findCuts(), cutS = f.all.reduce((n, [a, b]) => n + (b - a), 0);
  const TX_IC = svg('<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>');
  box.innerHTML = `<div class="ed-txhead">
      <div class="ed-hero"><span class="ed-hero-ic">${TX_IC}</span><div><h3>${tr ? "Transcript" : "Subtitles"}</h3>
        <p>${nWords} words · ${ts(keptLen())}${E.cuts?.length ? ` · ${ts(cutLen())} cut` : ""}${E.edited ? " · edited" : ""}</p></div></div>
      <div class="ed-ptabs pill wide" role="tablist"><button role="tab" data-ed="ptab" data-t="transcript" aria-selected="${tr}">Transcript</button>
        <button role="tab" data-ed="ptab" data-t="subs" aria-selected="${!tr}">Edit subtitles</button></div>
      <div class="ed-ptools">
        <label class="ed-search">${ic("search")}<input id="edQ" value="${esc(E.q)}" placeholder="Search the words" aria-label="Search the words"><small id="edHits"></small></label>
        <button class="ed-ib ed-tip ${E.hideCut ? "on" : ""}" data-ed="hidecut" data-tip="${E.hideCut ? "Show what was cut" : "Hide what was cut"}" aria-label="${E.hideCut ? "Show what was cut" : "Hide what was cut"}" aria-pressed="${E.hideCut}">${svg('<path d="M4 6h16l-6 7v5l-4 2v-7z"/>')}</button>
        <button class="ed-ib ed-tip" data-ed="copytx" data-tip="Copy the text" aria-label="Copy the text">${ic("copy")}</button>
        <button class="ed-ib ed-tip" data-ed="dlscript" data-tip="Download the script" aria-label="Download the script">${ic("down")}</button>
        ${E.edited ? `<button class="ed-ib ed-tip" data-ed="resetcaps" data-tip="Use the original words" aria-label="Use the original words">${svg('<path d="M9 14l-4 -4l4 -4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/>')}</button>` : ""}
      </div>
      <div class="ed-cleancard ${E.cleanOpen ? "open" : ""}">
        <button class="ed-cleanhd" data-ed="cleanup" aria-expanded="${E.cleanOpen}">
          <span class="ed-cleanic">${svg('<path d="M15 4l1.5 3.5L20 9l-3.5 1.5L15 14l-1.5-3.5L10 9l3.5-1.5zM6 14l1 2.5L9.5 17.5L7 18.5L6 21l-1-2.5L2.5 17.5L5 16.5z"/>')}</span>
          <span class="ed-cleant"><b>Speech cleanup</b><small>${E.cuts?.length ? `${E.cuts.length} cut${E.cuts.length === 1 ? "" : "s"} · ${ts(cutLen())} taken out` : f.all.length ? `${f.all.length} to take out · ${cutS.toFixed(1)} s` : "Nothing to take out"}</small></span>
          ${svg('<path d="M6 9l6 6l6 -6"/>').replace("<svg", '<svg class="ed-cleancar"')}</button>
        ${E.cleanOpen ? `<div class="ed-cleanbox">
          <label class="ed-ck"><input type="checkbox" data-cl="fill" ${E.cl.fill ? "checked" : ""}><span>Filler words <small>um, uh, hmm</small></span><b>${f.fill.length}</b></label>
          <label class="ed-ck"><input type="checkbox" data-cl="pause" ${E.cl.pause ? "checked" : ""}><span>Pauses over
            <select data-cl="min">${[0.5, 0.8, 1, 1.5, 2].map(v => `<option value="${v}" ${E.cl.min === v ? "selected" : ""}>${v} s</option>`).join("")}</select></span><b>${f.pause.length}</b></label>
          <div class="ed-cleanrow"><span>${f.all.length ? `Takes out ${cutS.toFixed(1)} s` : "Nothing to take out"}</span>
            ${E.cuts?.length ? `<button class="ed-btn" data-ed="cleanundo">Undo all</button>` : ""}
            <button class="ed-btn primary" data-ed="cleanapply" ${f.all.length ? "" : "disabled"}>Cut them</button></div>
        </div>` : ""}
      </div></div>
    <div class="ed-txbody" id="edTxBody">${tr ? `<div class="ed-tx" id="edTx">${transcriptHtml()}</div>`
      : `<div class="ed-lines">${ls.length ? ls.map((g, gi) => {
          const text = g.map(i => E.words[i].w).join(" "), hit = E.q.trim() && text.toLowerCase().includes(E.q.trim().toLowerCase());
          return `<div class="ed-line${hit ? " hit" : ""}" data-g="${gi}"><button class="ed-t" data-ed="seek" data-at="${E.words[g[0]].s}">${ts(E.words[g[0]].s - E.start)}</button>
            <input value="${esc(text)}" data-line="${gi}" aria-label="Subtitle line ${gi + 1}"></div>`; }).join("")
        : `<p class="ed-help">No words were heard in this part of the video.</p>`}</div>`}</div>`;
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
        <p class="ed-help">Heard in the preview right away, and in the video when you save and render. The meter beside the timeline shows the level as it plays.</p></div>`;
  } else if (E.tab === "style") {
    const L = E.look, f = FONTS();
    const tile = (key, look, label, del) => { const fc = fontCss(look.font);
      return `<button class="ed-preset ${look.font === L.font && look.base === L.base && look.active === L.active && look.size === L.size && look.upper === L.upper ? "on" : ""}" data-ed="${del ? "brandpick" : "preset"}" data-k="${esc(key)}">
        <span class="ed-ps"><i style="background-image:url('/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}')"></i>
          <span class="ed-pt" style="font-family:${fc.family};font-weight:${fc.weight};color:${look.base};${look.cap_op > 0
            ? `background:${rgba(look.cap_box || "#000000", look.cap_op)};padding:3px 8px;border-radius:6px;-webkit-text-stroke:0`
            : `-webkit-text-stroke:${look.outline ? Math.max(2, look.outline / 2.4).toFixed(1) : 0}px #000`}">
          ${look.upper ? "CLIP" : "Clip"} <em style="color:${look.active}">${look.upper ? "THIS" : "this"}</em></span></span><b>${esc(label)}</b>
        ${del ? `<i class="ed-x" data-ed="branddel" data-k="${esc(key)}" title="Remove from brand kit">${ic("x")}</i>` : ""}</button>`; };
    const fold = (k, title, note, body) => `<details class="ed-fold" data-fold="${k}" ${E.open?.has(k) ? "open" : ""}><summary>${title}${note ? `<small>${note}</small>` : ""}</summary><div>${body}</div></details>`;
    const st = E.stab || "presets";
    const tabs = `<div class="ed-ptabs pill wide" role="tablist"><button role="tab" data-ed="stab" data-t="presets" aria-selected="${st === "presets"}">${ic("cc")}Styles</button>
      <button role="tab" data-ed="stab" data-t="settings" aria-selected="${st === "settings"}">${svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')}Customize</button></div>`;
    const shead = head("Captions", "How the captions look. Pick a style, then fine-tune it.");
    if (st === "presets") {
      const q = (E.sq || "").trim().toLowerCase();
      const presets = Object.entries(PRESETS()).filter(([, v]) => !q || `${v.label} ${v.font}`.toLowerCase().includes(q));
      const posNow = L.y == null ? "bottom" : L.y < 35 ? "top" : L.y < 65 ? "middle" : "bottom";
      p.innerHTML = shead + tabs + `<label class="ed-search ed-ssearch">${ic("search")}<input id="edSq" value="${esc(E.sq || "")}" placeholder="Search styles and fonts…" aria-label="Search caption styles"></label>
        <div class="ed-presets big">${presets.map(([k, v]) => tile(k, v, v.label)).join("") || `<p class="ed-help">No style matches.</p>`}</div>
        ${E.brand.length ? `<p class="ed-grp">Your brand kit</p><div class="ed-presets big">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>` : ""}
        <div class="ed-quick"><p class="ed-qt">Quick adjust</p>
          <div class="ed-qrow"><span>Font</span><select data-look="font">${Object.keys(f).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div>
          <div class="ed-qrow"><span>Size</span>${slider("Size", "size", 60, 220, 2, L.size, L.size)}</div>
          <div class="ed-qrow"><span>Position</span><div class="ed-seg">${[["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].map(([v, l]) => `<button data-ed="capos" data-v="${v}" aria-pressed="${posNow === v}">${l}</button>`).join("")}</div></div>
          <button class="ed-btn primary ed-applyall" data-ed="applyall">${ic("check")}Apply to all captions</button>
        </div>
        <div class="ed-brandsave"><p class="ed-qt">Save as your brand look</p><p class="ed-help">Keeps the captions and the hook as they are now, to use on any clip.</p>
          <div class="ed-row"><input id="edBrandName" placeholder="Name this look" maxlength="40"><button class="ed-btn" data-ed="brandsave">${ic("plus")}Save</button></div></div>`;
      return;
    }
    p.innerHTML = shead + tabs + `
      ${fold("text", "Font and size", esc(L.font), `
        <label class="ed-f">Font<select data-look="font">${Object.keys(f).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${slider("Size", "size", 60, 220, 2, L.size, L.size)}
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
        ${slider("Height on screen", "y", 8, 92, 1, L.y == null ? Math.round(geo(E.layout, E.sw, E.sh).cap / OUT_H * 100) : L.y, L.y == null ? "Auto" : Math.round(L.y) + "%")}`)}
      ${fold("brand", "Brand kit", `${E.brand.length}/12`, `
        ${E.brand.length ? `<div class="ed-presets">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>`
          : `<p class="ed-help">Save the look you like and use it on every clip.</p>`}
        <div class="ed-row"><input id="edBrandName" placeholder="Name this look" maxlength="40"><button class="ed-btn" data-ed="brandsave">${ic("plus")}Save look</button></div>`)}`;
  } else if (E.tab === "text") {
    const L = E.look, H = hookOf(L), f = FONTS(), autoY = Math.round(geo(E.layout, E.sw, E.sh).hook / OUT_H * 100);
    p.innerHTML = head("Text", "The hook: the big line at the top that makes people stop scrolling.") +
      `<div class="ed-card">
        <div class="ed-h"><b>Show the hook</b><label class="ed-sw2"><input type="checkbox" data-look="hook" ${L.hook ? "checked" : ""}><span></span></label></div>
        <textarea id="edHook" rows="2" maxlength="60" placeholder="The big line at the top" ${L.hook ? "" : "disabled"}>${esc(E.hook)}</textarea>
        <span class="ed-count"><span id="edHookN">${E.hook.length}</span>/60</span>
      </div>
      <div class="ed-card"><b>Style</b>
        <div class="ed-hstyles">${HOOK_STYLES.map(([k, l, v]) => `<button class="ed-hst ${H.hook_box === v.hook_box && H.hook_ink === v.hook_ink && H.hook_op === v.hook_op ? "on" : ""}" data-ed="hookstyle" data-k="${k}">
          <i><b style="background:${v.hook_op ? rgba(v.hook_box, v.hook_op) : "transparent"};color:${v.hook_ink};border-radius:4px;${v.hook_op < 35 ? "-webkit-text-stroke:2px #000;paint-order:stroke fill" : ""}">Hook</b></i>${l}</button>`).join("")}</div>
        ${swatches("hook_box", "Box colour", H.hook_box)}
        ${swatches("hook_ink", "Text colour", H.hook_ink)}
        ${slider("Box opacity", "hook_op", 0, 100, 5, H.hook_op, H.hook_op + "%")}
        ${slider("Corners", "hook_round", 0, 60, 2, H.hook_round, H.hook_round)}
      </div>
      <div class="ed-card"><b>Font and spacing</b>
        <label class="ed-f">Font<select data-look="hook_font">${Object.keys(f).map(k => `<option ${k === H.hook_font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        ${slider("Size", "hook_size", 50, 140, 2, H.hook_size, H.hook_size)}
        ${slider("Letter spacing", "hook_sp", -4, 24, 1, H.hook_sp, H.hook_sp)}
        ${slider("Height on screen", "hook_y", 5, 95, 1, H.hook_y == null ? autoY : H.hook_y, H.hook_y == null ? "Auto" : Math.round(H.hook_y) + "%")}
        <button class="ed-link" data-ed="hookreset">Back to the default look</button>
      </div>
      <div class="ed-card"><b>Show for</b>
        <div class="ed-f">
          <div class="ed-seg">${[[0, "Whole clip"], [3, "3 s"], [5, "5 s"], [8, "8 s"]].map(([v, l]) => `<button data-ed="hookdur" data-v="${v}" aria-pressed="${H.hook_dur === v}">${l}</button>`).join("")}</div>
          ${slider("Seconds on screen", "hook_dur", 0, Math.max(1, Math.min(60, Math.floor(E.end - E.start))), 0.5, H.hook_dur, H.hook_dur ? H.hook_dur + " s" : "Whole clip", "edHookDur")}</div>
        <p class="ed-help">The hook shows from the start of the clip, then fades away. Drag to the left end to keep it the whole time.</p>
      </div>
      <div class="ed-card"><div class="ed-brandsave flat"><p class="ed-qt">Save as your brand look</p><p class="ed-help">Keeps the captions and the hook as they are now, to use on any clip.</p>
          <div class="ed-row"><input id="edBrandName" placeholder="Name this look" maxlength="40"><button class="ed-btn" data-ed="brandsave">${ic("plus")}Save</button></div></div></div>`;
  } else if (E.tab === "brand") {
    const L = E.look, on = !!L.brand_on;
    p.innerHTML = head("Brand", "Your logo and name on every clip, so it's always yours, even when it's shared.") + `
      <div class="ed-card">
        <div class="ed-h"><b>Show my brand</b><label class="ed-sw2"><input type="checkbox" data-look="brand_on" ${on ? "checked" : ""}><span></span></label></div>
      </div>
      <div class="ed-card"><b>Logo</b>
        <div class="ed-logo">
          <span class="ed-logo-pv">${E.logoV ? `<img src="/api/brand/logo?v=${E.logoV}" alt="Your logo">` : ic("up")}</span>
          <div><p>${E.logoV ? "Your logo is saved for every clip." : "PNG with a clear background works best."}</p>
            <div class="ed-row"><label class="ed-btn">${ic("up")}${E.logoV ? "Replace" : "Upload logo"}<input type="file" accept="image/png,image/jpeg,image/webp" id="edLogoIn" hidden></label>
              ${E.logoV ? `<button class="ed-btn ghost" data-ed="logodel">Remove</button>` : ""}</div></div>
        </div>
        ${E.logoV ? `<label class="ed-ck"><input type="checkbox" data-look="brand_logo" ${L.brand_logo !== false ? "checked" : ""}><span>Show the logo</span></label>` : ""}
      </div>
      <div class="ed-card"><b>Name</b>
        <input class="ed-text" data-look="brand_text" value="${esc(L.brand_text || "")}" maxlength="40" placeholder="@yourname">
      </div>
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
  } else if (E.tab === "fx") {
    const L = E.look, cover = `/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}`;
    const fade = (k, label, opts) => `<p class="ed-grp">${label}</p><div class="ed-fx three">${opts.map(([v, l]) =>
      `<button class="ed-fxt ${(L[k] || "none") === v ? "on" : ""}" data-ed="fade" data-k="${k}" data-v="${v}">
        <span class="ed-fxi ${v === "none" ? "none" : ""}">${v === "none" ? svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>')
          : `<img src="${cover}" alt=""><i style="background:linear-gradient(${k === "fade_in" ? "90deg" : "270deg"},${v === "black" ? "#000" : "#fff"} 0%,transparent 70%)"></i>`}</span><b>${l}</b></button>`).join("")}</div>`;
    p.innerHTML = head("Effects", "A colour look for the whole clip, and how it starts and ends. Shown live in the preview.") +
      `<p class="ed-grp">Colour look</p>
      <div class="ed-fx">${EFFECTS.map(([k, l, css]) => `<button class="ed-fxt ${(L.effect || "none") === k ? "on" : ""}" data-ed="effect" data-v="${k}">
        <span class="ed-fxi ${k === "none" ? "none" : ""}">${k === "none" ? svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>') : `<img src="${cover}" alt="" style="filter:${css}">`}</span><b>${l}</b></button>`).join("")}</div>
      ${fade("fade_in", "Start", [["none", "Cut in"], ["black", "From black"], ["white", "From white"]])}
      ${fade("fade_out", "End", [["none", "Cut out"], ["black", "To black"], ["white", "To white"]])}`;
  } else if (E.tab === "trim") {
    p.innerHTML = head("Trim", "Drag the yellow edges on the timeline, or set them here.") +
      `${[["start", "Starts at"], ["end", "Ends at"]].map(([k, l]) => `<div class="ed-card"><div class="ed-f">${l}
        <div class="ed-trim"><button class="ed-ib" data-ed="nudge" data-k="${k}" data-d="-0.5" aria-label="Half a second earlier">−</button>
          <b>${ts(E[k] - E.min)}</b>
          <button class="ed-ib" data-ed="nudge" data-k="${k}" data-d="0.5" aria-label="Half a second later">+</button>
          <button class="ed-btn" data-ed="toplayhead" data-k="${k}">Set to playhead</button></div></div></div>`).join("")}
      <div class="ed-card"><div class="ed-stat"><span>Clip length</span><b>${ts(E.end - E.start)}</b></div>
        <p class="ed-help">A clip can be 3 seconds to 3 minutes long, inside the footage saved for it.</p></div>`;
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
          : `<p class="ed-help">No accounts connected yet. Connect YouTube, Instagram or TikTok in Settings.</p>`}</div>`;
  }
}

/* ---------- the preview */
function drawStage() {
  const st = $e("#edStage"), c = clipNow(); if (!st || !c) return;
  const g = geo(E.layout, E.sw, E.sh);
  const busy = c.status === "queued" || c.status === "rendering";
  const LAY = {blur: ["Blurred fill", '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 9h10M7 15h10"/>'],
               zoom: ["Zoomed in", '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 7h10M7 17h10"/>'],
               crop: ["Fill screen", '<rect x="7" y="3" width="10" height="18" rx="2"/>']};
  st.innerHTML = `<div class="ed-phone" id="edPhone">
      ${E.view === "live" ? `<img class="ed-bg ${g.layout === "crop" ? "none" : ""}" src="/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}" alt="">
        <video class="ed-fg" id="edVid" src="/media/${E.jid}/${E.cid}/source" playsinline preload="auto" style="height:${g.fg / OUT_H * 100}%"></video>
        <button class="ed-hook" id="edHookBox" data-ed="tab" data-t="text" title="Edit the hook"></button>
        <button class="ed-brand" id="edBrand" data-ed="tab" data-t="brand" title="Edit your brand" hidden></button>
        <div class="ed-cap" id="edCap"></div><div class="ed-fade" id="edFade"></div>`
      : `<video class="ed-done" id="edVid" src="/media/${E.jid}/${esc(c.file)}?v=${c.version}" playsinline preload="auto"></video>`}
      <div class="ed-making" ${busy ? "" : "hidden"}><i></i>Making your clip…</div>
    </div>
    <div class="ed-bar">
      <div class="ed-views"><button class="ed-tip" data-ed="view" data-v="live" aria-pressed="${E.view === "live"}" aria-label="Live preview" data-tip="Live preview">${svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}<span>Live</span></button>
        <button class="ed-tip" data-ed="view" data-v="rendered" aria-pressed="${E.view === "rendered"}" ${c.file ? "" : "disabled"} aria-label="Saved clip" data-tip="${c.file ? "The saved video file" : "Not saved yet"}">${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>')}<span>Saved</span></button></div>
      <span class="ed-bar-sep"></span>
      <span class="ed-bar-lbl ed-tip" data-tip="Vertical, for Shorts, Reels and TikTok">${svg('<rect x="7" y="3" width="10" height="18" rx="2"/>')}9:16</span>
      <button class="ed-lay ed-tip" data-ed="fs" aria-label="Full screen" data-tip="Full screen (Esc to leave)">${svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
      <span class="ed-bar-sep"></span>
      ${Object.entries(LAY).map(([k, [l, d]]) => `<button class="ed-lay ed-tip" data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}" aria-label="${l}" data-tip="${l}">${svg(d)}</button>`).join("")}
      <span class="ed-bar-sep"></span>
      <label class="ed-vol" title="Volume of the clip: heard here and in the saved video">${SOUND((E.look.volume ?? 100) > 0)}
        <input type="range" min="0" max="200" step="5" value="${E.look.volume ?? 100}" data-look="volume" aria-label="Volume" style="--p:${(E.look.volume ?? 100) / 2}%">
        <output id="edVolOut">${E.look.volume ?? 100}%</output></label>
    </div>`;
  const v = $e("#edVid");
  v.playbackRate = E.rate; v.muted = !!E.muted; applyVolume();
  v.addEventListener("loadedmetadata", () => { if (E.view === "live") v.currentTime = Math.max(0, E.start - E.off); v.playbackRate = E.rate; });
  v.addEventListener("error", () => { if (E.view === "live") { st.querySelector(".ed-phone").insertAdjacentHTML("beforeend",
    `<div class="ed-making">The original footage for this clip isn't here any more. Use “Saved clip”.</div>`); } });
  v.addEventListener("click", togglePlay);
  v.addEventListener("seeked", () => paintOverlay());      // also when animation frames are paused (a background tab)
  E.lastKey = ""; E.shownPaused = null; E.fxShown = null; paintOverlay(); loop();
}
// effects in the preview: the colour look as a CSS filter on the footage, the start and end fades as a coloured layer
function paintFx(t, phone) {
  const L = E.look;
  // "none" would break the background's blur filter, so no effect is a filter that changes nothing
  if (E.fxShown !== L.effect) { E.fxShown = L.effect; phone.style.setProperty("--fx", fxCss(L.effect) || "contrast(1)"); }
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
const nowT = () => { const v = vid(); if (!v) return E.start; return E.view === "live" ? E.off + v.currentTime : E.start + v.currentTime; };
function seek(t) {
  const v = vid(); if (!v) return;
  t = Math.max(E.min, Math.min(E.max, t));
  v.currentTime = E.view === "live" ? t - E.off : Math.max(0, Math.min(t, E.end) - E.start);
}
function togglePlay() {
  const v = vid(); if (!v) return;
  if (v.paused) { audioFor(v); AC?.resume?.(); applyVolume(); }
  if (v.paused) { if (E.view === "live" && (nowT() >= E.end - 0.05 || nowT() < E.start - 0.2)) seek(E.start); v.play().catch(() => {}); } else v.pause();
}
// one light loop while the editor is open: it only touches what changed since the last frame
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!$("#clipdlg").open || !vid()) return;
    const v = vid(), t = nowT();
    if (E.view === "live" && !v.paused && t >= E.end) { v.pause(); seek(E.start); }
    else if (E.view === "live" && !v.paused && E.cuts?.length) {          // playing over a cut part: jump past it
      const c = E.cuts.find(([a, b]) => t >= a && t < b - 0.03); if (c) seek(c[1]);
    }
    paintOverlay(t);
    const ph = $e("#edHead"); if (ph) ph.style.left = pct(t) + "%";
    const now = ts(Math.max(0, t - E.start));
    if (now !== E.shownNow) { E.shownNow = now; const tl = $e("#edNow"); if (tl) tl.textContent = now;
      const tb = $e("#edNow2"); if (tb) tb.textContent = clock(t - E.start, true); }
    if (v.paused !== E.shownPaused) { E.shownPaused = v.paused; const pb = $e("[data-ed=play]"); if (pb) pb.innerHTML = ic(v.paused ? "play" : "pause"); }
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
/* the person's brand on the preview: built once per change, then moved every frame exactly like render.brand_overlay */
function paintBrand(t, phone, k) {
  const el = $e("#edBrand"); if (!el) return;
  const L = E.look, text = (L.brand_text || "").trim(), logo = L.brand_logo !== false && E.logoV;
  const on = !!L.brand_on && !!(text || logo);
  el.hidden = !on; if (!on) return;
  const size = (L.brand_size || 84) * k, key = [text, logo, size.toFixed(2), E.logoV].join("|");
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = (logo ? `<img src="/api/brand/logo?v=${E.logoV}" alt="" style="height:${size}px">` : "") +
      (text ? `<span style="font-size:${Math.max(18, size / k * 0.42) * k}px">${esc(text)}</span>` : "");
    el.style.gap = logo && text ? `${size * 0.22}px` : "0";
    el.style.padding = `${8 * k}px`;
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
  const fc = fontCss(L.font);
  const y = L.y == null ? g.cap / OUT_H * 100 : L.y;
  // the renderer's spacing (a space plus room for both outlines) and its soft half-black shadow, at preview scale
  const gapPx = (0.26 * emOf(L.font) * L.size + 2 * L.outline + 6 + (L.wgap || 0)) * k;
  const capBox = L.cap_op > 0 ? `background:${rgba(L.cap_box || "#000000", L.cap_op)};padding:${0.12 * emOf(L.font) * L.size * k}px ${0.3 * L.size * k}px;border-radius:${(L.cap_round ?? 18) * k}px;` : "";
  cap.style.cssText = `top:${y}%;font-family:${fc.family};font-weight:${fc.weight};font-size:${L.size * emOf(L.font) * k}px;color:${L.base};` +
    `-webkit-text-stroke:${L.outline * 2 * k}px #000;column-gap:${gapPx}px;letter-spacing:${(L.sp || 0) * k}px;${capBox}text-shadow:${CAP_SHADOW * k}px ${CAP_SHADOW * k}px 0 rgba(0,0,0,.5);`;
  cap.innerHTML = shown.map((w, n) => { w = w.replace(/[.,;:]+$/, "");
    w = L.upper ? w.toUpperCase() : n === 0 ? w.replace(/^\p{Ll}/u, c => c.toUpperCase()) : w;     // normal case: each line starts with a capital
    return `<span class="${n === act ? "on" : ""}" style="${n === act ? `color:${L.active}` : ""}">${esc(w)}</span>`; }).join("");
  cap.style.transform = "translate(-50%,-50%)";
  const maxW = phone.clientWidth * 960 / OUT_W;
  if (cap.scrollWidth > maxW) cap.style.transform = `translate(-50%,-50%) scale(${maxW / cap.scrollWidth})`;
  if (hook) {
    const hf = fontCss(H.hook_font);
    hook.hidden = !L.hook || !E.hook.trim();
    // the same lines as the video: one line, or two split where they come out most even (render._hook_events)
    const px = H.hook_size * emOf(H.hook_font), mc = hookMeasure();
    mc.font = `${hf.weight} ${px}px ${hf.family}, sans-serif`;
    const wd = t => mc.measureText(t).width + H.hook_sp * Math.max(0, t.length - 1), ws = E.hook.trim().split(/\s+/);
    let hl = [ws.join(" ")];
    if (wd(hl[0]) * 0.6 > 940 && ws.length > 1) {        // one line unless it would get too small to read (render._hook_events)
      const worst = ws.slice(1).map((_, j) => Math.max(wd(ws.slice(0, j + 1).join(" ")), wd(ws.slice(j + 1).join(" "))));
      const lo = Math.min(...worst), best = worst.reduce((b, m, j) => m <= lo * 1.03 ? j + 1 : b, 1);   // near ties go to the fuller top line, as the video does
      hl = [ws.slice(0, best).join(" "), ws.slice(best).join(" ")];
    }
    const shrink = Math.min(1, 940 / Math.max(...hl.map(wd)));      // still too wide: smaller, as the video does
    hook.innerHTML = hl.map(esc).join("<br>");
    hook.style.cssText = `top:${H.hook_y == null ? g.hook / OUT_H * 100 : H.hook_y}%;font-family:${hf.family};font-weight:${hf.weight};` +
      `font-size:${px * shrink * k}px;padding:${24 * k}px ${40 * k}px;border-radius:${H.hook_round * k}px;width:max-content;max-width:${1020 * k}px;box-sizing:border-box;white-space:nowrap;` +
      `background:${H.hook_op ? rgba(H.hook_box, H.hook_op) : "transparent"};color:${H.hook_ink};letter-spacing:${H.hook_sp * k}px;` +
      (H.hook_op < 35 ? `-webkit-text-stroke:${Math.max(3, H.hook_size / 22) * 2 * k}px #000;paint-order:stroke fill;text-shadow:${CAP_SHADOW * k}px ${CAP_SHADOW * k}px 0 rgba(0,0,0,.5);` : "") +
      `opacity:${hookNow ? 1 : 0};pointer-events:${hookNow ? "auto" : "none"}`;
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
  const cn = $e("#edCapNow");            // the caption track's label says the line being spoken, like the hook's block
  if (cn) cn.textContent = gi >= 0 && lines()[gi] ? lines()[gi].map(i => E.words[i].w).join(" ") : `${lines().length} caption lines`;
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
const SOUND = on => svg(on ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'
  : '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>');
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
  tl.innerHTML = `<div class="ed-tl-head">
      <div class="ed-zoom"><button class="ed-tltog" data-ed="tltog" aria-expanded="${!E.tlHidden}" title="${E.tlHidden ? "Show the timeline" : "Hide the timeline for a bigger preview"}">
          ${svg(E.tlHidden ? '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h4"/>' : '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h4M9 9l3-3 3 3"/>')}${E.tlHidden ? "Show timeline" : "Hide timeline"}</button>
        <span class="ed-tlsep"></span><button class="ed-ib sm" data-ed="zoom" data-d="-1" aria-label="Zoom out">${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10h6M21 21l-6-6"/>')}</button>
        <input type="range" id="edZoom" min="1" max="8" step="0.5" value="${E.zoom}" aria-label="Zoom the timeline">
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
          ${head("caps", ic("cc"), "Captions")}
          ${E.chat?.counts?.length ? head("chat", ic("chat"), "Chat") : ""}
          ${head("film", ic("film"), "Video", `<button class="ed-tb" data-ed="mute" aria-pressed="${!E.muted}" title="${E.muted ? "Turn the preview's sound on" : "Mute the preview"}">${SOUND(!E.muted)}</button>`)}
        </div>
      </div>
      <div class="ed-scroll" id="edScroll">
        <div class="ed-track" id="edTrack" style="width:${E.zoom * 100}%">
          <div class="ed-ruler">${ticks.join("")}</div>
          <div class="ed-lanes">
            <div class="ed-lane hook">${hasHook ? `<button class="ed-hchip ${E.look.hook ? "" : "off"}" data-ed="tab" data-t="text" style="left:${pct(E.start)}%;width:${pct(hookEnd()) - pct(E.start)}%"><i>${TEXT_IC}</i><span>Hook: ${esc(E.hook)}</span></button>` : ""}
              ${fx !== "None" ? `<button class="ed-fxchip" data-ed="tab" data-t="fx" style="left:${pct(hookEnd())}%;width:${Math.max(6, pct(E.end) - pct(hookEnd()))}%"><i>${FX_IC}</i><span>Filter: ${esc(fx)}</span></button>` : ""}</div>
            <div class="ed-lane caps"><i class="ed-cbar" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"></i>${chips}
              <span class="ed-clabel" style="left:${pct(E.start)}%"><i>${ic("cc")}</i><span id="edCapNow">${lines().length} caption lines</span></span></div>${chatLane()}
            <div class="ed-lane film" style="background-image:url('/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}')">
              <div class="ed-shade l" style="width:${pct(E.start)}%"></div><div class="ed-shade r" style="left:${pct(E.end)}%"></div>
              ${(E.cuts || []).map(([a, b]) => `<i class="ed-cutmark" style="left:${pct(a)}%;width:${Math.max(0.2, pct(b) - pct(a))}%" title="Cut by Speech cleanup"></i>`).join("")}
              <div class="ed-win" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"><i class="ed-hd" data-h="start"></i><i class="ed-hd" data-h="end"></i></div>
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
  E.zoom = Math.max(1, Math.min(8, Math.round(z * 2) / 2));
  drawTimeline();
}

/* ---------- what's new: a short tour of the editor's new tools, a card pointing at each one in turn.
   Shown once; the ? in the top bar plays it again. */
const TOUR = [
  {sel: '[data-ed="cleanup"]', t: "One tool. Cleaner speech.", x: "Take out filler words and long pauses in one click, and see exactly what got cut.", art: "clean"},
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
}
function changes() {
  const body = {start: E.start, end: E.end, hook: E.hook, title: E.title, description: E.description, layout: E.layout,
    captions: E.edited ? E.words : null, cuts: E.cuts || []};
  if (E.lookTouched) body.look = E.look;
  return body;
}
async function save() {          // keep the changes and make the video again with them
  try {
    await send(`/api/jobs/${E.jid}/clips/${E.cid}/render`, changes());
    E.saved = snap(); E.waiting = 1; E.version = clipNow()?.version || E.version;
    toast("Saved. Making your clip…", "ok"); await tick(); drawClipDlg();
  } catch (e) { toast(e.message, "bad"); }
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
  if (E.view !== "live") { E.view = "live"; drawStage(); }
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
  if (!$e("#edExport")?.hidden && !e.target.closest(".ed-menu")) $e("#edExport").hidden = true;
  if (!b) return;
  const a = b.dataset.ed, d = b.dataset;
  if (a === "close") return edClose();
  if (a === "tab") {
    E.tab = d.t;
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
  if (a === "seek") { if (E.view !== "live") { E.view = "live"; drawStage(); } return seek(+d.at); }
  if (a === "save") return save();
  if (a === "keep") return keep();
  if (a === "zoom") return setZoom(E.zoom + +d.d);
  if (a === "fs") {                      // the preview full screen; Esc (or the button) brings it back
    const ph = $e("#edPhone");
    if (document.fullscreenElement) return document.exitFullscreen?.();
    return ph?.requestFullscreen?.().catch(() => toast("Full screen isn't allowed here.", "bad"));
  }
  if (a === "cleanup") { E.cleanOpen = !E.cleanOpen; return drawTx(); }
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
  if (a === "dlscript") {                // the script as plain text: what is left after the cuts, a paragraph per long pause
    const ws = inClip().map(([w]) => w).filter(w => !wordCut(w));
    let text = ""; ws.forEach((w, i) => { text += (i && w.s - ws[i - 1].e >= 2 ? "\n\n" : i ? " " : "") + w.w; });
    const url = URL.createObjectURL(new Blob([text + "\n"], {type: "text/plain"}));
    const l = document.createElement("a"); l.href = url; l.download = `${(E.title || E.hook || "clip").replace(/[^\w\- ]+/g, "").trim() || "clip"} script.txt`; l.click();
    return setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === "tltog") {                   // fold the timeline down to its play bar, for a bigger preview; remembered
    E.tlHidden = !E.tlHidden;
    try { localStorage.setItem("ed_tl_hidden", E.tlHidden ? "1" : ""); } catch {}
    drawTimeline();
    return requestAnimationFrame(() => { E.lastKey = ""; paintOverlay(); });     // the preview grew: redraw its captions to size
  }
  if (a === "hookvis") { E.look.hook = !E.look.hook; E.lookTouched = true; after("pt"); return E.look.hook && showHook(); }   // the eye on the Hook track
  if (a === "mute") { E.muted = !E.muted; const v = vid(); if (v) v.muted = E.muted; return drawTimeline(); }      // the preview's sound only
  if (a === "rate") { E.rate = RATES[(RATES.indexOf(E.rate) + 1) % RATES.length]; const v = vid(); if (v) v.playbackRate = E.rate; b.textContent = E.rate + "x"; return; }
  if (a === "copytx") { await navigator.clipboard.writeText(inClip().map(([w]) => w.w).join(" ")); return toast("The text is copied", "ok"); }
  if (a === "exportmenu") { const m = $e("#edExport"); m.hidden = !m.hidden; return; }
  if (a === "srt") {
    if ($e("#edExport")) $e("#edExport").hidden = true;
    const url = URL.createObjectURL(new Blob([srtOut()], {type: "text/plain"}));
    const l = document.createElement("a"); l.href = url; l.download = `${(E.title || E.hook || "clip").replace(/[^\w\- ]+/g, "").trim() || "clip"}.srt`; l.click();
    return setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === "importsrt") { $e("#edExport").hidden = true; return $e("#edSrtFile").click(); }
  if (a === "resetcaps") { E.words = clone(E.auto.length ? E.auto : E.words); E.edited = false; wordsChanged(); return after("pt"); }
  if (a === "preset") { E.look = {...lookFromStyle(d.k), y: E.look.y, hook: E.look.hook, ...keepOwn(E.look)}; E.lookTouched = true; after("pt"); return showCaptions(); }
  if (a === "brandpick") { if (e.target.closest("[data-ed=branddel]")) return; const s = E.brand[+d.k]; if (s) { E.look = {...keepOwn(E.look), ...clone(s.look)}; E.lookTouched = true; } return after("pt"); }
  if (a === "stab") { E.stab = d.t; return drawPanel(); }
  if (a === "effect") { E.look.effect = d.v; E.lookTouched = true; return after("p"); }
  if (a === "fade") { E.look[d.k] = d.v; E.lookTouched = true; E.fadeShown = null; seek(d.k === "fade_in" ? E.start : E.end - FADE_S - 0.3); return after("p"); }
  if (a === "branddel") {
    e.stopPropagation();
    E.brand.splice(+d.k, 1);
    try { E.brand = (await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({styles: E.brand})})).styles; } catch (er) { toast(er.message, "bad"); }
    return drawPanel();
  }
  if (a === "brandsave") {
    const name = $e("#edBrandName").value.trim();
    if (!name) return $e("#edBrandName").focus();
    if (E.brand.length >= 12) return toast("Your brand kit holds 12 looks. Remove one first.", "bad");
    try { E.brand = (await api("/api/brand", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({styles: [...E.brand, {name, look: E.look}]})})).styles;
      toast(`“${name}” is in your brand kit`, "ok"); } catch (er) { toast(er.message, "bad"); }
    return drawPanel();
  }
  if (a === "hookreset") { const {hook_font, hook_size, hook_y, hook_dur, hook_box, hook_ink, hook_op, hook_round, hook_sp} = HOOK_DEFAULT;
    Object.assign(E.look, {hook_font, hook_size, hook_y, hook_dur, hook_box, hook_ink, hook_op, hook_round, hook_sp}); E.lookTouched = true; after("pt"); return showHook(); }
  if (a === "hookstyle") { Object.assign(E.look, HOOK_STYLES.find(x => x[0] === d.k)[2]); E.lookTouched = true; after("p"); return showHook(); }
  if (a === "capbg") { Object.assign(E.look, CAP_BGS.find(x => x[0] === d.k)[2]); E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "hookdur") { E.look.hook_dur = +d.v; E.lookTouched = true; return after("pt"); }
  if (a === "per") { E.look.per = +d.n; E.lookTouched = true; after("pt"); return showCaptions(); }
  if (a === "upper") { E.look.upper = d.v === "1"; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "colour") { E.look[d.k] = d.v; E.lookTouched = true; after("p"); return d.k.startsWith("hook") ? showHook() : showCaptions(); }
  if (a === "layout") { E.layout = d.v; drawPanel(); return drawStage(); }
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
  if (el.id === "edLogoIn") return uploadLogo(el.files?.[0]);   // a logo picked from the computer
  if (el.dataset.cl) {                   // the Speech cleanup choices: the counts update as they change
    if (el.dataset.cl === "min") E.cl.min = +el.value; else E.cl[el.dataset.cl] = el.checked;
    return drawTx();
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
  if (!h) { if (!e.target.closest("[data-ed]")) { if (E.view !== "live") { E.view = "live"; drawStage(); } seek(at(e.clientX)); } return; }
  e.preventDefault(); track.setPointerCapture(e.pointerId);
  const move = ev => { setTrim(h, at(ev.clientX)); const w = $e(".ed-win"), sl = $e(".ed-shade.l"), sr = $e(".ed-shade.r");
    w.style.left = pct(E.start) + "%"; w.style.width = pct(E.end) - pct(E.start) + "%"; sl.style.width = pct(E.start) + "%"; sr.style.left = pct(E.end) + "%";
    seek(h === "start" ? E.start : E.end - 0.05); };
  const up = () => { track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", up); after("pt"); };
  track.addEventListener("pointermove", move); track.addEventListener("pointerup", up);
});
dlg.addEventListener("wheel", e => {           // ctrl or pinch on the timeline zooms it
  if (!e.ctrlKey || !e.target.closest("#edScroll")) return;
  e.preventDefault(); setZoom(E.zoom + (e.deltaY < 0 ? 0.5 : -0.5));
}, {passive: false});
dlg.addEventListener("toggle", e => {          // remember which style sections are open across redraws
  const f = e.target.closest?.("[data-fold]"); if (!f) return;
  E.open = E.open || new Set();
  f.open ? E.open.add(f.dataset.fold) : E.open.delete(f.dataset.fold);
}, true);
dlg.addEventListener("cancel", e => { e.preventDefault(); edClose(); });
dlg.addEventListener("close", () => { cancelAnimationFrame(raf); dlg.classList.remove("ed-on"); dlg.innerHTML = ""; E.cid = null; D.jid = null; });
document.addEventListener("keydown", e => {
  if (!dlg.open || !E.cid || e.code !== "Space" || e.target.closest("input,textarea,select,button")) return;
  e.preventDefault(); togglePlay();
});
addEventListener("resize", () => { if (dlg.open) { E.lastKey = ""; paintOverlay(); } });
})();
