import { render, screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (_namespace?: string) => (
    key: string,
    params?: Record<string, unknown>
  ) => {
    const dict: Record<string, string> = {
      editorUndeclaredWarning:
        "Undeclared references: {names}. Add them via Configure parameters to enable iteration substitution.",
    };
    let value = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

import { UndeclaredParameterWarning } from "@/components/tiptap/UndeclaredParameterWarning";

const buildDoc = (mentionLabels: string[]): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: mentionLabels.map((label) => ({
        type: "parameterMention",
        attrs: { id: label, label },
      })),
    },
  ],
});

describe("UndeclaredParameterWarning", () => {
  it("renders nothing when editorJson is null", () => {
    const { container } = render(
      <UndeclaredParameterWarning editorJson={null} declaredNames={["foo"]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when every mention is declared", () => {
    const doc = buildDoc(["username", "amount"]);
    const { container } = render(
      <UndeclaredParameterWarning
        editorJson={doc}
        declaredNames={["username", "amount"]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there are no parameterMention nodes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "plain text only" }],
        },
      ],
    };
    const { container } = render(
      <UndeclaredParameterWarning
        editorJson={doc}
        declaredNames={["username"]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the warning ribbon listing only undeclared @names", () => {
    const doc = buildDoc(["username", "foo", "bar"]);
    render(
      <UndeclaredParameterWarning
        editorJson={doc}
        declaredNames={["username"]}
      />
    );
    const ribbon = screen.getByTestId("tiptap-undeclared-parameter-warning");
    expect(ribbon).toBeInTheDocument();
    expect(ribbon.textContent).toContain("@foo");
    expect(ribbon.textContent).toContain("@bar");
    expect(ribbon.textContent).not.toContain("@username");
  });

  it("walks nested content arrays and de-duplicates labels", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "parameterMention", attrs: { id: "foo", label: "foo" } },
            { type: "parameterMention", attrs: { id: "foo", label: "foo" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "parameterMention", attrs: { id: "bar", label: "bar" } },
          ],
        },
      ],
    };
    render(
      <UndeclaredParameterWarning editorJson={doc} declaredNames={[]} />
    );
    const ribbon = screen.getByTestId("tiptap-undeclared-parameter-warning");
    // Both labels appear, but @foo only once (deduped).
    const fooMatches = (ribbon.textContent?.match(/@foo/g) ?? []).length;
    expect(fooMatches).toBe(1);
    expect(ribbon.textContent).toContain("@bar");
  });
});
