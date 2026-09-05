"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  X,
  Download,
  Crop,
  Sticker,
  Type,
  Pencil,
  Undo2,
  Check,
  Square,
  Circle,
  ArrowRight,
  ArrowRightLeft,
} from "lucide-react";

const TOOLBAR_HEIGHT = "56px"; // fixed on every level — canvas never resizes

const MobileView = ({
  historyState,
  flattenLayers,
  undo,
  canUndo,
  activeTool,
  setActiveTool,
  handleToolChange,
  drawingCanvasRef,
  currentColor,
  setCurrentColor,
  brushSize,
  setBrushSize,
  minBrushSize,
  maxBrushSize,
  cropArea,
  setCropArea,
  applyCrop,
  konvaRectRef,
  konvaCircleRef,
  konvaArrowRef,
  konvaDoubleArrowRef,
  textEditorRef,
  downloadImage,
  handleSave,
  isSaving,
  handleCancel,
  isTextDragging,
  textColor,
  setTextColor,
  textBgColor,
  cycleTextBg,
}) => {
  const [level, setLevel] = useState(null); // null | "pencil" | "text" | "crop" | "sticker"

  const sessionFloorRef = useRef(-1);
  const scopedCanUndo =
    canUndo && historyState.currentStep > sessionFloorRef.current;

  const cropHistoryRef = useRef([]);
  const prevCropAreaRef = useRef(null);
  React.useEffect(() => {
    if (level === "crop") {
      cropHistoryRef.current.push(prevCropAreaRef.current);
    }
    prevCropAreaRef.current = cropArea;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropArea]);

  const enterLevel = (nextLevel, tool) => {
    sessionFloorRef.current = historyState.currentStep;
    cropHistoryRef.current = [];
    prevCropAreaRef.current = null;
    if (tool) handleToolChange(tool);
    setLevel(nextLevel);
  };

  const backToLevel1 = () => {
    setActiveTool(null);
    setLevel(null);
  };

  const confirmPencil = () => {
    flattenLayers();
    backToLevel1();
  };

  const confirmText = () => backToLevel1();

  const confirmSticker = () => {
    konvaRectRef.current?.flatten();
    konvaCircleRef.current?.flatten();
    konvaArrowRef.current?.flatten();
    konvaDoubleArrowRef.current?.flatten();
    flattenLayers();
    backToLevel1();
  };

  const confirmCrop = () => {
    applyCrop();
    setLevel(null);
  };

  const discardCrop = () => {
    setCropArea(null);
    const ctx = drawingCanvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    backToLevel1();
  };

  const barClass =
    "rie-flex rie-items-center rie-justify-between rie-px-3 rie-w-full rie-flex-shrink-0";
  const barStyle = { height: TOOLBAR_HEIGHT };

  return (
    <div className="lg:rie-hidden rie-flex rie-flex-col rie-w-full rie-bg-black rie-text-white">
      {/* ── Level 1 ──────────────────────────────────────────────────────── */}
      {level === null && (
        <div
          className={barClass}
          style={{
            ...barStyle,
            opacity: isTextDragging ? 0 : 1,
            pointerEvents: isTextDragging ? "none" : "auto",
          }}
        >
          <button onClick={handleCancel} title="Discard">
            <X className="rie-h-5 rie-w-5" />
          </button>

          <div className="rie-flex rie-items-center rie-gap-5">
            <button onClick={downloadImage} title="Download">
              <Download className="rie-h-5 rie-w-5" />
            </button>
            <button onClick={() => enterLevel("crop", "crop")} title="Crop">
              <Crop className="rie-h-5 rie-w-5" />
            </button>
            <button
              onClick={() => enterLevel("sticker", "rectangle")}
              title="Sticker"
            >
              <Sticker className="rie-h-5 rie-w-5" />
            </button>
            <button onClick={() => enterLevel("text", "text")} title="Text">
              <Type className="rie-h-5 rie-w-5" />
            </button>
            <button
              onClick={() => enterLevel("pencil", "pencil")}
              title="Pencil"
            >
              <Pencil className="rie-h-5 rie-w-5" />
            </button>
            {/* Exporting the canvas and uploading it both take a moment on a
                phone, so the tick has to stop accepting taps for the whole
                round trip — otherwise an impatient second tap uploads the
                same photo twice. Same box size as the icon so the bar
                doesn't shift when it swaps. */}
            <button
              onClick={handleSave}
              disabled={isSaving}
              title={isSaving ? "Sending…" : "Send"}
              aria-busy={isSaving}
              className={`rie-bg-green-700 rie-p-1 rie-rounded-full ${
                isSaving ? "rie-opacity-60 rie-cursor-not-allowed" : ""
              }`}
            >
              {isSaving ? (
                <span className="rie-block rie-h-5 rie-w-5 rie-animate-spin rie-rounded-full rie-border-2 rie-border-white/40 rie-border-t-white" />
              ) : (
                <Check className="rie-h-5 rie-w-5 rie-text-white-400 rie-font-bold" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Level 2: Pencil ──────────────────────────────────────────────── */}
      {level === "pencil" && (
        <div className={barClass} style={barStyle}>
          <div className="rie-flex rie-items-center rie-gap-3">
            <button onClick={confirmPencil} title="Confirm">
              <Check className="rie-h-5 rie-w-5 rie-text-green-400" />
            </button>
            <button
              onClick={undo}
              disabled={!scopedCanUndo}
              className="disabled:rie-opacity-30"
              title="Undo"
            >
              <Undo2 className="rie-h-5 rie-w-5" />
            </button>
          </div>
          <div className="rie-flex rie-items-center rie-gap-3">
            <span className="rie-text-xs rie-opacity-70 rie-whitespace-nowrap">
              {brushSize}px
            </span>
            <input
              type="range"
              min={minBrushSize}
              max={maxBrushSize}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="rie-w-20 rie-accent-white"
            />
            <label
              className="rie-relative rie-w-6 rie-h-6 rie-rounded-full rie-flex-shrink-0 rie-cursor-pointer rie-overflow-hidden"
              style={{
                background: currentColor,
                border: "2px solid rgba(255,255,255,0.7)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
              }}
            >
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  width: "100%",
                  height: "100%",
                  cursor: "pointer",
                  border: "none",
                  padding: 0,
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* ── Level 2: Text ────────────────────────────────────────────────── */}
      {level === "text" && (
        <div
          className={barClass}
          style={{
            ...barStyle,
            opacity: isTextDragging ? 0 : 1,
            pointerEvents: isTextDragging ? "none" : "auto",
          }}
        >
          <button onClick={confirmText} title="Confirm">
            <Check className="rie-h-5 rie-w-5 rie-text-green-400" />
          </button>

          <div className="rie-flex rie-items-center rie-gap-3">
            <button
              onClick={cycleTextBg}
              title="Text background"
              className="rie-relative rie-w-7 rie-h-7 rie-rounded-md rie-flex rie-items-center rie-justify-center rie-flex-shrink-0"
              style={{
                background:
                  textBgColor === "transparent"
                    ? "repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px"
                    : textBgColor,
                border: "2px solid rgba(255,255,255,0.7)",
              }}
            >
              <span
                className="rie-text-xs rie-font-semibold"
                style={{
                  color:
                    textBgColor === "#ffffff"
                      ? "#000"
                      : textBgColor === "transparent"
                        ? "#fff"
                        : "#fff",
                }}
              >
                A
              </span>
            </button>

            <label
              className="rie-relative rie-w-6 rie-h-6 rie-rounded-full rie-flex-shrink-0 rie-cursor-pointer rie-overflow-hidden"
              style={{
                background: textColor,
                border: "2px solid rgba(255,255,255,0.7)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
              }}
            >
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  width: "100%",
                  height: "100%",
                  cursor: "pointer",
                  border: "none",
                  padding: 0,
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* ── Level 2: Crop ────────────────────────────────────────────────── */}
      {level === "crop" && (
        <div className={barClass} style={barStyle}>
          <button onClick={confirmCrop} disabled={!cropArea} title="Confirm">
            <Check
              className={`rie-h-5 rie-w-5 ${cropArea ? "rie-text-green-400" : "rie-text-gray-500"}`}
            />
          </button>
          <button
            onClick={discardCrop}
            className="rie-text-sm rie-opacity-80"
            title="Discard"
          >
            Discard
          </button>
        </div>
      )}

      {/* ── Level 2: Sticker ─────────────────────────────────────────────── */}
      {level === "sticker" && (
        <div className={barClass} style={barStyle}>
          <div className="rie-flex rie-items-center rie-gap-3">
            <button onClick={confirmSticker} title="Confirm">
              <Check className="rie-h-5 rie-w-5 rie-text-green-400" />
            </button>
            <button
              onClick={undo}
              disabled={!scopedCanUndo}
              className="disabled:rie-opacity-30"
              title="Undo"
            >
              <Undo2 className="rie-h-5 rie-w-5" />
            </button>
          </div>
          <div className="rie-flex rie-items-center rie-gap-4">
            {[
              ["rectangle", <Square className="rie-h-5 rie-w-5" />],
              ["circle", <Circle className="rie-h-5 rie-w-5" />],
              ["arrow", <ArrowRight className="rie-h-5 rie-w-5" />],
              ["double-arrow", <ArrowRightLeft className="rie-h-5 rie-w-5" />],
            ].map(([tool, icon]) => (
              <button
                key={tool}
                onClick={() => handleToolChange(tool)}
                className={`rie-p-1 rie-rounded ${activeTool === tool ? "rie-bg-white/20" : ""}`}
                title={tool}
              >
                {icon}
              </button>
            ))}
            <label
              className="rie-relative rie-w-6 rie-h-6 rie-rounded-full rie-flex-shrink-0 rie-cursor-pointer rie-overflow-hidden"
              style={{
                background: currentColor,
                border: "2px solid rgba(255,255,255,0.7)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
              }}
            >
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  width: "100%",
                  height: "100%",
                  cursor: "pointer",
                  border: "none",
                  padding: 0,
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileView;
