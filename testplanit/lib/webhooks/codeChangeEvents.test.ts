import { describe, expect, it } from "vitest";
import {
  codeChangeEventLinks,
  describeCodeChangeEvent,
  extractCodeChangeEvent,
  mergedPullRequestFromMessage,
} from "./codeChangeEvents";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("extractCodeChangeEvent", () => {
  it("reads a GitHub pull request", () => {
    const event = extractCodeChangeEvent("GITHUB", "pull_request", {
      action: "opened",
      number: 12,
      pull_request: {
        number: 12,
        title: "Fix checkout",
        html_url: "https://github.com/acme/app/pull/12",
        head: { sha: SHA_B, ref: "feature/x" },
        base: { sha: SHA_A, ref: "main" },
      },
    });
    expect(event).toEqual({
      kind: "pull_request",
      action: "opened",
      number: 12,
      title: "Fix checkout",
      url: "https://github.com/acme/app/pull/12",
      headSha: SHA_B,
      sourceBranch: "feature/x",
      targetBranch: "main",
      baseSha: SHA_A,
    });
    expect(describeCodeChangeEvent(event!)).toBe("PR #12: Fix checkout");
  });

  it("reads a GitHub push and recognises branch creation and deletion", () => {
    const push = extractCodeChangeEvent("GITHUB", "push", {
      ref: "refs/heads/main",
      before: SHA_A,
      after: SHA_B,
      created: false,
      deleted: false,
      commits: [{}, {}],
      compare: "https://github.com/acme/app/compare/a...b",
    });
    expect(push).toMatchObject({
      kind: "push",
      branch: "main",
      before: SHA_A,
      after: SHA_B,
      created: false,
      deleted: false,
      commitCount: 2,
    });
    expect(describeCodeChangeEvent(push!)).toBe("main aaaaaaa…bbbbbbb");

    const created = extractCodeChangeEvent("GITHUB", "push", {
      ref: "refs/heads/new",
      before: "0".repeat(40),
      after: SHA_B,
      created: true,
    });
    expect(created).toMatchObject({ created: true, before: null });

    const tag = extractCodeChangeEvent("GITEA", "push", {
      ref: "refs/tags/v1",
      before: SHA_A,
      after: SHA_B,
    });
    expect(tag).toMatchObject({ branch: null });
  });

  it("reads GitLab merge request and push hooks", () => {
    const mr = extractCodeChangeEvent("GITLAB", "Merge Request Hook", {
      object_kind: "merge_request",
      object_attributes: {
        iid: 7,
        action: "open",
        title: "Add login",
        url: "https://gitlab.com/acme/app/-/merge_requests/7",
        last_commit: { id: SHA_B },
        source_branch: "feature/login",
        target_branch: "main",
      },
    });
    expect(mr).toMatchObject({
      kind: "pull_request",
      action: "opened",
      number: 7,
      headSha: SHA_B,
      targetBranch: "main",
      baseSha: null,
    });
    const push = extractCodeChangeEvent("GITLAB", "Push Hook", {
      object_kind: "push",
      ref: "refs/heads/main",
      before: SHA_A,
      after: SHA_B,
      total_commits_count: 3,
    });
    expect(push).toMatchObject({
      kind: "push",
      branch: "main",
      commitCount: 3,
    });
  });

  it("reads Azure DevOps pull request and push service hooks", () => {
    const pr = extractCodeChangeEvent(
      "AZURE_DEVOPS",
      "git.pullrequest.created",
      {
        resource: {
          pullRequestId: 3,
          title: "Refactor",
          status: "active",
          sourceRefName: "refs/heads/feature",
          targetRefName: "refs/heads/main",
          lastMergeSourceCommit: { commitId: SHA_B },
          lastMergeTargetCommit: { commitId: SHA_A },
          _links: {
            web: { href: "https://dev.azure.com/acme/_git/app/pullrequest/3" },
          },
        },
      }
    );
    expect(pr).toMatchObject({
      kind: "pull_request",
      action: "opened",
      number: 3,
      headSha: SHA_B,
      baseSha: SHA_A,
      sourceBranch: "feature",
      targetBranch: "main",
    });
    const push = extractCodeChangeEvent("AZURE_DEVOPS", "git.push", {
      resource: {
        refUpdates: [
          { name: "refs/heads/main", oldObjectId: SHA_A, newObjectId: SHA_B },
        ],
        commits: [{}],
      },
    });
    expect(push).toMatchObject({
      kind: "push",
      branch: "main",
      before: SHA_A,
      after: SHA_B,
      commitCount: 1,
    });
  });

  it("reads Bitbucket pull request and push events", () => {
    const pr = extractCodeChangeEvent("BITBUCKET", "pullrequest:created", {
      pullrequest: {
        id: 21,
        title: "Ship it",
        links: {
          html: { href: "https://bitbucket.org/acme/app/pull-requests/21" },
        },
        source: { commit: { hash: SHA_B }, branch: { name: "feature" } },
        destination: { commit: { hash: SHA_A }, branch: { name: "master" } },
      },
    });
    expect(pr).toMatchObject({
      kind: "pull_request",
      action: "opened",
      number: 21,
      headSha: SHA_B,
      baseSha: SHA_A,
      targetBranch: "master",
    });
    const push = extractCodeChangeEvent("BITBUCKET", "repo:push", {
      push: {
        changes: [
          {
            old: { type: "branch", name: "master", target: { hash: SHA_A } },
            new: { type: "branch", name: "master", target: { hash: SHA_B } },
            commits: [{}, {}, {}],
            created: false,
            closed: false,
          },
        ],
      },
    });
    expect(push).toMatchObject({
      kind: "push",
      branch: "master",
      before: SHA_A,
      after: SHA_B,
      commitCount: 3,
    });
  });

  it("returns null for events the feature does not act on", () => {
    expect(
      extractCodeChangeEvent("GITHUB", "issues", { action: "opened" })
    ).toBeNull();
    expect(extractCodeChangeEvent("GITLAB", "Issue Hook", {})).toBeNull();
    expect(
      extractCodeChangeEvent("BITBUCKET", "repo:commit_comment_created", {})
    ).toBeNull();
    expect(extractCodeChangeEvent("JIRA", "jira:issue_updated", {})).toBeNull();
  });
});

