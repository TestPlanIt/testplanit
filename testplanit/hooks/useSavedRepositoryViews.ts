"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";

import {
  auditShareLinkCreation,
  prepareShareLinkData,
} from "@/actions/share-links";
import type { FilterDimensionRegistry } from "~/lib/repository/filterDimensions";
import {
  buildSavedRepositoryViewConfig,
  parseSavedRepositoryViewConfigWithReport,
  SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_REPOSITORY_VIEW_ENTITY_TYPE,
  SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH,
  type SavedRepositoryViewCriteria,
} from "~/lib/schemas/savedRepositoryView";
import { schema } from "~/zenstack/schema";

/**
 * Saved repository views, stored as `ShareLink` rows of entityType
 * REPOSITORY_VIEW — the same persistence mechanism saved unified searches use
 * (components/search/SavedSearchesMenu.tsx). No custom API routes: reads and
 * writes go through the ZenStack shareLink hooks, so the ShareLink policies in
 * schema.zmodel are the only authorization.
 *
 * PRIVACY. `ShareLink.projectId` is left NULL on purpose. The ShareLink read
 * rules grant every member of a project read access to that project's links
 * (`@@allow('read', projectId != null && ...assignedUsers/userPermissions...)`),
 * so a project-scoped row would be visible to the whole project; the only
 * DB-enforced private shape is `@@allow('read', projectId == null &&
 * createdBy.id == auth().id)`, which is exactly what saved searches rely on.
 * The owning project therefore lives INSIDE `entityConfig.projectId`, and this
 * hook filters the user's views down to the current project in memory after
 * parsing. `mode` is always AUTHENTICATED: PUBLIC/PASSWORD_PROTECTED describe
 * anonymous link audiences, which a saved view never has.
 *
 * The natural v2 upgrade for "share this view with the project" is to set
 * `ShareLink.projectId` on the row (the creator may update it) and list
 * without the `createdById` filter — no schema change needed, and the
 * private/shared distinction stays enforced by the policy engine rather than
 * by a client-side flag.
 */

/**
 * A user rarely has more than a handful of saved views; the cap keeps the
 * cross-project fetch (see PRIVACY above) bounded regardless.
 */
export const SAVED_REPOSITORY_VIEWS_FETCH_LIMIT = 200;

export interface SavedRepositoryView {
  id: string;
  title: string;
  description: string | null;
  updatedAt: Date | null;
  criteria: SavedRepositoryViewCriteria;
  /** Persisted predicates that no longer parse (deleted custom field, …). */
  droppedPredicateCount: number;
  /** True when the persisted grouping axis no longer resolves. */
  axisDropped: boolean;
}

export interface UseSavedRepositoryViewsOptions {
  projectId: number;
  /** The active mode's registry — the parse validator for stored predicates. */
  registry: FilterDimensionRegistry;
  /** Dynamic-field ids that still exist, so a stale `?view=` axis degrades. */
  knownDynamicAxisFieldIds?: ReadonlySet<number>;
  /** Defer the query until the menu opens, mirroring SavedSearchesMenu. */
  enabled?: boolean;
}

export interface SaveRepositoryViewInput {
  name: string;
  description?: string | null;
  criteria: Omit<SavedRepositoryViewCriteria, "projectId">;
}

export interface RenameRepositoryViewInput {
  id: string;
  name: string;
  description?: string | null;
}

export interface UseSavedRepositoryViewsResult {
  views: SavedRepositoryView[];
  /** Rows of this user that failed to parse (corrupt or newer version). */
  unreadableCount: number;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
  saveView: (input: SaveRepositoryViewInput) => Promise<string>;
  renameView: (input: RenameRepositoryViewInput) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  isSaving: boolean;
  isMutating: boolean;
}

