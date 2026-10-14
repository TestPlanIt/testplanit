import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAlertTriggeredNotification, webhookEmit, resolveRecipients } =
  vi.hoisted(() => ({
    createAlertTriggeredNotification: vi.fn(async () => undefined),
    webhookEmit: vi.fn(async () => ({
      eventId: "evt_1",
      outboxRowId: "who_1",
    })),
    resolveRecipients: vi.fn(async () => ["u1", "u2"]),
  }));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createAlertTriggeredNotification: (...a: unknown[]) =>
      createAlertTriggeredNotification(...(a as [])),
  },
}));
vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: { emit: (...a: unknown[]) => webhookEmit(...(a as [])) },
}));
vi.mock("~/lib/services/alertRecipients", () => ({
  resolveAlertRecipients: (...a: unknown[]) => resolveRecipients(...(a as [])),
}));

import {
  ALERT_WEBHOOK_EVENT,
  AlertEvaluationService,
  type AlertRuleRow,
} from "./alertEvaluation";

const NOW = new Date("2026-10-08T12:00:00Z");

function rule(overrides: Partial<AlertRuleRow> = {}): AlertRuleRow {
  return {
    id: 1,
    projectId: 7,
    name: "Slow checkout",
    metric: "RESULT_DURATION_DEVIATION",
    scopeType: "PROJECT",
    scopeId: null,
    scopeText: null,
    thresholdValue: 50,
    secondaryValue: null,
    direction: "ABOVE",
    baselineType: "MEDIAN",
    baselineWindow: 10,
    minSamples: 3,
    resultSource: "BOTH",
    evaluateOn: "RUN_COMPLETION",
    coverageBasis: "LINKED",
    cooldownMinutes: 60,
    emitWebhook: false,
    ...overrides,
  };
}

interface MockDbOptions {
  rules?: AlertRuleRow[];
  resultRow?: Record<string, unknown> | null;
  junitRow?: Record<string, unknown> | null;
  history?: Array<Record<string, unknown>>;
  folderTree?: number[];
  runTag?: boolean;
  runCounts?: { passed: number; failed: number };
  run?: Record<string, unknown> | null;
  milestones?: Array<Record<string, unknown>>;
  completion?: { completed: number; total: number };
  lastEvent?: { firedAt: Date } | null;
  tagged?: number;
  execution?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  sessionTag?: boolean;
  openRuns?: Array<Record<string, unknown>>;
  project?: Record<string, unknown> | null;
  caseCounts?: { total: number; automated: number };
  stale?: number;
  webhookConfigs?: Array<Record<string, unknown>>;
  deliveries?: { total: number; failed: number };
  previousRunDurations?: number[];
  issueCount?: number;
  llmConfig?: Record<string, unknown> | null;
  llmSpend?: number;
  llmIntegration?: Record<string, unknown> | null;
  llmRecent?: Array<{ success: boolean }>;
  llmRateLimited?: number;
  repoConfigs?: Array<Record<string, unknown>>;
  reauthRows?: Array<Record<string, unknown>>;
  auditOldest?: Date | null;
  lockedUsers?: number;
  lastAutomatedAt?: Date | null;
}

