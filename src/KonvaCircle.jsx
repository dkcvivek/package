
"use client";
import React, {
  useRef,
  useState,
  forwardRef,
  useEffect,
  useImperativeHandle,
} from "react";
import { Stage, Layer, Ellipse, Transformer } from "react-konva";
import { snapshotStage } from "@/utils/konvaSnapshot";
import { useKonvaSelection } from "@/hooks/useKonvaSelection";
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
      onDelete,
    },
    ref,
  ) => {
    const [newCircle, setNewCircle] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const stageRef = useRef(null);
    const trRef = useRef(null);
    const dragOriginRef = useRef(null);

    // Older saved shapes stored a single `radius`. Read through this so they
    // keep rendering as circles instead of collapsing to nothing.
    const radiiOf = (c) => ({
      radiusX: c.radiusX ?? c.radius ?? 0,
      radiusY: c.radiusY ?? c.radius ?? 0,
    });

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
          if (onDelete) onDelete(selectedId);
          else setCircles((circle) => circle.filter((c) => c.id !== selectedId));
          setSelectedId(null);
          onElementDeselect?.();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, setCircles, onDelete, onElementDeselect]);

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
      // Anchor the drag origin; the shape is derived from the bounding box
      // between it and the pointer (see handleMouseMove), exactly like the
      // rectangle tool.
      dragOriginRef.current = { x: pos.x, y: pos.y };
      setNewCircle({
        id,
        x: pos.x,
        y: pos.y,
        radiusX: 0,
        radiusY: 0,
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

      const origin = dragOriginRef.current;
      if (!origin) return;

      // Bounding-box drag: the ellipse is inscribed in the rectangle spanning
      // the origin and the pointer. The old code put the CENTRE at the origin
      // and used the drag distance as the RADIUS, so the shape grew at twice
      // the speed of the finger and never matched the rectangle tool's feel.
      setNewCircle({
        ...newCircle,
        x: (origin.x + pos.x) / 2,
        y: (origin.y + pos.y) / 2,
        radiusX: Math.abs(pos.x - origin.x) / 2,
        radiusY: Math.abs(pos.y - origin.y) / 2,
      });
    };

    const handleMouseUp = (e) => {
      if (!active || !newCircle) return;
      if (e.evt) {
        e.evt.preventDefault();
      }

      const min = KONVA_THRESHOLDS.MIN_CIRCLE_RADIUS;
      if (newCircle.radiusX >= min && newCircle.radiusY >= min) {
        setCircles((cs) => [...cs, newCircle]);
        if (onAdd) {
          onAdd(newCircle);
        }
      }
      dragOriginRef.current = null;
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

      const min = KONVA_THRESHOLDS.MIN_CIRCLE_RADIUS;
      const prev = radiiOf(previousCircle);

      // Bake each axis independently so side handles squash the shape into an
      // ellipse and corner handles resize it freely. The old handler collapsed
      // both scales into one `Math.max(...)` uniform factor and pinned the
      // centre, so the shape could only ever grow as a circle.
      const newRadiusX = Math.max(min, prev.radiusX * Math.abs(node.scaleX()));
      const newRadiusY = Math.max(min, prev.radiusY * Math.abs(node.scaleY()));
      const rotation = node.rotation();
      const x = node.x();
      const y = node.y();

      node.scaleX(1);
      node.scaleY(1);
      node.getLayer()?.batchDraw();

      const newCircle = {
        ...previousCircle,
        radius: undefined, // superseded by radiusX/radiusY
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation,
        x,
        y,
      };

      setCircles((cs) => cs.map((c) => (c.id === id ? newCircle : c)));

      if (onMove) {
        const hasChanged =
          prev.radiusX !== newRadiusX ||
          prev.radiusY !== newRadiusY ||
          previousCircle.x !== x ||
          previousCircle.y !== y ||
          (previousCircle.rotation || 0) !== rotation;
        if (hasChanged) onMove(id, newCircle, previousCircle);
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
        // Route deletion through history — the Konva arrays are derived from
        // the action log, so a bare local filter is undone by the very next
        // action or undo/redo (the shape reappears).
        if (onDelete) onDelete(id);
        else setCircles((circles) => circles.filter((c) => c.id !== id));
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

    useKonvaSelection({
      stageRef,
      trRef,
      selectedId,
      setSelectedId,
      elements: circles,
      onElementDeselect,
    });

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
            <Ellipse
              key={circle.id}
              id={circle.id}
              x={circle.x}
              y={circle.y}
              {...radiiOf(circle)}
              rotation={circle.rotation || 0}
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
            <Ellipse
              x={newCircle.x}
              y={newCircle.y}
              radiusX={newCircle.radiusX}
              radiusY={newCircle.radiusY}
              stroke={newCircle.stroke}
              strokeWidth={newCircle.strokeWidth}
              dash={newCircle.dash}
              fill={newCircle.fill}
              listening={false}
            />
          )}
          {/* Side anchors squash the ellipse along one axis, corner anchors
              resize both — the WhatsApp behaviour. keepRatio/centeredScaling
              must stay off or the side anchors just scale it uniformly. */}
          <Transformer
            ref={trRef}
            rotateEnabled
            enabledAnchors={[
              "top-left",
              "top-center",
              "top-right",
              "middle-left",
              "middle-right",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ]}
            anchorSize={10}
            borderDash={[4, 4]}
            keepRatio={false}
            centeredScaling={false}
            boundBoxFunc={(oldBox, newBox) => {
              const min = KONVA_THRESHOLDS.MIN_CIRCLE_RADIUS * 2;
              if (newBox.width < min || newBox.height < min) return oldBox;
              return newBox;
            }}
          />
        </Layer>
      </Stage>
    );
  },
);

export default KonvaCircle;