interface ShareLinkRow {
  id: string;
  title: string | null;
  description: string | null;
  entityConfig: unknown;
  updatedAt: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function useSavedRepositoryViews({
  projectId,
  registry,
  knownDynamicAxisFieldIds,
  enabled = true,
}: UseSavedRepositoryViewsOptions): UseSavedRepositoryViewsResult {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const queries = useClientQueries(schema);

  const {
    data,
    isLoading,
    refetch: refetchQuery,
  } = queries.shareLink.useFindMany(
    {
      where: {
        entityType: SAVED_REPOSITORY_VIEW_ENTITY_TYPE,
        createdById: userId ?? "",
        projectId: null,
        isDeleted: false,
        isRevoked: false,
      },
      orderBy: { updatedAt: "desc" },
      take: SAVED_REPOSITORY_VIEWS_FETCH_LIMIT,
    },
    { enabled: enabled && !!userId }
  );

  const { mutateAsync: createShareLink, isPending: isSaving } =
    queries.shareLink.useCreate();
  const { mutateAsync: updateShareLink, isPending: isUpdating } =
    queries.shareLink.useUpdate();

  const { views, unreadableCount } = useMemo(() => {
    const rows = (data ?? []) as ShareLinkRow[];
    const parsed: SavedRepositoryView[] = [];
    let unreadable = 0;

    for (const row of rows) {
      const result = parseSavedRepositoryViewConfigWithReport(
        row.entityConfig,
        {
          registry,
          expectedProjectId: projectId,
          knownDynamicAxisFieldIds,
        }
      );
      if (!result.criteria) {
        // A config for ANOTHER project is not unreadable, just not ours.
        if (result.status !== "invalid" || isForThisProject(row, projectId)) {
          unreadable += 1;
        }
        continue;
      }
      parsed.push({
        id: row.id,
        title: row.title ?? "",
        description: row.description,
        updatedAt: toDate(row.updatedAt),
        criteria: result.criteria,
        droppedPredicateCount: result.droppedPredicateCount,
        axisDropped: result.axisDropped,
      });
    }

    return { views: parsed, unreadableCount: unreadable };
  }, [data, registry, projectId, knownDynamicAxisFieldIds]);

  const refetch = useCallback(() => refetchQuery(), [refetchQuery]);

  const saveView = useCallback(
    async ({ name, description, criteria }: SaveRepositoryViewInput) => {
      if (!userId) {
        throw new Error("A signed-in user is required to save a view");
      }
      const title = name.trim().slice(0, SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH);
      if (!title) {
        throw new Error("A saved view name is required");
      }

      const { shareKey, passwordHash } = await prepareShareLinkData({
        password: null,
      });

      const created = await createShareLink({
        data: {
          shareKey,
          entityType: SAVED_REPOSITORY_VIEW_ENTITY_TYPE,
          entityConfig: buildSavedRepositoryViewConfig({
            ...criteria,
            projectId,
          }),
          createdById: userId,
          mode: "AUTHENTICATED",
          passwordHash,
          expiresAt: null,
          notifyOnView: false,
          title,
          description:
            description
              ?.trim()
              .slice(0, SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH) || null,
        },
      });

      if (!created) {
        throw new Error("Failed to save repository view");
      }

      try {
        await auditShareLinkCreation({
          id: created.id,
          shareKey: created.shareKey,
          entityType: created.entityType,
          mode: created.mode,
          title: created.title,
          projectId,
          expiresAt: created.expiresAt,
          notifyOnView: created.notifyOnView,
          hasPassword: !!passwordHash,
        });
      } catch (error) {
        // The view IS saved at this point; a failed audit write must not be
        // reported to the user as a failed save.
        console.error("Error auditing saved repository view creation:", error);
      }

      await refetch();
      return created.id;
    },
    [userId, projectId, createShareLink, refetch]
  );

  const renameView = useCallback(
    async ({ id, name, description }: RenameRepositoryViewInput) => {
      const title = name.trim().slice(0, SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH);
      if (!title) {
        throw new Error("A saved view name is required");
      }
      await updateShareLink({
        where: { id },
        data: {
          title,
          description:
            description
              ?.trim()
              .slice(0, SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH) || null,
        },
      });
      await refetch();
    },
    [updateShareLink, refetch]
  );

  const deleteView = useCallback(
    async (id: string) => {
      // Soft delete, matching saved searches and the project-wide convention.
      await updateShareLink({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await refetch();
    },
    [updateShareLink, refetch]
  );

  return {
    views,
    unreadableCount,
    isLoading: enabled && !!userId ? isLoading : false,
    refetch,
    saveView,
    renameView,
    deleteView,
    isSaving,
    isMutating: isSaving || isUpdating,
  };
}

/**
 * Cheap projectId probe used only to decide whether an unparseable row counts
 * against `unreadableCount` — a view saved for a different project is simply
 * filtered out, not reported as corrupt.
 */
function isForThisProject(row: ShareLinkRow, projectId: number): boolean {
  const config = row.entityConfig;
  if (typeof config !== "object" || config === null) return true;
  const candidate = (config as { projectId?: unknown }).projectId;
  return typeof candidate === "number" ? candidate === projectId : true;
}
