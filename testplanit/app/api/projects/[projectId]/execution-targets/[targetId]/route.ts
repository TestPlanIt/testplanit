import { NextResponse, type NextRequest } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  deleteExecutionTargetForActor,
  getExecutionTargetForActor,
  updateExecutionTargetForActor,
} from "~/lib/execution/executionTargetsService";
import {
  isRouteResponse,
  parseId,
  resolveExecutionTargetActor,
} from "~/lib/execution/targetAccess";
import { getServerAuthSession } from "~/server/auth";

function errorStatus(error: string): number {
  if (error === "Unauthorized") return 401;
  if (error === "Forbidden") return 403;
  if (error === "Target not found") return 404;
  return 422;
}

/**
 * GET /api/projects/{projectId}/execution-targets/{targetId}
 * The full target record (minus raw credentials, which are never
 * serialized — see ExecutionTargetView) for whoever can manage it. Unlike
 * the collection GET's sanitized list, this requires manage permission, not
 * just dispatch permission, since staticInputs/url/paramSchema are more than
 * the run-page dialog needs.
 */
export const GET = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ targetId: string }> }
  ) => {
    const { targetId: raw } = await params;
    const targetId = parseId(raw);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: "Invalid target id" }, { status: 400 });
    }
    const session = await getServerAuthSession();
    const resolved = await resolveExecutionTargetActor(request, session);
    if (isRouteResponse(resolved)) return resolved;

    const result = await getExecutionTargetForActor(resolved.actor, targetId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: errorStatus(result.error) }
      );
    }
    return NextResponse.json(
      { target: result.target },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
);

/**
 * PATCH /api/projects/{projectId}/execution-targets/{targetId}
 * Body: a partial update — same shape as POST, every field optional. Set
 * `credentials: null` to clear a stored override, `rotateSecret: true` to
 * mint a new generic-webhook signing secret (returned once as
 * `revealedSecret`).
 */
export const PATCH = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ targetId: string }> }
  ) => {
    const { targetId: raw } = await params;
    const targetId = parseId(raw);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: "Invalid target id" }, { status: 400 });
    }
    const session = await getServerAuthSession();
    const resolved = await resolveExecutionTargetActor(request, session);
    if (isRouteResponse(resolved)) return resolved;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await updateExecutionTargetForActor(
      resolved.actor,
      targetId,
      body as Parameters<typeof updateExecutionTargetForActor>[2]
    );
    if (!result.success) {
      return NextResponse.json(
        { error: result.error, code: result.errorCode },
        { status: errorStatus(result.error) }
      );
    }
    return NextResponse.json({
      target: result.target,
      revealedSecret: result.revealedSecret,
    });
  }
);

/**
 * DELETE /api/projects/{projectId}/execution-targets/{targetId}
 * Soft-delete; past executions keep their history (see
 * deleteExecutionTargetForActor).
 */
export const DELETE = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ targetId: string }> }
  ) => {
    const { targetId: raw } = await params;
    const targetId = parseId(raw);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: "Invalid target id" }, { status: 400 });
    }
    const session = await getServerAuthSession();
    const resolved = await resolveExecutionTargetActor(request, session);
    if (isRouteResponse(resolved)) return resolved;

    const result = await deleteExecutionTargetForActor(
      resolved.actor,
      targetId
    );
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: errorStatus(result.error) }
      );
    }
    return new NextResponse(null, { status: 204 });
  }
);