/** A client whose raw queries are routed by the SQL they carry. */
function mockDb(options: MockDbOptions) {
  const queryRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (
        sql.includes('FROM "TestRunResults" r') &&
        sql.includes("WHERE r.id =")
      ) {
        return options.resultRow ? [options.resultRow] : [];
      }
      if (
        sql.includes('FROM "JUnitTestResult" jr') &&
        sql.includes("WHERE jr.id =")
      ) {
        return options.junitRow ? [options.junitRow] : [];
      }
      if (sql.includes("UNION ALL")) return options.history ?? [];
      if (sql.includes("WITH RECURSIVE tree")) {
        return (options.folderTree ?? []).map((id) => ({ id }));
      }
      if (sql.includes('"_TagsToTestRuns" WHERE')) {
        return options.runTag ? [{}] : [];
      }
      if (sql.includes('"_SessionsToTags"'))
        return options.sessionTag ? [{}] : [];
      if (sql.includes("AS passed")) {
        return [options.runCounts ?? { passed: 0, failed: 0 }];
      }
      if (sql.includes('AS "lastActivityAt"')) return options.openRuns ?? [];
      if (sql.includes("AS stale")) return [{ stale: options.stale ?? 0 }];
      if (sql.includes("AS automated")) {
        return [options.caseCounts ?? { total: 0, automated: 0 }];
      }
      if (sql.includes('FROM "WebhookDelivery" d')) {
        return [options.deliveries ?? { total: 0, failed: 0 }];
      }
      if (sql.includes('FROM "LlmUsage" u')) {
        return [{ blocked: options.llmRateLimited ?? 0 }];
      }
      if (sql.includes('JOIN "UserIntegrationAuth" a')) {
        return options.reauthRows ?? [];
      }
      if (sql.includes('FROM "DataChangeLog"')) {
        return options.auditOldest ? [{ ts: options.auditOldest }] : [];
      }
      if (sql.includes('MAX("createdAt") AS last')) {
        return [{ last: options.lastAutomatedAt ?? null }];
      }
      if (sql.includes("tr.elapsed::double precision AS elapsed")) {
        return (options.previousRunDurations ?? []).map((elapsed) => ({
          elapsed,
        }));
      }
      if (sql.includes("AS completed")) {
        const milestoneId = Number((values[0] as number[])?.[0]);
        const completion = options.completion ?? { completed: 0, total: 0 };
        return [{ milestoneId, ...completion }];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  );
  const db = {
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tag: "tx" })
    ),
    alertRule: {
      findMany: vi.fn(async (args: any) =>
        (options.rules ?? []).filter(
          (r) =>
            (args.where.projectId == null ||
              r.projectId === args.where.projectId) &&
            args.where.metric.in.includes(r.metric)
        )
      ),
      update: vi.fn(async () => ({})),
    },
    alertEvent: {
      findFirst: vi.fn(async () => options.lastEvent ?? null),
      create: vi.fn(async () => ({ id: 101 })),
      update: vi.fn(async () => ({})),
    },
    repositoryCaseTag: { count: vi.fn(async () => options.tagged ?? 0) },
    testRuns: { findUnique: vi.fn(async () => options.run ?? null) },
    milestones: { findMany: vi.fn(async () => options.milestones ?? []) },
    testRunExecution: {
      findUnique: vi.fn(async () => options.execution ?? null),
    },
    sessions: { findUnique: vi.fn(async () => options.session ?? null) },
    projects: { findUnique: vi.fn(async () => options.project ?? null) },
    webhookConfig: {
      findMany: vi.fn(async () => options.webhookConfigs ?? []),
    },
    issue: { count: vi.fn(async () => options.issueCount ?? 0) },
    llmProviderConfig: {
      findUnique: vi.fn(async () => options.llmConfig ?? null),
    },
    llmIntegration: {
      findUnique: vi.fn(async () =>
        options.llmIntegration === undefined
          ? { name: "OpenAI", isDeleted: false }
          : options.llmIntegration
      ),
    },
    llmUsage: {
      aggregate: vi.fn(async () => ({
        _sum: { totalCost: options.llmSpend ?? 0 },
      })),
      findMany: vi.fn(async () => options.llmRecent ?? []),
    },
    projectCodeRepositoryConfig: {
      findMany: vi.fn(async () => options.repoConfigs ?? []),
    },
    user: { count: vi.fn(async () => options.lockedUsers ?? 0) },
  };
  return db;
}

const resultRow = {
  id: 500,
  elapsed: 30,
  executedAt: NOW,
  testRunId: 42,
  caseId: 9,
  caseName: "Checkout",
  folderId: 3,
  projectId: 7,
  projectName: "Shop",
  isSuccess: true,
  isFailure: false,
};

const pass = (elapsed: number | null, source = "MANUAL") => ({
  elapsed,
  isSuccess: true,
  isFailure: false,
  source,
});
const fail = (source = "MANUAL") => ({
  elapsed: null,
  isSuccess: false,
  isFailure: true,
  source,
});

