import { describe, expect, it, vi } from "vitest";
import type {
  IssueAdapter,
  IssueAttachmentMeta,
} from "~/lib/integrations/adapters/IssueAdapter";
import { MAX_CONTEXT_IMAGES } from "~/lib/llm/context-images";

const mockResolveEditorMediaAttachments = vi.fn();
vi.mock("~/lib/integrations/editorMediaAttachments", () => ({
  resolveEditorMediaAttachments: (...args: unknown[]) =>
    mockResolveEditorMediaAttachments(...args),
}));

import {
  imageMimeFromFilename,
  resolveAttachmentImageMime,
  resolveEditorImages,
  resolveIssueAttachmentImages,
} from "./context-image-sources";

const meta = (
  id: string,
  filename: string,
  mimeType?: string
): IssueAttachmentMeta => ({ id, filename, mimeType });

const makeAdapter = (
  attachments: IssueAttachmentMeta[],
  download: (
    m: IssueAttachmentMeta
  ) => Promise<{ buffer: Buffer; mimeType?: string }> = async () => ({
    buffer: Buffer.from("png-bytes"),
  })
) =>
  ({
    listAttachments: vi.fn().mockResolvedValue(attachments),
    downloadAttachment: vi.fn().mockImplementation(download),
  }) as unknown as IssueAdapter;

describe("imageMimeFromFilename / resolveAttachmentImageMime", () => {
  it("guesses from extension", () => {
    expect(imageMimeFromFilename("shot.PNG")).toBe("image/png");
    expect(imageMimeFromFilename("photo.jpeg")).toBe("image/jpeg");
    expect(imageMimeFromFilename("logs.txt")).toBeUndefined();
    expect(imageMimeFromFilename("archive.tar.gz")).toBeUndefined();
  });

  it("prefers declared mime, falls back to extension, rejects non-images", () => {
    expect(resolveAttachmentImageMime(meta("1", "x.bin", "image/png"))).toBe(
      "image/png"
    );
    // ADO stores no mime — extension carries it.
    expect(resolveAttachmentImageMime(meta("2", "shot.png"))).toBe("image/png");
    // Generic octet-stream with an image extension still resolves.
    expect(
      resolveAttachmentImageMime(
        meta("3", "shot.jpg", "application/octet-stream")
      )
    ).toBe("image/jpeg");
    expect(
      resolveAttachmentImageMime(meta("4", "video.mp4", "video/mp4"))
    ).toBeUndefined();
  });
});

