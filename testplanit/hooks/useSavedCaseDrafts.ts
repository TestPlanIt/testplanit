"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useCallback } from "react";
import {
  countStagedCasesByProject,
  isCaseDraftPayload,
  savedCaseDraftKey,
  toCaseDraftColumn,
  type CaseDraftPayload,
  type StagedCaseProjectCount,
} from "~/lib/services/caseDraft";
import { randomUuid } from "~/utils/randomUuid";
import { schema } from "~/zenstack/schema";

/** A draft the author saved on purpose, as the My Drafts list shows it. */
export interface SavedCaseDraft {
  id: string;
  name: string;
  folderId: number | null;
  folderName: string | null;
  /** True when the target folder has been deleted since the draft was saved. */
  folderMissing: boolean;
  payload: CaseDraftPayload;
  rowCount: number;
  problemCount: number;
  updatedAt: Date;
}

export interface SaveCaseDraftInput {
  name: string;
  folderId: number;
  payload: CaseDraftPayload;
  rowCount: number;
  problemCount: number;
}

const toColumn = toCaseDraftColumn;

/**
 * The current user's saved drafts in a project, and the writes the My Drafts
 * list and the two editors make to them. Reads and writes go through the
 * CaseDraft policy, which admits the author only, so no caller filters by
 * user id except to keep the query key per user.
 */
export function useSavedCaseDrafts(projectId: number, userId?: string) {
  const client = useClientQueries(schema);
  const enabled = !!userId && Number.isFinite(projectId) && projectId > 0;

  const { data, isLoading } = client.caseDraft.useFindMany(
    {
      where: { projectId, userId: userId ?? "", isSaved: true },
      include: {
        folder: { select: { id: true, name: true, isDeleted: true } },
      },
      orderBy: { updatedAt: "desc" },
    },
    { enabled }
  );

  const drafts: SavedCaseDraft[] = (data ?? []).flatMap((row) => {
    const payload = row.payload as unknown;
    if (!isCaseDraftPayload(payload)) return [];
    const folderGone = !row.folder || row.folder.isDeleted;
    return [
      {
        id: row.id,
        name: row.name ?? "",
        folderId: folderGone ? null : (row.folder?.id ?? null),
        folderName: folderGone ? null : (row.folder?.name ?? null),
        folderMissing: folderGone,
        payload,
        rowCount: row.rowCount,
        problemCount: row.problemCount,
        updatedAt: new Date(row.updatedAt),
      },
    ];
  });

  const { mutateAsync: createDraft } = client.caseDraft.useCreate();
  const { mutateAsync: updateDraft } = client.caseDraft.useUpdate();
  const { mutateAsync: deleteDraft } = client.caseDraft.useDelete();

  const save = useCallback(
    async (input: SaveCaseDraftInput): Promise<string> => {
      if (!userId) throw new Error("Not signed in");
      const id = randomUuid();
      await createDraft({
        data: {
          id,
          draftKey: savedCaseDraftKey(id),
          isSaved: true,
          name: input.name,
          rowCount: input.rowCount,
          problemCount: input.problemCount,
          project: { connect: { id: projectId } },
          user: { connect: { id: userId } },
          folder: { connect: { id: input.folderId } },
          payload: toColumn(input.payload),
        },
      });
      return id;
    },
    [createDraft, projectId, userId]
  );

  const update = useCallback(
    async (id: string, changes: Partial<SaveCaseDraftInput>): Promise<void> => {
      await updateDraft({
        where: { id },
        data: {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.rowCount !== undefined
            ? { rowCount: changes.rowCount }
            : {}),
          ...(changes.problemCount !== undefined
            ? { problemCount: changes.problemCount }
            : {}),
          ...(changes.folderId !== undefined
            ? { folder: { connect: { id: changes.folderId } } }
            : {}),
          ...(changes.payload !== undefined
            ? { payload: toColumn(changes.payload) }
            : {}),
        },
      });
    },
    [updateDraft]
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await deleteDraft({ where: { id } });
    },
    [deleteDraft]
  );

  return { drafts, isLoading, save, update, remove };
}

/**
 * How many cases the user has staged in each OTHER project, so the sheet can
 * remind them where their staged work lives. The policy already limits the
 * rows to the author's own and to projects they can add cases in.
 */
export function useStagedCasesElsewhere(
  projectId: number,
  userId?: string
): StagedCaseProjectCount[] {
  const client = useClientQueries(schema);
  const enabled = !!userId && Number.isFinite(projectId) && projectId > 0;
  const { data } = client.caseDraft.useFindMany(
    {
      where: {
        userId: userId ?? "",
        isSaved: true,
        projectId: { not: projectId },
        project: { isDeleted: false },
      },
      select: {
        projectId: true,
        project: { select: { name: true, iconUrl: true } },
      },
    },
    { enabled }
  );
  return countStagedCasesByProject(data ?? []);
}
