import { describe, expect, it } from "vitest";
import {
  readResultCommentsConfig,
  supportsResultComments,
} from "./resultCommentsConfig";

describe("supportsResultComments", () => {
  it("accepts a GitHub connection that carries its own credentials", () => {
    for (const authType of ["PERSONAL_ACCESS_TOKEN", "API_KEY", "GITHUB_APP"]) {
      expect(supportsResultComments({ provider: "GITHUB", authType })).toBe(
        true
      );
    }
  });

  it("refuses a per-user OAuth connection, which has no account to post as", () => {
    expect(
      supportsResultComments({ provider: "GITHUB", authType: "OAUTH2" })
    ).toBe(false);
  });

  it("refuses other trackers and a missing connection", () => {
    expect(
      supportsResultComments({ provider: "JIRA", authType: "API_KEY" })
    ).toBe(false);
    expect(supportsResultComments({ provider: "GITHUB" })).toBe(false);
    expect(supportsResultComments(null)).toBe(false);
    expect(supportsResultComments(undefined)).toBe(false);
  });
});

describe("readResultCommentsConfig", () => {
  it("is off unless the project saved it on", () => {
    expect(readResultCommentsConfig(null)).toEqual({ enabled: false });
    expect(readResultCommentsConfig({})).toEqual({ enabled: false });
    expect(readResultCommentsConfig("not an object")).toEqual({
      enabled: false,
    });
    expect(
      readResultCommentsConfig({ resultComments: { enabled: "yes" } })
    ).toEqual({ enabled: false });
    expect(
      readResultCommentsConfig({ resultComments: { enabled: false } })
    ).toEqual({ enabled: false });
  });

  it("is on when saved on, whatever else the config holds", () => {
    expect(
      readResultCommentsConfig({
        milestoneSync: { enabled: false },
        resultComments: { enabled: true },
      })
    ).toEqual({ enabled: true });
  });
});
