import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { buildFolderBreadcrumb, mapCaseDetail } from "./shared.js";

/**
 * Re-fetch a case by ID with full D-10 denormalized detail.
 * Used by create.ts and update.ts after a write to return the CASE-02 shape.
 *
 * The include shape is identical to what get.ts uses so agents always see
 * a consistent response regardless of whether they called create, update, or get.
 */
export async function fetchCaseDetail(
  caseId: number,
  env: EnvConfig,
): Promise<ReturnType<typeof mapCaseDetail>> {
  const raw = await zenstack<{
    folder: { id: number; name: string; parentId: number | null };
    [k: string]: unknown;
  }>(
    "repositoryCases",
    "findUnique",
    {
      where: { id: caseId },
      include: {
        project: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true, parentId: true } },
        state: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, email: true } },
        tags: { select: { id: true, name: true } },
        issues: {
          select: {
            id: true,
            externalKey: true,
            integration: { select: { provider: true } },
            title: true,
            externalStatus: true,
          },
        },
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          select: {
            id: true,
            step: true,
            expectedResult: true,
            order: true,
          },
        },
        caseFieldValues: {
          include: { field: { select: { displayName: true } } },
        },
        linksFrom: {
          where: { isDeleted: false },
          include: {
            caseB: { select: { id: true, name: true, source: true } },
          },
        },
        linksTo: {
          where: { isDeleted: false },
          include: {
            caseA: { select: { id: true, name: true, source: true } },
          },
        },
      },
    },
    env,
  );

  if (!raw) {
    throw new Error(`Case ${caseId} not found after write — this is unexpected.`);
  }

  const breadcrumb = await buildFolderBreadcrumb(
    {
      id: raw.folder.id,
      name: raw.folder.name,
      parentId: raw.folder.parentId,
    },
    env,
  );

  return mapCaseDetail(raw as never, breadcrumb);
}
