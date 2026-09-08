import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommentsListDisplay } from "./CommentsListDisplay";

const { createMentionExtensionMock, mentionExtensionStub, editorOptions } =
  vi.hoisted(() => {
    const stub = { name: "mention" };
    return {
      mentionExtensionStub: stub,
      createMentionExtensionMock: vi.fn(() => stub),
      editorOptions: [] as { extensions: unknown[] }[],
    };
  });

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/lib/tiptap/mentionExtension", () => ({
  createMentionExtension: createMentionExtensionMock,
}));

// Capture the options each read-only display editor is created with so the
// suite can assert on the registered extensions without booting ProseMirror.
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual: object = await importOriginal();
  return {
    ...actual,
    useEditor: (options: { extensions: unknown[] }) => {
      editorOptions.push(options);
      return {
        commands: { setContent: () => undefined },
        on: () => undefined,
        off: () => undefined,
        destroy: () => undefined,
      };
    },
    EditorContent: () => <div data-testid="editor-content" />,
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    comment: {
      useFindMany: () => ({
        data: [
          {
            id: "c-1",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "mention", attrs: { id: "u-1", label: "Alice" } },
                  ],
                },
              ],
            },
            createdAt: new Date("2026-05-01T00:00:00Z"),
            creator: { id: "u-1", name: "Alice" },
          },
        ],
        isLoading: false,
      }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

describe("CommentsListDisplay", () => {
  it("registers the mention extension on the read-only comment editor", async () => {
    render(
      <CommentsListDisplay repositoryCaseId={7} projectId={42} count={1} />
    );

    fireEvent.click(screen.getByRole("button", { name: "plural.comment" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("editor-content").length).toBeGreaterThan(0)
    );

    expect(createMentionExtensionMock).toHaveBeenCalledWith(42);
    const lastEditor = editorOptions.at(-1);
    expect(lastEditor?.extensions).toContain(mentionExtensionStub);
  });
});
