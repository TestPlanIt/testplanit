import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EnvConfig } from "../../env.js";

// ── Module mock ──────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
  resolveActiveRepository: vi.fn(),
  resolveDefaultTemplate: vi.fn(),
  resolveCaseWorkflowState: vi.fn(),
}));

import * as apiModule from "../../api.js";
import {
  createStepsForCase,
  replaceStepsForCase,
} from "./steps.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createStepsForCase ────────────────────────────────────────────────────────

describe("createStepsForCase", () => {
  it("calls zenstack create per step with correct order (inferred 0-based), sending the text for the host to convert", async () => {
    zenstackMock.mockResolvedValue({ id: 100 });

    await createStepsForCase(
      99,
      [
        { text: "a" },
        { text: "b", expectedResult: "x" },
      ],
      env,
    );

    expect(zenstackMock).toHaveBeenCalledTimes(2);

    const call1 = zenstackMock.mock.calls[0];
    expect(call1[0]).toBe("steps");
    expect(call1[1]).toBe("create");
    expect(call1[2]).toMatchObject({
      data: {
        testCase: { connect: { id: 99 } },
        order: 0,
        step: "a",
        expectedResult: "",
      },
    });

    const call2 = zenstackMock.mock.calls[1];
    expect(call2[0]).toBe("steps");
    expect(call2[1]).toBe("create");
    expect(call2[2]).toMatchObject({
      data: {
        testCase: { connect: { id: 99 } },
        order: 1,
        step: "b",
        expectedResult: "x",
      },
    });
  });

  it("passes Markdown through untouched (#658)", async () => {
    zenstackMock.mockResolvedValue({ id: 100 });

    await createStepsForCase(
      99,
      [{ text: "Open the **New leads** board", expectedResult: "Shows `3` statuses" }],
      env,
    );

    expect(zenstackMock.mock.calls[0][2]).toMatchObject({
      data: {
        step: "Open the **New leads** board",
        expectedResult: "Shows `3` statuses",
      },
    });
  });

  it("sends an empty string for a step with no text", async () => {
    zenstackMock.mockResolvedValue({ id: 100 });

    await createStepsForCase(99, [{ expectedResult: "x" }], env);

    expect(zenstackMock.mock.calls[0][2]).toMatchObject({
      data: { step: "", expectedResult: "x" },
    });
  });

  it("honors explicit order field on step input", async () => {
    zenstackMock.mockResolvedValue({ id: 101 });

    await createStepsForCase(
      10,
      [{ text: "step-a", order: 5 }],
      env,
    );

    const call = zenstackMock.mock.calls[0];
    expect(call[2]).toMatchObject({
      data: expect.objectContaining({ order: 5 }),
    });
  });
});

// ── replaceStepsForCase ───────────────────────────────────────────────────────

const NO_HARD_DELETES = () => {
  expect(zenstackMock).not.toHaveBeenCalledWith(
    "steps",
    "delete",
    expect.anything(),
    expect.anything(),
  );
  expect(zenstackMock).not.toHaveBeenCalledWith(
    "steps",
    "deleteMany",
    expect.anything(),
    expect.anything(),
  );
};

describe("replaceStepsForCase", () => {
  it("creates the new steps in order, then soft-deletes the ones that were there", async () => {
    // findMany (the current set)
    zenstackMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    // create calls for new steps, then the updateMany
    zenstackMock.mockResolvedValue({ id: 200 });

    await replaceStepsForCase(
      55,
      [{ text: "new-step-1" }, { text: "new-step-2" }],
      env,
    );

    const ops = zenstackMock.mock.calls.map((c) => c[1]);
    expect(ops).toEqual(["findMany", "create", "create", "updateMany"]);

    expect(zenstackMock.mock.calls[0][2]).toMatchObject({
      where: { testCaseId: 55, isDeleted: false },
    });
    // Only the steps that existed before are retired — never the new ones.
    expect(zenstackMock.mock.calls[3][2]).toMatchObject({
      where: { id: { in: [1, 2] } },
      data: { isDeleted: true },
    });

    NO_HARD_DELETES();
  });

  it("soft-deletes existing steps even when the new steps array is empty", async () => {
    zenstackMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
    zenstackMock.mockResolvedValueOnce({ count: 3 });

    await replaceStepsForCase(55, [], env);

    expect(zenstackMock).toHaveBeenCalledTimes(2);
    expect(zenstackMock.mock.calls[1][1]).toBe("updateMany");
    expect(zenstackMock.mock.calls[1][2]).toMatchObject({
      where: { id: { in: [1, 2, 3] } },
    });
    NO_HARD_DELETES();
  });

  it("skips the soft-delete when the case had no steps", async () => {
    zenstackMock.mockResolvedValueOnce([]);
    zenstackMock.mockResolvedValue({ id: 200 });

    await replaceStepsForCase(55, [{ text: "only" }], env);

    const ops = zenstackMock.mock.calls.map((c) => c[1]);
    expect(ops).toEqual(["findMany", "create"]);
  });

  it("leaves the old steps in place when a create fails", async () => {
    zenstackMock.mockResolvedValueOnce([{ id: 1 }]);
    zenstackMock.mockResolvedValueOnce({ id: 200 });
    zenstackMock.mockRejectedValueOnce(new Error("422"));

    await expect(
      replaceStepsForCase(55, [{ text: "a" }, { text: "b" }], env),
    ).rejects.toThrow("422");

    expect(zenstackMock).not.toHaveBeenCalledWith(
      "steps",
      "updateMany",
      expect.anything(),
      expect.anything(),
    );
  });
});
