import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopyIntoFolderDropTarget } from "./CopyIntoFolderDropTarget";

const dragState = vi.hoisted(() => ({
  isDraggingCase: false,
  canCopyIntoCurrentFolder: false,
}));
const modifierState = vi.hoisted(() => ({ copyHeld: false, moveHeld: false }));
const dropSpecs = vi.hoisted(() => [] as any[]);

vi.mock("react-dnd", () => ({
  useDrop: (factory: () => any) => {
    const spec = factory();
    dropSpecs.push(spec);
    return [spec.collect(), vi.fn()];
  },
}));

vi.mock("~/hooks/useDragTargetKind", () => ({
  useDragTargetKind: () => dragState,
}));

vi.mock("~/hooks/useDragModifier", () => ({
  useDragModifier: () => modifierState,
  isMacPlatform: () => true,
}));

function latestSpec() {
  return dropSpecs.at(-1);
}

beforeEach(() => {
  dragState.isDraggingCase = true;
  dragState.canCopyIntoCurrentFolder = true;
  modifierState.copyHeld = false;
  dropSpecs.length = 0;
});

describe("CopyIntoFolderDropTarget", () => {
  it("renders its children and refuses drops without the copy modifier", () => {
    render(
      <CopyIntoFolderDropTarget onCopy={vi.fn()} testId="target">
        <p>list</p>
      </CopyIntoFolderDropTarget>
    );

    expect(screen.getByText("list")).toBeInTheDocument();
    expect(latestSpec().canDrop()).toBe(false);
  });

  it("accepts a drop only when the copy modifier is held and the list can take a copy", () => {
    modifierState.copyHeld = true;
    const { rerender } = render(
      <CopyIntoFolderDropTarget onCopy={vi.fn()}>
        <p>list</p>
      </CopyIntoFolderDropTarget>
    );
    expect(latestSpec().canDrop()).toBe(true);

    dragState.canCopyIntoCurrentFolder = false;
    rerender(
      <CopyIntoFolderDropTarget onCopy={vi.fn()}>
        <p>list</p>
      </CopyIntoFolderDropTarget>
    );
    expect(latestSpec().canDrop()).toBe(false);
  });

  it("copies every dragged case, falling back to the single dragged row", () => {
    modifierState.copyHeld = true;
    const onCopy = vi.fn();
    render(
      <CopyIntoFolderDropTarget onCopy={onCopy}>
        <p>list</p>
      </CopyIntoFolderDropTarget>
    );
    const monitor = { didDrop: () => false };

    latestSpec().drop({ id: 1, draggedItems: [{ id: 1 }, { id: 2 }] }, monitor);
    expect(onCopy).toHaveBeenLastCalledWith([{ id: 1 }, { id: 2 }]);

    latestSpec().drop({ id: 7 }, monitor);
    expect(onCopy).toHaveBeenLastCalledWith([{ id: 7 }]);
  });

  it("leaves a drop alone once a row has taken it", () => {
    modifierState.copyHeld = true;
    const onCopy = vi.fn();
    render(
      <CopyIntoFolderDropTarget onCopy={onCopy}>
        <p>list</p>
      </CopyIntoFolderDropTarget>
    );

    latestSpec().drop({ id: 1 }, { didDrop: () => true });
    expect(onCopy).not.toHaveBeenCalled();
  });
});
