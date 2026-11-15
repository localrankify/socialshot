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
const HOOK_DEFAULT = {hook_font: "Poppins", hook_size: 96, hook_y: null, hook_dur: 0,    // the heading at the top, as the server draws it (0 s = the whole clip)
  effect: "none", fade_in: "none", fade_out: "none"};                        // and the effects: a colour look, how it starts and ends
const RATES = [1, 1.25, 1.5, 2, 0.5];
const svg = d => `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TEXT_IC = svg('<path d="M6 5h12M12 5v14M9 19h6"/>');
const FX_IC = svg('<path d="M15 4l1.5 3.5L20 9l-3.5 1.5L15 14l-1.5-3.5L10 9l3.5-1.5zM6 13l1 2.5L9.5 16.5L7 17.5L6 20l-1-2.5L2.5 16.5L5 15.5z"/>');
// the colour looks the server can render (render.EFFECTS), and how each one looks in the browser preview
const EFFECTS = [["none", "None", ""], ["vivid", "Vivid", "saturate(1.35) contrast(1.08)"], ["bright", "Bright", "brightness(1.08) contrast(1.05) saturate(1.1)"],
  ["warm", "Warm", "sepia(.18) saturate(1.15)"], ["cool", "Cool", "hue-rotate(-10deg) saturate(.95) brightness(1.03)"],
  ["cinematic", "Cinematic", "contrast(1.12) saturate(.85) brightness(.97)"], ["vintage", "Vintage", "sepia(.4) contrast(.92) saturate(.85)"],
  ["bw", "Black & white", "grayscale(1) contrast(1.1)"]];
const fxCss = k => (EFFECTS.find(x => x[0] === k) || EFFECTS[0])[2];
const FADE_S = 0.5;
const keepOwn = L => ({...hookOf(L), effect: L.effect || "none", fade_in: L.fade_in || "none", fade_out: L.fade_out || "none"});   // what a new caption style must not undo

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
// caption lines inside the clip: [[word index, ...], ...]. Worked out once and kept until the words, the trim or
// the words-per-line change, because the preview asks for them on every frame while it plays.
function lines() {
  const key = `${E.wv || 0}|${E.words.length}|${E.start}|${E.end}|${E.look.per}`;
  if (E.linesKey === key) return E.linesMemo;
  const idx = inClip().map(([, i]) => i);
  const sub = idx.map(i => E.words[i]);
  E.linesMemo = groups(sub, E.look.per).map(g => g.map(k => idx[k]));
  E.linesKey = key;
  return E.linesMemo;
}
const wordsChanged = () => { E.wv = (E.wv || 0) + 1; };
const hookOf = L => ({hook_font: L.hook_font || "Poppins", hook_size: L.hook_size || 96, hook_y: L.hook_y ?? null, hook_dur: +L.hook_dur || 0});
const hookEnd = () => { const d = hookOf(E.look).hook_dur; return d > 0 ? Math.min(E.end, E.start + d) : E.end; };   // when the hook leaves the screen
function lookFromStyle(style) {
  const p = PRESETS()[style] || PRESETS().bounce;
  const {label, ...look} = p;
  return {...look, y: null, hook: true, ...HOOK_DEFAULT};
}
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
  w: E.edited ? E.words : null});
const dirty = () => E.saved !== snap();

window.openClip = async function (jid, cid) {
  const j = jobOf(jid), c = j?.clips.find(x => x.id === cid);
  if (!c) return;
  Object.keys(E).forEach(k => delete E[k]);
  D.jid = jid; D.cid = cid;          // the page's refresh keeps the editor's status up to date while this is set
  Object.assign(E, {jid, cid, tab: "transcript", view: c.status === "done" ? "live" : "rendered", words: [], auto: [], edited: false,
    start: c.start, end: c.end, hook: c.hook || "", title: c.title || "", description: c.description || "", layout: c.layout || "blur",
    look: c.look ? {...HOOK_DEFAULT, ...clone(c.look)} : lookFromStyle(c.style), lookTouched: !!c.look, off: c.src_offset || 0, min: c.src_offset || 0,
    max: c.src_end || j.duration || c.end, version: c.version || 0, waiting: 0, brand: [], sw: j.width || 1280, sh: j.height || 720,
    zoom: 1, rate: 1, q: ""});
  loadFonts();
  const dlg = $("#clipdlg");
  dlg.classList.add("ed-on");
  dlg.innerHTML = `<div class="ed"><div class="ed-loading">Opening the editor…</div></div>`;
  if (!dlg.open) dlg.showModal();
  try {
    const [cap, brand] = await Promise.all([api(`/api/jobs/${jid}/clips/${cid}/captions`), api("/api/brand").catch(() => ({styles: []}))]);
    if (E.cid !== cid) return;
    Object.assign(E, {words: clone(cap.words), auto: cap.edited ? [] : clone(cap.words), edited: cap.edited,
      off: cap.offset, min: cap.min, max: cap.max, brand: brand.styles || []});
  } catch (e) { toast(e.message, "bad"); }
  E.saved = snap(); E.lookKey = JSON.stringify(E.look);
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
const TOOLS = () => [["transcript", "Transcript", ic("cc")], ["style", "Subtitles", ic("palette")], ["text", "Text", TEXT_IC],
  ["fx", "Effects", FX_IC], ["trim", "Trim", ic("scissors")], ["post", "Post", ic("send")]];
const toolOf = tab => tab === "subs" ? "transcript" : tab;
function draw() {
  const c = clipNow(); if (!c) return;
  $("#clipdlg").innerHTML = `<div class="ed">
    <header class="ed-top">
      <div class="ed-left"><button class="ed-ib" data-ed="close" aria-label="Close editor">${ic("x")}</button><span id="edState"></span></div>
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
      <section class="ed-stage" id="edStage"></section>
    </div>
    <footer class="ed-tl" id="edTl"></footer>
    <input type="file" id="edSrtFile" accept=".srt,text/plain" hidden>
  </div>`;
  drawPanel(); drawStage(); drawTimeline(); drawClipDlg();
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
    if (prev && gap >= 2) out += `<i class="gap">[${gap.toFixed(1)}s]</i></p><p>`;
    else if (gap >= 0.5) out += `<i class="gap">[${gap.toFixed(1)}s]</i> `;
    const hit = q && w.w.toLowerCase().includes(q); if (hit) hits++;
    out += `<span class="tw${hit ? " hit" : ""}" data-ed="seek" data-at="${w.s}" data-i="${i}">${esc(w.w)}</span> `;
  });
  E.hits = hits;
  return out + `</p>`;
}
function drawPanel() {
  const p = $e("#edPanel"); if (!p) return;
  $$e(".ed-rail [data-t]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === toolOf(E.tab))));
  E.gi = -1; E.wi = -1;
  const head = (title, sub) => `<div class="ed-ph"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div>`;
  if (E.tab === "transcript" || E.tab === "subs") {
    const ls = lines(), tr = E.tab === "transcript";
    p.innerHTML = `<div class="ed-ptabs" role="tablist"><button role="tab" data-ed="ptab" data-t="transcript" aria-selected="${tr}">Transcript</button>
        <button role="tab" data-ed="ptab" data-t="subs" aria-selected="${!tr}">Edit subtitles</button></div>
      <div class="ed-ptools">
        <label class="ed-search">${ic("search")}<input id="edQ" value="${esc(E.q)}" placeholder="Search" aria-label="Search the words"><small id="edHits"></small></label>
        <button class="ed-ib" data-ed="copytx" title="Copy the text" aria-label="Copy the text">${ic("copy")}</button>
        <button class="ed-ib" data-ed="srt" title="Download as .srt" aria-label="Download captions as .srt">${ic("down")}</button>
        ${E.edited ? `<button class="ed-ib" data-ed="resetcaps" title="Use the original words" aria-label="Use the original words">${svg('<path d="M9 14l-4 -4l4 -4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/>')}</button>` : ""}
      </div>
      ${tr ? `<div class="ed-tx" id="edTx">${transcriptHtml()}</div>`
        : `<div class="ed-lines">${ls.length ? ls.map((g, gi) => {
            const text = g.map(i => E.words[i].w).join(" "), hit = E.q.trim() && text.toLowerCase().includes(E.q.trim().toLowerCase());
            return `<div class="ed-line${hit ? " hit" : ""}" data-g="${gi}"><button class="ed-t" data-ed="seek" data-at="${E.words[g[0]].s}">${ts(E.words[g[0]].s - E.start)}</button>
              <input value="${esc(text)}" data-line="${gi}" aria-label="Subtitle line ${gi + 1}"></div>`; }).join("")
          : `<p class="ed-help">No words were heard in this part of the video.</p>`}</div>`}`;
    const h = $e("#edHits"); if (h) h.textContent = E.q.trim() ? (tr ? `${E.hits || 0}` : `${$$e(".ed-line.hit").length}`) : "";
  } else if (E.tab === "style") {
    const L = E.look, f = FONTS();
    const tile = (key, look, label, del) => { const fc = fontCss(look.font);
      return `<button class="ed-preset ${look.font === L.font && look.base === L.base && look.active === L.active && look.size === L.size && look.upper === L.upper ? "on" : ""}" data-ed="${del ? "brandpick" : "preset"}" data-k="${esc(key)}">
        <span class="ed-ps"><i style="background-image:url('/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}')"></i>
          <span class="ed-pt" style="font-family:${fc.family};font-weight:${fc.weight};color:${look.base};-webkit-text-stroke:${Math.max(2, look.outline / 2.4).toFixed(1)}px #000">
          ${look.upper ? "CLIP" : "Clip"} <em style="color:${look.active}">${look.upper ? "THIS" : "this"}</em></span></span><b>${esc(label)}</b>
        ${del ? `<i class="ed-x" data-ed="branddel" data-k="${esc(key)}" title="Remove from brand kit">${ic("x")}</i>` : ""}</button>`; };
    const fold = (k, title, note, body) => `<details class="ed-fold" data-fold="${k}" ${E.open?.has(k) ? "open" : ""}><summary>${title}${note ? `<small>${note}</small>` : ""}</summary><div>${body}</div></details>`;
    const st = E.stab || "presets";
    const tabs = `<div class="ed-ptabs line" role="tablist"><button role="tab" data-ed="stab" data-t="presets" aria-selected="${st === "presets"}">Presets</button>
      <button role="tab" data-ed="stab" data-t="settings" aria-selected="${st === "settings"}">Settings</button></div>`;
    if (st === "presets") {
      p.innerHTML = tabs + `<p class="ed-grp">Animated subtitles</p>
        <div class="ed-presets big">${Object.entries(PRESETS()).map(([k, v]) => tile(k, v, v.label)).join("")}</div>
        ${E.brand.length ? `<p class="ed-grp">Your brand kit</p><div class="ed-presets big">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>` : ""}`;
      return;
    }
    p.innerHTML = tabs + `
      ${fold("text", "Font and size", esc(L.font), `
        <label class="ed-f">Font<select data-look="font">${Object.keys(f).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="ed-f">Size <output>${L.size}</output><input type="range" min="60" max="220" step="2" value="${L.size}" data-look="size"></label>
        <div class="ed-f">Words per line<div class="ed-seg">${[1, 2, 3, 4, 5].map(n => `<button data-ed="per" data-n="${n}" aria-pressed="${L.per === n}">${n}</button>`).join("")}</div></div>
        <div class="ed-f">Letters<div class="ed-seg"><button data-ed="upper" data-v="1" aria-pressed="${L.upper}">AA</button><button data-ed="upper" data-v="0" aria-pressed="${!L.upper}">Aa</button></div></div>`)}
      ${fold("colour", "Colours", "", `
        ${[["base", "Text"], ["active", "Highlight"]].map(([k, l]) => `<div class="ed-f">${l}<div class="ed-sw">
          ${SWATCHES.map(h => `<button data-ed="colour" data-k="${k}" data-v="${h}" style="background:${h}" aria-pressed="${L[k] === h}" aria-label="${h}"></button>`).join("")}
          <label class="ed-pick" style="background:${L[k]}"><input type="color" value="${L[k].toLowerCase()}" data-look="${k}" aria-label="Pick a ${l.toLowerCase()} colour"></label></div></div>`).join("")}
        <label class="ed-f">Outline <output>${L.outline}</output><input type="range" min="0" max="12" value="${L.outline}" data-look="outline"></label>`)}
      ${fold("pos", "Position", L.y == null ? "Auto" : Math.round(L.y) + "%", `
        <label class="ed-f">Height on screen <output>${L.y == null ? "Auto" : Math.round(L.y) + "%"}</output>
          <input type="range" min="8" max="92" value="${L.y == null ? Math.round(geo(E.layout, E.sw, E.sh).cap / OUT_H * 100) : L.y}" data-look="y"></label>`)}
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
      <div class="ed-card">
        <label class="ed-f">Font<select data-look="hook_font">${Object.keys(f).map(k => `<option ${k === H.hook_font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="ed-f">Size <output>${H.hook_size}</output><input type="range" min="50" max="140" step="2" value="${H.hook_size}" data-look="hook_size"></label>
        <label class="ed-f">Height on screen <output>${H.hook_y == null ? "Auto" : Math.round(H.hook_y) + "%"}</output><input type="range" min="5" max="95" value="${H.hook_y == null ? autoY : H.hook_y}" data-look="hook_y"></label>
        <button class="ed-link" data-ed="hookreset">Back to the default look</button>
      </div>
      <div class="ed-card">
        <div class="ed-f">Show for <output id="edHookDur">${H.hook_dur ? H.hook_dur + " s" : "Whole clip"}</output>
          <div class="ed-seg">${[[0, "Whole clip"], [3, "3 s"], [5, "5 s"], [8, "8 s"]].map(([v, l]) => `<button data-ed="hookdur" data-v="${v}" aria-pressed="${H.hook_dur === v}">${l}</button>`).join("")}</div>
          <input type="range" min="0" max="${Math.max(1, Math.min(60, Math.floor(E.end - E.start)))}" step="0.5" value="${H.hook_dur}" data-look="hook_dur" aria-label="Seconds the hook stays on screen"></div>
        <p class="ed-help">The hook shows from the start of the clip, then fades away. Drag to the left end to keep it the whole time.</p>
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
        <div class="ed-cap" id="edCap"></div><div class="ed-fade" id="edFade"></div>`
      : `<video class="ed-done" id="edVid" src="/media/${E.jid}/${esc(c.file)}?v=${c.version}" playsinline preload="auto"></video>`}
      <div class="ed-making" ${busy ? "" : "hidden"}><i></i>Making your clip…</div>
    </div>
    <div class="ed-bar">
      <div class="ed-views"><button data-ed="view" data-v="live" aria-pressed="${E.view === "live"}">Live preview</button>
        <button data-ed="view" data-v="rendered" aria-pressed="${E.view === "rendered"}" ${c.file ? "" : "disabled"}>Saved clip</button></div>
      <span class="ed-bar-sep"></span>
      <span class="ed-bar-lbl">${svg('<rect x="7" y="3" width="10" height="18" rx="2"/>')}9:16</span>
      <span class="ed-bar-sep"></span>
      ${Object.entries(LAY).map(([k, [l, d]]) => `<button class="ed-lay" data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}" title="${l}">${svg(d)}<span>${l}</span></button>`).join("")}
    </div>`;
  const v = $e("#edVid");
  v.playbackRate = E.rate;
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
  if (v.paused) { if (E.view === "live" && (nowT() >= E.end - 0.05 || nowT() < E.start - 0.2)) seek(E.start); v.play().catch(() => {}); } else v.pause();
}
// one light loop while the editor is open: it only touches what changed since the last frame
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!$("#clipdlg").open || !vid()) return;
    const v = vid(), t = nowT();
    if (E.view === "live" && !v.paused && t >= E.end) { v.pause(); seek(E.start); }
    paintOverlay(t);
    const ph = $e("#edHead"); if (ph) ph.style.left = pct(t) + "%";
    const now = ts(Math.max(0, t - E.start));
    if (now !== E.shownNow) { E.shownNow = now; const tl = $e("#edNow"); if (tl) tl.textContent = now; }
    if (v.paused !== E.shownPaused) { E.shownPaused = v.paused; const pb = $e("[data-ed=play]"); if (pb) pb.innerHTML = ic(v.paused ? "play" : "pause"); }
    if (!v.paused && E.zoom > 1) follow(t);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function follow(t) {             // when zoomed in, keep the playhead in sight while it plays
  const sc = $e("#edScroll"); if (!sc) return;
  const x = pct(t) / 100 * sc.scrollWidth;
  if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = x - sc.clientWidth / 3;
}
function paintOverlay(t = nowT()) {
  if (E.view !== "live") return;
  const cap = $e("#edCap"), hook = $e("#edHookBox"), phone = $e("#edPhone");
  if (!cap || !phone) return;
  const k = phone.clientWidth / OUT_W, L = E.look, H = hookOf(L), g = geo(E.layout, E.sw, E.sh);
  paintFx(t, phone);
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
  cap.style.cssText = `top:${y}%;font-family:${fc.family};font-weight:${fc.weight};font-size:${L.size * 0.78 * k}px;color:${L.base};` +
    `-webkit-text-stroke:${L.outline * 2 * k}px #000;`;
  cap.innerHTML = shown.map((w, n) => { w = w.replace(/[.,;:]+$/, ""); if (L.upper) w = w.toUpperCase();
    return `<span class="${n === act ? "on" : ""}" style="${n === act ? `color:${L.active}` : ""}">${esc(w)}</span>`; }).join(" ");
  cap.style.transform = "translate(-50%,-50%)";
  const maxW = phone.clientWidth * 960 / OUT_W;
  if (cap.scrollWidth > maxW) cap.style.transform = `translate(-50%,-50%) scale(${maxW / cap.scrollWidth})`;
  if (hook) {
    const hf = fontCss(H.hook_font);
    hook.hidden = !L.hook || !E.hook.trim();
    hook.textContent = E.hook;
    hook.style.cssText = `top:${H.hook_y == null ? g.hook / OUT_H * 100 : H.hook_y}%;font-family:${hf.family};font-weight:${hf.weight};` +
      `font-size:${H.hook_size * 0.73 * k}px;padding:${22 * k}px ${36 * k}px;border-radius:${26 * k}px;max-width:${972 * k}px;` +
      `opacity:${hookNow ? 1 : 0};pointer-events:${hookNow ? "auto" : "none"}`;
  }
}

