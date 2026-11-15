/* The clip editor: a dark, full-screen editor for one clip.
   Left: captions, style, trim and post panels. Middle: a live preview of the original footage with the captions
   drawn on top, so every change shows at once. Bottom: a timeline with the trim window and the caption lines.
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
function lines() {        // caption lines inside the clip: [[word index, ...], ...]
  const idx = inClip().map(([, i]) => i);
  const sub = idx.map(i => E.words[i]);
  return groups(sub, E.look.per).map(g => g.map(k => idx[k]));
}
function lookFromStyle(style) {
  const p = PRESETS()[style] || PRESETS().bounce;
  const {label, ...look} = p;
  return {...look, y: null, hook: true};
}
const fontCss = key => { const f = FONTS()[key] || {google: "Poppins", weight: 800}; return {family: `'${f.google}'`, weight: f.weight}; };
function loadFonts() {
  if (document.getElementById("edFonts")) return;
  const fams = Object.values(FONTS()).map(f => `family=${f.google.replace(/ /g, "+")}:wght@${f.weight}`).join("&");
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
  Object.assign(E, {jid, cid, tab: "captions", view: c.status === "done" ? "live" : "rendered", words: [], auto: [], edited: false,
    start: c.start, end: c.end, hook: c.hook || "", title: c.title || "", description: c.description || "", layout: c.layout || "blur",
    look: c.look ? clone(c.look) : lookFromStyle(c.style), lookTouched: !!c.look, off: c.src_offset || 0, min: c.src_offset || 0,
    max: c.src_end || j.duration || c.end, version: c.version || 0, waiting: 0, brand: [], sw: j.width || 1280, sh: j.height || 720});
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
  E.saved = snap();
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
    : dirty() ? `<span class="ed-pill">Unsaved changes</span>` : `<span class="ed-pill ok">${ic("check")}Saved</span>`;
  const sv = $e("#edSave"); if (sv) sv.disabled = busy;
  const mk = $e(".ed-making"); if (mk) mk.hidden = !busy;
};

/* ---------- the whole editor */
function draw() {
  const c = clipNow(); if (!c) return;
  const tabs = [["captions", "Captions", "cc"], ["style", "Style", "palette"], ["trim", "Trim", "scissors"], ["post", "Post", "send"]];
  $("#clipdlg").innerHTML = `<div class="ed">
    <header class="ed-top">
      <button class="ed-ib" data-ed="close" aria-label="Close editor">${ic("x")}</button>
      <div class="ed-name"><b>${esc(E.title || E.hook || "Untitled clip")}</b><span id="edState"></span></div>
      <div class="ed-acts">
        <div class="ed-menu"><button class="ed-btn" data-ed="exportmenu" aria-haspopup="menu">${ic("down")}Export</button>
          <div class="ed-pop" id="edExport" hidden role="menu">
            ${c.status === "done" ? `<a role="menuitem" href="/media/${E.jid}/${esc(c.file)}?download=1">${ic("film")}<span><b>Video (MP4)</b><small>The last saved version</small></span></a>` : ""}
            <button role="menuitem" data-ed="srt">${ic("down")}<span><b>Captions (.srt)</b><small>For any other editor</small></span></button>
            <button role="menuitem" data-ed="importsrt">${ic("up")}<span><b>Import captions (.srt)</b><small>Replace the caption text</small></span></button>
          </div></div>
        <button class="ed-btn primary" id="edSave" data-ed="save">${ic("scissors")}Save and render</button>
      </div>
    </header>
    <div class="ed-body">
      <nav class="ed-rail" role="tablist" aria-label="Editor tools">${tabs.map(([k, l, i]) => `<button role="tab" aria-selected="${E.tab === k}" data-ed="tab" data-t="${k}">${ic(i)}${l}</button>`).join("")}</nav>
      <aside class="ed-panel" id="edPanel"></aside>
      <section class="ed-stage" id="edStage"></section>
    </div>
    <footer class="ed-tl" id="edTl"></footer>
    <input type="file" id="edSrtFile" accept=".srt,text/plain" hidden>
  </div>`;
  drawPanel(); drawStage(); drawTimeline(); drawClipDlg();
}

