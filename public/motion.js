"use strict";
(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const toggle = document.getElementById("motion-toggle");
  const stages = [...document.querySelectorAll("[data-parallax-stage]")];
  let preference = "auto";
  try {
    preference = localStorage.getItem("taptap-motion-v1") || "auto";
  } catch {}
  let enabled = false;
  let frame = 0;
  let stageVisible = false;
  let lastPaint = 0;
  const hero = document.getElementById("hero-art");
  const canvas = document.getElementById("signal-canvas");
  const context = canvas?.getContext("2d");
  let width = 0,
    height = 0;
  const particles = Array.from({ length: 26 }, () => ({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * Math.PI * 2,
    speed: 0.15 + Math.random() * 0.3,
  }));
  const revealObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                entry.target.classList.add("is-revealed");
                revealObserver.unobserve(entry.target);
              }
          },
          { threshold: 0.06, rootMargin: "0px 0px 25px 0px" },
        )
      : null;
  const observed = new WeakSet();
  const revealedKeys = new Set();
  function observeCards() {
    if (!revealObserver || !enabled) return;
    root.classList.add("motion-ready");
    const active = document.querySelector(".view.active");
    active
      ?.querySelectorAll(".panel, .stat-card, .nft-card, .mint-process")
      .forEach((element, i) => {
        if (observed.has(element)) return;
        observed.add(element);
        const item = element.querySelector("[data-nft-inspect]")?.getAttribute("data-nft-inspect");
        const key = active.id + ":" + (element.parentElement?.id || "panels") + ":" + (item || i);
        if (revealedKeys.has(key)) return;
        revealedKeys.add(key);
        element.style.setProperty("--reveal-delay", Math.min(i % 3, 2) * 65 + "ms");
        element.classList.add("reveal-pending");
        revealObserver.observe(element);
      });
  }
  function resizeCanvas() {
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function paint(timestamp) {
    frame = 0;
    if (!enabled || !stageVisible || document.hidden || !context || !width || !height) return;
    frame = requestAnimationFrame(paint);
    if (timestamp - lastPaint < 40) return;
    lastPaint = timestamp;
    context.clearRect(0, 0, width, height);
    const positions = particles.map((p) => ({
      x: p.x * width + Math.sin(timestamp * 0.00012 * p.speed + p.phase) * 12,
      y: p.y * height + Math.cos(timestamp * 0.00015 * p.speed + p.phase) * 20,
    }));
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      context.fillStyle = "#dfff7050";
      context.fillRect(p.x, p.y, 1.5, 1.5);
      for (let j = i + 1; j < positions.length; j++) {
        const q = positions[j],
          distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance > 75) continue;
        context.strokeStyle = `rgba(190,225,110,${0.1 * (1 - distance / 75)})`;
        context.beginPath();
        context.moveTo(p.x, p.y);
        context.lineTo(q.x, q.y);
        context.stroke();
      }
    }
  }
  function scheduleCanvas() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (enabled && stageVisible && !document.hidden) {
      resizeCanvas();
      frame = requestAnimationFrame(paint);
    } else if (context) context.clearRect(0, 0, width, height);
  }
  function applyMotion() {
    enabled = !reduce.matches && preference !== "paused";
    root.dataset.motion = enabled ? "on" : "paused";
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(!enabled));
      toggle.setAttribute(
        "aria-label",
        enabled ? "Pause decorative motion" : "Enable decorative motion",
      );
      toggle.innerHTML =
        '<span aria-hidden="true">' +
        (enabled ? "Ⅱ" : "▷") +
        "</span> " +
        (enabled ? "Motion on" : "Motion off");
      toggle.disabled = reduce.matches;
      toggle.title = reduce.matches
        ? "Reduced motion is enabled in your device settings."
        : "Pause or resume decorative animations";
    }
    if (!enabled)
      stages.forEach((s) => {
        s.style.setProperty("--pointer-x", "0");
        s.style.setProperty("--pointer-y", "0");
      });
    observeCards();
    scheduleCanvas();
  }
  toggle?.addEventListener("click", () => {
    preference = enabled ? "paused" : "on";
    try {
      localStorage.setItem("taptap-motion-v1", preference);
    } catch {}
    applyMotion();
  });
  reduce.addEventListener("change", applyMotion);
  const visibilityObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries)
            if (entry.target === hero) {
              stageVisible = entry.isIntersecting;
              scheduleCanvas();
            }
        })
      : null;
  if (hero && visibilityObserver) visibilityObserver.observe(hero);
  if (canvas && "ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(canvas);
  document.addEventListener("visibilitychange", scheduleCanvas);
  let pointerFrame = 0,
    pendingStage,
    pointerX = 0,
    pointerY = 0;
  for (const stage of stages) {
    stage.addEventListener(
      "pointermove",
      (event) => {
        if (!enabled || !finePointer.matches) return;
        const bounds = stage.getBoundingClientRect();
        pendingStage = stage;
        pointerX = Math.max(
          -1,
          Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
        );
        pointerY = Math.max(
          -1,
          Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
        );
        if (!pointerFrame)
          pointerFrame = requestAnimationFrame(() => {
            pointerFrame = 0;
            if (!enabled || !pendingStage) return;
            pendingStage.style.setProperty("--pointer-x", pointerX.toFixed(3));
            pendingStage.style.setProperty("--pointer-y", pointerY.toFixed(3));
          });
      },
      { passive: true },
    );
    stage.addEventListener("pointerleave", () => {
      if (pendingStage === stage) {
        pendingStage = null;
        if (pointerFrame) cancelAnimationFrame(pointerFrame);
        pointerFrame = 0;
      }
      stage.style.setProperty("--pointer-x", "0");
      stage.style.setProperty("--pointer-y", "0");
    });
  }
  const designButtons = [...document.querySelectorAll("[data-mint-design]")];
  const showcase = document.querySelector(".mint-showcase");
  const featureImage = document.getElementById("mint-feature-image");
  let manualUntil = 0,
    designIndex = 0,
    showcaseVisible = false;
  function selectDesign(id, manual = false) {
    if (!featureImage || !designButtons.some((b) => b.dataset.mintDesign === String(id))) return;
    designIndex = designButtons.findIndex((b) => b.dataset.mintDesign === String(id));
    designButtons.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mintDesign === String(id))),
    );
    featureImage.src = "/api/nft/preview/v2/" + id + ".png";
    featureImage.alt = "Nib collection design " + id;
    document.getElementById("mint-feature-name").textContent =
      "NIB #" + String(id).padStart(5, "0");
    if (enabled && featureImage.animate)
      featureImage.animate(
        [
          { opacity: 0.35, filter: "blur(4px)" },
          { opacity: 1, filter: "blur(0)" },
        ],
        { duration: 400, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    if (manual) manualUntil = Date.now() + 30000;
  }
  designButtons.forEach((button) =>
    button.addEventListener("click", () => selectDesign(Number(button.dataset.mintDesign), true)),
  );
  if (showcase && "IntersectionObserver" in window)
    new IntersectionObserver((entries) => {
      showcaseVisible = entries[0].isIntersecting;
    }).observe(showcase);
  if (showcase)
    setInterval(() => {
      if (
        !enabled ||
        !showcaseVisible ||
        document.hidden ||
        Date.now() < manualUntil ||
        showcase.matches(":hover, :focus-within")
      )
        return;
      selectDesign(
        Number(designButtons[(designIndex + 1) % designButtons.length]?.dataset.mintDesign),
      );
    }, 7500);
  document.querySelectorAll("[data-quantity-delta]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = document.getElementById("nft-quantity");
      if (!input) return;
      input.value = String(
        Math.max(
          Number(input.min) || 1,
          Math.min(
            Number(input.max) || 10,
            Math.round(Number(input.value) || 1) + Number(button.dataset.quantityDelta),
          ),
        ),
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }),
  );
  const values = new Map();
  function onRender() {
    observeCards();
    if (!enabled) return;
    for (const id of ["total-points", "season-score", "connection-status", "nft-minted"]) {
      const element = document.getElementById(id);
      if (!element) continue;
      const value = element.textContent;
      if (values.has(id) && values.get(id) !== value) {
        element.classList.remove("value-changed");
        requestAnimationFrame(() => element.classList.add("value-changed"));
      }
      values.set(id, value);
    }
  }
  window.addEventListener("taptap:view", () => {
    requestAnimationFrame(observeCards);
    scheduleCanvas();
  });
  window.addEventListener("taptap:rendered", onRender);
  window.addEventListener("taptap:nft-rendered", onRender);
  applyMotion();
})();
