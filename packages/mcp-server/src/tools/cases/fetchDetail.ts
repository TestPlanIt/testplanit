import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { CASE_DETAIL_INCLUDE } from "./get.js";
import { buildFolderBreadcrumb, mapCaseDetail } from "./shared.js";

/**
 * Re-fetch a case by ID with full D-10 denormalized detail.
 * Used by create.ts and update.ts after a write to return the CASE-02 shape.
 *
 * Reuses CASE_DETAIL_INCLUDE from get.ts so create/update/get always return
 * the identical shape — and any drift gets caught by the satisfies clause there.
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
      include: CASE_DETAIL_INCLUDE,
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
