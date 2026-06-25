import { type Locator, type Page } from "@playwright/test";

/**
 * Native HTML5 drag-and-drop synthesis for react-dnd + HTML5Backend.
 *
 * The repository tree uses react-dnd's HTML5Backend, which listens for native
 * HTML5 drag DOM events (dragstart / dragenter / dragover / drop / dragend) and
 * ignores raw mouse (mousedown/mousemove/mouseup) sequences. Playwright's
 * page.mouse.* API only emits the latter, so a mouse-driven drag never reaches
 * the backend's monitor — isOver/canDrop stay false and the drop callback never
 * fires.
 *
 * This helper dispatches the genuine HTML5 drag event sequence in the browser
 * context, threading a single shared DataTransfer object through every event
 * (the backend stores the dragged item keyed off the dragstart's dataTransfer
 * and reads it back on drop). Modifier keys are set directly on the dispatched
 * dragover/drop events via altKey/ctrlKey/shiftKey — useDragModifier derives
 * copy/move intent from those flags on the dragover event, exactly as it would
 * from a real OS drag with the modifier held.
 */

type Modifier = "Alt" | "Shift" | "Control" | null;

/**
 * Perform a full native HTML5 drag of `source` onto the center of `target`,
 * optionally holding a modifier for the duration of the dragover + drop so the
 * production hook branches to copy (Alt/Control) or move (Shift).
 *
 * For mid-drag assertions (badge swaps) that must hold the drag open before
 * dropping, use {@link startNativeDrag} instead.
 */
export async function nativeDragDrop(
  page: Page,
  source: Locator,
  target: Locator,
  modifier: Modifier = null
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();

  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  if (!sourceHandle || !targetHandle) {
    throw new Error("nativeDragDrop: source or target element not found");
  }

  const flush = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

  try {
    // Phase 1: dragstart + dragenter + dragover. HTML5Backend captures the
    // dragged item on dragstart and SCHEDULES the hover (isOver/canDrop) on a
    // requestAnimationFrame from dragover, and useDragModifier sets copyHeld /
    // moveHeld React state from the dragover modifier flags. Both need a frame
    // + React commit before the drop, otherwise the drop callback sees
    // canDrop=false (early-return → no popover) or a stale modifier closure.
    await page.evaluate(
      ([src, tgt, mod]) => {
        const sourceEl = src as HTMLElement;
        const targetEl = tgt as HTMLElement;
        const modifierKey = mod as Modifier;

        const dataTransfer = new DataTransfer();
        const rect = targetEl.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const fire = (el: Element, type: string, withMod: boolean): void => {
          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX,
            clientY,
            altKey: withMod && modifierKey === "Alt",
            ctrlKey: withMod && modifierKey === "Control",
            shiftKey: withMod && modifierKey === "Shift",
          });
          // DragEvent's dataTransfer is read-only via the constructor in some
          // engines, so assign it explicitly to guarantee the backend sees the
          // same instance across the whole sequence.
          Object.defineProperty(event, "dataTransfer", {
            value: dataTransfer,
            configurable: true,
          });
          el.dispatchEvent(event);
        };

        const win = window as unknown as {
          __tpiDragFinish?: () => void;
        };

        fire(sourceEl, "dragstart", false);
        fire(targetEl, "dragenter", true);
        fire(targetEl, "dragover", true);
        fire(targetEl, "dragover", true);

        // Stash the drop completion so phase 2 reuses the same dataTransfer +
        // coordinates after the inter-phase frame flush.
        win.__tpiDragFinish = () => {
          fire(targetEl, "dragover", true);
          fire(targetEl, "drop", true);
          fire(sourceEl, "dragend", false);
          delete win.__tpiDragFinish;
        };
      },
      [sourceHandle, targetHandle, modifier] as const
    );

    // Let the scheduled hover fire and React commit copyHeld/moveHeld + isOver.
    await flush();

    // Phase 2: drop + dragend (reuses the captured dataTransfer/coords).
    await page.evaluate(() => {
      const win = window as unknown as { __tpiDragFinish?: () => void };
      win.__tpiDragFinish?.();
    });
  } finally {
    await sourceHandle.dispose();
    await targetHandle.dispose();
  }

  // Let React flush the state update triggered by the drop callback
  // (setPendingDrop) before the caller asserts.
  await flush();
}

