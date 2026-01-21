import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userPreferences: {
      update: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/lib/prisma";

describe("User Update API Endpoint (PATCH /api/users/[userId])", () => {
  const mockAdminSession = {
    user: {
      id: "admin-123",
      name: "Admin User",
      email: "admin@example.com",
      access: "ADMIN" as const,
    },
  };

  const mockUserSession = {
    user: {
      id: "user-123",
      name: "Regular User",
      email: "user@example.com",
      access: "USER" as const,
    },
  };

  const mockExistingUser = {
    id: "user-123",
    name: "Existing User",
    email: "existing@example.com",
    isActive: true,
    isApi: false,
    isDeleted: false,
    image: null,
    access: "USER",
    roleId: 1,
    userPreferences: {
      userId: "user-123",
      theme: "Light",
      locale: "en_US",
      itemsPerPage: "P10",
      dateFormat: "MM_DD_YYYY_DASH",
      timeFormat: "HH_MM_A",
      timezone: "Etc/UTC",
      notificationMode: "USE_GLOBAL",
      emailNotifications: true,
      inAppNotifications: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerAuthSession as any).mockResolvedValue(mockAdminSession);
  });

  const createRequest = (body: any): NextRequest => {
    return {
      json: async () => body,
    } as NextRequest;
  };

  const createContext = (userId: string) => ({
    params: Promise.resolve({ userId }),
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerAuthSession as any).mockResolvedValue({});

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Authorization", () => {
    it("allows user to update their own profile", async () => {
      (getServerAuthSession as any).mockResolvedValue(mockUserSession);
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
      (prisma.$transaction as any).mockResolvedValue({
        ...mockExistingUser,
        name: "Updated Name",
      });

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
    });

    it("returns 403 when non-admin user tries to update another user", async () => {
      (getServerAuthSession as any).mockResolvedValue(mockUserSession);

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("other-user-id");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });

    it("allows admin to update any user", async () => {
      (getServerAuthSession as any).mockResolvedValue(mockAdminSession);
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
      (prisma.$transaction as any).mockResolvedValue({
        ...mockExistingUser,
        name: "Updated Name",
      });

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
    });
  });

  describe("User Existence Validation", () => {
    it("returns 404 when user does not exist", async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("non-existent-user");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("Basic Field Updates", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("updates user name", async () => {
      const updatedUser = { ...mockExistingUser, name: "New Name" };
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          user: {
            update: vi.fn().mockResolvedValue(updatedUser),
            findUnique: vi.fn().mockResolvedValue(updatedUser),
          },
          userPreferences: {},
        });
      });

      const request = createRequest({ name: "New Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.name).toBe("New Name");
    });

    it("updates user email", async () => {
      const updatedUser = { ...mockExistingUser, email: "newemail@example.com" };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ email: "newemail@example.com" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.email).toBe("newemail@example.com");
    });

    it("updates user isActive status", async () => {
      const updatedUser = { ...mockExistingUser, isActive: false };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ isActive: false });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.isActive).toBe(false);
    });

    it("updates user isApi flag", async () => {
      const updatedUser = { ...mockExistingUser, isApi: true };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ isApi: true });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.isApi).toBe(true);
    });

    it("soft deletes user by setting isDeleted", async () => {
      const updatedUser = { ...mockExistingUser, isDeleted: true };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ isDeleted: true });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.isDeleted).toBe(true);
    });

    it("updates user avatar image", async () => {
      const updatedUser = { ...mockExistingUser, image: "https://example.com/avatar.jpg" };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ image: "https://example.com/avatar.jpg" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.image).toBe("https://example.com/avatar.jpg");
    });

    it("removes user avatar by setting image to null", async () => {
      const updatedUser = { ...mockExistingUser, image: null };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ image: null });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.image).toBeNull();
    });

    it("updates user access level", async () => {
      const updatedUser = { ...mockExistingUser, access: "PROJECTADMIN" };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ access: "PROJECTADMIN" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.access).toBe("PROJECTADMIN");
    });

    it("updates user roleId", async () => {
      const updatedUser = { ...mockExistingUser, roleId: 2 };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ roleId: 2 });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.roleId).toBe(2);
    });

    it("updates multiple fields at once", async () => {
      const updatedUser = {
        ...mockExistingUser,
        name: "New Name",
        email: "newemail@example.com",
        isActive: false,
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({
        name: "New Name",
        email: "newemail@example.com",
        isActive: false,
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.name).toBe("New Name");
      expect(data.data.email).toBe("newemail@example.com");
      expect(data.data.isActive).toBe(false);
    });
  });

  describe("User Preferences Updates", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("updates theme preference", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: { ...mockExistingUser.userPreferences, theme: "Dark" },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ userPreferences: { theme: "Dark" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.theme).toBe("Dark");
    });

    it("updates locale preference", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: { ...mockExistingUser.userPreferences, locale: "es_ES" },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ userPreferences: { locale: "es_ES" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.locale).toBe("es_ES");
    });

    it("updates itemsPerPage preference", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: { ...mockExistingUser.userPreferences, itemsPerPage: "P25" },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ userPreferences: { itemsPerPage: "P25" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.itemsPerPage).toBe("P25");
    });

    it("updates multiple preferences at once", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: {
          ...mockExistingUser.userPreferences,
          theme: "Dark",
          locale: "fr_FR",
          itemsPerPage: "P50",
        },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({
        userPreferences: {
          theme: "Dark",
          locale: "fr_FR",
          itemsPerPage: "P50",
        },
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.theme).toBe("Dark");
      expect(data.data.userPreferences.locale).toBe("fr_FR");
      expect(data.data.userPreferences.itemsPerPage).toBe("P50");
    });

    it("creates preferences if they don't exist", async () => {
      const userWithoutPrefs = { ...mockExistingUser, userPreferences: null };
      (prisma.user.findUnique as any).mockResolvedValue(userWithoutPrefs);

      const updatedUser = {
        ...mockExistingUser,
        userPreferences: {
          userId: "user-123",
          theme: "Dark",
          locale: "en_US",
          itemsPerPage: "P10",
          dateFormat: "MM_DD_YYYY_DASH",
          timeFormat: "HH_MM_A",
          timezone: "Etc/UTC",
          notificationMode: "USE_GLOBAL",
          emailNotifications: true,
          inAppNotifications: true,
        },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({ userPreferences: { theme: "Dark" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences).toBeDefined();
      expect(data.data.userPreferences.theme).toBe("Dark");
    });

    it("updates notification preferences", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: {
          ...mockExistingUser.userPreferences,
          notificationMode: "IN_APP_EMAIL_IMMEDIATE",
          emailNotifications: true,
          inAppNotifications: true,
        },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({
        userPreferences: {
          notificationMode: "IN_APP_EMAIL_IMMEDIATE",
          emailNotifications: true,
          inAppNotifications: true,
        },
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.notificationMode).toBe("IN_APP_EMAIL_IMMEDIATE");
    });

    it("updates date and time format preferences", async () => {
      const updatedUser = {
        ...mockExistingUser,
        userPreferences: {
          ...mockExistingUser.userPreferences,
          dateFormat: "DD_MM_YYYY_SLASH",
          timeFormat: "HH_MM",
          timezone: "America/New_York",
        },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({
        userPreferences: {
          dateFormat: "DD_MM_YYYY_SLASH",
          timeFormat: "HH_MM",
          timezone: "America/New_York",
        },
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.userPreferences.dateFormat).toBe("DD_MM_YYYY_SLASH");
      expect(data.data.userPreferences.timeFormat).toBe("HH_MM");
      expect(data.data.userPreferences.timezone).toBe("America/New_York");
    });
  });

  describe("Combined Updates", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("updates both basic fields and preferences in one request", async () => {
      const updatedUser = {
        ...mockExistingUser,
        name: "Updated Name",
        email: "updated@example.com",
        userPreferences: {
          ...mockExistingUser.userPreferences,
          theme: "Dark",
          itemsPerPage: "P25",
        },
      };
      (prisma.$transaction as any).mockResolvedValue(updatedUser);

      const request = createRequest({
        name: "Updated Name",
        email: "updated@example.com",
        userPreferences: {
          theme: "Dark",
          itemsPerPage: "P25",
        },
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.name).toBe("Updated Name");
      expect(data.data.email).toBe("updated@example.com");
      expect(data.data.userPreferences.theme).toBe("Dark");
      expect(data.data.userPreferences.itemsPerPage).toBe("P25");
    });
  });

  describe("Validation", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("returns 400 for invalid email format", async () => {
      const request = createRequest({ email: "invalid-email" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
      expect(data.details).toBeDefined();
    });

    it("returns 400 for empty name", async () => {
      const request = createRequest({ name: "" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("returns 400 for invalid access level", async () => {
      const request = createRequest({ access: "INVALID_ACCESS" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("returns 400 for invalid theme", async () => {
      const request = createRequest({ userPreferences: { theme: "InvalidTheme" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("returns 400 for invalid locale", async () => {
      const request = createRequest({ userPreferences: { locale: "invalid_locale" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("returns 400 for invalid itemsPerPage", async () => {
      const request = createRequest({ userPreferences: { itemsPerPage: "P999" } });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("returns 400 for non-integer roleId", async () => {
      const request = createRequest({ roleId: 1.5 });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("accepts valid request with all supported theme values", async () => {
      const themes = ["Light", "Dark", "System", "Green", "Orange", "Purple"];

      for (const theme of themes) {
        const updatedUser = {
          ...mockExistingUser,
          userPreferences: { ...mockExistingUser.userPreferences, theme },
        };
        (prisma.$transaction as any).mockResolvedValue(updatedUser);

        const request = createRequest({ userPreferences: { theme } });
        const context = createContext("user-123");
        const response = await PATCH(request, context);

        expect(response.status).toBe(200);
      }
    });

    it("accepts empty body (no-op update)", async () => {
      (prisma.$transaction as any).mockResolvedValue(mockExistingUser);

      const request = createRequest({});
      const context = createContext("user-123");
      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("returns 400 when email already exists (P2002 Prisma error)", async () => {
      const prismaError = {
        code: "P2002",
        message: "Unique constraint failed",
      };
      (prisma.$transaction as any).mockRejectedValue(prismaError);

      const request = createRequest({ email: "existing@example.com" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Email already exists");
    });

    it("returns 500 for database transaction failure", async () => {
      (prisma.$transaction as any).mockRejectedValue(new Error("Database error"));

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update user");
    });

    it("returns 500 for unexpected errors", async () => {
      (prisma.$transaction as any).mockRejectedValue(new Error("Unexpected error"));

      const request = createRequest({ name: "Updated Name" });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update user");
    });
  });

  describe("Transaction Behavior", () => {
    beforeEach(() => {
      (prisma.user.findUnique as any).mockResolvedValue(mockExistingUser);
    });

    it("executes updates in a transaction to ensure atomicity", async () => {
      let transactionCallbackCalled = false;

      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        transactionCallbackCalled = true;

        // Mock transaction context
        const txMock = {
          user: {
            update: vi.fn().mockResolvedValue(mockExistingUser),
            findUnique: vi.fn().mockResolvedValue(mockExistingUser),
          },
          userPreferences: {
            update: vi.fn(),
          },
        };

        return await callback(txMock);
      });

      const request = createRequest({
        name: "Updated Name",
        userPreferences: { theme: "Dark" },
      });
      const context = createContext("user-123");
      await PATCH(request, context);

      expect(transactionCallbackCalled).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("returns final user state after transaction completes", async () => {
      const finalUserState = {
        ...mockExistingUser,
        name: "Final Name",
        userPreferences: { ...mockExistingUser.userPreferences, theme: "Dark" },
      };

      (prisma.$transaction as any).mockResolvedValue(finalUserState);

      const request = createRequest({
        name: "Final Name",
        userPreferences: { theme: "Dark" },
      });
      const context = createContext("user-123");
      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.name).toBe("Final Name");
      expect(data.data.userPreferences.theme).toBe("Dark");
    });
  });
});