describe("AlertEvaluationService — results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRecipients.mockResolvedValue(["u1", "u2"]);
  });

  it("fires a duration rule, records the event, stamps the rule and notifies subscribers", async () => {
    const db = mockDb({
      rules: [rule()],
      resultRow,
      history: [pass(10), pass(12), pass(11)],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });

    const fired = await service.evaluateResult(500, "acme");

    expect(fired).toEqual([
      {
        ruleId: 1,
        subjectType: "CASE",
        subjectId: 9,
        eventId: 101,
        notified: 2,
      },
    ]);
    expect(db.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleId: 1,
          projectId: 7,
          subjectType: "CASE",
          subjectId: 9,
          subjectName: "Checkout",
          baselineValue: 11,
          thresholdValue: 50,
          firedAt: NOW,
        }),
      })
    );
    expect(db.alertRule.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastFiredAt: NOW },
    });
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserIds: ["u1", "u2"],
        eventId: 101,
        ruleName: "Slow checkout",
        metric: "RESULT_DURATION_DEVIATION",
        subjectType: "CASE",
        subjectId: 9,
        testRunId: 42,
        tenantId: "acme",
      })
    );
    expect(db.alertEvent.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: {
        notifiedCount: 2,
        recipientIds: ["u1", "u2"],
        webhookEmitted: false,
      },
    });
    expect(webhookEmit).not.toHaveBeenCalled();
  });

  it("stays silent below the minimum sample size", async () => {
    const db = mockDb({ rules: [rule()], resultRow, history: [pass(10)] });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    expect(await service.evaluateResult(500)).toEqual([]);
    expect(db.alertEvent.create).not.toHaveBeenCalled();
  });

  it("does nothing when the project has no matching rule or the result is gone", async () => {
    const service = new AlertEvaluationService(
      mockDb({ rules: [], resultRow, history: [] }),
      { now: () => NOW }
    );
    expect(await service.evaluateResult(500)).toEqual([]);
    const gone = new AlertEvaluationService(
      mockDb({ rules: [rule()], resultRow: null }),
      { now: () => NOW }
    );
    expect(await gone.evaluateResult(500)).toEqual([]);
  });

  it("respects the cooldown per subject", async () => {
    const db = mockDb({
      rules: [rule({ cooldownMinutes: 120 })],
      resultRow,
      history: [pass(10), pass(12), pass(11)],
      lastEvent: { firedAt: new Date("2026-10-08T11:30:00Z") },
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    expect(await service.evaluateResult(500)).toEqual([]);
    expect(db.alertEvent.create).not.toHaveBeenCalled();
    expect(db.alertEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ruleId: 1, subjectType: "CASE", subjectId: 9 },
      })
    );
  });

  it("matches folder, tag and single-case scopes and skips the rest", async () => {
    const rules = [
      rule({ id: 1, scopeType: "FOLDER", scopeId: 1 }), // tree contains folder 3
      rule({ id: 2, scopeType: "FOLDER", scopeId: 99 }), // tree does not
      rule({ id: 3, scopeType: "TAG", scopeId: 5 }),
      rule({ id: 4, scopeType: "CASE", scopeId: 9 }),
      rule({ id: 5, scopeType: "CASE", scopeId: 10 }),
    ];
    const db = mockDb({
      rules,
      resultRow,
      history: [pass(10), pass(12), pass(11)],
      tagged: 1,
    });
    // Folder 1's subtree contains folder 3; folder 99's does not.
    db.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("WITH RECURSIVE tree")) {
          return values[0] === 1 ? [{ id: 1 }, { id: 3 }] : [{ id: 99 }];
        }
        if (sql.includes("WHERE r.id =")) return [resultRow];
        if (sql.includes("UNION ALL")) return [pass(10), pass(12), pass(11)];
        return [];
      }
    );
    const service = new AlertEvaluationService(db, { now: () => NOW });

    const fired = await service.evaluateResult(500);
    expect(fired.map((f) => f.ruleId)).toEqual([1, 3, 4]);
  });

  it("filters history by the rule's result source and skips rules for the other source", async () => {
    const rules = [
      rule({ id: 1, resultSource: "MANUAL" }),
      rule({ id: 2, resultSource: "AUTOMATED" }),
    ];
    const db = mockDb({
      rules,
      resultRow,
      // Manual history is slow, automated history is fast: a MANUAL-only
      // rule sees a baseline of 10 and fires on 30; a BOTH rule would not.
      history: [
        pass(10),
        pass(10),
        pass(10),
        pass(100, "AUTOMATED"),
        pass(100, "AUTOMATED"),
        pass(100, "AUTOMATED"),
      ],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateResult(500);
    expect(fired.map((f) => f.ruleId)).toEqual([1]);
  });

  it("evaluates regression, consecutive failures and flakiness from the verdict history", async () => {
    const failedRow = { ...resultRow, isSuccess: false, isFailure: true };
    const rules = [
      rule({
        id: 1,
        metric: "CASE_REGRESSED",
        baselineWindow: 3,
        minSamples: 3,
      }),
      rule({ id: 2, metric: "CONSECUTIVE_FAILURES", thresholdValue: 2 }),
      rule({
        id: 3,
        metric: "CASE_FLAKY",
        thresholdValue: 2,
        baselineWindow: 10,
        minSamples: 4,
      }),
    ];
    const db = mockDb({
      rules,
      resultRow: failedRow,
      history: [pass(null), pass(null), pass(null), fail(), pass(null)],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateResult(500);
    // Regressed: last three passed. Consecutive: streak is 1, not 2. Flaky:
    // sequence F P P P F P has 3 flips.
    expect(fired.map((f) => f.ruleId)).toEqual([1, 3]);
  });

  it("evaluates an automated result against AUTOMATED and BOTH rules only", async () => {
    const rules = [
      rule({ id: 1, resultSource: "MANUAL" }),
      rule({ id: 2, resultSource: "BOTH" }),
    ];
    const db = mockDb({
      rules,
      junitRow: { ...resultRow, id: 77, elapsed: 30 },
      history: [
        pass(10, "AUTOMATED"),
        pass(12, "AUTOMATED"),
        pass(11, "AUTOMATED"),
      ],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateJUnitResult(77);
    expect(fired.map((f) => f.ruleId)).toEqual([2]);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ source: "AUTOMATED", resultId: 77 }),
      })
    );
  });

  it("emits the webhook event inside a transaction when the rule asks for it", async () => {
    const db = mockDb({
      rules: [rule({ emitWebhook: true })],
      resultRow,
      history: [pass(10), pass(12), pass(11)],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    await service.evaluateResult(500);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(webhookEmit).toHaveBeenCalledWith(
      ALERT_WEBHOOK_EVENT,
      expect.objectContaining({
        eventId: 101,
        ruleId: 1,
        subjectType: "CASE",
        subjectId: 9,
        subjectUrl: expect.stringContaining(
          "/projects/runs/7/42?selectedCase=9"
        ),
        firedAt: NOW.toISOString(),
      }),
      { projectId: 7, tx: { tag: "tx" }, actorUserId: null }
    );
    expect(db.alertEvent.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: {
        notifiedCount: 2,
        recipientIds: ["u1", "u2"],
        webhookEmitted: true,
      },
    });
  });

  it("keeps the event when notifying fails, and never throws", async () => {
    createAlertTriggeredNotification.mockRejectedValueOnce(new Error("queue"));
    const db = mockDb({
      rules: [rule()],
      resultRow,
      history: [pass(10), pass(12), pass(11)],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateResult(500);
    expect(fired[0].notified).toBe(0);
    expect(db.alertEvent.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { notifiedCount: 0, recipientIds: [], webhookEmitted: false },
    });
  });
});

describe("AlertEvaluationService — runs", () => {
  const run = {
    id: 42,
    name: "Nightly regression",
    projectId: 7,
    testRunType: "REGULAR",
    isCompleted: true,
    isDeleted: false,
    project: { name: "Shop" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveRecipients.mockResolvedValue(["u1"]);
  });

  it("evaluates completion-time rules only on completion, as-results-arrive rules on both", async () => {
    const rules = [
      rule({
        id: 1,
        metric: "RUN_PASS_RATE_BELOW",
        thresholdValue: 90,
        minSamples: 5,
        evaluateOn: "RUN_COMPLETION",
      }),
      rule({
        id: 2,
        metric: "RUN_FAILURE_COUNT",
        thresholdValue: 1,
        evaluateOn: "AS_RESULTS_ARRIVE",
      }),
    ];
    const db = mockDb({ rules, run, runCounts: { passed: 6, failed: 2 } });
    const service = new AlertEvaluationService(db, { now: () => NOW });

    const onResult = await service.evaluateRun(42, "result");
    expect(onResult.map((f) => f.ruleId)).toEqual([2]);

    vi.clearAllMocks();
    const onCompletion = await service.evaluateRun(42, "completion");
    expect(onCompletion.map((f) => f.ruleId)).toEqual([1, 2]);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "RUN",
        subjectId: 42,
        subjectName: "Nightly regression",
        details: expect.objectContaining({
          passRate: 75,
          trigger: "completion",
        }),
      })
    );
  });

  it("matches run-name and tag scopes", async () => {
    const rules = [
      rule({
        id: 1,
        metric: "RUN_FAILURE_COUNT",
        thresholdValue: 0,
        scopeType: "RUN_NAME",
        scopeText: "nightly",
      }),
      rule({
        id: 2,
        metric: "RUN_FAILURE_COUNT",
        thresholdValue: 0,
        scopeType: "RUN_NAME",
        scopeText: "smoke",
      }),
      rule({
        id: 3,
        metric: "RUN_FAILURE_COUNT",
        thresholdValue: 0,
        scopeType: "TAG",
        scopeId: 4,
      }),
    ];
    const db = mockDb({
      rules,
      run,
      runCounts: { passed: 1, failed: 1 },
      runTag: true,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateRun(42, "completion");
    expect(fired.map((f) => f.ruleId)).toEqual([1, 3]);
  });

  it("counts every run type through the EffectiveCaseStatus view", async () => {
    const db = mockDb({
      rules: [rule({ id: 1, metric: "RUN_FAILURE_COUNT", thresholdValue: 0 })],
      run: { ...run, testRunType: "JUNIT" },
      runCounts: { passed: 3, failed: 1 },
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    await service.evaluateRun(42, "completion");
    const countSql = db.$queryRaw.mock.calls
      .map((c) => (c[0] as TemplateStringsArray).join("?"))
      .find((sql) => sql.includes("AS passed"));
    expect(countSql).toContain('"EffectiveCaseStatus"');
    expect(countSql).not.toContain('trc."statusId"');
  });

  it("ignores deleted or missing runs", async () => {
    const service = new AlertEvaluationService(
      mockDb({
        rules: [rule({ metric: "RUN_FAILURE_COUNT" })],
        run: { ...run, isDeleted: true },
      }),
      { now: () => NOW }
    );
    expect(await service.evaluateRun(42, "completion")).toEqual([]);
  });
});

describe("AlertEvaluationService — scheduled milestone pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRecipients.mockResolvedValue(["u1"]);
  });

  it("fires overdue and behind rules per milestone, honouring a single-milestone scope", async () => {
    const rules = [
      rule({ id: 1, projectId: 7, metric: "MILESTONE_OVERDUE" }),
      rule({
        id: 2,
        projectId: 7,
        metric: "MILESTONE_BEHIND",
        thresholdValue: 80,
        secondaryValue: 5,
      }),
      rule({
        id: 3,
        projectId: 7,
        metric: "MILESTONE_BEHIND",
        thresholdValue: 80,
        secondaryValue: 5,
        scopeType: "MILESTONE",
        scopeId: 999,
      }),
    ];
    const db = mockDb({
      rules,
      milestones: [
        {
          id: 20,
          name: "Release 1",
          completedAt: new Date("2026-10-01T00:00:00Z"),
          project: { name: "Shop" },
        },
        {
          id: 21,
          name: "Release 2",
          completedAt: new Date("2026-10-10T00:00:00Z"),
          project: { name: "Shop" },
        },
      ],
      completion: { completed: 2, total: 10 },
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });

    const fired = await service.evaluateScheduled("acme");

    expect(fired.map((f) => [f.ruleId, f.subjectId])).toEqual([
      [1, 20], // overdue
      [2, 21], // behind with 2 days left
    ]);
    expect(db.milestones.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 7, isCompleted: false }),
      })
    );
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "MILESTONE",
        subjectId: 21,
        details: expect.objectContaining({
          completionPercent: 20,
          daysRemaining: 2,
        }),
        tenantId: "acme",
      })
    );
  });

  it("does nothing without scheduled rules", async () => {
    const service = new AlertEvaluationService(mockDb({ rules: [rule()] }), {
      now: () => NOW,
    });
    expect(await service.evaluateScheduled()).toEqual([]);
  });
});

