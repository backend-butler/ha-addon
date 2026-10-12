// Keep the composer on top of the iOS keyboard inside HA's app. The app runs in a same-origin iframe;
// iOS shrinks the PARENT's visual viewport for the keyboard, while our own may not change. So measure
// how far the keyboard covers the iframe and publish it as --kb-inset (see viewport.css).

/** Pixels of the frame's bottom edge that sit under the keyboard (0 when closed). */
export function keyboardInset(m: { frameBottom: number; vvTop: number; vvHeight: number }): number {
  return Math.max(0, Math.round(m.frameBottom - (m.vvTop + m.vvHeight)));
}

/** Follow the parent window's visualViewport; does nothing unframed, cross-origin, on a fine pointer, or without it. */
export function installViewport(): void {
  try {
    if (typeof window === "undefined" || window.parent === window) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const vv = window.parent.visualViewport;
    const frame = window.frameElement;
    if (!vv || !frame) return;

    let queued = false;
    const apply = () => {
      queued = false;
      try {
        const inset = keyboardInset({ frameBottom: frame.getBoundingClientRect().bottom, vvTop: vv.offsetTop, vvHeight: vv.height });
        document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
      } catch {
        // parent went away or turned cross-origin: keep the last value
      }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(apply);
    };
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    apply();
  } catch {
    // cross-origin parent or missing APIs: nothing to do
  }
}
