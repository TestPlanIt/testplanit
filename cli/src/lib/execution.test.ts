import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  getUrl: vi.fn(() => "https://testplanit.example.com"),
  getToken: vi.fn(() => "tpi_token"),
}));

import {
  completeTestRun,
  finishExecution,
  formatPlan,
  getAutomationPlan,
  parseEnvId,
  selectorValue,
  type AutomationPlan,
} from "./execution.js";

const PLAN: AutomationPlan = {
  runId: 42,
  projectId: 3,
  executionId: 7,
  ref: "main",
  run: { name: "Sprint", testRunType: "HYBRID", configuration: null, milestone: null },
  generatedAt: "2026-09-10T10:00:00.000Z",
  cases: [
    {
      id: 101,
      title: "Login works",
      className: "tests.auth.LoginTest",
      source: "JUNIT",
      automated: true,
      selector: {
        name: "Login works",
        className: "tests.auth.LoginTest",
        fullName: "tests.auth.LoginTest.Login works",
        idTokens: { brackets: "[101]", c: "C101", tc: "TC101" },
      },
      tags: ["smoke"],
    },
    {
      id: 102,
      title: "Logout works",
      className: null,
      source: "MANUAL",
      automated: true,
      selector: {
        name: "Logout works",
        className: null,
        fullName: "Logout works",
        idTokens: { brackets: "[102]", c: "C102", tc: "TC102" },
      },
      tags: [],
    },
  ],
  totals: { cases: 2 },
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

describe("formatPlan / selectorValue", () => {
  it("prints JSON verbatim", () => {
    expect(JSON.parse(formatPlan(PLAN, "json"))).toEqual(PLAN);
  });

  it("prints one selector per line, skipping empty values", () => {
    expect(formatPlan(PLAN, "lines")).toBe(
      "tests.auth.LoginTest.Login works\nLogout works"
    );
    expect(formatPlan(PLAN, "lines", "className")).toBe("tests.auth.LoginTest");
    expect(formatPlan(PLAN, "lines", "id")).toBe("101\n102");
    expect(formatPlan(PLAN, "lines", "title")).toBe("Login works\nLogout works");
  });

  it("exposes each selector field", () => {
    expect(selectorValue(PLAN.cases[0], "fullName")).toBe(
      "tests.auth.LoginTest.Login works"
    );
    expect(selectorValue(PLAN.cases[1], "className")).toBe("");
  });

  it("parses env ids strictly", () => {
    expect(parseEnvId("42")).toBe(42);
    expect(parseEnvId("0")).toBeUndefined();
    expect(parseEnvId("abc")).toBeUndefined();
    expect(parseEnvId(undefined)).toBeUndefined();
  });
});

describe("host calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the plan with the bearer token and optional execution id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, PLAN));
    const plan = await getAutomationPlan(42, 7);
    expect(plan.totals.cases).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://testplanit.example.com/api/test-runs/42/automation-plan?executionId=7"
    );
    expect(init.headers.Authorization).toBe("Bearer tpi_token");
  });

  it("surfaces the server's error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "Test run not found" }));
    await expect(getAutomationPlan(999)).rejects.toThrow("Test run not found");
  });

  it("finishes an execution", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 7, status: "SUCCEEDED" }));
    await expect(finishExecution(42, 7, "success", "all green")).resolves.toEqual({
      id: 7,
      status: "SUCCEEDED",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://testplanit.example.com/api/test-runs/42/executions/7/finish"
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ conclusion: "success", message: "all green" });
  });

  it("completes a run: resolves the project, the DONE state, then updates", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { projectId: 3 } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 55 }] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: 42, isCompleted: true } }));
    await expect(completeTestRun(42)).resolves.toEqual({ id: 42, isCompleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [updateUrl, updateInit] = fetchMock.mock.calls[2];
    expect(updateUrl).toBe("https://testplanit.example.com/api/model/testRuns/update");
    expect(updateInit.method).toBe("PATCH");
    const body = JSON.parse(updateInit.body);
    expect(body.where).toEqual({ id: 42 });
    expect(body.data).toMatchObject({ isCompleted: true, stateId: 55 });
  });

  it("skips the project lookup when a project id is given", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: 42, isCompleted: true } }));
    await completeTestRun(42, 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.data.stateId).toBeUndefined();
  });
});
