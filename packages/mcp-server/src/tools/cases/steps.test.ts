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
  wrapPlainTextInProseMirror,
  createStepsForCase,
  replaceStepsForCase,
} from "./steps.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── wrapPlainTextInProseMirror ────────────────────────────────────────────────

describe("wrapPlainTextInProseMirror", () => {
  it("wraps plain text in minimal ProseMirror doc structure", () => {
    const result = wrapPlainTextInProseMirror("Open login page");
    expect(result).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Open login page" }],
        },
      ],
    });
  });

  it("returns a paragraph with empty content for empty string", () => {
    const result = wrapPlainTextInProseMirror("");
    expect(result).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it("returns a paragraph with empty content for null", () => {
    const result = wrapPlainTextInProseMirror(null);
    expect(result).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it("returns a paragraph with empty content for undefined", () => {
    const result = wrapPlainTextInProseMirror(undefined);
    expect(result).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });
});

// ── createStepsForCase ────────────────────────────────────────────────────────

describe("createStepsForCase", () => {
  it("calls zenstack create per step with correct order (inferred 0-based)", async () => {
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
        step: wrapPlainTextInProseMirror("a"),
        expectedResult: null,
      },
    });

    const call2 = zenstackMock.mock.calls[1];
    expect(call2[0]).toBe("steps");
    expect(call2[1]).toBe("create");
    expect(call2[2]).toMatchObject({
      data: {
        testCase: { connect: { id: 99 } },
        order: 1,
        step: wrapPlainTextInProseMirror("b"),
        expectedResult: wrapPlainTextInProseMirror("x"),
      },
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

describe("replaceStepsForCase", () => {
  it("soft-deletes current steps then creates new ones in order", async () => {
    // updateMany (soft-delete)
    zenstackMock.mockResolvedValueOnce({ count: 2 });
    // create calls for new steps
    zenstackMock.mockResolvedValue({ id: 200 });

    await replaceStepsForCase(
      55,
      [{ text: "new-step-1" }, { text: "new-step-2" }],
      env,
    );

    // First call MUST be updateMany to soft-delete
    const updateManyCall = zenstackMock.mock.calls[0];
    expect(updateManyCall[0]).toBe("steps");
    expect(updateManyCall[1]).toBe("updateMany");
    expect(updateManyCall[2]).toMatchObject({
      where: { testCaseId: 55, isDeleted: false },
      data: { isDeleted: true },
    });

    // Subsequent calls are creates
    expect(zenstackMock.mock.calls[1][1]).toBe("create");
    expect(zenstackMock.mock.calls[2][1]).toBe("create");

    // CRITICAL (T-06-06): NEVER calls delete or deleteMany
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
  });

  it("soft-deletes existing steps even when new steps array is empty", async () => {
    zenstackMock.mockResolvedValueOnce({ count: 3 });

    await replaceStepsForCase(55, [], env);

    // Must still call updateMany to soft-delete
    expect(zenstackMock).toHaveBeenCalledTimes(1);
    expect(zenstackMock.mock.calls[0][1]).toBe("updateMany");

    // CRITICAL: no delete or deleteMany
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
  });

  it("updateMany fires before any create (ordering guarantee)", async () => {
    const callOrder: string[] = [];
    zenstackMock.mockImplementation(async (_model, operation) => {
      callOrder.push(operation as string);
      return operation === "updateMany" ? { count: 1 } : { id: 1 };
    });

    await replaceStepsForCase(77, [{ text: "step" }], env);

    expect(callOrder[0]).toBe("updateMany");
    expect(callOrder[1]).toBe("create");
  });
});
