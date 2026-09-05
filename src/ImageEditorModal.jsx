"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  Suspense,
  lazy,
} from "react";
import { GrClear } from "react-icons/gr";
import { TbArrowCurveRight } from "react-icons/tb";
import {
  Pencil,
  Palette,
  Minus,
  Plus,
  Eraser,
  Square,
  Circle,
  Undo2,
  Redo2,
  Type,
  ArrowRight,
  ArrowRightLeft,
  MinusIcon,
  Grip,
  DotIcon,
  Crop,
  PenTool,
  Download,
  Filter,
  Trash2,
} from "lucide-react";

// ── local ui shims (no Radix/shadcn needed) ──
import { Button } from "./ui/Button";
import { Label } from "./ui/Label";
import { Select, SelectItem } from "./ui/Select";
import { Slider } from "./ui/Slider";
import { useToast } from "./ui/toast";

// ── editor sub-components ──
// React.lazy replaces next/dynamic
const TextEditor = lazy(() => import("./TextEditor"));
const KonvaRectangle = lazy(() => import("./KonvaRectangle"));
const ArrowKonva = lazy(() => import("./ArrowKonva"));
const KonvaCircle = lazy(() => import("./KonvaCircle"));
const KonvaDoubleArrow = lazy(() => import("./KonvaDoubleArrow"));

import { CurveTool } from "./CurveTool";
import CurveArrowTool from "./CurveArrowTool";
import MobileView from "./MobileView";
import { useHistoryManager } from "@/hooks/useHistoryManager";
import { ActionCreators } from "@/utils/actionCreators";
import {
  resolveImageSource,
  getImageSourceKey,
} from "@/utils/resolveImageSource";
import {
  buildImageEditResult,
  buildEditedFileName,
  extensionForMimeType,
  EXPORT_MIME_TYPE,
  EXPORT_QUALITY,
} from "@/utils/buildImageEditResult";
import {
  getDpr,
  logicalSize,
  getLogicalPointerPos,
  clearLogical,
  withDeviceSpace,
  resizeCanvasToLogical,
} from "@/utils/canvasGeometry";

const minBrushSize = 1;
const maxBrushSize = 20;

/**
 * @typedef {
 *   | { kind: "url", url: string, name?: string }
 *   | { kind: "file", file: File, name?: string }
 *   | { kind: "blob", blob: Blob, name?: string }
 *   | { kind: "dataUrl", dataUrl: string, name?: string }
 * } EditableImageSource
 *
 * @typedef {{
 *   blob: Blob,
 *   file: File,
 *   dataUrl: string,
 *   width: number,
 *   height: number,
 * }} ImageEditResult
 */

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {EditableImageSource} props.image - accepts a remote url, a File, a Blob, or a dataUrl
 * @param {(result: ImageEditResult) => void | Promise<void>} props.onSave -
 *   receives the edited image as a Blob/File/dataUrl bundle. If it returns a
 *   promise, the editor keeps its save spinner up until that settles, so the
 *   tick stays disabled for the caller's upload too.
 */
