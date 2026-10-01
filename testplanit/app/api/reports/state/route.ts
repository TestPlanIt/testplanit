import { NextRequest } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { reportBuilderStateCreateSchema } from "~/lib/schemas/reportBuilderStateSchema";
import { hashReportBuilderState } from "~/lib/services/reportBuilderState";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

export const dynamic = "force-dynamic";

/**
 * Persisted Report Builder selections. The builder page URL carries
 * `state=<id>` instead of the full selection, so a "Select all" over
 * thousands of filter values no longer produces a URL that ingress rejects.
 *
 * Rows are read and written through the base client on purpose: access is
 * gated on the *project's* read policy via authorizeReportRequest (the same
 * gate every report endpoint uses), so anyone who can open the report page
 * can restore a state from it. The model's own policy still protects the
 * generic RPC surface.
 */

/**
 * POST /api/reports/state
 * Body: { projectId?, reportType, config }. Returns { id } — an existing row
 * with the same project and config hash is reused.
 */
export const POST = withAuditContext(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reportBuilderStateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { projectId, reportType, config } = parsed.data;

  // Cross-project (no projectId) builder reports are admin-only, matching
  // the report endpoints they run against.
  const authz = await authorizeReportRequest(req, {
    requiresAdmin: projectId == null,
    projectId,
  });
  if (!authz.ok) return authz.response;
  if (authz.bypass) {
    // The share-replay token carries no user to own the row.
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configHash = hashReportBuilderState(reportType, config);
  const existing = await baseDb.reportBuilderState.findFirst({
    where: {
      projectId: projectId ?? null,
      configHash,
      // Cross-project rows are only readable by their creator, so they
      // dedupe per user.
      ...(projectId == null ? { createdById: authz.user.userId } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    await baseDb.reportBuilderState.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
    });
    return Response.json({ id: existing.id });
  }

  const created = await baseDb.reportBuilderState.create({
    data: {
      projectId: projectId ?? null,
      createdById: authz.user.userId,
      reportType,
      config,
      configHash,
    },
    select: { id: true },
  });
  return Response.json({ id: created.id }, { status: 201 });
});

/**
 * GET /api/reports/state?id=…
 * Returns { reportType, config } for a row the caller may read and marks it
 * used, so the retention sweep keeps states that are still opened.
 */
export const GET = withAuditContext(async (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const row = await baseDb.reportBuilderState.findUnique({
    where: { id },
    select: { id: true, projectId: true, reportType: true, config: true },
  });
  if (!row) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const authz = await authorizeReportRequest(req, {
    requiresAdmin: row.projectId == null,
    projectId: row.projectId ?? undefined,
  });
  if (!authz.ok) return authz.response;
  if (authz.bypass) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await baseDb.reportBuilderState.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });

  return Response.json({ reportType: row.reportType, config: row.config });
});
