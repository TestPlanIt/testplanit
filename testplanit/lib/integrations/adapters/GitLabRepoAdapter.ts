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
import { parseUnifiedDiff, stripDiffHeaders } from "../diff/parseUnifiedDiff";

const MAX_FILES = 10000; // Cap to prevent runaway pagination
const MAX_BRANCHES = 500;
const BRANCH_PAGE_SIZE = 100;

function diffStatus(diff: any): ChangedFileStatus {
  if (diff.new_file) return "added";
  if (diff.deleted_file) return "deleted";
  if (diff.renamed_file) return "renamed";
  return "modified";
}

export class GitLabRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private projectPath: string; // numeric ID or "namespace/project"
  private baseUrl: string; // defaults to https://gitlab.com

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.projectPath = settings?.projectPath ?? "";
    this.baseUrl = (settings?.baseUrl || "https://gitlab.com").replace(
      /\/$/,
      ""
    );
    this.baseUrl = this.sanitizeUrl(this.baseUrl);
  }

  private get authHeaders() {
    return { "PRIVATE-TOKEN": this.personalAccessToken };
  }

  private get encodedProjectPath() {
    // GitLab accepts numeric ID directly; otherwise URL-encode the path
    return /^\d+$/.test(this.projectPath)
      ? this.projectPath
      : encodeURIComponent(this.projectPath);
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    const files: RepoFileEntry[] = [];
    let page = 1;

    while (files.length < MAX_FILES) {
      const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(branch)}&page=${page}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );

      let response: Response;
      try {
        const safeUrl = this.sanitizeUrl(url);
        await this.applyRateLimit();
        response = await fetch(safeUrl, {
          headers: this.authHeaders,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `GitLab HTTP ${response.status}: ${text.slice(0, 200)}`
        );
      }

      const items: any[] = await response.json();
      const fileItems = items
        .filter((item) => item.type === "blob")
        .map((item) => ({
          path: item.path as string,
          size: 0, // GitLab recursive tree does not return file sizes
          type: "file" as const,
        }));
      files.push(...fileItems);

      const nextPage = response.headers.get("X-Next-Page");
      if (!nextPage) break;
      page = parseInt(nextPage, 10);
    }

    return { files: files.slice(0, MAX_FILES) };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
    return this.makeTextRequest(url, { headers: this.authHeaders });
  }

  async listBranches(): Promise<RepoBranch[]> {
    const branches: RepoBranch[] = [];
    let page = 1;

    while (branches.length < MAX_BRANCHES) {
      const items = await this.makeRequest<any[]>(
        `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/branches?per_page=${BRANCH_PAGE_SIZE}&page=${page}`,
        { headers: this.authHeaders }
      );
      for (const item of items) {
        branches.push({
          name: item.name,
          sha: item.commit?.id,
          isDefault: item.default === true,
          protected: item.protected === true,
        });
      }
      if (items.length < BRANCH_PAGE_SIZE) break;
      page++;
    }

    return branches.slice(0, MAX_BRANCHES);
  }

  async listCommits(
    ref: string,
    opts: ListCommitsOptions = {}
  ): Promise<ListCommitsResult> {
    const page = opts.page ?? 1;
    const perPage = Math.min(opts.perPage ?? 30, 100);
    let url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=${perPage}&page=${page}`;
    if (opts.path) url += `&path=${encodeURIComponent(opts.path)}`;

    const items = await this.makeRequest<any[]>(url, {
      headers: this.authHeaders,
    });
    const commits = items.map((item) => this.toRepoCommit(item));
    return { commits, hasMore: commits.length === perPage };
  }

  async compareCommits(
    baseSha: string,
    headSha: string,
    opts: CompareOptions = {}
  ): Promise<CompareResult> {
    const maxFiles = opts.maxFiles ?? MAX_COMPARE_FILES;
    const maxFilesWithPatch = opts.maxFilesWithPatch ?? MAX_FILES_WITH_PATCH;
    const maxPatchBytesPerFile =
      opts.maxPatchBytesPerFile ?? MAX_PATCH_BYTES_PER_FILE;
    const maxTotalPatchBytes = opts.maxTotalPatchBytes ?? MAX_TOTAL_PATCH_BYTES;
    const maxCommits = opts.maxCommits ?? MAX_COMPARE_COMMITS;

    const data = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/compare?from=${encodeURIComponent(baseSha)}&to=${encodeURIComponent(headSha)}&straight=true`,
      { headers: this.authHeaders }
    );
    const diffs: any[] = data.diffs ?? [];
    const rawCommits: any[] = data.commits ?? [];

    let truncated =
      data.compare_timeout === true ||
      diffs.length > maxFiles ||
      rawCommits.length > maxCommits;
    let filesWithPatch = 0;
    let totalPatchBytes = 0;
    const files: ChangedFile[] = [];

    for (const diff of diffs.slice(0, maxFiles)) {
      const status = diffStatus(diff);
      const entry: ChangedFile = {
        path: diff.new_path ?? diff.old_path,
        status,
        additions: 0,
        deletions: 0,
        isBinary: false,
      };
      if (status === "renamed") entry.previousPath = diff.old_path;

      if (diff.too_large || diff.collapsed) {
        entry.patchTruncated = true;
        truncated = true;
        files.push(entry);
        continue;
      }

      const raw: string = diff.diff ?? "";
      const parsed = parseUnifiedDiff(raw);
      entry.additions = parsed.additions;
      entry.deletions = parsed.deletions;
      entry.isBinary = parsed.isBinary || (raw === "" && status !== "renamed");
      if (entry.isBinary) {
        files.push(entry);
        continue;
      }

      const body = stripDiffHeaders(raw);
      if (body.length === 0) {
        files.push(entry);
        continue;
      }
      const bytes = Buffer.byteLength(body);
      if (
        filesWithPatch >= maxFilesWithPatch ||
        bytes > maxPatchBytesPerFile ||
        totalPatchBytes + bytes > maxTotalPatchBytes
      ) {
        entry.patchTruncated = true;
        truncated = true;
      } else {
        entry.patch = body;
        filesWithPatch++;
        totalPatchBytes += bytes;
      }
      files.push(entry);
    }

    const commits = rawCommits
      .slice(0, maxCommits)
      .map((commit) => this.toRepoCommit(commit));

    return {
      baseSha,
      headSha,
      files,
      commits,
      truncated,
      totalFiles: diffs.length,
    };
  }

  private toRepoCommit(commit: any): RepoCommit {
    const sha: string = commit.id;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: commit.message,
      authorName: commit.author_name,
      authorEmail: commit.author_email ?? undefined,
      authoredAt: commit.authored_date ?? commit.created_at,
      parents: commit.parent_ids ?? [],
      url: commit.web_url ?? undefined,
    };
  }

  /** Single-request zip archive of the whole tree at `ref`. */
  protected buildArchiveRequest(ref: string) {
    return {
      url: `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/archive.zip?sha=${encodeURIComponent(ref)}`,
      headers: this.authHeaders,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
