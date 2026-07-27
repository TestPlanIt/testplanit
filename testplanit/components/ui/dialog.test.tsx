import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key.split(".").pop() ?? key),
}));

function renderDialog(contentProps: Record<string, unknown> = {}) {
  return render(
    <Dialog open>
      <DialogContent {...contentProps}>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
        body
      </DialogContent>
    </Dialog>
  );
}

function clickFullScreenToggle() {
  fireEvent.click(screen.getByText("toggleFullScreen"));
}

describe("DialogContent full-screen toggle", () => {
  it("uncontrolled: toggling flips between default and full-screen classes", () => {
    renderDialog();
    const content = screen.getByRole("dialog");

    expect(content.className).toContain("max-w-lg");
    expect(content.className).not.toContain("h-screen");

    clickFullScreenToggle();
    expect(content.className).toContain("h-screen");

    clickFullScreenToggle();
    expect(content.className).not.toContain("h-screen");
  });

  it("controlled: reports toggles via onFullScreenChange without changing itself", () => {
    const onFullScreenChange = vi.fn();
    renderDialog({ fullScreen: false, onFullScreenChange });

    clickFullScreenToggle();

    expect(onFullScreenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("dialog").className).not.toContain("h-screen");
  });

  it("controlled: renders full-screen when the fullScreen prop is true", () => {
    const onFullScreenChange = vi.fn();
    renderDialog({ fullScreen: true, onFullScreenChange });

    expect(screen.getByRole("dialog").className).toContain("h-screen");

    clickFullScreenToggle();
    expect(onFullScreenChange).toHaveBeenCalledWith(false);
  });
});
