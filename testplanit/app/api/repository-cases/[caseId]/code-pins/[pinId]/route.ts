import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  anchorPin,
  codePinUpdateSchema,
  MAX_PIN_RANGE_LINES,
  PinAnchorError,
  pinUpdateMovesAnchor,
  rejectedPinUpdateFields,
} from "~/lib/services/impact/codePins";
import { RefNotFoundError } from "~/lib/services/impact/compareService";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

const pinSelect = {
  id: true,
  caseId: true,
  configId: true,
  kind: true,
  filePath: true,
  startLine: true,
  endLine: true,
  symbol: true,
  anchorSha: true,
  anchorSnippet: true,
  source: true,
  note: true,
  staleDismissedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * PATCH /api/repository-cases/[caseId]/code-pins/[pinId]
 * Moves an existing pin within the file it already names, or edits its note.
 * Kind and file stay fixed, so analyses that recorded this pin still describe
 * the code it points at; a GLOB pin's pattern is the exception (it is the
 * only thing that pin points at). Re-anchors whenever the target moves, which
 * also clears a stale dismissal earned by the previous target.
 * Gate order: 401 -> 400 -> 404 -> 409 (managed/duplicate) -> 422 (anchor) ->
 * 403 -> 200.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; pinId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { caseId: rawCaseId, pinId: rawPinId } = await params;
  const caseId = Number(rawCaseId);
  const pinId = Number(rawPinId);
  if (!Number.isInteger(caseId) || !Number.isInteger(pinId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = codePinUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  try {
    const db = await getEnhancedDb(session);
    const pin = await db.repositoryCaseCodePin.findFirst({
      where: { id: pinId, caseId, isDeleted: false },
      select: {
        id: true,
        configId: true,
        kind: true,
        filePath: true,
        startLine: true,
        endLine: true,
        symbol: true,
        source: true,
      },
    });
    if (!pin) {
      return NextResponse.json({ error: "Pin not found" }, { status: 404 });
    }
    if (pin.source === "ANNOTATION" || pin.source === "MAPFILE") {
      return NextResponse.json(
        { error: "Pin is managed by the repository", code: "managed" },
        { status: 409 }
      );
    }

    const rejected = rejectedPinUpdateFields(pin.kind, patch);
    if (rejected.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot change ${rejected.join(", ")} on a ${pin.kind} pin`,
          code: "field_not_editable",
        },
        { status: 400 }
      );
    }

    const movesAnchor = pinUpdateMovesAnchor(patch);
    const filePath = patch.filePath ?? pin.filePath;
    const symbol = patch.symbol ?? pin.symbol ?? undefined;
    const startLine = patch.startLine ?? pin.startLine ?? undefined;
    // A new start with no end means one line, not the end the pin used to have.
    const endLine =
      patch.endLine ??
      (patch.startLine === undefined ? (pin.endLine ?? undefined) : undefined);

    if (pin.kind === "RANGE" && startLine !== undefined) {
      const effectiveEnd = endLine ?? startLine;
      if (effectiveEnd < startLine) {
        return NextResponse.json(
          { error: "End line is before the start line" },
          { status: 400 }
        );
      }
      if (effectiveEnd - startLine + 1 > MAX_PIN_RANGE_LINES) {
        return NextResponse.json(
          { error: `Range is longer than ${MAX_PIN_RANGE_LINES} lines` },
          { status: 400 }
        );
      }
    }

    let anchor = null;
    if (movesAnchor) {
      const loaded = await loadRepoConfigForUser(session, pin.configId, {
        purpose: "IMPACT",
      });
      if (!loaded) {
        return NextResponse.json(
          { error: "Impact repository not configured" },
          { status: 404 }
        );
      }
      try {
        anchor = await anchorPin(loaded.config, loaded.adapter, {
          kind: pin.kind,
          filePath,
          startLine,
          endLine,
          symbol,
          ref: patch.ref,
        });
      } catch (error) {
        if (error instanceof PinAnchorError) {
          return NextResponse.json(
            { error: error.message, code: error.code },
            { status: 422 }
          );
        }
        if (error instanceof RefNotFoundError) {
          return NextResponse.json({ error: error.message }, { status: 404 });
        }
        throw error;
      }

      const duplicate = await db.repositoryCaseCodePin.findFirst({
        where: {
          id: { not: pinId },
          caseId,
          configId: pin.configId,
          kind: pin.kind,
          filePath,
          startLine: anchor.startLine,
          endLine: anchor.endLine,
          symbol: symbol ?? null,
          isDeleted: false,
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Pin already exists", id: duplicate.id },
          { status: 409 }
        );
      }
    }

    const updated = await db.repositoryCaseCodePin.update({
      where: { id: pinId },
      data: {
        ...(patch.note !== undefined ? { note: patch.note || null } : {}),
        ...(anchor
          ? {
              filePath,
              symbol: symbol ?? null,
              startLine: anchor.startLine,
              endLine: anchor.endLine,
              anchorSha: anchor.anchorSha,
              anchorSnippet: anchor.anchorSnippet,
              anchorHash: anchor.anchorHash,
              // The dismissal belonged to the old target.
              staleDismissedAt: null,
            }
          : {}),
      },
      select: pinSelect,
    });
    return NextResponse.json({ pin: updated });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Code pin update error:", error);
    return NextResponse.json(
      { error: "Failed to update code pin" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/repository-cases/[caseId]/code-pins/[pinId]
 * Soft-deletes a manual or AI pin. Repository-managed pins (ANNOTATION,
 * MAPFILE) are owned by the marker scan and cannot be removed here.
 * Gate order: 401 -> 400 -> 404 -> 409 -> 403 -> 200.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string; pinId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { caseId: rawCaseId, pinId: rawPinId } = await params;
  const caseId = Number(rawCaseId);
  const pinId = Number(rawPinId);
  if (!Number.isInteger(caseId) || !Number.isInteger(pinId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const db = await getEnhancedDb(session);
    const pin = await db.repositoryCaseCodePin.findFirst({
      where: { id: pinId, caseId, isDeleted: false },
      select: { id: true, source: true },
    });
    if (!pin) {
      return NextResponse.json({ error: "Pin not found" }, { status: 404 });
    }
    if (pin.source === "ANNOTATION" || pin.source === "MAPFILE") {
      return NextResponse.json(
        { error: "Pin is managed by the repository", code: "managed" },
        { status: 409 }
      );
    }
    await db.repositoryCaseCodePin.update({
      where: { id: pinId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Code pin delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete code pin" },
      { status: 500 }
    );
  }
}
