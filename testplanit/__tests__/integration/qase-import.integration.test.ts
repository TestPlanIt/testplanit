/**
 * Live-DB proof of the Qase import phase: staged Qase records go through
 * `runQaseImport` for real and the rows it leaves behind are read back.
 *
 * A mocked test cannot show what matters here: that every case lands once,
 * with its folder, field values, steps, shared steps, tags, files, parameters
 * and version row, and that an import which stops partway continues without
 * writing anything twice.
 *
 * Run (scratch database only):
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/qase-import.integration.test.ts
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import type { DbClient } from "~/lib/zenstack";
import {
  unmappedQaseUser,
  type QaseMappingConfiguration,
} from "~/services/imports/qase/mapping";
import { runQaseImport } from "~/services/imports/qase/runQaseImport";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const raw = createRawDbClient();
const db = raw as unknown as DbClient;
const STAMP = `qase-${Date.now()}`;
const FILES = "https://attachments.qase.test/public/team/t1/attachment";
const DIAGRAM = `${FILES}/a1/diagram.png`;
const SCREEN = `${FILES}/a2/login-screen.png`;
const NOTES = `${FILES}/a3/notes.txt`;
const SHARED_HASH = "shared-hash-1";

const options = (...titles: string[]) =>
  titles.map((title, id) => ({
    id,
    title,
    // Qase marks its "Not set" choice with this slug.
    slug: title === "Not set" ? "undefined" : title.toLowerCase(),
  }));

const SYSTEM_FIELDS = [
  {
    slug: "status",
    title: "Status",
    options: options("Actual", "Draft", "Deprecated"),
  },
  {
    slug: "priority",
    title: "Priority",
    options: options("Not set", "High", "Medium", "Low"),
  },
  {
    slug: "type",
    title: "Type",
    options: options("Not set", "Other", "Smoke"),
  },
  { slug: "description", title: "Description", options: [] },
  { slug: "preconditions", title: "Pre-conditions", options: [] },
  { slug: "is_flaky", title: "Is flaky", options: options("No", "Yes") },
  {
    slug: "result_status",
    title: "Result status",
    options: [
      "Untested",
      "Passed",
      "Failed",
      "Blocked",
      "Retest",
      "Skipped",
      "Deleted",
      "In progress",
      "Invalid",
    ].map((title, id) => ({
      id,
      title,
      slug: title.toLowerCase().replace(" ", "_"),
    })),
  },
];

const CUSTOM_FIELDS = [
  {
    id: 2,
    title: "Platforms",
    entity: "case",
    type: "Multiselect",
    value: JSON.stringify([
      { id: 1, title: "Web" },
      { id: 2, title: "iOS" },
      { id: 3, title: "Android" },
    ]),
    is_enabled_for_all_projects: false,
    projects_codes: ["SHOP"],
  },
  {
    id: 6,
    title: "Effort points",
    entity: "case",
    type: "number",
    value: null,
    is_enabled_for_all_projects: true,
    projects_codes: [],
  },
  {
    id: 7,
    title: "Needs review",
    entity: "case",
    type: "Checkbox",
    value: null,
    is_enabled_for_all_projects: false,
    projects_codes: ["SHOP"],
  },
];

const SUITES = [
  { id: 1, title: "Authentication", parent_id: null, position: 1 },
  { id: 2, title: "Login", parent_id: 1, position: 1 },
];

const SHARED_STEPS = [
  {
    hash: SHARED_HASH,
    title: "Open the login page",
    steps: [
      {
        hash: "s1",
        action: "Open the application URL",
        expected_result: "The landing page loads",
        data: "https://staging.example.test",
        attachments: [],
        steps: [],
      },
      {
        hash: "s2",
        action: "Click **Sign in**",
        expected_result: "The login form is shown",
        data: "",
        attachments: [],
        steps: [],
      },
    ],
  },
];

const CASES = [
  {
    id: 1,
    title: "Sign in with a valid password",
    suite_id: 2,
    position: 1,
    member_id: 1,
    description: `Checks a normal sign-in.\n\n![diagram](${DIAGRAM})`,
    preconditions: "The user `demo` exists.",
    status: 0,
    priority: 1,
    type: 2,
    is_flaky: 0,
    automation: 0,
    isManual: true,
    isToBeAutomated: false,
    tags: [{ title: "smoke" }, { title: `tag ${STAMP}` }],
    custom_fields: [
      { id: 2, value: "1" },
      { id: 2, value: "3" },
      { id: 6, value: "5" },
      { id: 7, value: "1" },
    ],
    parameters: [
      {
        shared_id: null,
        type: "single",
        item: { title: "browser", values: ["chrome", "firefox"] },
      },
      {
        shared_id: "p-1",
        type: "single",
        item: { title: "locale", values: ["en-US", "de-DE", "ja-JP"] },
      },
    ],
    attachments: [
      { size: 30, mime: "text/plain", filename: "notes.txt", url: NOTES },
    ],
    steps_type: "classic",
    steps: [
      {
        position: 1,
        action: "Enter the user name",
        expected_result: "The name is shown",
        data: "demo",
        attachments: [],
        steps: [],
      },
      {
        position: 2,
        action: "Enter the password",
        expected_result: "The password is masked",
        data: null,
        attachments: [],
        steps: [
          {
            position: 1,
            action: "Click the eye icon",
            expected_result: "The password is readable",
            attachments: [],
            steps: [],
          },
        ],
      },
      {
        position: 3,
        action: "Click **Sign in**",
        expected_result: "The dashboard opens",
        attachments: [
          {
            size: 79,
            mime: "image/png",
            filename: "login-screen.png",
            url: SCREEN,
          },
        ],
        steps: [],
      },
    ],
    created_at: "2026-11-01T10:00:00+00:00",
  },
  {
    id: 2,
    title: "Sign in with a one-time code",
    suite_id: 2,
    position: 2,
    description: null,
    status: 1,
    priority: 2,
    type: 1,
    is_flaky: 0,
    automation: 1,
    isManual: true,
    isToBeAutomated: true,
    tags: [],
    custom_fields: [],
    parameters: [],
    attachments: [],
    steps_type: "classic",
    steps: [
      {
        position: 1,
        action: "Open the application URL",
        expected_result: "The landing page loads",
        shared_step_hash: SHARED_HASH,
        attachments: [],
        steps: [],
      },
      {
        position: 2,
        action: "Click **Sign in**",
        expected_result: "The login form is shown",
        shared_step_hash: SHARED_HASH,
        attachments: [],
        steps: [],
      },
      {
        position: 3,
        action: "Enter the one-time code",
        expected_result: "The dashboard opens",
        attachments: [],
        steps: [],
      },
    ],
    created_at: "2026-11-02T10:00:00+00:00",
  },
  {
    id: 3,
    title: "Invoice totals are rounded",
    suite_id: null,
    position: 3,
    description: "No suite; automated; deprecated; flaky.",
    status: 2,
    priority: 0,
    type: 1,
    is_flaky: 1,
    automation: 2,
    isManual: false,
    isToBeAutomated: false,
    tags: [],
    custom_fields: [],
    parameters: [],
    attachments: [],
    steps_type: "classic",
    steps: [],
    created_at: "2026-11-03T10:00:00+00:00",
  },
];

const FAILURE_LOG = `${FILES}/a4/failure-log.txt`;

const MILESTONES = [
  {
    id: 1,
    title: "Release 1.0",
    description: "First release.",
    status: "completed",
    due_date: "2026-09-21T00:00:00+00:00",
    created_at: "2026-09-01T08:00:00+00:00",
    updated_at: "2026-09-21T08:00:00+00:00",
  },
  {
    id: 2,
    title: "Release 1.1",
    description: null,
    status: "active",
    due_date: "2027-01-15T00:00:00+00:00",
    created_at: "2026-10-01T08:00:00+00:00",
    updated_at: "2026-10-01T08:00:00+00:00",
  },
];

const CONFIGURATION_GROUPS = [
  {
    id: 1,
    title: `Operating system ${STAMP}`,
    configurations: [
      { id: 2, title: "Windows" },
      { id: 1, title: "macOS" },
    ],
  },
  {
    id: 2,
    title: `Browser ${STAMP}`,
    configurations: [{ id: 3, title: "Chrome" }],
  },
];

const RUN_FIELD = {
  id: 10,
  title: "Build number",
  entity: "run",
  type: "string",
  value: null,
};

const RUNS = [
  {
    id: 1,
    title: "Release 1.1 regression",
    description: "Full pass on **staging**.",
    status: 3,
    status_text: "failed",
    start_time: "2026-11-21T01:21:57+00:00",
    end_time: "2026-11-21T01:22:01+00:00",
    time_spent: 146500,
    user_id: 1,
    environment: { title: `Staging ${STAMP}`, slug: "staging" },
    milestone: { title: "Release 1.1" },
    custom_fields: [{ id: 10, value: "1.1.0-rc2" }],
    tags: [{ title: `regression ${STAMP}` }],
    configurations: [1, 3],
    // Case 1 is listed once per parameter combination; case 99 was deleted.
    cases: [1, 1, 1, 2, 3, 99],
  },
  {
    id: 2,
    title: "Production smoke",
    description: null,
    status: 0,
    status_text: "in_progress",
    start_time: "2026-11-21T01:22:02+00:00",
    end_time: null,
    time_spent: 1500,
    user_id: 1,
    environment: { title: `Production ${STAMP}`, slug: "production" },
    milestone: null,
    custom_fields: [],
    tags: [],
    configurations: [],
    cases: [1, 3],
  },
];

const RESULTS = [
  {
    hash: "result-1",
    run_id: 1,
    case_id: 1,
    status: "passed",
    comment: "All good on **chrome**.",
    stacktrace: null,
    time_spent_ms: 93500,
    end_time: "2026-11-21T01:21:57+00:00",
    author_uuid: "author-1",
    attachments: [],
    steps: [
      { position: 1, status: 1, comment: "ok", attachments: [] },
      {
        position: 2,
        status: 1,
        attachments: [],
        steps: [{ position: 1, status: 1, attachments: [] }],
      },
      {
        position: 3,
        status: 1,
        attachments: [
          {
            size: 79,
            mime: "image/png",
            filename: "login-screen.png",
            url: SCREEN,
          },
        ],
      },
    ],
  },
  {
    hash: "result-2",
    run_id: 1,
    case_id: 1,
    status: "failed",
    comment: "Fails on firefox.",
    stacktrace: "AssertionError: dashboard not shown\n  at login.spec.ts:42",
    time_spent_ms: 41000,
    end_time: "2026-11-21T01:21:58+00:00",
    author_uuid: "author-1",
    attachments: [
      {
        size: 38,
        mime: "text/plain",
        filename: "failure-log.txt",
        url: FAILURE_LOG,
      },
    ],
    steps: [
      { position: 1, status: 1, attachments: [] },
      { position: 2, status: 1, attachments: [] },
      {
        position: 3,
        status: 2,
        comment: "Spinner never ends.",
        attachments: [],
      },
    ],
  },
  {
    hash: "result-3",
    run_id: 1,
    case_id: 2,
    status: "blocked",
    comment: null,
    time_spent_ms: 0,
    end_time: "2026-11-21T01:21:59+00:00",
    author_uuid: "author-app",
    attachments: [],
    // Positions 1 and 2 are the two steps of the shared step.
    steps: [
      { position: 1, status: 1, attachments: [] },
      { position: 2, status: 3, attachments: [] },
      { position: 3, status: 5, attachments: [] },
    ],
  },
  {
    hash: "result-4",
    run_id: 1,
    case_id: 3,
    status: "invalid",
    comment: null,
    time_spent_ms: 0,
    end_time: "2026-11-21T01:22:00+00:00",
    author_uuid: "author-1",
    attachments: [],
    steps: [],
  },
  {
    hash: "result-5",
    run_id: 1,
    case_id: 1,
    status: "untested",
    end_time: "2026-11-21T01:22:00+00:00",
    attachments: [],
    steps: [],
  },
  {
    hash: "result-6",
    run_id: 2,
    case_id: 3,
    status: "passed",
    comment: null,
    time_spent_ms: 1500,
    end_time: "2026-11-21T01:22:02+00:00",
    author_uuid: "author-1",
    attachments: [],
    steps: [],
  },
  {
    hash: "result-7",
    run_id: 1,
    case_id: 99,
    status: "passed",
    end_time: "2026-11-21T01:22:03+00:00",
    attachments: [],
    steps: [],
  },
];

const AUTHORS = [
  { id: 1, uuid: "author-1", entity_type: "user", entity_id: 1 },
  { id: 2, uuid: "author-app", entity_type: "app", entity_id: 500 },
];

const text = (node: unknown): string => {
  if (!node || typeof node !== "object") return "";
  const { text: own, content } = node as { text?: string; content?: unknown[] };
  return (own ?? "") + (content ?? []).map(text).join("");
};

const imageSources = (node: unknown): string[] => {
  if (!node || typeof node !== "object") return [];
  const { type, attrs, content } = node as {
    type?: string;
    attrs?: { src?: string };
    content?: unknown[];
  };
  return [
    ...(type === "image" && attrs?.src ? [attrs.src] : []),
    ...(content ?? []).flatMap(imageSources),
  ];
};

describeIntegration("Qase import (live DB)", () => {
  let adminId: string;
  let descriptionFieldId: number;
  let priorityFieldId: number;
  let priorityHighId: number;
  let states: number[];
  let seededStatuses: Record<string, number>;
  let runStates: { active: number; completed: number };
  let milestoneTypeId: number;
  const projectIds: number[] = [];
  const jobIds: string[] = [];
  const uploads: string[] = [];
  let run = 0;

  const copierOptions = {
    lookup: async () => ["203.0.113.10"],
    upload: async (key: string) => {
      uploads.push(key);
    },
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": url.endsWith(".png") ? "image/png" : "text/plain",
        },
      });
    }) as typeof fetch,
  };

  /** A fetched job, its target project and a complete mapping. */
  async function stageJob(
    overrides: Record<string, unknown> = {},
    adjust: (
      configuration: QaseMappingConfiguration,
      label: string
    ) => void = () => {},
    { withRuns = false } = {}
  ) {
    run += 1;
    const label = `${STAMP}-${run}`;
    const project = await raw.projects.create({
      data: { name: `Qase target ${label}`, createdBy: adminId },
    });
    projectIds.push(project.id);

    const configuration: QaseMappingConfiguration = {
      projects: { SHOP: { action: "map", mappedTo: project.id, name: "" } },
      users: { "1": unmappedQaseUser() },
      caseStatuses: {
        "0": { mappedTo: states[0] },
        "1": { mappedTo: states[1] },
        "2": { mappedTo: states[2] },
      },
      template: { action: "create", mappedTo: null, name: `Qase ${label}` },
      fields: {
        "system:description": {
          action: "map",
          mappedTo: descriptionFieldId,
          name: "",
        },
        "system:priority": {
          action: "map",
          mappedTo: priorityFieldId,
          name: "",
        },
        "system:preconditions": {
          action: "create",
          mappedTo: null,
          name: `Pre-conditions ${label}`,
        },
        "system:type": {
          action: "create",
          mappedTo: null,
          name: `Type ${label}`,
        },
        "system:is_flaky": {
          action: "create",
          mappedTo: null,
          name: `Is flaky ${label}`,
        },
        "custom:2": {
          action: "create",
          mappedTo: null,
          name: `Platforms ${label}`,
        },
        "custom:6": { action: "skip", mappedTo: null, name: "" },
        "custom:7": {
          action: "create",
          mappedTo: null,
          name: `Needs review ${label}`,
        },
      },
      resultStatuses: {
        ...Object.fromEntries(
          ["passed", "failed", "blocked", "retest", "skipped"].map((slug) => [
            slug,
            {
              action: "map" as const,
              mappedTo: seededStatuses[slug],
              name: "",
              isSuccess: false,
              isFailure: false,
              isCompleted: false,
            },
          ])
        ),
        in_progress: {
          action: "create",
          mappedTo: null,
          name: `In progress ${label}`,
          isSuccess: false,
          isFailure: false,
          isCompleted: false,
        },
        invalid: {
          action: "create",
          mappedTo: null,
          name: `Invalid ${label}`,
          isSuccess: false,
          isFailure: false,
          isCompleted: true,
        },
      },
      runStates,
      milestoneTypeId,
    };

    adjust(configuration, label);

    const job = await raw.qaseImportJob.create({
      data: {
        createdById: adminId,
        apiHost: "api.qase.test",
        apiToken: "encrypted-token",
        status: "QUEUED",
        phase: "IMPORTING",
        projects: [
          {
            code: "SHOP",
            title: `Shop ${label}`,
            cases: 3,
            suites: 2,
            milestones: 0,
            runs: 0,
            defects: 0,
          },
        ],
        configuration: configuration as never,
        ...overrides,
      },
    });
    jobIds.push(job.id);

    const staged: [string, string | null, { id: string; data: unknown }[]][] = [
      [
        "user",
        null,
        [
          {
            id: "1",
            data: { id: 1, name: "Qase Owner", email: "owner@qase.test" },
          },
        ],
      ],
      [
        "system_field",
        null,
        SYSTEM_FIELDS.map((field) => ({ id: field.slug, data: field })),
      ],
      [
        "custom_field",
        null,
        [...CUSTOM_FIELDS, RUN_FIELD].map((field) => ({
          id: String(field.id),
          data: field,
        })),
      ],
      [
        "author",
        null,
        AUTHORS.map((author) => ({ id: String(author.id), data: author })),
      ],
      ...(withRuns
        ? ([
            [
              "milestone",
              "SHOP",
              MILESTONES.map((entry) => ({
                id: String(entry.id),
                data: entry,
              })),
            ],
            [
              "configuration",
              "SHOP",
              CONFIGURATION_GROUPS.map((entry) => ({
                id: String(entry.id),
                data: entry,
              })),
            ],
            [
              "run",
              "SHOP",
              RUNS.map((entry) => ({ id: String(entry.id), data: entry })),
            ],
            [
              "result",
              "SHOP",
              RESULTS.map((entry) => ({ id: entry.hash, data: entry })),
            ],
          ] as [string, string | null, { id: string; data: unknown }[]][])
        : []),
      [
        "suite",
        "SHOP",
        SUITES.map((suite) => ({ id: String(suite.id), data: suite })),
      ],
      [
        "shared_step",
        "SHOP",
        SHARED_STEPS.map((step) => ({ id: step.hash, data: step })),
      ],
      [
        "case",
        "SHOP",
        CASES.map((record) => ({ id: String(record.id), data: record })),
      ],
    ];
    await raw.qaseImportStaging.createMany({
      data: staged.flatMap(([entity, projectCode, rows]) =>
        rows.map((row, rowIndex) => ({
          jobId: job.id,
          entity,
          projectCode,
          sourceId: row.id,
          rowIndex,
          data: row.data as never,
        }))
      ),
    });
    return { jobId: job.id, projectId: project.id, label };
  }

  const readJob = (jobId: string) =>
    raw.qaseImportJob.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        status: true,
        phase: true,
        error: true,
        apiToken: true,
        entityProgress: true,
        activityLog: true,
      },
    });

  const readCases = (projectId: number) =>
    raw.repositoryCases.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      include: {
        folder: { include: { parent: true } },
        template: true,
        steps: { orderBy: { order: "asc" } },
        caseFieldValues: { include: { field: true } },
        caseTags: { include: { tag: true } },
        attachments: true,
        ownedDataSets: { include: { versions: true, rows: true } },
      },
    });

  /** A client that runs `before` ahead of every progress save. */
  const interceptProgress = (
    before: (
      casesDone: number,
      progress: Record<string, { done?: number }>
    ) => Promise<void> | void
  ): DbClient =>
    new Proxy(raw, {
      get(target, prop, receiver) {
        if (prop !== "qaseImportJob") {
          return Reflect.get(target, prop, receiver);
        }
        return new Proxy(target.qaseImportJob, {
          get(model, key) {
            if (key !== "update") {
              return Reflect.get(model, key);
            }
            return async (args: {
              data?: { entityProgress?: Record<string, { done?: number }> };
            }) => {
              const progress = args.data?.entityProgress ?? {};
              await before(progress.cases?.done ?? 0, progress);
              return (model.update as (a: unknown) => unknown)(args);
            };
          },
        });
      },
    }) as unknown as DbClient;

  /** Makes every progress save happen, instead of one every 1.5 seconds. */
  const saveProgressEveryTime = () => {
    const realNow = Date.now.bind(Date);
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + ++calls * 2000);
  };

  beforeAll(async () => {
    const [{ current_database: dbName }] = await raw.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_qase_import" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — use the tpi_qase_import scratch DB (or tpi_test in CI)`
      );
    }
    process.env.AWS_BUCKET_NAME ||= "qase-import-test";

    const admin = await raw.user.findFirst({ where: { access: "ADMIN" } });
    if (!admin)
      throw new Error("Test prerequisite: no ADMIN user (db/seed.ts)");
    adminId = admin.id;

    const fieldId = async (systemName: string) => {
      const field = await raw.caseFields.findUnique({ where: { systemName } });
      if (!field) {
        throw new Error(`Test prerequisite: no "${systemName}" case field`);
      }
      return field.id;
    };
    descriptionFieldId = await fieldId("description");
    priorityFieldId = await fieldId("priority");
    const high = await raw.fieldOptions.findFirst({
      where: {
        name: "High",
        caseFields: { some: { caseFieldId: priorityFieldId } },
      },
    });
    if (!high) throw new Error("Test prerequisite: no High priority option");
    priorityHighId = high.id;

    const workflows = await raw.workflows.findMany({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
      take: 3,
    });
    if (workflows.length < 3) {
      throw new Error("Test prerequisite: three CASES workflow states");
    }
    states = workflows.map((workflow) => workflow.id);

    seededStatuses = Object.fromEntries(
      (
        await raw.status.findMany({
          where: {
            systemName: {
              in: ["passed", "failed", "blocked", "retest", "skipped"],
            },
          },
          select: { id: true, systemName: true },
        })
      ).map((status) => [status.systemName, status.id])
    );
    const runWorkflows = await raw.workflows.findMany({
      where: { scope: "RUNS", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    const ofType = (type: string) => {
      const match = runWorkflows.find((entry) => entry.workflowType === type);
      if (!match) throw new Error(`Test prerequisite: a ${type} run state`);
      return match.id;
    };
    runStates = { active: ofType("IN_PROGRESS"), completed: ofType("DONE") };
    const milestoneType = await raw.milestoneTypes.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!milestoneType) {
      throw new Error("Test prerequisite: a default milestone type");
    }
    milestoneTypeId = milestoneType.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Staging and mapping rows go with the job; what was imported is hidden so
    // the suites sharing this database do not pick it up.
    await raw.qaseImportJob.deleteMany({ where: { id: { in: jobIds } } });
    await raw.projects.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.user.updateMany({
      where: { email: { contains: STAMP } },
      data: { isDeleted: true, isActive: false },
    });
    await raw.templates.updateMany({
      where: { templateName: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.caseFields.updateMany({
      where: { displayName: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.status.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.configCategories.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.configVariants.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.configurations.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.tags.updateMany({
      where: { name: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.$disconnect();
  });

  it("imports every staged record with its values", async () => {
    const { jobId, projectId, label } = await stageJob();
    const onCompleted = vi.fn();

    await runQaseImport({ db, jobId, copierOptions, onCompleted });

    const job = await readJob(jobId);
    expect(job.error).toBeNull();
    expect(job.status).toBe("COMPLETED");
    expect(job.apiToken).toBeNull();
    expect(job.entityProgress).toEqual({
      folders: { done: 2, total: 2 },
      sharedSteps: { done: 1, total: 1 },
      cases: { done: 3, total: 3 },
      milestones: { done: 0, total: 0 },
      runs: { done: 0, total: 0 },
      results: { done: 0, total: 0 },
      files: { done: 3, total: 3 },
    });
    expect(job.activityLog).toEqual([]);
    expect(await raw.qaseImportStaging.count({ where: { jobId } })).toBe(0);
    expect(onCompleted).toHaveBeenCalledWith([projectId], false);

    const cases = await readCases(projectId);
    expect(cases.map((entry) => entry.name)).toEqual(
      CASES.map((entry) => entry.title)
    );
    const [first, second, third] = cases;
    const value = (entry: (typeof cases)[number], displayName: string) =>
      entry.caseFieldValues.find(
        (fieldValue) => fieldValue.field.displayName === displayName
      )?.value;

    // Folders follow the suite tree; a case without a suite gets a folder
    // named after the Qase project.
    expect(first.folder.name).toBe("Login");
    expect(first.folder.parent?.name).toBe("Authentication");
    expect(second.folderId).toBe(first.folderId);
    expect(third.folder.name).toBe(`Shop ${label}`);
    expect(third.folder.parentId).toBeNull();

    expect(cases.map((entry) => entry.stateId)).toEqual(states);
    expect(cases.map((entry) => entry.automated)).toEqual([false, false, true]);
    expect(new Set(cases.map((entry) => entry.template.templateName))).toEqual(
      new Set([`Qase ${label}`])
    );
    expect(first.createdAt.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(cases.every((entry) => entry.creatorId === adminId)).toBe(true);

    // Field values: rich text as a serialized document with the image copied,
    // options by id, and nothing for "Not set" or a skipped field.
    const description = JSON.parse(String(value(first, "Description")));
    expect(text(description)).toContain("Checks a normal sign-in.");
    const [imageSrc] = imageSources(description);
    expect(imageSrc).toMatch(
      /\/api\/storage\/uploads\/document-images\/qase_.+_diagram\.png$/
    );
    expect(value(first, "Priority")).toBe(priorityHighId);
    expect(value(third, "Priority")).toBeUndefined();
    expect(
      text(JSON.parse(String(value(first, `Pre-conditions ${label}`))))
    ).toBe("The user demo exists.");

    const created = await raw.caseFields.findMany({
      where: { displayName: { endsWith: label } },
      include: { fieldOptions: { include: { fieldOption: true } } },
    });
    const optionId = (displayName: string, name: string) =>
      created
        .find((field) => field.displayName === displayName)
        ?.fieldOptions.find((entry) => entry.fieldOption.name === name)
        ?.fieldOption.id;
    expect(value(first, `Type ${label}`)).toBe(
      optionId(`Type ${label}`, "Smoke")
    );
    expect(optionId(`Type ${label}`, "Not set")).toBeUndefined();
    expect(value(first, `Platforms ${label}`)).toEqual([
      optionId(`Platforms ${label}`, "Web"),
      optionId(`Platforms ${label}`, "Android"),
    ]);
    expect(value(first, `Needs review ${label}`)).toBe(true);
    expect(value(third, `Is flaky ${label}`)).toBe(true);
    expect(
      created.some((field) => field.displayName.startsWith("Effort"))
    ).toBe(false);

    // Steps: nested steps flattened in order, input data kept with the step.
    expect(first.steps.map((step) => text(step.step))).toEqual([
      "Enter the user nameInput data: demo",
      "Enter the password",
      "Click the eye icon",
      "Click Sign in",
    ]);
    expect(first.steps.map((step) => text(step.expectedResult))).toEqual([
      "The name is shown",
      "The password is masked",
      "The password is readable",
      "The dashboard opens",
    ]);
    expect(typeof first.steps[0].step).toBe("object");
    expect(imageSources(first.steps[3].step)[0]).toMatch(
      /\/api\/storage\/uploads\/document-images\/qase_.+_login-screen\.png$/
    );

    // A shared step used by a case becomes one placeholder pointing at the
    // imported group, followed by the case's own steps.
    const group = await raw.sharedStepGroup.findFirstOrThrow({
      where: { projectId },
      include: { items: { orderBy: { order: "asc" } } },
    });
    expect(group.name).toBe("Open the login page");
    expect(group.items.map((item) => text(item.step))).toEqual([
      "Open the application URLInput data: https://staging.example.test",
      "Click Sign in",
    ]);
    expect(second.steps.map((step) => step.sharedStepGroupId)).toEqual([
      group.id,
      null,
    ]);
    expect(text(second.steps[1].step)).toBe("Enter the one-time code");
    expect(third.steps).toEqual([]);

    // An existing tag of the same name is reused whatever its capitals.
    expect(
      first.caseTags.map((entry) => entry.tag.name.toLowerCase()).sort()
    ).toEqual(["smoke", `tag ${STAMP}`]);
    expect(second.caseTags.map((entry) => entry.tag.name)).toEqual([
      "To be automated",
    ]);
    expect(third.caseTags).toEqual([]);

    expect(first.attachments).toHaveLength(1);
    expect(first.attachments[0]).toMatchObject({
      name: "notes.txt",
      mimeType: "text/plain",
      size: BigInt(3),
    });
    expect(first.attachments[0].url).toMatch(
      /\/api\/storage\/uploads\/attachments\/qase_.+_notes\.txt$/
    );
    expect(uploads).toHaveLength(3);

    // Parameters: every combination of the two single parameters.
    expect(first.hasParameters).toBe(true);
    const parameters = await raw.testCaseParameter.findMany({
      where: { testCaseId: first.id },
      orderBy: { order: "asc" },
    });
    expect(parameters.map((parameter) => parameter.name)).toEqual([
      "browser",
      "locale",
    ]);
    expect(first.ownedDataSets).toHaveLength(1);
    expect(first.ownedDataSets[0].rows).toHaveLength(6);
    expect(first.ownedDataSets[0].versions[0].rowCount).toBe(6);
    expect(second.hasParameters).toBe(false);

    // Each case has its version-1 snapshot, field values included.
    const versions = await raw.repositoryCaseVersions.findMany({
      where: { repositoryCaseId: { in: cases.map((entry) => entry.id) } },
      include: { caseFieldVersionValues: true },
    });
    expect(versions.map((version) => version.version)).toEqual([1, 1, 1]);
    expect(
      versions.find((version) => version.repositoryCaseId === first.id)
        ?.caseFieldVersionValues.length
    ).toBe(first.caseFieldValues.length);
  });

  describe("creating projects and users", () => {
    const newUser = (label: string) => ({
      ...unmappedQaseUser(),
      action: "create" as const,
      name: "Qase Owner",
      email: `owner-${label}@qase.test`,
      access: "PROJECTADMIN" as const,
      isApi: true,
    });
    const asNew = (configuration: QaseMappingConfiguration, label: string) => {
      configuration.projects.SHOP = {
        action: "create",
        mappedTo: null,
        name: `Shop from Qase ${label}`,
      };
      configuration.users["1"] = newUser(label);
    };

    it("creates the project and the user the mapping asks for", async () => {
      const { jobId, projectId: unused, label } = await stageJob({}, asNew);
      const onCompleted = vi.fn();

      await runQaseImport({ db, jobId, copierOptions, onCompleted });

      expect((await readJob(jobId)).status).toBe("COMPLETED");

      const project = await raw.projects.findUniqueOrThrow({
        where: { name: `Shop from Qase ${label}` },
        include: {
          repositories: true,
          assignedWorkflows: true,
          assignedStatuses: true,
          milestoneTypes: true,
          assignedTemplates: { include: { template: true } },
        },
      });
      expect(project.id).not.toBe(unused);
      expect(project.createdBy).toBe(adminId);
      expect(project.repositories).toHaveLength(1);
      // Set up like a project from the wizard with its defaults.
      expect(project.assignedWorkflows).toHaveLength(
        await raw.workflows.count({
          where: { isDeleted: false, isEnabled: true },
        })
      );
      expect(project.assignedStatuses).toHaveLength(
        await raw.status.count({ where: { isDeleted: false, isEnabled: true } })
      );
      expect(project.milestoneTypes).toHaveLength(
        await raw.milestoneTypes.count({ where: { isDeleted: false } })
      );
      const templateNames = project.assignedTemplates.map(
        (entry) => entry.template.templateName
      );
      expect(templateNames).toContain(`Qase ${label}`);
      expect(templateNames).toHaveLength(2);
      expect(project.defaultTemplateId).not.toBeNull();
      expect(onCompleted).toHaveBeenCalledWith([project.id], true);

      const user = await raw.user.findUniqueOrThrow({
        where: { email: `owner-${label}@qase.test` },
        include: { role: true },
      });
      expect(user).toMatchObject({
        name: "Qase Owner",
        access: "PROJECTADMIN",
        isActive: true,
        isApi: true,
        createdById: adminId,
      });
      expect(user.role.isDefault).toBe(true);
      expect(user.emailVerified).not.toBeNull();
      const [{ password }] = await raw.$queryRaw<
        Array<{ password: string | null }>
      >`SELECT password FROM "User" WHERE id = ${user.id}`;
      expect(password).toMatch(/^\$2[aby]\$/);

      // The case a Qase user wrote is credited to the new account; the rest
      // stay with the importer.
      const cases = await raw.repositoryCases.findMany({
        where: { projectId: project.id },
        orderBy: { id: "asc" },
        select: { creatorId: true },
      });
      expect(cases.map((entry) => entry.creatorId)).toEqual([
        user.id,
        adminId,
        adminId,
      ]);
      expect(
        await raw.repositoryCases.count({ where: { projectId: unused } })
      ).toBe(0);
    });

    it("uses the account that already has the address", async () => {
      const admin = await raw.user.findUniqueOrThrow({
        where: { id: adminId },
      });
      const before = await raw.user.count();
      const { jobId, projectId } = await stageJob(
        {},
        (configuration, label) => {
          configuration.users["1"] = {
            ...newUser(label),
            email: admin.email.toUpperCase(),
          };
        }
      );

      await runQaseImport({ db, jobId, copierOptions });

      expect((await readJob(jobId)).status).toBe("COMPLETED");
      expect(await raw.user.count()).toBe(before);
      const unchanged = await raw.user.findUniqueOrThrow({
        where: { id: adminId },
      });
      expect(unchanged.access).toBe(admin.access);
      expect(unchanged.isApi).toBe(admin.isApi);
      expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(3);
    });

    it("does not create them again when a failed import continues", async () => {
      const { jobId, label } = await stageJob({}, asNew);
      saveProgressEveryTime();
      let failed = false;
      const failing = interceptProgress((casesDone) => {
        if (!failed && casesDone >= 1) {
          failed = true;
          throw new Error("Connection lost");
        }
      });

      await expect(
        runQaseImport({ db: failing, jobId, copierOptions })
      ).rejects.toThrow("Connection lost");
      vi.restoreAllMocks();
      await runQaseImport({ db, jobId, copierOptions });

      expect((await readJob(jobId)).status).toBe("COMPLETED");
      const projects = await raw.projects.findMany({
        where: { name: { contains: `Shop from Qase ${label}` } },
        select: { id: true },
      });
      expect(projects).toHaveLength(1);
      expect(
        await raw.user.count({
          where: { email: `owner-${label}@qase.test` },
        })
      ).toBe(1);
      expect(
        await raw.repositoryCases.count({
          where: { projectId: projects[0].id },
        })
      ).toBe(3);
      expect(
        await raw.repositories.count({ where: { projectId: projects[0].id } })
      ).toBe(1);
    });

    it("refuses a name that a deleted project still holds", async () => {
      const taken = `Deleted shop ${STAMP}`;
      await raw.projects.create({
        data: { name: taken, createdBy: adminId, isDeleted: true },
      });
      const { jobId } = await stageJob({}, (configuration) => {
        configuration.projects.SHOP = {
          action: "create",
          mappedTo: null,
          name: taken,
        };
      });

      await expect(runQaseImport({ db, jobId, copierOptions })).rejects.toThrow(
        /deleted project/
      );

      const job = await readJob(jobId);
      expect(job.status).toBe("FAILED");
      expect(job.error).toContain(taken);
    });
  });

  describe("milestones, runs and results", () => {
    const readRuns = (projectId: number) =>
      raw.testRuns.findMany({
        where: { projectId },
        orderBy: { id: "asc" },
        include: {
          tags: true,
          milestone: true,
          configuration: {
            include: {
              variants: {
                include: { variant: { include: { category: true } } },
              },
              projects: true,
            },
          },
          testCases: {
            orderBy: { order: "asc" },
            include: { repositoryCase: true, status: true },
          },
          results: {
            orderBy: { id: "asc" },
            include: {
              status: true,
              attachments: true,
              stepResults: {
                orderBy: { id: "asc" },
                include: { stepStatus: true, attachments: true, step: true },
              },
            },
          },
        },
      });

    it("imports them with their links to cases and steps", async () => {
      const { jobId, projectId, label } = await stageJob({}, undefined, {
        withRuns: true,
      });

      await runQaseImport({ db, jobId, copierOptions });

      const job = await readJob(jobId);
      expect(job.error).toBeNull();
      expect(job.status).toBe("COMPLETED");
      expect(job.entityProgress).toMatchObject({
        milestones: { done: 2, total: 2 },
        runs: { done: 2, total: 2 },
        // The untested result is nothing to record; the result of the
        // deleted case is counted as not imported.
        results: { done: 6, total: 6, failed: 1 },
      });
      expect(
        (job.activityLog as { code: string }[]).map((entry) => entry.code)
      ).toEqual(["run_case_missing", "result_skipped"]);

      // Milestones: the due date is kept in the completion date.
      const milestones = await raw.milestones.findMany({
        where: { projectId },
        orderBy: { id: "asc" },
      });
      expect(
        milestones.map((entry) => [
          entry.name,
          entry.isCompleted,
          entry.milestoneTypesId,
          entry.completedAt?.toISOString(),
        ])
      ).toEqual([
        ["Release 1.0", true, milestoneTypeId, "2026-09-21T00:00:00.000Z"],
        ["Release 1.1", false, milestoneTypeId, "2027-01-15T00:00:00.000Z"],
      ]);
      expect(text(milestones[0].note)).toBe("First release.");
      expect(
        await raw.milestoneTypesAssignment.count({
          where: { projectId, milestoneTypeId },
        })
      ).toBe(1);

      const [regression, smoke] = await readRuns(projectId);

      // A finished run: completed, with its milestone, tags and custom field.
      expect(regression).toMatchObject({
        name: "Release 1.1 regression",
        isCompleted: true,
        stateId: runStates.completed,
        createdById: adminId,
        elapsed: 147,
        testRunType: "REGULAR",
      });
      expect(regression.completedAt?.toISOString()).toBe(
        "2026-11-21T01:22:01.000Z"
      );
      expect(regression.createdAt.toISOString()).toBe(
        "2026-11-21T01:21:57.000Z"
      );
      expect(regression.milestone?.name).toBe("Release 1.1");
      expect(regression.tags.map((tag) => tag.name)).toEqual([
        `regression ${STAMP}`,
      ]);
      expect(text(regression.note)).toBe(
        "Full pass on staging.Build number: 1.1.0-rc2"
      );

      // Its configuration: one variant per Qase configuration value, plus
      // the environment.
      expect(regression.configuration?.name).toBe(
        `macOS, Chrome, Staging ${STAMP}`
      );
      expect(
        regression.configuration?.variants
          .map(
            (entry) => `${entry.variant.category.name}=${entry.variant.name}`
          )
          .sort()
      ).toEqual([
        `Browser ${STAMP}=Chrome`,
        `Environment=Staging ${STAMP}`,
        `Operating system ${STAMP}=macOS`,
      ]);
      expect(
        regression.configuration?.projects.map((entry) => entry.projectId)
      ).toContain(projectId);

      // Each case once, in Qase's order; the deleted case is left out.
      expect(
        regression.testCases.map((entry) => [
          entry.repositoryCase.name,
          entry.order,
        ])
      ).toEqual(CASES.map((entry, order) => [entry.title, order]));

      // An open run stays open.
      expect(smoke).toMatchObject({
        name: "Production smoke",
        isCompleted: false,
        completedAt: null,
        stateId: runStates.active,
        milestoneId: null,
      });
      expect(smoke.configuration?.name).toBe(`Production ${STAMP}`);
      expect(smoke.testCases).toHaveLength(2);
      expect(smoke.results).toHaveLength(1);

      // Results: in the order they were recorded, numbered per run case.
      const [passed, failed, blocked, invalid] = regression.results;
      expect(regression.results).toHaveLength(4);
      expect(
        regression.results.map((entry) => [entry.status.name, entry.attempt])
      ).toEqual([
        ["Passed", 1],
        ["Failed", 2],
        ["Blocked", 1],
        [`Invalid ${label}`, 1],
      ]);
      expect(passed).toMatchObject({ elapsed: 94, executedById: adminId });
      expect(passed.executedAt.toISOString()).toBe("2026-11-21T01:21:57.000Z");
      expect(text(passed.notes)).toBe("All good on chrome.");
      expect(typeof passed.notes).toBe("object");

      // Step results follow the steps, nested ones included.
      const firstCase = regression.testCases[0].repositoryCase;
      const caseSteps = await raw.steps.findMany({
        where: { testCaseId: firstCase.id },
        orderBy: { order: "asc" },
      });
      expect(passed.stepResults.map((entry) => entry.stepId)).toEqual(
        caseSteps.map((step) => step.id)
      );
      expect(text(passed.stepResults[0].notes)).toBe("ok");
      expect(
        passed.stepResults[3].attachments.map((file) => file.name)
      ).toEqual(["login-screen.png"]);

      // The comment, then the stack trace as a code block.
      expect(text(failed.notes)).toContain("Fails on firefox.");
      expect(text(failed.notes)).toContain(
        "AssertionError: dashboard not shown"
      );
      expect(text(failed.notes)).toContain("at login.spec.ts:42");
      expect(JSON.stringify(failed.notes)).toContain('"codeBlock"');
      expect(failed.attachments.map((file) => file.name)).toEqual([
        "failure-log.txt",
      ]);
      expect(failed.attachments[0].url).toMatch(
        /\/api\/storage\/uploads\/attachments\/qase_.+_failure-log\.txt$/
      );
      expect(failed.stepResults.map((entry) => entry.stepStatus.name)).toEqual([
        "Passed",
        "Passed",
        "Failed",
      ]);
      expect(text(failed.stepResults[2].notes)).toBe("Spinner never ends.");

      // A shared step's results point at the placeholder step and the item.
      const group = await raw.sharedStepGroup.findFirstOrThrow({
        where: { projectId },
        include: { items: { orderBy: { order: "asc" } } },
      });
      expect(
        blocked.stepResults.map((entry) => [
          entry.step.sharedStepGroupId,
          entry.sharedStepItemId,
          entry.stepStatus.name,
        ])
      ).toEqual([
        [group.id, group.items[0].id, "Passed"],
        [group.id, group.items[1].id, "Blocked"],
        [null, null, "Skipped"],
      ]);

      // A created status is scoped to test runs and added to the project.
      const created = await raw.status.findUniqueOrThrow({
        where: { id: invalid.statusId },
        include: { scope: { include: { scope: true } }, projects: true },
      });
      expect(created).toMatchObject({
        name: `Invalid ${label}`,
        isCompleted: true,
        isSuccess: false,
        isFailure: false,
        isEnabled: true,
      });
      expect(created.scope.map((entry) => entry.scope.name)).toEqual([
        "Test Run",
      ]);
      expect(created.projects.map((entry) => entry.projectId)).toContain(
        projectId
      );
      // A status nothing used is still created, as the mapping asked.
      expect(
        await raw.status.count({ where: { name: `In progress ${label}` } })
      ).toBe(1);

      // A run case shows its latest result.
      expect(
        regression.testCases.map((entry) => [
          entry.status?.name ?? null,
          entry.isCompleted,
        ])
      ).toEqual([
        ["Failed", true],
        ["Blocked", false],
        [`Invalid ${label}`, true],
      ]);
      expect(
        smoke.testCases.map((entry) => entry.status?.name ?? null)
      ).toEqual([null, "Passed"]);
    });

    it("does not repeat runs or results when a failed import continues", async () => {
      const { jobId, projectId } = await stageJob({}, undefined, {
        withRuns: true,
      });
      saveProgressEveryTime();
      let failed = false;
      const failing = interceptProgress((_cases, progress) => {
        if (!failed && (progress.results?.done ?? 0) >= 2) {
          failed = true;
          throw new Error("Connection lost");
        }
      });

      await expect(
        runQaseImport({ db: failing, jobId, copierOptions })
      ).rejects.toThrow("Connection lost");
      expect(
        await raw.testRunResults.count({ where: { testRun: { projectId } } })
      ).toBe(2);
      vi.restoreAllMocks();

      await runQaseImport({ db, jobId, copierOptions });

      const job = await readJob(jobId);
      expect(job.status).toBe("COMPLETED");
      expect(job.entityProgress).toMatchObject({
        milestones: { done: 2, total: 2 },
        runs: { done: 2, total: 2 },
        results: { done: 6, total: 6 },
      });
      const runs = await readRuns(projectId);
      expect(runs).toHaveLength(2);
      expect(runs[0].testCases).toHaveLength(3);
      expect(
        runs[0].results.map((entry) => [entry.status.systemName, entry.attempt])
      ).toEqual([
        ["passed", 1],
        ["failed", 2],
        ["blocked", 1],
        [expect.stringContaining("invalid"), 1],
      ]);
      expect(runs[1].results).toHaveLength(1);
      expect(await raw.milestones.count({ where: { projectId } })).toBe(2);
      expect(
        await raw.configurations.count({
          where: { name: `macOS, Chrome, Staging ${STAMP}` },
        })
      ).toBe(1);
      expect(runs[0].testCases[0].status?.systemName).toBe("failed");
    });

    it("reuses a milestone of the same name", async () => {
      const { jobId, projectId } = await stageJob({}, undefined, {
        withRuns: true,
      });
      const existing = await raw.milestones.create({
        data: {
          projectId,
          milestoneTypesId: milestoneTypeId,
          name: "release 1.1",
          createdBy: adminId,
        },
      });

      await runQaseImport({ db, jobId, copierOptions });

      expect(await raw.milestones.count({ where: { projectId } })).toBe(2);
      const [regression] = await readRuns(projectId);
      expect(regression.milestoneId).toBe(existing.id);
    });
  });

  it("continues a failed import without writing anything twice", async () => {
    const { jobId, projectId } = await stageJob();
    saveProgressEveryTime();
    let failed = false;
    const failing = interceptProgress((casesDone) => {
      if (!failed && casesDone >= 1) {
        failed = true;
        throw new Error("Connection lost");
      }
    });
    const uploadsBefore = uploads.length;

    await expect(
      runQaseImport({ db: failing, jobId, copierOptions })
    ).rejects.toThrow("Connection lost");

    const stopped = await readJob(jobId);
    expect(stopped.status).toBe("FAILED");
    expect(stopped.phase).toBe("IMPORTING");
    expect(stopped.error).toBe("Connection lost");
    // Kept, so the import can be tried again.
    expect(stopped.apiToken).toBe("encrypted-token");
    expect(
      await raw.qaseImportStaging.count({ where: { jobId } })
    ).toBeGreaterThan(0);
    // The counts say what is really there.
    expect(stopped.entityProgress).toMatchObject({
      cases: { done: 1, total: 3 },
      files: { done: 3, total: 3 },
    });
    expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(1);
    expect(uploads.length - uploadsBefore).toBe(3);

    await runQaseImport({ db, jobId, copierOptions });

    const finished = await readJob(jobId);
    expect(finished.status).toBe("COMPLETED");
    expect(finished.apiToken).toBeNull();
    expect(finished.entityProgress).toEqual({
      folders: { done: 2, total: 2 },
      sharedSteps: { done: 1, total: 1 },
      cases: { done: 3, total: 3 },
      milestones: { done: 0, total: 0 },
      runs: { done: 0, total: 0 },
      results: { done: 0, total: 0 },
      files: { done: 3, total: 3 },
    });
    const cases = await raw.repositoryCases.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      select: { name: true },
    });
    expect(cases.map((entry) => entry.name)).toEqual(
      CASES.map((entry) => entry.title)
    );
    expect(await raw.repositoryFolders.count({ where: { projectId } })).toBe(3);
    expect(await raw.sharedStepGroup.count({ where: { projectId } })).toBe(1);
    expect(
      await raw.templates.count({
        where: { templateName: { contains: `${STAMP}-${run}` } },
      })
    ).toBe(1);
    // Nothing is downloaded a second time.
    expect(uploads.length - uploadsBefore).toBe(3);
  });

  it("stops when a cancel is requested and removes the copied data", async () => {
    const { jobId, projectId } = await stageJob();
    saveProgressEveryTime();
    const canceling = interceptProgress(async (casesDone) => {
      if (casesDone >= 1) {
        await raw.qaseImportJob.update({
          where: { id: jobId },
          data: { cancelRequested: true },
        });
      }
    });

    await runQaseImport({ db: canceling, jobId, copierOptions });

    const job = await readJob(jobId);
    expect(job.status).toBe("CANCELED");
    expect(job.apiToken).toBeNull();
    expect(job.entityProgress).toMatchObject({ cases: { done: 1, total: 3 } });
    expect(await raw.qaseImportStaging.count({ where: { jobId } })).toBe(0);
    // What was already imported stays.
    expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(1);
  });

  it("writes nothing when the cancel came before the import started", async () => {
    const { jobId, projectId } = await stageJob({ cancelRequested: true });

    await runQaseImport({ db, jobId, copierOptions });

    const job = await readJob(jobId);
    expect(job.status).toBe("CANCELED");
    expect(job.apiToken).toBeNull();
    expect(await raw.qaseImportStaging.count({ where: { jobId } })).toBe(0);
    expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(0);
    expect(await raw.repositoryFolders.count({ where: { projectId } })).toBe(0);
  });

  it("refuses a mapping that is not complete", async () => {
    const { jobId, projectId } = await stageJob();
    const job = await raw.qaseImportJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { configuration: true },
    });
    await raw.qaseImportJob.update({
      where: { id: jobId },
      data: {
        configuration: {
          ...(job.configuration as object),
          projects: { SHOP: { action: "map", mappedTo: null, name: "" } },
        },
      },
    });

    await expect(runQaseImport({ db, jobId, copierOptions })).rejects.toThrow();

    expect((await readJob(jobId)).status).toBe("FAILED");
    expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(0);
  });
});
