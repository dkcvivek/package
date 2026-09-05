import { getDpr } from "@/utils/canvasGeometry";

/**
 * Rasterises a whole Konva Stage, at device resolution, in stage coordinates.
 *
 * Why this exists — `stage.toCanvas()` does NOT give you the stage.
 *
 * `Stage` does not override `getClientRect()`, so it inherits the `Container`
 * implementation: the union of its children's bounding boxes. Konva's
 * `Node._toKonvaCanvas()` then uses that box for both the output size and a
 * `context.translate(-box.x, -box.y)`. The result is a canvas cropped tight
 * around whatever shapes happen to be on the stage, with the top-left of that
 * crop at pixel (0, 0).
 *
 * So a bare `stage.toCanvas()` returns a small image of just the shapes, with
 * every coordinate rebased. Composite it onto the drawing layer and the
 * annotation lands somewhere other than where the user drew it:
 *
 *   - drawn 1:1 at (0,0)  → the shape jumps to the top-left corner
 *   - stretched to fill   → the shape jumps AND scales up
 *
 * Passing explicit `x`/`y`/`width`/`height` opts out of the bounding-box path
 * entirely (`_toKonvaCanvas` skips the translate when x and y are both 0), so
 * the snapshot is the full stage with every shape still at its own coordinates.
 * Then, and only then, is a 1:1 device-pixel blit onto the drawing canvas
 * correct.
 *
 * @param {import("konva/lib/Stage").Stage | null | undefined} stage
 * @param {number} [pixelRatio] - defaults to the editor's clamped DPR
 * @returns {HTMLCanvasElement | null}
 */
export function snapshotStage(stage, pixelRatio) {
  if (!stage) return null;

  const width = stage.width();
  const height = stage.height();
  if (!width || !height) return null;

  return stage.toCanvas({
    x: 0,
    y: 0,
    width,
    height,
    pixelRatio: pixelRatio || getDpr(),
  });
}
