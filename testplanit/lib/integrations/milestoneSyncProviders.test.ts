import { describe, expect, it } from "vitest";
import {
  MILESTONE_SYNC_PROVIDERS,
  isMilestoneSyncProvider,
  milestoneKindsFor,
} from "./milestoneSyncProviders";

describe("milestoneSyncProviders", () => {
  it("lists the trackers that sync milestones", () => {
    expect(MILESTONE_SYNC_PROVIDERS).toEqual(["JIRA", "GITHUB"]);
    expect(isMilestoneSyncProvider("GITHUB")).toBe(true);
    expect(isMilestoneSyncProvider("GITLAB")).toBe(false);
    expect(isMilestoneSyncProvider(null)).toBe(false);
  });

  it("offers GitHub releases only and Jira both kinds", () => {
    expect(milestoneKindsFor("GITHUB")).toEqual(["RELEASE"]);
    expect(milestoneKindsFor("JIRA")).toEqual(["RELEASE", "ITERATION"]);
  });

  it("returns a stable array for an unknown provider so hook deps do not churn", () => {
    expect(milestoneKindsFor("GITLAB")).toBe(milestoneKindsFor(undefined));
    expect(milestoneKindsFor("")).toBe(milestoneKindsFor("REDMINE"));
  });
});
