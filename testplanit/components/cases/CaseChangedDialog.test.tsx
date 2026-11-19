import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CaseChangedDialog,
  hasCaseChangedSinceLoad,
} from "./CaseChangedDialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("hasCaseChangedSinceLoad", () => {
  it("is false when the version is the one the editor loaded", () => {
    expect(hasCaseChangedSinceLoad(5, 5)).toBe(false);
  });

  it("is true when the case has a different version now", () => {
    expect(hasCaseChangedSinceLoad(5, 6)).toBe(true);
  });

  it("is false when either version is unknown", () => {
    expect(hasCaseChangedSinceLoad(null, 6)).toBe(false);
    expect(hasCaseChangedSinceLoad(5, undefined)).toBe(false);
  });
});

describe("CaseChangedDialog", () => {
  const setup = () => {
    const handlers = {
      onReload: vi.fn(),
      onOverwrite: vi.fn(),
      onCancel: vi.fn(),
    };
    render(<CaseChangedDialog open {...handlers} />);
    return handlers;
  };

  it("renders nothing while closed", () => {
    render(
      <CaseChangedDialog
        open={false}
        onReload={vi.fn()}
        onOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByTestId("case-changed-dialog")).toBeNull();
  });

  it("reloads without overwriting", () => {
    const handlers = setup();
    fireEvent.click(screen.getByTestId("case-changed-reload"));
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(handlers.onOverwrite).not.toHaveBeenCalled();
  });

  it("overwrites on the confirm action", () => {
    const handlers = setup();
    fireEvent.click(screen.getByTestId("case-changed-overwrite"));
    expect(handlers.onOverwrite).toHaveBeenCalledTimes(1);
    expect(handlers.onReload).not.toHaveBeenCalled();
  });

  it("cancels back to editing", () => {
    const handlers = setup();
    fireEvent.click(screen.getByTestId("case-changed-cancel"));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });
});
