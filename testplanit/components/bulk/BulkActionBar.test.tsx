import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SquarePen } from "lucide-react";

import { BulkActionBar } from "./BulkActionBar";

// Mock next-intl — keys render as-is so assertions target key names.
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

describe("BulkActionBar", () => {
  const editAction = {
    key: "edit",
    icon: SquarePen,
    label: "Edit (2)",
    onClick: vi.fn(),
    testId: "testrun-bulk-edit",
  };
  const baseProps = {
    onClearSelection: vi.fn(),
    actions: [editAction],
    testIdPrefix: "testrun",
  };

  it("renders nothing when no items are selected", () => {
    render(<BulkActionBar {...baseProps} selectedCount={0} />);
    expect(screen.queryByTestId("testrun-bulk-bar")).not.toBeInTheDocument();
  });

  it("shows the actions and clear button when items are selected", () => {
    render(<BulkActionBar {...baseProps} selectedCount={2} />);
    expect(screen.getByTestId("testrun-bulk-bar")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-edit")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-clear")).toBeInTheDocument();
  });

  it("invokes an action's onClick", () => {
    const onClick = vi.fn();
    render(
      <BulkActionBar
        {...baseProps}
        selectedCount={2}
        actions={[{ ...editAction, onClick }]}
      />
    );
    fireEvent.click(screen.getByTestId("testrun-bulk-edit"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("never renders actions marked hidden (permission gate)", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedCount={2}
        actions={[
          editAction,
          {
            ...editAction,
            key: "delete",
            label: "Delete (2)",
            hidden: true,
            testId: "testrun-bulk-delete",
          },
        ]}
      />
    );
    expect(screen.getByTestId("testrun-bulk-edit")).toBeInTheDocument();
    expect(screen.queryByTestId("testrun-bulk-delete")).not.toBeInTheDocument();
  });

  it("renders ineligible actions as disabled", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedCount={2}
        actions={[{ ...editAction, disabled: true }]}
      />
    );
    expect(screen.getByTestId("testrun-bulk-edit")).toBeDisabled();
  });

  it("wires the clear button", () => {
    const onClearSelection = vi.fn();
    render(
      <BulkActionBar
        {...baseProps}
        selectedCount={2}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByTestId("testrun-bulk-clear"));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});
