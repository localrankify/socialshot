/* Plays the product shots once each, when they come into view: the meter fills, the clips arrive, one is posted.
   Then a pointer keeps working in it: it looks at a clip, opens another, trims it and saves, and looks at the next.
   With reduced motion, or before this runs, every shot simply shows its last frame. */
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function edit(w) {
    const shot = w.querySelector(".shot"), clips = [...w.querySelectorAll(".shot-clip:not(.dim)")];
    if (!shot || clips.length < 3) return;
    const target = clips[1], vid = target.querySelector(".vid"), len = target.querySelector(".len"), was = len ? len.textContent : "";
    const cur = document.createElement("i");
    cur.className = "sx-cur"; cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = '<svg viewBox="0 0 20 20"><path d="M3 2l14 7.2-6.1 1.6L7.6 17z"/></svg><b>You</b>';
    shot.appendChild(cur);
    const ed = document.createElement("div");
    ed.className = "sx-ed"; ed.setAttribute("aria-hidden", "true");
    ed.innerHTML = `<small><span>Trim</span><b>${was}</b></small><div class="sx-tr"><i></i></div>`;
    vid.appendChild(ed);
    const label = ed.querySelector("span"), time = ed.querySelector("b"), track = ed.querySelector(".sx-tr");

    const go = async (el, fx = .5, fy = .45, ms = 900) => {
      const s = shot.getBoundingClientRect(), r = el.getBoundingClientRect();
      cur.style.transitionDuration = ms + "ms,.3s";
      cur.style.transform = `translate(${r.left - s.left + r.width * fx}px,${r.top - s.top + r.height * fy}px)`;
      await sleep(ms + 80);
    };
    const press = async () => { cur.classList.add("down"); await sleep(150); cur.classList.remove("down"); };

    (async () => {
      const s = shot.getBoundingClientRect();
      cur.style.transitionDuration = "0ms";
      cur.style.transform = `translate(${s.width * .82}px,${s.height * .82}px)`;
      await sleep(60); cur.classList.add("on");
      for (;;) {
        if (document.hidden) { await sleep(1000); continue; }
        await go(clips[0]); clips[0].classList.add("hov"); await sleep(1100); clips[0].classList.remove("hov");
        await go(target); target.classList.add("hov"); await press(); target.classList.add("edit"); await sleep(600);
        await go(track, .97, .5, 600); await press();
        ed.style.setProperty("--cut", "24%"); await go(track, .74, .5, 1200);
        time.textContent = "0:44"; if (len) len.textContent = "0:44";
        await sleep(500); ed.classList.add("saved"); label.textContent = "Saved"; await sleep(1500);
        target.classList.remove("edit", "hov"); await sleep(400);
        ed.classList.remove("saved"); label.textContent = "Trim"; ed.style.setProperty("--cut", "0%"); time.textContent = was; if (len) len.textContent = was;
        await go(clips[2]); clips[2].classList.add("hov"); await sleep(1200); clips[2].classList.remove("hov"); await sleep(900);
      }
    })();
  }

  const play = w => {
    if (w.dataset.played) return; w.dataset.played = "1";
    if (still) return w.classList.add("work", "done", "posted");
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add("work")));
    setTimeout(() => w.classList.add("done"), 2100);
    setTimeout(() => w.classList.add("posted"), 3400);
    setTimeout(() => edit(w), 4600);
  };
  const all = document.querySelectorAll("[data-shot]");
  if (!("IntersectionObserver" in window)) return all.forEach(play);
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { play(e.target); io.unobserve(e.target); } }), {threshold: .25});
  all.forEach(w => io.observe(w));
})();
