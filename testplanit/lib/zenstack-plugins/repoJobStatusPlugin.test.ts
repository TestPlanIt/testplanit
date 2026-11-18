import { describe, expect, it, vi } from "vitest";

import { getRoutingContext, runWithDbRouting } from "~/lib/db/routingContext";

import { repoJobStatusPlugin } from "./repoJobStatusPlugin";

type OnQuery = (ctx: {
  model: string;
  operation: string;
  args: unknown;
  proceed: (args: unknown) => Promise<unknown>;
  client: unknown;
}) => Promise<unknown>;

const onQuery = repoJobStatusPlugin.onQuery as unknown as OnQuery;

function readFrom(model: string, operation: string) {
  let forcedPrimary: boolean | undefined;
  const proceed = vi.fn(async () => {
    forcedPrimary = getRoutingContext()?.forcePrimary;
    return [];
  });
  return runWithDbRouting(
    async () => {
      await onQuery({ model, operation, args: {}, proceed, client: {} });
      return forcedPrimary;
    },
    { autoReplica: true }
  );
}

describe("repoJobStatusPlugin read routing", () => {
  it("reads repository connections from the primary", async () => {
    expect(await readFrom("ProjectCodeRepositoryConfig", "findMany")).toBe(
      true
    );
  });

  it("leaves other reads on the request's routing", async () => {
    expect(await readFrom("Projects", "findMany")).toBe(false);
  });

  it("leaves writes to repository connections alone", async () => {
    expect(await readFrom("ProjectCodeRepositoryConfig", "update")).toBe(false);
  });
});
