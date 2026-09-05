"use client";
import React, {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Stage, Layer, Rect, Transformer } from "react-konva";
import { snapshotStage } from "@/utils/konvaSnapshot";
import { useKonvaSelection } from "@/hooks/useKonvaSelection";
import { getDashPattern } from "@/utils/getStrokePattern";
import { KONVA_THRESHOLDS } from "@/utils/konvaThreshold";

const KonvaRectangle = forwardRef(
  (
    {
      width,
      height,
      active,
      color,
      setColor,
      brushSize,
      setBrushSize,
      strokeStyle,
      setStrokeStyle,
      backgroundColor,
      setBackgroundColor,
      onAdd,
      rectangles = [], // Ensure it defaults to empty array
      setRectangles,
      onFlatten,
      onElementSelect,
      onElementDeselect,
      checkTrashZoneCollision,
      updateTrashZoneState,
      onMove,
      onDelete,
    },
    ref,
  ) => {
    const [newRect, setNewRect] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const stageRef = useRef(null);
    const trRef = useRef(null);

    useImperativeHandle(ref, () => ({
      flatten: () => {
        if (trRef.current) {
          trRef.current.nodes([]);
          trRef.current.getLayer().batchDraw();
        }
        if (onFlatten && stageRef.current) {
          const canvasEl = snapshotStage(stageRef.current);
          onFlatten(canvasEl);
        }
        if (setRectangles) setRectangles([]);
        setSelectedId(null);
      },
    }));

    useEffect(() => {
      if (stageRef.current) {
        const stage = stageRef.current;
        stage.width(width);
        stage.height(height);
        stage.batchDraw();
      }
    }, [width, height]);

    // Handle Keyboard Actions
    useEffect(() => {
      const handleKeyDown = (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
          // Record a DELETE_ELEMENT action. The old path called
          // onMove(id, null, prev, "DELETE"), which the parent turned into a
          // MOVE_ELEMENT with a null payload — a no-op that left the shape on
          // screen. The 4th "DELETE" argument was never read by anyone.
          if (onDelete) onDelete(selectedId);
          else if (setRectangles)
            setRectangles((rects) => rects.filter((r) => r.id !== selectedId));
          setSelectedId(null);

          if (trRef.current) {
            trRef.current.nodes([]);
            trRef.current.getLayer().batchDraw();
          }

          if (onElementDeselect) onElementDeselect();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, setRectangles, onElementDeselect, onDelete]);

    // Transformer sync + stale-selection cleanup
    useKonvaSelection({
      stageRef,
      trRef,
      selectedId,
      setSelectedId,
      elements: rectangles,
      onElementDeselect,
    });

    // Property panel changes dynamic observer
    useEffect(() => {
      if (selectedId && active && setRectangles) {
        const targeted = rectangles.find((r) => r.id === selectedId);
        if (!targeted) return;

        if (
          targeted.stroke !== color ||
          targeted.strokeWidth !== brushSize ||
          targeted.strokeStyle !== strokeStyle ||
          targeted.fill !== backgroundColor
        ) {
          setRectangles((rects) =>
            rects.map((r) =>
              r.id === selectedId
                ? {
                    ...r,
                    stroke: color,
                    strokeWidth: brushSize,
                    strokeStyle: strokeStyle,
                    dash: getDashPattern(strokeStyle, brushSize),
                    fill: backgroundColor || "transparent",
                  }
                : r,
            ),
          );
        }
      }
    }, [
      color,
      backgroundColor,
      selectedId,
      strokeStyle,
      brushSize,
      active,
      rectangles,
      setRectangles,
    ]);

    const handleMouseDown = (e) => {
      if (!active) return;
      if (e.evt) e.evt.preventDefault();

      const clickedOnEmpty = e.target === e.target.getStage();
      if (!clickedOnEmpty) return;

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      const id = `rect-${Date.now()}`;
      setNewRect({
        id,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        stroke: color || "#000000",
        strokeWidth: brushSize || 3,
        strokeStyle: strokeStyle || "solid",
        draggable: true,
        rotation: 0,
        dash: getDashPattern(strokeStyle || "solid", brushSize || 3),
        fill: backgroundColor || "transparent",
      });
      setSelectedId(id);
    };

    const handleMouseMove = (e) => {
      if (!active || !newRect) return;
      if (e.evt) e.evt.preventDefault();

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      setNewRect({
        ...newRect,
        width: Math.abs(pos.x - newRect.x),
        height: Math.abs(pos.y - newRect.y),
        x: Math.min(pos.x, newRect.x),
        y: Math.min(pos.y, newRect.y),
      });
    };

    const handleMouseUp = (e) => {
      if (!active || !newRect) return;
      if (e.evt) e.evt.preventDefault();

      // Ensure fallback thresholds so shapes are never dropped due to small sizing
      const minW = KONVA_THRESHOLDS?.MIN_RECT_WIDTH ?? 2;
      const minH = KONVA_THRESHOLDS?.MIN_RECT_HEIGHT ?? 2;

      if (newRect.width >= minW && newRect.height >= minH) {
        // Optimistically update local hook context immediately to prevent disappearance flicker
        if (setRectangles) {
          setRectangles((rects) => [...rects, newRect]);
        }

        if (onAdd) {
          onAdd(newRect); // Commit to parent history layout array
        }
      }
      setNewRect(null);
    };

    const handleRectClick = (id) => {
      const clickedRect = rectangles.find((r) => r.id === id);
      if (!clickedRect) return;

      setSelectedId(id);
      if (setColor) setColor(clickedRect.stroke || "#000000");
      if (setBackgroundColor)
        setBackgroundColor(clickedRect.fill || "transparent");
      if (setBrushSize) setBrushSize(clickedRect.strokeWidth || 3);
      if (setStrokeStyle) setStrokeStyle(clickedRect.strokeStyle || "solid");

      if (onElementSelect) {
        onElementSelect(id, "rectangle");
      }
    };

    const handleDragMove = (e, id) => {
      if (!active) return;
      const stage = e.target.getStage();
      const node = e.target;
      const { x, y } = node.position();

      const stageRect = stage.container().getBoundingClientRect();
      const screenX = stageRect.left + x;
      const screenY = stageRect.top + y;

      if (checkTrashZoneCollision && updateTrashZoneState) {
        const isOverTrash = checkTrashZoneCollision(screenX, screenY);
        updateTrashZoneState(isOverTrash);
      }
    };

    const handleDragEnd = (e, id) => {
      if (!active) return;
      const stage = e.target.getStage();
      const node = e.target;
      const { x, y } = node.position();

      const previousRect = rectangles.find((r) => r.id === id);
      if (updateTrashZoneState) updateTrashZoneState(false);

      const stageRect = stage.container().getBoundingClientRect();
      const screenX = stageRect.left + x;
      const screenY = stageRect.top + y;

      if (
        checkTrashZoneCollision &&
        checkTrashZoneCollision(screenX, screenY)
      ) {
        if (onDelete) onDelete(id);
        else if (setRectangles)
          setRectangles((rects) => rects.filter((r) => r.id !== id));
        setSelectedId(null);
        if (trRef.current) trRef.current.nodes([]);
        if (onElementDeselect) onElementDeselect();
        return;
      }

      const updated = { ...previousRect, x, y };

      if (
        onMove &&
        previousRect &&
        (previousRect.x !== x || previousRect.y !== y)
      ) {
        onMove(id, updated, previousRect);
      } else if (setRectangles) {
        setRectangles((rects) => rects.map((r) => (r.id === id ? updated : r)));
      }
    };

    const handleTransformEnd = (e, id) => {
      if (!active) return;
      const node = e.target;
      const previousRect = rectangles.find((r) => r.id === id);
      if (!previousRect) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const rotation = node.rotation();

      const newWidth = Math.max(
        KONVA_THRESHOLDS?.MIN_RECT_WIDTH ?? 2,
        node.width() * scaleX,
      );
      const newHeight = Math.max(
        KONVA_THRESHOLDS?.MIN_RECT_HEIGHT ?? 2,
        node.height() * scaleY,
      );

      node.scaleX(1);
      node.scaleY(1);

      const updated = {
        ...previousRect,
        x: node.x(),
        y: node.y(),
        width: newWidth,
        height: newHeight,
        rotation: rotation,
      };

      if (onMove) {
        onMove(id, updated, previousRect);
      } else if (setRectangles) {
        setRectangles((rects) => rects.map((r) => (r.id === id ? updated : r)));
      }
    };

    return (
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
          pointerEvents: active ? "auto" : "none", // Keeps click-through on passive layer seamless
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onClick={(e) => {
          if (e.target === e.target.getStage()) {
            setSelectedId(null);
            if (onElementDeselect) onElementDeselect();
          }
        }}
        onTap={(e) => {
          if (e.target === e.target.getStage()) {
            setSelectedId(null);
            if (onElementDeselect) onElementDeselect();
          }
        }}
      >
        <Layer>
          {rectangles.map((rect) => (
            <Rect
              key={rect.id}
              id={rect.id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              stroke={rect.stroke}
              strokeWidth={rect.strokeWidth}
              dash={rect.dash}
              draggable={active && rect.draggable}
              rotation={rect.rotation}
              fill={rect.fill === "transparent" ? undefined : rect.fill}
              onClick={() => handleRectClick(rect.id)}
              onTap={() => handleRectClick(rect.id)}
              onDragMove={(e) => handleDragMove(e, rect.id)}
              onDragEnd={(e) => handleDragEnd(e, rect.id)}
              onTransformEnd={(e) => handleTransformEnd(e, rect.id)}
            />
          ))}
          {newRect && (
            <Rect
              x={newRect.x}
              y={newRect.y}
              width={newRect.width}
              height={newRect.height}
              stroke={newRect.stroke}
              strokeWidth={newRect.strokeWidth}
              dash={newRect.dash}
              fill={newRect.fill === "transparent" ? undefined : newRect.fill}
            />
          )}
          {active && (
            <Transformer
              ref={trRef}
              rotateEnabled
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
                "middle-left",
                "middle-right",
                "top-center",
                "bottom-center",
              ]}
              anchorSize={10}
              borderDash={[4, 4]}
            />
          )}
        </Layer>
      </Stage>
    );
  },
);

export default KonvaRectangle;