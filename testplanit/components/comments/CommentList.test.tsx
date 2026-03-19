import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommentList } from "./CommentList";

// Mock server actions
vi.mock("~/app/actions/comments", () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  updateComment: vi.fn(),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key.split(".").pop() ?? key),
}));

// Mock CommentEditor
vi.mock("./CommentEditor", () => ({
  CommentEditor: ({ onSubmit, isLoading, submitLabel }: any) => (
    <div data-testid="comment-editor">
      <button
        data-testid="editor-submit"
        onClick={() =>
          onSubmit({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "New comment" }] }],
          })
        }
        disabled={isLoading}
      >
        {submitLabel || "Submit"}
      </button>
    </div>
  ),
}));

// Mock CommentItem
vi.mock("./CommentItem", () => ({
  CommentItem: ({ comment, currentUserId, isAdmin, onDelete }: any) => {
    const isCreator = comment.creator.id === currentUserId;
    const canEdit = isCreator;
    const canDelete = isCreator || isAdmin;
    return (
      <div data-testid={`comment-item-${comment.id}`}>
        <span data-testid={`comment-content-${comment.id}`}>
          {comment.content?.content?.[0]?.content?.[0]?.text || ""}
        </span>
        {canEdit && (
          <button data-testid={`edit-btn-${comment.id}`}>Edit</button>
        )}
        {canDelete && (
          <button
            data-testid={`delete-btn-${comment.id}`}
            onClick={() => onDelete(comment.id)}
          >
            Delete
          </button>
        )}
      </div>
    );
  },
}));

// Mock Separator
vi.mock("~/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

// Helper to create a mock comment
const makeMockComment = (id: string, creatorId: string, creatorName: string) => ({
  id,
  content: {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text: `Comment by ${creatorName}` }] }],
  },
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  isEdited: false,
  creator: {
    id: creatorId,
    name: creatorName,
    email: `${creatorName.toLowerCase()}@example.com`,
    image: null,
    isActive: true,
    isDeleted: false,
  },
});