describe("resolveIssueAttachmentImages", () => {
  const baseArgs = {
    issueKey: "PROJ-1",
    source: "jira-attachment" as const,
  };

  it("returns [] when the adapter cannot read attachments", async () => {
    expect(
      await resolveIssueAttachmentImages({
        ...baseArgs,
        adapter: {} as IssueAdapter,
        attachmentIds: ["1"],
      })
    ).toEqual([]);
    expect(
      await resolveIssueAttachmentImages({
        ...baseArgs,
        adapter: null,
        attachmentIds: ["1"],
      })
    ).toEqual([]);
  });

  it("returns [] with no selection — never downloads unrequested bytes", async () => {
    const adapter = makeAdapter([meta("1", "a.png", "image/png")]);
    expect(
      await resolveIssueAttachmentImages({
        ...baseArgs,
        adapter,
        attachmentIds: [],
      })
    ).toEqual([]);
    expect(adapter.listAttachments).not.toHaveBeenCalled();
  });

  it("intersects the selection with the server-side listing", async () => {
    const adapter = makeAdapter([
      meta("1", "wanted.png", "image/png"),
      meta("2", "unwanted.png", "image/png"),
    ]);
    const images = await resolveIssueAttachmentImages({
      ...baseArgs,
      adapter,
      // "999" is not in the listing — a crafted id resolves to nothing.
      attachmentIds: ["1", "999"],
    });

    expect(images.map((i) => i.filename)).toEqual(["wanted.png"]);
    expect(images[0]).toMatchObject({
      id: "jira-attachment:1",
      source: "jira-attachment",
      mimeType: "image/png",
      byteSize: 9,
      origin: { issueKey: "PROJ-1", attachmentId: "1" },
    });
    expect(adapter.downloadAttachment).toHaveBeenCalledTimes(1);
  });

  it("filters non-images before downloading", async () => {
    const adapter = makeAdapter([
      meta("1", "shot.png", "image/png"),
      meta("2", "logs.txt", "text/plain"),
      meta("3", "video.mp4", "video/mp4"),
    ]);
    const images = await resolveIssueAttachmentImages({
      ...baseArgs,
      adapter,
      attachmentIds: ["1", "2", "3"],
    });

    expect(images.map((i) => i.filename)).toEqual(["shot.png"]);
    expect(adapter.downloadAttachment).toHaveBeenCalledTimes(1);
  });

  it("caps downloads at MAX_CONTEXT_IMAGES + 1", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      meta(String(i), `s${i}.png`, "image/png")
    );
    const adapter = makeAdapter(many);
    const images = await resolveIssueAttachmentImages({
      ...baseArgs,
      adapter,
      attachmentIds: many.map((m) => m.id),
    });

    expect(images).toHaveLength(MAX_CONTEXT_IMAGES + 1);
    expect(adapter.downloadAttachment).toHaveBeenCalledTimes(
      MAX_CONTEXT_IMAGES + 1
    );
  });

  it("tolerates per-item download failures", async () => {
    const adapter = makeAdapter(
      [meta("1", "ok.png", "image/png"), meta("2", "broken.png", "image/png")],
      async (m) => {
        if (m.id === "2") throw new Error("boom");
        return { buffer: Buffer.from("bytes") };
      }
    );
    const images = await resolveIssueAttachmentImages({
      ...baseArgs,
      adapter,
      attachmentIds: ["1", "2"],
    });

    expect(images.map((i) => i.filename)).toEqual(["ok.png"]);
  });

  it("returns [] when the listing itself fails", async () => {
    const adapter = {
      listAttachments: vi.fn().mockRejectedValue(new Error("401")),
      downloadAttachment: vi.fn(),
    } as unknown as IssueAdapter;

    expect(
      await resolveIssueAttachmentImages({
        ...baseArgs,
        adapter,
        attachmentIds: ["1"],
      })
    ).toEqual([]);
  });

  it("prefers the download's mime over the listing's when valid", async () => {
    const adapter = makeAdapter(
      [meta("1", "shot.png", "image/png")],
      async () => ({ buffer: Buffer.from("x"), mimeType: "image/webp" })
    );
    const images = await resolveIssueAttachmentImages({
      ...baseArgs,
      adapter,
      attachmentIds: ["1"],
    });
    expect(images[0].mimeType).toBe("image/webp");
  });
});

describe("resolveEditorImages", () => {
  const doc = { type: "doc", content: [] };
  const att = (src: string, mimeType?: string) => ({
    filename: `f-${src.slice(-6)}`,
    buffer: Buffer.from("bytes"),
    mimeType,
    src,
  });

  it("returns [] with no doc or no selection, without resolving", async () => {
    expect(await resolveEditorImages(null, ["a"])).toEqual([]);
    expect(await resolveEditorImages(doc, [])).toEqual([]);
    expect(await resolveEditorImages(doc, undefined)).toEqual([]);
    expect(mockResolveEditorMediaAttachments).not.toHaveBeenCalled();
  });

  it("filters resolution to the selected srcs and allowed image mimes", async () => {
    mockResolveEditorMediaAttachments.mockResolvedValueOnce([
      att("/api/storage/a.png", "image/png"),
      att("/api/storage/b.png", "image/png"), // not selected
      att("/api/storage/c.mp4", "video/mp4"), // selected but not an image
      att("/api/storage/d.png", undefined), // selected but unknown mime
    ]);

    const images = await resolveEditorImages(doc, [
      "/api/storage/a.png",
      "/api/storage/c.mp4",
      "/api/storage/d.png",
    ]);

    expect(mockResolveEditorMediaAttachments).toHaveBeenCalledWith(doc);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      source: "editor",
      mimeType: "image/png",
      byteSize: 5,
      origin: { editorSrc: "/api/storage/a.png" },
    });
  });

  it("bounds the result at the cap + 1", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      att(`/api/storage/img${String(i).padStart(2, "0")}.png`, "image/png")
    );
    mockResolveEditorMediaAttachments.mockResolvedValueOnce(many);

    const images = await resolveEditorImages(
      doc,
      many.map((a) => a.src)
    );
    expect(images).toHaveLength(MAX_CONTEXT_IMAGES + 1);
  });
});
