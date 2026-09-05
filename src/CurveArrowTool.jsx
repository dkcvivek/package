"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  getDpr,
  getLogicalPointerPos,
  clearLogical,
} from "@/utils/canvasGeometry";

const CurveArrowTool = ({
  active,
  canvasRef,
  onFinishCurve,
  currentColor,
  strokeStyle,
  brushSize,
  addAction,
  replayManager,
  historyState,
  dprRef,
}) => {
  // Same ratio the editor sized the canvas at — see @/utils/canvasGeometry.
  const dpr = () => dprRef?.current || getDpr();

  const [drawing, setDrawing] = useState(false);
  const curveRef = useRef([]);
  const requestRef = useRef();

  // Unified ref keeps config fresh without thrashing canvas listeners
  const stateRef = useRef({
    drawing: false,
    currentColor,
    strokeStyle,
    brushSize,
    historyState,
    replayManager,
  });

  // Keep stateRef in sync whenever drawing configs or history update
  useEffect(() => {
    stateRef.current = {
      drawing,
      currentColor,
      strokeStyle,
      brushSize,
      historyState,
      replayManager,
    };
  }, [
    drawing,
    currentColor,
    strokeStyle,
    brushSize,
    historyState,
    replayManager,
  ]);

  // Helper to draw the arrowhead
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

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const {
      currentColor: color,
      brushSize: size,
      strokeStyle: style,
      historyState: hist,
      replayManager: replay,
    } = stateRef.current;

    // 1. Clear context for fresh rendering, in logical px (see CurveTool).
    clearLogical(ctx, dpr());

    // 2. Replay persistent history state
    if (replay?.current && hist?.actions) {
      const drawingActions = hist.actions.filter((a) => a.target === "drawing");
      drawingActions.forEach((a) => replay.current.applyDrawingAction(a));
    }

    // 3. Render current active curve stroke
    const pts = curveRef.current;
    if (pts.length >= 2) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);

      const start = pts[0];
      const end = pts[pts.length - 1];
      const mid =
        pts.length === 3
          ? pts[1]
          : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);

      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (style === "dashed") ctx.setLineDash([size * 3, size * 2]);
      else if (style === "dotted") ctx.setLineDash([size, size]);
      else ctx.setLineDash([]);

      ctx.stroke();
      ctx.setLineDash([]);

      // Render arrowheads on both ends
      drawArrowHead(ctx, mid, end, size, color);
      drawArrowHead(ctx, mid, start, size, color);
      ctx.restore();
    }
  }, [canvasRef]);

  // Handle external redraws during history mutations (e.g. undo/redo)
  useEffect(() => {
    if (active) renderCanvas();
  }, [historyState, active, renderCanvas]);

  const getEventPos = (e) =>
    getLogicalPointerPos(canvasRef.current, e, dpr());

  const handleStart = (e) => {
    if (!active) return;
    if (e.touches && e.touches.length > 1) return;

    const pos = getEventPos(e);
    curveRef.current = [pos, pos];
    setDrawing(true);
  };

  const handleMove = (e) => {
    if (!stateRef.current.drawing) return;
    if (e.cancelable) e.preventDefault();

    const pos = getEventPos(e);
    const start = curveRef.current[0];
    if (!start) return;

    // Generate midpoint arc offset
    const midPoint = {
      x: (start.x + pos.x) / 2 + (pos.y - start.y) * 0.15,
      y: (start.y + pos.y) / 2 - (pos.x - start.x) * 0.15,
    };

    curveRef.current = [start, midPoint, pos];

    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(renderCanvas);
  };

  const handleEnd = () => {
    if (!stateRef.current.drawing) return;
    setDrawing(false);
    cancelAnimationFrame(requestRef.current);

    if (curveRef.current.length >= 2) {
      const {
        currentColor: color,
        brushSize: size,
        strokeStyle: style,
      } = stateRef.current;

      const action = {
        target: "drawing",
        type: "DRAW_CURVE_ARROW",
        payload: {
          points: [...curveRef.current],
          color,
          strokeWidth: size,
          strokeStyle: style,
        },
      };
      addAction(action);
      if (onFinishCurve) onFinishCurve(curveRef.current);
    }
    curveRef.current = [];
  };

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Tap/touch triggers inside the viewport canvas bounds
    canvas.addEventListener("mousedown", handleStart);
    canvas.addEventListener("touchstart", handleStart, { passive: false });

    // Track move, finish, or gesture drop on the global context to avoid getting stuck
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);

    return () => {
      canvas.removeEventListener("mousedown", handleStart);
      canvas.removeEventListener("touchstart", handleStart);

      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, [active, canvasRef]);

  return null;
};

export default CurveArrowTool;
