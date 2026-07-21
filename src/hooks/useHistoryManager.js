"use client";

import { useState, useRef, useCallback, useEffect, useReducer } from "react";
import {
  applyDrawingAction,
  replayAllDrawingActions,
} from "@/utils/canvasReplay";

export function useHistoryManager({ drawingCanvasRef, baseCanvasRef }) {
  // ── History stack ────────────────────────────────────────────────────────
  // Stored in refs so addAction / undo / redo never have stale-closure issues.
  const allActionsRef = useRef([]); // full stack including redo-able future
  const currentStepRef = useRef(-1); // index of last committed action (-1 = empty)

  // Trigger re-renders when refs mutate (canUndo / canRedo / actionCount updates)
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // ── Konva element arrays (owned here, passed as props to Konva components) ─
  const [rectangles, setRectangles] = useState([]);
  const [circles, setCircles] = useState([]);
  const [arrows, setArrows] = useState([]);
  const [doubleArrows, setDoubleArrows] = useState([]);
  const [texts, setTexts] = useState([]);

  // ── Konva component imperative refs (for flatten() on Save) ──────────────
  const konvaRectRef = useRef(null);
  const konvaCircleRef = useRef(null);
  const konvaArrowRef = useRef(null);
  const konvaDoubleArrowRef = useRef(null);
  const textEditorRef = useRef(null);

  // ── Replay manager ref ────────────────────────────────────────────────────
  const replayManager = useRef({
    applyDrawingAction: () => {},
  });

  useEffect(() => {
    replayManager.current = {
      applyDrawingAction: (action) => {
        const canvas = drawingCanvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) applyDrawingAction(ctx, action);
      },
    };
  }, [drawingCanvasRef]);

  // ── Internal: replay drawing canvas to a given step ──────────────────────
  const replayDrawingCanvas = useCallback(
    (all, step) => {
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;
      // replayAllDrawingActions clears first, then replays every DRAW_* action
      replayAllDrawingActions(canvas, all.slice(0, step + 1));
    },
    [drawingCanvasRef],
  );

  // ── Internal: derive Konva arrays from the action log up to `step` ────────
  // This is the single source of truth for Konva state.
  // Handles ADD, MOVE, and DELETE actions for all element types.
  const deriveKonvaState = useCallback((all, step) => {
    const rectMap = new Map();
    const circMap = new Map();
    const arrowMap = new Map();
    const dblMap = new Map();
    const textMap = new Map();

    all
      .slice(0, step + 1)
      .filter((a) => a.target === "konva")
      .forEach(({ type, payload }) => {
        if (!payload) return;
        const { elementType, elementId, data } = payload;

        switch (type) {
          case "ADD_RECTANGLE":
            rectMap.set(data.id, data);
            break;
          case "ADD_CIRCLE":
            circMap.set(data.id, data);
            break;
          case "ADD_ARROW":
            arrowMap.set(data.id, data);
            break;
          case "ADD_DOUBLE_ARROW":
            dblMap.set(data.id, data);
            break;
          case "ADD_TEXT":
            textMap.set(data.id, data);
            break;
          case "MOVE_ELEMENT": {
            const map = {
              rectangle: rectMap,
              circle: circMap,
              arrow: arrowMap,
              "double-arrow": dblMap,
              text: textMap,
            }[elementType];
            if (map?.has(elementId)) {
              map.set(elementId, { ...map.get(elementId), ...data });
            }
            break;
          }
          case "DELETE_ELEMENT":
            [rectMap, circMap, arrowMap, dblMap, textMap].forEach((m) =>
              m.delete(elementId),
            );
            break;
        }
      });

    return {
      rects: [...rectMap.values()],
      circs: [...circMap.values()],
      arrs: [...arrowMap.values()],
      dblArrs: [...dblMap.values()],
      txts: [...textMap.values()],
    };
  }, []);

  // Push derived Konva state into React state
  const syncKonvaState = useCallback(
    (all, step) => {
      const { rects, circs, arrs, dblArrs, txts } = deriveKonvaState(all, step);
      setRectangles(rects);
      setCircles(circs);
      setArrows(arrs);
      setDoubleArrows(dblArrs);
      setTexts(txts);
    },
    [deriveKonvaState],
  );

  // ── Internal: undo a single base-canvas action ────────────────────────────
  const undoBaseAction = useCallback(
    (action) => {
      const baseCanvas = baseCanvasRef.current;
      const baseCtx = baseCanvas?.getContext("2d");
      const drawingCanvas = drawingCanvasRef.current;
      const drawingCtx = drawingCanvas?.getContext("2d");
      if (!baseCanvas || !baseCtx) return;

      if (action.type === "APPLY_FILTER") {
        const id = action.payload?.previousImageData;
        if (id) baseCtx.putImageData(id, 0, 0);
      }

      if (action.type === "CROP_IMAGE") {
        const { prevWidth, prevHeight, baseImageData, drawingImageData } =
          action.payload || {};
        if (baseImageData && prevWidth && prevHeight) {
          baseCanvas.width = prevWidth;
          baseCanvas.height = prevHeight;
          baseCtx.putImageData(baseImageData, 0, 0);
        }
        // Keep the drawing (annotation) layer's buffer in lockstep with the
        // base layer — mismatched dimensions is what causes distorted strokes.
        if (drawingCanvas && drawingCtx && prevWidth && prevHeight) {
          drawingCanvas.width = prevWidth;
          drawingCanvas.height = prevHeight;
          if (drawingImageData) drawingCtx.putImageData(drawingImageData, 0, 0);
        }
      }
    },
    [baseCanvasRef, drawingCanvasRef],
  );

  const redoBaseAction = useCallback(
    (action) => {
      const baseCanvas = baseCanvasRef.current;
      const baseCtx = baseCanvas?.getContext("2d");
      const drawingCanvas = drawingCanvasRef.current;
      const drawingCtx = drawingCanvas?.getContext("2d");
      if (!baseCanvas || !baseCtx) return;

      if (action.type === "APPLY_FILTER") {
        const id = action.payload?.newImageData;
        if (id) baseCtx.putImageData(id, 0, 0);
      }

      if (action.type === "CROP_IMAGE") {
        const { cropArea: v } = action.payload || {};
        if (!v) return;
        const tmpBase = document.createElement("canvas");
        tmpBase.width = v.width;
        tmpBase.height = v.height;
        const tmpCtx = tmpBase.getContext("2d");
        if (!tmpCtx) return;
        tmpCtx.drawImage(
          baseCanvas,
          v.x,
          v.y,
          v.width,
          v.height,
          0,
          0,
          v.width,
          v.height,
        );

        baseCanvas.width = v.width;
        baseCanvas.height = v.height;
        baseCtx.clearRect(0, 0, v.width, v.height);
        baseCtx.drawImage(tmpBase, 0, 0);

        if (drawingCanvas && drawingCtx) {
          drawingCanvas.width = v.width;
          drawingCanvas.height = v.height;
          drawingCtx.clearRect(0, 0, v.width, v.height);
        }
      }
    },
    [baseCanvasRef, drawingCanvasRef],
  );

  // ── Public API ────────────────────────────────────────────────────────────

  const createAction = useCallback(
    (target, type, payload) => ({
      id: `${target}-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      target,
      type,
      payload,
    }),
    [],
  );

  const addAction = useCallback(
    (action) => {
      // Trim any redo-able future actions, then append
      const trimmed = allActionsRef.current.slice(
        0,
        currentStepRef.current + 1,
      );
      const newAll = [...trimmed, action];
      const newStep = trimmed.length; // same as currentStep + 1

      allActionsRef.current = newAll;
      currentStepRef.current = newStep;

      // Drawing actions: synchronously clear + replay so there's no canvas flash
      if (action.target === "drawing") {
        replayDrawingCanvas(newAll, newStep);
      }

      // Konva actions: rebuild element arrays from history (authoritative)
      if (action.target === "konva") {
        syncKonvaState(newAll, newStep);
      }

      // Base actions (filters, crop): caller already mutated the canvas;
      // we only record here for undo/redo. No extra canvas work needed.

      forceUpdate(); // update canUndo / canRedo / actionCount in UI
    },
    [replayDrawingCanvas, syncKonvaState, forceUpdate],
  );

  const undo = useCallback(() => {
    const all = allActionsRef.current;
    if (currentStepRef.current < 0) return;

    const undoneAction = all[currentStepRef.current];
    const newStep = currentStepRef.current - 1;
    currentStepRef.current = newStep;

    if (undoneAction?.target === "base") undoBaseAction(undoneAction);

    replayDrawingCanvas(all, newStep);
    syncKonvaState(all, newStep);
    forceUpdate();
  }, [replayDrawingCanvas, syncKonvaState, undoBaseAction, forceUpdate]);

  const redo = useCallback(() => {
    const all = allActionsRef.current;
    if (currentStepRef.current >= all.length - 1) return;

    const newStep = currentStepRef.current + 1;
    const redoneAction = all[newStep];
    currentStepRef.current = newStep;

    if (redoneAction?.target === "base") redoBaseAction(redoneAction);

    replayDrawingCanvas(all, newStep);
    syncKonvaState(all, newStep);
    forceUpdate();
  }, [replayDrawingCanvas, syncKonvaState, redoBaseAction, forceUpdate]);

  // ── Derived values (computed from refs at render time) ───────────────────
  // Since forceUpdate() is called whenever refs mutate, these are always fresh.
  const historyState = {
    actions: allActionsRef.current.slice(0, currentStepRef.current + 1),
    currentStep: currentStepRef.current,
  };
  const canUndo = currentStepRef.current >= 0;
  const canRedo = currentStepRef.current < allActionsRef.current.length - 1;
  const actionCount = currentStepRef.current + 1;

  const resetHistoryTo = useCallback(
    (action) => {
      allActionsRef.current = action ? [action] : [];
      currentStepRef.current = action ? 0 : -1;
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeKonvaActionsByType = useCallback(
    (elementType) => {
      const all = allActionsRef.current;
      const isTarget = (a) =>
        a.target === "konva" && a.payload?.elementType === elementType;

      const removedBeforeStep = all
        .slice(0, currentStepRef.current + 1)
        .filter(isTarget).length;

      allActionsRef.current = all.filter((a) => !isTarget(a));
      currentStepRef.current = currentStepRef.current - removedBeforeStep;
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeActionsByTarget = useCallback(
    (target) => {
      const all = allActionsRef.current;
      const isTarget = (a) => a.target === target;

      const removedBeforeStep = all
        .slice(0, currentStepRef.current + 1)
        .filter(isTarget).length;

      allActionsRef.current = all.filter((a) => !isTarget(a));
      currentStepRef.current = currentStepRef.current - removedBeforeStep;
      forceUpdate();
    },
    [forceUpdate],
  );

  return {
    // History
    historyState,
    canUndo,
    canRedo,
    undo,
    redo,
    actionCount,
    addAction,
    createAction,
    // Canvas replay (used by ImageEditorModal during line preview)
    replayManager,
    // Konva element state
    rectangles,
    setRectangles,
    circles,
    setCircles,
    arrows,
    setArrows,
    doubleArrows,
    setDoubleArrows,
    texts,
    setTexts,
    // Konva imperative refs (used by handleSave to flatten before export)
    konvaRectRef,
    konvaCircleRef,
    konvaArrowRef,
    konvaDoubleArrowRef,
    textEditorRef,
    resetHistoryTo,
    removeKonvaActionsByType,
    removeActionsByTarget
  };
}
