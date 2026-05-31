import { describe, expect, it } from "vitest";
import { testRunChannel, testRunProjectChannel } from "./channels";

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

describe("testRunProjectChannel", () => {
  it("formats the key as live:tenant:<id>:project:<projectId>:testruns", () => {
    expect(testRunProjectChannel("acme", 7)).toBe(
      "live:tenant:acme:project:7:testruns"
    );
  });

  it("scopes by tenant", () => {
    expect(testRunProjectChannel("acme", 7)).not.toBe(
      testRunProjectChannel("globex", 7)
    );
  });

  it("does not collide with testRunChannel for an id-sharing project/run pair", () => {
    // If the namespacing were wrong (e.g. both used `:testrun:`), a
    // project with id 42 and a run with id 42 would share a channel.
    expect(testRunProjectChannel("acme", 42)).not.toBe(
      testRunChannel("acme", 42)
    );
  });

  it("rejects missing tenantId", () => {
    expect(() => testRunProjectChannel("", 7)).toThrow(/tenantId is required/);
  });

  it("rejects non-positive projectId", () => {
    expect(() => testRunProjectChannel("acme", 0)).toThrow(/positive integer/);
    expect(() => testRunProjectChannel("acme", -1)).toThrow(/positive integer/);
    expect(() => testRunProjectChannel("acme", 1.5)).toThrow(
      /positive integer/
    );
  });
});
