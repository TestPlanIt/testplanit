"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { FrozenReportMeta } from "~/lib/reports/frozenReportMeta";

export interface FrozenTruncation {
  totalRowCount: number;
  maxRows: number;
}

export interface CreateFrozenReportLinkInput {
  entityType: "REPORT" | "SAVED_REPORT";
  reportConfig: Record<string, unknown>;
  projectId: number | null;
  mode?: "AUTHENTICATED" | "PUBLIC" | "PASSWORD_PROTECTED";
  password?: string | null;
  expiresAt?: string | null;
  notifyOnView?: boolean;
  title: string;
  description?: string | null;
  allowTruncate?: boolean;
}

export interface FrozenReportLink {
  id: string;
  shareKey: string;
  entityType: string;
  mode: string;
  title: string | null;
  description: string | null;
  projectId: number | null;
  expiresAt: string | null;
  notifyOnView: boolean;
  viewCount: number;
  createdAt: string;
  frozen: FrozenReportMeta;
}

export type CreateFrozenReportLinkResult =
  | { status: "created"; link: FrozenReportLink }
  | { status: "truncation-required"; truncation: FrozenTruncation };

/** The public URL of a share link; middleware adds the viewer's locale. */
export function buildShareUrl(shareKey: string): string {
  return `${window.location.protocol}//${window.location.host}/share/${shareKey}`;
}

/**
 * Creates a frozen report link through /api/reports/frozen-links. A report
 * over the row cap comes back as "truncation-required" so the caller can warn
 * and resend with `allowTruncate`.
 */
export function useCreateFrozenReportLink() {
  const queryClient = useQueryClient();
  const [isCreatingFrozen, setIsCreatingFrozen] = useState(false);

  const createFrozenLink = useCallback(
    async (
      input: CreateFrozenReportLinkInput
    ): Promise<CreateFrozenReportLinkResult> => {
      setIsCreatingFrozen(true);
      try {
        const response = await fetch("/api/reports/frozen-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await response.json().catch(() => null);

        if (
          response.status === 409 &&
          data?.code === "SNAPSHOT_TRUNCATION_REQUIRED"
        ) {
          return {
            status: "truncation-required",
            truncation: {
              totalRowCount: data.totalRowCount,
              maxRows: data.maxRows,
            },
          };
        }
        if (!response.ok) {
          throw new Error(data?.error || "Failed to create frozen report");
        }

        // The link was written server-side; refresh any ShareLink lists.
        await queryClient.invalidateQueries({
          queryKey: ["zenstack", "ShareLink"],
        });
        return { status: "created", link: data as FrozenReportLink };
      } finally {
        setIsCreatingFrozen(false);
      }
    },
    [queryClient]
  );

  return { createFrozenLink, isCreatingFrozen };
}
