import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifySessionAssignment } from "./session-notifications";
import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";

// Mock dependencies
vi.mock("~/lib/prisma", () => ({
  prisma: {
    sessions: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: vi.fn(),
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

describe("session-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifySessionAssignment", () => {
    const mockSession = {
      user: {
        id: "assigner-123",
        name: "Sarah Johnson",
      },
      expires: new Date().toISOString(),
    } as any;

    const mockSessionData = {
      id: 1,
      name: "Exploratory Testing - Mobile App",
      project: {
        id: 200,
        name: "Mobile Banking App",
      },
    };

    it("should create notification when session is assigned to a new user", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.sessions.findUnique).mockResolvedValue(mockSessionData as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Mike Wilson" } as any);

      await notifySessionAssignment(1, "assignee-789", null);

      expect(NotificationService.createNotification).toHaveBeenCalledWith({
        userId: "assignee-789",
        type: "SESSION_ASSIGNED",
        title: "New Session Assignment",
        message: 'Sarah Johnson assigned you to session "Exploratory Testing - Mobile App" in project "Mobile Banking App"',
        relatedEntityId: "1",
        relatedEntityType: "Session",
        data: expect.objectContaining({
          assignedById: "assigner-123",
          assignedByName: "Sarah Johnson",
          projectId: 200,
          projectName: "Mobile Banking App",
          sessionId: 1,
          sessionName: "Exploratory Testing - Mobile App",
          entityName: "Exploratory Testing - Mobile App",
        }),
      });
    });

    it("should not create notification when assignee hasn't changed", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);

      await notifySessionAssignment(1, "assignee-789", "assignee-789");

      expect(prisma.sessions.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should not create notification when unassigning (null assignee)", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);

      await notifySessionAssignment(1, null, "assignee-789");

      expect(prisma.sessions.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should not create notification when session is not authenticated", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);

      await notifySessionAssignment(1, "assignee-789", null);

      expect(prisma.sessions.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should handle missing session data gracefully", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.sessions.findUnique).mockResolvedValue(null);

      await notifySessionAssignment(1, "assignee-789", null);

      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.sessions.findUnique).mockRejectedValue(new Error("Database error"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await notifySessionAssignment(1, "assignee-789", null);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to create session assignment notification:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle assignment from user without name", async () => {
      const sessionWithoutName = {
        user: {
          id: "assigner-123",
          name: null,
        },
        expires: new Date().toISOString(),
      } as any;

      vi.mocked(getServerAuthSession).mockResolvedValue(sessionWithoutName);
      vi.mocked(prisma.sessions.findUnique).mockResolvedValue(mockSessionData as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Mike Wilson" } as any);

      await notifySessionAssignment(1, "assignee-789", null);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unknown User assigned you to session "Exploratory Testing - Mobile App" in project "Mobile Banking App"',
          data: expect.objectContaining({
            assignedByName: "Unknown User",
          }),
        })
      );
    });

    it("should create notification when reassigning from one user to another", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.sessions.findUnique).mockResolvedValue(mockSessionData as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "New Assignee" } as any);

      await notifySessionAssignment(1, "assignee-new", "assignee-old");

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "assignee-new",
          type: "SESSION_ASSIGNED",
        })
      );
    });
  });
});