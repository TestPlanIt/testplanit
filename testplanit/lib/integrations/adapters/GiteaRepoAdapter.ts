/**
 * Git repository adapter for Gitea, Forgejo, and Gogs.
 * All three platforms expose a compatible /api/v1/ REST API.
 */
import { MAX_COMPARE_COMMITS, MAX_COMPARE_FILES } from "../diff/limits";
import type { LocalCompareChange } from "../diff/localDiff";
import {
  ChangedFileStatus,
  CompareOptions,
  CompareResult,
  GitRepoAdapter,
  ListCommitsOptions,
  ListCommitsResult,
  ListFilesResult,
  RepoBranch,
  RepoCommit,
  RepoFileEntry,
  TestConnectionResult,
  type ListPullRequestsOptions,
  type ListPullRequestsResult,
  type PullRequestState,
  type RepoPullRequest,
} from "./GitRepoAdapter";

const MAX_FILES = 10000;
const MAX_BRANCHES = 500;
const BRANCH_PAGE_SIZE = 50;
const DEFAULT_COMMITS_PER_PAGE = 30;
const MAX_COMMITS_PER_PAGE = 100;

const FILE_STATUS: Record<string, ChangedFileStatus> = {
  added: "added",
  modified: "modified",
  removed: "deleted",
  renamed: "renamed",
  changed: "modified",
  copied: "added",
};

interface FoldedFile {
  /** Path at the base commit; null when the file did not exist there. */
  basePath: string | null;
  atHead: boolean;
}

