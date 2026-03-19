import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn(function (this: any) {
    this.send = mockSend;
  });
  const PutObjectCommand = vi.fn(function (this: any, params: any) {
    Object.assign(this, params);
  });
  return { S3Client, PutObjectCommand };
});

import { POST } from "./route";

function createUploadRequest(file: File | null, prependString?: string): NextRequest {
  const formData = new FormData();
  if (file) {
    formData.set("file", file);
  }
  if (prependString !== undefined) {
    formData.set("prependString", prependString);
  }
  return {
    formData: async () => formData,
  } as unknown as NextRequest;
}

describe("POST /api/upload-attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "test-key-id";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_REGION = "us-east-1";
    mockSend.mockResolvedValue({});
  });

  describe("Validation", () => {
    it("returns 400 when no file in form data", async () => {
      const request = createUploadRequest(null);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No file provided");
    });

    it("returns 500 when AWS_BUCKET_NAME not configured", async () => {
      delete process.env.AWS_BUCKET_NAME;

      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Storage bucket not configured");
    });
  });

  describe("Successful upload", () => {
    it("returns url and key on successful upload", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBeDefined();
      expect(data.success.url).toMatch(/^\/api\/storage\/uploads\/attachments\//);
      expect(data.success.key).toMatch(/^uploads\/attachments\//);
    });

    it("uses uploads/attachments/ key prefix", async () => {
      const file = new File(["content"], "document.pdf", { type: "application/pdf" });
      const request = createUploadRequest(file);
      const response = await POST(request);
      const data = await response.json();

      expect(data.success.key).toMatch(/^uploads\/attachments\//);
      expect(data.success.key).toContain("document.pdf");
    });

    it("includes prependString in object key when provided", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file, "myprefix");
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success.key).toContain("myprefix_");
    });

    it("does not add separator when prependString is empty", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file, "");
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Key should not have a leading underscore
      const key = data.success.key as string;
      const afterPrefix = key.replace("uploads/attachments/", "");
      expect(afterPrefix).not.toMatch(/^_/);
    });

    it("calls S3Client.send with PutObjectCommand", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file);
      await POST(request);

      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe("Error handling", () => {
    it("returns 500 when S3 upload fails", async () => {
      mockSend.mockRejectedValue(new Error("S3 connection failed"));

      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const request = createUploadRequest(file);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to upload file");
    });
  });
});
