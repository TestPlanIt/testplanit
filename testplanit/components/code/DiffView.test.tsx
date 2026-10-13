import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import { DiffView, parseDiffLines } from "./DiffView";

const PATCH = [
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a, b };",
  "@@ -10,2 +11,2 @@ function foo()",
  " foo();",
  "-bar();",
  "+baz();",
  "\\ No newline at end of file",
].join("\n");

function bodyRows(type?: string) {
  const view = screen.getByTestId("diff-view");
  const selector = type ? `tbody tr[data-line-type="${type}"]` : "tbody tr";
  return Array.from(view.querySelectorAll<HTMLTableRowElement>(selector));
}

function gutter(row: HTMLTableRowElement): [string, string] {
  const cells = row.querySelectorAll("td");
  return [cells[0].textContent ?? "", cells[1].textContent ?? ""];
}

describe("parseDiffLines", () => {
  it("tolerates CRLF and a trailing newline", () => {
    const lines = parseDiffLines("@@ -1 +1 @@\r\n-a\r\n+b\r\n");
    expect(lines.map((l) => l.type)).toEqual(["meta", "del", "add"]);
    expect(lines[1].text).toBe("a");
    expect(lines[2].text).toBe("b");
  });

  it("returns nothing for an empty or hunk-less patch", () => {
    expect(parseDiffLines("")).toEqual([]);
    expect(parseDiffLines("diff --git a/x b/x\n--- a/x\n+++ b/x\n")).toEqual(
      []
    );
  });
});

describe("DiffView", () => {
  it("classifies rows and tracks old/new line numbers across two hunks", () => {
    render(<DiffView patch={PATCH} language="typescript" />);

    expect(bodyRows("meta")).toHaveLength(3);
    expect(bodyRows("add")).toHaveLength(3);
    expect(bodyRows("del")).toHaveLength(2);
    expect(bodyRows("ctx")).toHaveLength(3);

    const rows = bodyRows();
    expect(rows[0].textContent).toContain("@@ -1,3 +1,4 @@");
    expect(gutter(rows[0])).toEqual(["", ""]);
    expect(gutter(rows[1])).toEqual(["1", "1"]);
    expect(gutter(rows[2])).toEqual(["2", ""]);
    expect(gutter(rows[3])).toEqual(["", "2"]);
    expect(gutter(rows[4])).toEqual(["", "3"]);
    expect(gutter(rows[5])).toEqual(["3", "4"]);
    expect(rows[6].textContent).toContain("@@ -10,2 +11,2 @@ function foo()");
    expect(gutter(rows[7])).toEqual(["10", "11"]);
    expect(gutter(rows[8])).toEqual(["11", ""]);
    expect(gutter(rows[9])).toEqual(["", "12"]);
    expect(rows[10].textContent).toContain("No newline at end of file");

    expect(rows[3].querySelector("code")).toHaveClass("language-typescript");
    expect(rows[3].querySelector("code")?.textContent).toBe("const b = 3;");
    expect(rows[3].querySelector("code .token")).not.toBeNull();
  });

  it("labels gutters and changed rows for assistive tech", () => {
    render(<DiffView patch={PATCH} />);
    const rows = bodyRows();
    expect(screen.getAllByLabelText("Old line")).toHaveLength(rows.length);
    expect(screen.getAllByLabelText("New line")).toHaveLength(rows.length);
    expect(within(bodyRows("add")[0]).getByText("Added line")).toHaveClass(
      "sr-only"
    );
    expect(within(bodyRows("del")[0]).getByText("Removed line")).toHaveClass(
      "sr-only"
    );
    expect(within(bodyRows("ctx")[0]).queryByText("Added line")).toBeNull();
  });

  it("skips file headers and never mistakes them for changes", () => {
    const patch = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index 1111111..2222222 100644",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(<DiffView patch={patch} />);
    expect(bodyRows("meta")).toHaveLength(1);
    expect(bodyRows("del")).toHaveLength(1);
    expect(bodyRows("add")).toHaveLength(1);
    expect(bodyRows()).toHaveLength(3);
  });

  it("truncates to maxLines and expands the full patch on demand", () => {
    render(<DiffView patch={PATCH} maxLines={3} />);
    expect(bodyRows()).toHaveLength(3);
    const button = screen.getByTestId("diff-view-expand");
    expect(button).toHaveTextContent("Show full patch");

    fireEvent.click(button);

    expect(bodyRows()).toHaveLength(11);
    expect(screen.queryByTestId("diff-view-expand")).toBeNull();
  });

  it("does not offer expansion when the patch fits", () => {
    render(<DiffView patch={PATCH} maxLines={11} />);
    expect(bodyRows()).toHaveLength(11);
    expect(screen.queryByTestId("diff-view-expand")).toBeNull();
  });

  it("renders an empty table for an empty or hunk-less patch", () => {
    const { rerender } = render(<DiffView patch="" />);
    expect(
      screen.getByTestId("diff-view").querySelector("table")
    ).not.toBeNull();
    expect(bodyRows()).toHaveLength(0);

    rerender(<DiffView patch="Binary files a/x and b/x differ" />);
    expect(bodyRows()).toHaveLength(0);
  });

  it("escapes HTML in code instead of injecting it", () => {
    const { container } = render(
      <DiffView patch={"@@ -1 +1 @@\n+<script>alert(1)</script>"} />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(bodyRows("add")[0].querySelector("code")?.textContent).toBe(
      "<script>alert(1)</script>"
    );
  });

  it("merges className onto the container", () => {
    render(<DiffView patch={PATCH} className="mt-4" />);
    expect(screen.getByTestId("diff-view")).toHaveClass("bg-stone-800", "mt-4");
  });
});
