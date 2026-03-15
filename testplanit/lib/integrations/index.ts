// Main exports for the integrations module
export { AzureDevOpsAdapter } from "./adapters/AzureDevOpsAdapter";
// Adapter exports
export { BaseAdapter } from "./adapters/BaseAdapter";
export { GitHubAdapter } from "./adapters/GitHubAdapter";
// Types
export type {
  AuthenticationData, CreateIssueData, FieldMapping, IssueAdapter,
  IssueAdapterCapabilities, IssueData, IssueSearchOptions, UpdateIssueData, WebhookData
} from "./adapters/IssueAdapter";
export { JiraAdapter } from "./adapters/JiraAdapter";
export { AuthenticationService } from "./AuthenticationService";
export { IssueCache, issueCache } from "./cache/IssueCache";
export { IntegrationManager, integrationManager } from "./IntegrationManager";
export { SyncService, syncService } from "./services/SyncService";



// Helper function to get an integration client
export async function getIntegrationClient(
  integration: any,
  userAuth: any
): Promise<any> {
  const { IntegrationManager } = await import("./IntegrationManager");
  const manager = IntegrationManager.getInstance();
  return manager.getAdapter(String(integration.id));
}
