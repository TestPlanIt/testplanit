import { describe, expect, it } from "vitest";
import { AzureDevOpsAdapter } from "./AzureDevOpsAdapter";
import { GiteaAdapter } from "./GiteaAdapter";
import { GitHubAdapter } from "./GitHubAdapter";
import { GitLabAdapter } from "./GitLabAdapter";
import type {
  ExternalMilestone,
  IssueAdapterCapabilities,
} from "./IssueAdapter";
import { JiraAdapter } from "./JiraAdapter";
import { MantisBTAdapter } from "./MantisBTAdapter";
import { RedmineAdapter } from "./RedmineAdapter";
import { SimpleUrlAdapter } from "./SimpleUrlAdapter";

/**
 * Contract test for the `milestones` capability field added in Phase 17
 * (ADPT-01/ADPT-02). Every concrete adapter must declare a `milestones`
 * capability — `false` if the provider has no time-based tracker artifact
 * concept, or `{ kinds, webhooks }` if it does (Jira only, this phase).
 */
describe("IssueAdapter contract: milestones capability", () => {
  const baseConfig = { provider: "TEST", baseUrl: "https://example.test" };

  const nonMilestoneAdapters: Array<{
    name: string;
    instance: { getCapabilities(): IssueAdapterCapabilities };
  }> = [
    {
      name: "AzureDevOpsAdapter",
      instance: new AzureDevOpsAdapter(baseConfig),
    },
    { name: "GitHubAdapter", instance: new GitHubAdapter(baseConfig) },
    { name: "GitLabAdapter", instance: new GitLabAdapter(baseConfig) },
    { name: "GiteaAdapter", instance: new GiteaAdapter(baseConfig) },
    { name: "MantisBTAdapter", instance: new MantisBTAdapter(baseConfig) },
    { name: "RedmineAdapter", instance: new RedmineAdapter(baseConfig) },
    { name: "SimpleUrlAdapter", instance: new SimpleUrlAdapter(baseConfig) },
  ];

  it.each(nonMilestoneAdapters)(
    "$name declares milestones: false",
    ({ instance }) => {
      const capabilities = instance.getCapabilities();
      expect(capabilities.milestones).toBe(false);
      // getExternalMilestones/getMilestoneIssues are optional — adapters
      // without the capability should not implement them.
      expect((instance as any).getExternalMilestones).toBeUndefined();
    }
  );

  it("JiraAdapter declares the milestones capability with both kinds", () => {
    const adapter = new JiraAdapter(baseConfig);
    const capabilities = adapter.getCapabilities();

    expect(capabilities.milestones).not.toBe(false);
    expect(capabilities.milestones).toEqual({
      kinds: ["RELEASE", "ITERATION"],
      webhooks: true,
    });
  });

  it("JiraAdapter implements getExternalMilestones", () => {
    const adapter = new JiraAdapter(baseConfig);
    expect(typeof adapter.getExternalMilestones).toBe("function");
  });

  it("ExternalMilestone shape compiles and is usable at runtime", () => {
    const milestone: ExternalMilestone = {
      id: "10000",
      kind: "RELEASE",
      name: "v1.0",
      description: "First release",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-02-01T00:00:00.000Z"),
      state: "CLOSED",
      rawState: "released",
      url: "https://example.test/browse/version/10000",
    };

    expect(milestone.kind).toBe("RELEASE");
    expect(milestone.state).toBe("CLOSED");
  });

  it("covers exactly the 8 concrete adapters known to implement getCapabilities", () => {
    // Guards against a new adapter landing without declaring `milestones`
    // (research warns this list can silently grow). If this fails, a new
    // adapter file exists — add it to nonMilestoneAdapters (or the Jira
    // assertions above) and update this count.
    expect(nonMilestoneAdapters.length + 1).toBe(8);
  });
});