describe("mergedPullRequestFromMessage", () => {
  it("reads each provider's merge and squash commit subjects", () => {
    expect(
      mergedPullRequestFromMessage(
        "Merge pull request #12 from acme/feature/x\n\nFix checkout"
      )
    ).toEqual({ number: 12, title: "Fix checkout" });
    expect(mergedPullRequestFromMessage("Fix checkout (#12)\n\n* wip")).toEqual(
      { number: 12, title: "Fix checkout" }
    );
    expect(
      mergedPullRequestFromMessage(
        "Merge pull request 'Fix checkout' (#12) from feature/x into main"
      )
    ).toEqual({ number: 12, title: "Fix checkout" });
    expect(mergedPullRequestFromMessage("Merged PR 123: Fix checkout")).toEqual(
      { number: 123, title: "Fix checkout" }
    );
    expect(
      mergedPullRequestFromMessage(
        "Merged in feature/x (pull request #45)\n\nFix checkout\n\nApproved-by: Ada"
      )
    ).toEqual({ number: 45, title: "Fix checkout" });
    expect(
      mergedPullRequestFromMessage("Fix checkout (pull request #45)")
    ).toEqual({ number: 45, title: "Fix checkout" });
    expect(
      mergedPullRequestFromMessage(
        "Merge branch 'feature/x' into 'main'\n\nFix checkout\n\nSee merge request acme/app!7"
      )
    ).toEqual({ number: 7, title: "Fix checkout" });
    expect(
      mergedPullRequestFromMessage(
        "Fix checkout\n\nSquashed.\n\nSee merge request !7"
      )
    ).toEqual({ number: 7, title: "Fix checkout" });
  });

  it("leaves a title out when only trailers follow the merge subject", () => {
    expect(
      mergedPullRequestFromMessage(
        "Merged in feature/x (pull request #45)\n\nApproved-by: Ada"
      )
    ).toEqual({ number: 45, title: null });
  });

  it("ignores ordinary commits", () => {
    expect(mergedPullRequestFromMessage("Fix checkout")).toBeNull();
    expect(mergedPullRequestFromMessage("Bump #12 handling")).toBeNull();
    expect(mergedPullRequestFromMessage(null)).toBeNull();
  });
});

