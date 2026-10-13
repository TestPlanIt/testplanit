import { baseDb } from "@/lib/db";
import { NextRequest } from "next/server";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import { parseEnumFilter, parseIdListFilter } from "~/utils/reportFilterParams";
import {
  directoryOf,
  type CodePinCoverageRow,
  type CoverageFilter,
  type PinKind,
  type PinSource,
} from "~/utils/codePinCoverageShared";

export {
  PIN_KINDS,
  PIN_SOURCES,
  ROOT_DIRECTORY,
  directoryOf,
} from "~/utils/codePinCoverageShared";
export type {
  CodePinCoverageRow,
  CoverageFilter,
  PinKind,
  PinSource,
} from "~/utils/codePinCoverageShared";

const zeroKinds = (): Record<PinKind, number> => ({
  FILE: 0,
  RANGE: 0,
  SYMBOL: 0,
  GLOB: 0,
});
const zeroSources = (): Record<PinSource, number> => ({
  MANUAL: 0,
  AI: 0,
  ANNOTATION: 0,
  MAPFILE: 0,
  ISSUE: 0,
});

type PinRecord = {
  caseId: number;
  configId: number;
  filePath: string;
  kind: PinKind;
  source: PinSource;
  case: { projectId: number };
};
type ConnectionRecord = {
  id: number;
  branch: string | null;
  projectId: number;
  repository: { id: number; name: string; provider: string };
  project: { id: number; name: string };
};
type AnalysisRecord = {
  id: number;
  configId: number;
  createdAt: Date;
  result: {
    uncoveredFiles?: string[];
    stalePins?: Array<{ pinId: number; filePath: string }>;
  } | null;
};

