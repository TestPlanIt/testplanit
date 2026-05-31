import { describe, expect, it } from "vitest";
import { testRunChannel } from "./channels";

describe("testRunChannel", () => {
  it("formats the channel key as live:tenant:<id>:testrun:<runId>", () => {
    expect(testRunChannel("acme", 42)).toBe("live:tenant:acme:testrun:42");
  });

  it("scopes by tenant — different tenants don't share a channel", () => {
    expect(testRunChannel("acme", 42)).not.toBe(testRunChannel("globex", 42));
  });

  it("rejects missing tenantId", () => {
    expect(() => testRunChannel("", 42)).toThrow(/tenantId is required/);
  });

  it("rejects non-positive testRunId", () => {
    expect(() => testRunChannel("acme", 0)).toThrow(/positive integer/);
    expect(() => testRunChannel("acme", -1)).toThrow(/positive integer/);
    expect(() => testRunChannel("acme", 1.5)).toThrow(/positive integer/);
  });
});
