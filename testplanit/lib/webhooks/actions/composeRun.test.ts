import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFilterEligible,
  mockEmit,
  mockForecast,
  mockSync,
  mockWithAuditGuc,
} = vi.hoisted(() => ({
  mockFilterEligible: vi.fn(),
  mockEmit: vi.fn(),
  mockForecast: vi.fn(),
  mockSync: vi.fn(),
  mockWithAuditGuc: vi.fn(),
}));

vi.mock("~/lib/services/runCaseEligibility", () => ({
  filterEligibleCaseIds: (...a: unknown[]) => mockFilterEligible(...a),
}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunCreated: (...a: unknown[]) => mockEmit(...a),
}));
vi.mock("~/services/forecastService", () => ({
  updateTestRunForecast: (...a: unknown[]) => mockForecast(...a),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: (...a: unknown[]) => mockSync(...a),
}));
vi.mock("~/lib/audit/gucContext", () => ({
  buildGucPayload: (userId: string) => ({ userId, source: "app" }),
  withAuditGuc: (...a: unknown[]) => mockWithAuditGuc(...a),
}));

import { composeRunFromCases, runNote } from "./composeRun";

function makeDb(
  opts: {
    live?: number[];
    defaultWorkflow?: { id: number } | null;
    anyWorkflow?: { id: number } | null;
  } = {}
) {
  const tx = {
    testRuns: {
      create: vi.fn(async ({ data }: any) => ({ id: 300, ...data })),
    },
  };
  const db = {
    repositoryCases: {
      findMany: vi
        .fn()
        .mockResolvedValue((opts.live ?? [10, 11, 12]).map((id) => ({ id }))),
    },
    workflows: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(
          opts.defaultWorkflow === undefined ? { id: 5 } : opts.defaultWorkflow
        )
        .mockResolvedValueOnce(
          opts.anyWorkflow === undefined ? null : opts.anyWorkflow
        ),
    },
  };
  return { db, tx };
}

const input = {
  projectId: 3,
  name: "PR #12: Fix checkout",
  caseIds: [12, 10, 11],
  links: [{ label: "PR #12", url: "https://github.com/acme/app/pull/12" }],
  createdById: "system-automation-user",
  tenantId: "t-1",
};

let currentTx: any;

describe("runNote", () => {
  it("writes one paragraph per link, the label linked to its URL, or the label alone", () => {
    expect(
      runNote([
        { label: "PR #12", url: "https://x/pull/12" },
        { label: "main a…b", url: null },
      ])
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "PR #12",
              marks: [{ type: "link", attrs: { href: "https://x/pull/12" } }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "main a…b" }] },
      ],
    });
  });

  it("appends the given nodes after the link paragraphs", () => {
    const appendix = [
      { type: "paragraph", content: [{ type: "text", text: "More" }] },
      { type: "bulletList", content: [] },
    ];
    expect(
      runNote([{ label: "main a…b", url: null }], appendix).content
    ).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "main a…b" }] },
      ...appendix,
    ]);
  });
});