/** Pure aggregation, exported for tests. */
export function buildCoverageRows(input: {
  connections: ConnectionRecord[];
  pins: PinRecord[];
  analyses: AnalysisRecord[];
  caseTotals: Map<number, number>;
  includeProject: boolean;
}): CodePinCoverageRow[] {
  const { connections, pins, analyses, caseTotals, includeProject } = input;
  const byConnection = new Map(connections.map((c) => [c.id, c]));
  const casesWithPins = new Map<number, Set<number>>();
  type Bucket = {
    pins: number;
    kinds: Record<PinKind, number>;
    sources: Record<PinSource, number>;
    cases: Set<number>;
    stale: number;
    uncovered: Set<string>;
    analyses: Set<number>;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (configId: number, directory: string): Bucket => {
    const key = `${configId} ${directory}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        pins: 0,
        kinds: zeroKinds(),
        sources: zeroSources(),
        cases: new Set(),
        stale: 0,
        uncovered: new Set(),
        analyses: new Set(),
      };
      buckets.set(key, b);
    }
    return b;
  };

  for (const pin of pins) {
    const connection = byConnection.get(pin.configId);
    if (!connection) continue;
    const b = bucket(pin.configId, directoryOf(pin.filePath));
    b.pins += 1;
    b.kinds[pin.kind] += 1;
    b.sources[pin.source] += 1;
    b.cases.add(pin.caseId);
    let set = casesWithPins.get(connection.projectId);
    if (!set) casesWithPins.set(connection.projectId, (set = new Set()));
    set.add(pin.caseId);
  }

  // Stale pins come from each connection's latest analysis only.
  const latestByConfig = new Map<number, AnalysisRecord>();
  for (const analysis of analyses) {
    if (!byConnection.has(analysis.configId)) continue;
    const current = latestByConfig.get(analysis.configId);
    if (!current || analysis.createdAt > current.createdAt) {
      latestByConfig.set(analysis.configId, analysis);
    }
    for (const file of analysis.result?.uncoveredFiles ?? []) {
      const b = bucket(analysis.configId, directoryOf(file));
      b.uncovered.add(file);
      b.analyses.add(analysis.id);
    }
  }
  for (const analysis of latestByConfig.values()) {
    const seen = new Set<number>();
    for (const stale of analysis.result?.stalePins ?? []) {
      if (seen.has(stale.pinId)) continue;
      seen.add(stale.pinId);
      bucket(analysis.configId, directoryOf(stale.filePath)).stale += 1;
    }
  }

  const rows: CodePinCoverageRow[] = [];
  for (const [key, b] of buckets) {
    const [configIdRaw, directory] = key.split(" ");
    const connection = byConnection.get(Number(configIdRaw))!;
    rows.push({
      repository: {
        configId: connection.id,
        repositoryId: connection.repository.id,
        name: connection.repository.name,
        provider: connection.repository.provider,
        branch: connection.branch,
      },
      directory,
      pinCount: b.pins,
      kindCounts: b.kinds,
      sourceCounts: b.sources,
      caseCount: b.cases.size,
      stalePinCount: b.stale,
      uncoveredFileCount: b.uncovered.size,
      uncoveredAnalysisCount: b.analyses.size,
      sampleUncoveredFiles: [...b.uncovered].sort().slice(0, 5),
      projectCaseTotal: caseTotals.get(connection.projectId) ?? 0,
      projectCasesWithPins: casesWithPins.get(connection.projectId)?.size ?? 0,
      ...(includeProject
        ? {
            project: {
              id: connection.project.id,
              name: connection.project.name,
            },
          }
        : {}),
    });
  }
  rows.sort(
    (a, b) =>
      b.uncoveredFileCount - a.uncoveredFileCount ||
      b.pinCount - a.pinCount ||
      a.repository.name.localeCompare(b.repository.name) ||
      a.directory.localeCompare(b.directory)
  );
  return rows;
}

/**
 * Where Code Pins are, and where recent changes went uncovered: one row per
 * connected repository and directory, from live pins plus the uncovered
 * files and stale pins the analyses in the window reported.
 */
export async function handleCodePinCoverageReportPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    const body = await req.json();
    const authz = await authorizeReportRequest(req, {
      requiresAdmin: isCrossProject,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;

    const {
      projectId,
      lookbackDays = 90,
      configId,
      coverageFilter = "all",
      dimensions = [],
    } = body as {
      projectId?: number | string;
      lookbackDays?: number | string;
      // Lists of accepted values; the single-value form is also accepted.
      configId?: number | string | null | Array<number | string>;
      coverageFilter?: CoverageFilter | Array<"gaps" | "pinned">;
      dimensions?: string[];
    };
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }
    const includeProject = isCrossProject && dimensions.includes("project");
    const lookback =
      Number(lookbackDays) === 0
        ? 0
        : Math.min(Math.max(Number(lookbackDays) || 90, 7), 365);
    const since = lookback === 0 ? null : new Date();
    if (since) since.setDate(since.getDate() - lookback);

    const connectionIds = parseIdListFilter(configId);
    const projectScope = isCrossProject
      ? { project: { isDeleted: false, impactEnabled: true } }
      : { projectId: Number(projectId) };

    const connections = (await baseDb.projectCodeRepositoryConfig.findMany({
      where: {
        purpose: "IMPACT",
        ...projectScope,
        ...(connectionIds ? { id: { in: connectionIds } } : {}),
        repository: { isDeleted: false },
      },
      select: {
        id: true,
        branch: true,
        projectId: true,
        repository: { select: { id: true, name: true, provider: true } },
        project: { select: { id: true, name: true } },
      },
    })) as unknown as ConnectionRecord[];
    const configIds = connections.map((c) => c.id);
    const projectIds = [...new Set(connections.map((c) => c.projectId))];

    const [pins, analyses, caseCounts] = await Promise.all([
      baseDb.repositoryCaseCodePin.findMany({
        where: {
          isDeleted: false,
          configId: { in: configIds },
          case: { isDeleted: false },
        },
        select: {
          caseId: true,
          configId: true,
          filePath: true,
          kind: true,
          source: true,
          case: { select: { projectId: true } },
        },
      }) as unknown as Promise<PinRecord[]>,
      baseDb.impactAnalysis.findMany({
        where: {
          isDeleted: false,
          status: "COMPLETED",
          configId: { in: configIds },
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        select: { id: true, configId: true, createdAt: true, result: true },
      }) as unknown as Promise<AnalysisRecord[]>,
      Promise.all(
        projectIds.map(async (id) => [
          id,
          await baseDb.repositoryCases.count({
            where: { projectId: id, isDeleted: false },
          }),
        ])
      ) as Promise<Array<[number, number]>>,
    ]);

    let rows = buildCoverageRows({
      connections,
      pins,
      analyses,
      caseTotals: new Map(caseCounts),
      includeProject,
    });
    const coverage = parseEnumFilter(coverageFilter, [
      "gaps",
      "pinned",
    ] as const);
    if (coverage) {
      rows = rows.filter(
        (r) =>
          (coverage.includes("gaps") &&
            r.pinCount === 0 &&
            r.uncoveredFileCount > 0) ||
          (coverage.includes("pinned") && r.pinCount > 0)
      );
    }

    return Response.json({
      data: rows,
      total: rows.length,
      lookbackDays: lookback,
    });
  } catch (e: unknown) {
    console.error("Code pin coverage report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
