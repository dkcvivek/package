const drawArrowHead = (ctx, from, to, size, color) => {
  const headLength = Math.max(10, size * 2.5);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.9);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(
    to.x - headLength * Math.cos(angle - Math.PI / 6),
    to.y - headLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle + Math.PI / 6),
    to.y - headLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
  ctx.restore();
};

export function applyDrawingAction(ctx, action) {
  if (!ctx || !action?.payload) return;

  const { type, payload } = action;
  ctx.save();

  // ── Pencil / Eraser ──────────────────────────────────────────────────────
  if (type === "DRAW_PENCIL" || type === "DRAW_ERASER") {
    const { points, color, strokeWidth, isEraser } = payload;
    if (!points?.length) {
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.strokeStyle = color || "#000000";
    ctx.lineWidth = strokeWidth || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  // ── Straight line ────────────────────────────────────────────────────────
  if (type === "DRAW_LINE") {
    const { startPoint, endPoint, color, strokeWidth, strokeStyle } = payload;
    if (!startPoint || !endPoint) {
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color || "#000000";
    ctx.lineWidth = strokeWidth || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    switch (strokeStyle) {
      case "dashed":
        ctx.setLineDash([strokeWidth * 3, strokeWidth * 2]);
        break;
      case "dotted":
        ctx.setLineDash([strokeWidth, strokeWidth]);
        break;
      default:
        ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.stroke();
  }

  if (type === "DRAW_CURVE") {
    const { points, color, strokeWidth, strokeStyle } = payload;
    if (!points || points.length < 2) {
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color || "#000000";
    ctx.lineWidth = strokeWidth || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    switch (strokeStyle) {
      case "dashed":
        ctx.setLineDash([strokeWidth * 3, strokeWidth * 2]);
        break;
      case "dotted":
        ctx.setLineDash([strokeWidth, strokeWidth]);
        break;
      default:
        ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    // Use the same Bezier logic as the Tool for consistency
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  if (type === "DRAW_CURVE_ARROW") {
    const { points, color, strokeWidth, strokeStyle } = payload;
    if (!points || points.length < 2) {
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Dash Logic
    if (strokeStyle === "dashed")
      ctx.setLineDash([strokeWidth * 3, strokeWidth * 2]);
    else if (strokeStyle === "dotted")
      ctx.setLineDash([strokeWidth, strokeWidth]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 3) {
      // Matches the tool's MidPoint logic
      ctx.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y);
    } else {
      ctx.lineTo(points[1].x, points[1].y); // Fallback for 2 points
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw arrow heads at BOTH ends
    const start = points[0];
    const end = points[points.length - 1];
    const mid =
      points.length === 3
        ? points[1]
        : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

    drawArrowHead(ctx, mid, end, strokeWidth, color);
    drawArrowHead(ctx, mid, start, strokeWidth, color);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Clears the canvas then replays every drawing action in the provided list.
 * Call this with the slice of history up to the current step.
 */
export function replayAllDrawingActions(canvas, actions) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  // The canvas is HiDPI: canvas.width is DEVICE px while the active transform
  // scales draw calls from logical px. Clear the buffer with the transform
  // reset so the full backing store is wiped regardless of the ratio, then put
  // the transform back — action payloads are all in logical px.
  const t = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(t);
  ctx.globalCompositeOperation = "source-over";

  actions
    .filter((a) => a.target === "drawing")
    .forEach((a) => applyDrawingAction(ctx, a));
}
