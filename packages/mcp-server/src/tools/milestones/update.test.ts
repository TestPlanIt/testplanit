import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({ zenstack: vi.fn(), postHostJson: vi.fn() }));

import { postHostJson, zenstack } from "../../api.js";
import { registerMilestonesUpdate } from "./update.js";

const mockZenstack = vi.mocked(zenstack);
const mockPost = vi.mocked(postHostJson);
const env = { apiUrl: "https://tpi.example.com", apiToken: "tpi_x" };

const HEAD = {
  id: 5,
  isStarted: false,
  isCompleted: false,
  startedAt: null,
  completedAt: "2026-11-30T00:00:00.000Z", // the planned due date
  integrationId: null,
  detachedAt: null,
};
const UPDATED = {
  id: 5,
  name: "Release 2",
  isStarted: true,
  isCompleted: true,
  startedAt: "2026-10-01T00:00:00.000Z",
  completedAt: "2026-11-30T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  milestoneType: { id: 1, name: "Release" },
  creator: { id: "u1", name: "Alice", email: "a@b" },
  parent: null,
  note: null,
};

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMilestonesUpdate(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name: "testplanit_milestones_update", arguments: args });
}

const byOp = (model: string, op: string) =>
  mockZenstack.mock.calls.filter((c) => c[0] === model && c[1] === op);

describe("testplanit_milestones_update", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
    mockPost.mockReset();
    mockZenstack.mockImplementation(async (_model: string, op: string) => {
      if (op === "findUnique") return HEAD;
      return UPDATED;
    });
    mockPost.mockResolvedValue({ status: "success" });
  });

  it("completes through the app's cascade, keeping the planned due date as the completion date", async () => {
    const result = await call({ milestoneId: 5, isCompleted: true });
    expect(result.isError).toBeFalsy();
    expect(mockPost).toHaveBeenCalledWith(
      "/api/milestones/5/complete",
      { completionDate: "2026-11-30", force: true, completeTestRuns: false, completeSessions: false },
      env,
    );
    // Nothing is left for a plain update, so the row is only re-read.
    expect(byOp("milestones", "update")).toHaveLength(0);
  });

  it("passes an explicit completion date and the run/session cascade flags", async () => {
    await call({ milestoneId: 5, isCompleted: true, completedAt: "2026-10-10", completeTestRuns: true });
    expect(mockPost.mock.calls[0]![1]).toEqual({
      completionDate: "2026-10-10",
      force: true,
      completeTestRuns: true,
      completeSessions: false,
    });
  });

  it("records today as the start date only when none is planned, as a calendar day", async () => {
    await call({ milestoneId: 5, isStarted: true });
    const data = (byOp("milestones", "update")[0]![2] as any).data;
    expect(data.isStarted).toBe(true);
    expect(data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);

    mockZenstack.mockImplementation(async (_m: string, op: string) =>
      op === "findUnique" ? { ...HEAD, startedAt: "2026-09-15T00:00:00.000Z" } : UPDATED,
    );
    await call({ milestoneId: 5, isStarted: true });
    const kept = (byOp("milestones", "update")[1]![2] as any).data;
    expect(kept).toEqual({ isStarted: true });
  });

  it("stores dates as calendar days and clearing the due date turns off its automation", async () => {
    await call({ milestoneId: 5, startedAt: "2026-10-01", completedAt: null });
    const data = (byOp("milestones", "update")[0]![2] as any).data;
    expect(data).toEqual({
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: null,
      automaticCompletion: false,
      notifyDaysBefore: 0,
    });
  });

  it("reopens with a plain update and never calls the completion route", async () => {
    mockZenstack.mockImplementation(async (_m: string, op: string) =>
      op === "findUnique" ? { ...HEAD, isCompleted: true } : UPDATED,
    );
    await call({ milestoneId: 5, isCompleted: false });
    expect(mockPost).not.toHaveBeenCalled();
    expect((byOp("milestones", "update")[0]![2] as any).data).toEqual({
      isCompleted: false,
      completedAt: null,
    });
  });

  it("refuses tracker-owned fields on a synced milestone but allows local ones", async () => {
    mockZenstack.mockImplementation(async (_m: string, op: string) =>
      op === "findUnique" ? { ...HEAD, integrationId: 9 } : UPDATED,
    );
    const refused = await call({ milestoneId: 5, name: "Renamed" });
    expect(refused.isError).toBe(true);
    expect((refused.content as any)[0].text).toContain("synced from an external tracker");

    const allowed = await call({ milestoneId: 5, parentId: null });
    expect(allowed.isError).toBeFalsy();
    expect((byOp("milestones", "update")[0]![2] as any).data).toEqual({
      parent: { disconnect: true },
    });
  });

  it("stores the empty document for a cleared note", async () => {
    await call({ milestoneId: 5, note: null });
    expect((byOp("milestones", "update")[0]![2] as any).data).toEqual({ note: "" });
  });
});
