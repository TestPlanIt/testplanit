"use client";

import { useState } from "react";

export interface RepoPreviewFile {
  path: string;
  size: number;
}

export interface RepoPreviewResult {
  files: RepoPreviewFile[];
  fileCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  exceedsLimit: boolean;
  overflowBytes: number;
  truncated: boolean;
  error?: string;
}

export interface RepoPreviewProgress {
  step: string;
  filesFound?: number;
  scope?: string;
  totalFiles?: number;
  waitSeconds?: number;
}

export interface RepoPreviewRequest {
  branch?: string;
  pathPatterns: { path: string; pattern: string }[];
  cacheEnabled: boolean;
}

function failedPreview(error: string | undefined): RepoPreviewResult {
  return {
    files: [],
    fileCount: 0,
    totalSize: 0,
    totalSizeFormatted: "0 B",
    exceedsLimit: false,
    overflowBytes: 0,
    truncated: false,
    error,
  };
}

/**
 * Streams `POST /api/code-repositories/[id]/preview-files` (SSE) into
 * progress + result state for the repository settings pages.
 */
export function useRepoPreviewFiles({
  networkErrorMessage,
}: {
  networkErrorMessage: string;
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [preview, setPreview] = useState<RepoPreviewResult | null>(null);
  const [previewProgress, setPreviewProgress] =
    useState<RepoPreviewProgress | null>(null);

  const runPreview = async (
    repositoryId: string | number,
    request: RepoPreviewRequest
  ) => {
    setIsPreviewing(true);
    setPreview(null);
    setPreviewProgress(null);

    try {
      const response = await fetch(
        `/api/code-repositories/${repositoryId}/preview-files`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => ({ error: "Request failed" }));
        setPreview(failedPreview(data.error));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === "progress") {
              setPreviewProgress({
                step: event.step,
                filesFound: event.filesFound,
                scope: event.scope,
                totalFiles: event.totalFiles,
                waitSeconds: event.waitSeconds,
              });
            } else if (event.type === "complete") {
              setPreview(event);
            } else if (event.type === "error") {
              setPreview(failedPreview(event.error));
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch {
      setPreview(failedPreview(networkErrorMessage));
    } finally {
      setIsPreviewing(false);
      setPreviewProgress(null);
    }
  };

  const clearPreview = () => setPreview(null);

  return { isPreviewing, preview, previewProgress, runPreview, clearPreview };
}
