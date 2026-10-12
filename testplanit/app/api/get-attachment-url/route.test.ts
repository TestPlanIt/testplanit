import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSignedUrl, mockPutObjectCommand, mockGetServerAuthSession } =
  vi.hoisted(() => ({
    mockGetServerAuthSession: vi.fn(),
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

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));

import { GET } from "./route";

function createRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/get-attachment-url");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe("GET /api/get-attachment-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "test-key-id";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_REGION = "us-east-1";
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    mockGetSignedUrl.mockResolvedValue(
      "https://s3.example.com/presigned-url?sig=abc"
    );
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

  it("omits the prefix when prependString is not provided", async () => {
    const request = createRequest({});
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBeDefined();

    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(/^uploads\/attachments\/\d+$/),
      })
    );
  });

  it("returns 401 without a session and mints nothing", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const response = await GET(createRequest({ prependString: "ATTACK" }));

    expect(response.status).toBe(401);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("strips path and special characters from prependString", async () => {
    await GET(createRequest({ prependString: "../../evil/../x y" }));

    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(/^uploads\/attachments\/evilxy_\d+$/),
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
