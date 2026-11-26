// Visual effects only (no contract logic): drifting gold particles, card spotlight, live block counter.
// Safe to remove: pages work the same without it.
(function () {
  "use strict";
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1) floating gold particles
  if (!reduce) {
    const c = document.createElement("canvas");
    c.id = "tl-fx";
    const ctx = c.getContext && c.getContext("2d");
    if (ctx) document.body.prepend(c);
    let w, h, dots = [], raf;
    const rnd = (a, b) => a + Math.random() * (b - a);
    function resize() {
      w = c.width = window.innerWidth; h = c.height = window.innerHeight;
      const count = Math.min(90, Math.round((w * h) / 20000));
      dots = Array.from({ length: count }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(.8, 2.6), vy: rnd(.08, .35), vx: rnd(-.08, .08), a: rnd(.35, .95), p: rnd(0, 6.28) }));
    }
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.vy; d.x += d.vx + Math.sin(t / 2500 + d.p) * .08;
        if (d.y < -5) { d.y = h + 5; d.x = rnd(0, w); }
        const tw = .6 + .4 * Math.sin(t / 700 + d.p);
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283);
        ctx.fillStyle = `rgba(246,220,130,${d.a * tw})`; ctx.shadowColor = "rgba(212,175,55,.9)"; ctx.shadowBlur = 8; ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    if (ctx) { resize(); window.addEventListener("resize", resize); raf = requestAnimationFrame(frame); }
    if (ctx) document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame); });
  }

  // decorative chain of blocks under the header (a light pulse travels along it)
  const header = document.querySelector("header.top");
  if (header) {
    const strip = document.createElement("div");
    strip.className = "tl-chain"; strip.setAttribute("aria-hidden", "true");
    const N = 9;
    for (let i = 0; i < N; i++) {
      const b = document.createElement("span"); b.className = "blk"; b.style.animationDelay = (i * 0.32) + "s"; strip.appendChild(b);
      if (i < N - 1) { const l = document.createElement("span"); l.className = "lnk"; strip.appendChild(l); }
    }
    header.after(strip);
  }

  // 2) card spotlight follows the pointer
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest && e.target.closest(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", e.clientX - r.left + "px");
    card.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });

  // 3) live block counter (real data from the connected node; hidden if there is no wallet or node)
  const host = document.querySelector(".wallet");
  if (host && window.ethereum && window.ethereum.request) {
    const el = document.createElement("span");
    el.className = "tl-live"; el.hidden = true; el.title = "Latest block seen by your wallet's network";
    el.innerHTML = "<i></i><span>Block <b>-</b></span>";
    host.prepend(el);
    let last = null;
    async function poll() {
      try {
        const hex = await window.ethereum.request({ method: "eth_blockNumber" });
        const n = parseInt(hex, 16);
        el.hidden = false;
        if (n !== last) {
          el.querySelector("b").textContent = n.toLocaleString();
          if (last !== null) { el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); }
          last = n;
        }
      } catch (_) { el.hidden = true; }
    }
    poll(); setInterval(() => { if (!document.hidden) poll(); }, 3000);
  }
})();
