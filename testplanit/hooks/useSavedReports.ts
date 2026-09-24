"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";

import {
  auditShareLinkCreation,
  prepareShareLinkData,
} from "@/actions/share-links";
import { buildSharedReportSearchParams } from "~/components/reports/reportShareParams";
import { schema } from "~/zenstack/schema";

/**
 * Saved reports, stored as `ShareLink` rows of entityType SAVED_REPORT — the
 * same mechanism saved searches and saved repository views use
 * (hooks/useSavedRepositoryViews.ts has the full rationale).
 *
 * PRIVACY. `ShareLink.projectId` stays NULL so only the owner can read the
 * row (`@@allow('read', projectId == null && createdBy.id == auth().id)`);
 * the report's project lives inside `entityConfig.projectId`, and this hook
 * narrows the user's reports to the current page in memory. A cross-project
 * report's config has no projectId.
 *
 * A live saved report is created here through the ZenStack hook. A frozen one
 * is created server-side (useCreateFrozenReportLink) because its captured
 * output must never come from the client.
 */

export const SAVED_REPORT_ENTITY_TYPE = "SAVED_REPORT" as const;
export const SAVED_REPORT_NAME_MAX_LENGTH = 200;
export const SAVED_REPORT_DESCRIPTION_MAX_LENGTH = 1000;

/** A user rarely has more than a handful; the cap bounds the fetch. */
export const SAVED_REPORTS_FETCH_LIMIT = 200;

export interface SavedReport {
  id: string;
  shareKey: string;
  title: string;
  description: string | null;
  config: Record<string, unknown>;
  /** The config's project; null for a cross-project report. */
  projectId: number | null;
  frozen: {
    capturedAt: Date;
    truncated: boolean;
  } | null;
}

interface SavedReportRow {
  id: string;
  shareKey: string;
  title: string | null;
  description: string | null;
  entityConfig: unknown;
  snapshot?: { capturedAt: Date | string; truncated: boolean } | null;
}

/** The project a stored config belongs to, or null for cross-project. */
export function savedReportProjectId(config: unknown): number | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>).projectId;
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The config a saved report stores for the page it was saved from: a project
 * report carries its project, a cross-project report carries none.
 */
export function buildSavedReportConfig(
  reportConfig: Record<string, unknown>,
  projectId: number | null
): Record<string, unknown> {
  const { projectId: _ignored, ...rest } = reportConfig;
  return projectId !== null ? { ...rest, projectId } : rest;
}

/**
 * Where a saved report opens: a frozen one in the share viewer, which serves
 * its captured output; a live one on the Reports page, rebuilt from its
 * config through the same URL contract share links use, plus
 * `savedReport=<id>` so the page can show its name and description.
 */
export function savedReportHref(report: SavedReport): string {
  if (report.frozen) return `/share/${report.shareKey}`;
  const searchParams = buildSharedReportSearchParams(report.config);
  // Lets the Reports page name the saved report it is showing.
  searchParams.set("savedReport", report.id);
  const params = searchParams.toString();
  return report.projectId !== null
    ? `/projects/reports/${report.projectId}?${params}`
    : `/admin/reports?${params}`;
}

export interface UseSavedReportsOptions {
  /** The page's project; null on the cross-project reports page. */
  projectId: number | null;
  /** Defer the query until the menu opens. */
  enabled?: boolean;
}

export interface SaveLiveReportInput {
  name: string;
  description?: string | null;
  reportConfig: Record<string, unknown>;
}

export function useSavedReports({
  projectId,
  enabled = true,
}: UseSavedReportsOptions) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const queries = useClientQueries(schema);

  const { data, isLoading } = queries.shareLink.useFindMany(
    {
      where: {
        entityType: SAVED_REPORT_ENTITY_TYPE,
        createdById: userId ?? "",
        projectId: null,
        isDeleted: false,
        isRevoked: false,
      },
      include: {
        snapshot: { select: { capturedAt: true, truncated: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: SAVED_REPORTS_FETCH_LIMIT,
    },
    { enabled: enabled && !!userId }
  );

  const { mutateAsync: createShareLink, isPending: isSaving } =
    queries.shareLink.useCreate();
  const { mutateAsync: updateShareLink, isPending: isMutating } =
    queries.shareLink.useUpdate();

  const reports = useMemo<SavedReport[]>(() => {
    const rows = (data ?? []) as SavedReportRow[];
    const parsed: SavedReport[] = [];
    for (const row of rows) {
      const config = row.entityConfig;
      if (
        !config ||
        typeof config !== "object" ||
        typeof (config as Record<string, unknown>).reportType !== "string"
      ) {
        continue;
      }
      const configProjectId = savedReportProjectId(config);
      if (configProjectId !== projectId) continue;
      parsed.push({
        id: row.id,
        shareKey: row.shareKey,
        title: row.title ?? "",
        description: row.description,
        config: config as Record<string, unknown>,
        projectId: configProjectId,
        frozen: row.snapshot
          ? {
              capturedAt: new Date(row.snapshot.capturedAt),
              truncated: row.snapshot.truncated,
            }
          : null,
      });
    }
    return parsed;
  }, [data, projectId]);

  const saveLiveReport = useCallback(
    async ({ name, description, reportConfig }: SaveLiveReportInput) => {
      if (!userId) {
        throw new Error("A signed-in user is required to save a report");
      }
      const title = name.trim().slice(0, SAVED_REPORT_NAME_MAX_LENGTH);
      if (!title) {
        throw new Error("A saved report name is required");
      }

      const { shareKey, passwordHash } = await prepareShareLinkData({
        password: null,
      });

      const created = await createShareLink({
        data: {
          shareKey,
          entityType: SAVED_REPORT_ENTITY_TYPE,
          entityConfig: buildSavedReportConfig(reportConfig, projectId) as any,
          createdById: userId,
          mode: "AUTHENTICATED",
          passwordHash,
          expiresAt: null,
          notifyOnView: false,
          title,
          description:
            description?.trim().slice(0, SAVED_REPORT_DESCRIPTION_MAX_LENGTH) ||
            null,
        },
      });
      if (!created) {
        throw new Error("Failed to save report");
      }

      try {
        await auditShareLinkCreation({
          id: created.id,
          shareKey: created.shareKey,
          entityType: created.entityType,
          mode: created.mode,
          title: created.title,
          projectId: projectId ?? undefined,
          expiresAt: created.expiresAt,
          notifyOnView: created.notifyOnView,
          hasPassword: false,
        });
      } catch (error) {
        console.error("Error auditing saved report creation:", error);
      }

      return created.id;
    },
    [userId, projectId, createShareLink]
  );

  const renameReport = useCallback(
    async ({
      id,
      name,
      description,
    }: {
      id: string;
      name: string;
      description?: string | null;
    }) => {
      const title = name.trim().slice(0, SAVED_REPORT_NAME_MAX_LENGTH);
      if (!title) {
        throw new Error("A saved report name is required");
      }
      await updateShareLink({
        where: { id },
        data: {
          title,
          description:
            description?.trim().slice(0, SAVED_REPORT_DESCRIPTION_MAX_LENGTH) ||
            null,
        },
      });
    },
    [updateShareLink]
  );

  const deleteReport = useCallback(
    async (id: string) => {
      await updateShareLink({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    },
    [updateShareLink]
  );

  return {
    reports,
    isLoading,
    saveLiveReport,
    renameReport,
    deleteReport,
    isSaving,
    isMutating,
  };
}