/* the caption being spoken lights up in the subtitles and on the timeline, the word in the transcript;
   the list follows along while it plays */
function keepInView(row) {
  const panel = $e("#edPanel"), v = vid();
  if (!row || !panel || !v || v.paused || panel.contains(document.activeElement)) return;
  const r = row.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  if (r.top < pr.top + 120 || r.bottom > pr.bottom - 24) panel.scrollTo({top: panel.scrollTop + r.top - pr.top - pr.height / 3, behavior: "smooth"});
}
function markLine(gi) {
  E.gi = gi;
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

/* ---------- the timeline */
const pct = t => (Math.max(E.min, Math.min(E.max, t)) - E.min) / Math.max(0.1, E.max - E.min) * 100;
function drawTimeline() {
  const tl = $e("#edTl"), c = clipNow(); if (!tl || !c) return;
  const span = E.max - E.min, want = span / (8 * E.zoom), step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s >= want) || 600;
  const ticks = []; for (let s = 0; s <= span; s += step) ticks.push(`<span style="left:${s / span * 100}%">${ts(s).replace(/\.\d$/, "")}</span>`);
  const chips = lines().map((g, gi) => { const a = E.words[g[0]], b = E.words[g[g.length - 1]], text = esc(g.map(i => E.words[i].w).join(" "));
    return `<button class="ed-chip" data-ed="seek" data-g="${gi}" data-at="${a.s}" style="left:${pct(a.s)}%;width:${Math.max(0.4, pct(b.e) - pct(a.s))}%" title="${text}"><span>${text}</span></button>`; }).join("");
  E.gi = -1; E.shownPaused = null; E.shownNow = "";
  const hookOn = E.look.hook && E.hook.trim();
  tl.innerHTML = `<div class="ed-tl-head">
      <div class="ed-zoom"><button class="ed-ib sm" data-ed="zoom" data-d="-1" aria-label="Zoom out">${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10h6M21 21l-6-6"/>')}</button>
        <input type="range" id="edZoom" min="1" max="8" step="0.5" value="${E.zoom}" aria-label="Zoom the timeline">
        <button class="ed-ib sm" data-ed="zoom" data-d="1" aria-label="Zoom in">${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10h6M10 7v6M21 21l-6-6"/>')}</button></div>
      <div class="ed-play"><span class="ed-now" id="edNow">0:00.0</span>
        <button class="ed-pbtn" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
        <span class="ed-dur">${ts(E.end - E.start)}</span></div>
      <div class="ed-tl-right"><button class="ed-rate" data-ed="rate" title="Playback speed">${E.rate}x</button></div>
    </div>
    <div class="ed-scroll" id="edScroll">
      <div class="ed-track" id="edTrack" style="width:${E.zoom * 100}%">
        <div class="ed-ruler">${ticks.join("")}</div>
        <div class="ed-lane hook">${hookOn ? `<button class="ed-hchip" data-ed="tab" data-t="text" style="left:${pct(E.start)}%;width:${pct(hookEnd()) - pct(E.start)}%">${TEXT_IC}<span>${esc(E.hook)}</span></button>` : ""}</div>
        <div class="ed-lane caps">${chips}</div>
        <div class="ed-lane film" style="background-image:url('/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}')"></div>
        <div class="ed-shade l" style="width:${pct(E.start)}%"></div><div class="ed-shade r" style="left:${pct(E.end)}%"></div>
        <div class="ed-win" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"><i class="ed-hd" data-h="start"></i><i class="ed-hd" data-h="end"></i></div>
        <div class="ed-head" id="edHead"></div>
      </div>
    </div>`;
  const sc = $e("#edScroll");
  if (sc && E.zoom > 1) sc.scrollLeft = pct(nowT()) / 100 * sc.scrollWidth - sc.clientWidth / 3;
}
function setZoom(z) {
  E.zoom = Math.max(1, Math.min(8, Math.round(z * 2) / 2));
  drawTimeline();
}

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
    captions: E.edited ? E.words : null};
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
    E.tab = d.t === "transcript" && E.tab === "subs" ? "subs" : d.t;
    drawPanel();
    if (d.t === "text") setTimeout(() => $e("#edHook")?.focus(), 0);
    return;
  }
  if (a === "ptab") { E.tab = d.t; return drawPanel(); }
  if (a === "view") { E.view = d.v; return drawStage(); }
  if (a === "play") return togglePlay();
  if (a === "seek") { if (E.view !== "live") { E.view = "live"; drawStage(); } return seek(+d.at); }
  if (a === "save") return save();
  if (a === "keep") return keep();
  if (a === "zoom") return setZoom(E.zoom + +d.d);
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
  if (a === "hookreset") { Object.assign(E.look, {hook_font: "Poppins", hook_size: 96, hook_y: null, hook_dur: 0}); E.lookTouched = true; return after("pt"); }
  if (a === "hookdur") { E.look.hook_dur = +d.v; E.lookTouched = true; return after("pt"); }
  if (a === "per") { E.look.per = +d.n; E.lookTouched = true; after("pt"); return showCaptions(); }
  if (a === "upper") { E.look.upper = d.v === "1"; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "colour") { E.look[d.k] = d.v; E.lookTouched = true; after("p"); return showCaptions(); }
  if (a === "layout") { E.layout = d.v; drawPanel(); return drawStage(); }
  if (a === "nudge") { setTrim(d.k, E[d.k] + +d.d); return after("pt"); }
  if (a === "toplayhead") { setTrim(d.k, nowT()); return after("pt"); }
});
dlg.addEventListener("input", e => {
  const el = e.target, k = el.dataset.look;
  if (k) {
    E.lookTouched = true;
    if (k === "font" || k === "hook_font") E.look[k] = el.value;
    else if (k === "base" || k === "active") { E.look[k] = el.value.toUpperCase(); el.parentElement.style.background = el.value; }
    else if (k === "hook") { E.look.hook = el.checked; const h = $e("#edHook"); if (h) h.disabled = !el.checked; return after("t"); }
    else if (k === "hook_dur") {
      E.look.hook_dur = +el.value; const o = $e("#edHookDur"); if (o) o.textContent = +el.value ? el.value + " s" : "Whole clip";
      $$e("[data-ed=hookdur]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === +el.value)));
      after("t"); return showHook();
    }
    else { E.look[k] = +el.value; const o = el.parentElement.querySelector("output"); if (o) o.textContent = k === "y" || k === "hook_y" ? el.value + "%" : el.value; }
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
    drawPanel(); const q = $e("#edQ"); if (q) { q.focus(); q.setSelectionRange(at, at); }
    $e(".tw.hit, .ed-line.hit")?.scrollIntoView({block: "center"});
    return;
  }
  if (el.id === "edHook") { E.hook = el.value.replace(/\n/g, " "); const n = $e("#edHookN"); if (n) n.textContent = E.hook.length;
    const hc = $e(".ed-hchip span"); if (hc) hc.textContent = E.hook; return after(""); }
  if (el.id === "edTitle") { E.title = el.value; return drawClipDlg(); }
  if (el.id === "edDesc") { E.description = el.value; return drawClipDlg(); }
});
dlg.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.line != null) { keepAuto(); editLine(+el.dataset.line, el.value); E.editG = -1; E.editText = null; return after("pt"); }
  if (el.id === "edHook") return drawTimeline();
  if (el.dataset.look === "base" || el.dataset.look === "active") return drawPanel();
  if (el.id === "edSrtFile" && el.files[0]) {
    el.files[0].text().then(t => { const w = srtIn(t); el.value = "";
      if (!w.length) return toast("No captions found in that file.", "bad");
      keepAuto(); E.words = w; E.edited = true; wordsChanged(); E.tab = "subs"; after("pt"); toast(`Imported ${w.length} words`, "ok"); });
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