/**
 * Begin a native drag and leave it hovering over the target (no drop). Returns a
 * function that completes the drag by dispatching drop + dragend with the given
 * modifier, and a function that abandons it with a bare dragend off-target.
 *
 * Used by the mid-drag badge-swap tests that need to toggle modifiers and assert
 * the live preview before resolving the drag.
 */
export async function startNativeDrag(
  page: Page,
  source: Locator,
  target: Locator
): Promise<{
  setModifier: (modifier: Modifier) => Promise<void>;
  drop: (modifier: Modifier) => Promise<void>;
  abandon: () => Promise<void>;
}> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  if (!sourceHandle || !targetHandle) {
    throw new Error("startNativeDrag: source or target element not found");
  }

  // Install a per-drag DataTransfer + dispatch helpers on window so subsequent
  // setModifier/drop/abandon calls reuse the same drag context.
  await page.evaluate(
    ([src, tgt]) => {
      const sourceEl = src as HTMLElement;
      const targetEl = tgt as HTMLElement;
      const dataTransfer = new DataTransfer();
      const rect = targetEl.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const win = window as unknown as {
        __tpiDrag?: {
          fire: (el: Element, type: string, mod: string | null) => void;
          sourceEl: HTMLElement;
          targetEl: HTMLElement;
        };
      };

      const fire = (el: Element, type: string, mod: string | null): void => {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          altKey: mod === "Alt",
          ctrlKey: mod === "Control",
          shiftKey: mod === "Shift",
        });
        Object.defineProperty(event, "dataTransfer", {
          value: dataTransfer,
          configurable: true,
        });
        el.dispatchEvent(event);
      };

      win.__tpiDrag = { fire, sourceEl, targetEl };
      fire(sourceEl, "dragstart", null);
      fire(targetEl, "dragenter", null);
      fire(targetEl, "dragover", null);
    },
    [sourceHandle, targetHandle] as const
  );

  const flush = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

  const setModifier = async (modifier: Modifier): Promise<void> => {
    await page.evaluate((mod) => {
      const win = window as unknown as {
        __tpiDrag?: {
          fire: (el: Element, type: string, mod: string | null) => void;
          targetEl: HTMLElement;
        };
      };
      if (!win.__tpiDrag) return;
      win.__tpiDrag.fire(win.__tpiDrag.targetEl, "dragover", mod);
      win.__tpiDrag.fire(win.__tpiDrag.targetEl, "dragover", mod);
    }, modifier);
    await flush();
  };

  const drop = async (modifier: Modifier): Promise<void> => {
    await page.evaluate((mod) => {
      const win = window as unknown as {
        __tpiDrag?: {
          fire: (el: Element, type: string, mod: string | null) => void;
          sourceEl: HTMLElement;
          targetEl: HTMLElement;
        };
      };
      if (!win.__tpiDrag) return;
      win.__tpiDrag.fire(win.__tpiDrag.targetEl, "dragover", mod);
      win.__tpiDrag.fire(win.__tpiDrag.targetEl, "drop", mod);
      win.__tpiDrag.fire(win.__tpiDrag.sourceEl, "dragend", null);
      delete win.__tpiDrag;
    }, modifier);
    await flush();
    await sourceHandle.dispose();
    await targetHandle.dispose();
  };

  const abandon = async (): Promise<void> => {
    await page.evaluate(() => {
      const win = window as unknown as {
        __tpiDrag?: {
          fire: (el: Element, type: string, mod: string | null) => void;
          sourceEl: HTMLElement;
        };
      };
      if (!win.__tpiDrag) return;
      // dragend without a preceding drop on a valid target → react-dnd treats
      // it as a cancelled drag, no drop callback fires.
      win.__tpiDrag.fire(win.__tpiDrag.sourceEl, "dragend", null);
      delete win.__tpiDrag;
    });
    await flush();
    await sourceHandle.dispose();
    await targetHandle.dispose();
  };

  return { setModifier, drop, abandon };
}
