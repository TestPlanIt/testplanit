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
import type { QaseMappingConfiguration } from "~/services/imports/qase/mapping";
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
  async function stageJob(overrides: Record<string, unknown> = {}) {
    run += 1;
    const label = `${STAMP}-${run}`;
    const project = await raw.projects.create({
      data: { name: `Qase target ${label}`, createdBy: adminId },
    });
    projectIds.push(project.id);

    const configuration: QaseMappingConfiguration = {
      projects: { SHOP: { mappedTo: project.id } },
      users: { "1": { mappedTo: null } },
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
    };

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
        CUSTOM_FIELDS.map((field) => ({ id: String(field.id), data: field })),
      ],
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
    before: (casesDone: number) => Promise<void> | void
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
              data?: { entityProgress?: { cases?: { done?: number } } };
            }) => {
              await before(args.data?.entityProgress?.cases?.done ?? 0);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Staging and mapping rows go with the job; what was imported is hidden so
    // the suites sharing this database do not pick it up.
    await raw.qaseImportJob.deleteMany({ where: { id: { in: jobIds } } });
    await raw.projects.updateMany({
      where: { id: { in: projectIds } },
      data: { isDeleted: true },
    });
    await raw.templates.updateMany({
      where: { templateName: { contains: STAMP } },
      data: { isDeleted: true },
    });
    await raw.caseFields.updateMany({
      where: { displayName: { contains: STAMP } },
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
      files: { done: 3, total: 3 },
    });
    expect(job.activityLog).toEqual([]);
    expect(await raw.qaseImportStaging.count({ where: { jobId } })).toBe(0);
    expect(onCompleted).toHaveBeenCalledWith([projectId]);

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
          projects: { SHOP: { mappedTo: null } },
        },
      },
    });

    await expect(runQaseImport({ db, jobId, copierOptions })).rejects.toThrow();

    expect((await readJob(jobId)).status).toBe("FAILED");
    expect(await raw.repositoryCases.count({ where: { projectId } })).toBe(0);
  });
});
