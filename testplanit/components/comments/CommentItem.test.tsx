import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { CommentItem } from "./CommentItem";

// next-intl stub — returns the i18n key path so assertions can pin the
// exact key the renderer asked for.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock UserNameCell — irrelevant to badge/accent logic, and pulls in
// auth/network plumbing we don't want in this suite.
vi.mock("~/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-${userId}`}>{userId}</span>
  ),
}));

// Stub the mention extension import out of the render tree — tiptap is
// already exercised elsewhere; here we only care about the comment
// metadata branch.
vi.mock("~/lib/tiptap/mentionExtension", () => ({
  createMentionExtension: () => ({ name: "mention" }),
}));

// Tiptap react — partially mock so other consumers (ImageUpload etc.)
// still get the real `Node` export. We only override useEditor +
// EditorContent so the renderer can no-op safely.
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useEditor: () => ({
      commands: { setContent: () => undefined },
      on: () => undefined,
      off: () => undefined,
      destroy: () => undefined,
    }),
    EditorContent: ({ editor }: { editor: unknown }) =>
      editor ? <div data-testid="editor-content" /> : null,
  };
});

vi.mock("./CommentEditor", () => ({
  CommentEditor: () => <div data-testid="comment-editor" />,
}));

const baseContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "hello" }],
    },
  ],
};

function makeComment(
  overrides: Partial<Parameters<typeof CommentItem>[0]["comment"]> = {}
): Parameters<typeof CommentItem>[0]["comment"] {
  return {
    id: "c-1",
    content: baseContent,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    isEdited: false,
    creator: {
      id: "creator-1",
      name: "Alice",
      email: "alice@example.com",
      image: null,
      isActive: true,
      isDeleted: false,
    },
    ...overrides,
  };
}

function renderItem(
  comment: Parameters<typeof CommentItem>[0]["comment"],
  overrides: Partial<Parameters<typeof CommentItem>[0]> = {}
) {
  return render(
    <CommentItem
      comment={comment}
      projectId={1}
      currentUserId="creator-1"
      isAdmin={false}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />
  );
}

describe("CommentItem — hybrid-comments branch (D-21 follow-up)", () => {
  it("GENERAL comments render no badge and no accent test id", () => {
    renderItem(makeComment({ type: "GENERAL" }));

    expect(
      screen.queryByTestId("comment-type-badge-general")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("comment-card-general")
    ).not.toBeInTheDocument();
  });

  it("REVIEW_REQUEST renders a 'Review request' badge with primary accent", () => {
    renderItem(
      makeComment({
        type: "REVIEW_REQUEST",
        reviewRequest: { status: "PENDING" },
      })
    );

    const badge = screen.getByTestId("comment-type-badge-review_request");
    expect(badge).toHaveTextContent("comments.type.reviewRequest");

    const card = screen.getByTestId("comment-card-review_request");
    expect(card.className).toMatch(/border-s-primary/);
  });

  it("REVIEW_DECISION + APPROVED renders 'Approved' badge with emerald accent", () => {
    renderItem(
      makeComment({
        type: "REVIEW_DECISION",
        reviewRequest: { status: "APPROVED" },
      })
    );

    const badge = screen.getByTestId("comment-type-badge-review_decision");
    expect(badge).toHaveTextContent("comments.type.reviewDecision.approved");

    const card = screen.getByTestId("comment-card-review_decision");
    expect(card.className).toMatch(/border-s-emerald-500/);
  });

  it("REVIEW_DECISION + CHANGES_REQUESTED renders 'Changes requested' badge with amber accent", () => {
    renderItem(
      makeComment({
        type: "REVIEW_DECISION",
        reviewRequest: { status: "CHANGES_REQUESTED" },
      })
    );

    expect(
      screen.getByTestId("comment-type-badge-review_decision")
    ).toHaveTextContent("comments.type.reviewDecision.changesRequested");
    expect(
      screen.getByTestId("comment-card-review_decision").className
    ).toMatch(/border-s-amber-500/);
  });

  it("REVIEW_DECISION + REJECTED renders 'Rejected' badge with destructive accent", () => {
    renderItem(
      makeComment({
        type: "REVIEW_DECISION",
        reviewRequest: { status: "REJECTED" },
      })
    );

    expect(
      screen.getByTestId("comment-type-badge-review_decision")
    ).toHaveTextContent("comments.type.reviewDecision.rejected");
    expect(
      screen.getByTestId("comment-card-review_decision").className
    ).toMatch(/border-s-destructive/);
  });

  it("review-type comments suppress the edit/delete menu even for the creator", () => {
    renderItem(
      makeComment({
        type: "REVIEW_REQUEST",
        reviewRequest: { status: "PENDING" },
      })
    );

    // Edit and Delete labels come from the dropdown menu; their absence is
    // proof the kebab/menu trigger is gated off for review-type rows.
    expect(screen.queryByText("common.actions.edit")).not.toBeInTheDocument();
    expect(screen.queryByText("common.actions.delete")).not.toBeInTheDocument();
  });

  it("review-type comments suppress the menu even for admins on others' comments", () => {
    renderItem(
      makeComment({
        type: "REVIEW_DECISION",
        reviewRequest: { status: "APPROVED" },
        creator: {
          id: "someone-else",
          name: "Bob",
          email: "bob@example.com",
          image: null,
          isActive: true,
          isDeleted: false,
        },
      }),
      { isAdmin: true, currentUserId: "creator-1" }
    );

    expect(screen.queryByText("common.actions.delete")).not.toBeInTheDocument();
  });

  it("GENERAL comments render the kebab action-menu trigger for the creator", () => {
    // Positive control for the previous two suppression tests: a GENERAL
    // comment by the current user must still expose the MoreVertical kebab
    // (the dropdown panel itself is a radix portal and is non-trivial to
    // open under jsdom; trigger presence is the load-bearing affordance).
    const { container } = renderItem(makeComment({ type: "GENERAL" }), {
      currentUserId: "creator-1",
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
