import {
  GitRepoAdapter,
  ListFilesResult,
  RepoFileEntry,
  TestConnectionResult,
} from "./GitRepoAdapter";

const MAX_FILES = 10000;

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /rate limit/i.test(err.message);
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
