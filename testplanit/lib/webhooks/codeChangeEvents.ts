import type { AdapterType } from "~/zenstack/models";

/**
 * The two repository events Impact Analysis acts on, read out of each
 * provider's webhook payload into one shape. Everything provider-specific
 * stops here; the service that starts analyses sees only this.
 */
export type CodeChangeEvent =
  | {
      kind: "pull_request";
      /** "opened" | "reopened" | "synchronize" | "closed" | "other". */
      action: string;
      number: number;
      title: string;
      url: string | null;
      headSha: string | null;
      sourceBranch: string | null;
      targetBranch: string | null;
      /** The target branch's sha when the provider sent one. */
      baseSha: string | null;
    }
  | {
      kind: "push";
      /** Branch name, without `refs/heads/`. Null for tags. */
      branch: string | null;
      before: string | null;
      after: string | null;
      /** Branch created (no before) or deleted (no after). */
      created: boolean;
      deleted: boolean;
      commitCount: number;
      url: string | null;
      /**
       * The pull request the pushed head commit merged, read from the
       * provider's merge or squash commit message. Null when the push was
       * not a merge the provider made.
       */
      pullRequest: MergedPullRequest | null;
    };

export interface MergedPullRequest {
  number: number;
  title: string | null;
  url: string | null;
}

/** Which subscribed-event key an event falls under. */
export const CODE_EVENT_PULL_REQUEST = "code:pull_request";
/** A push to the base branch: compares the pushed commits. */
export const CODE_EVENT_PUSH = "code:push";
/** A push to any other branch: compares it against the base branch. */
export const CODE_EVENT_BRANCH_PUSH = "code:branch_push";
export const CODE_EVENT_KEYS = [
  CODE_EVENT_PULL_REQUEST,
  CODE_EVENT_PUSH,
  CODE_EVENT_BRANCH_PUSH,
] as const;
/** Events a new repository webhook handles until told otherwise. */
export const CODE_EVENT_DEFAULTS = [
  CODE_EVENT_PULL_REQUEST,
  CODE_EVENT_PUSH,
] as const;

/** Inbound adapter that verifies a code repository provider's webhooks. */
const CODE_REPOSITORY_ADAPTERS: Record<string, AdapterType> = {
  GITHUB: "GITHUB",
  GITLAB: "GITLAB",
  GITEA: "GITEA",
  AZURE_DEVOPS: "AZURE_DEVOPS",
  BITBUCKET: "BITBUCKET",
};

export function inboundAdapterForCodeRepository(
  provider: string | null | undefined
): AdapterType | null {
  return provider ? (CODE_REPOSITORY_ADAPTERS[provider] ?? null) : null;
}

/** Events a repository webhook may act on, both on by default. */
export const CODE_REPOSITORY_WEBHOOK_EVENTS = CODE_EVENT_KEYS;

/**
 * Pull request number the Send test action uses. Providers number pull
 * requests from 1, and the payload is signed with the webhook's secret, so
 * a real repository cannot produce it.
 */
export const SYNTHETIC_PULL_REQUEST_NUMBER = 0;

export function isSyntheticCodeChangeEvent(event: CodeChangeEvent): boolean {
  return (
    event.kind === "pull_request" &&
    event.number === SYNTHETIC_PULL_REQUEST_NUMBER
  );
}

const NULL_SHA = /^0{40}$/;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function branchOf(ref: unknown): string | null {
  const s = str(ref);
  if (!s) return null;
  if (s.startsWith("refs/heads/")) return s.slice("refs/heads/".length);
  if (s.startsWith("refs/tags/")) return null;
  return s;
}
function shaOrNull(value: unknown): string | null {
  const s = str(value);
  return s && !NULL_SHA.test(s) ? s : null;
}

const TRAILER_LINE = /^[A-Za-z-]+:\s/;

/**
 * The pull request a provider-made merge or squash commit names in its
 * message, in the formats GitHub, Gitea, GitLab, Azure DevOps and Bitbucket
 * write. The title is the line the provider puts it on: the subject for a
 * squash, the first body line for a merge commit.
 */
