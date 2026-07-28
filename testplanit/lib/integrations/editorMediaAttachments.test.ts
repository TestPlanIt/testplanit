import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockS3Send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = mockS3Send;
  },
  GetObjectCommand: vi.fn(),
}));

import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  extractEditorMediaSrcs,
  filenameForEditorMediaSrc,
  resolveEditorMediaAttachments,
} from "./editorMediaAttachments";

describe("editorMediaAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AWS_BUCKET_NAME", "test-bucket");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("extractEditorMediaSrcs", () => {
    it("collects image and video srcs anywhere in the doc, deduplicated, in order", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before " },
              { type: "image", attrs: { src: "/api/storage/uploads/a.png" } },
            ],
          },
          { type: "video", attrs: { src: "/api/storage/uploads/b.mp4" } },
          {
            type: "blockquote",
            content: [
              { type: "image", attrs: { src: "/api/storage/uploads/a.png" } },
            ],
          },
        ],
      };

      expect(extractEditorMediaSrcs(doc)).toEqual([
        "/api/storage/uploads/a.png",
        "/api/storage/uploads/b.mp4",
      ]);
    });

    it("returns an empty list for non-doc input and nodes without a src", () => {
      expect(extractEditorMediaSrcs(null)).toEqual([]);
      expect(extractEditorMediaSrcs("plain text")).toEqual([]);
      expect(
        extractEditorMediaSrcs({
          type: "doc",
          content: [{ type: "image", attrs: {} }],
        })
      ).toEqual([]);
    });
  });

  describe("filenameForEditorMediaSrc", () => {
    it("strips the presigned-upload timestamp suffix", () => {
      expect(
        filenameForEditorMediaSrc(
          "https://minio.example.com/test-bucket/uploads/documentation-images/5/screenshot.png_1753651200000",
          0
        )
      ).toBe("screenshot.png");
    });

    it("recovers the original name from proxy-upload keys", () => {
      expect(
        filenameForEditorMediaSrc(
          "/api/storage/uploads/document-images/5/screenshot.png_1753651200000_screenshot.png",
          0
        )
      ).toBe("screenshot.png");
    });

    it("decodes URL-encoded names and passes plain names through", () => {
      expect(
        filenameForEditorMediaSrc(
          "https://minio.example.com/test-bucket/uploads/my%20shot.png_1753651200000",
          0
        )
      ).toBe("my shot.png");
      expect(filenameForEditorMediaSrc("/api/storage/uploads/img.png", 0)).toBe(
        "img.png"
      );
    });

    it("synthesizes a name for base64 data URIs from the mime subtype", () => {
      expect(
        filenameForEditorMediaSrc("data:image/png;base64,iVBORw0KGgo=", 2)
      ).toBe("embedded-media-3.png");
    });
  });

  describe("resolveEditorMediaAttachments", () => {
    const s3Response = (bytes: string, contentType?: string) => ({
      Body: Readable.from([Buffer.from(bytes)]),
      ContentType: contentType,
    });

    const docWith = (...srcs: string[]) => ({
      type: "doc",
      content: srcs.map((src) => ({ type: "image", attrs: { src } })),
    });

    it("reads proxy-served srcs from storage by object key", async () => {
      mockS3Send.mockResolvedValueOnce(s3Response("png-bytes", "image/png"));

      const result = await resolveEditorMediaAttachments(
        docWith(
          "/api/storage/uploads/document-images/5/shot.png_1753651200000_shot.png"
        )
      );

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "uploads/document-images/5/shot.png_1753651200000_shot.png",
      });
      expect(result).toEqual([
        {
          filename: "shot.png",
          buffer: Buffer.from("png-bytes"),
          mimeType: "image/png",
        },
      ]);
    });

    it("maps path-style presigned URLs on the configured endpoint to keys", async () => {
      vi.stubEnv("AWS_PUBLIC_ENDPOINT_URL", "https://minio.example.com");
      mockS3Send.mockResolvedValueOnce(s3Response("bytes"));

      await resolveEditorMediaAttachments(
        docWith(
          "https://minio.example.com/test-bucket/uploads/documentation-images/5/shot.png_1753651200000"
        )
      );

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "uploads/documentation-images/5/shot.png_1753651200000",
      });
    });

    it("maps virtual-hosted AWS URLs to keys", async () => {
      mockS3Send.mockResolvedValueOnce(s3Response("bytes"));

      await resolveEditorMediaAttachments(
        docWith(
          "https://test-bucket.s3.us-east-1.amazonaws.com/uploads/documentation-images/5/shot.png_1753651200000"
        )
      );

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "uploads/documentation-images/5/shot.png_1753651200000",
      });
    });

    it("never fetches srcs that point outside this instance's storage", async () => {
      const result = await resolveEditorMediaAttachments(
        docWith("https://evil.example.com/uploads/anything.png")
      );

      expect(mockS3Send).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("decodes base64 data URIs without touching storage", async () => {
      const result = await resolveEditorMediaAttachments(
        docWith(
          `data:image/png;base64,${Buffer.from("inline").toString("base64")}`
        )
      );

      expect(mockS3Send).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          filename: "embedded-media-1.png",
          buffer: Buffer.from("inline"),
          mimeType: "image/png",
        },
      ]);
    });

    it("skips files that fail to load and keeps the rest", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockS3Send
        .mockRejectedValueOnce(new Error("NoSuchKey"))
        .mockResolvedValueOnce(s3Response("ok-bytes", "image/jpeg"));

      const result = await resolveEditorMediaAttachments(
        docWith(
          "/api/storage/uploads/missing.png",
          "/api/storage/uploads/ok.jpg"
        )
      );

      expect(result).toEqual([
        {
          filename: "ok.jpg",
          buffer: Buffer.from("ok-bytes"),
          mimeType: "image/jpeg",
        },
      ]);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("returns an empty list for plain-string descriptions", async () => {
      expect(await resolveEditorMediaAttachments("just text")).toEqual([]);
      expect(await resolveEditorMediaAttachments(undefined)).toEqual([]);
    });
  });
});
