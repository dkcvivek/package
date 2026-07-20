export function getDashPattern(strokeStyle, brushSize) {
  switch (strokeStyle) {
    case "dashed": return [brushSize * 3, brushSize * 2];
    case "dotted": return [brushSize, brushSize];
    default:       return [];
  }
}