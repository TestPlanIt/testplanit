import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  issueFormAttachmentPrefix,
  takesIssueAttachments,
} from "./issueAttachmentProviders";

const ADAPTER_FILES: Record<string, string> = {
  JIRA: "JiraAdapter.ts",
  GITHUB: "GitHubAdapter.ts",
  AZURE_DEVOPS: "AzureDevOpsAdapter.ts",
  SIMPLE_URL: "SimpleUrlAdapter.ts",
  GITLAB: "GitLabAdapter.ts",
  GITEA: "GiteaAdapter.ts",
  REDMINE: "RedmineAdapter.ts",
  MANTISBT: "MantisBTAdapter.ts",
  CLICKUP: "ClickUpAdapter.ts",
};

describe("issueAttachmentProviders", () => {
  it.each(Object.entries(ADAPTER_FILES))(
    "%s matches what its adapter can do",
    (provider, file) => {
      const source = readFileSync(
        path.join(__dirname, "adapters", file),
        "utf8"
      );
      const adapterTakesFiles =
        /^\s+attachments: true,/m.test(source) &&
        /^\s+async uploadAttachment\(/m.test(source);
      expect(takesIssueAttachments(provider)).toBe(adapterTakesFiles);
    }
  );

  it("does not offer attachments without a tracker", () => {
    expect(takesIssueAttachments(null)).toBe(false);
    expect(takesIssueAttachments("")).toBe(false);
  });

  it("scopes uploads to the project and the user", () => {
    expect(issueFormAttachmentPrefix(12, "user-1")).toBe(
      "issue-form/12/user-1"
    );
  });
});
