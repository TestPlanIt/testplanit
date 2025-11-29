// Main exports for the integrations module
export { IntegrationManager, integrationManager } from "./IntegrationManager";
export { AuthenticationService } from "./AuthenticationService";
export { SyncService, syncService } from "./services/SyncService";
export { IssueCache, issueCache } from "./cache/IssueCache";

// Adapter exports
export { BaseAdapter } from "./adapters/BaseAdapter";
export { JiraAdapter } from "./adapters/JiraAdapter";
export { GitHubAdapter } from "./adapters/GitHubAdapter";
export { AzureDevOpsAdapter } from "./adapters/AzureDevOpsAdapter";

// Types
export type {
  IssueAdapter,
  IssueAdapterCapabilities,
  IssueSearchOptions,
  IssueData,
  CreateIssueData,
  UpdateIssueData,
  AuthenticationData,
  WebhookData,
  FieldMapping,
} from "./adapters/IssueAdapter";

// Helper function to get an integration client
export async function getIntegrationClient(
  integration: any,
  userAuth: any
): Promise<any> {
  const { IntegrationManager } = await import("./IntegrationManager");
  const manager = IntegrationManager.getInstance();
  return manager.getAdapter(String(integration.id));
}
