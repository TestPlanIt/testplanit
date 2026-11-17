import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachments, send } = vi.hoisted(() => ({
  attachments: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  send: vi.fn(),
}));

vi.mock("~/lib/s3Client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent: vi.fn() }));
vi.mock("~/lib/services/runCaseStatusSync", () => ({
  syncRunCaseStatusAfterResultRemoval: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: { attachments } }));
vi.mock("../../shared", () => ({
  checkAdminAuth: vi.fn().mockResolvedValue({ userId: "admin" }),
  getTrashModel: () => ({
    modelName: "Attachments",
    idType: "Int",
    model: attachments,
  }),
}));

import { DELETE } from "./route";

async function purge(row: Record<string, unknown>) {
  attachments.findUnique.mockResolvedValue({ id: 7, isDeleted: true, ...row });
  const response = await DELETE(
    new NextRequest("http://localhost/api/admin/trash/Attachments/7", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ itemType: "Attachments", itemId: "7" }) }
  );
  expect(response.status).toBe(200);
}

function deletedKeys() {
  return send.mock.calls.map(([command]) => command.input);
}

describe("DELETE /api/admin/trash/[itemType]/[itemId] — attachment files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachments.findFirst.mockResolvedValue(null);
    vi.stubEnv("AWS_BUCKET_NAME", "tpi-bucket");
    vi.stubEnv("AWS_ENDPOINT_URL", "http://rustfs:9000");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deletes the object behind a proxy URL", async () => {
    await purge({
      url: "/api/storage/uploads/attachments/a.png",
      mimeType: "image/png",
    });
    expect(deletedKeys()).toEqual([
      { Bucket: "tpi-bucket", Key: "uploads/attachments/a.png" },
    ]);
  });

  it("drops the bucket from a path-style URL", async () => {
    await purge({
      url: "http://rustfs:9000/tpi-bucket/uploads/attachments/a.png",
      mimeType: "image/png",
    });
    expect(deletedKeys()).toEqual([
      { Bucket: "tpi-bucket", Key: "uploads/attachments/a.png" },
    ]);
  });

  it("keeps the object while another attachment uses the same file", async () => {
    attachments.findFirst.mockResolvedValue({ id: 8 });
    await purge({
      url: "/api/storage/uploads/attachments/a.png",
      mimeType: "image/png",
    });
    expect(attachments.findFirst).toHaveBeenCalledWith({
      where: { url: "/api/storage/uploads/attachments/a.png" },
      select: { id: true },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("never touches storage for an external link", async () => {
    await purge({
      url: "https://other.example.com/api/storage/uploads/a.png",
      mimeType: "text/uri-list",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves storage alone when the URL is not ours", async () => {
    await purge({ url: "https://example.com/a.png", mimeType: "image/png" });
    expect(send).not.toHaveBeenCalled();
  });
});
