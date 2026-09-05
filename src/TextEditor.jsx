"use client";

import React, {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import Konva from "konva";
import { Stage, Layer, Text, Transformer, Group, Rect } from "react-konva";
import { snapshotStage } from "@/utils/konvaSnapshot";
import { useKonvaSelection } from "@/hooks/useKonvaSelection";

// Shared geometry for the editing <textarea> and the committed Konva text, so
// the two wrap at the same width. `TEXT_PADDING` is both the textarea's CSS
// padding and the inset of the Konva <Text> inside its background <Rect>.
const TEXT_MARGIN = 12; // gap between the text box and the canvas edge
const TEXT_PADDING = 8;
const TEXT_LINE_HEIGHT = 1.25;

/** Wrap width available to a text box spanning the canvas minus its margins. */
const defaultWrapWidth = (canvasWidth) =>
  Math.max(40, canvasWidth - TEXT_MARGIN * 2 - TEXT_PADDING * 2);

// One reusable offscreen node — measuring is per-text-per-render, so allocating
// a Konva.Text each time would churn.
let measureNode = null;

/**
 * Measures text the way Konva will actually lay it out.
 *
 * The previous implementation measured with a hidden DOM <span>, which has no
 * concept of the wrap width. A long string therefore reported one enormous
 * line, and the committed text rendered as a single line running off the
 * canvas even though the textarea had wrapped it. Measuring through Konva with
 * the same wrap width the textarea used keeps the two identical, and gives the
 * background <Rect> the right size for free.
 *
 * @returns {{ width: number, height: number, wrapWidth: number }} logical px
 */
function measureText({ text, fontSize, fontFamily, maxWidth }) {
  const safeText = text || "";
  const fallback = {
    width: maxWidth,
    height: fontSize * TEXT_LINE_HEIGHT,
    wrapWidth: maxWidth,
  };
  if (typeof window === "undefined") return fallback;

  try {
    if (!measureNode) measureNode = new Konva.Text({});
    const node = measureNode;
    node.setAttrs({
      text: safeText,
      fontSize,
      fontFamily,
      lineHeight: TEXT_LINE_HEIGHT,
      padding: 0,
      align: "left",
      wrap: "none",
    });
    node.width(undefined); // let it report its natural, unwrapped width

    const natural = node.getTextWidth();
    if (natural <= maxWidth) {
      // Fits on its natural lines — size the bubble to the text, not the
      // full canvas width. +2px slack so rounding can't force a stray wrap.
      const width = Math.ceil(natural) + 2;
      return { width, height: Math.ceil(node.height()), wrapWidth: width };
    }

    node.width(maxWidth);
    node.wrap("word");
    return {
      width: maxWidth,
      height: Math.ceil(node.height()),
      wrapWidth: maxWidth,
    };
  } catch {
    return fallback;
  }
}

const TextEditor = forwardRef(
  (
    {
      width,
      height,
      active,
      allowCreate,
      color,
      setColor,
      backgroundColor,
      setBackgroundColor,
      fontSize,
      fontFamily,
      onAdd,
      onMove,
      texts,
      setTexts,
      onFlatten,
      onElementSelect,
      onElementDeselect,
      checkTrashZoneCollision,
      updateTrashZoneState,
      onDragStateChange,
      onDelete,
    },
    ref,
  ) => {
    const [selectedId, setSelectedId] = useState(null);
    const [editingText, setEditingText] = useState(null);

    const stageRef = useRef(null);
    const trRef = useRef(null);
    const justDraggedRef = useRef(false);

    const [lastDist, setLastDist] = useState(0);
    const [lastTap, setLastTap] = useState(0);
    const [tapTimeout, setTapTimeout] = useState(null);
    const [tapCount, setTapCount] = useState(0);

    const getDistance = (p1, p2) => {
      return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    };

    useImperativeHandle(ref, () => ({
      flatten: () => {
        if (trRef.current) {
          trRef.current.nodes([]);
          trRef.current.getLayer().batchDraw();
        }
        if (stageRef.current) {
          const canvasEl = snapshotStage(stageRef.current);
          onFlatten(canvasEl);
        }
        setTexts([]);
        setSelectedId(null);
      },
    }));

    useEffect(() => {
      if (stageRef.current) {
        const stage = stageRef.current;
        stage.width(width);
        stage.height(height);
        stage.size({ width, height });
        stage.batchDraw();
      }
    }, [width, height]);

    // NOTE: there used to be a second effect here that re-sized the stage from
    // `document.querySelector('canvas...').width`. That reads the DEVICE-pixel
    // backing store of a HiDPI canvas and stamped it onto a stage whose
    // coordinate space is logical px, so text rendered at 1/dpr scale in the
    // top-left corner. The `width`/`height` props above are already the logical
    // canvas size — that is the only correct source.

    useEffect(() => {
      const handleKeyDown = (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
          onDelete?.(selectedId);
          setSelectedId(null);
          if (onElementDeselect) {
            onElementDeselect();
          }
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, onDelete, onElementDeselect]);

    useKonvaSelection({
      stageRef,
      trRef,
      selectedId,
      setSelectedId,
      elements: texts,
      onElementDeselect,
    });

    useEffect(() => {
      if (selectedId && active) {
        setTexts((arr) =>
          arr.map((t) =>
            t.id === selectedId
              ? {
                  ...t,
                  fill: color,
                  backgroundColor: backgroundColor,
                }
              : t,
          ),
        );
      }
    }, [color, backgroundColor, selectedId, active, setTexts]);

    const handleDoubleTap = (e, id) => {
      if (justDraggedRef.current) return;
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;

      if (tapTimeout) {
        clearTimeout(tapTimeout);
        setTapTimeout(null);
      }

      if (now - lastTap < DOUBLE_TAP_DELAY && tapCount === 1) {
        setTapCount(0);
        setLastTap(0);
        if (e.evt) {
          e.evt.preventDefault();
          e.evt.stopPropagation();
        }
        handleDblClick(e, id);
      } else {
        setLastTap(now);
        setTapCount(1);
        const timeout = setTimeout(() => {
          setTapCount(0);
          setLastTap(0);
          setTapTimeout(null);
        }, DOUBLE_TAP_DELAY);
        setTapTimeout(timeout);
        setSelectedId(id);
        if (onElementSelect) {
          onElementSelect(id, "text");
        }
      }
    };

    const handleDragMove = (e, id) => {
      const stage = e.target.getStage();
      const node = e.target;
      const { x, y } = node.position();

      const stageContainer = stage.container();
      const stageRect = stageContainer.getBoundingClientRect();
      const screenX = stageRect.left + x;
      const screenY = stageRect.top + y;

      if (checkTrashZoneCollision && updateTrashZoneState) {
        const isOverTrash = checkTrashZoneCollision(screenX, screenY);
        updateTrashZoneState(isOverTrash);
      }
    };

    const handleDragEnd = (e, id) => {
      const group = e.target;
      const stage = e.target.getStage();
      const { x, y } = group.position();
      const previousText = texts.find((t) => t.id === id);

      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);

      if (updateTrashZoneState) {
        updateTrashZoneState(false);
      }

      const stageContainer = stage.container();
      const stageRect = stageContainer.getBoundingClientRect();
      const screenX = stageRect.left + x;
      const screenY = stageRect.top + y;

      if (
        checkTrashZoneCollision &&
        checkTrashZoneCollision(screenX, screenY)
      ) {
        onDelete?.(id); // records DELETE_ELEMENT in history — syncKonvaState will remove it
        setSelectedId(null);
        if (trRef.current) {
          trRef.current.nodes([]);
          trRef.current.getLayer().batchDraw();
        }
        if (onElementDeselect) onElementDeselect();
        onDragStateChange?.(false);
        return;
      }

      const newText = {
        ...previousText,
        x,
        y,
      };

      setTexts((arr) => arr.map((t) => (t.id === id ? newText : t)));

      if (onMove && previousText) {
        const hasChanged = previousText.x !== x || previousText.y !== y;
        if (hasChanged) {
          onMove(id, newText, previousText);
        }
      }
      onDragStateChange?.(false);
    };

    const handleDblClick = (e, id) => {
      if (!allowCreate) return;
      const group = e.target.getParent();
      const textNode = group.findOne("Text");
      setEditingText({
        id,
        x: group.x(),
        y: group.y(),
        value: textNode.text(),
        fill: color,
        backgroundColor: backgroundColor,
      });
    };

    const handleTouchMove = (e) => {
      if (!active || !selectedId) return;

      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];

      if (touch1 && touch2) {
        e.evt.preventDefault();
        const dist = getDistance(
          { x: touch1.clientX, y: touch1.clientY },
          { x: touch2.clientX, y: touch2.clientY },
        );

        if (lastDist > 0) {
          const scale = dist / lastDist;
          setTexts((arr) =>
            arr.map((t) =>
              t.id === selectedId
                ? {
                    ...t,
                    scaleX: (t.scaleX || 1) * scale,
                    scaleY: (t.scaleY || 1) * scale,
                  }
                : t,
            ),
          );
        }
        setLastDist(dist);
      }
    };

    const handleTouchEnd = () => {
      setLastDist(0);
    };

    const handleTextClick = (id) => {
      if (justDraggedRef.current) return;
      setSelectedId(id);
      setColor(texts.find((t) => t.id === id)?.fill || "#000000");
      setBackgroundColor(
        texts.find((t) => t.id === id)?.backgroundColor || "transparent",
      );
      if (onElementSelect) {
        onElementSelect(id, "text");
      }
    };

    const handleStageDblClick = (e) => {
      if (!allowCreate) return;
      if (e.target !== e.target.getStage()) return;
      const pos = e.target.getStage().getPointerPosition();
      setEditingText({
        id: null,
        x: pos.x,
        y: pos.y,
        value: "",
        fill: color,
        backgroundColor: backgroundColor,
      });
    };

    const handleDeselection = () => {
      if (selectedId) {
        setSelectedId(null);
        if (trRef.current) {
          trRef.current.nodes([]);
          trRef.current.getLayer().batchDraw();
        }
        if (onElementDeselect) {
          onElementDeselect();
        }
      }
    };

    const renderTextarea = () => {
      if (!editingText) return null;

      // Span the canvas, leaving only TEXT_MARGIN either side. The box used to
      // be a fixed 220px starting at the tap point, so it looked pinned to the
      // right and gave the user a narrow column to type into.
      const boxWidth = Math.max(80, width - TEXT_MARGIN * 2);
      const wrapWidth = boxWidth - TEXT_PADDING * 2;
      const top = Math.max(
        TEXT_MARGIN,
        Math.min(editingText.y, Math.max(TEXT_MARGIN, height - 96)),
      );
      const maxAvailableHeight = Math.max(48, height - top - TEXT_MARGIN);

      const autoGrow = (el) => {
        if (!el) return;
        el.style.height = "auto";
        el.style.height =
          Math.min(el.scrollHeight, maxAvailableHeight) + "px";
      };

      return (
        <textarea
          ref={autoGrow}
          style={{
            position: "absolute",
            top,
            left: TEXT_MARGIN,
            width: boxWidth,
            maxHeight: maxAvailableHeight,
            fontSize: fontSize,
            fontFamily: fontFamily,
            lineHeight: TEXT_LINE_HEIGHT,
            zIndex: 1000,
            minHeight: 24,
            background: backgroundColor,
            color: color,
            // border-box + zero border keeps the content width exactly
            // `wrapWidth`, which is what the committed Konva text wraps at.
            border: 0,
            outline: "1px solid rgba(255,255,255,0.65)",
            borderRadius: 10,
            padding: TEXT_PADDING,
            boxSizing: "border-box",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "break-word",
            overflowY: "auto",
            resize: "none",
          }}
          value={editingText.value}
          autoFocus
          onChange={(e) => {
            setEditingText(
              (edit) => edit && { ...edit, value: e.target.value },
            );
            autoGrow(e.target);
          }}
          onBlur={() => {
            if (editingText.value.trim()) {
              if (editingText.id) {
                const previous = texts.find((t) => t.id === editingText.id);
                const updated = {
                  ...previous,
                  text: editingText.value,
                  fill: color,
                  backgroundColor: backgroundColor,
                };
                setTexts((arr) =>
                  arr.map((t) => (t.id === editingText.id ? updated : t)),
                );
                // Record it. `texts` is derived from the history log, so a
                // local-only update to an existing text was silently reverted
                // by the next konva action or undo.
                if (previous) onMove?.(editingText.id, updated, previous);
              } else {
                const newId = `text-${Date.now()}`;
                const newText = {
                  id: newId,
                  x: TEXT_MARGIN,
                  y: top,
                  text: editingText.value,
                  fontSize,
                  fontFamily,
                  fill: color,
                  backgroundColor: backgroundColor,
                  // Persist the width the user actually typed against, so the
                  // committed text wraps identically to the textarea instead of
                  // stretching into one line across the whole image.
                  maxWidth: wrapWidth,
                  draggable: true,
                };
                setTexts((arr) => [...arr, newText]);
                if (onAdd && editingText.value.trim().length > 0) {
                  onAdd(newText);
                }
                setSelectedId(newId);
                if (onElementSelect) {
                  onElementSelect(newId, "text");
                }
              }
            }
            setEditingText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.target.blur();
            }
            if (e.key === "Escape") {
              setEditingText(null);
            }
          }}
        />
      );
    };

    const handleTransformEnd = (e, id) => {
      const group = e.target;
      const previousText = texts.find((t) => t.id === id);
      const scaleX = group.scaleX();
      const scaleY = group.scaleY();
      const rotation = group.rotation();
      const x = group.x();
      const y = group.y();

      const newText = {
        ...previousText,
        x,
        y,
        scaleX,
        scaleY,
        rotation,
      };

      setTexts((arr) => arr.map((t) => (t.id === id ? newText : t)));

      if (onMove && previousText) {
        const hasChanged =
          previousText.x !== x ||
          previousText.y !== y ||
          (previousText.scaleX || 1) !== scaleX ||
          (previousText.scaleY || 1) !== scaleY ||
          (previousText.rotation || 0) !== rotation;
        if (hasChanged) {
          onMove(id, newText, previousText);
        }
      }
    };

    return (
      <div
        style={{
          width,
          height,
          position: "absolute",
          inset: 0,
          pointerEvents: active ? "auto" : "none",
          overflow: "hidden",
        }}
      >
        <Stage
          width={width}
          height={height}
          ref={stageRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 30,
            pointerEvents: active ? "auto" : "none",
          }}
          onDblClick={handleStageDblClick}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (clickedOnEmpty) {
              handleDeselection();
            }
          }}
          onTap={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (clickedOnEmpty) {
              const now = Date.now();
              const DOUBLE_TAP_DELAY = 400;
              if (now - lastTap < DOUBLE_TAP_DELAY) {
                handleStageDblClick(e);
              } else {
                handleDeselection();
              }
              setLastTap(now);
            }
          }}
        >
          <Layer>
            {texts.map((t) => {
              // Measure through Konva at the same wrap width the textarea used.
              // NOTE: the old code measured with a hidden DOM <span> and named
              // the results `width`/`height`, shadowing the stage-size props of
              // the same name inside this block.
              const wrapWidth = t.maxWidth || defaultWrapWidth(width);
              const metrics = measureText({
                text: t.text,
                fontSize: t.fontSize,
                fontFamily: t.fontFamily,
                maxWidth: wrapWidth,
              });
              const boxWidth = metrics.width + TEXT_PADDING * 2;
              const boxHeight = metrics.height + TEXT_PADDING * 2;

              return (
                <Group
                  key={t.id}
                  id={t.id}
                  x={t.x}
                  y={t.y}
                  scaleX={t.scaleX || 1}
                  scaleY={t.scaleY || 1}
                  rotation={t.rotation || 0}
                  draggable={t.draggable}
                  onClick={() => {
                    handleTextClick(t.id);
                  }}
                  onTap={(e) => {
                    handleTextClick(t.id);
                    handleDoubleTap(e, t.id);
                  }}
                  onDblClick={(e) => handleDblClick(e, t.id)}
                  onDragStart={() => {
                    setSelectedId(t.id);
                    onElementSelect?.(t.id, "text");
                    onDragStateChange?.(true);
                  }}
                  onDragMove={(e) => handleDragMove(e, t.id)}
                  onDragEnd={(e) => handleDragEnd(e, t.id)}
                  onTransformEnd={(e) => handleTransformEnd(e, t.id)}
                >
                  <Rect
                    width={boxWidth}
                    height={boxHeight}
                    fill={t.backgroundColor}
                    cornerRadius={10}
                  />
                  <Text
                    text={t.text}
                    fontSize={t.fontSize}
                    fontFamily={t.fontFamily}
                    fill={t.fill}
                    x={TEXT_PADDING}
                    y={TEXT_PADDING}
                    width={metrics.wrapWidth}
                    wrap="word"
                    lineHeight={TEXT_LINE_HEIGHT}
                  />
                </Group>
              );
            })}
            <Transformer
              ref={trRef}
              rotateEnabled
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ]}
              anchorSize={10}
              borderDash={[4, 4]}
            />
          </Layer>
        </Stage>
        {renderTextarea()}
      </div>
    );
  },
);

export default TextEditor;
