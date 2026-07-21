
"use client";

import React, {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Stage, Layer, Text, Transformer, Group, Rect } from "react-konva";

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
          const canvasEl = stageRef.current.toCanvas({ pixelRatio: 1 });
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

    useEffect(() => {
      if (stageRef.current && active) {
        const stage = stageRef.current;
        const drawingCanvas = document.querySelector(
          'canvas[class*="absolute w-full h-full"]:last-of-type',
        );

        if (drawingCanvas) {
          const actualWidth = drawingCanvas.width;
          const actualHeight = drawingCanvas.height;
          stage.width(actualWidth);
          stage.height(actualHeight);
          stage.size({ width: actualWidth, height: actualHeight });
          stage.batchDraw();
        }
      }
    }, [active, width, height]);

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

    useEffect(() => {
      if (trRef.current && selectedId) {
        const node = stageRef.current.findOne(`#${selectedId}`);
        if (node) {
          trRef.current.nodes([node]);
          trRef.current.getLayer().batchDraw();
        }
      }
    }, [selectedId, texts]);

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

      const margin = 12; // keep the box off the canvas edge
      const maxAvailableWidth = Math.max(60, width - editingText.x - margin);
      const maxAvailableHeight = Math.max(40, height - editingText.y - margin);
      const desiredWidth = Math.min(220, maxAvailableWidth);

      return (
        <textarea
          style={{
            position: "absolute",
            top: editingText.y,
            left: editingText.x,
            width: desiredWidth,
            maxWidth: maxAvailableWidth,
            maxHeight: maxAvailableHeight,
            fontSize: fontSize,
            fontFamily: fontFamily,
            lineHeight: 1.2,
            zIndex: 1000,
            minWidth: 50,
            minHeight: 24,
            background: backgroundColor,
            color: color,
            border: "1px solid #ccc",
            padding: 4,
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
            // auto-grow the box vertically as text wraps to new lines,
            // capped so it never exceeds the remaining canvas height
            e.target.style.height = "auto";
            e.target.style.height =
              Math.min(e.target.scrollHeight, maxAvailableHeight) + "px";
          }}
          onBlur={() => {
            if (editingText.value.trim()) {
              if (editingText.id) {
                setTexts((arr) =>
                  arr.map((t) =>
                    t.id === editingText.id
                      ? {
                          ...t,
                          text: editingText.value,
                          fill: color,
                          backgroundColor: backgroundColor,
                        }
                      : t,
                  ),
                );
              } else {
                const newId = `text-${Date.now()}`;
                const newText = {
                  id: newId,
                  x: editingText.x,
                  y: editingText.y,
                  text: editingText.value,
                  fontSize,
                  fontFamily,
                  fill: color,
                  backgroundColor: backgroundColor,
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
      const x = group.x();
      const y = group.y();

      const newText = {
        ...previousText,
        x,
        y,
        scaleX,
        scaleY,
      };

      setTexts((arr) => arr.map((t) => (t.id === id ? newText : t)));

      if (onMove && previousText) {
        const hasChanged =
          previousText.x !== x ||
          previousText.y !== y ||
          (previousText.scaleX || 1) !== scaleX ||
          (previousText.scaleY || 1) !== scaleY;
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
              const textNode = document.createElement("span");
              textNode.innerText = t.text;
              textNode.style.fontSize = `${t.fontSize}px`;
              textNode.style.fontFamily = t.fontFamily;
              textNode.style.lineHeight = "1";
              textNode.style.position = "absolute";
              textNode.style.visibility = "hidden";
              document.body.appendChild(textNode);
              const padding = 6;
              const width = textNode.offsetWidth + padding * 2;
              const height = textNode.offsetHeight + padding * 2;
              document.body.removeChild(textNode);

              return (
                <Group
                  key={t.id}
                  id={t.id}
                  x={t.x}
                  y={t.y}
                  scaleX={t.scaleX || 1}
                  scaleY={t.scaleY || 1}
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
                    width={width}
                    height={height}
                    fill={t.backgroundColor}
                    cornerRadius={10}
                  />
                  <Text
                    text={t.text}
                    fontSize={t.fontSize}
                    fontFamily={t.fontFamily}
                    fill={t.fill}
                    x={padding}
                    y={padding}
                    lineHeight={1}
                  />
                </Group>
              );
            })}
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ]}
              anchorSize={8}
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
