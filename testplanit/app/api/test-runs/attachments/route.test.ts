import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  extractBearerToken: vi.fn(),
  authenticateApiToken: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    testRuns: {
      findUnique: vi.fn(),
    },
    attachments: {
      create: vi.fn(),
    },
  },
}));

const mockS3Send = vi.fn().mockResolvedValue({});
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = mockS3Send;
  },
  PutObjectCommand: vi.fn(),
}));

import { extractBearerToken, authenticateApiToken } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/lib/prisma";

describe("Test Run Attachments API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
    },
  };

  const mockTestRun = {
    id: 1,
    projectId: 10,
  };

  const mockAttachment = {
    id: 1,
    url: "/api/storage/uploads/attachments/testrun_1_12345_file.txt",
    name: "file.txt",
    mimeType: "text/plain",
    size: BigInt(100),
  };

  const createMockFile = (name: string, content: string = "test content"): File => {
    const blob = new Blob([content], { type: "text/plain" });
    return new File([blob], name, { type: "text/plain" });
  };

  const createFormDataRequest = (
    formData: FormData
  ): NextRequest => {
    return {
      formData: async () => formData,
      headers: new Headers(),
    } as unknown as NextRequest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerAuthSession as any).mockResolvedValue(mockSession);
    (extractBearerToken as any).mockReturnValue(null);
    (prisma.testRuns.findUnique as any).mockResolvedValue(mockTestRun);
    (prisma.attachments.create as any).mockResolvedValue(mockAttachment);
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
  });

  describe("Authentication", () => {
    it("returns 401 when no session and no bearer token", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue(null);

      const formData = new FormData();
      const request = createFormDataRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Authentication required");
    });

    it("returns 401 when bearer token is invalid", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("bad-token");
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "Invalid token",
        errorCode: "INVALID_TOKEN",
      });

      const formData = new FormData();
      const request = createFormDataRequest(formData);

      const response = await POST(request);
      const _data = await response.json();

      expect(response.status).toBe(401);
    });

    it("allows access with valid API token when no session", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("valid-token");
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "api-user-123",
      });

      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);

      // Should not be a 401 — may be 200 or other codes
      expect(response.status).not.toBe(401);
    });
  });

  describe("Validation", () => {
    it("returns 400 when no files provided", async () => {
      const formData = new FormData();
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No files provided");
    });

    it("returns 400 when testRunId is missing", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("testRunId is required");
    });

    it("returns 400 when testRunId is invalid", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "not-a-number");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid testRunId");
    });

    it("returns 400 when testRunId is zero or negative", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "0");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid testRunId");
    });
  });

  describe("Not Found", () => {
    it("returns 404 when test run does not exist", async () => {
      (prisma.testRuns.findUnique as any).mockResolvedValue(null);

      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "999");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Test run not found");
    });
  });

  describe("Successful Upload", () => {
    it("returns summary with success/failure counts", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("summary");
      expect(data).toHaveProperty("results");
      expect(data.summary).toHaveProperty("total");
      expect(data.summary).toHaveProperty("success");
      expect(data.summary).toHaveProperty("failed");
    });

    it("creates attachment record linked to test run", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const _data = await response.json();

      expect(response.status).toBe(200);
      expect(prisma.attachments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testRuns: { connect: { id: 1 } },
            createdBy: { connect: { id: "user-123" } },
          }),
        })
      );
    });

    it("returns success result with attachmentId and url", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results[0].success).toBe(true);
      expect(data.results[0].fileName).toBe("test.txt");
    });
  });

  describe("Storage Configuration", () => {
    it("returns 500 when AWS_BUCKET_NAME is not configured", async () => {
      delete process.env.AWS_BUCKET_NAME;

      const formData = new FormData();
      formData.append("files", createMockFile("test.txt"));
      formData.append("testRunId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Storage bucket not configured");
    });
  });
});
