/* Plays the product shots once each, when they come into view: the meter fills, the clips arrive, one is posted.
   With reduced motion, or before this runs, every shot simply shows its last frame. */
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const play = w => {
    if (w.dataset.played) return; w.dataset.played = "1";
    if (still) return w.classList.add("work", "done", "posted");
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add("work")));
    setTimeout(() => w.classList.add("done"), 2100);
    setTimeout(() => w.classList.add("posted"), 3400);
  };
  const all = document.querySelectorAll("[data-shot]");
  if (!("IntersectionObserver" in window)) return all.forEach(play);
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { play(e.target); io.unobserve(e.target); } }), {threshold: .25});
  all.forEach(w => io.observe(w));
})();
