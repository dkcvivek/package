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

const ArrowKonva = forwardRef(
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
    const [lastDist, setLastDist] = useState(0);
    const [lastRotation, setLastRotation] = useState(0);

    const stageRef = useRef(null);
    const trRef = useRef(null);

    // ── imperative handle ──────────────────────────────────────────────────
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

    // ── sync stage size ────────────────────────────────────────────────────
    useEffect(() => {
      if (stageRef.current) {
        stageRef.current.width(width);
        stageRef.current.height(height);
        stageRef.current.batchDraw();
      }
    }, [width, height]);

    // ── keyboard delete ────────────────────────────────────────────────────
    useEffect(() => {
      const handleKeyDown = (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
          if (onDelete) onDelete(selectedId);
          else setArrows((arrs) => arrs.filter((a) => a.id !== selectedId));
          setSelectedId(null);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, setArrows, onDelete]);

    // ── transformer sync + stale-selection cleanup ─────────────────────────
    useKonvaSelection({
      stageRef,
      trRef,
      selectedId,
      setSelectedId,
      elements: arrows,
      onElementDeselect,
    });

    // ── live colour / size update on selected arrow ────────────────────────
    useEffect(() => {
      if (selectedId) {
        setArrows((arrs) =>
          arrs.map((a) =>
            a.id === selectedId
              ? {
                  ...a,
                  stroke: color,
                  strokeWidth: brushSize,
                  strokeStyle,
                  dash: getDashPattern(strokeStyle, brushSize),
                }
              : a,
          ),
        );
      }
    }, [color, selectedId, brushSize, strokeStyle]);

    // ── helpers ────────────────────────────────────────────────────────────
    const constrainToBounds = (points, canvasWidth, canvasHeight) => {
      const [x1, y1, x2, y2] = points;
      return [
        Math.max(0, Math.min(canvasWidth, x1)),
        Math.max(0, Math.min(canvasHeight, y1)),
        Math.max(0, Math.min(canvasWidth, x2)),
        Math.max(0, Math.min(canvasHeight, y2)),
      ];
    };

    const getDistance = (p1, p2) =>
      Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    const getAngle = (p1, p2) => Math.atan2(p2.y - p1.y, p2.x - p1.x);

    const getCenter = (p1, p2) => ({
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    });

    // ── stage events ───────────────────────────────────────────────────────
    const handleStageClick = (e) => {
      if (!active) return;
      if (e.evt) e.evt.preventDefault();
      if (e.evt.touches && e.evt.touches.length > 1) return;

      const clickedOnEmpty = e.target === e.target.getStage();
      if (!clickedOnEmpty) return;

      if (selectedId) {
        setSelectedId(null);
        onElementDeselect?.();
      }

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      const id = `arrow-${Date.now()}`;
      setNewArrow({
        id,
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
        draggable: true,
      });
      setSelectedId(id);
    };

    const handleMouseMove = (e) => {
      if (!active || !newArrow) return;
      if (e.evt) e.evt.preventDefault();

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      setNewArrow({
        ...newArrow,
        points: [
          newArrow.points[0],
          newArrow.points[1],
          Math.max(0, Math.min(width, pos.x)),
          Math.max(0, Math.min(height, pos.y)),
        ],
      });
    };

    const handleMouseUp = (e) => {
      if (!active || !newArrow) return;
      if (e.evt) e.evt.preventDefault();

      const [x1, y1, x2, y2] = newArrow.points;
      const arrowLength = Math.sqrt(
        Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2),
      );

      if (arrowLength >= KONVA_THRESHOLDS.MIN_ARROW_LENGTH) {
        setArrows((arrs) => [...arrs, newArrow]);
        onAdd?.(newArrow);
      }
      setNewArrow(null);
    };

    const handleTouchMove = (e) => {
      if (!active) return;
      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];

      if (newArrow && !touch2) {
        handleMouseMove(e);
        return;
      }

      if (touch1 && touch2 && selectedId) {
        e.evt.preventDefault();

        const dist = getDistance(
          { x: touch1.clientX, y: touch1.clientY },
          { x: touch2.clientX, y: touch2.clientY },
        );
        const angle = getAngle(
          { x: touch1.clientX, y: touch1.clientY },
          { x: touch2.clientX, y: touch2.clientY },
        );

        if (lastDist > 0) {
          const scale = dist / lastDist;
          const rotationDelta = angle - lastRotation;

          setArrows((arrs) =>
            arrs.map((a) => {
              if (a.id !== selectedId) return a;
              const [x1, y1, x2, y2] = a.points;
              const cx = (x1 + x2) / 2,
                cy = (y1 + y2) / 2;
              const len = Math.sqrt(
                Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2),
              );
              const ang = Math.atan2(y2 - y1, x2 - x1);
              const nl = len * scale;
              const na = ang + rotationDelta;
              const hl = nl / 2;
              return {
                ...a,
                points: [
                  cx - hl * Math.cos(na),
                  cy - hl * Math.sin(na),
                  cx + hl * Math.cos(na),
                  cy + hl * Math.sin(na),
                ],
              };
            }),
          );
        }
        setLastDist(dist);
        setLastRotation(angle);
      }
    };

    const handleTouchEnd = (e) => {
      setLastDist(0);
      setLastRotation(0);
      if (newArrow && !e.evt.touches.length) handleMouseUp(e);
    };

    // ── arrow interaction ──────────────────────────────────────────────────
    const handleArrowClick = (id) => {
      const clicked = arrows.find((a) => a.id === id);
      setSelectedId(id);
      setColor(clicked?.stroke || "#000000");
      if (clicked?.strokeStyle) setStrokeStyle(clicked.strokeStyle);
      setBrushSize(clicked?.strokeWidth || 3);
      onElementSelect?.(id, "arrow");
    };

    const handleTransformEnd = (e, id) => {
      const node = e.target;
      const previousArrow = arrows.find((a) => a.id === id);

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const rotation = node.rotation();
      const oldPoints = node.points();

      const cx = (oldPoints[0] + oldPoints[2]) / 2;
      const cy = (oldPoints[1] + oldPoints[3]) / 2;
      const len = Math.sqrt(
        Math.pow(oldPoints[2] - oldPoints[0], 2) +
          Math.pow(oldPoints[3] - oldPoints[1], 2),
      );
      const ang = Math.atan2(
        oldPoints[3] - oldPoints[1],
        oldPoints[2] - oldPoints[0],
      );
      const nl = len * Math.max(scaleX, scaleY);
      const na = ang + (rotation * Math.PI) / 180;
      const hl = nl / 2;

      const constrainedPoints = constrainToBounds(
        [
          cx - hl * Math.cos(na),
          cy - hl * Math.sin(na),
          cx + hl * Math.cos(na),
          cy + hl * Math.sin(na),
        ],
        width,
        height,
      );

      node.scaleX(1);
      node.scaleY(1);
      node.rotation(0);
      node.x(0);
      node.y(0);

      const updated = {
        ...previousArrow,
        points: constrainedPoints,
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
      };

      setArrows((arrs) => arrs.map((a) => (a.id === id ? updated : a)));

      if (onMove && previousArrow) {
        const changed = !previousArrow.points.every(
          (p, i) => p === constrainedPoints[i],
        );
        if (changed) onMove(id, updated, previousArrow);
      }
    };

    const handleDragMove = (e, id) => {
      if (!checkTrashZoneCollision || !updateTrashZoneState) return;
      const node = e.target;
      const stage = node.getStage();
      const { x, y } = node.position();
      const pts = node.points();
      const cx = (pts[0] + pts[2]) / 2;
      const cy = (pts[1] + pts[3]) / 2;
      const rect = stage.container().getBoundingClientRect();
      updateTrashZoneState(
        checkTrashZoneCollision(rect.left + cx + x, rect.top + cy + y),
      );
    };

    const handleDragEnd = (e, id) => {
      const node = e.target;
      const stage = node.getStage();
      const x = node.x();
      const y = node.y();
      const previousArrow = arrows.find((a) => a.id === id);

      updateTrashZoneState?.(false);

      const rect = stage.container().getBoundingClientRect();
      const pts = node.points();
      const cx = (pts[0] + pts[2]) / 2 + x;
      const cy = (pts[1] + pts[3]) / 2 + y;

      if (checkTrashZoneCollision?.(rect.left + cx, rect.top + cy)) {
        // Route deletion through history — the Konva arrays are derived from
        // the action log, so a bare local filter is undone by the very next
        // action or undo/redo (the shape reappears).
        if (onDelete) onDelete(id);
        else setArrows((arrs) => arrs.filter((a) => a.id !== id));
        setSelectedId(null);
        onElementDeselect?.();
        return;
      }

      const newPoints = constrainToBounds(
        [pts[0] + x, pts[1] + y, pts[2] + x, pts[3] + y],
        width,
        height,
      );
      node.x(0);
      node.y(0);

      const updated = {
        ...previousArrow,
        points: newPoints,
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle,
        dash: getDashPattern(strokeStyle, brushSize),
      };

      setArrows((arrs) => arrs.map((a) => (a.id === id ? updated : a)));

      if (onMove && previousArrow) {
        const changed = !previousArrow.points.every(
          (p, i) => p === newPoints[i],
        );
        if (changed) onMove(id, updated, previousArrow);
      }
    };

    // ── render ─────────────────────────────────────────────────────────────
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
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          if (e.target === e.target.getStage() && selectedId) {
            setSelectedId(null);
            onElementDeselect?.();
          }
        }}
        onTap={(e) => {
          if (e.target === e.target.getStage() && selectedId) {
            setSelectedId(null);
            onElementDeselect?.();
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
              dash={newArrow.dash}
              pointerLength={15}
              pointerWidth={15}
              fill={newArrow.stroke}
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
              "middle-left",
              "middle-right",
            ]}
            anchorSize={8}
            borderDash={[4, 4]}
          />
        </Layer>
      </Stage>
    );
  },
);

ArrowKonva.displayName = "ArrowKonva";
export default ArrowKonva;
