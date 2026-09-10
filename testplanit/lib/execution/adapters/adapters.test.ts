import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", async (orig) => {
  const actual = await orig<typeof import("../http")>();
  return { ...actual, ciRequest: vi.fn() };
});

import { ciRequest, CiRequestError } from "../http";
import { GenericWebhookDispatchAdapter } from "./GenericWebhookDispatchAdapter";
import {
  GitHubDispatchAdapter,
  mapGitHubStatus,
  parseWorkflowDispatch,
} from "./GitHubDispatchAdapter";
import {
  GitLabDispatchAdapter,
  mapGitLabStatus,
} from "./GitLabDispatchAdapter";
import { createCiDispatchAdapter } from "./index";
import { DispatchError } from "./CiDispatchAdapter";

const mockedRequest = ciRequest as unknown as ReturnType<typeof vi.fn>;

function response(
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {}
) {
  const text =
    body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text,
    headers: new Headers(headers),
    json: () => (text ? JSON.parse(text) : null),
  };
}

const REQ = {
  runId: 42,
  executionId: 7,
  projectId: 3,
  ref: "main",
  planUrl:
    "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7",
  appUrl: "https://tpi.example.com",
  inputs: { TESTPLANIT_RUN_ID: "42" },
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe("GitHubDispatchAdapter", () => {
  const adapter = () =>
    new GitHubDispatchAdapter(
      { personalAccessToken: "ghp_secret" },
      { owner: "acme", repo: "web" },
      "e2e.yml"
    );

  it("dispatches with return_run_details on github.com and reads the run id", async () => {
    mockedRequest.mockResolvedValueOnce(
      response(200, {
        workflow_run_id: 555,
        html_url: "https://github.com/acme/web/actions/runs/555",
      })
    );
    const result = await adapter().dispatch(REQ);
    const [url, init] = mockedRequest.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/acme/web/actions/workflows/e2e.yml/dispatches?return_run_details=true"
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ref: "main", inputs: REQ.inputs });
    expect(init.headers.Authorization).toBe("Bearer ghp_secret");
    expect(result).toEqual({
      ref: "main",
      externalRunId: "555",
      externalUrl: "https://github.com/acme/web/actions/runs/555",
    });
  });

  it("treats a bare 204 as accepted and links to the workflow page", async () => {
    mockedRequest.mockResolvedValueOnce(response(204));
    const result = await adapter().dispatch(REQ);
    expect(result.externalRunId).toBeUndefined();
    expect(result.externalUrl).toBe(
      "https://github.com/acme/web/actions/workflows/e2e.yml"
    );
  });

  it("does not ask GHES for run details and derives the web host", async () => {
    const ghes = new GitHubDispatchAdapter(
      { personalAccessToken: "t" },
      {
        owner: "acme",
        repo: "web",
        baseUrl: "https://ghes.example.com/api/v3",
      },
      "e2e.yml"
    );
    mockedRequest.mockResolvedValueOnce(response(204));
    const result = await ghes.dispatch(REQ);
    expect(mockedRequest.mock.calls[0][0]).toBe(
      "https://ghes.example.com/api/v3/repos/acme/web/actions/workflows/e2e.yml/dispatches"
    );
    expect(result.externalUrl).toBe(
      "https://ghes.example.com/acme/web/actions/workflows/e2e.yml"
    );
  });

  it("resolves the default branch when no ref is given", async () => {
    mockedRequest
      .mockResolvedValueOnce(response(200, { default_branch: "develop" }))
      .mockResolvedValueOnce(response(204));
    const result = await adapter().dispatch({ ...REQ, ref: null });
    expect(JSON.parse(mockedRequest.mock.calls[1][1].body).ref).toBe("develop");
    expect(result.ref).toBe("develop");
  });

  it.each([
    [422, "INPUTS", /declare every input|rejected the dispatch/],
    [403, "AUTH", /refused \(403\)/],
    [401, "AUTH", /token/],
    [404, "NOT_FOUND", /could not find/],
    [500, "PROVIDER", /HTTP 500/],
  ])("maps HTTP %s to a %s dispatch error", async (status, code, pattern) => {
    mockedRequest.mockResolvedValueOnce(response(status, { message: "nope" }));
    await expect(adapter().dispatch(REQ)).rejects.toMatchObject({
      name: "DispatchError",
      code,
      message: expect.stringMatching(pattern),
    });
  });

  it("surfaces SSRF blocks and network failures without the token", async () => {
    mockedRequest.mockRejectedValueOnce(
      new CiRequestError("blocked host", "BLOCKED")
    );
    await expect(adapter().dispatch(REQ)).rejects.toMatchObject({
      code: "BLOCKED",
    });
    mockedRequest.mockRejectedValueOnce(
      new CiRequestError("timeout", "TIMEOUT")
    );
    const err = await adapter()
      .dispatch(REQ)
      .catch((e) => e);
    expect(err).toBeInstanceOf(DispatchError);
    expect(String(err.message)).not.toContain("ghp_secret");
  });

  it("reads run status", async () => {
    mockedRequest.mockResolvedValueOnce(
      response(200, {
        status: "completed",
        conclusion: "failure",
        html_url: "u",
      })
    );
    await expect(adapter().getStatus("555")).resolves.toEqual({
      state: "completed",
      conclusion: "failure",
      url: "u",
      raw: "completed/failure",
    });
  });

  it("adopts a lone workflow_dispatch run created after the dispatch", async () => {
    mockedRequest.mockResolvedValueOnce(
      response(200, { workflow_runs: [{ id: 9, html_url: "h" }] })
    );
    await expect(
      adapter().findRunCreatedAfter(
        "main",
        new Date("2026-09-10T00:00:00Z"),
        new Date("2026-09-10T00:07:00Z")
      )
    ).resolves.toEqual({ externalRunId: "9", externalUrl: "h" });
    expect(String(mockedRequest.mock.calls.at(-1)?.[0])).toContain(
      "created=2026-09-10T00%3A00%3A00.000Z..2026-09-10T00%3A07%3A00.000Z"
    );
    mockedRequest.mockResolvedValueOnce(
      response(200, { workflow_runs: [{ id: 9 }, { id: 10 }] })
    );
    await expect(
      adapter().findRunCreatedAfter("main", new Date())
    ).resolves.toBeNull();
  });

  it("verifies a workflow: trigger, declared inputs and token scope", async () => {
    const yaml = [
      "name: e2e",
      "on:",
      "  push:",
      "  workflow_dispatch:",
      "    inputs:",
      "      TESTPLANIT_RUN_ID:",
      "        required: false",
      "      TESTPLANIT_PLAN_URL:",
      "        required: false",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
    ].join("\n");
    mockedRequest
      .mockResolvedValueOnce(
        response(
          200,
          {
            id: 1,
            name: "e2e",
            path: ".github/workflows/e2e.yml",
            state: "active",
          },
          { "x-oauth-scopes": "repo, workflow" }
        )
      )
      .mockResolvedValueOnce(
        response(200, {
          content: Buffer.from(yaml).toString("base64"),
          encoding: "base64",
        })
      );
    const cap = await adapter().testDispatchCapability();
    expect(cap.ok).toBe(true);
    expect(cap.declaredInputs).toEqual([
      "TESTPLANIT_RUN_ID",
      "TESTPLANIT_PLAN_URL",
    ]);
    expect(cap.warnings.join(" ")).toMatch(/TESTPLANIT_EXECUTION_ID/);
  });

  it("fails verification when the workflow has no workflow_dispatch trigger", async () => {
    mockedRequest
      .mockResolvedValueOnce(
        response(200, {
          id: 1,
          name: "ci",
          path: ".github/workflows/ci.yml",
          state: "active",
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          content: Buffer.from("on:\n  push:\njobs: {}\n").toString("base64"),
          encoding: "base64",
        })
      );
    const cap = await adapter().testDispatchCapability();
    expect(cap.ok).toBe(false);
    expect(cap.error).toMatch(/workflow_dispatch/);
  });

  it("lists workflows across pages", async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: i,
        name: `w${i}`,
        path: `p${i}`,
      }));
    mockedRequest
      .mockResolvedValueOnce(response(200, { workflows: page(100) }))
      .mockResolvedValueOnce(response(200, { workflows: page(2) }));
    const list = await adapter().listWorkflows();
    expect(list).toHaveLength(102);
    expect(list[0]).toEqual({ id: "0", name: "w0", path: "p0" });
  });
});

