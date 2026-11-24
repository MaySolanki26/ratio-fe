/**
 * The app's display size (Settings → Feature preferences: 80 / 90 / 100 / 110 %, default 100) is CSS `zoom` on <html>,
 * set by AppShell. In a zoomed page,
 * screen coordinates — getBoundingClientRect, event clientX / clientY, innerWidth / innerHeight — are in ZOOMED
 * pixels, while CSS lengths we set (left, top, width, transforms) are in page pixels. Divide screen values by this.
 */
export const pageZoom = (): number => {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
};

/** A screen rectangle converted to page pixels */
export const unzoomRect = (r: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) => {
  const z = pageZoom();
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
};

/** The viewport size in page pixels */
export const viewport = () => {
  const z = pageZoom();
  return { vw: window.innerWidth / z, vh: window.innerHeight / z };
};
