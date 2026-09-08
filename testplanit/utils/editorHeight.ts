import type { CSSProperties } from "react";

/**
 * Height style for a Text Long / RichText field editor.
 *
 * These editors size to their content and grow as the user types. A field's
 * configured `initialHeight` raises the floor, so the editor opens taller than
 * its content and never shrinks below that height.
 */
export function editorMinHeightStyle(
  initialHeight?: number | null
): CSSProperties | undefined {
  return typeof initialHeight === "number" && initialHeight > 0
    ? { minHeight: `${initialHeight}px` }
    : undefined;
}
