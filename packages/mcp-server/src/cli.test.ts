import { describe, it, expect, vi } from "vitest";
import { runServer, type RunDeps } from "./cli.js";
import type { EnvConfig } from "./env.js";
import type { ValidateResult, WhoamiUser } from "./http.js";

const fakeUser: WhoamiUser = {
  id: "u_1",
  name: "Alice",
  email: "a@example.com",
  scopes: ["mode:read"],
  readOnly: true,
  isAgent: false,
};

interface CallLog {
  order: string[];
}

function makeDeps(
  overrides: {
    parseEnvImpl?: RunDeps["parseEnvImpl"];
    validateImpl?: RunDeps["validateImpl"];
    createServerImpl?: RunDeps["createServerImpl"];
    connectImpl?: RunDeps["connectImpl"];
  } = {},
): { deps: RunDeps; log: CallLog; errLog: ReturnType<typeof vi.fn>; exitImpl: ReturnType<typeof vi.fn> } {
  const log: CallLog = { order: [] };
  const errLog = vi.fn();
  const exitImpl = vi.fn();
  const env: EnvConfig = {
    apiUrl: "https://example.invalid",
    apiToken: "tpi_supersecretvalue",
  };
  const deps: RunDeps = {
    parseEnvImpl:
      overrides.parseEnvImpl ??
      ((_envIn) => {
        log.order.push("parseEnvImpl");
        return env;
      }),
    validateImpl:
      overrides.validateImpl ??
      (async () => {
        log.order.push("validateImpl");
        return { ok: true, user: fakeUser } as ValidateResult;
      }),
    createServerImpl:
      overrides.createServerImpl ??
      ((_d) => {
        log.order.push("createServerImpl");
        // Return a sentinel; connectImpl is mocked so the value is never used.
        return {} as ReturnType<RunDeps["createServerImpl"]>;
      }),
    connectImpl:
      overrides.connectImpl ??
      (async (_server) => {
        log.order.push("connectImpl");
      }),
    errLog,
    exitImpl,
  };
  return { deps, log, errLog, exitImpl };
}

describe("runServer", () => {
  it("exits with 1 and writes a stderr message when parseEnv throws (no transport connect)", async () => {
    const { deps, log, errLog, exitImpl } = makeDeps({
      parseEnvImpl: () => {
        throw new Error("boom-bad-env");
      },
    });
    await runServer(deps);
    expect(exitImpl).toHaveBeenCalledWith(1);
    expect(errLog).toHaveBeenCalled();
    expect(log.order).not.toContain("validateImpl");
    expect(log.order).not.toContain("createServerImpl");
    expect(log.order).not.toContain("connectImpl");
  });

  it("exits with 1 and writes a stderr message when validateToken returns ok:false (no transport connect)", async () => {
    const { deps, log, errLog, exitImpl } = makeDeps({
      validateImpl: async () => {
        return { ok: false, message: "Token rejected by server" };
      },
    });
    await runServer(deps);
    expect(exitImpl).toHaveBeenCalledWith(1);
    expect(errLog).toHaveBeenCalled();
    expect(log.order).not.toContain("createServerImpl");
    expect(log.order).not.toContain("connectImpl");
  });

  it("calls connectImpl exactly once and does NOT exit on a happy path", async () => {
    const { deps, log, exitImpl } = makeDeps();
    await runServer(deps);
    expect(exitImpl).not.toHaveBeenCalled();
    expect(log.order.filter((s) => s === "connectImpl")).toHaveLength(1);
  });

  it("invokes parse → validate → createServer → connect in strict serial order on a happy path (Pitfall 6)", async () => {
    const { deps, log } = makeDeps();
    await runServer(deps);
    expect(log.order).toEqual([
      "parseEnvImpl",
      "validateImpl",
      "createServerImpl",
      "connectImpl",
    ]);
  });

  it("does NOT call createServer when validateToken returns ok:false (Pitfall 6)", async () => {
    const localOrder: string[] = [];
    const { deps, log } = makeDeps({
      validateImpl: async () => {
        localOrder.push("validateImpl");
        return { ok: false, message: "Token rejected" };
      },
    });
    await runServer(deps);
    expect(log.order).toContain("parseEnvImpl");
    expect(localOrder).toContain("validateImpl");
    expect(log.order).not.toContain("createServerImpl");
    expect(log.order).not.toContain("connectImpl");
  });

  it("never logs the raw token value in any errLog call (T-05-06)", async () => {
    const { deps, errLog } = makeDeps({
      validateImpl: async () => ({
        ok: false,
        message: "Token rejected by server",
        code: "INVALID_TOKEN",
        statusCode: 401,
      }),
    });
    await runServer(deps);
    expect(errLog).toHaveBeenCalled();
    for (const call of errLog.mock.calls) {
      for (const arg of call) {
        const asString = typeof arg === "string" ? arg : JSON.stringify(arg);
        expect(asString).not.toContain("supersecretvalue");
      }
    }
  });
});
