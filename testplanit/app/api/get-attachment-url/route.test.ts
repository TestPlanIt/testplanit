import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSignedUrl, mockPutObjectCommand } = vi.hoisted(() => ({
  mockGetSignedUrl: vi.fn(),
  mockPutObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn(function (this: any) {});
  const PutObjectCommand = vi.fn(function (this: any, params: any) {
    mockPutObjectCommand(params);
    Object.assign(this, params);
  });
  return { S3Client, PutObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { GET } from "./route";

function createRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/get-attachment-url");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

describe("GET /api/get-attachment-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "test-key-id";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_REGION = "us-east-1";
    mockGetSignedUrl.mockResolvedValue("https://s3.example.com/presigned-url?sig=abc");
  });

  it("returns signed URL on successful request", async () => {
    const request = createRequest({ prependString: "project123" });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBeDefined();
    expect(data.success.url).toContain("presigned-url");
  });

  it("uses uploads/attachments/ key prefix", async () => {
    const request = createRequest({ prependString: "project456" });
    await GET(request);

    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(/^uploads\/attachments\//),
      })
    );
  });

  it("uses 'unknown' as prependString when not provided", async () => {
    const request = createRequest({});
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBeDefined();

    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(/^uploads\/attachments\/unknown_/),
      })
    );
  });

  it("returns 500 when getSignedUrl throws", async () => {
    mockGetSignedUrl.mockRejectedValue(new Error("AWS credentials error"));

    const request = createRequest({ prependString: "project123" });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Error generating signed URL");
  });
});
