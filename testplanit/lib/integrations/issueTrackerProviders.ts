import { IntegrationProvider } from "~/zenstack/models";

/**
 * Providers that back a real issue tracker — every provider routed through
 * ManageExternalIssues, i.e. all of them except SIMPLE_URL, which is a bare
 * link with no API behind it (which is why sync and import reject it too).
 */
export const ISSUE_TRACKING_PROVIDERS = [
  IntegrationProvider.JIRA,
  IntegrationProvider.GITHUB,
  IntegrationProvider.AZURE_DEVOPS,
  IntegrationProvider.GITLAB,
  IntegrationProvider.GITEA,
  IntegrationProvider.REDMINE,
  IntegrationProvider.MANTISBT,
];
