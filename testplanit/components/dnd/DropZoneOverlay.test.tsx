import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DropZoneOverlay } from "./DropZoneOverlay";

const dragState: {
  isDraggingCase: boolean;
  reorderBlockedReason: "sort" | "search" | null;
  canCopyIntoCurrentFolder: boolean;
} = {
  isDraggingCase: false,
  reorderBlockedReason: null,
  canCopyIntoCurrentFolder: false,
};
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
  dragState.reorderBlockedReason = null;
  dragState.canCopyIntoCurrentFolder = false;
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

  it("says to remove the sort when the sorted list refuses reorder drops", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "sort";

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneReorderBlockedSort")).toBeInTheDocument();
    expect(screen.queryByText("dropZoneReorder")).toBeNull();
    expect(screen.getByTestId("zone")).toHaveAttribute("data-blocked", "true");
  });

  it("says to clear the search when relevance order refuses reorder drops", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "search";

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(
      screen.getByText("dropZoneReorderBlockedSearch")
    ).toBeInTheDocument();
  });

  it("names the copy key beside the blocked reorder when a copy is possible", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "sort";
    dragState.canCopyIntoCurrentFolder = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(
      screen.getByText("dropZoneReorderBlockedSortMac")
    ).toBeInTheDocument();
    expect(screen.getByTestId("zone")).toHaveAttribute("data-blocked", "true");
  });

  it("turns into a copy target once the copy modifier is held, even while sorted", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "sort";
    dragState.canCopyIntoCurrentFolder = true;
    modifierState.copyHeld = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneCopyHere")).toBeInTheDocument();
    expect(screen.getByTestId("zone")).not.toHaveAttribute("data-blocked");
  });

  it("offers the copy over the reorder when the modifier is held in default order", () => {
    dragState.isDraggingCase = true;
    dragState.canCopyIntoCurrentFolder = true;
    modifierState.copyHeld = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneCopyHere")).toBeInTheDocument();
  });

  it("ignores the copy modifier where the list cannot take a copy", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "sort";
    modifierState.copyHeld = true;

    render(
      <DropZoneOverlay kind="reorder" testId="zone">
        <p>list</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneReorderBlockedSort")).toBeInTheDocument();
  });

  it("keeps the tree zone inviting a drop while the list refuses reorders", () => {
    dragState.isDraggingCase = true;
    dragState.reorderBlockedReason = "sort";

    render(
      <DropZoneOverlay kind="tree" testId="zone">
        <p>tree</p>
      </DropZoneOverlay>
    );

    expect(screen.getByText("dropZoneTreeMac")).toBeInTheDocument();
    expect(screen.getByTestId("zone")).not.toHaveAttribute("data-blocked");
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
