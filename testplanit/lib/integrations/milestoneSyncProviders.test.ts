import { describe, expect, it } from "vitest";
import {
  MILESTONE_SYNC_PROVIDERS,
  isMilestoneSyncProvider,
  milestoneKindsFor,
} from "./milestoneSyncProviders";

describe("milestoneSyncProviders", () => {
  it("lists the trackers that sync milestones", () => {
    expect(MILESTONE_SYNC_PROVIDERS).toEqual([
      "JIRA",
      "GITHUB",
      "GITLAB",
      "GITEA",
      "REDMINE",
      "MANTISBT",
      "AZURE_DEVOPS",
    ]);
    expect(isMilestoneSyncProvider("GITHUB")).toBe(true);
    expect(isMilestoneSyncProvider("CLICKUP")).toBe(false);
    expect(isMilestoneSyncProvider(null)).toBe(false);
  });

  it("offers each tracker the kinds it has", () => {
    expect(milestoneKindsFor("JIRA")).toEqual(["RELEASE", "ITERATION"]);
    expect(milestoneKindsFor("GITHUB")).toEqual(["RELEASE", "ITERATION"]);
    expect(milestoneKindsFor("GITLAB")).toEqual(["RELEASE"]);
    expect(milestoneKindsFor("AZURE_DEVOPS")).toEqual(["ITERATION"]);
  });

  it("returns a stable array for an unknown provider so hook deps do not churn", () => {
    expect(milestoneKindsFor("CLICKUP")).toBe(milestoneKindsFor(undefined));
    expect(milestoneKindsFor("")).toBe(milestoneKindsFor("SIMPLE_URL"));
  });
});
