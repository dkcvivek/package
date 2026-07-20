/**
 * ActionCreators Utility
 * Standardizes action payloads across the Canvas drawing timeline layers.
 * Supports freehand tracks, vector overlays, filters, and custom curves.
 */
export const ActionCreators = {
  // ── Vector Elements (Konva Layer) ──────────────────────────────────────────
  
  createKonvaAction: (type, elementId, elementType, data, previousData = null) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "konva",
    type,
    payload: {
      elementId,
      elementType,
      data,
      previousData,
      timestamp: Date.now()
    }
  }),

  // ── Standard Core Drawing Elements (Canvas Overlays) ───────────────────────

  drawFreehandPath: (points, color, brushSize, strokeStyle, tool = "pencil") => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "drawing",
    type: "ADD_FREEHAND_PATH",
    payload: {
      tool,
      points, // Array of { x, y } coordinates
      color,
      size: brushSize,
      style: strokeStyle,
      timestamp: Date.now()
    }
  }),

  drawLine: (startPoint, endPoint, color, brushSize, strokeStyle) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "drawing",
    type: "DRAW_LINE",
    payload: {
      startPoint,
      endPoint,
      color,
      size: brushSize,
      style: strokeStyle,
      timestamp: Date.now()
    }
  }),

  // ── Spline & Bezier Elements (Curve Tracking Components) ──────────────────

  drawCurve: (points, color, brushSize, strokeStyle) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "drawing",
    type: "DRAW_CURVE",
    payload: {
      points, // Array of selected plot control vectors
      color,
      size: brushSize,
      style: strokeStyle,
      timestamp: Date.now()
    }
  }),

  drawCurveArrow: (points, color, brushSize, strokeStyle) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "drawing",
    type: "DRAW_CURVE_ARROW",
    payload: {
      points,
      color,
      size: brushSize,
      style: strokeStyle,
      timestamp: Date.now()
    }
  }),

  // ── Image Geometry Adjustments (Base Photograph Layer) ────────────────────

  cropImage: (cropArea, previousImageData) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "base",
    type: "CROP_IMAGE",
    payload: {
      cropArea, // Coordinates mapping spatial dimensions {x, y, width, height}
      imageData: previousImageData, // Cached array backup for undo rollbacks
      timestamp: Date.now()
    }
  }),

  // ── Pixel-Level Raster Filters (OpenCV Engine) ─────────────────────────────

  applyFilter: (filterType, previousImageData, nextImageData) => ({
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    target: "base",
    type: "APPLY_FILTER",
    payload: {
      filterType,     // "blackAndWhite" | "pencilSketch"
      prev: previousImageData, // Snapshots used by timeline managers to
      next: nextImageData,     // hot-swap image buffers during history hops
      timestamp: Date.now()
    }
  })
};