describe("AlertEvaluationService — round two metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRecipients.mockResolvedValue(["u1"]);
  });

  const openRun = {
    id: 42,
    name: "Nightly",
    projectId: 7,
    testRunType: "MANUAL",
    isCompleted: true,
    isDeleted: false,
    elapsed: 600,
    project: { name: "Shop" },
  };

  it("fires a run duration deviation on completion from earlier runs in scope", async () => {
    const db = mockDb({
      rules: [
        rule({
          id: 3,
          metric: "RUN_DURATION_DEVIATION",
          thresholdValue: 50,
          direction: "ABOVE",
          baselineWindow: 5,
          minSamples: 3,
        }),
      ],
      run: openRun,
      previousRunDurations: [300, 320, 280],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    expect(await service.evaluateRun(42, "result")).toEqual([]);
    const fired = await service.evaluateRun(42, "completion");
    expect(fired).toHaveLength(1);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "RUN",
        observedValue: 100,
        baselineValue: 300,
        details: expect.objectContaining({ elapsed: 600, sampleCount: 3 }),
      })
    );
  });

  it("counts issues linked to the run's results", async () => {
    const db = mockDb({
      rules: [
        rule({
          id: 4,
          metric: "RUN_ISSUES_OPENED",
          thresholdValue: 2,
          evaluateOn: "AS_RESULTS_ARRIVE",
        }),
      ],
      run: { ...openRun, isCompleted: false },
      issueCount: 3,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateRun(42, "result");
    expect(fired.map((f) => f.ruleId)).toEqual([4]);
    expect(db.issue.count).toHaveBeenCalledWith({
      where: {
        isRequirement: false,
        isDeleted: false,
        testRunResults: { some: { testRunId: 42, isDeleted: false } },
      },
    });
  });

  it("fires for a failed or timed-out execution on a run in scope, not for success", async () => {
    const execution = {
      id: 9,
      status: "TIMED_OUT",
      error: "no report",
      testRunId: 42,
      projectId: 7,
      target: { name: "GitHub Actions" },
      testRun: openRun,
    };
    const db = mockDb({
      rules: [
        rule({
          id: 5,
          metric: "AUTOMATED_EXECUTION_FAILED",
          scopeType: "RUN_NAME",
          scopeText: "night",
        }),
      ],
      execution,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateExecution(9, "acme");
    expect(fired.map((f) => [f.ruleId, f.subjectId])).toEqual([[5, 42]]);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "RUN",
        details: expect.objectContaining({
          executionId: 9,
          status: "TIMED_OUT",
          targetName: "GitHub Actions",
        }),
      })
    );

    const ok = mockDb({
      rules: [rule({ id: 5, metric: "AUTOMATED_EXECUTION_FAILED" })],
      execution: { ...execution, status: "SUCCEEDED" },
    });
    expect(
      await new AlertEvaluationService(ok, {
        now: () => NOW,
      }).evaluateExecution(9)
    ).toEqual([]);
  });

  it("fires a session overrun against its estimate, honouring a tag scope", async () => {
    const session = {
      id: 15,
      name: "Charter A",
      projectId: 7,
      elapsed: 3900,
      estimate: 3000,
      isDeleted: false,
      project: { name: "Shop" },
    };
    const db = mockDb({
      rules: [
        rule({ id: 6, metric: "SESSION_OVERRUN", thresholdValue: 25 }),
        rule({
          id: 7,
          metric: "SESSION_OVERRUN",
          thresholdValue: 25,
          scopeType: "TAG",
          scopeId: 3,
        }),
      ],
      session,
      sessionTag: false,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateSession(15);
    expect(fired.map((f) => f.ruleId)).toEqual([6]);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "SESSION",
        subjectId: 15,
        observedValue: 30,
        baselineValue: 3000,
      })
    );
  });

  it("runs the hourly pass over stalled runs and webhook failure rates", async () => {
    const db = mockDb({
      rules: [
        rule({ id: 8, metric: "RUN_NOT_PROGRESSING", thresholdValue: 24 }),
        rule({
          id: 9,
          metric: "WEBHOOK_FAILURE_RATE",
          thresholdValue: 25,
          baselineWindow: 50,
          minSamples: 10,
          scopeType: "WEBHOOK",
          scopeText: "cfg_1",
        }),
      ],
      openRuns: [
        {
          id: 42,
          name: "Nightly",
          testRunType: "MANUAL",
          elapsed: null,
          projectName: "Shop",
          lastActivityAt: new Date("2026-10-06T12:00:00Z"),
          total: 10,
          untested: 4,
          milestoneDueAt: null,
          milestoneCompleted: null,
        },
        {
          id: 43,
          name: "Fresh",
          testRunType: "MANUAL",
          elapsed: null,
          projectName: "Shop",
          lastActivityAt: null,
          total: 0,
          untested: 0,
          milestoneDueAt: null,
          milestoneCompleted: null,
        },
      ],
      webhookConfigs: [
        { id: "cfg_1", name: "Slack", url: null, project: { name: "Shop" } },
        { id: "cfg_2", name: "Teams", url: null, project: { name: "Shop" } },
      ],
      deliveries: { total: 20, failed: 8 },
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateScheduled(undefined, "hourly");
    expect(fired.map((f) => [f.ruleId, f.subjectType, f.subjectId])).toEqual([
      [8, "RUN", 42],
      [9, "WEBHOOK", 0],
    ]);
    expect(db.alertEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectRef: "cfg_1",
          subjectName: "Slack",
          observedValue: 40,
        }),
      })
    );
  });

  it("names an unnamed webhook by its id, never by its URL", async () => {
    const secretUrl = "https://hooks.slack.com/services/T000/B000/SECRET";
    const db = mockDb({
      rules: [
        rule({
          id: 9,
          metric: "WEBHOOK_FAILURE_RATE",
          thresholdValue: 25,
          baselineWindow: 50,
          minSamples: 10,
          scopeType: "WEBHOOK",
          scopeText: "cfg_1",
        }),
      ],
      webhookConfigs: [
        { id: "cfg_1", name: null, url: secretUrl, project: { name: "Shop" } },
      ],
      deliveries: { total: 20, failed: 8 },
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    await service.evaluateScheduled(undefined, "hourly");
    expect(db.alertEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectName: "cfg_1" }),
      })
    );
    expect(JSON.stringify(db.alertEvent.create.mock.calls)).not.toContain(
      "SECRET"
    );
  });

  it("runs the daily pass over project health with the case-set scope", async () => {
    const db = mockDb({
      rules: [
        rule({
          id: 10,
          metric: "AUTOMATION_SHARE_BELOW",
          thresholdValue: 50,
          scopeType: "FOLDER",
          scopeId: 3,
        }),
        rule({
          id: 11,
          metric: "STALE_CASES",
          thresholdValue: 5,
          secondaryValue: 30,
        }),
      ],
      folderTree: [3, 4],
      project: { id: 7, name: "Shop", isDeleted: false },
      caseCounts: { total: 10, automated: 2 },
      stale: 5,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateScheduled(undefined, "daily");
    expect(fired.map((f) => [f.ruleId, f.subjectType, f.subjectId])).toEqual([
      [10, "PROJECT", 7],
    ]);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "PROJECT",
        subjectName: "Shop",
        observedValue: 20,
        details: expect.objectContaining({ automated: 2, total: 10 }),
      })
    );
  });
});

