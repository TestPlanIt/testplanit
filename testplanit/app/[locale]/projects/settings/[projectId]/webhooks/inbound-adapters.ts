import type { AdapterType } from "~/zenstack/models";

/** Inbound adapters an issue integration can map to. */
export type IssueInboundAdapterType =
  | "JIRA"
  | "GITHUB"
  | "AZURE_DEVOPS"
  | "GITLAB"
  | "GITEA"
  | "REDMINE"
  | "MANTISBT";

const ISSUE_ADAPTERS: Record<string, IssueInboundAdapterType> = {
  JIRA: "JIRA",
  GITHUB: "GITHUB",
  AZURE_DEVOPS: "AZURE_DEVOPS",
  GITLAB: "GITLAB",
  GITEA: "GITEA",
  REDMINE: "REDMINE",
  MANTISBT: "MANTISBT",
};

/**
 * The inbound adapter that verifies an issue integration provider's
 * webhooks; null for providers with no webhook surface (Simple URL).
 */
export function inboundAdapterForProvider(
  provider: string | null | undefined
): IssueInboundAdapterType | null {
  return provider ? (ISSUE_ADAPTERS[provider] ?? null) : null;
}

export type IssueAdapterSlug =
  "jira" | "github" | "ado" | "gitlab" | "gitea" | "redmine" | "mantisbt";

const SLUGS: Record<IssueInboundAdapterType, IssueAdapterSlug> = {
  JIRA: "jira",
  GITHUB: "github",
  AZURE_DEVOPS: "ado",
  GITLAB: "gitlab",
  GITEA: "gitea",
  REDMINE: "redmine",
  MANTISBT: "mantisbt",
};

export function adapterSlug(adapterType: IssueInboundAdapterType) {
  return SLUGS[adapterType];
}

/** Short adapter name, shared with the deliveries tab. */
export function adapterLabelKey(adapterType: string): string | null {
  switch (adapterType) {
    case "JIRA":
      return "inboundChooserJira";
    case "GITHUB":
      return "inboundChooserGithub";
    case "AZURE_DEVOPS":
      return "inboundChooserAdo";
    case "GITLAB":
      return "inboundChooserGitlab";
    case "GITEA":
      return "inboundChooserGitea";
    case "REDMINE":
      return "inboundChooserRedmine";
    case "MANTISBT":
      return "inboundChooserMantisbt";
    case "BITBUCKET":
      return "inboundChooserBitbucket";
    case "SLACK":
      return "adapterLabelSlack";
    case "GENERIC_HMAC":
      return "adapterLabelGenericHmac";
    default:
      return null;
  }
}

const TITLE_KEYS: Record<IssueInboundAdapterType, string> = {
  JIRA: "inboundJiraTitle",
  GITHUB: "inboundGithubTitle",
  AZURE_DEVOPS: "inboundAdoTitle",
  GITLAB: "inboundGitlabTitle",
  GITEA: "inboundGiteaTitle",
  REDMINE: "inboundRedmineTitle",
  MANTISBT: "inboundMantisbtTitle",
};

export function adapterTitleKey(adapterType: IssueInboundAdapterType) {
  return TITLE_KEYS[adapterType];
}

/** Scope hints; the `rich` ones carry a <code> tag. */
export const ISSUE_SCOPE_HINT: Record<
  IssueInboundAdapterType,
  { key: string; rich: boolean } | null
> = {
  JIRA: null,
  GITHUB: { key: "inboundGithubScopeHint", rich: true },
  AZURE_DEVOPS: { key: "inboundAdoScopeHint", rich: true },
  GITLAB: { key: "inboundGitlabScopeHint", rich: true },
  GITEA: { key: "inboundGiteaScopeHint", rich: true },
  REDMINE: { key: "inboundRedmineScopeHint", rich: false },
  MANTISBT: { key: "inboundMantisbtScopeHint", rich: false },
};

/** Per-adapter setup steps shown beside a freshly minted URL and secret. */
export const ISSUE_SETUP_STEP_KEYS: Record<IssueInboundAdapterType, string[]> =
  {
    JIRA: [
      "setupStepsJiraStep1",
      "setupStepsJiraStep2",
      "setupStepsJiraStep3",
      "setupStepsJiraStep4",
    ],
    GITHUB: [
      "setupStepsGithubStep1",
      "setupStepsGithubStep2",
      "setupStepsGithubStep3",
      "setupStepsGithubStep4",
      "setupStepsGithubStep5",
    ],
    AZURE_DEVOPS: [
      "setupStepsAdoStep1",
      "setupStepsAdoStep2",
      "setupStepsAdoStep3",
      "setupStepsAdoStep4",
      "setupStepsAdoStep5",
    ],
    GITLAB: [
      "setupStepsGitlabStep1",
      "setupStepsGitlabStep2",
      "setupStepsGitlabStep3",
      "setupStepsGitlabStep4",
    ],
    GITEA: [
      "setupStepsGiteaStep1",
      "setupStepsGiteaStep2",
      "setupStepsGiteaStep3",
      "setupStepsGiteaStep4",
      "setupStepsGiteaStep5",
    ],
    REDMINE: [
      "setupStepsRedmineStep1",
      "setupStepsRedmineStep2",
      "setupStepsRedmineStep3",
      "setupStepsRedmineStep4",
    ],
    MANTISBT: [
      "setupStepsMantisbtStep1",
      "setupStepsMantisbtStep2",
      "setupStepsMantisbtStep3",
      "setupStepsMantisbtStep4",
    ],
  };

/** Setup hint for a repository webhook, keyed by the verifying adapter. */
export const REPOSITORY_SETUP_KEY: Partial<Record<AdapterType, string>> = {
  GITHUB: "codeRepos.setupGithub",
  GITLAB: "codeRepos.setupGitlab",
  GITEA: "codeRepos.setupGitea",
  AZURE_DEVOPS: "codeRepos.setupAdo",
  BITBUCKET: "codeRepos.setupBitbucket",
};

/** Adapters whose single HMAC secret can be rotated in place. */
export function hasRotatableSecret(adapterType: string): boolean {
  return (
    adapterType === "JIRA" ||
    adapterType === "GITHUB" ||
    adapterType === "GITLAB" ||
    adapterType === "GITEA" ||
    adapterType === "BITBUCKET"
  );
}

export type EndpointHealth = "HEALTHY" | "DEGRADED" | "DISABLED";

export function healthBadgeVariant(
  health: EndpointHealth
): "default" | "secondary" | "destructive" {
  if (health === "DEGRADED") return "secondary";
  if (health === "DISABLED") return "destructive";
  return "default";
}
