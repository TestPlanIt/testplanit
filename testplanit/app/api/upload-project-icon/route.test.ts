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

function createUploadRequest(file: File | null): NextRequest {
  const formData = new FormData();
  if (file) {
    formData.set("file", file);
  }
  return {
    formData: async () => formData,
  } as unknown as NextRequest;
}

describe("POST /api/upload-project-icon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "test-key-id";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_REGION = "us-east-1";
    mockSend.mockResolvedValue({});
  });

  it("returns 400 when no file in form data", async () => {
    const request = createUploadRequest(null);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("No file provided");
  });

  it("returns 500 when AWS_BUCKET_NAME not configured", async () => {
    delete process.env.AWS_BUCKET_NAME;

    const file = new File(["icon data"], "icon.svg", { type: "image/svg+xml" });
    const request = createUploadRequest(file);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Storage bucket not configured");
  });

  it("uploads with uploads/project-icons/ key prefix", async () => {
    const file = new File(["icon data"], "icon.svg", { type: "image/svg+xml" });
    const request = createUploadRequest(file);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success.key).toMatch(/^uploads\/project-icons\//);
    expect(data.success.url).toMatch(/^\/api\/storage\/uploads\/project-icons\//);
  });
});
