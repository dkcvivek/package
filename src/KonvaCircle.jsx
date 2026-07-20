"use client";

import React, {
  useRef,
  useState,
  forwardRef,
  useEffect,
  useImperativeHandle,
} from "react";
import { Stage, Layer, Circle, Transformer } from "react-konva";
import { getDashPattern } from "@/utils/getStrokePattern";
import { KONVA_THRESHOLDS } from "@/utils/konvaThreshold";

const KonvaCircle = forwardRef(
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
      onMove,
      circles,
      setCircles,
      onFlatten,
      onElementSelect,
      onElementDeselect,
      checkTrashZoneCollision,
      updateTrashZoneState,
    },
    ref,
  ) => {
    const [newCircle, setNewCircle] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const stageRef = useRef(null);
    const trRef = useRef(null);

    useImperativeHandle(ref, () => ({
      flatten: () => {
        onFlatten(circles);
        setCircles([]);
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

    useEffect(() => {
      const handleKeyDown = (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
          setCircles((circle) => circle.filter((c) => c.id !== selectedId));
          setSelectedId(null);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, setCircles]);

    const handleStageClick = (e) => {
      if (!active) return;
      if (e.evt) {
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

      const id = `circle-${Date.now()}`;
      setNewCircle({
        id,
        x: pos.x,
        y: pos.y,
        radius: 1,
        stroke: color,
        strokeWidth: brushSize,
        strokeStyle: strokeStyle,
        draggable: true,
        dash: getDashPattern(strokeStyle, brushSize),
        fill:
          backgroundColor && backgroundColor !== "transparent"
            ? backgroundColor
            : undefined,
      });
      setSelectedId(id);
    };

    const handleMouseMove = (e) => {
      if (!active || !newCircle) return;
      if (e.evt) {
        e.evt.preventDefault();
      }

      const pos = e.target.getStage().getPointerPosition();
      if (!pos) return;

      const dx = pos.x - newCircle.x;
      const dy = pos.y - newCircle.y;
      setNewCircle({
        ...newCircle,
        radius: Math.sqrt(dx * dx + dy * dy),
      });
    };

    const handleMouseUp = (e) => {
      if (!active || !newCircle) return;
      if (e.evt) {
        e.evt.preventDefault();
      }

      if (newCircle.radius >= KONVA_THRESHOLDS.MIN_CIRCLE_RADIUS) {
        setCircles((cs) => [...cs, newCircle]);
        if (onAdd) {
          onAdd(newCircle);
        }
      }
      setNewCircle(null);
    };

    const handleCircleClick = (id) => {
      const clickedCircle = circles.find((c) => c.id === id);

      setSelectedId(id);
      setColor(clickedCircle?.stroke || "#000000");
      setBackgroundColor(clickedCircle?.fill || "transparent");
      setBrushSize(clickedCircle?.strokeWidth || 3);
      setStrokeStyle(clickedCircle?.strokeStyle || "solid");

      if (onElementSelect) {
        onElementSelect(id, "circle");
      }
    };

    const handleTransformEnd = (e, id) => {
      const node = e.target;
      const previousCircle = circles.find((c) => c.id === id);
      if (!previousCircle) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const uniformScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
      const newRadius = Math.max(
        previousCircle.radius * uniformScale,
        KONVA_THRESHOLDS.MIN_CIRCLE_RADIUS,
      );

      const newCenterX = previousCircle.x;
      const newCenterY = previousCircle.y;

      node.radius(newRadius);
      node.x(newCenterX);
      node.y(newCenterY);
      node.scaleX(1);
      node.scaleY(1);
      node.rotation(0);

      node.getLayer().batchDraw();

      const newCircle = {
        ...previousCircle,
        radius: newRadius,
        x: newCenterX,
        y: newCenterY,
      };

      setCircles((cs) => cs.map((c) => (c.id === id ? newCircle : c)));

      if (onMove && previousCircle) {
        const hasChanged = previousCircle.radius !== newRadius;
        if (hasChanged) {
          onMove(id, newCircle, previousCircle);
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
      const stage = e.target.getStage();
      const node = e.target;
      const { x, y } = node.position();

      const previousCircle = circles.find((c) => c.id === id);

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
        setCircles((circles) => circles.filter((c) => c.id !== id));
        setSelectedId(null);
        if (onElementDeselect) onElementDeselect();
        return;
      }

      setCircles((circles) =>
        circles.map((c) => (c.id === id ? { ...c, x, y } : c)),
      );

      if (
        onMove &&
        previousCircle &&
        (previousCircle.x !== x || previousCircle.y !== y)
      ) {
        const newCircle = { ...previousCircle, x, y };
        onMove(id, newCircle, previousCircle);
      }
    };

    useEffect(() => {
      if (trRef.current && selectedId && stageRef.current) {
        const node = stageRef.current.findOne(`#${selectedId}`);
        if (node) {
          trRef.current.nodes([node]);
          trRef.current.getLayer().batchDraw();
        }
      } else if (trRef.current) {
        trRef.current.nodes([]);
        trRef.current.getLayer().batchDraw();
      }
    }, [selectedId, circles]);

    useEffect(() => {
      if (selectedId) {
        setCircles((cs) =>
          cs.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  stroke: color,
                  strokeWidth: brushSize,
                  strokeStyle: strokeStyle,
                  dash: getDashPattern(strokeStyle, brushSize),
                  ...(backgroundColor &&
                    backgroundColor !== "transparent" && {
                      fill: backgroundColor,
                    }),
                }
              : c,
          ),
        );
      }
    }, [
      color,
      backgroundColor,
      selectedId,
      strokeStyle,
      brushSize,
      setCircles,
    ]);

    return (
      <Stage
        ref={stageRef}
        width={width}
        height={height}
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
        onTouchEnd={handleMouseUp}
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
          {circles.map((circle) => (
            <Circle
              key={circle.id}
              id={circle.id}
              x={circle.x}
              y={circle.y}
              radius={circle.radius}
              stroke={circle.stroke}
              strokeWidth={circle.strokeWidth}
              dash={circle.dash}
              draggable={circle.draggable}
              fill={circle.fill}
              onClick={() => handleCircleClick(circle.id)}
              onTap={() => handleCircleClick(circle.id)}
              onDragMove={(e) => handleDragMove(e, circle.id)}
              onDragEnd={(e) => handleDragEnd(e, circle.id)}
              onTransformEnd={(e) => handleTransformEnd(e, circle.id)}
            />
          ))}
          {newCircle && (
            <Circle
              x={newCircle.x}
              y={newCircle.y}
              radius={newCircle.radius}
              stroke={newCircle.stroke}
              strokeWidth={newCircle.strokeWidth}
              dash={newCircle.dash}
              fill={newCircle.fill}
            />
          )}
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
            keepRatio={true}
            centeredScaling={true}
          />
        </Layer>
      </Stage>
    );
  },
);

export default KonvaCircle;
