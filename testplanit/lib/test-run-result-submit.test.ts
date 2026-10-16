import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  submitTestRunResult,
  TEST_RUN_ALL_CASES_COMPLETED_EVENT,
  type TestRunAllCasesCompletedDetail,
} from "./test-run-result-submit";

const input = {
  testRunId: 7,
  testRunCaseId: 70,
  statusId: 2,
  attempt: 1,
  testRunCaseVersion: 1,
};

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    })
  );
}

describe("submitTestRunResult", () => {
  const received: TestRunAllCasesCompletedDetail[] = [];
  const listener = (event: Event) => {
    received.push(
      (event as CustomEvent<TestRunAllCasesCompletedDetail>).detail
    );
  };

  beforeEach(() => {
    received.length = 0;
    window.addEventListener(TEST_RUN_ALL_CASES_COMPLETED_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(TEST_RUN_ALL_CASES_COMPLETED_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it("raises the all-cases-completed event for the run when the server reports the transition", async () => {
    mockFetchResponse({
      result: { id: 1 },
      runProgress: { allCasesJustCompleted: true },
    });

    const result = await submitTestRunResult(input);

    expect(result).toEqual({ id: 1 });
    expect(received).toEqual([{ testRunId: 7 }]);
  });

  it("stays quiet when the run is not yet fully recorded", async () => {
    mockFetchResponse({
      result: { id: 2 },
      runProgress: { allCasesJustCompleted: false },
    });

    await submitTestRunResult(input);

    expect(received).toEqual([]);
  });

  it("stays quiet for responses without run progress", async () => {
    mockFetchResponse({ result: { id: 3 } });

    await submitTestRunResult(input);

    expect(received).toEqual([]);
  });

  it("does not raise the event when the submission is rejected", async () => {
    mockFetchResponse({ error: "nope", code: "RUN_COMPLETED" }, false, 409);

    await expect(submitTestRunResult(input)).rejects.toMatchObject({
      status: 409,
      code: "RUN_COMPLETED",
    });
    expect(received).toEqual([]);
  });
});