describe("AlertEvaluationService — AI budget (system alerts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const budgetRule = (overrides: Partial<AlertRuleRow> = {}) =>
    rule({
      id: 20,
      projectId: null,
      name: "AI budget 80%",
      metric: "LLM_BUDGET_USED",
      thresholdValue: 80,
      cooldownMinutes: 0,
      emitWebhook: true,
      ...overrides,
    });
  const openAi = {
    monthlyBudget: "100.00",
    billingPeriodStartDay: 1,
    budgetAlertResetAt: null,
  };

  it("fires every rule whose threshold the period's spend reaches, without a project or webhook", async () => {
    const db = mockDb({
      rules: [
        budgetRule(),
        budgetRule({ id: 21, name: "AI budget 90%", thresholdValue: 90 }),
        budgetRule({
          id: 22,
          scopeType: "LLM_INTEGRATION",
          scopeId: 99, // another integration
        }),
      ],
      llmConfig: openAi,
      llmSpend: 85.5,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateLlmIntegration(4, "acme");
    expect(fired.map((f) => [f.ruleId, f.subjectType, f.subjectId])).toEqual([
      [20, "LLM_INTEGRATION", 4],
    ]);
    expect(db.llmUsage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          llmIntegrationId: 4,
          createdAt: { gte: new Date(2026, 9, 1, 0, 0, 0, 0) },
        }),
      })
    );
    expect(db.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
          subjectType: "LLM_INTEGRATION",
          subjectId: 4,
          subjectName: "OpenAI",
          observedValue: 85.5,
          baselineValue: null,
          details: expect.objectContaining({
            percent: 85.5,
            spend: 85.5,
            budget: 100,
            periodKey: "2026-10-01",
          }),
        }),
      })
    );
    expect(resolveRecipients).toHaveBeenCalledWith(db, 20, null);
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        subjectType: "LLM_INTEGRATION",
        tenantId: "acme",
      })
    );
    // No project, so no project webhook even though the rule asks for one.
    expect(webhookEmit).not.toHaveBeenCalled();
  });

  it("fires once per billing period, and again after a budget-alert reset", async () => {
    const quiet = mockDb({
      rules: [budgetRule()],
      llmConfig: openAi,
      llmSpend: 90,
      lastEvent: { firedAt: new Date("2026-10-03T00:00:00Z") },
    });
    expect(
      await new AlertEvaluationService(quiet, {
        now: () => NOW,
      }).evaluateLlmIntegration(4)
    ).toEqual([]);

    const reset = mockDb({
      rules: [budgetRule()],
      llmConfig: { ...openAi, budgetAlertResetAt: "2026-10-05T00:00:00Z" },
      llmSpend: 90,
      lastEvent: { firedAt: new Date("2026-10-03T00:00:00Z") },
    });
    expect(
      (
        await new AlertEvaluationService(reset, {
          now: () => NOW,
        }).evaluateLlmIntegration(4)
      ).map((f) => f.ruleId)
    ).toEqual([20]);
  });

  it("stays quiet under the threshold, without a budget, or for a deleted integration", async () => {
    const under = mockDb({
      rules: [budgetRule()],
      llmConfig: openAi,
      llmSpend: 79.99,
    });
    expect(
      await new AlertEvaluationService(under, {
        now: () => NOW,
      }).evaluateLlmIntegration(4)
    ).toEqual([]);

    const noBudget = mockDb({
      rules: [budgetRule()],
      llmConfig: { ...openAi, monthlyBudget: null },
      llmSpend: 500,
    });
    expect(
      await new AlertEvaluationService(noBudget, {
        now: () => NOW,
      }).evaluateLlmIntegration(4)
    ).toEqual([]);
    expect(noBudget.llmUsage.aggregate).not.toHaveBeenCalled();

    const deleted = mockDb({
      rules: [budgetRule()],
      llmConfig: openAi,
      llmIntegration: { name: "Old", isDeleted: true },
      llmSpend: 500,
    });
    expect(
      await new AlertEvaluationService(deleted, {
        now: () => NOW,
      }).evaluateLlmIntegration(4)
    ).toEqual([]);
  });

  it("leaves system alerts out of the scheduled passes", async () => {
    const db = mockDb({
      rules: [budgetRule({ metric: "MILESTONE_OVERDUE" })],
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    expect(await service.evaluateScheduled(undefined, "daily")).toEqual([]);
    expect(db.milestones.findMany).not.toHaveBeenCalled();
  });
});

