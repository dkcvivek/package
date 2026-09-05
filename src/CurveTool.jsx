"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  getDpr,
  getLogicalPointerPos,
  clearLogical,
} from "@/utils/canvasGeometry";

export const CurveTool = ({
  active,
  canvasRef,
  onFinishCurve,
  setActiveTool,
  currentColor,
  strokeStyle,
  brushSize,
  createAction,
  addAction,
  replayManager,
  historyState,
  dprRef,
}) => {
  // Same ratio the editor sized the canvas at — see @/utils/canvasGeometry.
  const dpr = () => dprRef?.current || getDpr();

  const [curves, setCurves] = useState([]);
  const [currentCurve, setCurrentCurve] = useState([]);
  const [selectedCurveIndex, setSelectedCurveIndex] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [drawing, setDrawing] = useState(false);

  // Group all dynamic states inside a ref to ensure stable event bindings
  const stateRef = useRef({
    drawing: false,
    currentCurve,
    currentColor,
    brushSize,
    strokeStyle,
    curves,
    dragging,
    selectedCurveIndex,
    historyState,
    replayManager,
  });

  // Keep ref up-to-date with current states
  useEffect(() => {
    stateRef.current = {
      drawing,
      currentCurve,
      currentColor,
      brushSize,
      strokeStyle,
      curves,
      dragging,
      selectedCurveIndex,
      historyState,
      replayManager,
    };
  }, [
    drawing,
    currentCurve,
    currentColor,
    brushSize,
    strokeStyle,
    curves,
    dragging,
    selectedCurveIndex,
    historyState,
    replayManager,
  ]);

  // Logical canvas coordinates for both mouse and touch. Must match the space
  // ImageEditorModal draws in, or curves land away from the finger.
  const getPointerPos = (e) =>
    getLogicalPointerPos(canvasRef.current, e, dpr());

  const drawBezier = (ctx, points, color, size, style) => {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

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

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (style === "dashed") ctx.setLineDash([size * 3, size * 2]);
    else if (style === "dotted") ctx.setLineDash([size, size]);
    else ctx.setLineDash([]);

    ctx.stroke();
    ctx.setLineDash([]);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const {
      curves: localCurves,
      currentCurve: currCurve,
      drawing: isDrawing,
      selectedCurveIndex: selIdx,
      currentColor: color,
      brushSize: size,
      strokeStyle: style,
      historyState: hist,
      replayManager: replay,
    } = stateRef.current;

    // Clear and redraw background history. Clear in logical px — the CSS box
    // (getBoundingClientRect) can be smaller than the logical canvas and would
    // leave a stale band of the previous frame along the right/bottom edge.
    clearLogical(ctx, dpr());
    if (replay?.current) {
      const drawingActions = hist?.actions?.filter(
        (a) => a.target === "drawing",
      );
      drawingActions?.forEach((a) => replay.current.applyDrawingAction(a));
    }

    // Draw finished curves (local state)
    localCurves.forEach((curve, idx) => {
      drawBezier(ctx, curve, color, size, style);
      if (selIdx === idx) {
        curve.forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        });
      }
    });

    // Draw curve currently being created
    if (isDrawing && currCurve.length > 0) {
      const previewPoints = [...currCurve];
      if (mousePos) previewPoints.push(mousePos);
      drawBezier(ctx, previewPoints, color, size, style);

      // Dash line to current mouse position
      const lastPoint = currCurve[currCurve.length - 1];
      if (mousePos) {
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = color;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
      }
    }
  }, [canvasRef, mousePos]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleFinish = useCallback(() => {
    const {
      currentCurve: currCurve,
      currentColor: color,
      brushSize: size,
      strokeStyle: style,
    } = stateRef.current;

    if (currCurve.length > 1) {
      const action = createAction("drawing", "DRAW_CURVE", {
        points: currCurve,
        color,
        strokeWidth: size,
        strokeStyle: style,
      });
      addAction(action);

      // Local cleanups
      setCurrentCurve([]);
      setDrawing(false);
      setActiveTool(null); // This safely unmounts the tool
    }
  }, [addAction, createAction, setActiveTool]);

  const handleStart = (e) => {
    if (e.type === "touchstart") e.preventDefault();

    const pos = getPointerPos(e);
    const {
      drawing: isDrawing,
      currentCurve: currCurve,
      curves: localCurves,
    } = stateRef.current;

    if (isDrawing) {
      // Tap-to-Finalize: Tap very close to the last point to save curve immediately
      const lastPt = currCurve[currCurve.length - 1];
      if (lastPt && Math.hypot(lastPt.x - pos.x, lastPt.y - pos.y) < 22) {
        handleFinish();
        return;
      }
      setCurrentCurve((prev) => [...prev, pos]);
      return;
    }

    // Hit testing for existing points
    const hitIdx = localCurves.findIndex((c) =>
      c.some((pt) => Math.hypot(pt.x - pos.x, pt.y - pos.y) < 15),
    );
    if (hitIdx !== -1) {
      setSelectedCurveIndex(hitIdx);
      const ptIdx = localCurves[hitIdx].findIndex(
        (pt) => Math.hypot(pt.x - pos.x, pt.y - pos.y) < 15,
      );
      setDragging(ptIdx);
      return;
    }

    setDrawing(true);
    setCurrentCurve([pos]);
  };

  const handleMove = (e) => {
    const pos = getPointerPos(e);
    setMousePos(pos);

    const {
      dragging: dragIdx,
      selectedCurveIndex: selIdx,
      curves: localCurves,
    } = stateRef.current;
    if (dragIdx !== null && selIdx !== null) {
      const newCurves = [...localCurves];
      newCurves[selIdx][dragIdx] = pos;
      setCurves(newCurves);
    }
  };

  const handleEnd = () => {
    setDragging(null);
  };

  // Safe Unmount Auto-Commit Effect: Saves progress instantly when user changes active tools
  useEffect(() => {
    return () => {
      const {
        currentCurve: currCurve,
        currentColor: color,
        brushSize: size,
        strokeStyle: style,
      } = stateRef.current;

      if (currCurve && currCurve.length > 1) {
        const action = createAction("drawing", "DRAW_CURVE", {
          points: currCurve,
          color,
          strokeWidth: size,
          strokeStyle: style,
        });
        // Defer dispatch briefly to prevent React commit conflicts
        setTimeout(() => {
          addAction(action);
        }, 0);
      }
    };
  }, [addAction, createAction]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("mousedown", handleStart);
    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseup", handleEnd);
    canvas.addEventListener("touchstart", handleStart, { passive: false });
    canvas.addEventListener("touchmove", handleMove, { passive: false });
    canvas.addEventListener("touchend", handleEnd);

    const handleKey = (e) => {
      if (e.key === "Enter") handleFinish();
      if (e.key === "Escape") {
        setDrawing(false);
        setCurrentCurve([]);
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      canvas.removeEventListener("mousedown", handleStart);
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseup", handleEnd);
      canvas.removeEventListener("touchstart", handleStart);
      canvas.removeEventListener("touchmove", handleMove);
      canvas.removeEventListener("touchend", handleEnd);
      window.removeEventListener("keydown", handleKey);
    };
  }, [active, canvasRef]); // Runs once on mounting/activation

  return null;
};
