import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommentService } from "./commentService";

// Mock the extractMentionedUserIds utility
vi.mock("../utils/tiptapMentions", () => ({
  extractMentionedUserIds: vi.fn((content: any) => {
    // Simple mock implementation that extracts user IDs from mention nodes
    const userIds: string[] = [];
    const extractFromNode = (node: any) => {
      if (node.type === "mention" && node.attrs?.id) {
        userIds.push(node.attrs.id);
      }
      if (node.content) {
        node.content.forEach(extractFromNode);
      }
    };
    if (content?.content) {
      content.content.forEach(extractFromNode);
    }
    return userIds;
  }),
}));

// Mock the NotificationService
const mockCreateNotification = vi.fn().mockResolvedValue({});
vi.mock("./notificationService", () => ({
  NotificationService: {
    createNotification: (...args: any[]) => mockCreateNotification(...args),
  },
}));

// Mock Prisma
const mockFindManyUsers = vi.fn();
const mockCreateManyMentions = vi.fn();
const mockDeleteManyMentions = vi.fn();

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: any[]) => mockFindManyUsers(...args),
    },
  },
}));

vi.mock("~/server/db", () => ({
  db: {
    commentMention: {
      createMany: (...args: any[]) => mockCreateManyMentions(...args),
      deleteMany: (...args: any[]) => mockDeleteManyMentions(...args),
    },
  },
}));

describe("CommentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processMentions", () => {
    const baseParams = {
      commentId: "comment-123",
      creatorId: "user-creator",
      creatorName: "John Creator",
      projectId: 1,
      projectName: "Test Project",
      entityType: "RepositoryCase" as const,
      entityName: "Test Case 1",
      entityId: "100",
    };

    it("should return empty array when no mentions in content", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "No mentions here" }],
          },
        ],
      };

      const result = await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        baseParams.entityType,
        baseParams.entityName,
        baseParams.entityId
      );

      expect(result).toEqual([]);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should filter out self-mentions", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "user-creator" } }, // Self-mention
            ],
          },
        ],
      };

      const result = await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        baseParams.entityType,
        baseParams.entityName,
        baseParams.entityId
      );

      expect(result).toEqual([]);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should create notifications for mentioned users", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "user-1" } },
              { type: "mention", attrs: { id: "user-2" } },
            ],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        { id: "user-1", name: "Alice", email: "alice@test.com", role: "USER" },
        { id: "user-2", name: "Bob", email: "bob@test.com", role: "USER" },
      ]);

      const result = await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        baseParams.entityType,
        baseParams.entityName,
        baseParams.entityId
      );

      expect(result).toEqual(["user-1", "user-2"]);
      expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    });

    it("should create notification with correct message for RepositoryCase", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "user-1" } }],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        { id: "user-1", name: "Alice", email: "alice@test.com", role: "USER" },
      ]);

      await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        "RepositoryCase",
        baseParams.entityName,
        baseParams.entityId
      );

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "COMMENT_MENTION",
          title: "You were mentioned in a comment",
          message: expect.stringContaining("test case"),
          data: expect.objectContaining({
            entityType: "RepositoryCase",
            repositoryCaseId: 100,
            testCaseName: "Test Case 1",
          }),
        })
      );
    });

    it("should create notification with correct message for TestRun", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "user-1" } }],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        { id: "user-1", name: "Alice", email: "alice@test.com", role: "USER" },
      ]);

      await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        "TestRun",
        "Sprint 1 Tests",
        "200"
      );

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("test run"),
          data: expect.objectContaining({
            entityType: "TestRun",
            testRunId: 200,
            testRunName: "Sprint 1 Tests",
          }),
        })
      );
    });

    it("should create notification with correct message for Session", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "user-1" } }],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        { id: "user-1", name: "Alice", email: "alice@test.com", role: "USER" },
      ]);

      await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        "Session",
        "Exploratory Session",
        "300"
      );

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("session"),
          data: expect.objectContaining({
            entityType: "Session",
            sessionId: 300,
            sessionName: "Exploratory Session",
          }),
        })
      );
    });

    it("should create notification with correct message for Milestone", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "user-1" } }],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        { id: "user-1", name: "Alice", email: "alice@test.com", role: "USER" },
      ]);

      await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        "Milestone",
        "Release 1.0",
        "400",
        "rocket"
      );

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("milestone"),
          data: expect.objectContaining({
            entityType: "Milestone",
            milestoneId: 400,
            milestoneName: "Release 1.0",
            milestoneTypeIconName: "rocket",
          }),
        })
      );
    });

    it("should only notify active non-deleted users", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "user-active" } },
              { type: "mention", attrs: { id: "user-inactive" } },
            ],
          },
        ],
      };

      // Only active user returned from query
      mockFindManyUsers.mockResolvedValue([
        {
          id: "user-active",
          name: "Active User",
          email: "active@test.com",
          role: "USER",
        },
      ]);

      const result = await CommentService.processMentions(
        baseParams.commentId,
        content,
        baseParams.creatorId,
        baseParams.creatorName,
        baseParams.projectId,
        baseParams.projectName,
        baseParams.entityType,
        baseParams.entityName,
        baseParams.entityId
      );

      // Should return both userIds that were mentioned
      expect(result).toContain("user-active");
      expect(result).toContain("user-inactive");

      // But should only create notification for the user found in DB
      expect(mockCreateNotification).toHaveBeenCalledTimes(1);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-active",
        })
      );
    });
  });

  describe("createCommentMentions", () => {
    it("should not create mentions when userIds array is empty", async () => {
      await CommentService.createCommentMentions("comment-123", []);

      expect(mockCreateManyMentions).not.toHaveBeenCalled();
    });

    it("should create mentions for all user IDs", async () => {
      mockCreateManyMentions.mockResolvedValue({ count: 2 });

      await CommentService.createCommentMentions("comment-123", [
        "user-1",
        "user-2",
      ]);

      expect(mockCreateManyMentions).toHaveBeenCalledWith({
        data: [
          { commentId: "comment-123", userId: "user-1" },
          { commentId: "comment-123", userId: "user-2" },
        ],
        skipDuplicates: true,
      });
    });

    it("should skip duplicates", async () => {
      mockCreateManyMentions.mockResolvedValue({ count: 1 });

      await CommentService.createCommentMentions("comment-123", ["user-1"]);

      expect(mockCreateManyMentions).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDuplicates: true,
        })
      );
    });
  });

  describe("removeOldMentions", () => {
    it("should delete mentions not in current list", async () => {
      mockDeleteManyMentions.mockResolvedValue({ count: 1 });

      await CommentService.removeOldMentions("comment-123", [
        "user-1",
        "user-2",
      ]);

      expect(mockDeleteManyMentions).toHaveBeenCalledWith({
        where: {
          commentId: "comment-123",
          userId: {
            notIn: ["user-1", "user-2"],
          },
        },
      });
    });

    it("should delete all mentions when currentUserIds is empty", async () => {
      mockDeleteManyMentions.mockResolvedValue({ count: 3 });

      await CommentService.removeOldMentions("comment-123", []);

      expect(mockDeleteManyMentions).toHaveBeenCalledWith({
        where: {
          commentId: "comment-123",
          userId: {
            notIn: undefined,
          },
        },
      });
    });
  });
});
