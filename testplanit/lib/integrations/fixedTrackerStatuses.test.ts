import { describe, expect, it } from "vitest";
import { GitHubAdapter } from "./adapters/GitHubAdapter";
import { GitLabAdapter } from "./adapters/GitLabAdapter";
import { GiteaAdapter } from "./adapters/GiteaAdapter";
import { FIXED_TRACKER_STATUSES } from "./fixedTrackerStatuses";

describe("FIXED_TRACKER_STATUSES", () => {
  it("lists open/closed for GitHub and Gitea and opened/closed for GitLab", () => {
    expect(FIXED_TRACKER_STATUSES.GITHUB).toEqual([
      { id: "open", name: "open" },
      { id: "closed", name: "closed" },
    ]);
    expect(FIXED_TRACKER_STATUSES.GITEA).toEqual([
      { id: "open", name: "open" },
      { id: "closed", name: "closed" },
    ]);
    expect(FIXED_TRACKER_STATUSES.GITLAB).toEqual([
      { id: "opened", name: "opened" },
      { id: "closed", name: "closed" },
    ]);
  });

  it("has no entry for trackers with configurable workflows", () => {
    expect(FIXED_TRACKER_STATUSES.JIRA).toBeUndefined();
    expect(FIXED_TRACKER_STATUSES.AZURE_DEVOPS).toBeUndefined();
  });
});

describe("fixed-state adapters' getStatuses", () => {
  const cases = [
    [
      "GITHUB",
      () =>
        new GitHubAdapter({
          repository: "testowner/testrepo",
          provider: "GITHUB",
        }),
    ],
    [
      "GITEA",
      () =>
        new GiteaAdapter({
          provider: "GITEA",
          owner: "testowner",
          repo: "testrepo",
          baseUrl: "https://gitea.example.com",
        }),
    ],
    [
      "GITLAB",
      () =>
        new GitLabAdapter({
          provider: "GITLAB",
          projectPath: "testgroup/testrepo",
          baseUrl: "https://gitlab.com",
        }),
    ],
  ] as const;

  it.each(cases)(
    "%s returns a fresh copy of its fixed list",
    async (provider, make) => {
      const adapter = make();
      const first = await adapter.getStatuses();
      const second = await adapter.getStatuses();

      expect(first).toEqual(FIXED_TRACKER_STATUSES[provider]);
      expect(first).not.toBe(FIXED_TRACKER_STATUSES[provider]);
      expect(first).not.toBe(second);

      first.push({ id: "x", name: "x" });
      expect(FIXED_TRACKER_STATUSES[provider]).toHaveLength(2);
    }
  );
});
