import { beforeEach, describe, expect, it, vi } from "vitest";
import { importIssues } from "./issueImports";
import type { ImportContext } from "./types";

type FakeIssue = {
  id: number;
  externalKey: string;
  integrationId: number;
  externalStatus: string | null;
  externalId: string | null;
};

/**
 * Minimal TxClient stand-in. `issue.findFirst` reproduces the importer's
 * two-query dedup: an enriched-first lookup (externalStatus not null) then a
 * bare fallback, both keyed on externalKey + integrationId.
 */
function makeTx(existingIssues: FakeIssue[] = []) {
  const findFirst = vi.fn(async ({ where }: any) => {
    const matches = existingIssues.filter(
      (i) =>
        i.externalKey === where.externalKey &&
        i.integrationId === where.integrationId
    );
    // Query 1 carries `externalStatus: { not: null }`; query 2 does not.
    if (where.externalStatus && where.externalStatus.not === null) {
      return matches.find((i) => i.externalStatus != null) ?? null;
    }
    return matches[0] ?? null;
  });
  const create = vi.fn(async ({ data }: any) => ({ id: 9999, ...data }));
  return {
    issue: { findFirst, create },
    integration: {
      findUnique: vi.fn().mockResolvedValue({
        provider: "JIRA",
        settings: { baseUrl: "https://jira.example.com" },
      }),
    },
  } as any;
}

function makeContext(): ImportContext {
  return {
    activityLog: [],
    entityProgress: {},
    processedCount: 0,
    startTime: 0,
    lastProgressUpdate: 0,
    jobId: "test-job",
  };
}

const ROW = { id: 1, target_id: 100, project_id: 5, display_id: "ADM-3095" };
const datasetRows = () => new Map<string, any[]>([["issues", [ROW]]]);
const integrationIdMap = () => new Map<number, number>([[100, 42]]);
const projectIdMap = () => new Map<number, number>([[5, 7]]);

describe("importIssues — Testmo externalId regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves externalId null and stores the Jira key in externalKey on create", async () => {
    const tx = makeTx([]); // nothing to dedup against

    const { summary, issueIdMap } = await importIssues(
      tx,
      datasetRows(),
      integrationIdMap(),
      projectIdMap(),
      "user-1",
      makeContext(),
      vi.fn()
    );

    expect(tx.issue.create).toHaveBeenCalledTimes(1);
    const data = tx.issue.create.mock.calls[0][0].data;
    // The core of the bug: the display_id (Jira KEY) must NOT land in
    // externalId — that column holds the integration's native numeric id and a
    // later refresh fills it in without colliding on (externalId, integrationId).
    expect(data.externalId).toBeUndefined();
    expect(data.externalKey).toBe("ADM-3095");
    expect(data.integrationId).toBe(42);
    expect(data.projectId).toBe(7);
    expect(data.externalUrl).toBe("https://jira.example.com/browse/ADM-3095");
    expect(data.data.importedFrom).toBe("testmo");
    expect(summary).toMatchObject({ created: 1, mapped: 0, total: 1 });
    expect(issueIdMap.get(1)).toBe(9999);
  });

  it("reuses the enriched app-synced row (matched by externalKey) instead of minting a duplicate", async () => {
    const tx = makeTx([
      // A bare stub AND an enriched sibling share the key; the importer must
      // pick the enriched one so links point at the row refresh can maintain.
      {
        id: 501,
        externalKey: "ADM-3095",
        integrationId: 42,
        externalStatus: null,
        externalId: null,
      },
      {
        id: 500,
        externalKey: "ADM-3095",
        integrationId: 42,
        externalStatus: "Open",
        externalId: "10001",
      },
    ]);

    const { summary, issueIdMap } = await importIssues(
      tx,
      datasetRows(),
      integrationIdMap(),
      projectIdMap(),
      "user-1",
      makeContext(),
      vi.fn()
    );

    expect(tx.issue.create).not.toHaveBeenCalled();
    expect(issueIdMap.get(1)).toBe(500);
    expect(summary).toMatchObject({ created: 0, mapped: 1 });
  });

  it("matches a bare externalKey row when no enriched sibling exists (still no duplicate)", async () => {
    const tx = makeTx([
      {
        id: 502,
        externalKey: "ADM-3095",
        integrationId: 42,
        externalStatus: null,
        externalId: null,
      },
    ]);

    const { summary, issueIdMap } = await importIssues(
      tx,
      datasetRows(),
      integrationIdMap(),
      projectIdMap(),
      "user-1",
      makeContext(),
      vi.fn()
    );

    expect(tx.issue.create).not.toHaveBeenCalled();
    expect(issueIdMap.get(1)).toBe(502);
    expect(summary).toMatchObject({ created: 0, mapped: 1 });
  });

  it("does not reuse a same-key row from a different integration", async () => {
    const tx = makeTx([
      {
        id: 600,
        externalKey: "ADM-3095",
        integrationId: 99, // different integration
        externalStatus: "Open",
        externalId: "10001",
      },
    ]);

    const { summary, issueIdMap } = await importIssues(
      tx,
      datasetRows(),
      integrationIdMap(),
      projectIdMap(),
      "user-1",
      makeContext(),
      vi.fn()
    );

    expect(tx.issue.create).toHaveBeenCalledTimes(1);
    expect(tx.issue.create.mock.calls[0][0].data.externalId).toBeUndefined();
    expect(issueIdMap.get(1)).toBe(9999);
    expect(summary).toMatchObject({ created: 1, mapped: 0 });
  });
});
