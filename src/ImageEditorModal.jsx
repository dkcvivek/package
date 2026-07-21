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
import { buildImageEditResult } from "@/utils/buildImageEditResult";

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
 * @param {(result: ImageEditResult) => void} props.onSave - receives the edited image as a Blob/File/dataUrl bundle
 */
export default function ImageEditorModal({ isOpen, onClose, image, onSave }) {
  const { toast } = useToast();

  const baseCanvasRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const originalImageRef = useRef(null);

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
  const [showCurveConfirm, setShowCurveConfirm] = useState(false);
  const [showCurveArrowConfirm, setShowCurveArrowConfirm] = useState(false);
  const [currentStroke, setCurrentStroke] = useState([]);
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
  } = useHistoryManager({ drawingCanvasRef, baseCanvasRef });

  // ── lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Hardens background scroll locking on real WebKit & Blink mobile viewports
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalWidth = document.body.style.width;
    const originalHeight = document.body.style.height;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.height = "100dvh";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.width = originalWidth;
      document.body.style.height = originalHeight;
    };
  }, [isOpen]);

  useEffect(() => {
    setMounted(true);
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

  useEffect(() => {
    const updateDimensions = () => {
      const c = drawingCanvasRef.current;
      if (c) setCanvasDimensions({ width: c.width, height: c.height });
    };
    updateDimensions();
    const c = drawingCanvasRef.current;
    if (c) {
      const ro = new ResizeObserver(updateDimensions);
      ro.observe(c);
      return () => ro.disconnect();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      // target the modal wrapper by its data attribute instead of role="dialog"
      const modal = document.getElementById("image-editor-modal");
      if (!modal?.contains(document.activeElement)) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === "z") {
          e.preventDefault();
          undo();
        }
        if (e.key === "y") {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, undo, redo]);

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
      const isMobile = window.innerWidth < 1024;
      let canvasWidth, canvasHeight;
      const measureEl = canvasAreaRef.current || baseCanvas.parentElement;
      if (!measureEl) return;
      const r = measureEl.getBoundingClientRect();
      const cs = window.getComputedStyle(measureEl);
      const paddingX =
        parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
      const paddingY =
        parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
      canvasWidth = Math.round(r.width - paddingX);
      canvasHeight = Math.round(r.height - paddingY);
      baseCanvas.width = canvasWidth;
      baseCanvas.height = canvasHeight;
      drawingCanvas.width = canvasWidth;
      drawingCanvas.height = canvasHeight;
      setCanvasDimensions({ width: canvasWidth, height: canvasHeight });
      baseCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      drawingCtx.clearRect(0, 0, canvasWidth, canvasHeight);

      const imgAR = img.naturalWidth / img.naturalHeight;
      const canvasAR = canvasWidth / canvasHeight;
      let drawWidth, drawHeight, offsetX, offsetY;
      if (imgAR > canvasAR) {
        drawWidth = canvasWidth;
        drawHeight = canvasWidth / imgAR;
        offsetX = 0;
        offsetY = (canvasHeight - drawHeight) / 2;
      } else {
        drawWidth = canvasHeight * imgAR;
        drawHeight = canvasHeight;
        offsetX = (canvasWidth - drawWidth) / 2;
        offsetY = 0;
      }
      baseCtx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      drawingCtx.globalCompositeOperation = "source-over";
      setImageDrawParams({
        offsetX,
        offsetY,
        drawWidth,
        drawHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
      originalImageRef.current = img;
    };
    img.onerror = () => console.error("Failed to load image for editing.");
  }, [resolvedImage.src, image?.kind]);

  const buildExportCanvas = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!baseCanvas || !drawingCanvas) return null;

    if (!imageDrawParams || !originalImageRef.current) {
      // fallback: no natural-size info yet
      const tmp = document.createElement("canvas");
      tmp.width = baseCanvas.width;
      tmp.height = baseCanvas.height;
      const ctx = tmp.getContext("2d");
      ctx.drawImage(baseCanvas, 0, 0);
      ctx.drawImage(drawingCanvas, 0, 0);
      return tmp;
    }

    const {
      naturalWidth,
      naturalHeight,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    } = imageDrawParams;
    const scale = Math.max(
      naturalWidth / drawWidth,
      naturalHeight / drawHeight,
    );

    const exportWidth = Math.round(baseCanvas.width * scale);
    const exportHeight = Math.round(baseCanvas.height * scale);

    const tmp = document.createElement("canvas");
    tmp.width = exportWidth;
    tmp.height = exportHeight;
    const ctx = tmp.getContext("2d");
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // draw the ORIGINAL full-res image, not the shrunk canvas snapshot
    ctx.drawImage(
      originalImageRef.current,
      offsetX * scale,
      offsetY * scale,
      drawWidth * scale,
      drawHeight * scale,
    );

    // stretch annotations layer up to match (they were drawn at screen res)
    ctx.drawImage(drawingCanvas, 0, 0, exportWidth, exportHeight);

    return tmp;
  }, [imageDrawParams]);

  useEffect(() => {
    if (!isOpen || !resolvedImage.src) return;
    const t = setTimeout(() => {
      if (baseCanvasRef.current && drawingCanvasRef.current)
        drawImageOnCanvas();
    }, 0);
    return () => clearTimeout(t);
  }, [isOpen, resolvedImage.src, drawImageOnCanvas]);

  useEffect(() => {
    if (!isOpen) return;
    let lastWidth = window.innerWidth;
    const handleResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (baseCanvasRef.current && drawingCanvasRef.current)
        drawImageOnCanvas();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, drawImageOnCanvas]);

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

  // ── flatten callbacks ──────────────────────────────────────────────────────

  const handleKonvaRectFlatten = useCallback(
    (canvasEl) => {
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx && canvasEl) {
        const destRect = drawingCanvasRef.current.getBoundingClientRect();
        ctx.drawImage(canvasEl, 0, 0);
      }
      setRectangles([]);
      removeKonvaActionsByType("rectangle");
    },
    [setRectangles, removeKonvaActionsByType, canvasDimensions],
  );

  const handleKonvaCircleFlatten = useCallback(
    (canvasEl) => {
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx && canvasEl) {
        ctx.drawImage(canvasEl, 0, 0);
      }
      setCircles([]);
      removeKonvaActionsByType("circle");
    },
    [setCircles, removeKonvaActionsByType],
  );

  const handleKonvaArrowFlatten = useCallback(
    (canvasEl) => {
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx && canvasEl) {
        ctx.drawImage(canvasEl, 0, 0);
      }
      setArrows([]);
      removeKonvaActionsByType("arrow");
    },
    [setArrows, removeKonvaActionsByType],
  );

  const handleKonvaDoubleArrowFlatten = useCallback(
    (canvasEl) => {
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx && canvasEl) {
        ctx.drawImage(canvasEl, 0, 0);
      }
      setDoubleArrows([]);
      removeKonvaActionsByType("double-arrow");
    },
    [setDoubleArrows, removeKonvaActionsByType],
  );

  const handleTextFlatten = useCallback(
    (canvasEl) => {
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx && canvasEl) {
        ctx.drawImage(canvasEl, 0, 0);
      }
      setTexts([]);
      removeKonvaActionsByType("text");
    },
    [setTexts, removeKonvaActionsByType],
  );

  // ── misc helpers ───────────────────────────────────────────────────────────

  const getCurrentCanvasDimensions = useCallback(() => {
    const c = drawingCanvasRef.current;
    return c
      ? { width: c.width, height: c.height }
      : { width: 420, height: 750 };
  }, []);

  const checkTrashZoneCollision = useCallback((screenX, screenY) => {
    const zone = document.getElementById("trash-zone");
    if (!zone) return false;
    const r = zone.getBoundingClientRect();
    const tol = 80;
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
    if (!c || !ctx) return false;
    return ctx
      .getImageData(0, 0, c.width, c.height)
      .data.some((p, i) => i % 4 === 3 && p !== 0);
  }, []);

  // ── crop ──────────────────────────────────────────────────────────────────

  const drawCropOverlay = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !cropArea) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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

    // Snapshot BOTH layers + their dimensions before resizing, for undo.
    const prevBaseImageData = baseCtx.getImageData(
      0,
      0,
      baseCanvas.width,
      baseCanvas.height,
    );
    const prevDrawingImageData = drawingCtx.getImageData(
      0,
      0,
      drawingCanvas.width,
      drawingCanvas.height,
    );
    const prevWidth = baseCanvas.width;
    const prevHeight = baseCanvas.height;

    const v = {
      x: Math.max(0, Math.min(cropArea.x, baseCanvas.width)),
      y: Math.max(0, Math.min(cropArea.y, baseCanvas.height)),
      width: Math.min(cropArea.width, baseCanvas.width - cropArea.x),
      height: Math.min(cropArea.height, baseCanvas.height - cropArea.y),
    };

    const cropAction = createAction("base", "CROP_IMAGE", {
      cropArea: v,
      prevWidth,
      prevHeight,
      baseImageData: prevBaseImageData,
      drawingImageData: prevDrawingImageData,
    });
    resetHistoryTo(cropAction);

    // Crop only the base (photo) layer — the drawing layer at this point
    // holds nothing but the crop-selection overlay, which we discard.
    const tmpBase = document.createElement("canvas");
    tmpBase.width = v.width;
    tmpBase.height = v.height;
    const tmpBaseCtx = tmpBase.getContext("2d");
    if (!tmpBaseCtx) return;
    tmpBaseCtx.drawImage(
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

    baseCanvas.width = drawingCanvas.width = v.width;
    baseCanvas.height = drawingCanvas.height = v.height;
    baseCtx.clearRect(0, 0, v.width, v.height);
    drawingCtx.clearRect(0, 0, v.width, v.height);
    baseCtx.globalCompositeOperation = "source-over";
    drawingCtx.globalCompositeOperation = "source-over";
    baseCtx.drawImage(tmpBase, 0, 0);

    setCanvasDimensions({ width: v.width, height: v.height });
    setCropArea(null);
    setIsCropping(false);
    setDragStart(null);
    setActiveTool(null);
  }, [cropArea, addAction, createAction]);

  useEffect(() => {
    if (activeTool === "crop") drawCropOverlay();
  }, [cropArea, activeTool, drawCropOverlay]);

  // ── filters ────────────────────────────────────────────────────────────────

  const applyBlackAndWhite = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const ctx = baseCanvas?.getContext("2d");
    if (!baseCanvas || !ctx || !imageDrawParams) return;
    const prev = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    const { offsetX, offsetY, drawWidth, drawHeight } = imageDrawParams;
    const area = ctx.getImageData(offsetX, offsetY, drawWidth, drawHeight);
    const d = area.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = (d[i] + d[i + 1] + d[i + 2]) / 3;
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
    ctx.putImageData(area, offsetX, offsetY);
    const next = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    addAction(ActionCreators.applyFilter("blackAndWhite", prev, next));
    toast({
      title: "Filter Applied",
      description: "Black & White filter applied successfully",
    });
  }, [addAction, toast, imageDrawParams]);

  const downloadImage = () => {
    const tmp = buildExportCanvas();
    if (!tmp) return;
    const a = document.createElement("a");
    a.download = `edited-${resolvedImage.name || "image"}.png`;
    a.href = tmp.toDataURL("image/png");
    a.click();
  };

  const flattenLayers = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!baseCanvas || !drawingCanvas) return;
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
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(tmp, 0, 0);
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    removeActionsByTarget("drawing");
  }, [removeActionsByTarget]);

  // ── mouse / touch drawing ──────────────────────────────────────────────────

  const getMousePos = (e) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

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
      const ctx = drawingCanvasRef.current?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      setIsDrawing(true);
      setIsCropping(true);
      setDragStart(pos);
      setCropArea({ x: pos.x, y: pos.y, width: 0, height: 0 });
      drawCropOverlay();
      return;
    }
    const ctx = drawingCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    setStartPoint(pos);
    setCurrentStroke([pos]);
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
    setCurrentStroke((prev) => [...prev, currentPos]);

    if (activeTool === "crop" && dragStart && isDrawing) {
      const x = Math.max(0, Math.min(currentPos.x, drawingCanvas.width));
      const y = Math.max(0, Math.min(currentPos.y, drawingCanvas.height));
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
      ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      if (replayManager?.current) {
        historyState.actions
          .filter((a) => a.target === "drawing")
          .forEach((a) => replayManager.current.applyDrawingAction(a));
      }
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
        const ctx = drawingCanvasRef.current?.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
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
        if (currentStroke.length > 0) {
          addAction(
            createAction(
              "drawing",
              activeTool === "pencil" ? "DRAW_PENCIL" : "DRAW_ERASER",
              {
                points: currentStroke,
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
        const endPoint = currentStroke[currentStroke.length - 1] || startPoint;
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
      setCurrentStroke([]);
    }
  };

  // ── save / cancel ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (cropArea) return;
    konvaRectRef.current?.flatten();
    konvaCircleRef.current?.flatten();
    konvaArrowRef.current?.flatten();
    konvaDoubleArrowRef.current?.flatten();
    textEditorRef.current?.flatten();

    const tmp = buildExportCanvas();
    if (!tmp) return;

    try {
      const result = await buildImageEditResult(tmp, {
        fileName: `edited-${resolvedImage.name || "image"}.png`,
      });
      onSave(result);
    } catch (err) {
      console.error("Failed to build image edit result:", err);
      toast({
        title: "Save failed",
        description: "Could not export the edited image. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    const unsaved =
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
      try {
        konvaRectRef.current?.flatten();
        konvaCircleRef.current?.flatten();
        konvaArrowRef.current?.flatten();
        konvaDoubleArrowRef.current?.flatten();
        textEditorRef.current?.flatten();
        flattenLayers();
      } catch (err) {
        console.error("[handleToolChange] flatten block THREW:", err);
      }
      setCropArea(null);
      setIsCropping(false);
      setDragStart(null);
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

  const sharedKonvaProps = {
    width: getCurrentCanvasDimensions().width,
    height: getCurrentCanvasDimensions().height,
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

  const handleKonvaTextDelete = useCallback(
    (id) => {
      addAction(
        createAction("konva", "DELETE_ELEMENT", {
          elementType: "text",
          elementId: id,
        }),
      );
    },
    [createAction, addAction],
  );

  const handleUndo = useCallback(() => {
    undo();
    const c = drawingCanvasRef.current;
    if (c) setCanvasDimensions({ width: c.width, height: c.height });
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
    const c = drawingCanvasRef.current;
    if (c) setCanvasDimensions({ width: c.width, height: c.height });
  }, [redo]);

  if (!isOpen) return null;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      id="image-editor-modal"
      tabIndex={-1}
    >
      <div
        className="flex flex-col bg-white w-screen h-screen lg:rounded-lg lg:w-[98vw] lg:max-w-5xl lg:h-[80vh] overflow-hidden"
        style={isMobile ? { height: "100dvh" } : undefined}
      >
        {/* Header */}
        <div className="p-4 border-b hidden lg:flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Edit Image: {resolvedImage.name}
          </h2>
        </div>

        {/* Body */}
        <div className="flex flex-col lg:flex-row flex-grow overflow-hidden">
          {/* ── Mobile toolbar ── */}
          <div className="lg:hidden">
            <MobileView
              historyState={historyState}
              undo={undo}
              canUndo={canUndo}
              redo={redo}
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
          <div className="hidden lg:flex flex-col lg:w-52 lg:flex-shrink-0 lg:border-r p-2 gap-2 overflow-y-auto">
            {/* Undo / Redo */}
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={!canUndo}
                title={`Undo (${actionCount} actions)`}
                className="flex items-center gap-2 p-3"
              >
                <Undo2 className="h-4 w-4" /> Undo
              </Button>
              <Button
                variant="outline"
                onClick={handleRedo}
                disabled={!canRedo}
                title="Redo"
                className="flex items-center gap-2 p-3"
              >
                <Redo2 className="h-4 w-4" /> Redo
              </Button>
            </div>

            {/* Tool grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                ["pencil", <Pencil className="h-4 w-4" />, "Pencil"],
                ["eraser", <Eraser className="h-4 w-4" />, "Eraser"],
                ["rectangle", <Square className="h-4 w-4" />, "Rectangle"],
                ["circle", <Circle className="h-4 w-4" />, "Circle"],
                ["text", <Type className="h-4 w-4" />, "Text"],
                ["arrow", <ArrowRight className="h-4 w-4" />, "Arrow"],
                [
                  "double-arrow",
                  <ArrowRightLeft className="h-4 w-4" />,
                  "Double Arrow",
                ],
                ["line", <MinusIcon className="h-4 w-4" />, "Line"],
              ].map(([tool, icon, label]) => (
                <Button
                  key={tool}
                  variant={activeTool === tool ? "secondary" : "ghost"}
                  onClick={() => handleToolChange(tool)}
                  className="!flex !flex-col !px-2 !py-1 !gap-1 min-w-[45%] !h-max"
                >
                  {icon} {label}
                </Button>
              ))}

              {/* Crop — with confirm guard */}
              <Button
                variant={activeTool === "crop" ? "secondary" : "ghost"}
                onClick={() => handleToolChange("crop")}
                className="!flex !flex-col !px-2 !py-1 !gap-1 min-w-[45%] !h-max"
              >
                <Crop className="h-4 w-4" /> Crop
              </Button>

              <Button
                variant={activeTool === "curve" ? "secondary" : "ghost"}
                onClick={() => setActiveTool("curve")}
                className="!flex !flex-col !px-2 !py-1 !gap-1 min-w-[45%] !h-max"
              >
                <PenTool className="h-4 w-4" /> Curve
              </Button>

              <Button
                variant={activeTool === "curve-arrow" ? "secondary" : "ghost"}
                onClick={() => setActiveTool("curve-arrow")}
                className="!flex !flex-col !px-2 !py-1 !gap-1 min-w-[45%] !h-max"
              >
                <TbArrowCurveRight className="h-4 w-4" /> Curve Arrow
              </Button>
            </div>

            {/* Crop controls */}
            {activeTool === "crop" && (
              <div className="space-y-2 mt-2">
                <p className="text-sm text-gray-500">
                  Draw a rectangle to crop. Click Apply to confirm.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCropArea(null);
                    const ctx = drawingCanvasRef.current?.getContext("2d");
                    if (ctx)
                      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                  }}
                  className="!flex !flex-col !px-2 !py-1 !gap-1 w-full !h-max"
                >
                  Cancel
                </Button>
                <Button
                  onClick={applyCrop}
                  disabled={!cropArea}
                  className="!flex !flex-col !px-2 !py-1 !gap-1 w-full !h-max"
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
                <div className="mt-4">
                  <Label
                    htmlFor="stroke-style"
                    className="flex items-center gap-2 mb-1"
                  >
                    <Grip className="h-4 w-4" /> Stroke Style
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
                <div className="flex items-center gap-2 mt-2">
                  <Label htmlFor="backgroundColor" className="text-sm">
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
                    className="rounded-full w-6 h-6 cursor-pointer"
                  />
                  <GrClear
                    className="h-4 w-4 cursor-pointer"
                    onClick={() => setBackgroundColor("transparent")}
                  />
                </div>
              )}

            {/* Color picker */}
            <div className="flex items-center gap-2 mt-4">
              <Label
                htmlFor="color-picker-lg"
                className="flex items-center gap-2"
              >
                <Palette className="h-4 w-4" /> Color
              </Label>
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                className="rounded-full w-12 h-6 cursor-pointer"
              />
            </div>

            {/* Brush size */}
            <div className="mt-4">
              <Label htmlFor="brush-size-lg" className="mb-2 block">
                Brush Size: {brushSize}px
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setBrushSize((s) => Math.max(minBrushSize, s - 1))
                  }
                  className="h-8 w-8"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Slider
                  id="brush-size-lg"
                  min={minBrushSize}
                  max={maxBrushSize}
                  step={1}
                  value={[brushSize]}
                  onValueChange={(v) => setBrushSize(v[0])}
                  className="flex-grow"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setBrushSize((s) => Math.min(maxBrushSize, s + 1))
                  }
                  className="h-8 w-8"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* ── Canvas area ── */}
          <div
            ref={canvasAreaRef}
            className="flex-1 flex items-center justify-center bg-black lg:bg-gray-100 min-h-0 relative overflow-hidden px-2 pb-[80px] lg:p-0"
          >
            <div
              className="relative lg:border-2 lg:border-gray-300"
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
                className="absolute bg-black lg:bg-white object-contain w-full h-full"
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
                className="absolute w-full h-full"
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
                  className={`fixed top-0 left-0 p-3 rounded-full shadow-lg border-2 transition-all duration-200 text-white ${
                    isDraggedOverTrash
                      ? "bg-red-600 border-red-700 scale-125"
                      : "bg-red-500 border-red-600"
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
                    className={`h-6 w-6 transition-transform duration-200 ${isDraggedOverTrash ? "scale-110" : ""}`}
                  />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-[8px] px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                    {isDraggedOverTrash
                      ? "Release to delete"
                      : "Drag here to delete"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Bottom black spacer (mobile only) ── */}
          <div className="lg:hidden bg-black flex-shrink-0 pb-[env(safe-area-inset-bottom)]" />
        </div>

        {/* ── Footer ── */}
        <div className="p-2 sm:p-4 border-t hidden lg:flex justify-end flex-row gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={applyBlackAndWhite}
            className="flex items-center text-[12px] w-max"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:block ml-1">Apply Filter</span>
          </Button>
          <Button
            variant="secondary"
            onClick={downloadImage}
            className="flex items-center text-[12px] w-max"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:block ml-1">Download</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            className="text-[12px] w-max"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} className="text-[12px] w-max">
            Save Changes
          </Button>
        </div>
      </div>

      {/* ── Cancel confirm overlay ── */}
      {showCancelConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-lg p-6 w-[90%] max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">
              Are you sure you want to cancel?
            </h3>
            <p className="text-gray-600 mb-4">
              You have unsaved changes. Are you sure you want to cancel and lose
              your work?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
                className="mt-0"
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
  );
}
