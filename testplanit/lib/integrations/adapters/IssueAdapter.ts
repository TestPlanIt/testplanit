/**
 * Base interface for all issue tracking integration adapters
 */

export interface IssueAdapterCapabilities {
  createIssue: boolean;
  updateIssue: boolean;
  linkIssue: boolean;
  syncIssue: boolean;
  searchIssues: boolean;
  webhooks: boolean;
  customFields: boolean;
  attachments: boolean;
}

export interface IssueSearchOptions {
  query?: string;
  projectId?: string;
  status?: string[];
  assignee?: string;
  labels?: string[];
  limit?: number;
  offset?: number;
  fullSync?: boolean; // When true, sync all issues; when false, limit to recent items
}

export interface IssueData {
  id: string;
  key?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  issueType?: {
    id: string;
    name: string;
    iconUrl?: string;
  };
  assignee?: {
    id: string;
    name: string;
    email?: string;
  };
  reporter?: {
    id: string;
    name: string;
    email?: string;
  };
  labels?: string[];
  customFields?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  url?: string;
}

export interface CreateIssueData {
  title: string;
  description?: string | { type: "doc"; content: any[] };
  projectId: string;
  issueType?: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
  customFields?: Record<string, any>;
}

export interface UpdateIssueData {
  title?: string;
  description?: string | { type: "doc"; content: any[] };
  status?: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
  customFields?: Record<string, any>;
}

export interface AuthenticationData {
  type: "oauth" | "api_key" | "basic";
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  baseUrl?: string;
  expiresAt?: Date;
  email?: string;
  apiToken?: string;
}

export interface WebhookData {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  transformation?: (value: any) => any;
}

export interface IssueAdapter {
  /**
   * Get the capabilities of this adapter
   */
  getCapabilities(): IssueAdapterCapabilities;

  /**
   * Authenticate with the issue tracking system
   */
  authenticate(authData: AuthenticationData): Promise<void>;

  /**
   * Check if the current authentication is valid
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Create a new issue
   */
  createIssue(data: CreateIssueData): Promise<IssueData>;

  /**
   * Update an existing issue
   */
  updateIssue(issueId: string, data: UpdateIssueData): Promise<IssueData>;

  /**
   * Get a single issue by ID
   */
  getIssue(issueId: string): Promise<IssueData>;

  /**
   * Search for issues
   */
  searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }>;

  /**
   * Link an issue to a test case
   */
  linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void>;

  /**
   * Sync issue data from the external system
   */
  syncIssue(issueId: string): Promise<IssueData>;

  /**
   * Register a webhook for receiving updates
   */
  registerWebhook?(
    url: string,
    events: string[],
    secret?: string
  ): Promise<WebhookData>;

  /**
   * Unregister a webhook
   */
  unregisterWebhook?(webhookId: string): Promise<void>;

  /**
   * Process incoming webhook payload
   */
  processWebhook?(payload: any, signature?: string): Promise<void>;

  /**
   * Get available projects
   */
  getProjects?(): Promise<Array<{ id: string; key: string; name: string }>>;

  /**
   * Get available issue types for a project
   */
  getIssueTypes?(
    projectId: string
  ): Promise<Array<{ id: string; name: string }>>;

  /**
   * Get fields for a specific issue type
   */
  getIssueTypeFields?(
    projectId: string,
    issueTypeId: string
  ): Promise<any[]>;

  /**
   * Get available priorities
   */
  getPriorities?(): Promise<Array<{ id: string; name: string }>>;

  /**
   * Get available statuses
   */
  getStatuses?(): Promise<Array<{ id: string; name: string }>>;

  /**
   * Search for users with pagination support
   */
  searchUsers?(
    query: string,
    projectKey?: string,
    startAt?: number,
    maxResults?: number
  ): Promise<
    | Array<{
        accountId: string;
        displayName: string;
        emailAddress?: string;
        avatarUrls?: any;
      }>
    | {
        users: Array<{
          accountId: string;
          displayName: string;
          emailAddress?: string;
          avatarUrls?: any;
        }>;
        total: number;
      }
  >;

  /**
   * Get the current authenticated user
   */
  getCurrentUser?(): Promise<{
    accountId: string;
    displayName: string;
    emailAddress?: string;
  } | null>;

  /**
   * Get custom fields for a project
   */
  getCustomFields?(projectId: string): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      required: boolean;
      options?: Array<{ id: string; value: string }>;
    }>
  >;

  /**
   * Upload attachment to an issue
   */
  uploadAttachment?(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{
    id: string;
    url: string;
  }>;

  /**
   * Get field mappings for the integration
   */
  getFieldMappings?(): FieldMapping[];

  /**
   * Validate the current configuration
   */
  validateConfiguration?(): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * OAuth-specific methods (optional - only for adapters that support OAuth)
   */

  /**
   * Check if the adapter supports OAuth authentication
   */
  supportsOAuth?: boolean;

  /**
   * Get the OAuth authorization URL
   */
  getAuthorizationUrl?(state: string): string;

  /**
   * Exchange authorization code for access tokens
   */
  exchangeCodeForTokens?(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }>;

  /**
   * Refresh OAuth tokens using refresh token
   */
  refreshTokens?(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }>;
}
