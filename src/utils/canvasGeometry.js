/**
 * Canvas coordinate-space helpers for the image editor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT (read this before touching any canvas code)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every editor canvas is a HiDPI canvas:
 *
 *   canvas.width  = logicalWidth  * dpr   ← backing store, "device pixels"
 *   canvas.height = logicalHeight * dpr
 *   ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
 *
 * That means there are TWO coordinate systems and mixing them is what causes
 * blurred / shifted / stretched output:
 *
 *   LOGICAL px  → everything you *draw* (moveTo, lineTo, fillRect, drawImage
 *                 destination, Konva shape coords, cropArea, canvasDimensions).
 *                 The ctx transform scales these up for you.
 *
 *   DEVICE px   → canvas.width / canvas.height, getImageData / putImageData
 *                 (these APIs ignore the ctx transform), and any drawImage that
 *                 runs while the transform is reset to identity.
 *
 * Rule of thumb: if you typed `canvas.width` inside a drawing call, it is
 * almost certainly a bug — you wanted `logicalSize(canvas, dpr).width`.
 */

/** Upper bound on the device pixel ratio we honour. */
const MAX_DPR = 3;

/**
 * Device pixel ratio, clamped.
 *
 * Some Android devices report 3.5–4. Squaring that into a canvas backing store
 * (w * h * dpr^2 * 4 bytes) is enough to blow the per-canvas memory budget on
 * low-end phones and hit Safari's ~16.7M px canvas ceiling, for no visible
 * quality gain. Clamping keeps the editor crisp without the memory cliff.
 *
 * @returns {number}
 */
export function getDpr() {
  if (typeof window === "undefined") return 1;
  const raw = window.devicePixelRatio || 1;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, MAX_DPR);
}

/**
 * The canvas size in LOGICAL px — i.e. the coordinate space drawing calls use.
 *
 * @param {HTMLCanvasElement | null | undefined} canvas
 * @param {number} dpr
 * @returns {{ width: number, height: number }}
 */
export function logicalSize(canvas, dpr) {
  const d = dpr || 1;
  if (!canvas) return { width: 0, height: 0 };
  return { width: canvas.width / d, height: canvas.height / d };
}

/**
 * Converts a mouse/touch event into LOGICAL canvas coordinates.
 *
 * Deliberately scale-aware: the canvas is laid out with `w-full h-full` inside
 * a box that carries `max-width/max-height: 100%`, so its CSS size can end up
 * smaller than its logical size. When that happens `clientX - rect.left` alone
 * is wrong and strokes land away from the finger. Scaling by
 * logicalWidth / rect.width is a no-op in the normal case and a correction in
 * the clamped one.
 *
 * @param {HTMLCanvasElement | null | undefined} canvas
 * @param {MouseEvent | TouchEvent | React.SyntheticEvent} e
 * @param {number} dpr
 * @returns {{ x: number, y: number }}
 */
export function getLogicalPointerPos(canvas, e, dpr) {
  if (!canvas) return { x: 0, y: 0 };

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };

  const touch = e.touches?.[0] || e.changedTouches?.[0];
  const clientX = touch ? touch.clientX : e.clientX;
  const clientY = touch ? touch.clientY : e.clientY;
  if (clientX == null || clientY == null) return { x: 0, y: 0 };

  const { width, height } = logicalSize(canvas, dpr);
  return {
    x: (clientX - rect.left) * (width / rect.width),
    y: (clientY - rect.top) * (height / rect.height),
  };
}

/**
 * Clears the whole canvas using LOGICAL coordinates, so it works while the
 * dpr transform is active.
 *
 * @param {CanvasRenderingContext2D | null | undefined} ctx
 * @param {number} dpr
 */
export function clearLogical(ctx, dpr) {
  if (!ctx) return;
  const { width, height } = logicalSize(ctx.canvas, dpr);
  ctx.clearRect(0, 0, width, height);
}

/**
 * Runs `fn` with the context transform reset to identity, then restores the
 * dpr transform. Use for device-pixel work: compositing one canvas onto
 * another 1:1, snapshot blits, etc.
 *
 * @template T
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} dpr
 * @param {(ctx: CanvasRenderingContext2D) => T} fn
 * @returns {T | undefined}
 */
export function withDeviceSpace(ctx, dpr, fn) {
  if (!ctx) return undefined;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    return fn(ctx);
  } finally {
    ctx.setTransform(dpr || 1, 0, 0, dpr || 1, 0, 0);
  }
}

/**
 * Resizes a canvas to `logicalW x logicalH` at `dpr` and re-applies the dpr
 * transform. Assigning to canvas.width/height resets *all* context state
 * (transform, composite op, stroke style), so the transform must always be
 * re-applied afterwards — this keeps the two steps together.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} logicalW
 * @param {number} logicalH
 * @param {number} dpr
 * @returns {CanvasRenderingContext2D | null}
 */
export function resizeCanvasToLogical(canvas, logicalW, logicalH, dpr) {
  if (!canvas) return null;
  const d = dpr || 1;
  canvas.width = Math.max(1, Math.round(logicalW * d));
  canvas.height = Math.max(1, Math.round(logicalH * d));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return ctx;
}