export default function ImageEditorModal({ isOpen, onClose, image, onSave }) {
  const { toast } = useToast();

  const baseCanvasRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const canvasAreaRef = useRef(null);
  // Device pixel ratio the canvases were last sized at. Read this instead of
  // window.devicePixelRatio so every consumer agrees on one value even if the
  // window moves to a different-density screen mid-edit.
  const dprRef = useRef(getDpr());
  // The decoded, full-resolution <img> — kept around so Save/Download can draw
  // the ORIGINAL photo instead of the on-screen canvas (which is downscaled to
  // fit the editor viewport). See buildExportCanvas().
  const nativeImageRef = useRef(null);
  // True once `baseCanvas` no longer holds *just* the pristine photo.
  //
  // The native-resolution export path in buildExportCanvas() rebuilds the
  // photo from `nativeImageRef` and composites only `drawingCanvas` on top —
  // it never reads baseCanvas. That is only valid while baseCanvas contains
  // nothing but the photo. Three things break that assumption:
  //
  //   flattenLayers()      bakes the drawing layer INTO baseCanvas and clears
  //                        the drawing layer. On mobile this is the normal
  //                        flow (MobileView's confirmPencil / confirmSticker),
  //                        so ignoring baseCanvas dropped every confirmed
  //                        shape, text and stroke from the export.
  //   applyBlackAndWhite() filters baseCanvas' pixels; nativeImageRef is still
  //                        the unfiltered decode.
  //   applyCrop()          reads back from the already-downscaled baseCanvas
  //                        and never updates imageDrawParams, so afterwards
  //                        nativeImageRef/imageDrawParams describe the
  //                        PRE-crop photo — a "native" export would draw the
  //                        wrong, uncropped image.
  //
  // Once set, the rest of the session falls back to compositing baseCanvas +
  // drawingCanvas at on-screen resolution, which is always correct (it is
  // exactly what the editor shows). Keeping native resolution in these cases
  // would need the baked annotations kept in their own layer, separate from
  // the photo, which the editor does not currently do.
  const baseDivergedRef = useRef(false);

  // ── resolved image source (handles url / file / blob / dataUrl uniformly) ──
  const [resolvedImage, setResolvedImage] = useState({
    src: null,
    name: undefined,
  });

  useEffect(() => {
    if (!image) {
      setResolvedImage({ src: null, name: undefined });
      return;
    }
    const { src, name, cleanup } = resolveImageSource(image);
    setResolvedImage({ src, name });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getImageSourceKey(image)]);

  const [activeTool, setActiveTool] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [fontSize, setFontSize] = useState(22);
  const [textInputPosition, setTextInputPosition] = useState(null);
  const [text, setText] = useState("");
  const [isTextToolActive, setIsTextToolActive] = useState(false);
  const [showCropConfirm, setShowCropConfirm] = useState(false);
  // Points of the stroke in progress. A ref, not state, and deliberately so:
  // this is appended to on every pointer move, and nothing reads it during
  // render — its only readers are in stopDrawing, where it becomes the payload
  // of a DRAW_* action.
  //
  // As state it cost a full re-render of this component (30+ hooks), MobileView
  // and every mounted Konva stage on each of the ~60 moves per second, plus an
  // O(n²) copy because each append rebuilt the whole array.
  //
  // Reset by ASSIGNING A NEW ARRAY rather than clearing in place: the array is
  // handed to history verbatim, so mutating it afterwards would rewrite a
  // committed action.
  const currentStrokeRef = useRef([]);
  // Snapshot of the drawing layer taken when a line drag starts, so each
  // preview frame is a single blit instead of a replay of the whole history.
  // Held only for the duration of the drag; released in stopDrawing.
  const linePreviewBaseRef = useRef(null);
  const [fontFamily, setFontFamily] = useState("sans-serif");
  const [cropArea, setCropArea] = useState(null);
  const [isCropping, setIsCropping] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [backgroundColor, setBackgroundColor] = useState("transparent");
  const [currentColor, setCurrentColor] = useState("#ff0000");
  const [brushSize, setBrushSize] = useState(3);
  const [strokeStyle, setStrokeStyle] = useState("solid");
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [selectedElementType, setSelectedElementType] = useState(null);
  const [showTrashIcon, setShowTrashIcon] = useState(false);
  const [isDraggedOverTrash, setIsDraggedOverTrash] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 420,
    height: 750,
  });
  const [imageDrawParams, setImageDrawParams] = useState(null);
  const [mounted, setMounted] = useState(false);
  // Save in progress: export + the caller's upload. The state drives the
  // confirm tick's spinner; the ref is what actually blocks re-entry.
  //
  // A ref is required, not a nicety: two taps in quick succession run the same
  // handler closure, so the second one still sees `isSaving === false` — React
  // has not re-rendered yet, and it cannot while the synchronous part of the
  // export is blocking the main thread. The ref updates immediately.
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [eraserCursor, setEraserCursor] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isTextDragging, setIsTextDragging] = useState(false);
  const [textColor, setTextColor] = useState("#000000");
  const TEXT_BG_CYCLE = [
    "#ffffff",
    "#000000",
    "rgba(0,0,0,0.5)",
    "transparent",
  ];
  const TEXT_BG_CONTRAST = ["#000000", "#ffffff", "#ffffff", null];

  const [textBgColor, setTextBgColor] = useState(TEXT_BG_CYCLE[0]);

  const cycleTextBg = useCallback(() => {
    const idx = TEXT_BG_CYCLE.indexOf(textBgColor);
    const nextIdx = (idx + 1) % TEXT_BG_CYCLE.length;
    setTextBgColor(TEXT_BG_CYCLE[nextIdx]);

    const forcedColor = TEXT_BG_CONTRAST[nextIdx];
    if (forcedColor) setTextColor(forcedColor);
  }, [textBgColor]);

  const {
    historyState,
    canUndo,
    canRedo,
    undo,
    redo,
    actionCount,
    addAction,
    createAction,
    replayManager,
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
    konvaRectRef,
    konvaCircleRef,
    konvaArrowRef,
    konvaDoubleArrowRef,
    textEditorRef,
    resetHistoryTo,
    removeKonvaActionsByType,
    removeActionsByTarget,
  } = useHistoryManager({ drawingCanvasRef, baseCanvasRef, dprRef });

  // `canvasDimensions` drives the CSS size of the canvas wrapper, so it must
  // always hold LOGICAL px. undo/redo can resize the canvas buffers (crop), so
  // re-sync afterwards — every undo/redo entry point goes through these two.
  const syncCanvasDimensions = useCallback(() => {
    const c = drawingCanvasRef.current;
    if (!c) return;
    const { width, height } = logicalSize(c, dprRef.current);
    setCanvasDimensions((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const handleUndo = useCallback(() => {
    undo();
    syncCanvasDimensions();
  }, [undo, syncCanvasDimensions]);

  const handleRedo = useCallback(() => {
    redo();
    syncCanvasDimensions();
  }, [redo, syncCanvasDimensions]);

  // ── lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Hardens background scroll locking on real WebKit & Blink mobile viewports.
    // `<html>` is locked too, not just <body> — some mobile browsers still let
    // a touch drag scroll the document root even with the body pinned.
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;

    const original = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    // Chrome's own "swipe to navigate back" preview animation is gated on
    // overscroll-behavior specifically, separately from touch-action — belt
    // and braces alongside the canvas area's touch-none.
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    // Without pinning `top` to the negative scroll offset, position:fixed
    // resets the body to its CSS top (0) the instant the modal opens — the
    // page visibly jumps to the very top, then jumps again on close.
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.height = "100dvh";

    return () => {
      html.style.overflow = original.htmlOverflow;
      html.style.overscrollBehavior = original.htmlOverscroll;
      body.style.overflow = original.bodyOverflow;
      body.style.overscrollBehavior = original.bodyOverscroll;
      body.style.position = original.bodyPosition;
      body.style.top = original.bodyTop;
      body.style.width = original.bodyWidth;
      body.style.height = original.bodyHeight;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Traps the phone's edge-swipe-back gesture (and the hardware/software
    // back button, and the browser's own back button) so it can never close
    // the editor or navigate the underlying page away — by design, the ONLY
    // way to leave is the ✕ / ✓ icons. Since the editor is an overlay, not
    // its own route, an actual back-navigation would otherwise take the
    // whole modal down with the page underneath it.
    //
    // Standard technique: push a throwaway history entry the instant the
    // modal opens (same URL, so the host app's router is untouched), then listen
    // popstate. Any of the gestures above pop that entry and fire popstate —
    // by the time we hear it, the browser has already navigated, so there's
    // nothing to preventDefault (popstate isn't cancelable anyway) — instead
    // we immediately re-push the same entry, unconditionally. This is
    // deliberately NOT routed through handleCancel()/onClose(): back doing
    // *nothing at all* (not even a confirm dialog) is the point.
    history.pushState({ imageEditorModal: true }, "");

    const handlePopState = () => {
      history.pushState({ imageEditorModal: true }, "");
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Only reached via a normal close (X / Cancel confirmed / Save) — a
      // back-gesture close already popped this itself. Pop our own entry so
      // it doesn't linger as a dead extra "back" step for the user.
      if (history.state?.imageEditorModal) history.back();
    };
  }, [isOpen]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hand memory back explicitly when the editor closes.
  //
  // Unmounting drops the React tree, but the two canvas backing stores and the
  // retained decode in nativeImageRef are browser-side allocations that live
  // until GC gets around to them. That is fine once; it is not fine when a
  // a user opens the editor many times in a row on a phone that is
  // already short of memory — the allocations pile up faster than they are
  // collected. Assigning 0 to canvas.width/height frees the backing store
  // immediately, and nulling the ref drops the last reference to the decode.
  //
  // The nodes are captured on mount rather than read in the cleanup, because
  // React has already detached the refs by the time cleanup runs.
  useEffect(() => {
    const base = baseCanvasRef.current;
    const drawing = drawingCanvasRef.current;
    return () => {
      nativeImageRef.current = null;
      for (const canvas of [base, drawing]) {
        if (!canvas) continue;
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  useEffect(() => {
    if (activeTool === "eraser") setBrushSize(20);
    else setBrushSize(3);
  }, [activeTool]);

  useEffect(() => {
    const check = () =>
      setShowTrashIcon(window.innerWidth < 1024 && selectedElementId !== null);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [selectedElementId]);

  // Safety net: keeps the wrapper's CSS size in step with the canvas buffer if
  // anything resizes it without going through drawImageOnCanvas / applyCrop.
  // syncCanvasDimensions writes LOGICAL px and bails when unchanged, so this
  // settles immediately instead of feeding back into itself.
  useEffect(() => {
    syncCanvasDimensions();
    const c = drawingCanvasRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncCanvasDimensions);
    ro.observe(c);
    return () => ro.disconnect();
  }, [syncCanvasDimensions]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      // target the modal wrapper by its data attribute instead of role="dialog"
      const modal = document.getElementById("image-editor-modal");
      if (!modal?.contains(document.activeElement)) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === "z") {
          e.preventDefault();
          handleUndo();
        }
        if (e.key === "y") {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleUndo, handleRedo]);

  // ── canvas drawing ─────────────────────────────────────────────────────────

  const drawImageOnCanvas = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    const baseCtx = baseCanvas?.getContext("2d");
    const drawingCtx = drawingCanvas?.getContext("2d");
    if (!baseCanvas || !baseCtx || !drawingCanvas || !drawingCtx) return;

    if (!resolvedImage.src) return;

    const img = new Image();
    // Cache-busting for real network URLs;
    const isRemoteUrl = image?.kind === "url";
    if (isRemoteUrl) img.crossOrigin = "anonymous";
    img.src = isRemoteUrl
      ? resolvedImage.src +
        (resolvedImage.src.includes("?") ? "&" : "?") +
        "cb=" +
        Date.now()
      : resolvedImage.src;
    img.onload = () => {
      const measureEl = canvasAreaRef.current || baseCanvas.parentElement;
      if (!measureEl) return;
      const r = measureEl.getBoundingClientRect();
      const cs = window.getComputedStyle(measureEl);
      const paddingX =
        parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
      const paddingY =
        parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
      const availableWidth = Math.round(r.width - paddingX);
      const availableHeight = Math.round(r.height - paddingY);
      if (availableWidth <= 0 || availableHeight <= 0) return;

      // Fit the photo into the available area, then size the canvas to
      // EXACTLY that fitted box — not the full available area. Previously the
      // canvas always filled the whole viewport and the photo was letterboxed
      // inside it, so e.g. a landscape (wide, short) photo left large dead
      // bars above and below where the user could still draw or drop shapes
      // in empty space that wasn't actually on the photo. The wrapper div is
      // already flex-centered in canvasAreaRef, so a smaller box is centered
      // automatically — no layout change needed beyond this sizing.
      const imgAR = img.naturalWidth / img.naturalHeight;
      const availableAR = availableWidth / availableHeight;
      let drawWidth, drawHeight;
      if (imgAR > availableAR) {
        drawWidth = availableWidth;
        drawHeight = availableWidth / imgAR;
      } else {
        drawHeight = availableHeight;
        drawWidth = availableHeight * imgAR;
      }
      const canvasWidth = Math.max(1, Math.round(drawWidth));
      const canvasHeight = Math.max(1, Math.round(drawHeight));

      // Back the canvases with a device-resolution buffer, then scale the
      // drawing coordinate system back down so all editor code keeps working
      // in logical px. This is what makes the photo render sharp instead of
      // being upscaled from a CSS-sized buffer.
      const dpr = getDpr();
      dprRef.current = dpr;
      resizeCanvasToLogical(baseCanvas, canvasWidth, canvasHeight, dpr);
      resizeCanvasToLogical(drawingCanvas, canvasWidth, canvasHeight, dpr);

      setCanvasDimensions({ width: canvasWidth, height: canvasHeight });
      baseCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      drawingCtx.clearRect(0, 0, canvasWidth, canvasHeight);

      baseCtx.imageSmoothingEnabled = true;
      baseCtx.imageSmoothingQuality = "high";
      // The canvas box now IS the photo's fitted bounds, so it fills
      // edge-to-edge — no letterbox offset to center within anymore.
      baseCtx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
      drawingCtx.globalCompositeOperation = "source-over";
      setImageDrawParams({
        offsetX: 0,
        offsetY: 0,
        drawWidth: canvasWidth,
        drawHeight: canvasHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
      // Keep the full-resolution decode alive for export — see
      // nativeImageRef's declaration for why. A genuinely new image just
      // loaded and baseCanvas now holds only that photo, so the native-export
      // path is valid again.
      nativeImageRef.current = img;
      baseDivergedRef.current = false;
    };
    img.onerror = () => console.error("Failed to load image for editing.");
  }, [resolvedImage.src, image?.kind]);

  useEffect(() => {
    if (!isOpen || !resolvedImage.src) return;
    const t = setTimeout(() => {
      if (baseCanvasRef.current && drawingCanvasRef.current)
        drawImageOnCanvas();
    }, 0);
    return () => clearTimeout(t);
  }, [isOpen, resolvedImage.src, drawImageOnCanvas]);

  /**
   * Re-fits the canvas to the container on viewport/orientation change,
   * WITHOUT losing anything drawn so far.
   *
   * `drawImageOnCanvas` (above) reloads the pristine original photo from
   * scratch — correct for a first load, but it used to also be what ran on
   * every resize, including a device rotation. That silently discarded the
   * entire session: pencil/eraser/line/curve strokes, any already-confirmed
   * shape or text (baked to raster, unrecoverable once cleared), and any
   * crop or filter — not just "the last pencil stroke".
   *
   * This instead: (1) bakes any shape mid-edit into the raster layer first,
   * same as Save/Download/entering-crop already do, so its coordinates don't
   * end up wrong in the new size; (2) snapshots both canvases; (3) resizes
   * the buffers to fit the new viewport at the CURRENT content's aspect ratio
   * (not the original photo's — a crop may have changed that); (4) draws the
   * snapshots back in, scaled to fit. Konva stages resize themselves from
   * `canvasDimensions`, same as any other resize.
   */
  const refitCanvasOnResize = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    const baseCtx = baseCanvas?.getContext("2d");
    const drawingCtx = drawingCanvas?.getContext("2d");
    if (!baseCanvas || !baseCtx || !drawingCanvas || !drawingCtx) return;
    if (!canvasDimensions.width || !canvasDimensions.height) return;

    konvaRectRef.current?.flatten();
    konvaCircleRef.current?.flatten();
    konvaArrowRef.current?.flatten();
    konvaDoubleArrowRef.current?.flatten();
    textEditorRef.current?.flatten();

    const measureEl = canvasAreaRef.current || baseCanvas.parentElement;
    if (!measureEl) return;
    const r = measureEl.getBoundingClientRect();
    const cs = window.getComputedStyle(measureEl);
    const paddingX =
      parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
    const paddingY =
      parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
    const availableWidth = Math.round(r.width - paddingX);
    const availableHeight = Math.round(r.height - paddingY);
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const contentAR = canvasDimensions.width / canvasDimensions.height;
    const availableAR = availableWidth / availableHeight;
    let newWidth, newHeight;
    if (contentAR > availableAR) {
      newWidth = availableWidth;
      newHeight = availableWidth / contentAR;
    } else {
      newHeight = availableHeight;
      newWidth = availableHeight * contentAR;
    }
    newWidth = Math.max(1, Math.round(newWidth));
    newHeight = Math.max(1, Math.round(newHeight));
    if (
      newWidth === canvasDimensions.width &&
      newHeight === canvasDimensions.height
    ) {
      return;
    }

    const dpr = dprRef.current || getDpr();

    // Snapshot the CURRENT pixels (device-resolution, 1:1) before the resize
    // wipes the buffers — this is what's carried across the rotation.
    const baseSnap = document.createElement("canvas");
    baseSnap.width = baseCanvas.width;
    baseSnap.height = baseCanvas.height;
    baseSnap.getContext("2d").drawImage(baseCanvas, 0, 0);

    const drawingSnap = document.createElement("canvas");
    drawingSnap.width = drawingCanvas.width;
    drawingSnap.height = drawingCanvas.height;
    drawingSnap.getContext("2d").drawImage(drawingCanvas, 0, 0);

    resizeCanvasToLogical(baseCanvas, newWidth, newHeight, dpr);
    resizeCanvasToLogical(drawingCanvas, newWidth, newHeight, dpr);

    withDeviceSpace(baseCtx, dpr, (ctx) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(baseSnap, 0, 0, baseCanvas.width, baseCanvas.height);
    });
    withDeviceSpace(drawingCtx, dpr, (ctx) => {
      ctx.drawImage(drawingSnap, 0, 0, drawingCanvas.width, drawingCanvas.height);
    });

    setCanvasDimensions({ width: newWidth, height: newHeight });
    setImageDrawParams((prev) =>
      prev
        ? { ...prev, offsetX: 0, offsetY: 0, drawWidth: newWidth, drawHeight: newHeight }
        : prev,
    );
  }, [canvasDimensions]);

  useEffect(() => {
    if (!isOpen) return;
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    let debounceTimer = null;
    const handleResize = () => {
      if (window.innerWidth === lastWidth && window.innerHeight === lastHeight)
        return;
      lastWidth = window.innerWidth;
      lastHeight = window.innerHeight;
      // Debounced: a rotation can fire several resize events in quick
      // succession while the viewport settles, and refitCanvasOnResize does
      // real snapshot/redraw work — no need to repeat it for every one.
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (baseCanvasRef.current && drawingCanvasRef.current)
          refitCanvasOnResize();
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(debounceTimer);
    };
  }, [isOpen, refitCanvasOnResize]);

  useEffect(() => {
    if (!isOpen) return;
    // Best-effort only: keep the editor in whatever orientation it opened in,
    // so a physical rotation doesn't trigger a re-layout mid-edit at all.
    // This is NOT reliable — screen.orientation.lock() has no support in iOS
    // Safari whatsoever, and most browsers only honour it for an installed,
    // fullscreen PWA, not a plain browser tab; it commonly rejects silently.
    // refitCanvasOnResize (above) is what actually prevents data loss on a
    // rotation when the lock isn't available or is refused.
    const orientation =
      typeof screen !== "undefined" ? screen.orientation : null;
    let locked = false;
    if (orientation?.lock) {
      orientation
        .lock(orientation.type || "portrait-primary")
        .then(() => {
          locked = true;
        })
        .catch(() => {});
    }
    return () => {
      if (locked) orientation?.unlock?.();
    };
  }, [isOpen]);

  // ── konva callbacks ────────────────────────────────────────────────────────

  const handleKonvaRectAdd = useCallback(
    (rectangle) => {
      addAction(
        createAction("konva", "ADD_RECTANGLE", {
          elementType: "rectangle",
          elementId: rectangle.id,
          data: { ...rectangle, _createdAt: Date.now() },
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaRectMove = useCallback(
    (id, newData, previousData) => {
      addAction(
        createAction("konva", "MOVE_ELEMENT", {
          elementType: "rectangle",
          elementId: id,
          data: newData,
          previousData,
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaCircleAdd = useCallback(
    (circle) => {
      addAction(
        createAction("konva", "ADD_CIRCLE", {
          elementType: "circle",
          elementId: circle.id,
          data: { ...circle, _createdAt: Date.now() },
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaCircleMove = useCallback(
    (id, newData, previousData) => {
      addAction(
        createAction("konva", "MOVE_ELEMENT", {
          elementType: "circle",
          elementId: id,
          data: newData,
          previousData,
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaArrowAdd = useCallback(
    (arrow) => {
      addAction(
        createAction("konva", "ADD_ARROW", {
          elementType: "arrow",
          elementId: arrow.id,
          data: { ...arrow, _createdAt: Date.now() },
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaArrowMove = useCallback(
    (id, newData, previousData) => {
      addAction(
        createAction("konva", "MOVE_ELEMENT", {
          elementType: "arrow",
          elementId: id,
          data: newData,
          previousData,
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaDoubleArrowAdd = useCallback(
    (doubleArrow) => {
      addAction(
        createAction("konva", "ADD_DOUBLE_ARROW", {
          elementType: "double-arrow",
          elementId: doubleArrow.id,
          data: { ...doubleArrow, _createdAt: Date.now() },
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaDoubleArrowMove = useCallback(
    (id, newData, previousData) => {
      addAction(
        createAction("konva", "MOVE_ELEMENT", {
          elementType: "double-arrow",
          elementId: id,
          data: newData,
          previousData,
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaTextAdd = useCallback(
    (textShape) => {
      addAction(
        createAction("konva", "ADD_TEXT", {
          elementType: "text",
          elementId: textShape.id,
          data: { ...textShape, _createdAt: Date.now() },
        }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaTextMove = useCallback(
    (id, newData, previousData) => {
      addAction(
        createAction("konva", "MOVE_ELEMENT", {
          elementType: "text",
          elementId: id,
          data: newData,
          previousData,
        }),
      );
    },
    [createAction, addAction],
  );

  // Deletions must be recorded in history. The Konva element arrays are derived
  // from the action log on every history change, so a component that only did
  // `setRectangles(filter(...))` had its deletion resurrected by the next
  // action/undo. Every drag-to-trash and Delete-key path routes through here.
  const makeKonvaDeleteHandler = useCallback(
    (elementType) => (id) => {
      if (!id) return;
      addAction(
        createAction("konva", "DELETE_ELEMENT", { elementType, elementId: id }),
      );
    },
    [createAction, addAction],
  );

  const handleKonvaRectDelete = useCallback(
    makeKonvaDeleteHandler("rectangle"),
    [makeKonvaDeleteHandler],
  );
  const handleKonvaCircleDelete = useCallback(
    makeKonvaDeleteHandler("circle"),
    [makeKonvaDeleteHandler],
  );
  const handleKonvaArrowDelete = useCallback(makeKonvaDeleteHandler("arrow"), [
    makeKonvaDeleteHandler,
  ]);
  const handleKonvaDoubleArrowDelete = useCallback(
    makeKonvaDeleteHandler("double-arrow"),
    [makeKonvaDeleteHandler],
  );
  const handleKonvaTextDelete = useCallback(makeKonvaDeleteHandler("text"), [
    makeKonvaDeleteHandler,
  ]);

  // ── flatten callbacks ──────────────────────────────────────────────────────

  /**
   * Bakes a Konva stage snapshot into the drawing layer.
   *
   * The stage exactly overlays the drawing canvas (absolute, inset 0), so the
   * snapshot is stretched over the *entire* device-pixel buffer. Doing it in
   * device space with an explicit destination size makes this correct whatever
   * pixelRatio the stage snapshot came out at — previously the snapshot was
   * blitted 1:1, which parked it in the top-left corner at 1/dpr scale.
   */
  const compositeKonvaSnapshot = useCallback((canvasEl) => {
    const drawingCanvas = drawingCanvasRef.current;
    const ctx = drawingCanvas?.getContext("2d");
    if (!ctx || !canvasEl || !canvasEl.width || !canvasEl.height) return;
    withDeviceSpace(ctx, dprRef.current, (deviceCtx) => {
      deviceCtx.globalCompositeOperation = "source-over";
      deviceCtx.drawImage(
        canvasEl,
        0,
        0,
        drawingCanvas.width,
        drawingCanvas.height,
      );
    });
  }, []);

  const handleKonvaRectFlatten = useCallback(
    (canvasEl) => {
      compositeKonvaSnapshot(canvasEl);
      setRectangles([]);
      removeKonvaActionsByType("rectangle");
    },
    [compositeKonvaSnapshot, setRectangles, removeKonvaActionsByType],
  );

  const handleKonvaCircleFlatten = useCallback(
    (canvasEl) => {
      compositeKonvaSnapshot(canvasEl);
      setCircles([]);
      removeKonvaActionsByType("circle");
    },
    [compositeKonvaSnapshot, setCircles, removeKonvaActionsByType],
  );

  const handleKonvaArrowFlatten = useCallback(
    (canvasEl) => {
      compositeKonvaSnapshot(canvasEl);
      setArrows([]);
      removeKonvaActionsByType("arrow");
    },
    [compositeKonvaSnapshot, setArrows, removeKonvaActionsByType],
  );

  const handleKonvaDoubleArrowFlatten = useCallback(
    (canvasEl) => {
      compositeKonvaSnapshot(canvasEl);
      setDoubleArrows([]);
      removeKonvaActionsByType("double-arrow");
    },
    [compositeKonvaSnapshot, setDoubleArrows, removeKonvaActionsByType],
  );

  const handleTextFlatten = useCallback(
    (canvasEl) => {
      compositeKonvaSnapshot(canvasEl);
      setTexts([]);
      removeKonvaActionsByType("text");
    },
    [compositeKonvaSnapshot, setTexts, removeKonvaActionsByType],
  );

  // ── misc helpers ───────────────────────────────────────────────────────────

  /**
   * True when a dragged element is over the trash icon and should be deleted.
   *
   * `screenX`/`screenY` are the element's top-left corner in viewport
   * coordinates (each shape layer converts its own node position).
   *
   * Two rules, and the first one is the important one:
   *
   *  1. Anything still over the image is never a delete. The trash icon is
   *     pinned to the viewport's top-left, above the canvas — so without this
   *     check, simply placing an annotation in the image's own top-left corner
   *     landed in the hot zone and destroyed it.
   *  2. Only then does proximity to the icon count, and only just barely: the
   *     old test allowed 80px of slop in every direction, which turned a ~48px
   *     icon into a ~200px blast radius reaching well down into the image.
   */
  const checkTrashZoneCollision = useCallback((screenX, screenY) => {
    const zone = document.getElementById("trash-zone");
    if (!zone) return false;

    // 1. Must be off the image entirely.
    const canvasEl = drawingCanvasRef.current;
    if (canvasEl) {
      const c = canvasEl.getBoundingClientRect();
      const overImage =
        screenX >= c.left &&
        screenX <= c.right &&
        screenY >= c.top &&
        screenY <= c.bottom;
      if (overImage) return false;
    }

    // 2. And actually on the icon — tolerance is for finger accuracy only.
    const r = zone.getBoundingClientRect();
    const tol = 12;
    return (
      screenX >= r.left - tol &&
      screenX <= r.right + tol &&
      screenY >= r.top - tol &&
      screenY <= r.bottom + tol
    );
  }, []);

  const updateTrashZoneState = useCallback(
    (isOver) => setIsDraggedOverTrash(isOver),
    [],
  );

  const hasDrawingCanvasContent = useCallback(() => {
    const c = drawingCanvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !c.width || !c.height) return false;
    // Scan alpha only, and stride over pixels — a HiDPI buffer is ~10M pixels
    // (40M array entries) and a full per-entry `.some()` visibly janks the
    // Cancel tap on mobile. Any real annotation is far wider than the stride.
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const stride = 4 * 4; // every 4th pixel
    for (let i = 3; i < data.length; i += stride) {
      if (data[i] !== 0) return true;
    }
    return false;
  }, []);

  // ── crop ──────────────────────────────────────────────────────────────────

  const drawCropOverlay = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !cropArea) return;
    // cropArea is in logical px, so the whole overlay is drawn in logical px.
    const { width: logicalW, height: logicalH } = logicalSize(
      canvas,
      dprRef.current,
    );
    ctx.clearRect(0, 0, logicalW, logicalH);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, logicalW, logicalH);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      cropArea.x - 1,
      cropArea.y - 1,
      cropArea.width + 2,
      cropArea.height + 2,
    );
    ctx.setLineDash([]);
    const hs = 8;
    [
      [cropArea.x - hs / 2, cropArea.y - hs / 2],
      [cropArea.x + cropArea.width - hs / 2, cropArea.y - hs / 2],
      [cropArea.x - hs / 2, cropArea.y + cropArea.height - hs / 2],
      [
        cropArea.x + cropArea.width - hs / 2,
        cropArea.y + cropArea.height - hs / 2,
      ],
    ].forEach(([x, y]) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, hs, hs);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, hs, hs);
    });
  }, [cropArea]);

  const applyCrop = useCallback(() => {
    if (!cropArea || !baseCanvasRef.current) return;
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    const baseCtx = baseCanvas.getContext("2d");
    const drawingCtx = drawingCanvas?.getContext("2d");
    if (!baseCtx || !drawingCtx || !drawingCanvas) return;
    const dpr = dprRef.current || 1;

    const prevBaseImageData = baseCtx.getImageData(
      0,
      0,
      baseCanvas.width,
      baseCanvas.height,
    );
    // Deliberately NOT snapshotting the drawing layer: entering the crop tool
    // flattens everything into the base layer, so all it holds right now is the
    // dim selection overlay. Storing it meant an undo repainted that overlay
    // over the restored photo — and it cost a ~13MB ImageData per crop.
    const prevWidth = baseCanvas.width;
    const prevHeight = baseCanvas.height;

    const { width: logicalW, height: logicalH } = logicalSize(baseCanvas, dpr);

    // Clamp the selection to the canvas in logical space first, then derive the
    // device-pixel rectangle from it. Deriving both independently is how the
    // crop used to drift by a pixel or two on fractional dprs.
    const x = Math.max(0, Math.min(cropArea.x, logicalW));
    const y = Math.max(0, Math.min(cropArea.y, logicalH));
    const vLogical = {
      x,
      y,
      width: Math.max(1, Math.min(cropArea.width, logicalW - x)),
      height: Math.max(1, Math.min(cropArea.height, logicalH - y)),
    };
    const vDevice = {
      x: Math.round(vLogical.x * dpr),
      y: Math.round(vLogical.y * dpr),
      width: Math.round(vLogical.width * dpr),
      height: Math.round(vLogical.height * dpr),
    };

    const cropAction = createAction("base", "CROP_IMAGE", {
      cropArea: vLogical,
      prevWidth,
      prevHeight,
      baseImageData: prevBaseImageData,
      drawingImageData: null,
    });
    resetHistoryTo(cropAction);

    // Crop only the base (photo) layer — the drawing layer at this point holds
    // nothing but the crop-selection overlay, which we discard.
    const tmpBase = document.createElement("canvas");
    tmpBase.width = vDevice.width;
    tmpBase.height = vDevice.height;
    const tmpBaseCtx = tmpBase.getContext("2d");
    if (!tmpBaseCtx) return;
    tmpBaseCtx.drawImage(
      baseCanvas,
      vDevice.x,
      vDevice.y,
      vDevice.width,
      vDevice.height,
      0,
      0,
      vDevice.width,
      vDevice.height,
    );

    resizeCanvasToLogical(baseCanvas, vLogical.width, vLogical.height, dpr);
    resizeCanvasToLogical(drawingCanvas, vLogical.width, vLogical.height, dpr);
    // Blit the device-resolution crop back 1:1 — going through the dpr
    // transform here would resample it and soften the photo on every crop.
    withDeviceSpace(baseCtx, dpr, (deviceCtx) =>
      deviceCtx.drawImage(tmpBase, 0, 0),
    );

    setCanvasDimensions({ width: vLogical.width, height: vLogical.height });
    setCropArea(null);
    setIsCropping(false);
    setDragStart(null);
    setActiveTool(null);
    // From here on, nativeImageRef/imageDrawParams describe the pre-crop photo
    // — see baseDivergedRef's declaration. Native-resolution export must not
    // be attempted again until a fresh image loads.
    baseDivergedRef.current = true;
  }, [cropArea, createAction, resetHistoryTo]);

  useEffect(() => {
    if (activeTool === "crop") drawCropOverlay();
  }, [cropArea, activeTool, drawCropOverlay]);

  // ── filters ────────────────────────────────────────────────────────────────

  const applyBlackAndWhite = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const ctx = baseCanvas?.getContext("2d");
    if (!baseCanvas || !ctx || !imageDrawParams) return;
    const dpr = dprRef.current || 1;
    const prev = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

    // imageDrawParams is in logical px but getImageData/putImageData ignore the
    // ctx transform and address device px — convert, or the filter lands on
    // only the top-left 1/dpr² of the photo.
    const { offsetX, offsetY, drawWidth, drawHeight } = imageDrawParams;
    const dx = Math.round(offsetX * dpr);
    const dy = Math.round(offsetY * dpr);
    const dw = Math.min(Math.round(drawWidth * dpr), baseCanvas.width - dx);
    const dh = Math.min(Math.round(drawHeight * dpr), baseCanvas.height - dy);
    if (dw <= 0 || dh <= 0) return;

    const area = ctx.getImageData(dx, dy, dw, dh);
    const d = area.data;
    for (let i = 0; i < d.length; i += 4) {
      // Luma-weighted greyscale — a flat (r+g+b)/3 average washes out reds and
      // over-darkens greens, which matters on fabric/garment photos.
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
    ctx.putImageData(area, dx, dy);
    // baseCanvas' pixels are now filtered but nativeImageRef is still the
    // unfiltered decode — see baseDivergedRef.
    baseDivergedRef.current = true;
    const next = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    addAction(ActionCreators.applyFilter("blackAndWhite", prev, next));
    toast({
      title: "Filter Applied",
      description: "Black & White filter applied successfully",
    });
  }, [addAction, toast, imageDrawParams]);

  // Canvas area ceiling for the export buffer, independent of anything shown
  // on screen. ~12MP matches what most phone cameras actually output (many
  // pixel-bin a 48MP+ sensor down to this for the saved JPEG), while staying
  // safely under browsers' hard canvas-area ceiling (~16.7M px on iOS Safari)
  // so a higher-megapixel photo can't crash or hang the export.
  const MAX_EXPORT_PIXELS = 12_000_000;

  /**
   * Builds the canvas that Save/Download actually encode.
   *
   * The on-screen canvases are deliberately kept small (viewport-sized) so
   * drawing stays smooth — see canvasGeometry.js. That means baseCanvas holds
   * the photo already downscaled to fit the editor, and exporting straight
   * from it is what made Save/Download look softer than the original photo.
   *
   * When possible, this instead draws the ORIGINAL decoded photo
   * (`nativeImageRef`) at up to its native resolution, with the annotation
   * layer (`drawingCanvas`) scaled up on top of it. The photo comes out crisp;
   * the annotation layer comes out only as sharp as it already was on screen,
   * because shapes/text are rasterized into that layer the moment they're
   * confirmed (flatten()) — by export time their vector data is already gone,
   * so there is nothing higher-resolution left to redraw them from. Freehand
   * pencil/eraser/line/curve strokes have the same limitation here even though
   * they remain vector data in history, to keep this change scoped to the
   * photo itself rather than also reworking how annotations are composited.
   *
   * Falls back to the plain baseCanvas + drawingCanvas composite (on-screen
   * resolution, always correct) whenever the native path isn't safely usable:
   * once baseCanvas has diverged from the pristine photo — a mobile "confirm"
   * flatten, a filter, or a crop, see `baseDivergedRef` — or before the image
   * has finished loading.
   */
  const buildExportCanvas = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!baseCanvas || !drawingCanvas) return null;

    // Exports are JPEG, which has no alpha — any pixel left transparent would
    // encode as black. The canvas IS the photo edge-to-edge, so this
    // should never bite, but a rounding gap at an edge is cheap to rule out.
    const paintBackdrop = (ctx, width, height) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    };

    const legacyComposite = () => {
      const tmp = document.createElement("canvas");
      tmp.width = baseCanvas.width;
      tmp.height = baseCanvas.height;
      const ctx = tmp.getContext("2d");
      if (!ctx) return null;
      paintBackdrop(ctx, tmp.width, tmp.height);
      ctx.drawImage(baseCanvas, 0, 0);
      ctx.drawImage(drawingCanvas, 0, 0);
      return tmp;
    };

    const nativeImg = nativeImageRef.current;
    const params = imageDrawParams;
    const { width: canvasW, height: canvasH } = canvasDimensions;
    const canUseNative =
      !baseDivergedRef.current &&
      nativeImg &&
      params &&
      params.drawWidth > 0 &&
      params.naturalWidth > 0 &&
      canvasW > 0 &&
      canvasH > 0;

    if (!canUseNative) return legacyComposite();

    const { offsetX, offsetY, drawWidth, drawHeight, naturalWidth } = params;

    // Never scale below what's already on screen (that would make export
    // WORSE than today), and never past the safety ceiling above.
    const rawScale = naturalWidth / drawWidth;
    const areaCapScale = Math.sqrt(MAX_EXPORT_PIXELS / (canvasW * canvasH));
    const scale = Math.max(1, Math.min(rawScale, areaCapScale));

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(canvasW * scale));
    exportCanvas.height = Math.max(1, Math.round(canvasH * scale));
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return legacyComposite();

    paintBackdrop(ctx, exportCanvas.width, exportCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // The photo: drawn from the untouched decode, not the downscaled on-screen
    // canvas — this is the whole point, a blur-then-upscale never happens.
    ctx.drawImage(
      nativeImg,
      offsetX * scale,
      offsetY * scale,
      drawWidth * scale,
      drawHeight * scale,
    );
    // The annotation layer: scaled up as a single flat image on top.
    ctx.drawImage(drawingCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

    return exportCanvas;
  }, [imageDrawParams, canvasDimensions]);

  const downloadImage = () => {
    // Bake any shape still living in a Konva stage, the same way handleSave
    // does — otherwise Download silently omits annotations the user has drawn
    // but not yet confirmed.
    konvaRectRef.current?.flatten();
    konvaCircleRef.current?.flatten();
    konvaArrowRef.current?.flatten();
    konvaDoubleArrowRef.current?.flatten();
    textEditorRef.current?.flatten();

    const tmp = buildExportCanvas();
    if (!tmp) return;

    // toBlob + object URL rather than toDataURL: a full-resolution HiDPI PNG
    // base64-encodes to tens of megabytes of string, which is a real problem on
    // a phone. Format and quality come from EXPORT_MIME_TYPE /
    // EXPORT_QUALITY in buildImageEditResult.js, so Download and Save always
    // agree.
    tmp.toBlob(
      (blob) => {
        if (!blob) {
          toast({
            title: "Download failed",
            description: "Could not export the image. Please try again.",
            variant: "destructive",
          });
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        // Name from the blob's real type: browsers that cannot encode WebP fall
        // back to PNG silently, and a PNG named .webp will not open everywhere.
        a.download = buildEditedFileName(
          resolvedImage.name,
          extensionForMimeType(blob.type),
        );
        a.href = url;
        a.click();
        // Give the browser a tick to start the download before dropping the URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      EXPORT_MIME_TYPE,
      EXPORT_QUALITY,
    );
  };

  const flattenLayers = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!baseCanvas || !drawingCanvas) return;
    const dpr = dprRef.current || 1;

    const tmp = document.createElement("canvas");
    tmp.width = baseCanvas.width;
    tmp.height = baseCanvas.height;
    const tmpCtx = tmp.getContext("2d");
    if (!tmpCtx) return;
    tmpCtx.drawImage(baseCanvas, 0, 0);
    tmpCtx.drawImage(drawingCanvas, 0, 0);

    const baseCtx = baseCanvas.getContext("2d");
    const drawingCtx = drawingCanvas.getContext("2d");
    if (!baseCtx || !drawingCtx) return;

    // Composite in device space so the merge is a 1:1 blit with no resampling.
    withDeviceSpace(baseCtx, dpr, (deviceCtx) => {
      deviceCtx.globalCompositeOperation = "source-over";
      deviceCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      deviceCtx.drawImage(tmp, 0, 0);
    });
    withDeviceSpace(drawingCtx, dpr, (deviceCtx) => {
      deviceCtx.globalCompositeOperation = "source-over";
      deviceCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    });

    // The annotations now live in baseCanvas, so an export that rebuilds the
    // photo from nativeImageRef and ignores baseCanvas would drop them. See
    // baseDivergedRef.
    baseDivergedRef.current = true;

    removeActionsByTarget("drawing");
  }, [removeActionsByTarget]);

  // ── mouse / touch drawing ──────────────────────────────────────────────────

  const getMousePos = (e) =>
    getLogicalPointerPos(drawingCanvasRef.current, e, dprRef.current);

  // Zeroing the dimensions frees the backing store immediately rather than
  // leaving a full-size canvas for GC to notice — this one is the same size as
  // the drawing layer, so it is worth being explicit about on a phone.
  const releaseLinePreviewBase = useCallback(() => {
    const snapshot = linePreviewBaseRef.current;
    if (!snapshot) return;
    snapshot.width = 0;
    snapshot.height = 0;
    linePreviewBaseRef.current = null;
  }, []);

  const handleEraserCursorMove = (e) => {
    if (activeTool !== "eraser") return;
    setEraserCursor(getMousePos(e));
  };

  const startDrawing = (e) => {
    const pos = getMousePos(e);
    if (activeTool === "text") {
      setTextInputPosition(pos);
      return;
    }
    if (activeTool === "curve" || activeTool === "curve-arrow") return;
    if (activeTool === "crop") {
      clearLogical(drawingCanvasRef.current?.getContext("2d"), dprRef.current);
      setIsDrawing(true);
      setIsCropping(true);
      setDragStart(pos);
      setCropArea({ x: pos.x, y: pos.y, width: 0, height: 0 });
      drawCropOverlay();
      return;
    }
    const drawingCanvas = drawingCanvasRef.current;
    const ctx = drawingCanvas?.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    setStartPoint(pos);
    currentStrokeRef.current = [pos];
    if (activeTool === "line") {
      // The line preview has to repaint the layer beneath it on every move.
      // Capturing it once here turns that into a blit; see `draw`.
      const snapshot = document.createElement("canvas");
      snapshot.width = drawingCanvas.width;
      snapshot.height = drawingCanvas.height;
      snapshot.getContext("2d")?.drawImage(drawingCanvas, 0, 0);
      linePreviewBaseRef.current = snapshot;
    }
    if (["pencil", "eraser"].includes(activeTool)) {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.globalCompositeOperation =
        activeTool === "eraser" ? "destination-out" : "source-over";
      if (activeTool !== "eraser") ctx.strokeStyle = currentColor;
    }
  };

  const draw = (e) => {
    const currentPos = getMousePos(e);
    if (activeTool === "text" || !isDrawing) return;
    if (activeTool === "curve" || activeTool === "curve-arrow") return;
    const drawingCanvas = drawingCanvasRef.current;
    const ctx = drawingCanvas?.getContext("2d");
    if (!drawingCanvas || !ctx) return;
    currentStrokeRef.current.push(currentPos);

    if (activeTool === "crop" && dragStart && isDrawing) {
      // Clamp against the LOGICAL extent — drawingCanvas.width is device px and
      // would let the selection run dpr× past the right/bottom edge.
      const bounds = logicalSize(drawingCanvas, dprRef.current);
      const x = Math.max(0, Math.min(currentPos.x, bounds.width));
      const y = Math.max(0, Math.min(currentPos.y, bounds.height));
      const w = x - dragStart.x,
        h = y - dragStart.y;
      setCropArea({
        x: w < 0 ? x : dragStart.x,
        y: h < 0 ? y : dragStart.y,
        width: Math.abs(w),
        height: Math.abs(h),
      });
      requestAnimationFrame(() => drawCropOverlay());
      return;
    }
    if (["pencil", "eraser"].includes(activeTool)) {
      ctx.globalCompositeOperation =
        activeTool === "eraser" ? "destination-out" : "source-over";
      if (activeTool !== "eraser") ctx.strokeStyle = currentColor;
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    if (activeTool === "line" && startPoint) {
      // Restore what was underneath, then draw the rubber-band line on top.
      //
      // This used to clear the layer and replay every DRAW_* action in history
      // on every pointer move — O(number of strokes) per frame, plus a fresh
      // filtered array each time. With a few dozen strokes on the canvas that
      // was thousands of stroke replays a second. The snapshot taken in
      // startDrawing is that same pixel state, so one blit replaces all of it.
      const snapshot = linePreviewBaseRef.current;
      withDeviceSpace(ctx, dprRef.current, (deviceCtx) => {
        deviceCtx.globalCompositeOperation = "source-over";
        deviceCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        if (snapshot) deviceCtx.drawImage(snapshot, 0, 0);
      });
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      switch (strokeStyle) {
        case "dashed":
          ctx.setLineDash([brushSize * 3, brushSize * 2]);
          break;
        case "dotted":
          ctx.setLineDash([brushSize, brushSize]);
          break;
        default:
          ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const stopDrawing = () => {
    if (activeTool === "crop") {
      setIsDrawing(false);
      if (cropArea && cropArea.width > 10 && cropArea.height > 10) {
        setIsCropping(false);
        setDragStart(null);
        requestAnimationFrame(() => drawCropOverlay());
      } else {
        setCropArea(null);
        setIsCropping(false);
        setDragStart(null);
        clearLogical(
          drawingCanvasRef.current?.getContext("2d"),
          dprRef.current,
        );
      }
      return;
    }
    if (activeTool === "curve" || activeTool === "curve-arrow") return;
    if (!isDrawing) return;
    const ctx = drawingCanvasRef.current?.getContext("2d");
    if (ctx) {
      if (["pencil", "eraser"].includes(activeTool)) {
        ctx.closePath();
        ctx.globalCompositeOperation = "source-over";
        const strokePoints = currentStrokeRef.current;
        if (strokePoints.length > 0) {
          addAction(
            createAction(
              "drawing",
              activeTool === "pencil" ? "DRAW_PENCIL" : "DRAW_ERASER",
              {
                points: strokePoints,
                color: currentColor,
                strokeWidth: brushSize,
                strokeStyle,
                isEraser: activeTool === "eraser",
              },
            ),
          );
          // ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      } else if (activeTool === "line" && startPoint) {
        const linePoints = currentStrokeRef.current;
        const endPoint = linePoints[linePoints.length - 1] || startPoint;
        addAction(
          createAction("drawing", "DRAW_LINE", {
            points: [startPoint, endPoint],
            color: currentColor,
            strokeWidth: brushSize,
            strokeStyle,
            startPoint,
            endPoint,
            isEraser: false,
          }),
        );
        // ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      setIsDrawing(false);
      setStartPoint(null);
      currentStrokeRef.current = [];
      releaseLinePreviewBase();
    }
  };

  // ── save / cancel ──────────────────────────────────────────────────────────

  // Save is slow enough to be double-tapped: the export encodes the whole
  // canvas, and `onSave` then uploads it. Both are async, so without a guard a
  // second tap starts a second export and a second upload of the same photo.
  // The flag both blocks re-entry and drives the toolbar's spinner.
  //
  // Deliberately never cleared on the success path — `onSave` closes the
  // editor, and dropping back to an enabled tick for the frame before unmount
  // just invites one more tap. It is cleared on every failure path so the
  // user can retry.
  const handleSave = async () => {
    if (cropArea || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);

    konvaRectRef.current?.flatten();
    konvaCircleRef.current?.flatten();
    konvaArrowRef.current?.flatten();
    konvaDoubleArrowRef.current?.flatten();
    textEditorRef.current?.flatten();
    const tmp = buildExportCanvas();
    if (!tmp) {
      isSavingRef.current = false;
      setIsSaving(false);
      return;
    }

    try {
      const result = await buildImageEditResult(tmp, {
        fileName: buildEditedFileName(
          resolvedImage.name,
          extensionForMimeType(EXPORT_MIME_TYPE),
        ),
      });
      // Awaited so the spinner covers the caller's own work (e.g. an upload)
      // for as long as the editor is still mounted, not just the encode.
      await onSave(result);
    } catch (err) {
      console.error("Failed to build image edit result:", err);
      isSavingRef.current = false;
      setIsSaving(false);
      toast({
        title: "Save failed",
        description: "Could not export the edited image. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    const unsaved =
      // actionCount covers base-layer edits (crop, filter) that leave no trace
      // on the drawing layer but are still unsaved work.
      actionCount > 0 ||
      hasDrawingCanvasContent() ||
      rectangles.length > 0 ||
      texts.length > 0 ||
      arrows.length > 0 ||
      circles.length > 0 ||
      doubleArrows.length > 0 ||
      textInputPosition !== null ||
      cropArea !== null;
    if (unsaved) setShowCancelConfirm(true);
    else onClose();
  };

  const confirmToolOptions = useCallback(() => {
    switch (activeTool) {
      case "rectangle":
        konvaRectRef.current?.flatten();
        break;
      case "circle":
        konvaCircleRef.current?.flatten();
        break;
      case "arrow":
        konvaArrowRef.current?.flatten();
        break;
      case "double-arrow":
        konvaDoubleArrowRef.current?.flatten();
        break;
      case "text":
        textEditorRef.current?.flatten();
        break;
      default:
        break; // pencil / eraser / line / curve / curve-arrow: nothing pending
    }
    setActiveTool(null);
  }, [
    activeTool,
    konvaRectRef,
    konvaCircleRef,
    konvaArrowRef,
    konvaDoubleArrowRef,
    textEditorRef,
  ]);

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    onClose();
  };

  const handleToolChange = (tool) => {
    if (activeTool === "eraser") setBrushSize(10);
    else if (activeTool === "pencil") setBrushSize(3);

    if (tool === "crop") {
      // Crop resizes both buffers, so anything still living in a Konva stage or
      // on the drawing layer has to be baked into the photo first or it would
      // be discarded / land at the wrong coordinates afterwards.
      try {
        konvaRectRef.current?.flatten();
        konvaCircleRef.current?.flatten();
        konvaArrowRef.current?.flatten();
        konvaDoubleArrowRef.current?.flatten();
        textEditorRef.current?.flatten();
        flattenLayers();
      } catch (err) {
        console.error("[ImageEditor] flatten before crop failed:", err);
      }
      setCropArea(null);
      setIsCropping(false);
      setDragStart(null);
    }

    if (tool !== "crop" && activeTool === "crop") {
      // Leaving crop without applying: drop the dimmed selection overlay.
      setCropArea(null);
      setIsCropping(false);
      setDragStart(null);
      clearLogical(drawingCanvasRef.current?.getContext("2d"), dprRef.current);
    }

    if (tool === "text") {
      setTextInputPosition(null);
      setText("");
    }
    setSelectedElementId(null);
    setSelectedElementType(null);
    setShowTrashIcon(false);
    setIsDraggedOverTrash(false);
    setIsTextToolActive(tool === "text");
    setActiveTool(tool);
  };
  // ── shared Konva props factory ─────────────────────────────────────────────

  // Konva stages are sized in LOGICAL px and CSS-stretched to fill the canvas
  // box, matching the 2D layers' coordinate space exactly. Driving them from
  // state (rather than reading canvas.width during render) keeps them in sync
  // after a crop or a resize.
  const sharedKonvaProps = {
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    color: currentColor,
    setColor: setCurrentColor,
    brushSize,
    setBrushSize,
    strokeStyle,
    setStrokeStyle,
    backgroundColor,
    setBackgroundColor,
    onElementSelect: (id, type) => {
      setSelectedElementId(id);
      setSelectedElementType(type);
    },
    onElementDeselect: () => {
      setSelectedElementId(null);
      setSelectedElementType(null);
    },
    checkTrashZoneCollision,
    updateTrashZoneState,
  };

  if (!isOpen) return null;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    // Style scope: the stylesheet is emitted under `#image-editor-modal`
    // (descendant selector), so the id sits on a box-less wrapper.
    <div id="image-editor-modal" style={{ display: "contents" }}>
    <div
      className="rie-fixed rie-inset-0 rie-z-50 rie-flex rie-items-center rie-justify-center rie-bg-black/80"
      tabIndex={-1}
    >
      <div
        className="rie-flex rie-flex-col rie-bg-white rie-w-screen rie-h-screen lg:rie-rounded-lg lg:rie-w-[98vw] lg:rie-max-w-5xl lg:rie-h-[80vh] rie-overflow-hidden"
        style={isMobile ? { height: "100dvh" } : undefined}
      >
        {/* Header */}
        <div className="rie-p-4 rie-border-b rie-hidden lg:rie-flex rie-items-center rie-justify-between">
          <h2 className="rie-text-lg rie-font-semibold">
            Edit Image: {resolvedImage.name}
          </h2>
        </div>

        {/* Body */}
        <div className="rie-flex rie-flex-col lg:rie-flex-row rie-flex-grow rie-overflow-hidden">
          {/* ── Mobile toolbar ── */}
          <div className="lg:rie-hidden">
            <MobileView
              historyState={historyState}
              undo={handleUndo}
              canUndo={canUndo}
              redo={handleRedo}
              canRedo={canRedo}
              setActiveTool={setActiveTool}
              activeTool={activeTool}
              drawingCanvasRef={drawingCanvasRef}
              handleToolChange={handleToolChange}
              currentColor={currentColor}
              setCurrentColor={setCurrentColor}
              backgroundColor={backgroundColor}
              setBackgroundColor={setBackgroundColor}
              brushSize={brushSize}
              setBrushSize={setBrushSize}
              minBrushSize={minBrushSize}
              maxBrushSize={maxBrushSize}
              cropArea={cropArea}
              setCropArea={setCropArea}
              flattenLayers={flattenLayers}
              konvaRectRef={konvaRectRef}
              konvaCircleRef={konvaCircleRef}
              konvaArrowRef={konvaArrowRef}
              konvaDoubleArrowRef={konvaDoubleArrowRef}
              textEditorRef={textEditorRef}
              downloadImage={downloadImage}
              showCropConfirm={showCropConfirm}
              handleSave={handleSave}
              isSaving={isSaving}
              handleCancel={handleCancel}
              isTextDragging={isTextDragging}
              textColor={textColor}
              setTextColor={setTextColor}
              textBgColor={textBgColor}
              cycleTextBg={cycleTextBg}
              // setShowCropConfirm={setShowCropConfirm}
              applyCrop={applyCrop}
              confirmToolOptions={confirmToolOptions}
            />
          </div>

          {/* ── Left panel (desktop) ── */}
          <div className="rie-hidden lg:rie-flex rie-flex-col lg:rie-w-52 lg:rie-flex-shrink-0 lg:rie-border-r rie-p-2 rie-gap-2 rie-overflow-y-auto">
            {/* Undo / Redo */}
            <div className="rie-flex rie-justify-between rie-gap-2">
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={!canUndo}
                title={`Undo (${actionCount} actions)`}
                className="rie-flex rie-items-center rie-gap-2 rie-p-3"
              >
                <Undo2 className="rie-h-4 rie-w-4" /> Undo
              </Button>
              <Button
                variant="outline"
                onClick={handleRedo}
                disabled={!canRedo}
                title="Redo"
                className="rie-flex rie-items-center rie-gap-2 rie-p-3"
              >
                <Redo2 className="rie-h-4 rie-w-4" /> Redo
              </Button>
            </div>

            {/* Tool grid */}
            <div className="rie-grid rie-grid-cols-2 rie-gap-2">
              {[
                ["pencil", <Pencil className="rie-h-4 rie-w-4" />, "Pencil"],
                ["eraser", <Eraser className="rie-h-4 rie-w-4" />, "Eraser"],
                ["rectangle", <Square className="rie-h-4 rie-w-4" />, "Rectangle"],
                ["circle", <Circle className="rie-h-4 rie-w-4" />, "Circle"],
                ["text", <Type className="rie-h-4 rie-w-4" />, "Text"],
                ["arrow", <ArrowRight className="rie-h-4 rie-w-4" />, "Arrow"],
                [
                  "double-arrow",
                  <ArrowRightLeft className="rie-h-4 rie-w-4" />,
                  "Double Arrow",
                ],
                ["line", <MinusIcon className="rie-h-4 rie-w-4" />, "Line"],
              ].map(([tool, icon, label]) => (
                <Button
                  key={tool}
                  variant={activeTool === tool ? "toolActive" : "tool"}
                  onClick={() => handleToolChange(tool)}
                  className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-2 !rie-gap-1 rie-min-w-[45%]"
                >
                  {icon} {label}
                </Button>
              ))}

              {/* Crop — with confirm guard */}
              <Button
                variant={activeTool === "crop" ? "toolActive" : "tool"}
                onClick={() => handleToolChange("crop")}
                className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-2 !rie-gap-1 rie-min-w-[45%]"
              >
                <Crop className="rie-h-4 rie-w-4" /> Crop
              </Button>

              <Button
                variant={activeTool === "curve" ? "toolActive" : "tool"}
                onClick={() => setActiveTool("curve")}
                className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-2 !rie-gap-1 rie-min-w-[45%]"
              >
                <PenTool className="rie-h-4 rie-w-4" /> Curve
              </Button>

              <Button
                variant={activeTool === "curve-arrow" ? "toolActive" : "tool"}
                onClick={() => setActiveTool("curve-arrow")}
                className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-2 !rie-gap-1 rie-min-w-[45%]"
              >
                <TbArrowCurveRight className="rie-h-4 rie-w-4" /> Curve Arrow
              </Button>
            </div>

            {/* Crop controls */}
            {activeTool === "crop" && (
              <div className="rie-space-y-2 rie-mt-2">
                <p className="rie-text-sm rie-text-gray-500">
                  Draw a rectangle to crop. Click Apply to confirm.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCropArea(null);
                    setIsCropping(false);
                    setDragStart(null);
                    clearLogical(
                      drawingCanvasRef.current?.getContext("2d"),
                      dprRef.current,
                    );
                  }}
                  className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-1 !rie-gap-1 rie-w-full !rie-h-max"
                >
                  Cancel
                </Button>
                <Button
                  onClick={applyCrop}
                  disabled={!cropArea}
                  className="!rie-flex !rie-flex-col !rie-px-2 !rie-py-1 !rie-gap-1 rie-w-full !rie-h-max"
                >
                  Apply
                </Button>
              </div>
            )}

            {/* Stroke style */}
            {activeTool &&
              [
                "line",
                "rectangle",
                "circle",
                "arrow",
                "double-arrow",
                "curve",
                "curve-arrow",
              ].includes(activeTool) && (
                <div className="rie-mt-4">
                  <Label
                    htmlFor="stroke-style"
                    className="rie-flex rie-items-center rie-gap-2 rie-mb-1"
                  >
                    <Grip className="rie-h-4 rie-w-4" /> Stroke Style
                  </Label>
                  <Select value={strokeStyle} onValueChange={setStrokeStyle}>
                    <SelectItem value="solid">Solid</SelectItem>
                    <SelectItem value="dashed">Dashed</SelectItem>
                    <SelectItem value="dotted">Dotted</SelectItem>
                  </Select>
                </div>
              )}

            {/* Background color */}
            {activeTool &&
              ["text", "rectangle", "circle"].includes(activeTool) && (
                <div className="rie-flex rie-items-center rie-gap-2 rie-mt-2">
                  <Label htmlFor="backgroundColor" className="rie-text-sm">
                    Background
                  </Label>
                  <input
                    id="backgroundColor"
                    type="color"
                    value={
                      backgroundColor === "transparent"
                        ? "#ffffff"
                        : backgroundColor
                    }
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="rie-rounded-full rie-w-6 rie-h-6 rie-cursor-pointer"
                  />
                  <GrClear
                    className="rie-h-4 rie-w-4 rie-cursor-pointer"
                    onClick={() => setBackgroundColor("transparent")}
                  />
                </div>
              )}

            {/* Color picker */}
            <div className="rie-flex rie-items-center rie-gap-2 rie-mt-4">
              <Label
                htmlFor="color-picker-lg"
                className="rie-flex rie-items-center rie-gap-2"
              >
                <Palette className="rie-h-4 rie-w-4" /> Color
              </Label>
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                className="rie-rounded-full rie-w-12 rie-h-6 rie-cursor-pointer"
              />
            </div>

            {/* Brush size */}
            <div className="rie-mt-4">
              <Label htmlFor="brush-size-lg" className="rie-mb-2 rie-block">
                Brush Size: {brushSize}px
              </Label>
              <div className="rie-flex rie-items-center rie-gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setBrushSize((s) => Math.max(minBrushSize, s - 1))
                  }
                  className="rie-h-8 rie-w-8"
                >
                  <Minus className="rie-h-4 rie-w-4" />
                </Button>
                <Slider
                  id="brush-size-lg"
                  min={minBrushSize}
                  max={maxBrushSize}
                  step={1}
                  value={[brushSize]}
                  onValueChange={(v) => setBrushSize(v[0])}
                  className="rie-flex-grow"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setBrushSize((s) => Math.min(maxBrushSize, s + 1))
                  }
                  className="rie-h-8 rie-w-8"
                >
                  <Plus className="rie-h-4 rie-w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* ── Canvas area ── */}
          {/* Bottom padding caps at 80px (unchanged from before, on a normal
              portrait phone) but yields to 10dvh on a short viewport — a
              fixed 80px is a small, deliberate gap in portrait's generous
              height budget but eats a quarter of the space in landscape,
              where the photo is already height-constrained (see
              refitCanvasOnResize / the aspect-fit in drawImageOnCanvas). */}
          {/* touch-none (touch-action: none) claims every touch gesture in this
              area for the app's own handlers. This area runs edge-to-edge, so
              without it, starting a stroke near the screen's left edge got
              picked up by the browser's own edge-swipe-back gesture recognizer
              — visibly dragging the whole page mid-stroke — before the touch
              ever reached our onTouchMove. Safe here: nothing under this div
              relies on native touch behaviour (scroll is already locked
              elsewhere, no pinch-zoom is used), every gesture is handled by
              our own pointer handlers.

              This fully stops it on Android. On iOS Safari it doesn't: the
              edge-swipe-back there is a chrome-level gesture recognizer with
              its own reserved hot zone at the true screen edge (commonly
              ~20-30px) that iOS does not let web content opt out of via
              touch-action or overscroll-behavior — it still wins inside that
              strip regardless. px-6 (24px, mobile only) keeps the canvas
              itself — and so every drawing touch — starting outside that
              zone, which is what actually avoids the conflict there. This is
              a heuristic, not a guarantee: iOS doesn't publish an exact hot
              zone width, and it can vary by device/iOS version/accessibility
              settings. Widen it if a stroke still starts the slide on a real
              iPhone. */}
          <div
            ref={canvasAreaRef}
            className="rie-flex-1 rie-flex rie-items-center rie-justify-center rie-bg-black lg:rie-bg-gray-100 rie-min-h-0 rie-relative rie-overflow-hidden rie-touch-none rie-px-6 rie-pb-[min(80px,10dvh)] lg:rie-p-0"
          >
            <div
              className="rie-relative lg:rie-border-2 lg:rie-border-gray-300"
              id="drawing-canvas"
              style={{
                width: canvasDimensions.width,
                height: canvasDimensions.height,
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              <canvas
                ref={baseCanvasRef}
                className="rie-absolute rie-bg-black lg:rie-bg-white rie-object-contain rie-w-full rie-h-full"
              />
              <canvas
                ref={drawingCanvasRef}
                onMouseDown={startDrawing}
                onMouseMove={(e) => {
                  draw(e);
                  handleEraserCursorMove(e);
                }}
                onMouseUp={stopDrawing}
                onMouseLeave={() => {
                  stopDrawing();
                  setEraserCursor(null);
                }}
                onTouchStart={startDrawing}
                onTouchMove={(e) => {
                  draw(e);
                  handleEraserCursorMove(e);
                }}
                onTouchEnd={() => {
                  stopDrawing();
                  setEraserCursor(null);
                }}
                className="rie-absolute rie-w-full rie-h-full"
                style={{
                  cursor:
                    activeTool === "text"
                      ? "text"
                      : activeTool === null
                        ? "default"
                        : activeTool === "eraser"
                          ? "none"
                          : "crosshair",
                }}
              />

              {/* Konva layers — wrapped in Suspense (replaces next/dynamic) */}
              {mounted && (
                <Suspense fallback={null}>
                  {activeTool === "rectangle" && (
                    <KonvaRectangle
                      ref={konvaRectRef}
                      {...sharedKonvaProps}
                      active={true}
                      onAdd={handleKonvaRectAdd}
                      onMove={handleKonvaRectMove}
                      rectangles={rectangles}
                      setRectangles={setRectangles}
                      onFlatten={handleKonvaRectFlatten}
                      onDelete={handleKonvaRectDelete}
                    />
                  )}
                  {activeTool === "circle" && (
                    <KonvaCircle
                      ref={konvaCircleRef}
                      {...sharedKonvaProps}
                      active={true}
                      onAdd={handleKonvaCircleAdd}
                      onMove={handleKonvaCircleMove}
                      circles={circles}
                      setCircles={setCircles}
                      onFlatten={handleKonvaCircleFlatten}
                      onDelete={handleKonvaCircleDelete}
                    />
                  )}
                  {activeTool === "arrow" && (
                    <ArrowKonva
                      ref={konvaArrowRef}
                      {...sharedKonvaProps}
                      active={true}
                      onAdd={handleKonvaArrowAdd}
                      onMove={handleKonvaArrowMove}
                      arrows={arrows}
                      setArrows={setArrows}
                      onFlatten={handleKonvaArrowFlatten}
                      onDelete={handleKonvaArrowDelete}
                    />
                  )}
                  {activeTool === "double-arrow" && (
                    <KonvaDoubleArrow
                      ref={konvaDoubleArrowRef}
                      {...sharedKonvaProps}
                      active={true}
                      onAdd={handleKonvaDoubleArrowAdd}
                      onMove={handleKonvaDoubleArrowMove}
                      arrows={doubleArrows}
                      setArrows={setDoubleArrows}
                      onFlatten={handleKonvaDoubleArrowFlatten}
                      onDelete={handleKonvaDoubleArrowDelete}
                    />
                  )}
                  {activeTool === "text" && (
                    <TextEditor
                      ref={textEditorRef}
                      {...sharedKonvaProps}
                      color={textColor}
                      setColor={setTextColor}
                      backgroundColor={textBgColor}
                      setBackgroundColor={setTextBgColor}
                      active={true}
                      allowCreate={true}
                      fontSize={fontSize}
                      fontFamily={fontFamily}
                      onAdd={handleKonvaTextAdd}
                      onMove={handleKonvaTextMove}
                      texts={texts}
                      setTexts={setTexts}
                      onFlatten={handleTextFlatten}
                      onDelete={handleKonvaTextDelete}
                    />
                  )}

                  {/* Passive layers — keep shapes visible when tool changes */}
                  {activeTool !== "rectangle" && rectangles.length > 0 && (
                    <KonvaRectangle
                      ref={konvaRectRef}
                      {...sharedKonvaProps}
                      active={false}
                      onAdd={handleKonvaRectAdd}
                      onMove={handleKonvaRectMove}
                      rectangles={rectangles}
                      setRectangles={setRectangles}
                      onFlatten={handleKonvaRectFlatten}
                      onDelete={handleKonvaRectDelete}
                    />
                  )}
                  {activeTool !== "circle" && circles.length > 0 && (
                    <KonvaCircle
                      ref={konvaCircleRef}
                      {...sharedKonvaProps}
                      active={false}
                      onAdd={handleKonvaCircleAdd}
                      onMove={handleKonvaCircleMove}
                      circles={circles}
                      setCircles={setCircles}
                      onFlatten={handleKonvaCircleFlatten}
                      onDelete={handleKonvaCircleDelete}
                    />
                  )}
                  {activeTool !== "arrow" && arrows.length > 0 && (
                    <ArrowKonva
                      ref={konvaArrowRef}
                      {...sharedKonvaProps}
                      active={false}
                      onAdd={handleKonvaArrowAdd}
                      onMove={handleKonvaArrowMove}
                      arrows={arrows}
                      setArrows={setArrows}
                      onFlatten={handleKonvaArrowFlatten}
                      onDelete={handleKonvaArrowDelete}
                    />
                  )}
                  {activeTool !== "double-arrow" && doubleArrows.length > 0 && (
                    <KonvaDoubleArrow
                      ref={konvaDoubleArrowRef}
                      {...sharedKonvaProps}
                      active={false}
                      onAdd={handleKonvaDoubleArrowAdd}
                      onMove={handleKonvaDoubleArrowMove}
                      arrows={doubleArrows}
                      setArrows={setDoubleArrows}
                      onFlatten={handleKonvaDoubleArrowFlatten}
                      onDelete={handleKonvaDoubleArrowDelete}
                    />
                  )}
                  {activeTool !== "text" && texts.length > 0 && (
                    <TextEditor
                      ref={textEditorRef}
                      {...sharedKonvaProps}
                      color={textColor}
                      setColor={setTextColor}
                      backgroundColor={textBgColor}
                      setBackgroundColor={setTextBgColor}
                      active={isMobile && activeTool === null}
                      allowCreate={false}
                      fontSize={fontSize}
                      fontFamily={fontFamily}
                      onAdd={handleKonvaTextAdd}
                      onMove={handleKonvaTextMove}
                      texts={texts}
                      setTexts={setTexts}
                      onFlatten={handleTextFlatten}
                      onDragStateChange={setIsTextDragging}
                      onDelete={handleKonvaTextDelete}
                    />
                  )}
                </Suspense>
              )}

              {/* Curve tools */}
              {activeTool === "curve" && (
                <CurveTool
                  active
                  canvasRef={drawingCanvasRef}
                  currentColor={currentColor}
                  setActiveTool={setActiveTool}
                  strokeStyle={strokeStyle}
                  brushSize={brushSize}
                  createAction={createAction}
                  addAction={addAction}
                  replayManager={replayManager}
                  historyState={historyState}
                  dprRef={dprRef}
                />
              )}
              {activeTool === "curve-arrow" && (
                <CurveArrowTool
                  active
                  canvasRef={drawingCanvasRef}
                  currentColor={currentColor}
                  setActiveTool={setActiveTool}
                  strokeStyle={strokeStyle}
                  brushSize={brushSize}
                  createAction={createAction}
                  addAction={addAction}
                  replayManager={replayManager}
                  historyState={historyState}
                  dprRef={dprRef}
                />
              )}

              {/* Eraser cursor ring */}
              {eraserCursor && activeTool === "eraser" && (
                <div
                  style={{
                    position: "absolute",
                    left: `${eraserCursor.x - brushSize / 2}px`,
                    top: `${eraserCursor.y - brushSize / 2}px`,
                    width: `${brushSize}px`,
                    height: `${brushSize}px`,
                    border: "2px solid #07070780",
                    borderRadius: "50%",
                    pointerEvents: "none",
                    background: "rgba(255,255,255,0.1)",
                    zIndex: 10,
                    boxSizing: "border-box",
                  }}
                />
              )}

              {/* Mobile trash drop zone */}
              {showTrashIcon && (
                <div
                  id="trash-zone"
                  className={`rie-fixed rie-top-0 rie-left-0 rie-p-3 rie-rounded-full rie-shadow-lg rie-border-2 rie-transition-all rie-duration-200 rie-text-white ${
                    isDraggedOverTrash
                      ? "rie-bg-red-600 rie-border-red-700 rie-scale-125"
                      : "rie-bg-red-500 rie-border-red-600"
                  }`}
                  style={{
                    background: isDraggedOverTrash
                      ? "linear-gradient(135deg,#dc2626,#b91c1c)"
                      : "linear-gradient(135deg,#ef4444,#dc2626)",
                    boxShadow: isDraggedOverTrash
                      ? "0 6px 20px rgba(239,68,68,.6)"
                      : "0 4px 15px rgba(239,68,68,.4)",
                    zIndex: 9999,
                    pointerEvents: "none",
                  }}
                >
                  <Trash2
                    className={`rie-h-6 rie-w-6 rie-transition-transform rie-duration-200 ${isDraggedOverTrash ? "rie-scale-110" : ""}`}
                  />
                  <div className="rie-absolute -rie-top-8 rie-left-1/2 -rie-translate-x-1/2 rie-bg-black rie-text-white rie-text-[8px] rie-px-2 rie-py-1 rie-rounded rie-whitespace-nowrap rie-pointer-events-none">
                    {isDraggedOverTrash
                      ? "Release to delete"
                      : "Drag here to delete"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Bottom black spacer (mobile only) ── */}
          <div className="lg:rie-hidden rie-bg-black rie-flex-shrink-0 rie-pb-[env(safe-area-inset-bottom)]" />
        </div>

        {/* ── Footer ── */}
        <div className="rie-p-2 sm:rie-p-4 rie-border-t rie-hidden lg:rie-flex rie-justify-end rie-flex-row rie-gap-2 rie-flex-wrap">
          <Button
            variant="outline"
            onClick={applyBlackAndWhite}
            className="rie-flex rie-items-center rie-text-[12px] rie-w-max"
          >
            <Filter className="rie-h-4 rie-w-4" />
            <span className="rie-hidden sm:rie-block rie-ml-1">Apply Filter</span>
          </Button>
          <Button
            variant="secondary"
            onClick={downloadImage}
            className="rie-flex rie-items-center rie-text-[12px] rie-w-max"
          >
            <Download className="rie-h-4 rie-w-4" />
            <span className="rie-hidden sm:rie-block rie-ml-1">Download</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            className="rie-text-[12px] rie-w-max"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="rie-text-[12px] rie-w-max"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* ── Cancel confirm overlay ── */}
      {showCancelConfirm && (
        <div className="rie-absolute rie-inset-0 rie-z-50 rie-flex rie-items-center rie-justify-center rie-bg-black/60">
          <div className="rie-bg-white rie-rounded-lg rie-p-6 rie-w-[90%] rie-max-w-md rie-shadow-xl">
            <h3 className="rie-text-lg rie-font-semibold rie-mb-2">
              Are you sure you want to cancel?
            </h3>
            <p className="rie-text-gray-600 rie-mb-4">
              You have unsaved changes. Are you sure you want to cancel and lose
              your work?
            </p>
            <div className="rie-flex rie-justify-end rie-gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
                className="rie-mt-0"
              >
                No, keep editing
              </Button>
              <Button variant="destructive" onClick={handleConfirmCancel}>
                Yes, cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
