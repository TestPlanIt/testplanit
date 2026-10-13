import { NextRequest } from "next/server";
import { Readable } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockGetServerAuthSession, mockAuthenticateRequest } =
  vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockGetServerAuthSession: vi.fn(),
    mockAuthenticateRequest: vi.fn(),
  }));

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn(function (this: any) {
    this.send = mockSend;
  });
  const GetObjectCommand = vi.fn(function (this: any, params: any) {
    Object.assign(this, params);
  });
  return { S3Client, GetObjectCommand };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}));

import { GET } from "./route";

function get(path: string[]) {
  return GET({} as NextRequest, { params: Promise.resolve({ path }) });
}

function s3Object(body: string, contentType?: string) {
  return {
    Body: Readable.from([Buffer.from(body)]),
    ContentType: contentType,
    ContentLength: Buffer.byteLength(body),
    ETag: '"etag"',
  };
}

describe("GET /api/storage/[...path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_BUCKET_NAME = "test-bucket";
    process.env.AWS_REGION = "us-east-1";
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1" },
    });
  });

  it("returns 401 and reads nothing when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });

    const response = await get(["uploads", "attachments", "a.png"]);

    expect(response.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    [["other", "secret.json"]],
    [["uploads"]],
    [["uploads", "..", "secret.json"]],
    [["uploads", "", "a.png"]],
  ])("returns 404 for a key outside uploads/: %j", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("serves a raster image inline with private caching", async () => {
    mockSend.mockResolvedValue(s3Object("png", "image/png"));

    const response = await get(["uploads", "avatars", "a.png"]);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png");
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox"
    );
  });

  it.each(["text/html", "image/svg+xml", "application/xml", undefined])(
    "forces %s to download inside a sandbox",
    async (contentType) => {
      mockSend.mockResolvedValue(s3Object("<script></script>", contentType));

      const response = await get(["uploads", "attachments", "x"]);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toBe("attachment");
      expect(response.headers.get("Content-Security-Policy")).toBe(
        "default-src 'none'; sandbox"
      );
    }
  );

  it("serves PDFs inline without the sandbox CSP", async () => {
    mockSend.mockResolvedValue(s3Object("%PDF", "application/pdf"));

    const response = await get(["uploads", "attachments", "doc.pdf"]);

    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("returns 404 when the object does not exist", async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error("missing"), { name: "NoSuchKey" })
    );

    const response = await get(["uploads", "attachments", "missing.png"]);

    expect(response.status).toBe(404);
  });
});
