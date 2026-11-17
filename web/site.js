/* A soft tap sound when someone presses a button or link on the public site.
   The sound is made in the browser (Web Audio), so there is no file to download. It plays on press, not release,
   so it lands with the finger; a keyboard press (Enter or Space) plays it too. */
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx = null;
  const TARGET = "a[href], button, summary, [role=button], .btn";

  function tap() {
    try {
      ctx = ctx || new AC();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      // a short pitched click: a quick drop in pitch, gone in about 60 ms
      const osc = ctx.createOscillator(), gain = ctx.createGain(), tone = ctx.createBiquadFilter();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.05);
      tone.type = "lowpass"; tone.frequency.value = 3200;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(tone).connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.07);
    } catch (_) { /* no sound is fine */ }
  }

  addEventListener("pointerdown", e => {
    if (e.button !== 0 || !e.target.closest(TARGET) || e.target.closest(":disabled")) return;
    tap();
  }, {passive: true});
  // keyboard: a click with no pointer behind it
  addEventListener("click", e => { if (e.detail === 0 && e.target.closest(TARGET)) tap(); });
})();
