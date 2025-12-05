import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies using vi.hoisted
const {
  mockGetServerAuthSession,
  mockDb,
  mockCommentService,
  mockRevalidatePath,
  mockExtractMentionedUserIds,
  mockIsValidTipTapContent,
} = vi.hoisted(() => ({
  mockGetServerAuthSession: vi.fn(),
  mockDb: {
    comment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockCommentService: {
    createCommentMentions: vi.fn(),
    processMentions: vi.fn(),
    removeOldMentions: vi.fn(),
  },
  mockRevalidatePath: vi.fn(),
  mockExtractMentionedUserIds: vi.fn(),
  mockIsValidTipTapContent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));

vi.mock("~/server/db", () => ({
  db: mockDb,
}));

vi.mock("~/lib/services/commentService", () => ({
  CommentService: mockCommentService,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("~/lib/utils/tiptapMentions", () => ({
  extractMentionedUserIds: mockExtractMentionedUserIds,
  isValidTipTapContent: mockIsValidTipTapContent,
}));

import {
  createComment,
  updateComment,
  deleteComment,
  getCommentsForEntity,
} from "./comments";

describe("comments actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsValidTipTapContent.mockReturnValue(true);
    mockExtractMentionedUserIds.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createComment", () => {
    const validContent = { type: "doc", content: [{ type: "paragraph" }] };
    const mockSession = { user: { id: "user-123", name: "Test User" } };

    describe("authentication", () => {
      it("should throw error when user is not authenticated", async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        await expect(
          createComment({
            content: validContent,
            projectId: 1,
            repositoryCaseId: 1,
          })
        ).rejects.toThrow("Unauthorized");
      });

      it("should throw error when session has no user id", async () => {
        mockGetServerAuthSession.mockResolvedValue({ user: {} });

        await expect(
          createComment({
            content: validContent,
            projectId: 1,
            repositoryCaseId: 1,
          })
        ).rejects.toThrow("Unauthorized");
      });
    });

    describe("input validation", () => {
      it("should return error for invalid TipTap content", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockIsValidTipTapContent.mockReturnValue(false);

        const result = await createComment({
          content: { invalid: "content" } as any,
          projectId: 1,
          repositoryCaseId: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid comment content format");
      });

      it("should return error when no entity is specified", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);

        const result = await createComment({
          content: validContent,
          projectId: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Comment must be associated with exactly one entity"
        );
      });

      it("should return error when multiple entities are specified", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);

        const result = await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
          testRunId: 2,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Comment must be associated with exactly one entity"
        );
      });

      it("should return error when all three entities are specified", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);

        const result = await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
          testRunId: 2,
          sessionId: 3,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Comment must be associated with exactly one entity"
        );
      });

      it("should return error when all four entities are specified", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);

        const result = await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
          testRunId: 2,
          sessionId: 3,
          milestoneId: 4,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Comment must be associated with exactly one entity"
        );
      });
    });

    describe("successful creation", () => {
      const mockCreatedComment = {
        id: "comment-1",
        content: validContent,
        projectId: 1,
        creatorId: "user-123",
        repositoryCaseId: 1,
        testRunId: null,
        sessionId: null,
        creator: { id: "user-123", name: "Test User", image: null },
        project: { id: 1, name: "Test Project" },
        repositoryCase: { id: 1, name: "Test Case" },
        testRun: null,
        session: null,
      };

      it("should create comment for repository case", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue(mockCreatedComment);

        const result = await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
        });

        expect(result.success).toBe(true);
        expect(result.comment).toBeDefined();
        expect(mockDb.comment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              content: validContent,
              projectId: 1,
              creatorId: "user-123",
              repositoryCaseId: 1,
            }),
          })
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      });

      it("should create comment for test run", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue({
          ...mockCreatedComment,
          repositoryCaseId: null,
          testRunId: 2,
          repositoryCase: null,
          testRun: { id: 2, name: "Test Run" },
        });

        const result = await createComment({
          content: validContent,
          projectId: 1,
          testRunId: 2,
        });

        expect(result.success).toBe(true);
        expect(mockDb.comment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              testRunId: 2,
            }),
          })
        );
      });

      it("should create comment for session", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue({
          ...mockCreatedComment,
          repositoryCaseId: null,
          sessionId: 3,
          repositoryCase: null,
          session: { id: 3, name: "Test Session" },
        });

        const result = await createComment({
          content: validContent,
          projectId: 1,
          sessionId: 3,
        });

        expect(result.success).toBe(true);
        expect(mockDb.comment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              sessionId: 3,
            }),
          })
        );
      });

      it("should create comment for milestone", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue({
          ...mockCreatedComment,
          repositoryCaseId: null,
          milestoneId: 4,
          repositoryCase: null,
          milestone: { id: 4, name: "Test Milestone" },
        });

        const result = await createComment({
          content: validContent,
          projectId: 1,
          milestoneId: 4,
        });

        expect(result.success).toBe(true);
        expect(mockDb.comment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              milestoneId: 4,
            }),
          })
        );
      });
    });

    describe("mentions handling", () => {
      const mockCreatedComment = {
        id: "comment-1",
        content: { type: "doc" },
        projectId: 1,
        creatorId: "user-123",
        repositoryCaseId: 1,
        creator: { id: "user-123", name: "Test User", image: null },
        project: { id: 1, name: "Test Project" },
        repositoryCase: { id: 1, name: "Test Case" },
        testRun: null,
        session: null,
      };

      it("should create mentions when users are mentioned", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue(mockCreatedComment);
        mockExtractMentionedUserIds.mockReturnValue(["user-456", "user-789"]);

        await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
        });

        expect(mockCommentService.createCommentMentions).toHaveBeenCalledWith(
          "comment-1",
          ["user-456", "user-789"]
        );
        expect(mockCommentService.processMentions).toHaveBeenCalledWith(
          "comment-1",
          validContent,
          "user-123",
          "Test User",
          1,
          "Test Project",
          "RepositoryCase",
          "Test Case",
          "1"
        );
      });

      it("should not call mention services when no mentions", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockResolvedValue(mockCreatedComment);
        mockExtractMentionedUserIds.mockReturnValue([]);

        await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
        });

        expect(mockCommentService.createCommentMentions).not.toHaveBeenCalled();
        expect(mockCommentService.processMentions).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("should return error on database failure", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.create.mockRejectedValue(new Error("Database error"));

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await createComment({
          content: validContent,
          projectId: 1,
          repositoryCaseId: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Failed to create comment");
        consoleSpy.mockRestore();
      });
    });
  });

  describe("updateComment", () => {
    const validContent = { type: "doc", content: [{ type: "paragraph" }] };
    const mockSession = { user: { id: "user-123", name: "Test User" } };

    describe("authentication", () => {
      it("should throw error when user is not authenticated", async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        await expect(
          updateComment({ commentId: "comment-1", content: validContent })
        ).rejects.toThrow("Unauthorized");
      });
    });

    describe("input validation", () => {
      it("should return error for invalid TipTap content", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockIsValidTipTapContent.mockReturnValue(false);

        const result = await updateComment({
          commentId: "comment-1",
          content: { invalid: "content" } as any,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid comment content format");
      });
    });

    describe("authorization", () => {
      it("should return error when comment not found", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue(null);

        const result = await updateComment({
          commentId: "nonexistent",
          content: validContent,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Comment not found");
      });

      it("should return error when user is not the creator", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "other-user",
          isDeleted: false,
          creator: { id: "other-user", name: "Other User", image: null },
          project: { id: 1, name: "Test Project" },
          repositoryCase: { id: 1, name: "Test Case" },
          testRun: null,
          session: null,
        });

        const result = await updateComment({
          commentId: "comment-1",
          content: validContent,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Unauthorized to edit this comment");
      });

      it("should return error when comment is deleted", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "user-123",
          isDeleted: true,
          creator: { id: "user-123", name: "Test User", image: null },
          project: { id: 1, name: "Test Project" },
          repositoryCase: { id: 1, name: "Test Case" },
          testRun: null,
          session: null,
        });

        const result = await updateComment({
          commentId: "comment-1",
          content: validContent,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot edit deleted comment");
      });
    });

    describe("successful update", () => {
      const existingComment = {
        id: "comment-1",
        creatorId: "user-123",
        isDeleted: false,
        creator: { id: "user-123", name: "Test User", image: null },
        project: { id: 1, name: "Test Project" },
        repositoryCase: { id: 1, name: "Test Case" },
        testRun: null,
        session: null,
      };

      it("should update comment and set isEdited flag", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue(existingComment);
        mockDb.comment.update.mockResolvedValue({
          ...existingComment,
          content: validContent,
          isEdited: true,
        });

        const result = await updateComment({
          commentId: "comment-1",
          content: validContent,
        });

        expect(result.success).toBe(true);
        expect(mockDb.comment.update).toHaveBeenCalledWith({
          where: { id: "comment-1" },
          data: {
            content: validContent,
            isEdited: true,
          },
        });
        expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      });

      it("should handle mention updates", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue(existingComment);
        mockDb.comment.update.mockResolvedValue({
          ...existingComment,
          content: validContent,
          isEdited: true,
        });
        mockExtractMentionedUserIds.mockReturnValue(["user-456"]);

        await updateComment({
          commentId: "comment-1",
          content: validContent,
        });

        expect(mockCommentService.removeOldMentions).toHaveBeenCalledWith(
          "comment-1",
          ["user-456"]
        );
        expect(mockCommentService.createCommentMentions).toHaveBeenCalledWith(
          "comment-1",
          ["user-456"]
        );
      });
    });

    describe("error handling", () => {
      it("should return error on database failure", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "user-123",
          isDeleted: false,
          creator: { id: "user-123", name: "Test User", image: null },
          project: { id: 1, name: "Test Project" },
          repositoryCase: { id: 1, name: "Test Case" },
          testRun: null,
          session: null,
        });
        mockDb.comment.update.mockRejectedValue(new Error("Database error"));

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await updateComment({
          commentId: "comment-1",
          content: validContent,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("Failed to update comment");
        consoleSpy.mockRestore();
      });
    });
  });

  describe("deleteComment", () => {
    const mockSession = { user: { id: "user-123", access: "USER" } };

    describe("authentication", () => {
      it("should throw error when user is not authenticated", async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        await expect(deleteComment("comment-1")).rejects.toThrow("Unauthorized");
      });
    });

    describe("authorization", () => {
      it("should return error when comment not found", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue(null);

        const result = await deleteComment("nonexistent");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Comment not found");
      });

      it("should return error when user is not creator or admin", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "other-user",
          isDeleted: false,
        });

        const result = await deleteComment("comment-1");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Unauthorized to delete this comment");
      });

      it("should allow admin to delete any comment", async () => {
        mockGetServerAuthSession.mockResolvedValue({
          user: { id: "admin-123", access: "ADMIN" },
        });
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "other-user",
          isDeleted: false,
        });
        mockDb.comment.update.mockResolvedValue({
          id: "comment-1",
          isDeleted: true,
        });

        const result = await deleteComment("comment-1");

        expect(result.success).toBe(true);
      });

      it("should return error when comment is already deleted", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "user-123",
          isDeleted: true,
        });

        const result = await deleteComment("comment-1");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Comment already deleted");
      });
    });

    describe("successful deletion", () => {
      it("should soft delete comment", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "user-123",
          isDeleted: false,
        });
        mockDb.comment.update.mockResolvedValue({
          id: "comment-1",
          isDeleted: true,
        });

        const result = await deleteComment("comment-1");

        expect(result.success).toBe(true);
        expect(mockDb.comment.update).toHaveBeenCalledWith({
          where: { id: "comment-1" },
          data: { isDeleted: true },
        });
        expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      });
    });

    describe("error handling", () => {
      it("should return error on database failure", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findUnique.mockResolvedValue({
          id: "comment-1",
          creatorId: "user-123",
          isDeleted: false,
        });
        mockDb.comment.update.mockRejectedValue(new Error("Database error"));

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await deleteComment("comment-1");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Failed to delete comment");
        consoleSpy.mockRestore();
      });
    });
  });

  describe("getCommentsForEntity", () => {
    const mockSession = { user: { id: "user-123" } };

    describe("authentication", () => {
      it("should return error when user is not authenticated", async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        const result = await getCommentsForEntity("repositoryCase", 1);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Unauthorized");
      });
    });

    describe("fetching comments", () => {
      it("should fetch comments for repository case", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockResolvedValue([
          { id: "comment-1", content: {}, creator: { id: "user-1" } },
        ]);

        const result = await getCommentsForEntity("repositoryCase", 1);

        expect(result.success).toBe(true);
        expect(mockDb.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              repositoryCaseId: 1,
            }),
          })
        );
      });

      it("should fetch comments for test run", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockResolvedValue([]);

        const result = await getCommentsForEntity("testRun", 2);

        expect(result.success).toBe(true);
        expect(mockDb.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              testRunId: 2,
            }),
          })
        );
      });

      it("should fetch comments for session", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockResolvedValue([]);

        const result = await getCommentsForEntity("session", 3);

        expect(result.success).toBe(true);
        expect(mockDb.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              sessionId: 3,
            }),
          })
        );
      });

      it("should fetch comments for milestone", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockResolvedValue([]);

        const result = await getCommentsForEntity("milestone", 4);

        expect(result.success).toBe(true);
        expect(mockDb.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              milestoneId: 4,
            }),
          })
        );
      });

      it("should order comments by createdAt ascending", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockResolvedValue([]);

        await getCommentsForEntity("repositoryCase", 1);

        expect(mockDb.comment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: "asc" },
          })
        );
      });
    });

    describe("error handling", () => {
      it("should return error on database failure", async () => {
        mockGetServerAuthSession.mockResolvedValue(mockSession);
        mockDb.comment.findMany.mockRejectedValue(new Error("Database error"));

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await getCommentsForEntity("repositoryCase", 1);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Failed to get comments");
        consoleSpy.mockRestore();
      });
    });
  });
});