export function mergedPullRequestFromMessage(
  message: string | null | undefined
): { number: number; title: string | null } | null {
  if (!message) return null;
  const lines = message.split(/\r?\n/).map((line) => line.trim());
  const subject = lines[0] ?? "";
  const bodyLine =
    lines
      .slice(1)
      .find((line) => line.length > 0 && !TRAILER_LINE.test(line)) ?? null;
  const title = (value: string | null) => {
    const t = value?.trim() ?? "";
    return t.length > 0 ? t : null;
  };
  let m: RegExpExecArray | null;
  if ((m = /^Merge pull request #(\d+) from \S+/.exec(subject))) {
    return { number: Number(m[1]), title: title(bodyLine) };
  }
  if ((m = /^Merge pull request '(.+)' \(#(\d+)\) from /.exec(subject))) {
    return { number: Number(m[2]), title: title(m[1]) };
  }
  if ((m = /^Merged PR (\d+): (.*)$/.exec(subject))) {
    return { number: Number(m[1]), title: title(m[2]) };
  }
  if ((m = /^Merged in .+ \(pull request #(\d+)\)$/.exec(subject))) {
    return { number: Number(m[1]), title: title(bodyLine) };
  }
  if ((m = /^(.*?) \(pull request #(\d+)\)$/.exec(subject))) {
    return { number: Number(m[2]), title: title(m[1]) };
  }
  if ((m = /See merge request \S*?!(\d+)/.exec(message))) {
    const isMergeCommit = /^Merge branch '.+' into '.+'$/.test(subject);
    return {
      number: Number(m[1]),
      title: title(isMergeCommit ? bodyLine : subject),
    };
  }
  if ((m = /^(.*?) \(#(\d+)\)$/.exec(subject))) {
    return { number: Number(m[2]), title: title(m[1]) };
  }
  return null;
}

/** `base/path/<number>` under the repository's web URL, or null without one. */
function pullRequestUrl(
  repoWebUrl: unknown,
  path: string,
  number: number
): string | null {
  const base = str(repoWebUrl)
    ?.replace(/\/+$/, "")
    .replace(/\.git$/, "");
  return base ? `${base}/${path}/${number}` : null;
}

function mergedPullRequest(
  message: unknown,
  repoWebUrl: unknown,
  path: string
): MergedPullRequest | null {
  const found = mergedPullRequestFromMessage(str(message));
  if (!found) return null;
  return { ...found, url: pullRequestUrl(repoWebUrl, path, found.number) };
}

/**
 * The message of the pushed head commit out of a payload's commit list: the
 * commit whose id is the push's `after`, else the list's newest end.
 */
function headCommitMessage(
  commits: unknown,
  idKey: string,
  headSha: string | null,
  messageKey: string,
  newest: "first" | "last"
): string | null {
  if (!Array.isArray(commits) || commits.length === 0) return null;
  const head =
    (headSha &&
      commits.find(
        (c: any) =>
          typeof c?.[idKey] === "string" &&
          (c[idKey] === headSha || headSha.startsWith(c[idKey]))
      )) ??
    (newest === "first" ? commits[0] : commits[commits.length - 1]);
  return str(head?.[messageKey]);
}

function githubLike(
  provider: "GITHUB" | "GITEA",
  eventType: string,
  data: any
): CodeChangeEvent | null {
  if (eventType === "pull_request") {
    const pr = data?.pull_request;
    const number = num(data?.number ?? pr?.number);
    if (!pr || number === null) return null;
    return {
      kind: "pull_request",
      action: str(data.action) ?? "other",
      number,
      title: str(pr.title) ?? `#${number}`,
      url: str(pr.html_url),
      headSha: str(pr.head?.sha),
      sourceBranch: str(pr.head?.ref),
      targetBranch: str(pr.base?.ref),
      baseSha: str(pr.base?.sha),
    };
  }
  if (eventType === "push") {
    const before = shaOrNull(data?.before);
    const after = shaOrNull(data?.after);
    return {
      kind: "push",
      branch: branchOf(data?.ref),
      before,
      after,
      created: data?.created === true || before === null,
      deleted: data?.deleted === true || after === null,
      commitCount: Array.isArray(data?.commits) ? data.commits.length : 0,
      url: str(data?.compare) ?? str(data?.compare_url),
      pullRequest: mergedPullRequest(
        data?.head_commit?.message,
        data?.repository?.html_url,
        provider === "GITEA" ? "pulls" : "pull"
      ),
    };
  }
  return null;
}

function gitlab(eventType: string, data: any): CodeChangeEvent | null {
  const kind = str(data?.object_kind) ?? eventType;
  if (kind === "merge_request" || eventType === "Merge Request Hook") {
    const attrs = data?.object_attributes;
    const number = num(attrs?.iid);
    if (!attrs || number === null) return null;
    const action = str(attrs.action) ?? "other";
    return {
      kind: "pull_request",
      action:
        action === "open"
          ? "opened"
          : action === "reopen"
            ? "reopened"
            : action === "update"
              ? "synchronize"
              : action === "close" || action === "merge"
                ? "closed"
                : action,
      number,
      title: str(attrs.title) ?? `!${number}`,
      url: str(attrs.url),
      headSha: str(attrs.last_commit?.id),
      sourceBranch: str(attrs.source_branch),
      targetBranch: str(attrs.target_branch),
      baseSha: null,
    };
  }
  if (kind === "push" || eventType === "Push Hook") {
    const before = shaOrNull(data?.before);
    const after = shaOrNull(data?.after);
    return {
      kind: "push",
      branch: branchOf(data?.ref),
      before,
      after,
      created: before === null,
      deleted: after === null,
      commitCount:
        num(data?.total_commits_count) ??
        (Array.isArray(data?.commits) ? data.commits.length : 0),
      url: null,
      pullRequest: mergedPullRequest(
        headCommitMessage(data?.commits, "id", after, "message", "last"),
        data?.project?.web_url,
        "-/merge_requests"
      ),
    };
  }
  return null;
}

function azureDevops(eventType: string, data: any): CodeChangeEvent | null {
  const resource = data?.resource;
  if (
    eventType === "git.pullrequest.created" ||
    eventType === "git.pullrequest.updated"
  ) {
    const number = num(resource?.pullRequestId);
    if (!resource || number === null) return null;
    const status = str(resource.status);
    return {
      kind: "pull_request",
      action:
        eventType === "git.pullrequest.created"
          ? "opened"
          : status === "completed" || status === "abandoned"
            ? "closed"
            : "synchronize",
      number,
      title: str(resource.title) ?? `PR ${number}`,
      url: str(resource._links?.web?.href) ?? str(resource.url),
      headSha: str(resource.lastMergeSourceCommit?.commitId),
      sourceBranch: branchOf(resource.sourceRefName),
      targetBranch: branchOf(resource.targetRefName),
      baseSha: str(resource.lastMergeTargetCommit?.commitId),
    };
  }
  if (eventType === "git.push") {
    const update = Array.isArray(resource?.refUpdates)
      ? resource.refUpdates[0]
      : null;
    if (!update) return null;
    const before = shaOrNull(update.oldObjectId);
    const after = shaOrNull(update.newObjectId);
    return {
      kind: "push",
      branch: branchOf(update.name),
      before,
      after,
      created: before === null,
      deleted: after === null,
      commitCount: Array.isArray(resource?.commits)
        ? resource.commits.length
        : 0,
      url: str(resource?._links?.web?.href) ?? str(resource?.url),
      pullRequest: mergedPullRequest(
        headCommitMessage(
          resource?.commits,
          "commitId",
          after,
          "comment",
          "first"
        ),
        resource?.repository?.remoteUrl ?? resource?.repository?.webUrl,
        "pullrequest"
      ),
    };
  }
  return null;
}

function bitbucket(eventType: string, data: any): CodeChangeEvent | null {
  if (eventType.startsWith("pullrequest:")) {
    const pr = data?.pullrequest;
    const number = num(pr?.id);
    if (!pr || number === null) return null;
    const action = eventType.slice("pullrequest:".length);
    return {
      kind: "pull_request",
      action:
        action === "created"
          ? "opened"
          : action === "updated"
            ? "synchronize"
            : action === "fulfilled" || action === "rejected"
              ? "closed"
              : action,
      number,
      title: str(pr.title) ?? `#${number}`,
      url: str(pr.links?.html?.href),
      headSha: str(pr.source?.commit?.hash),
      sourceBranch: str(pr.source?.branch?.name),
      targetBranch: str(pr.destination?.branch?.name),
      baseSha: str(pr.destination?.commit?.hash),
    };
  }
  if (eventType === "repo:push") {
    const change = Array.isArray(data?.push?.changes)
      ? data.push.changes[0]
      : null;
    if (!change) return null;
    const newRef = change.new;
    const oldRef = change.old;
    if (newRef && newRef.type && newRef.type !== "branch") return null;
    return {
      kind: "push",
      branch: str(newRef?.name) ?? str(oldRef?.name),
      before: shaOrNull(oldRef?.target?.hash),
      after: shaOrNull(newRef?.target?.hash),
      created: change.created === true || !oldRef,
      deleted: change.closed === true || !newRef,
      commitCount: Array.isArray(change.commits) ? change.commits.length : 0,
      url: str(change.links?.html?.href),
      pullRequest: mergedPullRequest(
        newRef?.target?.message ??
          headCommitMessage(
            change.commits,
            "hash",
            newRef?.target?.hash,
            "message",
            "first"
          ),
        data?.repository?.links?.html?.href,
        "pull-requests"
      ),
    };
  }
  return null;
}

/**
 * Read a repository event from a verified payload. Null means the event is
 * not a pull request or push this feature acts on (issue events, comments,
 * pings), which the receiver records as "no handler" rather than an error.
 */
export function extractCodeChangeEvent(
  adapterType: AdapterType | string,
  eventType: string,
  data: unknown
): CodeChangeEvent | null {
  switch (adapterType) {
    case "GITHUB":
      return githubLike("GITHUB", eventType, data);
    case "GITEA":
      return githubLike("GITEA", eventType, data);
    case "GITLAB":
      return gitlab(eventType, data);
    case "AZURE_DEVOPS":
      return azureDevops(eventType, data);
    case "BITBUCKET":
      return bitbucket(eventType, data);
    default:
      return null;
  }
}

/** Short human label for the run and the analysis. */
export function describeCodeChangeEvent(event: CodeChangeEvent): string {
  if (event.kind === "pull_request") {
    return `PR #${event.number}: ${event.title}`;
  }
  const range = describePushRange(event);
  return event.pullRequest
    ? `${range} (${describeMergedPullRequest(event.pullRequest)})`
    : range;
}

function describePushRange(
  event: Extract<CodeChangeEvent, { kind: "push" }>
): string {
  const from = event.before ? event.before.slice(0, 7) : "start";
  const to = event.after ? event.after.slice(0, 7) : "";
  return `${event.branch ?? "push"} ${from}…${to}`;
}

/** "PR #12: Fix checkout", or "PR #12" when the message carried no title. */
export function describeMergedPullRequest(pr: MergedPullRequest): string {
  return pr.title ? `PR #${pr.number}: ${pr.title}` : `PR #${pr.number}`;
}

/**
 * The links an event leaves on what it starts: the pull request for a pull
 * request event; for a push, the provider's compare page and, when the head
 * commit merged a pull request, that pull request too.
 */
export function codeChangeEventLinks(
  event: CodeChangeEvent
): { label: string; url: string | null }[] {
  if (event.kind === "pull_request") {
    return [{ label: describeCodeChangeEvent(event), url: event.url }];
  }
  const links = [{ label: describePushRange(event), url: event.url }];
  if (event.pullRequest) {
    links.push({
      label: describeMergedPullRequest(event.pullRequest),
      url: event.pullRequest.url,
    });
  }
  return links;
}