describe("composeRunFromCases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilterEligible.mockImplementation(
      async (_db: unknown, args: { repositoryCaseIds: number[] }) =>
        args.repositoryCaseIds
    );
    mockEmit.mockResolvedValue(undefined);
    mockForecast.mockResolvedValue(undefined);
    mockSync.mockResolvedValue(undefined);
    mockWithAuditGuc.mockImplementation(
      async (_db: unknown, _guc: unknown, fn: (tx: unknown) => unknown) =>
        fn(currentTx)
    );
  });

  function setup(opts?: Parameters<typeof makeDb>[0]) {
    const made = makeDb(opts);
    currentTx = made.tx;
    return made;
  }

  it("creates the run of the eligible live cases in order, under the default workflow, as the actor", async () => {
    const { db, tx } = setup();

    const result = await composeRunFromCases(db, {
      ...input,
      issueIds: [7, 8],
    });

    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 3 });
    expect(db.repositoryCases.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [12, 10, 11] },
        projectId: 3,
        isDeleted: false,
        isArchived: false,
      },
      select: { id: true },
    });
    expect(mockFilterEligible).toHaveBeenCalledWith(db, {
      projectId: 3,
      repositoryCaseIds: [12, 10, 11],
    });
    expect(mockWithAuditGuc).toHaveBeenCalledWith(
      db,
      {
        userId: "system-automation-user",
        source: "worker",
        tenantId: "t-1",
      },
      expect.any(Function)
    );
    const data = tx.testRuns.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectId: 3,
      name: "PR #12: Fix checkout",
      stateId: 5,
      createdById: "system-automation-user",
      testRunType: "REGULAR",
      testCases: {
        create: [
          { repositoryCase: { connect: { id: 12 } }, order: 0 },
          { repositoryCase: { connect: { id: 10 } }, order: 1 },
          { repositoryCase: { connect: { id: 11 } }, order: 2 },
        ],
      },
      issues: { connect: [{ id: 7 }, { id: 8 }] },
    });
    expect(data.note).toEqual(runNote(input.links));
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 300 }),
      tx,
      { actorUserId: "system-automation-user" }
    );
    expect(mockForecast).toHaveBeenCalledWith(300, { dbClient: db });
    expect(mockSync).toHaveBeenCalledWith(300, "t-1");
  });

  it("drops duplicates and cases that are deleted, archived, from another project or ineligible", async () => {
    const { db, tx } = setup({ live: [10, 11] });
    mockFilterEligible.mockResolvedValueOnce([11]);

    const result = await composeRunFromCases(db, {
      ...input,
      caseIds: [12, 11, 10, 11],
    });

    expect(db.repositoryCases.findMany.mock.calls[0][0].where.id).toEqual({
      in: [12, 11, 10],
    });
    expect(mockFilterEligible.mock.calls[0][1].repositoryCaseIds).toEqual([
      11, 10,
    ]);
    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 1 });
    expect(tx.testRuns.create.mock.calls[0][0].data.testCases.create).toEqual([
      { repositoryCase: { connect: { id: 11 } }, order: 0 },
    ]);
  });

  it("links no issues when none are given", async () => {
    const { db, tx } = setup();
    await composeRunFromCases(db, { ...input, issueIds: [] });
    expect(tx.testRuns.create.mock.calls[0][0].data).not.toHaveProperty(
      "issues"
    );
  });

  it("makes no run when no cases were asked for", async () => {
    const { db } = setup();
    expect(await composeRunFromCases(db, { ...input, caseIds: [] })).toEqual({
      created: false,
      reason: "no_cases",
    });
    expect(db.repositoryCases.findMany).not.toHaveBeenCalled();
  });

  it("makes no run when no asked-for case is live and eligible", async () => {
    const { db, tx } = setup({ live: [] });
    expect(await composeRunFromCases(db, input)).toEqual({
      created: false,
      reason: "no_cases",
    });
    expect(db.workflows.findFirst).not.toHaveBeenCalled();
    expect(tx.testRuns.create).not.toHaveBeenCalled();
  });

  it("falls back to the first enabled run workflow without a default", async () => {
    const { db, tx } = setup({ defaultWorkflow: null, anyWorkflow: { id: 8 } });

    await composeRunFromCases(db, input);

    expect(db.workflows.findFirst.mock.calls[0][0].where).toMatchObject({
      scope: "RUNS",
      isDefault: true,
      isEnabled: true,
      isDeleted: false,
      projects: { some: { projectId: 3 } },
    });
    expect(db.workflows.findFirst.mock.calls[1][0]).toMatchObject({
      where: { scope: "RUNS", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    expect(tx.testRuns.create.mock.calls[0][0].data.stateId).toBe(8);
  });

  it("makes no run when the project has no enabled run workflow", async () => {
    const { db, tx } = setup({ defaultWorkflow: null, anyWorkflow: null });
    expect(await composeRunFromCases(db, input)).toEqual({
      created: false,
      reason: "no_workflow",
    });
    expect(tx.testRuns.create).not.toHaveBeenCalled();
  });

  it("truncates a long name to 200 characters", async () => {
    const { db, tx } = setup();
    await composeRunFromCases(db, { ...input, name: "x".repeat(400) });
    expect(tx.testRuns.create.mock.calls[0][0].data.name).toHaveLength(200);
  });

  it("sets a null tenant in the audit context without one", async () => {
    const { db } = setup();
    await composeRunFromCases(db, { ...input, tenantId: undefined });
    expect(mockWithAuditGuc.mock.calls[0][1].tenantId).toBeNull();
    expect(mockSync).toHaveBeenCalledWith(300, undefined);
  });

  it("still reports the run when the forecast or search sync fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockForecast.mockRejectedValueOnce(new Error("forecast down"));
    mockSync.mockRejectedValueOnce(new Error("es down"));
    const { db } = setup();

    expect(await composeRunFromCases(db, input)).toEqual({
      created: true,
      testRunId: 300,
      caseCount: 3,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("fails when the run cannot be created, without forecasting", async () => {
    const { db, tx } = setup();
    tx.testRuns.create.mockRejectedValueOnce(new Error("constraint"));

    await expect(composeRunFromCases(db, input)).rejects.toThrow("constraint");
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockForecast).not.toHaveBeenCalled();
  });
});
