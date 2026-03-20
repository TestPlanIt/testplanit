import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    shareLink: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shareLinkAccessLog: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createShareLinkAccessedNotification: vi.fn(),
  },
}));

import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";
import { GET, POST } from "./route";

const createGetRequest = (shareKey: string): [NextRequest, { params: Promise<{ shareKey: string }> }] => {
  const req = new NextRequest(`http://localhost/api/share/${shareKey}`);
  const params = { params: Promise.resolve({ shareKey }) };
  return [req, params];
};

const createPostRequest = (shareKey: string, body: Record<string, any> = {}): [NextRequest, { params: Promise<{ shareKey: string }> }] => {
  const req = new NextRequest(`http://localhost/api/share/${shareKey}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const params = { params: Promise.resolve({ shareKey }) };
  return [req, params];
};

const mockShareLink = {
  id: 1,
  shareKey: "abc123",
  entityType: "REPORT",
  entityId: 100,
  entityConfig: { reportType: "test-execution" },
  mode: "PUBLIC",
  title: "Test Report",
  description: "A test report",
  projectId: 10,
  isDeleted: false,
  isRevoked: false,
  expiresAt: null,
  viewCount: 5,
  notifyOnView: false,
  createdById: "user-1",
  passwordHash: null,
  project: {
    id: 10,
    name: "My Project",
    createdBy: "user-1",
    userPermissions: [],
  },
  createdBy: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
  },
};

describe("GET /api/share/[shareKey]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(null);
  });

  it("returns share link metadata without authentication", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(1);
    expect(data.entityType).toBe("REPORT");
    expect(data.projectName).toBe("My Project");
    expect(data.createdBy).toBe("Test User");
    expect(data.requiresPassword).toBe(false);
    // passwordHash must not be exposed
    expect(data.passwordHash).toBeUndefined();
  });

  it("returns 404 for non-existent shareKey", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue(null);

    const [req, ctx] = createGetRequest("nonexistent");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain("not found");
  });

  it("returns 404 for deleted share link", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      isDeleted: true,
    });

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.deleted).toBe(true);
  });

  it("returns 403 for revoked share link", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      isRevoked: true,
    });

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.revoked).toBe(true);
  });

  it("returns 403 for expired share link", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      expiresAt: new Date("2020-01-01"),
    });

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.expired).toBe(true);
  });

  it("sets requiresPassword=true for PASSWORD_PROTECTED mode", async () => {
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "PASSWORD_PROTECTED",
    });

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.requiresPassword).toBe(true);
  });

  it("returns 500 on database error", async () => {
    (prisma.shareLink.findUnique as any).mockRejectedValue(new Error("DB error"));

    const [req, ctx] = createGetRequest("abc123");
    const response = await GET(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain("Failed to fetch share link");
  });
});

describe("POST /api/share/[shareKey]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.shareLinkAccessLog.create as any).mockResolvedValue({});
    (prisma.shareLink.update as any).mockResolvedValue({});
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it("returns 404 when shareKey not found", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue(null);

    const [req, ctx] = createPostRequest("nonexistent", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain("not found");
  });

  it("returns 404 for deleted share link", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      isDeleted: true,
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const _data = await response.json();

    expect(response.status).toBe(404);
  });

  it("returns 403 for revoked share link", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      isRevoked: true,
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const _data = await response.json();

    expect(response.status).toBe(403);
  });

  it("returns 403 for expired share link", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      expiresAt: new Date("2020-01-01"),
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const _data = await response.json();

    expect(response.status).toBe(403);
  });

  it("allows PUBLIC mode access without auth", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accessed).toBe(true);
    expect(data.entityType).toBe("REPORT");
  });

  it("returns 401 for AUTHENTICATED mode without session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "AUTHENTICATED",
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.requiresAuth).toBe(true);
  });

  it("allows AUTHENTICATED mode access with valid session and project access", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "AUTHENTICATED",
      project: {
        ...mockShareLink.project,
        createdBy: "user-1", // user is project creator
      },
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accessed).toBe(true);
  });

  it("allows ADMIN to access AUTHENTICATED mode share regardless of project membership", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "admin-user", access: "ADMIN" },
    });
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "AUTHENTICATED",
      project: {
        ...mockShareLink.project,
        createdBy: "someone-else",
        userPermissions: [],
      },
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accessed).toBe(true);
  });

  it("returns 401 for PASSWORD_PROTECTED mode without password or token", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "PASSWORD_PROTECTED",
      passwordHash: "$2b$10$hashvalue",
    });

    const [req, ctx] = createPostRequest("abc123", {});
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.requiresPassword).toBe(true);
  });

  it("allows PASSWORD_PROTECTED mode with correct token", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "PASSWORD_PROTECTED",
      passwordHash: "$2b$10$hashvalue",
    });

    const [req, ctx] = createPostRequest("abc123", { token: "abc123" });
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accessed).toBe(true);
  });

  it("returns 401 for PASSWORD_PROTECTED mode with wrong password", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "PASSWORD_PROTECTED",
      passwordHash: "$2b$10$hashvalue",
    });
    (bcrypt.compare as any).mockResolvedValue(false);

    const [req, ctx] = createPostRequest("abc123", { password: "wrongpassword" });
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid password");
  });

  it("allows PASSWORD_PROTECTED mode with correct password", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue({
      ...mockShareLink,
      mode: "PASSWORD_PROTECTED",
      passwordHash: "$2b$10$hashvalue",
    });
    (bcrypt.compare as any).mockResolvedValue(true);

    const [req, ctx] = createPostRequest("abc123", { password: "correctpassword" });
    const response = await POST(req, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accessed).toBe(true);
  });

  it("logs access and increments view count on success", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

    const [req, ctx] = createPostRequest("abc123", {});
    await POST(req, ctx);

    expect(prisma.shareLinkAccessLog.create).toHaveBeenCalledOnce();
    expect(prisma.shareLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          viewCount: { increment: 1 },
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });
});
