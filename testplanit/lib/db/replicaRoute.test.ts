import { describe, expect, it } from "vitest";
import { withReplicaRoute } from "./replicaRoute";
import { getRoutingContext } from "./routingContext";

describe("withReplicaRoute", () => {
  it("runs the handler inside a forceReplica routing frame", async () => {
    const wrapped = withReplicaRoute(async () => {
      const ctx = getRoutingContext();
      return {
        forceReplica: ctx?.forceReplica,
        forcePrimary: ctx?.forcePrimary,
        autoReplica: ctx?.autoReplica,
      };
    });

    expect(getRoutingContext()).toBeUndefined();
    await expect(wrapped()).resolves.toEqual({
      forceReplica: true,
      forcePrimary: false,
      autoReplica: false,
    });
    expect(getRoutingContext()).toBeUndefined();
  });

  it("keeps the frame across awaits and passes arguments and the result through", async () => {
    const seen: Array<boolean | undefined> = [];
    const wrapped = withReplicaRoute(async (a: number, b: string) => {
      seen.push(getRoutingContext()?.forceReplica);
      await new Promise((resolve) => setTimeout(resolve, 0));
      seen.push(getRoutingContext()?.forceReplica);
      return `${a}:${b}`;
    });

    await expect(wrapped(7, "x")).resolves.toBe("7:x");
    expect(seen).toEqual([true, true]);
  });

  it("propagates handler rejections", async () => {
    const wrapped = withReplicaRoute(async () => {
      throw new Error("boom");
    });
    await expect(wrapped()).rejects.toThrow("boom");
  });
});