describe("CommentList", () => {
  const defaultProps = {
    projectId: 1,
    entityType: "repositoryCase" as const,
    entityId: 42,
    initialComments: [],
    currentUserId: "user-1",
    isAdmin: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state with message icon and text when no comments", () => {
    render(<CommentList {...defaultProps} initialComments={[]} />);
    expect(screen.getByText("noComments")).toBeInTheDocument();
  });

  it("renders the comment editor for adding new comments", () => {
    render(<CommentList {...defaultProps} />);
    expect(screen.getByTestId("comment-editor")).toBeInTheDocument();
  });

  it("renders all comments from initialComments", () => {
    const comments = [
      makeMockComment("c1", "user-1", "Alice"),
      makeMockComment("c2", "user-2", "Bob"),
    ];
    render(<CommentList {...defaultProps} initialComments={comments} />);
    expect(screen.getByTestId("comment-item-c1")).toBeInTheDocument();
    expect(screen.getByTestId("comment-item-c2")).toBeInTheDocument();
  });

  it("shows comment count in header", () => {
    const comments = [makeMockComment("c1", "user-1", "Alice")];
    render(<CommentList {...defaultProps} initialComments={comments} />);
    // The h3 contains the title + count as sibling text nodes, so check the element
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("(1)");
  });

  it("shows edit button for current user's comments", () => {
    const comments = [makeMockComment("c1", "user-1", "Alice")];
    render(
      <CommentList {...defaultProps} initialComments={comments} currentUserId="user-1" />
    );
    expect(screen.getByTestId("edit-btn-c1")).toBeInTheDocument();
  });

  it("does not show edit button for other users' comments", () => {
    const comments = [makeMockComment("c1", "user-2", "Bob")];
    render(
      <CommentList {...defaultProps} initialComments={comments} currentUserId="user-1" />
    );
    expect(screen.queryByTestId("edit-btn-c1")).not.toBeInTheDocument();
  });

  it("shows delete button for current user's own comments", () => {
    const comments = [makeMockComment("c1", "user-1", "Alice")];
    render(
      <CommentList
        {...defaultProps}
        initialComments={comments}
        currentUserId="user-1"
        isAdmin={false}
      />
    );
    expect(screen.getByTestId("delete-btn-c1")).toBeInTheDocument();
  });

  it("hides delete button for other users' comments when not admin", () => {
    const comments = [makeMockComment("c1", "user-2", "Bob")];
    render(
      <CommentList
        {...defaultProps}
        initialComments={comments}
        currentUserId="user-1"
        isAdmin={false}
      />
    );
    expect(screen.queryByTestId("delete-btn-c1")).not.toBeInTheDocument();
  });

  it("shows delete button on all comments when user is admin", () => {
    const comments = [
      makeMockComment("c1", "user-2", "Bob"),
      makeMockComment("c2", "user-3", "Carol"),
    ];
    render(
      <CommentList
        {...defaultProps}
        initialComments={comments}
        currentUserId="user-1"
        isAdmin={true}
      />
    );
    expect(screen.getByTestId("delete-btn-c1")).toBeInTheDocument();
    expect(screen.getByTestId("delete-btn-c2")).toBeInTheDocument();
  });

  it("calls createComment action when new comment is submitted", async () => {
    const { createComment } = await import("~/app/actions/comments");
    vi.mocked(createComment).mockResolvedValue({
      success: true,
      comment: {
        id: "c-new",
        content: { type: "doc" },
        createdAt: new Date(),
        updatedAt: new Date(),
        isEdited: false,
        creator: { id: "user-1", name: "Alice", image: null },
      } as any,
    } as any);

    render(<CommentList {...defaultProps} />);

    fireEvent.click(screen.getByTestId("editor-submit"));

    await waitFor(() => {
      expect(createComment).toHaveBeenCalledTimes(1);
    });
  });

  it("adds new comment to list after successful createComment", async () => {
    const { createComment } = await import("~/app/actions/comments");
    vi.mocked(createComment).mockResolvedValue({
      success: true,
      comment: {
        id: "c-new",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        createdAt: new Date(),
        updatedAt: new Date(),
        isEdited: false,
        creator: { id: "user-1", name: "Alice", image: null },
      } as any,
    } as any);

    render(<CommentList {...defaultProps} initialComments={[]} />);

    fireEvent.click(screen.getByTestId("editor-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("comment-item-c-new")).toBeInTheDocument();
    });
  });

  it("removes comment from list after successful delete", async () => {
    const { deleteComment } = await import("~/app/actions/comments");
    vi.mocked(deleteComment).mockResolvedValue({ success: true } as any);

    const comments = [makeMockComment("c1", "user-1", "Alice")];
    render(
      <CommentList
        {...defaultProps}
        initialComments={comments}
        currentUserId="user-1"
      />
    );

    expect(screen.getByTestId("comment-item-c1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("delete-btn-c1"));

    await waitFor(() => {
      expect(screen.queryByTestId("comment-item-c1")).not.toBeInTheDocument();
    });
  });

  it("renders comment count as 0 initially with empty list", () => {
    render(<CommentList {...defaultProps} initialComments={[]} />);
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("(0)");
  });

  it("passes entityType-specific ID to createComment for testRun", async () => {
    const { createComment } = await import("~/app/actions/comments");
    vi.mocked(createComment).mockResolvedValue({
      success: true,
      comment: {
        id: "c-new",
        content: { type: "doc" },
        createdAt: new Date(),
        updatedAt: new Date(),
        isEdited: false,
        creator: { id: "user-1", name: "Alice", image: null },
      } as any,
    } as any);

    render(
      <CommentList
        projectId={1}
        entityType="testRun"
        entityId={99}
        initialComments={[]}
        currentUserId="user-1"
        isAdmin={false}
      />
    );

    fireEvent.click(screen.getByTestId("editor-submit"));

    await waitFor(() => {
      expect(createComment).toHaveBeenCalledWith(
        expect.objectContaining({ testRunId: 99 })
      );
    });
  });
});
