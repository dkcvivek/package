"use client";
import React, {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Stage, Layer, Arrow, Transformer } from "react-konva";
import { snapshotStage } from "@/utils/konvaSnapshot";
import { useKonvaSelection } from "@/hooks/useKonvaSelection";
import { getDashPattern } from "@/utils/getStrokePattern";
import { KONVA_THRESHOLDS } from "@/utils/konvaThreshold";

const KonvaDoubleArrow = forwardRef(
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
      onAdd,
      onMove,
      arrows,
      setArrows,
      onFlatten,
      onElementSelect,
      onElementDeselect,
      checkTrashZoneCollision,
      updateTrashZoneState,
      onDelete,
    },
    ref,
  ) => {
    const [newArrow, setNewArrow] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const stageRef = useRef(null);
    const trRef = useRef(null);

    // Responsive sizing check for touch interactions
    const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

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
        setArrows([]);
        setSelectedId(null);
      },
    }));

    // Clears selections instantly when the tool is deactivated or switched
    useEffect(() => {
      if (!active) {
        setSelectedId(null);
        if (onElementDeselect) {
          onElementDeselect();
        }
      }
    }, [active, onElementDeselect]);

    useEffect(() => {
      if (stageRef.current) {
        const stage = stageRef.current;
        stage.width(width);
        stage.height(height);
        stage.batchDraw();
      }
    }, [width, height]);

    // Two near-duplicate transformer-sync effects used to live here; the second
    // could re-attach what the first had just cleared. Replaced by one hook.
    useKonvaSelection({
      stageRef,
      trRef,
      selectedId,
      setSelectedId,
      elements: arrows,
      onElementDeselect,
    });

    useEffect(() => {
      if (selectedId) {
        setArrows((arrs) =>
          arrs.map((a) =>
            a.id === selectedId
              ? {
                  ...a,
                  stroke: color,
                  strokeWidth: brushSize,
                  strokeStyle: strokeStyle,
                  dash: getDashPattern(strokeStyle, brushSize),
                }
              : a,
          ),
        );
      }
    }, [color, selectedId, brushSize, strokeStyle, setArrows]);

    const handleStageClick = (e) => {
      if (!active) return;
      if (e.evt && e.evt.cancelable) {
        e.evt.preventDefault();
      }

      const clickedOnEmpty = e.target === e.target.getStage();
      if (!clickedOnEmpty) return;

      if (selectedId) {
        setSelectedId(null);
        if (onElementDeselect) {
          onElementDeselect();
        }
      }

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      const id = `double-arrow-${Date.now()}`;
      setNewArrow({
        id,
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: color,
        strokeWidth: brushSize,
        draggable: true,
        strokeStyle: strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
      });
      setSelectedId(id);
    };

    const handleMouseMove = (e) => {
      if (!active || !newArrow) return;
      if (e.evt && e.evt.cancelable) {
        e.evt.preventDefault();
      }

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      setNewArrow({
        ...newArrow,
        points: [newArrow.points[0], newArrow.points[1], pos.x, pos.y],
      });
    };

    const handleMouseUp = (e) => {
      if (!active || !newArrow) return;
      if (e.evt && e.evt.cancelable) {
        e.evt.preventDefault();
      }

      const [x1, y1, x2, y2] = newArrow.points;
      const arrowLength = Math.sqrt(
        Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2),
      );

      if (arrowLength >= KONVA_THRESHOLDS.MIN_DOUBLE_ARROW_LENGTH) {
        setArrows((arrs) => [...arrs, newArrow]);
        if (onAdd) {
          onAdd(newArrow);
        }
      } else {
        // Discarded drawing gesture: Remove selection nodes to prevent ghost outlines
        setSelectedId(null);
        if (onElementDeselect) {
          onElementDeselect();
        }
      }
      setNewArrow(null);
    };

    const handleTouchEnd = (e) => {
      if (newArrow) {
        handleMouseUp(e);
      }
    };

    const constrainToBounds = (points, canvasWidth, canvasHeight) => {
      const [x1, y1, x2, y2] = points;
      const constrainedX1 = Math.max(0, Math.min(canvasWidth, x1));
      const constrainedY1 = Math.max(0, Math.min(canvasHeight, y1));
      const constrainedX2 = Math.max(0, Math.min(canvasWidth, x2));
      const constrainedY2 = Math.max(0, Math.min(canvasHeight, y2));
      return [constrainedX1, constrainedY1, constrainedX2, constrainedY2];
    };

    const handleArrowClick = (id) => {
      const clickedArrow = arrows.find((a) => a.id === id);

      setSelectedId(id);
      setColor(clickedArrow?.stroke || "#000000");
      if (clickedArrow?.strokeStyle) {
        setStrokeStyle(clickedArrow.strokeStyle);
      }
      setBrushSize(clickedArrow?.strokeWidth || 3);

      if (onElementSelect) {
        onElementSelect(id, "double-arrow");
      }
    };

    const handleTransformEnd = (e, id) => {
      const node = e.target;
      const previousArrow = arrows.find((a) => a.id === id);

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const rotation = node.rotation();
      const oldPoints = node.points();

      const centerX = (oldPoints[0] + oldPoints[2]) / 2;
      const centerY = (oldPoints[1] + oldPoints[3]) / 2;

      const originalLength = Math.sqrt(
        Math.pow(oldPoints[2] - oldPoints[0], 2) +
          Math.pow(oldPoints[3] - oldPoints[1], 2),
      );
      const originalAngle = Math.atan2(
        oldPoints[3] - oldPoints[1],
        oldPoints[2] - oldPoints[0],
      );

      const newLength = originalLength * Math.max(scaleX, scaleY);
      const newAngle = originalAngle + (rotation * Math.PI) / 180;

      const halfLength = newLength / 2;
      let newPoints = [
        centerX - halfLength * Math.cos(newAngle),
        centerY - halfLength * Math.sin(newAngle),
        centerX + halfLength * Math.cos(newAngle),
        centerY + halfLength * Math.sin(newAngle),
      ];

      const constrainedPoints = constrainToBounds(newPoints, width, height);

      node.scaleX(1);
      node.scaleY(1);
      node.rotation(0);
      node.x(0);
      node.y(0);

      const newArrow = {
        ...previousArrow,
        points: constrainedPoints,
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle: strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
      };

      setArrows((arrs) => arrs.map((a) => (a.id === id ? newArrow : a)));

      if (onMove && previousArrow) {
        const hasChanged = !previousArrow.points.every(
          (point, index) => point === constrainedPoints[index],
        );
        if (hasChanged) {
          onMove(id, newArrow, previousArrow);
        }
      }
    };

    const handleDragMove = (e, id) => {
      const stage = e.target.getStage();
      const node = e.target;
      const { x, y } = node.position();

      const oldPoints = node.points();
      const centerX = (oldPoints[0] + oldPoints[2]) / 2;
      const centerY = (oldPoints[1] + oldPoints[3]) / 2;

      const stageContainer = stage.container();
      const stageRect = stageContainer.getBoundingClientRect();

      const screenX = stageRect.left + centerX + x;
      const screenY = stageRect.top + centerY + y;

      if (checkTrashZoneCollision && updateTrashZoneState) {
        const isOverTrash = checkTrashZoneCollision(screenX, screenY);
        updateTrashZoneState(isOverTrash);
      }
    };

    const handleDragEnd = (e, id) => {
      const node = e.target;
      const stage = e.target.getStage();
      const x = node.x();
      const y = node.y();

      const previousArrow = arrows.find((a) => a.id === id);

      if (updateTrashZoneState) {
        updateTrashZoneState(false);
      }

      const stageContainer = stage.container();
      const stageRect = stageContainer.getBoundingClientRect();

      const oldPoints = node.points();
      const centerX = (oldPoints[0] + oldPoints[2]) / 2;
      const centerY = (oldPoints[1] + oldPoints[3]) / 2;

      const screenX = stageRect.left + centerX + x;
      const screenY = stageRect.top + centerY + y;

      if (
        checkTrashZoneCollision &&
        checkTrashZoneCollision(screenX, screenY)
      ) {
        // Route deletion through history — the Konva arrays are derived from
        // the action log, so a bare local filter is undone by the very next
        // action or undo/redo (the shape reappears).
        if (onDelete) onDelete(id);
        else setArrows((arrs) => arrs.filter((a) => a.id !== id));
        setSelectedId(null);
        if (onElementDeselect) onElementDeselect();
        return;
      }

      const dx = x;
      const dy = y;

      let newPoints = [
        oldPoints[0] + dx,
        oldPoints[1] + dy,
        oldPoints[2] + dx,
        oldPoints[3] + dy,
      ];

      newPoints = constrainToBounds(newPoints, width, height);

      node.x(0);
      node.y(0);

      const newArrow = {
        ...previousArrow,
        points: newPoints,
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle: strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
      };

      setArrows((arrs) => arrs.map((a) => (a.id === id ? newArrow : a)));

      if (onMove && previousArrow) {
        const hasChanged = !previousArrow.points.every(
          (point, index) => point === newPoints[index],
        );
        if (hasChanged) {
          onMove(id, newArrow, previousArrow);
        }
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
          pointerEvents: active ? "auto" : "none",
        }}
        onMouseDown={handleStageClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleStageClick}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          const clickedOnEmpty = e.target === e.target.getStage();
          if (clickedOnEmpty && selectedId) {
            setSelectedId(null);
            if (onElementDeselect) {
              onElementDeselect();
            }
          }
        }}
        onTap={(e) => {
          const clickedOnEmpty = e.target === e.target.getStage();
          if (clickedOnEmpty && selectedId) {
            setSelectedId(null);
            if (onElementDeselect) {
              onElementDeselect();
            }
          }
        }}
      >
        <Layer>
          {arrows.map((arrow) => (
            <Arrow
              key={arrow.id}
              id={arrow.id}
              points={arrow.points}
              stroke={arrow.stroke}
              strokeWidth={arrow.strokeWidth}
              // Touch target, not a dead zone: 60-90px meant a single arrow
              // blanketed a third of a phone screen, and every press inside
              // that band failed the `clickedOnEmpty` test — so you could not
              // start a second arrow anywhere near the first.
              hitStrokeWidth={Math.max(24, arrow.strokeWidth * 4)}
              perfectDrawEnabled={false}
              dash={arrow.dash}
              pointerLength={15}
              pointerWidth={15}
              fill={arrow.stroke}
              draggable={arrow.draggable}
              onClick={(e) => {
                e.cancelBubble = true;
                handleArrowClick(arrow.id);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                handleArrowClick(arrow.id);
              }}
              onDragMove={(e) => handleDragMove(e, arrow.id)}
              onDragEnd={(e) => handleDragEnd(e, arrow.id)}
              onTransformEnd={(e) => handleTransformEnd(e, arrow.id)}
              pointerAtBeginning={true}
              pointerAtEnding={true}
            />
          ))}
          {newArrow && (
            <Arrow
              points={newArrow.points}
              stroke={newArrow.stroke}
              strokeWidth={newArrow.strokeWidth}
              // The in-progress preview must never intercept pointer events.
              listening={false}
              perfectDrawEnabled={false}
              pointerLength={15}
              pointerWidth={15}
              fill={newArrow.stroke}
              dash={newArrow.dash}
              pointerAtBeginning={true}
              pointerAtEnding={true}
            />
          )}
          <Transformer
            ref={trRef}
            rotateEnabled={true}
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
    );
  },
);

export default KonvaDoubleArrow;