describe("parseWorkflowDispatch", () => {
  it("handles the flow-style on: list and no inputs", () => {
    expect(
      parseWorkflowDispatch("on: [push, workflow_dispatch]\njobs: {}")
    ).toEqual({
      hasWorkflowDispatch: true,
      inputs: [],
    });
    expect(parseWorkflowDispatch("on:\n  push:\n")).toEqual({
      hasWorkflowDispatch: false,
      inputs: [],
    });
  });

  it("stops collecting keys when the inputs block ends", () => {
    const yaml =
      "on:\n  workflow_dispatch:\n    inputs:\n      a:\n        type: string\n      b:\n        default: x\n  schedule:\n    - cron: '0 0 * * *'\n";
    expect(parseWorkflowDispatch(yaml).inputs).toEqual(["a", "b"]);
  });
});

describe("mapGitHubStatus / mapGitLabStatus", () => {
  it("maps provider states onto the shared enum", () => {
    expect(mapGitHubStatus("queued", null).state).toBe("queued");
    expect(mapGitHubStatus("in_progress", null).state).toBe("in_progress");
    expect(mapGitHubStatus("completed", "success").conclusion).toBe("success");
    expect(mapGitHubStatus("completed", "weird").conclusion).toBe("other");
    expect(mapGitHubStatus(undefined, null).state).toBe("unknown");
    expect(mapGitLabStatus("pending").state).toBe("queued");
    expect(mapGitLabStatus("running").state).toBe("in_progress");
    expect(mapGitLabStatus("success")).toMatchObject({
      state: "completed",
      conclusion: "success",
    });
    expect(mapGitLabStatus("canceled").conclusion).toBe("cancelled");
    expect(mapGitLabStatus("bogus").state).toBe("unknown");
  });
});