describe("pushes that merged a pull request", () => {
  it("links a Bitbucket merge push to its pull request", () => {
    const push = extractCodeChangeEvent("BITBUCKET", "repo:push", {
      repository: {
        links: { html: { href: "https://bitbucket.org/acme/app" } },
      },
      push: {
        changes: [
          {
            old: { type: "branch", name: "master", target: { hash: SHA_A } },
            new: {
              type: "branch",
              name: "master",
              target: {
                hash: SHA_B,
                message:
                  "Merged in feature/x (pull request #45)\n\nFix checkout\n\nApproved-by: Ada",
              },
            },
            links: {
              html: {
                href: `https://bitbucket.org/acme/app/branches/compare/${SHA_B}..${SHA_A}`,
              },
            },
            commits: [{}],
          },
        ],
      },
    });
    expect(push).toMatchObject({
      kind: "push",
      pullRequest: {
        number: 45,
        title: "Fix checkout",
        url: "https://bitbucket.org/acme/app/pull-requests/45",
      },
    });
    expect(describeCodeChangeEvent(push!)).toBe(
      "master aaaaaaa…bbbbbbb (PR #45: Fix checkout)"
    );
    expect(codeChangeEventLinks(push!)).toEqual([
      {
        label: "master aaaaaaa…bbbbbbb",
        url: `https://bitbucket.org/acme/app/branches/compare/${SHA_B}..${SHA_A}`,
      },
      {
        label: "PR #45: Fix checkout",
        url: "https://bitbucket.org/acme/app/pull-requests/45",
      },
    ]);
  });

  it("links GitHub and Gitea merge pushes under each provider's path", () => {
    const payload = {
      ref: "refs/heads/main",
      before: SHA_A,
      after: SHA_B,
      commits: [{}],
      compare: "https://example.com/acme/app/compare/a...b",
      repository: { html_url: "https://example.com/acme/app" },
      head_commit: {
        message: "Merge pull request #12 from acme/feature/x\n\nFix checkout",
      },
    };
    expect(extractCodeChangeEvent("GITHUB", "push", payload)).toMatchObject({
      pullRequest: {
        number: 12,
        title: "Fix checkout",
        url: "https://example.com/acme/app/pull/12",
      },
    });
    expect(extractCodeChangeEvent("GITEA", "push", payload)).toMatchObject({
      pullRequest: { url: "https://example.com/acme/app/pulls/12" },
    });
  });

  it("finds the head commit in GitLab and Azure DevOps commit lists", () => {
    expect(
      extractCodeChangeEvent("GITLAB", "Push Hook", {
        object_kind: "push",
        ref: "refs/heads/main",
        before: SHA_A,
        after: SHA_B,
        project: { web_url: "https://gitlab.com/acme/app" },
        commits: [
          { id: "c".repeat(40), message: "wip" },
          {
            id: SHA_B,
            message:
              "Merge branch 'feature/x' into 'main'\n\nFix checkout\n\nSee merge request acme/app!7",
          },
        ],
      })
    ).toMatchObject({
      pullRequest: {
        number: 7,
        title: "Fix checkout",
        url: "https://gitlab.com/acme/app/-/merge_requests/7",
      },
    });
    expect(
      extractCodeChangeEvent("AZURE_DEVOPS", "git.push", {
        resource: {
          refUpdates: [
            { name: "refs/heads/main", oldObjectId: SHA_A, newObjectId: SHA_B },
          ],
          repository: {
            remoteUrl: "https://dev.azure.com/acme/app/_git/app",
          },
          commits: [
            { commitId: SHA_B, comment: "Merged PR 123: Fix checkout" },
          ],
        },
      })
    ).toMatchObject({
      pullRequest: {
        number: 123,
        title: "Fix checkout",
        url: "https://dev.azure.com/acme/app/_git/app/pullrequest/123",
      },
    });
  });

  it("leaves a plain push without a pull request and with its compare link only", () => {
    const push = extractCodeChangeEvent("GITHUB", "push", {
      ref: "refs/heads/main",
      before: SHA_A,
      after: SHA_B,
      commits: [{}],
      compare: "https://github.com/acme/app/compare/a...b",
      head_commit: { message: "Fix checkout" },
    });
    expect(push).toMatchObject({ pullRequest: null });
    expect(codeChangeEventLinks(push!)).toEqual([
      {
        label: "main aaaaaaa…bbbbbbb",
        url: "https://github.com/acme/app/compare/a...b",
      },
    ]);
  });
});