export class GiteaRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private owner: string;
  private repo: string;
  private baseUrl: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.owner = settings?.owner ?? "";
    this.repo = settings?.repo ?? "";
    this.baseUrl = (settings?.baseUrl ?? "").replace(/\/$/, "");
    this.baseUrl = this.sanitizeUrl(this.baseUrl);
  }

  private get authHeaders() {
    return {
      Authorization: `token ${this.personalAccessToken}`,
      Accept: "application/json",
    };
  }

  private get repoUrl() {
    return `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    // Step 1: Resolve branch to tree SHA
    const branchData = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    const treeSha: string =
      branchData.commit?.commit?.tree?.sha ??
      branchData.commit?.id ??
      branchData.commit?.sha;

    if (!treeSha) {
      throw new Error("Could not resolve branch to a tree SHA");
    }

    // Step 2: Fetch recursive tree (paginated)
    const files: RepoFileEntry[] = [];
    let page = 1;
    let truncated = false;

    while (files.length < MAX_FILES) {
      const treeData = await this.makeRequest<any>(
        `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${treeSha}?recursive=true&per_page=100&page=${page}`,
        { headers: this.authHeaders }
      );

      if (treeData.truncated) {
        truncated = true;
      }

      const entries: any[] = treeData.tree ?? [];
      if (entries.length === 0) break;

      const fileEntries = entries
        .filter((item: any) => item.type === "blob")
        .map((item: any) => ({
          path: item.path as string,
          size: (item.size as number) ?? 0,
          type: "file" as const,
        }));
      files.push(...fileEntries);

      // Gitea returns total_count when paginated; stop when we've got all pages
      const totalCount = treeData.total_count;
      if (totalCount !== undefined && files.length >= totalCount) break;

      // If this page returned fewer than requested, we're done
      if (entries.length < 100) break;

      page++;
    }

    return { files: files.slice(0, MAX_FILES), truncated };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    // Gitea raw endpoint returns file content directly as text
    return this.makeTextRequest(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/raw/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
  }

  async listBranches(): Promise<RepoBranch[]> {
    const defaultBranch = await this.getDefaultBranch();
    const branches: RepoBranch[] = [];
    let page = 1;

    while (branches.length < MAX_BRANCHES) {
      const data = await this.makeRequest<any[]>(
        `${this.repoUrl}/branches?page=${page}&limit=${BRANCH_PAGE_SIZE}`,
        { headers: this.authHeaders }
      );
      const entries = data ?? [];
      for (const b of entries) {
        branches.push({
          name: b.name,
          sha: b.commit?.id ?? "",
          isDefault: b.name === defaultBranch,
          protected: b.protected === true,
        });
      }
      if (entries.length < BRANCH_PAGE_SIZE) break;
      page++;
    }

    return branches.slice(0, MAX_BRANCHES);
  }

  async listCommits(
    ref: string,
    opts: ListCommitsOptions = {}
  ): Promise<ListCommitsResult> {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(
      Math.max(1, opts.perPage ?? DEFAULT_COMMITS_PER_PAGE),
      MAX_COMMITS_PER_PAGE
    );
    const params = new URLSearchParams({
      sha: ref,
      page: String(page),
      limit: String(perPage),
      stat: "false",
      verification: "false",
      files: "false",
    });
    if (opts.path) params.set("path", opts.path);

    const data = await this.makeRequest<any[]>(
      `${this.repoUrl}/commits?${params}`,
      { headers: this.authHeaders }
    );
    const commits = (data ?? []).map((c) => this.toRepoCommit(c));
    return { commits, hasMore: commits.length === perPage };
  }

  async getMergeBase(baseRef: string, headRef: string): Promise<string | null> {
    // Gitea mirrors GitHub's compare payload where it supports the endpoint.
    try {
      const data = await this.makeRequest<any>(
        `${this.repoUrl}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`,
        { headers: this.authHeaders }
      );
      return data?.merge_base_commit?.sha ?? null;
    } catch {
      return null;
    }
  }

  async listPullRequests(
    opts: ListPullRequestsOptions = {}
  ): Promise<ListPullRequestsResult> {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const perPage = Math.min(50, Math.max(1, Math.floor(opts.perPage ?? 50)));
    // Gitea mirrors GitHub here, including folding merged into closed.
    const apiState = opts.state === "open" ? "open" : "all";
    const url =
      `${this.repoUrl}/pulls?state=${apiState}` +
      `&sort=recentupdate&limit=${perPage}&page=${page}`;
    const data = await this.makeRequest<any>(url, {
      headers: this.authHeaders,
    });
    const items: any[] = Array.isArray(data) ? data : [];
    const pullRequests = items.map((item): RepoPullRequest => {
      const state: PullRequestState = item?.merged
        ? "merged"
        : item?.state === "closed"
          ? "closed"
          : "open";
      return {
        number: Number(item?.number) || 0,
        title: String(item?.title ?? ""),
        state,
        authorName: item?.user?.login ?? undefined,
        sourceBranch: String(item?.head?.ref ?? ""),
        targetBranch: String(item?.base?.ref ?? ""),
        headSha: item?.head?.sha ?? undefined,
        baseSha: item?.base?.sha ?? undefined,
        url: item?.html_url ?? undefined,
        updatedAt: item?.updated_at ?? undefined,
      };
    });
    const narrowed =
      opts.state && opts.state !== "all"
        ? pullRequests.filter((pr) => pr.state === opts.state)
        : pullRequests;
    return { pullRequests: narrowed, hasMore: items.length === perPage };
  }

  async compareCommits(
    baseSha: string,
    headSha: string,
    opts: CompareOptions = {}
  ): Promise<CompareResult> {
    let compare: any;
    try {
      compare = await this.makeRequest<any>(
        `${this.repoUrl}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
        { headers: this.authHeaders }
      );
    } catch (err: any) {
      if (/^HTTP 404\b/.test(err?.message ?? "")) {
        throw new Error(
          "Commit compare is not supported by this Gitea/Gogs server"
        );
      }
      throw err;
    }

    const maxCommits = Math.min(
      opts.maxCommits ?? MAX_COMPARE_COMMITS,
      MAX_COMPARE_COMMITS
    );
    const maxFiles = Math.min(
      opts.maxFiles ?? MAX_COMPARE_FILES,
      MAX_COMPARE_FILES
    );

    const all = this.oldestFirst(compare?.commits ?? [], headSha);
    const totalCommits: number = compare?.total_commits ?? all.length;
    const walked = all.slice(0, maxCommits);
    let truncated = all.length > walked.length || totalCommits > walked.length;

    const folded = new Map<string, FoldedFile>();
    for (const commit of walked) {
      const files: any[] = Array.isArray(commit.files)
        ? commit.files
        : await this.getCommitFiles(commit.sha);
      for (const file of files) this.foldFile(folded, file);
    }

    const changes = this.netChanges(folded);
    if (changes.length > maxFiles) truncated = true;

    const local = await this.computeLocalCompare(
      baseSha,
      headSha,
      changes.slice(0, maxFiles),
      opts
    );

    return {
      baseSha,
      headSha,
      files: local.files,
      commits: walked.map((c) => this.toRepoCommit(c)).reverse(),
      truncated: truncated || local.truncated,
      totalFiles: changes.length,
      aheadBy: totalCommits,
    };
  }

  private async getCommitFiles(sha: string): Promise<any[]> {
    const data = await this.makeRequest<any>(
      `${this.repoUrl}/git/commits/${encodeURIComponent(sha)}?stat=true&files=true&verification=false`,
      { headers: this.authHeaders }
    );
    return data?.files ?? [];
  }

  /** Gitea lists compare commits newest first (`git log base...head`). */
  private oldestFirst(commits: any[], headSha: string): any[] {
    if (commits.length < 2) return commits;
    const isHead = (c: any) =>
      this.isSha(headSha) &&
      typeof c.sha === "string" &&
      c.sha.toLowerCase().startsWith(headSha.toLowerCase());
    const hasParent = (child: any, parent: any) =>
      (child.parents ?? []).some((p: any) => p.sha === parent.sha);

    const first = commits[0];
    const last = commits[commits.length - 1];
    if (isHead(first)) return [...commits].reverse();
    if (isHead(last)) return commits;
    if (hasParent(first, commits[1])) return [...commits].reverse();
    if (hasParent(last, commits[commits.length - 2])) return commits;
    return [...commits].reverse();
  }

  private foldFile(folded: Map<string, FoldedFile>, file: any): void {
    const path: string | undefined = file?.filename;
    if (!path) return;
    const status = FILE_STATUS[file.status] ?? "modified";
    const previous: string | undefined = file.previous_filename || undefined;
    const existing = folded.get(path);

    if (status === "renamed" && previous && previous !== path) {
      const moved = folded.get(previous);
      folded.delete(previous);
      folded.set(path, {
        basePath: moved ? moved.basePath : previous,
        atHead: true,
      });
      return;
    }
    if (status === "added") {
      folded.set(path, {
        basePath: existing ? existing.basePath : null,
        atHead: true,
      });
      return;
    }
    folded.set(path, {
      basePath: existing ? existing.basePath : path,
      atHead: status !== "deleted",
    });
  }

  private netChanges(folded: Map<string, FoldedFile>): LocalCompareChange[] {
    const changes: LocalCompareChange[] = [];
    for (const [path, { basePath, atHead }] of folded) {
      if (!atHead) {
        if (basePath !== null)
          changes.push({ path: basePath, status: "deleted" });
      } else if (basePath === null) {
        changes.push({ path, status: "added" });
      } else if (basePath === path) {
        changes.push({ path, status: "modified" });
      } else {
        changes.push({ path, previousPath: basePath, status: "renamed" });
      }
    }
    return changes;
  }

  private toRepoCommit(c: any): RepoCommit {
    const sha: string = c.sha ?? "";
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: c.commit?.message ?? "",
      authorName: c.commit?.author?.name ?? c.author?.login ?? "",
      authorEmail: c.commit?.author?.email || undefined,
      authoredAt: c.commit?.author?.date ?? c.created ?? "",
      parents: (c.parents ?? []).map((p: any) => p.sha as string),
      url: c.html_url ?? undefined,
    };
  }

  /** Single-request zip archive of the whole tree at `ref`. */
  protected buildArchiveRequest(ref: string) {
    return {
      url: `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/archive/${encodeURIComponent(ref)}.zip`,
      headers: this.authHeaders,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