describe("AlertEvaluationService — AI error rate and provider rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires the error-rate rule on the last requests and the rate-limit rule on recent throttling", async () => {
    const db = mockDb({
      rules: [
        rule({
          id: 30,
          projectId: null,
          metric: "LLM_ERROR_RATE",
          thresholdValue: 25,
          baselineWindow: 10,
          minSamples: 4,
          cooldownMinutes: 0,
        }),
        rule({
          id: 31,
          projectId: null,
          metric: "LLM_RATE_LIMITED",
          thresholdValue: 3,
          secondaryValue: 24,
          cooldownMinutes: 0,
        }),
      ],
      llmRecent: [
        { success: false },
        { success: false },
        { success: true },
        { success: true },
        { success: true },
      ],
      llmRateLimited: 4,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateLlmIntegration(4);
    expect(fired.map((f) => f.ruleId)).toEqual([30, 31]);
    expect(db.llmUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { llmIntegrationId: 4 }, take: 10 })
    );
    expect(db.alertEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: "LLM_INTEGRATION",
          observedValue: 40,
          details: { failureRate: 40, failed: 2, sampleCount: 5 },
        }),
      })
    );
    expect(db.alertEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          observedValue: 4,
          details: { blocked: 4, hours: 24 },
        }),
      })
    );
    // Budget rules absent: the provider config is never read.
    expect(db.llmProviderConfig.findUnique).not.toHaveBeenCalled();
  });

  it("stays quiet below the minimum sample count or under the thresholds", async () => {
    const db = mockDb({
      rules: [
        rule({
          id: 30,
          projectId: null,
          metric: "LLM_ERROR_RATE",
          thresholdValue: 25,
          baselineWindow: 10,
          minSamples: 4,
        }),
        rule({
          id: 31,
          projectId: null,
          metric: "LLM_RATE_LIMITED",
          thresholdValue: 3,
          secondaryValue: 24,
        }),
      ],
      llmRecent: [{ success: false }, { success: false }],
      llmRateLimited: 2,
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    expect(await service.evaluateLlmIntegration(4)).toEqual([]);
  });
});

