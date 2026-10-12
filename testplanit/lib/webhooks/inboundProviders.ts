import type { AdapterType } from "~/zenstack/models";

/**
 * Map webhook adapter type → Integration provider value. The webhook
 * carries `WebhookConfig.adapterType` (JIRA / GITHUB / AZURE_DEVOPS); the
 * Integration model uses `IntegrationProvider` (JIRA / GITHUB / AZURE_DEVOPS).
 * They line up 1:1 today but `inboundProviderForAdapter` documents the
 * mapping so a future adapter without a corresponding integration provider
 * (e.g. SLACK inbound, hypothetical) can return null and skip system sync.
 */
export function inboundProviderForAdapter(
  adapterType: AdapterType
):
  | "JIRA"
  | "GITHUB"
  | "AZURE_DEVOPS"
  | "GITLAB"
  | "GITEA"
  | "REDMINE"
  | "MANTISBT"
  | "CLICKUP"
  | null {
  switch (adapterType) {
    case "JIRA":
      return "JIRA";
    case "GITHUB":
      return "GITHUB";
    case "AZURE_DEVOPS":
      return "AZURE_DEVOPS";
    case "GITLAB":
      return "GITLAB";
    case "GITEA":
      return "GITEA";
    case "REDMINE":
      return "REDMINE";
    case "MANTISBT":
      return "MANTISBT";
    case "CLICKUP":
      return "CLICKUP";
    default:
      return null;
  }
}
