import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DropZoneOverlay } from "./DropZoneOverlay";

const dragState = { isDraggingCase: false };
const modifierState = { copyHeld: false, moveHeld: false };

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/hooks/useDragTargetKind", () => ({
  useDragTargetKind: () => dragState,
}));

vi.mock("~/hooks/useDragModifier", () => ({
  useDragModifier: () => modifierState,
  isMacPlatform: () => true,
}));

beforeEach(() => {
  dragState.isDraggingCase = false;
  modifierState.copyHeld = false;
  modifierState.moveHeld = false;
});

describe("DropZoneOverlay", () => {
  it("stays out of the way when nothing is being dragged", () => {
    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.queryByTestId("zone")).toBeNull();
    expect(screen.getByText("list")).toBeInTheDocument();
  });

  it("outlines the zone once a case is being dragged", () => {
    dragState.isDraggingCase = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByTestId("zone")).toBeInTheDocument();
    expect(screen.getByText("dropZoneReorder")).toBeInTheDocument();
  });

  it("never intercepts the drop it advertises", () => {
    dragState.isDraggingCase = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByTestId("zone").className).toContain(
      "pointer-events-none"
    );
  });

  it("keeps rendering its children while active", () => {
    dragState.isDraggingCase = true;

    render(
      <DropZoneOverlay kind="tree" testId="zone">
        <p>tree</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("tree")).toBeInTheDocument();
  });

  it("names the keys that choose the action when none is held", () => {
    dragState.isDraggingCase = true;

    render(
      <DropZoneOverlay kind="tree" testId="zone">
        <p>tree</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneTreeMac")).toBeInTheDocument();
  });

  it("names the single action the held modifier will take", () => {
    dragState.isDraggingCase = true;
    modifierState.moveHeld = true;

    const { rerender } = render(
      <DropZoneOverlay kind="tree" testId="zone">
        <p>tree</p>
      </DropZoneOverlay>
    );
    expect(screen.getByText("dropZoneTreeMove")).toBeInTheDocument();

    modifierState.copyHeld = true;
    rerender(
      <DropZoneOverlay kind="tree" testId="zone">
        <p>tree</p>
      </DropZoneOverlay>
    );
    // Copy wins when both are somehow held, matching the drag preview's badge.
    expect(screen.getByText("dropZoneTreeCopy")).toBeInTheDocument();
  });

  it("stays hidden where the zone cannot accept a drop", () => {
    dragState.isDraggingCase = true;

    render(
      <DropZoneOverlay kind="tree" enabled={false} testId="zone">
        <p>not the folder view</p>
      </DropZoneOverlay>
    );

    expect(screen.queryByTestId("zone")).toBeNull();
  });
});
