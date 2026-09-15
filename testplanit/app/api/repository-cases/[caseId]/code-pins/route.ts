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

/** What the Code Pins table needs to show an issue chip for a ticket pin. */
const pinIssueSelect = {
  id: true,
  name: true,
  externalId: true,
  externalKey: true,
  externalUrl: true,
  title: true,
  description: true,
  externalStatus: true,
  priority: true,
  lastSyncedAt: true,
  integrationId: true,
  integration: { select: { provider: true } },
  issueTypeName: true,
  issueTypeIconUrl: true,
} as const;

/** The issue keys a ticket-scan pin's note lists. */
function noteKeys(note: string | null): string[] {
  return (note ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/**
 * The issues each ISSUE pin names, among those linked to the case. A pin's
 * note holds the keys of the commits' tickets; the link rows are what the
 * scan matched them against, so a key that was unlinked since is left out.
 */
async function issuesForPins(
  db: Awaited<ReturnType<typeof getEnhancedDb>>,
  caseId: number,
  pins: Array<{ id: number; source: string; note: string | null }>
): Promise<Map<number, unknown[]>> {
  const byPin = new Map<number, unknown[]>();
  const keys = new Set<string>();
  for (const pin of pins) {
    if (pin.source !== "ISSUE") continue;
    for (const key of noteKeys(pin.note)) keys.add(key);
  }
  if (keys.size === 0) return byPin;
  const links = await db.repositoryCaseIssue.findMany({
    where: {
      caseId,
      issue: { isDeleted: false, externalKey: { in: [...keys] } },
    },
    select: { issue: { select: pinIssueSelect } },
  });
  const byKey = new Map<string, unknown>();
  for (const link of links) {
    if (link.issue.externalKey) byKey.set(link.issue.externalKey, link.issue);
  }
  for (const pin of pins) {
    if (pin.source !== "ISSUE") continue;
    const issues = noteKeys(pin.note)
      .map((key) => byKey.get(key))
      .filter((issue) => issue !== undefined);
    if (issues.length > 0) byPin.set(pin.id, issues);
  }
  return byPin;
}

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

    const issues = await issuesForPins(db, caseId, pins);

    const staleness = new Map<number, unknown>();
    let stalenessError: string | null = null;
    if (withStaleness) {
      // Pins may span several connected repositories; each is checked
      // against its own repository.
      const configIds = [...new Set(pins.map((pin) => pin.configId))];
      for (const configId of configIds) {
        try {
          const loaded = await loadRepoConfigForUser(session, configId, {
            purpose: "IMPACT",
          });
          if (!loaded) continue;
          const perConfig = await computePinStaleness(
            loaded.config,
            loaded.adapter,
            pins.filter((pin) => pin.configId === configId)
          );
          for (const [pinId, value] of perConfig) staleness.set(pinId, value);
        } catch (error) {
          stalenessError =
            error instanceof Error ? error.message : "Staleness check failed";
        }
      }
    }

    return NextResponse.json({
      pins: pins.map((pin) => ({
        ...pin,
        issues: issues.get(pin.id) ?? [],
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
