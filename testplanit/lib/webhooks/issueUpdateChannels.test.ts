import { describe, expect, it } from "vitest";

import { projectIssueUpdateChannel } from "./issueUpdateChannels";

describe("issueUpdateChannels.projectIssueUpdateChannel", () => {
  it("returns the canonical channel-key shape", () => {
    expect(projectIssueUpdateChannel("acme", 42)).toBe(
      "issue-updates:tenant:acme:project:42"
    );
  });

  it("scopes by tenant — distinct tenants get distinct keys for the same projectId", () => {
    expect(projectIssueUpdateChannel("a", 1)).not.toEqual(
      projectIssueUpdateChannel("b", 1)
    );
  });

  it("scopes by project — distinct projects within a tenant get distinct keys", () => {
    expect(projectIssueUpdateChannel("a", 1)).not.toEqual(
      projectIssueUpdateChannel("a", 2)
    );
  });

  it("throws on empty tenantId — empty string cannot leak across tenants", () => {
    expect(() => projectIssueUpdateChannel("", 1)).toThrow(
      /tenantId is required/i
    );
  });

  it("throws on zero or negative projectId", () => {
    expect(() => projectIssueUpdateChannel("acme", 0)).toThrow(
      /positive integer/i
    );
    expect(() => projectIssueUpdateChannel("acme", -5)).toThrow(
      /positive integer/i
    );
  });

  it("throws on NaN/Infinity projectId", () => {
    expect(() => projectIssueUpdateChannel("acme", NaN)).toThrow();
    expect(() => projectIssueUpdateChannel("acme", Infinity)).toThrow();
  });
});
