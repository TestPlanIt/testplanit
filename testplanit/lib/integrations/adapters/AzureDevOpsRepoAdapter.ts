import { MAX_COMPARE_COMMITS, MAX_COMPARE_FILES } from "../diff/limits";
import type { LocalCompareChange } from "../diff/localDiff";
import {
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

export class AzureDevOpsRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private organizationUrl: string; // e.g. https://dev.azure.com/myorg
  private project: string;
  private repositoryId: string; // repo name or ID

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.organizationUrl = (settings?.organizationUrl ?? "").replace(/\/$/, "");
    if (this.organizationUrl) {
      this.organizationUrl = this.sanitizeUrl(this.organizationUrl);
    }
    this.project = settings?.project ?? "";
    this.repositoryId = settings?.repositoryId ?? "";
  }

  private get authHeaders() {
    const encoded = Buffer.from(`:${this.personalAccessToken}`).toString(
      "base64"
    );
    return { Authorization: `Basic ${encoded}` };
  }

  private get repoApiUrl() {
    return `${this.organizationUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repositoryId)}`;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.repoApiUrl}?api-version=7.0`,
      { headers: this.authHeaders }
    );
    // defaultBranch is like "refs/heads/main"
    return (data.defaultBranch as string)?.replace("refs/heads/", "") ?? "main";
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    const data = await this.makeRequest<any>(
      `${this.repoApiUrl}/items?recursionLevel=Full&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&api-version=7.0`,
      { headers: this.authHeaders }
    );

    const files: RepoFileEntry[] = (data.value ?? [])
      .filter((item: any) => item.gitObjectType === "blob")
      .map((item: any) => ({
        path: (item.path as string).replace(/^\//, ""), // Remove leading slash
        size: (item.size as number) ?? 0,
        type: "file" as const,
      }));

    return { files };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `${this.repoApiUrl}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&api-version=7.0`;
    return this.makeTextRequest(url, { headers: this.authHeaders });
  }

  async getFileContentAtCommit(path: string, sha: string): Promise<string> {
    const url = `${this.repoApiUrl}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(sha)}&versionDescriptor.versionType=commit&api-version=7.0`;
    return this.makeTextRequest(url, { headers: this.authHeaders });
  }

  async listBranches(): Promise<RepoBranch[]> {
    const defaultBranch = await this.getDefaultBranch();
    const data = await this.makeRequest<any>(
      `${this.repoApiUrl}/refs?filter=heads/&$top=500&api-version=7.0`,
      { headers: this.authHeaders }
    );

    return (data.value ?? []).map((ref: any) => {
      const name = (ref.name as string).replace(/^refs\/heads\//, "");
      return {
        name,
        sha: ref.objectId as string,
        isDefault: name === defaultBranch,
      };
    });
  }

  async listCommits(
    ref: string,
    opts: ListCommitsOptions = {}
  ): Promise<ListCommitsResult> {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 30));
    const versionType = this.isSha(ref) ? "commit" : "branch";
    let url = `${this.repoApiUrl}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(ref)}&searchCriteria.itemVersion.versionType=${versionType}&searchCriteria.$top=${perPage}&searchCriteria.$skip=${(page - 1) * perPage}`;
    if (opts.path) {
      url += `&searchCriteria.itemPath=${encodeURIComponent(`/${opts.path.replace(/^\//, "")}`)}`;
    }
    url += "&api-version=7.0";

    const data = await this.makeRequest<any>(url, {
      headers: this.authHeaders,
    });
    const commits = (data.value ?? []).map((c: any) => this.mapCommit(c));
    return { commits, hasMore: commits.length === perPage };
  }

  async compareCommits(
    baseSha: string,
    headSha: string,
    opts: CompareOptions = {}
  ): Promise<CompareResult> {
    const maxFiles = opts.maxFiles ?? MAX_COMPARE_FILES;
    const maxCommits = Math.min(
      opts.maxCommits ?? MAX_COMPARE_COMMITS,
      MAX_COMPARE_COMMITS
    );
    const changes: LocalCompareChange[] = [];
    let truncated = false;
    let skip = 0;

    while (true) {
      const data = await this.makeRequest<any>(
        `${this.repoApiUrl}/diffs/commits?baseVersion=${encodeURIComponent(baseSha)}&baseVersionType=commit&targetVersion=${encodeURIComponent(headSha)}&targetVersionType=commit&$top=${MAX_COMPARE_FILES}&$skip=${skip}&api-version=7.0`,
        { headers: this.authHeaders }
      );
      const page: any[] = data.changes ?? [];
      for (const change of page) {
        if (change.item?.isFolder || change.item?.gitObjectType === "tree") {
          continue;
        }
        if (changes.length >= maxFiles) {
          truncated = true;
          break;
        }
        changes.push(this.mapChange(change));
      }
      if (truncated || data.allChangesIncluded !== false || page.length === 0) {
        break;
      }
      skip += page.length;
    }

    const local = await this.computeLocalCompare(
      baseSha,
      headSha,
      changes,
      opts
    );

    const commitData = await this.makeRequest<any>(
      `${this.repoApiUrl}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(headSha)}&searchCriteria.itemVersion.versionType=commit&searchCriteria.compareVersion.version=${encodeURIComponent(baseSha)}&searchCriteria.compareVersion.versionType=commit&searchCriteria.$top=${maxCommits}&api-version=7.0`,
      { headers: this.authHeaders }
    );
    const commits: RepoCommit[] = (commitData.value ?? []).map((c: any) =>
      this.mapCommit(c)
    );
    const commitsTruncated = commits.length >= maxCommits;

    return {
      baseSha,
      headSha,
      files: local.files,
      commits,
      truncated: truncated || local.truncated || commitsTruncated,
      totalFiles: truncated ? undefined : changes.length,
      aheadBy: commitsTruncated ? undefined : commits.length,
    };
  }

  private mapCommit(c: any): RepoCommit {
    const sha = c.commitId as string;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: (c.comment as string) ?? "",
      authorName: c.author?.name ?? "",
      authorEmail: c.author?.email || undefined,
      authoredAt: c.author?.date ?? "",
      parents: (c.parents as string[]) ?? [],
      url: c.remoteUrl,
    };
  }

  private mapChange(change: any): LocalCompareChange {
    const path = (change.item.path as string).replace(/^\//, "");
    const changeType = String(change.changeType ?? "").toLowerCase();
    if (changeType.includes("rename")) {
      return {
        path,
        previousPath: (change.sourceServerItem as string | undefined)?.replace(
          /^\//,
          ""
        ),
        status: "renamed",
      };
    }
    if (changeType === "add") return { path, status: "added" };
    if (changeType === "delete") return { path, status: "deleted" };
    return { path, status: "modified" };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      // Test with repository API (Code Read scope required — validates correct PAT scope)
      await this.makeRequest<any>(`${this.repoApiUrl}?api-version=7.0`, {
        headers: this.authHeaders,
      });
      const defaultBranch = await this.getDefaultBranch();
      return { success: true, defaultBranch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