describe("AlertEvaluationService — installation health (system alerts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const systemRule = (overrides: Partial<AlertRuleRow>) =>
    rule({ projectId: null, cooldownMinutes: 0, ...overrides });

  it("checks repository caches, integrations, queues, the audit backlog and lockouts on the hourly pass", async () => {
    const db = mockDb({
      rules: [
        systemRule({
          id: 40,
          metric: "CODE_REPOSITORY_CACHE_FAILING",
          thresholdValue: 24,
        }),
        systemRule({
          id: 41,
          metric: "CODE_REPOSITORY_CACHE_FAILING",
          thresholdValue: 1,
          scopeType: "CODE_REPOSITORY",
          scopeId: 99,
        }),
        systemRule({ id: 42, metric: "QUEUE_FAILED_JOBS", thresholdValue: 10 }),
        systemRule({
          id: 43,
          metric: "QUEUE_BACKLOG",
          thresholdValue: 30,
          scopeType: "QUEUE",
          scopeText: "emails",
        }),
        systemRule({ id: 44, metric: "AUDIT_BACKLOG", thresholdValue: 30 }),
        systemRule({ id: 45, metric: "ACCOUNT_LOCKOUTS", thresholdValue: 3 }),
      ],
      repoConfigs: [
        {
          id: 5,
          projectId: 7,
          purpose: "IMPACT",
          cacheLastFetchedAt: new Date("2026-10-06T12:00:00Z"), // 48h ago
          cacheError: "boom",
          updatedAt: new Date("2026-10-08T11:00:00Z"),
          repository: { name: "shop-web" },
          project: { name: "Shop" },
        },
      ],
      auditOldest: new Date("2026-10-08T11:00:00Z"), // 60 minutes
      lockedUsers: 3,
    });
    const queueStats = vi.fn(async () => [
      { name: "emails", failed: 12, waiting: 3, oldestWaitingMinutes: 45 },
      { name: "alerts", failed: 0, waiting: 1, oldestWaitingMinutes: 90 },
    ]);
    const service = new AlertEvaluationService(db, {
      now: () => NOW,
      queueStats,
    });
    const fired = await service.evaluateScheduled("acme", "hourly");
    expect(fired.map((f) => [f.ruleId, f.subjectType, f.subjectId])).toEqual([
      [40, "CODE_REPOSITORY", 5],
      [42, "QUEUE", 0],
      [43, "QUEUE", 0],
      [44, "SYSTEM", 0],
      [45, "SYSTEM", 0],
    ]);
    expect(queueStats).toHaveBeenCalledWith("acme", NOW);
    expect(db.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
          subjectType: "CODE_REPOSITORY",
          subjectName: "shop-web · Shop",
          observedValue: 48,
          details: expect.objectContaining({
            projectId: 7,
            purpose: "IMPACT",
            error: "boom",
          }),
        }),
      })
    );
    expect(db.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: "QUEUE",
          subjectRef: "emails",
          observedValue: 12,
        }),
      })
    );
    expect(db.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: "SYSTEM",
          subjectRef: "audit",
          observedValue: 60,
        }),
      })
    );
    expect(createAlertTriggeredNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "SYSTEM",
        subjectRef: "lockouts",
        projectId: null,
        details: { locked: 3 },
      })
    );
  });

  it("checks re-authorization counts and the automated-results feed on the daily pass", async () => {
    const db = mockDb({
      rules: [
        systemRule({
          id: 50,
          metric: "INTEGRATION_REAUTH_NEEDED",
          thresholdValue: 5,
        }),
        systemRule({
          id: 51,
          metric: "INTEGRATION_REAUTH_NEEDED",
          thresholdValue: 1,
          scopeType: "INTEGRATION",
          scopeId: 2,
        }),
        systemRule({
          id: 52,
          metric: "NO_AUTOMATED_RESULTS",
          thresholdValue: 48,
        }),
      ],
      reauthRows: [
        { id: 1, name: "Jira", users: 6 },
        { id: 3, name: "GitHub", users: 2 },
      ],
      lastAutomatedAt: new Date("2026-10-05T12:00:00Z"), // 72h ago
    });
    const service = new AlertEvaluationService(db, { now: () => NOW });
    const fired = await service.evaluateScheduled(undefined, "daily");
    expect(fired.map((f) => [f.ruleId, f.subjectType, f.subjectId])).toEqual([
      [50, "INTEGRATION", 1],
      [52, "SYSTEM", 0],
    ]);
    expect(db.alertEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectRef: "automated-results",
          observedValue: 72,
        }),
      })
    );
  });

  it("never fires the automated-results rule on an installation without any, nor the audit rule without a backlog", async () => {
    const db = mockDb({
      rules: [
        systemRule({
          id: 52,
          metric: "NO_AUTOMATED_RESULTS",
          thresholdValue: 48,
        }),
        systemRule({ id: 44, metric: "AUDIT_BACKLOG", thresholdValue: 30 }),
      ],
      lastAutomatedAt: null,
      auditOldest: null,
    });
    const service = new AlertEvaluationService(db, {
      now: () => NOW,
      queueStats: async () => [],
    });
    expect(await service.evaluateScheduled(undefined, "daily")).toEqual([]);
    expect(await service.evaluateScheduled(undefined, "hourly")).toEqual([]);
  });
});
