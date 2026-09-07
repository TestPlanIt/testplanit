import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  anchorPin,
  PinAnchorError,
  type CodePinKind,
} from "~/lib/services/impact/codePins";
import { RefNotFoundError } from "~/lib/services/impact/compareService";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

const bodySchema = z.object({
  ref: z.string().trim().min(1).max(255).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

/**
 * POST /api/repository-cases/[caseId]/code-pins/[pinId]/reanchor
 * Re-reads the pinned block at `ref` (default: the config branch tip) and
 * rewrites the anchor. RANGE pins may pass new lines; otherwise the stored
 * lines are re-validated at the new commit. Clears the stale dismissal.
 */
export async function POST(
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

  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const db = await getEnhancedDb(session);
    const pin = await db.repositoryCaseCodePin.findFirst({
      where: { id: pinId, caseId, isDeleted: false },
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
    const loaded = await loadRepoConfigForUser(session, pin.configId, {
      purpose: "IMPACT",
    });
    if (!loaded) {
      return NextResponse.json(
        { error: "Impact repository not configured" },
        { status: 404 }
      );
    }

    let anchor;
    try {
      anchor = await anchorPin(loaded.config, loaded.adapter, {
        kind: pin.kind as CodePinKind,
        filePath: pin.filePath,
        startLine: parsed.data.startLine ?? pin.startLine,
        endLine: parsed.data.endLine ?? pin.endLine,
        symbol: pin.symbol,
        ref: parsed.data.ref,
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

    const updated = await db.repositoryCaseCodePin.update({
      where: { id: pinId },
      data: {
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        anchorSha: anchor.anchorSha,
        anchorSnippet: anchor.anchorSnippet,
        anchorHash: anchor.anchorHash,
        staleDismissedAt: null,
      },
    });
    return NextResponse.json({ pin: updated });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Code pin reanchor error:", error);
    return NextResponse.json(
      { error: "Failed to re-anchor code pin" },
      { status: 500 }
    );
  }
}
