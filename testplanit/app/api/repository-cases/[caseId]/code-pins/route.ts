import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  anchorPin,
  codePinCreateSchema,
  computePinStaleness,
  PinAnchorError,
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

function parseCaseId(raw: string): number | null {
  const caseId = Number(raw);
  return Number.isInteger(caseId) && caseId > 0 ? caseId : null;
}

/**
 * GET /api/repository-cases/[caseId]/code-pins?staleness=0
 * Live pins on a case with computed staleness against the branch tip.
 * Gate order: 401 -> 400 -> 200 (policy filters rows the caller cannot read).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caseId = parseCaseId((await params).caseId);
  if (caseId === null) {
    return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
  }
  const withStaleness = req.nextUrl.searchParams.get("staleness") !== "0";

  try {
    const db = await getEnhancedDb(session);
    const pins = await db.repositoryCaseCodePin.findMany({
      where: { caseId, isDeleted: false },
      orderBy: [{ filePath: "asc" }, { startLine: "asc" }, { id: "asc" }],
      select: pinSelect,
    });

    let staleness = new Map<number, unknown>();
    let stalenessError: string | null = null;
    const configId = pins[0]?.configId;
    if (withStaleness && configId !== undefined) {
      try {
        const loaded = await loadRepoConfigForUser(session, configId, {
          purpose: "IMPACT",
        });
        if (loaded) {
          staleness = await computePinStaleness(
            loaded.config,
            loaded.adapter,
            pins
          );
        }
      } catch (error) {
        stalenessError =
          error instanceof Error ? error.message : "Staleness check failed";
      }
    }

    return NextResponse.json({
      pins: pins.map((pin) => ({
        ...pin,
        staleness: staleness.get(pin.id) ?? null,
      })),
      stalenessError,
    });
  } catch (error) {
    console.error("Code pins read error:", error);
    return NextResponse.json(
      { error: "Failed to load code pins" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/repository-cases/[caseId]/code-pins
 * Create a manual pin. The server resolves the ref, reads the file, and
 * stamps the anchor; the client never supplies anchor fields.
 * Gate order: 401 -> 400 -> 404 (config/case) -> 409 (duplicate) ->
 * 422 (anchor) -> 403 (policy) -> 201.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caseId = parseCaseId((await params).caseId);
  if (caseId === null) {
    return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
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
  const parsed = codePinCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const loaded = await loadRepoConfigForUser(session, input.configId, {
      purpose: "IMPACT",
    });
    if (!loaded) {
      return NextResponse.json(
        { error: "Impact repository not configured" },
        { status: 404 }
      );
    }
    const db = await getEnhancedDb(session);
    const testCase = await db.repositoryCases.findFirst({
      where: {
        id: caseId,
        projectId: loaded.config.projectId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    let anchor;
    try {
      anchor = await anchorPin(loaded.config, loaded.adapter, input);
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
        caseId,
        configId: input.configId,
        kind: input.kind,
        filePath: input.filePath,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        symbol: input.symbol ?? null,
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

    const created = await db.repositoryCaseCodePin.create({
      data: {
        caseId,
        configId: input.configId,
        kind: input.kind,
        filePath: input.filePath,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        symbol: input.symbol ?? null,
        anchorSha: anchor.anchorSha,
        anchorSnippet: anchor.anchorSnippet,
        anchorHash: anchor.anchorHash,
        source: "MANUAL",
        note: input.note ?? null,
        createdById: session.user.id,
      },
      select: pinSelect,
    });
    return NextResponse.json({ pin: created }, { status: 201 });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Code pin create error:", error);
    return NextResponse.json(
      { error: "Failed to create code pin" },
      { status: 500 }
    );
  }
}
