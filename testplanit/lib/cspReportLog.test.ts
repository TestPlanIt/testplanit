import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordCspViolation, resetCspViolationLog } from "./cspReportLog";

const evalProbe = {
  violatedDirective: "script-src",
  blockedUri: "eval",
  sourceFile: "https://tpi.example.com/_next/static/chunks/a.js",
  line: 1,
  column: 4438,
};

describe("recordCspViolation", () => {
  let log: ReturnType<typeof vi.fn<(message: string, detail: string) => void>>;

  beforeEach(() => {
    resetCspViolationLog();
    log = vi.fn();
  });

  it("logs a violation the first time it is seen", () => {
    recordCspViolation(evalProbe, 1_000, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][1])).toEqual(evalProbe);
  });

  it("stays quiet for repeats inside the window, then logs the count", () => {
    recordCspViolation(evalProbe, 1_000, log);
    for (let i = 0; i < 40; i++) recordCspViolation(evalProbe, 2_000 + i, log);
    expect(log).toHaveBeenCalledTimes(1);

    recordCspViolation(evalProbe, 1_000 + 10 * 60 * 1000, log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[1][1])).toEqual({
      ...evalProbe,
      repeatsSinceLastLog: 40,
    });
  });

  it("treats a different page for the same violation as the same violation", () => {
    recordCspViolation({ ...evalProbe, documentUri: "https://x/a" }, 1, log);
    recordCspViolation({ ...evalProbe, documentUri: "https://x/b" }, 2, log);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("logs violations that differ in directive, URL or location separately", () => {
    recordCspViolation(evalProbe, 1, log);
    recordCspViolation({ ...evalProbe, column: 17437 }, 2, log);
    recordCspViolation({ ...evalProbe, blockedUri: "inline" }, 3, log);
    recordCspViolation(
      { violatedDirective: "img-src", blockedUri: "https://evil/x.png" },
      4,
      log
    );
    expect(log).toHaveBeenCalledTimes(4);
  });
});
