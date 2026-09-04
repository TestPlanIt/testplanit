import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("prismjs/themes/prism-tomorrow.css", () => ({}));

vi.mock("next-intl", async () => {
  const messages = (await import("../../messages/en-US.json")).default;
  const get = (key: string) =>
    key
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  return {
    useTranslations:
      (namespace?: string) =>
      (key: string, params?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}` : key;
        let msg = get(full);
        if (typeof msg !== "string") return full;
        if (params) {
          for (const [p, v] of Object.entries(params)) {
            msg = msg.split(`{${p}}`).join(String(v));
          }
        }
        return msg;
      },
  };
});

import { CodeViewer, nextSelection, type CodeViewerProps } from "./CodeViewer";

const CODE = "line one\nline two\nline three\nline four\nline five\n";

function renderViewer(props: Partial<CodeViewerProps> = {}) {
  const onSelectionChange = vi.fn();
  const utils = render(
    <CodeViewer
      code={CODE}
      language="plain"
      selection={null}
      onSelectionChange={onSelectionChange}
      {...props}
    />
  );
  return { ...utils, onSelectionChange };
}

function line(n: number) {
  return screen.getByTestId(`code-viewer-line-${n}`);
}

function row(n: number) {
  return line(n).closest("tr") as HTMLTableRowElement;
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("nextSelection", () => {
  it("selects, extends, and clears", () => {
    expect(nextSelection(null, 3, false)).toEqual([3, 3]);
    expect(nextSelection(null, 3, true)).toEqual([3, 3]);
    expect(nextSelection([2, 2], 5, true)).toEqual([2, 5]);
    expect(nextSelection([4, 6], 1, true)).toEqual([1, 6]);
    expect(nextSelection([2, 4], 3, false)).toBeNull();
    expect(nextSelection([2, 4], 5, false)).toEqual([5, 5]);
  });
});

describe("CodeViewer", () => {
  it("renders one row per line with a keyboard-reachable gutter button", () => {
    renderViewer();
    expect(screen.getByTestId("code-viewer")).toHaveClass("max-h-[60vh]");
    for (let n = 1; n <= 5; n++) {
      expect(line(n)).toHaveAttribute("role", "button");
      expect(line(n)).toHaveAttribute("tabindex", "0");
      expect(line(n)).toHaveTextContent(String(n));
    }
    expect(screen.queryByTestId("code-viewer-line-6")).toBeNull();
    expect(row(3).querySelector("code")).toHaveClass("language-plain");
    expect(row(3).querySelector("code")?.textContent).toBe("line three");
  });

  it("selects a single line on click", () => {
    const { onSelectionChange } = renderViewer();
    fireEvent.click(line(2));
    expect(onSelectionChange).toHaveBeenCalledWith([2, 2]);
  });

  it("extends the range on shift-click in either direction", () => {
    const { onSelectionChange, rerender } = renderViewer({ selection: [2, 2] });
    fireEvent.click(line(4), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([2, 4]);

    rerender(
      <CodeViewer
        code={CODE}
        language="plain"
        selection={[3, 3]}
        onSelectionChange={onSelectionChange}
      />
    );
    fireEvent.click(line(1), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 3]);
  });

  it("clears the selection when a line inside the range is clicked", () => {
    const { onSelectionChange } = renderViewer({ selection: [2, 4] });
    fireEvent.click(line(3));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(line(5));
    expect(onSelectionChange).toHaveBeenLastCalledWith([5, 5]);
  });

  it("marks the selected rows", () => {
    renderViewer({ selection: [2, 4] });
    expect(row(1)).toHaveAttribute("aria-selected", "false");
    expect(row(1)).not.toHaveClass("bg-primary/10");
    for (const n of [2, 3, 4]) {
      expect(row(n)).toHaveAttribute("aria-selected", "true");
      expect(row(n)).toHaveClass("bg-primary/10");
    }
    expect(row(5)).toHaveAttribute("aria-selected", "false");
  });

  it("activates on Enter and Space, ignoring other keys", () => {
    const { onSelectionChange } = renderViewer();
    fireEvent.keyDown(line(1), { key: "a" });
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(line(1), { key: "Enter" });
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 1]);

    fireEvent.keyDown(line(2), { key: " " });
    expect(onSelectionChange).toHaveBeenLastCalledWith([2, 2]);
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
  });

  it("extends with shift+Enter", () => {
    const { onSelectionChange } = renderViewer({ selection: [1, 1] });
    fireEvent.keyDown(line(3), { key: "Enter", shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 3]);
  });

  it("shows only a muted message above maxLines", () => {
    const { onSelectionChange } = renderViewer({ maxLines: 4 });
    expect(screen.getByTestId("code-viewer")).toHaveTextContent(
      "This file is too large to display. Enter the line numbers instead."
    );
    expect(screen.getByTestId("code-viewer")).toHaveClass(
      "text-muted-foreground"
    );
    expect(screen.queryByTestId("code-viewer-line-1")).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("scrolls the first selected line into view once on mount", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { onSelectionChange, rerender } = renderViewer({ selection: [3, 4] });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(scrollIntoView.mock.instances[0]).toBe(row(3));

    rerender(
      <CodeViewer
        code={CODE}
        language="plain"
        selection={[5, 5]}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not scroll without a selection and tolerates a missing scrollIntoView", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { unmount } = renderViewer();
    expect(scrollIntoView).not.toHaveBeenCalled();
    unmount();

    Element.prototype.scrollIntoView = undefined as any;
    expect(() => renderViewer({ selection: [2, 2] })).not.toThrow();
  });

  it("renders nothing for empty code", () => {
    renderViewer({ code: "" });
    expect(
      screen.getByTestId("code-viewer").querySelectorAll("tr")
    ).toHaveLength(0);
  });
});
