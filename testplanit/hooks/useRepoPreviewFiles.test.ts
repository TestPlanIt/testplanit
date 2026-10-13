import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepoPreviewFiles } from "./useRepoPreviewFiles";

function sseBody(chunks: string[]) {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => ({
    done: false as const,
    value: encoder.encode(chunk),
  }));
  return {
    getReader: () => ({
      read: vi.fn(async () =>
        queue.length
          ? queue.shift()!
          : { done: true as const, value: undefined }
      ),
    }),
  };
}

const request = {
  branch: "main",
  pathPatterns: [{ path: "src", pattern: "**/*" }],
  cacheEnabled: true,
};

describe("useRepoPreviewFiles", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("posts the request body to the preview-files route", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: sseBody([]),
    });
    const { result } = renderHook(() =>
      useRepoPreviewFiles({ networkErrorMessage: "net" })
    );

    await act(async () => {
      await result.current.runPreview(7, request);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/code-repositories/7/preview-files",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(request),
      })
    );
  });

  it("reads progress then the completed result from the SSE stream, splitting across chunks", async () => {
    const complete = {
      type: "complete",
      files: [{ path: "src/a.ts", size: 10 }],
      fileCount: 1,
      totalSize: 10,
      totalSizeFormatted: "10 B",
      exceedsLimit: false,
      overflowBytes: 0,
      truncated: false,
    };
    const progress = JSON.stringify({
      type: "progress",
      step: "listing",
      filesFound: 3,
      scope: "src",
    });
    const completeLine = `data: ${JSON.stringify(complete)}\n`;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: sseBody([
        `data: ${progress}\n`,
        "garbage line\n",
        completeLine.slice(0, 20),
        completeLine.slice(20),
      ]),
    });
    const { result } = renderHook(() =>
      useRepoPreviewFiles({ networkErrorMessage: "net" })
    );

    await act(async () => {
      await result.current.runPreview("7", request);
    });

    expect(result.current.preview).toEqual(complete);
    expect(result.current.previewProgress).toBeNull();
    expect(result.current.isPreviewing).toBe(false);
  });

  it("surfaces a non-OK response's error and an SSE error event as a failed preview", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    });
    const { result } = renderHook(() =>
      useRepoPreviewFiles({ networkErrorMessage: "net" })
    );

    await act(async () => {
      await result.current.runPreview(7, request);
    });
    expect(result.current.preview).toMatchObject({
      error: "Forbidden",
      fileCount: 0,
      files: [],
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: sseBody([
        `data: ${JSON.stringify({ type: "error", error: "Rate limited" })}\n`,
      ]),
    });
    await act(async () => {
      await result.current.runPreview(7, request);
    });
    expect(result.current.preview?.error).toBe("Rate limited");
  });

  it("uses the network error message when the request throws, and clearPreview resets", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline")
    );
    const { result } = renderHook(() =>
      useRepoPreviewFiles({ networkErrorMessage: "Network down" })
    );

    await act(async () => {
      await result.current.runPreview(7, request);
    });
    expect(result.current.preview?.error).toBe("Network down");

    act(() => result.current.clearPreview());
    expect(result.current.preview).toBeNull();
  });
});
