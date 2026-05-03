import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Project access check — defaults to "user has access". Individual tests
// override via `mockProjectsFindFirst.mockResolvedValueOnce(null)` to
// exercise the no-access branch (redacted notification message).
const mockProjectsFindFirst = vi.fn();

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: any[]) => mockFindManyUsers(...args),
    },
    projects: {
      findFirst: (...args: any[]) => mockProjectsFindFirst(...args),
    },
  },
}));

// `buildProjectAccessWhere` is dynamically imported by commentService;
// stub returns a marker object so test assertions can verify it was
// invoked with the expected (projectId, userId, isAdmin, isProjectAdmin)
// shape without coupling to the real where-clause structure.
vi.mock("~/lib/project-access", () => ({
  buildProjectAccessWhere: vi.fn(
    (
      projectId: number,
      userId: string,
      isAdmin: boolean,
      isProjectAdmin: boolean
    ) => ({
      __access: { projectId, userId, isAdmin, isProjectAdmin },
    })
  ),
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
    // Default: every mentioned user has project access. Tests that
    // need the no-access branch override per-call.
    mockProjectsFindFirst.mockResolvedValue({ id: 1 });
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
        {
          id: "user-2",
          name: "Bob",
          email: "bob@test.com",
          role: "USER",
          access: "USER",
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
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
          access: "USER",
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

    it("should send a redacted notification when the mentioned user has no project access", async () => {
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
      ]);
      // Simulate no project access — `findFirst` returns null because
      // the buildProjectAccessWhere predicate filters Alice out.
      mockProjectsFindFirst.mockResolvedValueOnce(null);

      await CommentService.processMentions(
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

      expect(mockCreateNotification).toHaveBeenCalledTimes(1);
      const call = mockCreateNotification.mock.calls[0][0];
      // Notification still goes out, but the message is redacted and
      // the entity link payload is suppressed.
      expect(call.userId).toBe("user-1");
      expect(call.message).toContain("do not have access");
      expect(call.message).not.toContain("Test Case 1");
      expect(call.relatedEntityId).toBeUndefined();
      expect(call.relatedEntityType).toBeUndefined();
      expect(call.data.hasProjectAccess).toBe(false);
    });

    it("should send a full notification when the mentioned user has project access", async () => {
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
        {
          id: "user-1",
          name: "Alice",
          email: "alice@test.com",
          role: "USER",
          access: "USER",
        },
      ]);
      // beforeEach default already returns a non-null project, but be
      // explicit so this test reads independently.
      mockProjectsFindFirst.mockResolvedValueOnce({ id: 1 });

      await CommentService.processMentions(
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

      const call = mockCreateNotification.mock.calls[0][0];
      expect(call.message).toContain("Test Case 1");
      expect(call.relatedEntityId).toBe("comment-123");
      expect(call.relatedEntityType).toBe("Comment");
      expect(call.data.hasProjectAccess).toBe(true);
      expect(call.data.repositoryCaseId).toBe(100);
    });

    it("should pass isAdmin/isProjectAdmin flags to buildProjectAccessWhere based on user.access", async () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "user-admin" } },
              { type: "mention", attrs: { id: "user-projectadmin" } },
              { type: "mention", attrs: { id: "user-regular" } },
            ],
          },
        ],
      };

      mockFindManyUsers.mockResolvedValue([
        {
          id: "user-admin",
          name: "Admin User",
          email: "admin@test.com",
          role: "USER",
          access: "ADMIN",
        },
        {
          id: "user-projectadmin",
          name: "Project Admin",
          email: "padmin@test.com",
          role: "USER",
          access: "PROJECTADMIN",
        },
        {
          id: "user-regular",
          name: "Regular User",
          email: "regular@test.com",
          role: "USER",
          access: "USER",
        },
      ]);

      const { buildProjectAccessWhere } = await import("~/lib/project-access");

      await CommentService.processMentions(
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

      // ADMIN: isAdmin=true, isProjectAdmin=false
      expect(buildProjectAccessWhere).toHaveBeenCalledWith(
        baseParams.projectId,
        "user-admin",
        true,
        false
      );
      // PROJECTADMIN: isAdmin=false, isProjectAdmin=true
      expect(buildProjectAccessWhere).toHaveBeenCalledWith(
        baseParams.projectId,
        "user-projectadmin",
        false,
        true
      );
      // USER: both false
      expect(buildProjectAccessWhere).toHaveBeenCalledWith(
        baseParams.projectId,
        "user-regular",
        false,
        false
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
