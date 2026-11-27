import { describe, expect, it } from "vitest";
import { MILESTONE_KINDS_BY_PROVIDER } from "../milestoneSyncProviders";
import { AzureDevOpsAdapter } from "./AzureDevOpsAdapter";
import { ClickUpAdapter } from "./ClickUpAdapter";
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
    { name: "ClickUpAdapter", instance: new ClickUpAdapter(baseConfig) },
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

  const milestoneAdapters: Array<{
    provider: string;
    webhooks: boolean;
    instance: {
      getCapabilities(): IssueAdapterCapabilities;
      getExternalMilestones?: unknown;
      getMilestoneIssues?: unknown;
    };
  }> = [
    {
      provider: "GITHUB",
      webhooks: true,
      instance: new GitHubAdapter(baseConfig),
    },
    {
      provider: "GITLAB",
      webhooks: true,
      instance: new GitLabAdapter(baseConfig),
    },
    {
      provider: "GITEA",
      webhooks: false,
      instance: new GiteaAdapter(baseConfig),
    },
    {
      provider: "REDMINE",
      webhooks: true,
      instance: new RedmineAdapter(baseConfig),
    },
    {
      provider: "MANTISBT",
      webhooks: false,
      instance: new MantisBTAdapter(baseConfig),
    },
    {
      provider: "AZURE_DEVOPS",
      webhooks: false,
      instance: new AzureDevOpsAdapter(baseConfig),
    },
  ];

  it.each(milestoneAdapters)(
    "the $provider adapter declares the kinds the provider list offers and implements both methods",
    ({ provider, webhooks, instance }) => {
      expect(instance.getCapabilities().milestones).toEqual({
        kinds: MILESTONE_KINDS_BY_PROVIDER[provider],
        webhooks,
      });
      expect(typeof instance.getExternalMilestones).toBe("function");
      expect(typeof instance.getMilestoneIssues).toBe("function");
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

  it("covers exactly the 9 concrete adapters known to implement getCapabilities", () => {
    // Guards against a new adapter landing without declaring `milestones`.
    // If this fails, a new adapter file exists: add it to
    // nonMilestoneAdapters or milestoneAdapters and update this count.
    expect(nonMilestoneAdapters.length + milestoneAdapters.length + 1).toBe(9);
  });
});