describe("GitLabDispatchAdapter", () => {
  it("prefers the trigger token and encodes variables as form fields", async () => {
    const adapter = new GitLabDispatchAdapter(
      { triggerToken: "glptt-x", personalAccessToken: "glpat-y" },
      { projectPath: "group/app" }
    );
    mockedRequest.mockResolvedValueOnce(
      response(201, {
        id: 77,
        web_url: "https://gitlab.com/group/app/-/pipelines/77",
        status: "pending",
      })
    );
    const result = await adapter.dispatch(REQ);
    const [url, init] = mockedRequest.mock.calls[0];
    expect(url).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fapp/trigger/pipeline"
    );
    const form = new URLSearchParams(init.body);
    expect(form.get("token")).toBe("glptt-x");
    expect(form.get("ref")).toBe("main");
    expect(form.get("variables[TESTPLANIT_RUN_ID]")).toBe("42");
    expect(result).toEqual({
      ref: "main",
      externalRunId: "77",
      externalUrl: "https://gitlab.com/group/app/-/pipelines/77",
    });
    expect(adapter.supportsStatusPolling).toBe(true);
  });

  it("falls back to the access token and the /pipeline endpoint", async () => {
    const adapter = new GitLabDispatchAdapter(
      { personalAccessToken: "glpat-y" },
      { projectPath: "123", baseUrl: "https://git.example.com" }
    );
    mockedRequest.mockResolvedValueOnce(
      response(201, { id: 5, status: "created" })
    );
    const result = await adapter.dispatch(REQ);
    const [url, init] = mockedRequest.mock.calls[0];
    expect(url).toBe("https://git.example.com/api/v4/projects/123/pipeline");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-y");
    expect(JSON.parse(init.body).variables).toEqual([
      { key: "TESTPLANIT_RUN_ID", value: "42", variable_type: "env_var" },
    ]);
    expect(result.externalUrl).toBe(
      "https://git.example.com/123/-/pipelines/5"
    );
  });

  it("cannot poll with only a trigger token", async () => {
    const adapter = new GitLabDispatchAdapter(
      { triggerToken: "t" },
      { projectPath: "g/a" }
    );
    expect(adapter.supportsStatusPolling).toBe(false);
    await expect(adapter.getStatus("1")).resolves.toMatchObject({
      state: "unknown",
    });
    const cap = await adapter.testDispatchCapability();
    expect(cap.ok).toBe(true);
    expect(cap.warnings[0]).toMatch(/trigger token/);
  });

  it("maps a 401 and a 404", async () => {
    const adapter = new GitLabDispatchAdapter(
      { personalAccessToken: "x" },
      { projectPath: "g/a" }
    );
    mockedRequest.mockResolvedValueOnce(
      response(401, { message: "401 Unauthorized" })
    );
    await expect(adapter.dispatch(REQ)).rejects.toMatchObject({ code: "AUTH" });
    mockedRequest.mockResolvedValueOnce(
      response(404, { message: "404 Project Not Found" })
    );
    await expect(adapter.dispatch(REQ)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("GenericWebhookDispatchAdapter", () => {
  it("posts a signed JSON payload and reads optional ids back", async () => {
    const adapter = new GenericWebhookDispatchAdapter(
      "https://ci.example.com/hooks/tpi",
      "s3cret",
      () => 1_700_000_000_000
    );
    mockedRequest.mockResolvedValueOnce(
      response(202, {
        externalRunId: 12,
        externalUrl: "https://ci.example.com/jobs/12",
      })
    );
    const result = await adapter.dispatch(REQ);
    const [url, init] = mockedRequest.mock.calls[0];
    expect(url).toBe("https://ci.example.com/hooks/tpi");
    expect(init.headers["X-TestPlanIt-Event"]).toBe("test_run.execute");
    expect(init.headers["X-TestPlanIt-Signature"]).toMatch(
      /^t=1700000000,v1=[0-9a-f]{64}$/
    );
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      event: "test_run.execute",
      runId: 42,
      executionId: 7,
      planUrl: REQ.planUrl,
      inputs: REQ.inputs,
    });
    expect(result).toEqual({
      externalRunId: "12",
      externalUrl: "https://ci.example.com/jobs/12",
    });
    expect(adapter.supportsStatusPolling).toBe(false);
  });

  it("links to the Jenkins job page from a Generic Webhook Trigger response", async () => {
    const adapter = new GenericWebhookDispatchAdapter(
      "http://jenkins.internal:8080/generic-webhook-trigger/invoke?token=t",
      "s3cret"
    );
    mockedRequest.mockResolvedValueOnce(
      response(200, {
        jobs: {
          "automated tests": {
            triggered: true,
            id: 19,
            url: "queue/item/19/",
          },
        },
        message: "Triggered jobs.",
      })
    );
    await expect(adapter.dispatch(REQ)).resolves.toEqual({
      externalUrl: "http://jenkins.internal:8080/job/automated%20tests/",
    });
  });

  it("rejects a non-2xx and ignores a garbage externalUrl", async () => {
    const adapter = new GenericWebhookDispatchAdapter(
      "https://ci.example.com/h",
      "s3cret"
    );
    mockedRequest.mockResolvedValueOnce(response(500, "boom"));
    await expect(adapter.dispatch(REQ)).rejects.toMatchObject({
      code: "PROVIDER",
    });
    mockedRequest.mockResolvedValueOnce(
      response(200, { externalUrl: "javascript:alert(1)" })
    );
    await expect(adapter.dispatch(REQ)).resolves.toEqual({});
  });

  it("verifies only the URL shape", async () => {
    await expect(
      new GenericWebhookDispatchAdapter("ftp://x", "s").testDispatchCapability()
    ).resolves.toMatchObject({ ok: false });
    await expect(
      new GenericWebhookDispatchAdapter(
        "https://ci.example.com/h",
        ""
      ).testDispatchCapability()
    ).resolves.toMatchObject({ ok: false });
    await expect(
      new GenericWebhookDispatchAdapter(
        "https://ci.example.com/h",
        "s"
      ).testDispatchCapability()
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("createCiDispatchAdapter", () => {
  it("builds the right adapter per provider and rejects unknown ones", () => {
    expect(
      createCiDispatchAdapter(
        { provider: "GITHUB_ACTIONS", workflowRef: "w.yml" },
        {},
        {}
      )
    ).toBeInstanceOf(GitHubDispatchAdapter);
    expect(
      createCiDispatchAdapter({ provider: "GITLAB_CI" }, {}, {})
    ).toBeInstanceOf(GitLabDispatchAdapter);
    expect(
      createCiDispatchAdapter(
        { provider: "GENERIC_WEBHOOK", url: "https://x" },
        { secret: "s" },
        null
      )
    ).toBeInstanceOf(GenericWebhookDispatchAdapter);
    expect(() =>
      createCiDispatchAdapter({ provider: "JENKINS" }, {}, null)
    ).toThrow(/Unknown/);
  });
});
