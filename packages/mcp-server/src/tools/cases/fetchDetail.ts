import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { TestPlanItHttpError } from "../../http.js";
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
    // BL-03: surface the orphan caseId via a TestPlanItHttpError so the
    // create/update outer catch can compensate (soft-delete the case)
    // and the error mapper passes the structured 404 through to the
    // agent rather than the generic "Network or runtime error" branch.
    throw new TestPlanItHttpError(
      `Case ${caseId} not found after write — this is unexpected.`,
      { statusCode: 404 },
    );
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
