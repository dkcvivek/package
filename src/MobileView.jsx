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
    "rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-justify-between rie-v0.1.1-px-3 rie-v0.1.1-w-full rie-v0.1.1-flex-shrink-0";
  const barStyle = { height: TOOLBAR_HEIGHT };

  return (
    <div className="lg:rie-v0.1.1-hidden rie-v0.1.1-flex rie-v0.1.1-flex-col rie-v0.1.1-w-full rie-v0.1.1-bg-black rie-v0.1.1-text-white">
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
            <X className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
          </button>

          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-5">
            <button onClick={downloadImage} title="Download">
              <Download className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
            <button onClick={() => enterLevel("crop", "crop")} title="Crop">
              <Crop className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
            <button
              onClick={() => enterLevel("sticker", "rectangle")}
              title="Sticker"
            >
              <Sticker className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
            <button onClick={() => enterLevel("text", "text")} title="Text">
              <Type className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
            <button
              onClick={() => enterLevel("pencil", "pencil")}
              title="Pencil"
            >
              <Pencil className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
            <button
              onClick={handleSave}
              title="Send"
              className="rie-v0.1.1-bg-green-700 rie-v0.1.1-p-1 rie-v0.1.1-rounded-full"
            >
              <Check className="rie-v0.1.1-h-5 rie-v0.1.1-w-5 rie-v0.1.1-text-white-400 rie-v0.1.1-font-bold" />
            </button>
          </div>
        </div>
      )}

      {/* ── Level 2: Pencil ──────────────────────────────────────────────── */}
      {level === "pencil" && (
        <div className={barClass} style={barStyle}>
          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-3">
            <button onClick={confirmPencil} title="Confirm">
              <Check className="rie-v0.1.1-h-5 rie-v0.1.1-w-5 rie-v0.1.1-text-green-400" />
            </button>
            <button
              onClick={undo}
              disabled={!scopedCanUndo}
              className="disabled:rie-v0.1.1-opacity-30"
              title="Undo"
            >
              <Undo2 className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
          </div>
          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-3">
            <span className="rie-v0.1.1-text-xs rie-v0.1.1-opacity-70 rie-v0.1.1-whitespace-nowrap">
              {brushSize}px
            </span>
            <input
              type="range"
              min={minBrushSize}
              max={maxBrushSize}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="rie-v0.1.1-w-20 rie-v0.1.1-accent-white"
            />
            <label
              className="rie-v0.1.1-relative rie-v0.1.1-w-6 rie-v0.1.1-h-6 rie-v0.1.1-rounded-full rie-v0.1.1-flex-shrink-0 rie-v0.1.1-cursor-pointer rie-v0.1.1-overflow-hidden"
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
            <Check className="rie-v0.1.1-h-5 rie-v0.1.1-w-5 rie-v0.1.1-text-green-400" />
          </button>

          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-3">
            <button
              onClick={cycleTextBg}
              title="Text background"
              className="rie-v0.1.1-relative rie-v0.1.1-w-7 rie-v0.1.1-h-7 rie-v0.1.1-rounded-md rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-justify-center rie-v0.1.1-flex-shrink-0"
              style={{
                background:
                  textBgColor === "transparent"
                    ? "repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px"
                    : textBgColor,
                border: "2px solid rgba(255,255,255,0.7)",
              }}
            >
              <span
                className="rie-v0.1.1-text-xs rie-v0.1.1-font-semibold"
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
              className="rie-v0.1.1-relative rie-v0.1.1-w-6 rie-v0.1.1-h-6 rie-v0.1.1-rounded-full rie-v0.1.1-flex-shrink-0 rie-v0.1.1-cursor-pointer rie-v0.1.1-overflow-hidden"
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
              className={`rie-v0.1.1-h-5 rie-v0.1.1-w-5 ${cropArea ? "rie-v0.1.1-text-green-400" : "rie-v0.1.1-text-gray-500"}`}
            />
          </button>
          <button
            onClick={discardCrop}
            className="rie-v0.1.1-text-sm rie-v0.1.1-opacity-80"
            title="Discard"
          >
            Discard
          </button>
        </div>
      )}

      {/* ── Level 2: Sticker ─────────────────────────────────────────────── */}
      {level === "sticker" && (
        <div className={barClass} style={barStyle}>
          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-3">
            <button onClick={confirmSticker} title="Confirm">
              <Check className="rie-v0.1.1-h-5 rie-v0.1.1-w-5 rie-v0.1.1-text-green-400" />
            </button>
            <button
              onClick={undo}
              disabled={!scopedCanUndo}
              className="disabled:rie-v0.1.1-opacity-30"
              title="Undo"
            >
              <Undo2 className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />
            </button>
          </div>
          <div className="rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-gap-4">
            {[
              ["rectangle", <Square className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />],
              ["circle", <Circle className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />],
              ["arrow", <ArrowRight className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />],
              ["double-arrow", <ArrowRightLeft className="rie-v0.1.1-h-5 rie-v0.1.1-w-5" />],
            ].map(([tool, icon]) => (
              <button
                key={tool}
                onClick={() => handleToolChange(tool)}
                className={`rie-v0.1.1-p-1 rie-v0.1.1-rounded ${activeTool === tool ? "rie-v0.1.1-bg-white/20" : ""}`}
                title={tool}
              >
                {icon}
              </button>
            ))}
            <label
              className="rie-v0.1.1-relative rie-v0.1.1-w-6 rie-v0.1.1-h-6 rie-v0.1.1-rounded-full rie-v0.1.1-flex-shrink-0 rie-v0.1.1-cursor-pointer rie-v0.1.1-overflow-hidden"
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