/* ---------- left panel */
function drawPanel() {
  const p = $e("#edPanel"); if (!p) return;
  $$e(".ed-rail [data-t]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === E.tab)));
  E.gi = -1;
  if (E.tab === "captions") {
    const ls = lines();
    p.innerHTML = `<div class="ed-sec caps-head"><div class="ed-h"><h3>Captions<small>${ls.length} lines</small></h3>
        <button class="ed-link" data-ed="resetcaps" ${E.edited ? "" : "hidden"}>Use the original words</button></div>
      <p class="ed-help">Click a line to fix it. Click a time to jump there.</p></div>
      <div class="ed-lines">${ls.length ? ls.map((g, gi) => `<div class="ed-line" data-g="${gi}">
        <button class="ed-t" data-ed="seek" data-at="${E.words[g[0]].s}">${ts(E.words[g[0]].s - E.start)}</button>
        <input value="${esc(g.map(i => E.words[i].w).join(" "))}" data-line="${gi}" aria-label="Caption line ${gi + 1}"></div>`).join("")
        : `<p class="ed-help">No words were heard in this part of the video.</p>`}</div>`;
  } else if (E.tab === "style") {
    const L = E.look, f = FONTS();
    const tile = (key, look, label, del) => { const fc = fontCss(look.font);
      return `<button class="ed-preset ${JSON.stringify({...look, y: L.y, hook: L.hook}) === JSON.stringify(L) ? "on" : ""}" data-ed="${del ? "brandpick" : "preset"}" data-k="${esc(key)}">
        <span class="ed-ps"><i style="background-image:url('/media/${E.jid}/${esc(clipNow()?.cover || "")}?v=${clipNow()?.version || 0}')"></i>
          <span class="ed-pt" style="font-family:${fc.family};font-weight:${fc.weight};color:${look.base};-webkit-text-stroke:${Math.max(2, look.outline / 2.4).toFixed(1)}px #000">
          ${look.upper ? "CLIP" : "Clip"} <em style="color:${look.active}">${look.upper ? "THIS" : "this"}</em></span></span><b>${esc(label)}</b><small>${esc(look.font)}</small>
        ${del ? `<i class="ed-x" data-ed="branddel" data-k="${esc(key)}" title="Remove from brand kit">${ic("x")}</i>` : ""}</button>`; };
    // only the presets show at first; everything else folds away and stays open or shut as you left it
    const fold = (k, title, note, body) => `<details class="ed-fold" data-fold="${k}" ${E.open?.has(k) ? "open" : ""}><summary>${title}${note ? `<small>${note}</small>` : ""}</summary><div>${body}</div></details>`;
    p.innerHTML = `<div class="ed-sec"><div class="ed-h"><h3>Caption style</h3></div>
        <div class="ed-presets">${Object.entries(PRESETS()).map(([k, v]) => tile(k, v, v.label)).join("")}</div></div>
      ${fold("text", "Text", "", `
        <label class="ed-f">Font<select data-look="font">${Object.keys(f).map(k => `<option ${k === L.font ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="ed-f">Size <output>${L.size}</output><input type="range" min="60" max="220" step="2" value="${L.size}" data-look="size"></label>
        <div class="ed-f">Words per line<div class="ed-seg">${[1, 2, 3, 4, 5].map(n => `<button data-ed="per" data-n="${n}" aria-pressed="${L.per === n}">${n}</button>`).join("")}</div></div>
        <div class="ed-f">Letters<div class="ed-seg"><button data-ed="upper" data-v="1" aria-pressed="${L.upper}">AA</button><button data-ed="upper" data-v="0" aria-pressed="${!L.upper}">Aa</button></div></div>`)}
      ${fold("colour", "Colours", "", `
        ${[["base", "Text"], ["active", "Highlight"]].map(([k, l]) => `<div class="ed-f">${l}<div class="ed-sw">
          ${SWATCHES.map(h => `<button data-ed="colour" data-k="${k}" data-v="${h}" style="background:${h}" aria-pressed="${L[k] === h}" aria-label="${h}"></button>`).join("")}
          <label class="ed-pick" style="background:${L[k]}"><input type="color" value="${L[k].toLowerCase()}" data-look="${k}" aria-label="Pick a ${l.toLowerCase()} colour"></label></div></div>`).join("")}
        <label class="ed-f">Outline <output>${L.outline}</output><input type="range" min="0" max="12" value="${L.outline}" data-look="outline"></label>`)}
      ${fold("pos", "Position and layout", "", `
        <label class="ed-f">Height on screen <output>${L.y == null ? "Auto" : Math.round(L.y) + "%"}</output>
          <input type="range" min="8" max="92" value="${L.y == null ? Math.round(geo(E.layout, E.sw, E.sh).cap / OUT_H * 100) : L.y}" data-look="y"></label>
        <div class="ed-f">Video layout<div class="ed-seg">${Object.entries({blur: "Blurred fill", zoom: "Zoomed", crop: "Fill"}).map(([k, l]) =>
          `<button data-ed="layout" data-v="${k}" aria-pressed="${E.layout === k}">${l}</button>`).join("")}</div></div>`)}
      ${fold("hook", "Hook", L.hook ? "On" : "Off", `
        <div class="ed-h"><span class="ed-help">The big line at the top</span><label class="ed-sw2"><input type="checkbox" data-look="hook" ${L.hook ? "checked" : ""}><span></span></label></div>
        <input id="edHook" value="${esc(E.hook)}" maxlength="60" placeholder="The big line at the top" ${L.hook ? "" : "disabled"}>`)}
      ${fold("brand", "Brand kit", `${E.brand.length}/12`, `
        ${E.brand.length ? `<div class="ed-presets">${E.brand.map((b, i) => tile(String(i), b.look, b.name, true)).join("")}</div>`
          : `<p class="ed-help">Save the look you like and use it on every clip.</p>`}
        <div class="ed-row"><input id="edBrandName" placeholder="Name this look" maxlength="40"><button class="ed-btn" data-ed="brandsave">${ic("plus")}Save look</button></div>`)}`;
  } else if (E.tab === "trim") {
    p.innerHTML = `<div class="ed-sec"><h3>Trim</h3><p class="ed-help">Drag the edges of the bright window on the timeline, or set them here.</p></div>
      ${[["start", "Starts at"], ["end", "Ends at"]].map(([k, l]) => `<div class="ed-sec"><div class="ed-f">${l}
        <div class="ed-trim"><button class="ed-ib" data-ed="nudge" data-k="${k}" data-d="-0.5" aria-label="Half a second earlier">−</button>
          <b>${ts(E[k] - E.min)}</b>
          <button class="ed-ib" data-ed="nudge" data-k="${k}" data-d="0.5" aria-label="Half a second later">+</button>
          <button class="ed-btn" data-ed="toplayhead" data-k="${k}">Set to playhead</button></div></div></div>`).join("")}
      <div class="ed-sec"><div class="ed-stat"><span>Clip length</span><b>${ts(E.end - E.start)}</b></div>
        <p class="ed-help">A clip can be 3 seconds to 3 minutes long, inside the footage saved for it.</p></div>`;
  } else {
    const c = clipNow();
    p.innerHTML = `<div class="ed-sec"><h3>Post text</h3>
        <label class="ed-f">Title<input id="edTitle" value="${esc(E.title)}" maxlength="100"></label>
        <label class="ed-f">Description<textarea id="edDesc" rows="5" maxlength="2000">${esc(E.description)}</textarea></label>
        <button class="ed-btn" data-act="copy" data-j="${E.jid}" data-c="${esc(E.cid)}">${ic("copy")}Copy post text</button></div>
      <div class="ed-sec"><h3>Post it</h3><div class="ed-posts">${postPills(c) || ""}</div>
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
  st.innerHTML = `<div class="ed-views"><button data-ed="view" data-v="live" aria-pressed="${E.view === "live"}">Live preview</button>
      <button data-ed="view" data-v="rendered" aria-pressed="${E.view === "rendered"}" ${c.file ? "" : "disabled"}>Saved clip</button></div>
    <div class="ed-phone" id="edPhone">
      ${E.view === "live" ? `<img class="ed-bg ${g.layout === "crop" ? "none" : ""}" src="/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}" alt="">
        <video class="ed-fg" id="edVid" src="/media/${E.jid}/${E.cid}/source" playsinline preload="auto" style="height:${g.fg / OUT_H * 100}%"></video>
        <div class="ed-hook" id="edHookBox" style="top:${g.hook / OUT_H * 100}%"></div>
        <div class="ed-cap" id="edCap"></div>`
      : `<video class="ed-done" id="edVid" src="/media/${E.jid}/${esc(c.file)}?v=${c.version}" playsinline preload="auto"></video>`}
      <div class="ed-making" ${busy ? "" : "hidden"}><i></i>Making your clip…</div>
    </div>`;
  const v = $e("#edVid");
  v.addEventListener("loadedmetadata", () => { if (E.view === "live") v.currentTime = Math.max(0, E.start - E.off); });
  v.addEventListener("error", () => { if (E.view === "live") { st.querySelector(".ed-phone").insertAdjacentHTML("beforeend",
    `<div class="ed-making">The original footage for this clip isn't here any more. Use “Saved clip”.</div>`); } });
  v.addEventListener("click", togglePlay);
  v.addEventListener("seeked", () => paintOverlay());      // also when animation frames are paused (a background tab)
  v.addEventListener("timeupdate", () => paintOverlay());
  E.lastKey = ""; paintOverlay(); loop();
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
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!$("#clipdlg").open || !vid()) return;
    const v = vid(), t = nowT();
    if (E.view === "live" && !v.paused && t >= E.end) { v.pause(); seek(E.start); }
    paintOverlay(t);
    const ph = $e("#edHead"); if (ph) ph.style.left = pct(t) + "%";
    const tl = $e("#edNow"); if (tl) tl.textContent = `${ts(Math.max(0, t - E.start))} / ${ts(E.end - E.start)}`;
    const pb = $e("[data-ed=play]"); if (pb) pb.innerHTML = ic(v.paused ? "play" : "pause");
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function paintOverlay(t = nowT()) {
  if (E.view !== "live") return;
  const cap = $e("#edCap"), hook = $e("#edHookBox"), phone = $e("#edPhone");
  if (!cap || !phone) return;
  const k = phone.clientWidth / OUT_W, L = E.look, g = geo(E.layout, E.sw, E.sh);
  const ls = lines();
  let gi = -1;
  for (let i = 0; i < ls.length; i++) {
    const first = E.words[ls[i][0]], last = E.words[ls[i][ls[i].length - 1]];
    const endG = Math.min(last.e + 0.25, i + 1 < ls.length ? E.words[ls[i + 1][0]].s : E.end);
    if (t >= first.s && t < endG) { gi = i; break; }
  }
  if (gi !== E.gi) markLine(gi);
  let act = -1;
  if (gi >= 0) ls[gi].forEach((wi, n) => { if (E.words[wi].s <= t) act = n; });
  const fc = fontCss(L.font);
  const key = [gi, act, k.toFixed(3), JSON.stringify(L), E.hook, E.layout, ls[gi] ? ls[gi].map(i => E.words[i].w).join(" ") : ""].join("|");
  if (key === E.lastKey) return;
  E.lastKey = key;
  phone.style.setProperty("--k", k);
  const y = L.y == null ? g.cap / OUT_H * 100 : L.y;
  cap.style.cssText = `top:${y}%;font-family:${fc.family};font-weight:${fc.weight};font-size:${L.size * 0.78 * k}px;color:${L.base};` +
    `-webkit-text-stroke:${L.outline * 2 * k}px #000;`;
  cap.innerHTML = gi < 0 ? "" : ls[gi].map((wi, n) => { let w = E.words[wi].w.replace(/[.,;:]+$/, ""); if (L.upper) w = w.toUpperCase();
    return `<span class="${n === act ? "on" : ""}" style="${n === act ? `color:${L.active}` : ""}">${esc(w)}</span>`; }).join(" ");
  cap.style.transform = "translate(-50%,-50%)";
  const maxW = phone.clientWidth * 960 / OUT_W;
  if (cap.scrollWidth > maxW) cap.style.transform = `translate(-50%,-50%) scale(${maxW / cap.scrollWidth})`;
  if (hook) { hook.hidden = !L.hook || !E.hook.trim(); hook.textContent = E.hook; hook.style.top = g.hook / OUT_H * 100 + "%"; }
}

/* the caption being spoken lights up in the transcript and on the timeline; the transcript follows along while it plays */
function markLine(gi) {
  E.gi = gi;
  $$e(".ed-line.on, .ed-chip.on").forEach(x => x.classList.remove("on"));
  if (gi < 0) return;
  $e(`.ed-chip[data-g="${gi}"]`)?.classList.add("on");
  const row = $e(`.ed-line[data-g="${gi}"]`); if (!row) return;
  row.classList.add("on");
  const panel = $e("#edPanel"), v = vid();
  if (panel && v && !v.paused && !panel.contains(document.activeElement)) {
    const r = row.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    if (r.top < pr.top + 90 || r.bottom > pr.bottom - 20) panel.scrollTo({top: panel.scrollTop + r.top - pr.top - pr.height / 3, behavior: "smooth"});
  }
}

/* ---------- the timeline */
const pct = t => (Math.max(E.min, Math.min(E.max, t)) - E.min) / Math.max(0.1, E.max - E.min) * 100;
function drawTimeline() {
  const tl = $e("#edTl"), c = clipNow(); if (!tl || !c) return;
  const span = E.max - E.min, step = span > 120 ? 15 : span > 50 ? 5 : 2;
  const ticks = []; for (let s = 0; s <= span; s += step) ticks.push(`<span style="left:${s / span * 100}%">${ts(s).replace(/\.\d$/, "")}</span>`);
  const chips = lines().map((g, gi) => { const a = E.words[g[0]], b = E.words[g[g.length - 1]], text = esc(g.map(i => E.words[i].w).join(" "));
    return `<button class="ed-chip" data-ed="seek" data-g="${gi}" data-at="${a.s}" style="left:${pct(a.s)}%;width:${Math.max(0.6, pct(b.e) - pct(a.s))}%" title="${text}"><span>${text}</span></button>`; }).join("");
  E.gi = -1;
  tl.innerHTML = `<div class="ed-tl-head"><button class="ed-ib" data-ed="play" aria-label="Play or pause">${ic("play")}</button>
      <span class="ed-now" id="edNow"></span><span class="ed-tl-note">Space plays and pauses</span></div>
    <div class="ed-track" id="edTrack">
      <div class="ed-ruler">${ticks.join("")}</div>
      <div class="ed-lane caps">${chips}</div>
      <div class="ed-lane film" style="background-image:url('/media/${E.jid}/${esc(c.cover || "")}?v=${c.version}')"></div>
      <div class="ed-shade l" style="width:${pct(E.start)}%"></div><div class="ed-shade r" style="left:${pct(E.end)}%"></div>
      <div class="ed-win" style="left:${pct(E.start)}%;width:${pct(E.end) - pct(E.start)}%"><i class="ed-hd" data-h="start"></i><i class="ed-hd" data-h="end"></i></div>
      <div class="ed-head" id="edHead"></div>
    </div>`;
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
  E.edited = true;
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
  if (what.includes("p")) drawPanel();
  if (what.includes("t")) drawTimeline();
  E.lastKey = ""; paintOverlay(); drawClipDlg();
}
async function save() {
  const body = {start: E.start, end: E.end, hook: E.hook, title: E.title, description: E.description, layout: E.layout,
    captions: E.edited ? E.words : null};
  if (E.lookTouched) body.look = E.look;
  try {
    await send(`/api/jobs/${E.jid}/clips/${E.cid}/render`, body);
    E.saved = snap(); E.waiting = 1; E.version = clipNow()?.version || E.version;
    toast("Saved. Making your clip…", "ok"); await tick(); drawClipDlg();
  } catch (e) { toast(e.message, "bad"); }
}

/* ---------- events, all inside the editor */
const dlg = $("#clipdlg");
dlg.addEventListener("click", async e => {
  const b = e.target.closest("[data-ed]");
  if (!$e("#edExport")?.hidden && !e.target.closest(".ed-menu")) $e("#edExport").hidden = true;
  if (!b) return;
  const a = b.dataset.ed, d = b.dataset;
  if (a === "close") return edClose();
  if (a === "tab") { E.tab = d.t; return drawPanel(); }
  if (a === "view") { E.view = d.v; return drawStage(); }
  if (a === "play") return togglePlay();
  if (a === "seek") { if (E.view !== "live") { E.view = "live"; drawStage(); } return seek(+d.at); }
  if (a === "save") return save();
  if (a === "exportmenu") { const m = $e("#edExport"); m.hidden = !m.hidden; return; }
  if (a === "srt") {
    $e("#edExport").hidden = true;
    const url = URL.createObjectURL(new Blob([srtOut()], {type: "text/plain"}));
    const l = document.createElement("a"); l.href = url; l.download = `${(E.title || E.hook || "clip").replace(/[^\w\- ]+/g, "").trim() || "clip"}.srt`; l.click();
    return setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  if (a === "importsrt") { $e("#edExport").hidden = true; return $e("#edSrtFile").click(); }
  if (a === "resetcaps") { E.words = clone(E.auto.length ? E.auto : E.words); E.edited = false; return after("pt"); }
  if (a === "preset") { E.look = {...lookFromStyle(d.k), y: E.look.y, hook: E.look.hook}; E.lookTouched = true; return after("p"); }
  if (a === "brandpick") { if (e.target.closest("[data-ed=branddel]")) return; const s = E.brand[+d.k]; if (s) { E.look = clone(s.look); E.lookTouched = true; } return after("pt"); }
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
  if (a === "per") { E.look.per = +d.n; E.lookTouched = true; return after("pt"); }
  if (a === "upper") { E.look.upper = d.v === "1"; E.lookTouched = true; return after("p"); }
  if (a === "colour") { E.look[d.k] = d.v; E.lookTouched = true; return after("p"); }
  if (a === "layout") { E.layout = d.v; drawPanel(); return drawStage(); }
  if (a === "nudge") { setTrim(d.k, E[d.k] + +d.d); return after("pt"); }
  if (a === "toplayhead") { setTrim(d.k, nowT()); return after("pt"); }
});
dlg.addEventListener("input", e => {
  const el = e.target, k = el.dataset.look;
  if (k) {
    E.lookTouched = true;
    if (k === "font") E.look.font = el.value;
    else if (k === "base" || k === "active") { E.look[k] = el.value.toUpperCase(); el.parentElement.style.background = el.value; }
    else if (k === "hook") { E.look.hook = el.checked; const h = $e("#edHook"); if (h) h.disabled = !el.checked; }
    else { E.look[k] = +el.value; const o = el.parentElement.querySelector("output"); if (o) o.textContent = k === "y" ? el.value + "%" : el.value; }
    return after(k === "per" ? "t" : "");
  }
  if (el.id === "edHook") { E.hook = el.value; return after(""); }
  if (el.id === "edTitle") { E.title = el.value; return drawClipDlg(); }
  if (el.id === "edDesc") { E.description = el.value; return drawClipDlg(); }
});
dlg.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.line != null) { keepAuto(); editLine(+el.dataset.line, el.value); return after("pt"); }
  if (el.dataset.look === "base" || el.dataset.look === "active") return drawPanel();
  if (el.id === "edSrtFile" && el.files[0]) {
    el.files[0].text().then(t => { const w = srtIn(t); el.value = "";
      if (!w.length) return toast("No captions found in that file.", "bad");
      keepAuto(); E.words = w; E.edited = true; E.tab = "captions"; after("pt"); toast(`Imported ${w.length} words`, "ok"); });
  }
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
