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
import {
  MultiFileDiffChunk,
  parseUnifiedDiff,
  splitMultiFileDiff,
  stripDiffHeaders,
} from "../diff/parseUnifiedDiff";

const MAX_FILES = 10000;
const MAX_BRANCHES = 500;

const DIFFSTAT_STATUS: Record<string, ChangedFileStatus> = {
  added: "added",
  modified: "modified",
  removed: "deleted",
  renamed: "renamed",
};

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /rate limit/i.test(err.message);
}

function parseRawAuthor(raw: string | undefined): {
  name: string;
  email?: string;
} {
  const match = /^(.*?)\s*<([^>]*)>\s*$/.exec(raw ?? "");
  if (!match) return { name: (raw ?? "").trim() };
  return { name: match[1].trim(), email: match[2].trim() || undefined };
}

export class BitbucketRepoAdapter extends GitRepoAdapter {
  private email: string;
  private apiToken: string;
  private workspace: string;
  private repoSlug: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    // Support both new (email/apiToken) and legacy (username/appPassword) credentials
    this.email = credentials.email ?? credentials.username;
    this.apiToken = credentials.apiToken ?? credentials.appPassword;
    this.workspace = settings?.workspace ?? "";
    this.repoSlug = settings?.repoSlug ?? "";
  }

  private get authHeaders() {
    const encoded = Buffer.from(`${this.email}:${this.apiToken}`).toString(
      "base64"
    );
    return { Authorization: `Basic ${encoded}` };
  }

  private get repoUrl() {
    return `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}`;
  }

  private async fetchPages<T>(
    url: string,
    limit: number
  ): Promise<{ values: T[]; hasMore: boolean; size?: number }> {
    const values: T[] = [];
    let size: number | undefined;
    let next: string | null = url;
    while (next && values.length < limit) {
      const data: any = await this.makeRequest<any>(next, {
        headers: this.authHeaders,
      });
      if (size === undefined && typeof data.size === "number") size = data.size;
      for (const value of data.values ?? []) values.push(value as T);
      next = data.next ?? null;
    }
    return {
      values: values.slice(0, limit),
      hasMore: values.length > limit || Boolean(next),
      size,
    };
  }

  private toCommit(c: any): RepoCommit {
    const sha = c.hash as string;
    const raw = parseRawAuthor(c.author?.raw);
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: (c.message as string) ?? "",
      authorName: c.author?.user?.display_name ?? raw.name,
      authorEmail: raw.email,
      authoredAt: (c.date as string) ?? "",
      parents: ((c.parents ?? []) as any[]).map((p) => p.hash as string),
      url: c.links?.html?.href,
    };
  }

  async listBranches(): Promise<RepoBranch[]> {
    const defaultBranch = await this.getDefaultBranch();
    const { values } = await this.fetchPages<any>(
      `${this.repoUrl}/refs/branches?pagelen=100`,
      MAX_BRANCHES
    );
    return values.map((b) => ({
      name: b.name as string,
      sha: b.target?.hash as string,
      isDefault: b.name === defaultBranch,
    }));
  }

  async listCommits(
    ref: string,
    opts: ListCommitsOptions = {}
  ): Promise<ListCommitsResult> {
    const params = new URLSearchParams({
      pagelen: String(Math.min(100, Math.max(1, opts.perPage ?? 30))),
      page: String(Math.max(1, opts.page ?? 1)),
    });
    if (opts.path) params.set("path", opts.path);
    const data = await this.makeRequest<any>(
      `${this.repoUrl}/commits/${encodeURIComponent(ref)}?${params}`,
      { headers: this.authHeaders }
    );
    return {
      commits: ((data.values ?? []) as any[]).map((c) => this.toCommit(c)),
      hasMore: Boolean(data.next),
    };
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
    const spec = `${encodeURIComponent(headSha)}..${encodeURIComponent(baseSha)}`;

    const diffstat = await this.fetchPages<any>(
      `${this.repoUrl}/diffstat/${spec}?pagelen=500`,
      maxFiles
    );
    let truncated = diffstat.hasMore;

    const raw = await this.makeTextRequest(`${this.repoUrl}/diff/${spec}`, {
      headers: this.authHeaders,
    });
    const chunks = new Map<string, MultiFileDiffChunk>();
    for (const chunk of splitMultiFileDiff(raw)) {
      const key = chunk.newPath ?? chunk.oldPath;
      if (key !== undefined) chunks.set(key, chunk);
    }

    const files: ChangedFile[] = [];
    let filesWithPatch = 0;
    let totalPatchBytes = 0;
    for (const row of diffstat.values) {
      const path: string | undefined = row.new?.path ?? row.old?.path;
      if (!path) continue;
      const status = DIFFSTAT_STATUS[row.status] ?? "modified";
      const chunk = chunks.get(path);
      const parsed = chunk ? parseUnifiedDiff(chunk.body) : undefined;
      const additions = (row.lines_added as number) ?? parsed?.additions ?? 0;
      const deletions = (row.lines_removed as number) ?? parsed?.deletions ?? 0;
      const isBinary = parsed
        ? parsed.isBinary
        : additions === 0 && deletions === 0;

      const file: ChangedFile = {
        path,
        status,
        additions,
        deletions,
        isBinary,
      };
      if (status === "renamed" && row.old?.path) {
        file.previousPath = row.old.path;
      }

      const body = chunk && !isBinary ? stripDiffHeaders(chunk.body) : "";
      if (body) {
        const bytes = Buffer.byteLength(body);
        if (
          filesWithPatch >= maxFilesWithPatch ||
          bytes > maxPatchBytesPerFile ||
          totalPatchBytes + bytes > maxTotalPatchBytes
        ) {
          file.patchTruncated = true;
          truncated = true;
        } else {
          file.patch = body;
          filesWithPatch++;
          totalPatchBytes += bytes;
        }
      }
      files.push(file);
    }

    const commits = await this.fetchPages<any>(
      `${this.repoUrl}/commits/${encodeURIComponent(headSha)}?exclude=${encodeURIComponent(baseSha)}&pagelen=100`,
      maxCommits
    );
    if (commits.hasMore) truncated = true;

    return {
      baseSha,
      headSha,
      files,
      commits: commits.values.map((c) => this.toCommit(c)),
      truncated,
      totalFiles:
        diffstat.size ?? (diffstat.hasMore ? undefined : files.length),
    };
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}`,
      { headers: this.authHeaders }
    );
    return data.mainbranch?.name ?? "main";
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    return this.listFilesInPaths(branch, [""]);
  }

  /**
   * Path-scoped listing: only fetches files under the given base paths,
   * avoiding a full-repo scan when the user specifies path patterns.
   */
  async listFilesInPaths(
    branch: string,
    basePaths: string[],
    onProgress?: (filesFound: number) => void,
    maxDepthByPath?: Record<string, number>
  ): Promise<ListFilesResult> {
    const files: RepoFileEntry[] = [];
    const seen = new Set<string>();
    const MAX_DEPTH = 10;
    // Deduplicate and normalise paths; empty string = repo root. Each seed
    // carries the depth its glob needs, so a non-recursive root pattern
    // (e.g. "." + "*.md") scans only the top level instead of the whole repo.
    const seeds = basePaths.length > 0 ? basePaths : [""];
    const queue: { path: string; depth: number }[] = seeds.map((p) => ({
      path: p,
      depth: maxDepthByPath?.[p] ?? MAX_DEPTH,
    }));

    try {
      while (queue.length > 0 && files.length < MAX_FILES) {
        const { path: rawPath, depth } = queue.shift()!;
        // Treat ".", "./" and "" all as repository root. Bitbucket resolves a
        // literal "." path segment to a FILE and returns its raw body instead
        // of a JSON directory listing, which would blow up JSON parsing.
        const path =
          rawPath === "." || rawPath === "./" || rawPath === "/" ? "" : rawPath;
        let url: string | null =
          `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}/src/${encodeURIComponent(branch)}/${path}?pagelen=100&max_depth=${depth}`;

        while (url && files.length < MAX_FILES) {
          const data: any = await this.makeRequest<any>(url, {
            headers: this.authHeaders,
          });
          for (const item of data.values ?? []) {
            if (item.type === "commit_file") {
              const filePath = item.path as string;
              if (!seen.has(filePath)) {
                seen.add(filePath);
                files.push({
                  path: filePath,
                  size: (item.size as number) ?? 0,
                  type: "file",
                });
              }
            } else if (item.type === "commit_directory") {
              // A directory still surfacing means it's deeper than max_depth.
              // Only follow it for recursive globs (depth at the deep cap);
              // a shallow/bounded glob doesn't want anything deeper.
              if (depth >= MAX_DEPTH) {
                queue.push({ path: item.path as string, depth: MAX_DEPTH });
              }
            }
          }
          url = data.next ?? null; // Bitbucket provides full next URL
          onProgress?.(files.length);
        }
      }
    } catch (err) {
      // A large repo can exhaust the provider rate limit mid-listing. Rather
      // than discard a long-running scan, return what we collected so far and
      // flag it truncated — same graceful-partial behavior the content fetcher
      // uses. With nothing collected yet, surface the error so the caller can
      // report it (and we don't cache an empty "complete" listing).
      if (files.length > 0 && isRateLimitError(err)) {
        return { files: files.slice(0, MAX_FILES), truncated: true };
      }
      throw err;
    }

    return { files: files.slice(0, MAX_FILES) };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}/src/${encodeURIComponent(branch)}/${path}`;
    return this.makeTextRequest(url, { headers: this.authHeaders });
  }

  /** Single-request zip archive of the whole tree at `ref`. */
  protected buildArchiveRequest(ref: string) {
    return {
      url: `https://bitbucket.org/${this.workspace}/${this.repoSlug}/get/${encodeURIComponent(ref)}.zip`,
      headers: this.authHeaders,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.mainbranch?.name };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
