import {
  ChangedFile,
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
} from "./GitRepoAdapter";
import {
  MAX_COMPARE_COMMITS,
  MAX_COMPARE_FILES,
  MAX_FILES_WITH_PATCH,
  MAX_PATCH_BYTES_PER_FILE,
  MAX_TOTAL_PATCH_BYTES,
} from "../diff/limits";

const MAX_BRANCHES = 500;
const BRANCH_PAGE_SIZE = 100;
const COMPARE_PAGE_SIZE = 100;
const DEFAULT_COMMITS_PER_PAGE = 30;
const MAX_COMMITS_PER_PAGE = 100;

interface PatchBudget {
  maxFilesWithPatch: number;
  maxPatchBytesPerFile: number;
  maxTotalPatchBytes: number;
  filesWithPatch: number;
  totalPatchBytes: number;
  truncated: boolean;
}

export class GitHubRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private owner: string;
  private repo: string;
  // Public GitHub by default; GitHub Enterprise Server installations override
  // this via settings.baseUrl (e.g. "https://ghes.example.com/api/v3").
  private baseUrl: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.owner = settings?.owner ?? "";
    this.repo = settings?.repo ?? "";
    this.baseUrl = (settings?.baseUrl || "https://api.github.com").replace(
      /\/$/,
      ""
    );
  }

  private get authHeaders() {
    return {
      Authorization: `token ${this.personalAccessToken}`,
      Accept: "application/vnd.github.v3+json",
    };
  }

  private get repoUrl() {
    return `${this.baseUrl}/repos/${this.owner}/${this.repo}`;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    // Step 1: Get branch SHA
    const branchData = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    const treeSha: string = branchData.commit.commit.tree.sha;

    // Step 2: Fetch recursive tree
    const treeData = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
      { headers: this.authHeaders }
    );

    if (treeData.truncated) {
      console.warn(
        `[GitHubRepoAdapter] Tree truncated for ${this.owner}/${this.repo} — results may be incomplete (>100k files or >7MB)`
      );
    }

    const files: RepoFileEntry[] = (treeData.tree ?? [])
      .filter((item: any) => item.type === "blob")
      .map((item: any) => ({
        path: item.path as string,
        size: (item.size as number) ?? 0,
        type: "file" as const,
      }));

    return { files, truncated: treeData.truncated === true };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  /** Single-request zip archive of the whole tree at `ref` (302s to codeload). */
  protected buildArchiveRequest(ref: string) {
    return {
      url: `${this.baseUrl}/repos/${this.owner}/${this.repo}/zipball/${encodeURIComponent(ref)}`,
      headers: this.authHeaders,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async listBranches(): Promise<RepoBranch[]> {
    const repoData = await this.makeRequest<any>(this.repoUrl, {
      headers: this.authHeaders,
    });
    const defaultBranch: string | undefined = repoData?.default_branch;

    const branches: RepoBranch[] = [];
    for (let page = 1; branches.length < MAX_BRANCHES; page++) {
      const pageData = await this.makeRequest<any>(
        `${this.repoUrl}/branches?per_page=${BRANCH_PAGE_SIZE}&page=${page}`,
        { headers: this.authHeaders }
      );
      const items: any[] = Array.isArray(pageData) ? pageData : [];
      for (const item of items) {
        if (branches.length >= MAX_BRANCHES) break;
        branches.push({
          name: item.name,
          sha: item.commit?.sha ?? "",
          isDefault: item.name === defaultBranch,
          protected: item.protected === true,
        });
      }
      if (items.length < BRANCH_PAGE_SIZE) break;
    }
    return branches;
  }

  async listCommits(
    ref: string,
    opts: ListCommitsOptions = {}
  ): Promise<ListCommitsResult> {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const perPage = Math.min(
      MAX_COMMITS_PER_PAGE,
      Math.max(1, Math.floor(opts.perPage ?? DEFAULT_COMMITS_PER_PAGE))
    );
    let url = `${this.repoUrl}/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}&page=${page}`;
    if (opts.path) {
      url += `&path=${encodeURIComponent(opts.path)}`;
    }
    const data = await this.makeRequest<any>(url, {
      headers: this.authHeaders,
    });
    const items: any[] = Array.isArray(data) ? data : [];
    const commits = items.map((item) => this.mapCommit(item));
    return { commits, hasMore: commits.length === perPage };
  }

  async compareCommits(
    baseSha: string,
    headSha: string,
    opts: CompareOptions = {}
  ): Promise<CompareResult> {
    const maxFiles = opts.maxFiles ?? MAX_COMPARE_FILES;
    const maxCommits = opts.maxCommits ?? MAX_COMPARE_COMMITS;
    const budget: PatchBudget = {
      maxFilesWithPatch: opts.maxFilesWithPatch ?? MAX_FILES_WITH_PATCH,
      maxPatchBytesPerFile:
        opts.maxPatchBytesPerFile ?? MAX_PATCH_BYTES_PER_FILE,
      maxTotalPatchBytes: opts.maxTotalPatchBytes ?? MAX_TOTAL_PATCH_BYTES,
      filesWithPatch: 0,
      totalPatchBytes: 0,
      truncated: false,
    };
    const compareUrl = `${this.repoUrl}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`;

    const files: ChangedFile[] = [];
    let commits: RepoCommit[] = [];
    let truncated = false;
    let aheadBy: number | undefined;
    let behindBy: number | undefined;
    let exhausted = false;

    for (let page = 1; !exhausted; page++) {
      const data = await this.makeRequest<any>(
        `${compareUrl}?per_page=${COMPARE_PAGE_SIZE}&page=${page}`,
        { headers: this.authHeaders }
      );

      if (page === 1) {
        aheadBy =
          typeof data?.ahead_by === "number" ? data.ahead_by : undefined;
        behindBy =
          typeof data?.behind_by === "number" ? data.behind_by : undefined;
        const rawCommits: any[] = Array.isArray(data?.commits)
          ? data.commits
          : [];
        commits = rawCommits
          .slice(0, maxCommits)
          .map((item) => this.mapCommit(item));
        const totalCommits =
          typeof data?.total_commits === "number"
            ? data.total_commits
            : rawCommits.length;
        if (totalCommits > commits.length) truncated = true;
      }

      const pageFiles: any[] = Array.isArray(data?.files) ? data.files : [];
      for (const raw of pageFiles) {
        if (files.length >= maxFiles) {
          truncated = true;
          exhausted = true;
          break;
        }
        files.push(this.mapChangedFile(raw, budget));
      }
      if (pageFiles.length < COMPARE_PAGE_SIZE) {
        exhausted = true;
      } else if (files.length >= maxFiles) {
        truncated = true;
        exhausted = true;
      }
    }

    if (budget.truncated) truncated = true;

    const result: CompareResult = {
      baseSha,
      headSha,
      files,
      commits,
      truncated,
    };
    if (!truncated) result.totalFiles = files.length;
    if (aheadBy !== undefined) result.aheadBy = aheadBy;
    if (behindBy !== undefined) result.behindBy = behindBy;
    return result;
  }

  private mapCommit(raw: any): RepoCommit {
    const sha: string = raw?.sha ?? "";
    const author = raw?.commit?.author ?? {};
    const parents: any[] = Array.isArray(raw?.parents) ? raw.parents : [];
    const commit: RepoCommit = {
      sha,
      shortSha: sha.slice(0, 7),
      message: raw?.commit?.message ?? "",
      authorName: author.name ?? raw?.author?.login ?? "",
      authoredAt: author.date ?? "",
      parents: parents.map((p) => p.sha).filter(Boolean),
    };
    if (author.email) commit.authorEmail = author.email;
    if (raw?.html_url) commit.url = raw.html_url;
    return commit;
  }

  private mapChangedFileStatus(status: string | undefined): ChangedFileStatus {
    switch (status) {
      case "removed":
        return "deleted";
      case "renamed":
        return "renamed";
      case "added":
      case "copied":
        return "added";
      default:
        return "modified";
    }
  }

  private mapChangedFile(raw: any, budget: PatchBudget): ChangedFile {
    const status = this.mapChangedFileStatus(raw?.status);
    const additions: number =
      typeof raw?.additions === "number" ? raw.additions : 0;
    const deletions: number =
      typeof raw?.deletions === "number" ? raw.deletions : 0;
    const file: ChangedFile = {
      path: raw?.filename ?? "",
      status,
      additions,
      deletions,
      isBinary: false,
    };
    if (status === "renamed" && raw?.previous_filename) {
      file.previousPath = raw.previous_filename;
    }

    const patch: string | undefined =
      typeof raw?.patch === "string" && raw.patch.length > 0
        ? raw.patch
        : undefined;

    if (patch === undefined) {
      if (additions + deletions === 0 && status !== "renamed") {
        file.isBinary = true;
      } else if (additions + deletions > 0) {
        file.patchTruncated = true;
        budget.truncated = true;
      }
      return file;
    }

    const bytes = Buffer.byteLength(patch);
    if (
      budget.filesWithPatch >= budget.maxFilesWithPatch ||
      bytes > budget.maxPatchBytesPerFile ||
      budget.totalPatchBytes + bytes > budget.maxTotalPatchBytes
    ) {
      file.patchTruncated = true;
      budget.truncated = true;
      return file;
    }

    file.patch = patch;
    budget.filesWithPatch++;
    budget.totalPatchBytes += bytes;
    return file;
  }
}
