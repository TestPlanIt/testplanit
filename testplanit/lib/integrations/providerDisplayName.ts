/** Human-readable tracker name for a provider enum value, safe for client code. */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  JIRA: "Jira",
  GITHUB: "GitHub",
  GITLAB: "GitLab",
  GITEA: "Gitea",
  AZURE_DEVOPS: "Azure DevOps",
  REDMINE: "Redmine",
  MANTISBT: "MantisBT",
  BITBUCKET: "Bitbucket",
  CLICKUP: "ClickUp",
  LINEAR: "Linear",
};

export function providerDisplayName(
  provider: string | null | undefined
): string {
  if (!provider) return "";
  return (
    PROVIDER_DISPLAY_NAMES[provider.toUpperCase()] ??
    provider.charAt(0).toUpperCase() +
      provider.slice(1).toLowerCase().replace(/_/g, " ")
  );
}
