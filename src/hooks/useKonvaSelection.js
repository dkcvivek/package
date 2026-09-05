import { useEffect, useRef } from "react";

/**
 * Keeps a Konva `<Transformer>` in step with the selected element.
 *
 * Every shape layer owns a local `selectedId`, but the element arrays
 * themselves are DERIVED from the history log (see `useHistoryManager`). So an
 * element can vanish underneath the layer at any time — undo, redo, drag to
 * trash, flatten — without the layer being told.
 *
 * When that happened the old per-component code did:
 *
 *     const node = stage.findOne(`#${selectedId}`)
 *     if (node) tr.nodes([node])      // ← no else branch
 *
 * so the Transformer kept holding a node React had already destroyed. Two
 * things went wrong:
 *
 *   1. The resize/rotate handles stayed on screen after the shape disappeared.
 *   2. Worse, the next `batchDraw()` made the Transformer measure a detached
 *      node and throw *inside Konva's draw loop*, which takes the whole Layer
 *      down with it — that is why the arrow tool went dead after an undo.
 *
 * Centralising it here so the five shape layers can't drift apart again.
 *
 * @param {object}   params
 * @param {React.RefObject} params.stageRef
 * @param {React.RefObject} params.trRef
 * @param {string|null}     params.selectedId
 * @param {(id: string|null) => void} params.setSelectedId
 * @param {Array<{id: string}>}       params.elements - the derived element array
 * @param {() => void}      [params.onElementDeselect]
 */
export function useKonvaSelection({
  stageRef,
  trRef,
  selectedId,
  setSelectedId,
  elements,
  onElementDeselect,
}) {
  // Ids we have actually seen committed to the element array.
  //
  // This distinction matters: while a shape is being dragged out it is selected
  // but lives in the layer's own `newRect`/`newCircle`/`newArrow` state, not in
  // `elements` yet. Clearing the selection on "not in elements" alone therefore
  // deselected every shape the instant you started drawing it, and the resize /
  // rotate handles never appeared at all. Only an id that was once present and
  // has since gone (undo, delete, flatten) should clear the selection.
  const seenIdsRef = useRef(new Set());
  useEffect(() => {
    elements?.forEach((el) => el?.id && seenIdsRef.current.add(el.id));
  }, [elements]);

  // 1. Drop a selection whose element existed and has now been removed.
  useEffect(() => {
    if (!selectedId) return;
    if (!seenIdsRef.current.has(selectedId)) return; // still being created
    const stillExists = elements?.some((el) => el?.id === selectedId);
    if (stillExists) return;
    setSelectedId(null);
    onElementDeselect?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedId]);

  // 2. Attach the transformer to the selected node, detach it otherwise.
  //    Runs after commit, so a node removed this render is already gone from
  //    the stage and `findOne` correctly returns null.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      selectedId && stageRef.current
        ? stageRef.current.findOne(`#${selectedId}`)
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, elements, stageRef, trRef]);
}
