"use client";

import { useEffect, useState } from "react";

export interface DragModifierState {
  copyHeld: boolean;
  moveHeld: boolean;
}

/**
 * Tracks modifier-key state during an HTML5 drag operation.
 *
 * Browsers suppress window keydown/keyup delivery during native HTML5
 * drag, so this hook derives modifier state from the dragover event,
 * which DOES fire continuously during drag and inherits altKey,
 * shiftKey, ctrlKey, and metaKey from MouseEvent.
 *
 * Pass the parent's `isDragging` boolean as the gate. The hook clears
 * its state and detaches the listener when isDragging flips to false.
 */
export function useDragModifier(isDragging: boolean): DragModifierState {
  const [copyHeld, setCopyHeld] = useState(false);
  const [moveHeld, setMoveHeld] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      setCopyHeld(false);
      setMoveHeld(false);
      return;
    }

    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);

    const handleDragOver = (e: DragEvent) => {
      const copy = isMac ? e.altKey : e.ctrlKey;
      const move = e.shiftKey;
      setCopyHeld((prev) => (prev === copy ? prev : copy));
      setMoveHeld((prev) => (prev === move ? prev : move));
    };

    window.addEventListener("dragover", handleDragOver);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
    };
  }, [isDragging]);

  return { copyHeld, moveHeld };
}
