import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Define the sidebar structure manually
  tutorialSidebar: [
    // Define top-level items
    'intro', // Corresponds to intro.md
    'features', // Features overview page
    {
      type: 'category',
      label: 'Installation', // Set the label for the sidebar category
      link: {
        type: 'doc',
        id: 'installation', // Link the category title to installation.md
      },
      items: [
        'manual-setup', // Corresponds to manual-setup.md
        'file-storage', // Add file-storage.md
        'search-configuration', // Add search-configuration.md
        'docker-setup', // Corresponds to docker-setup.md
        'deployment', // Add deployment.md after Installation
        'external-database-deployment', // Add external-database-deployment.md
        'background-processes', // Add background-processes.md
        'multi-tenant-workers', // Add multi-tenant-workers.md
        'sse-notifications', // SSE notifications deployment & ingress configuration
      ],
    },
    'getting-started', // Corresponds to getting-started.md
    // Define the User Guide category manually
    {
      type: 'category',
      label: 'User Guide', // Set the desired label
      // Link the category title to the user-guide.mdx page
      link: {
        type: 'doc',
        id: 'user-guide-overview',
      },
      // We now define the items inside User Guide manually
      items: [
        // Define the Administration sub-category
        {
          type: 'category',
          label: 'Administration',
          // Link this category title to the administration.md page
          link: {
            type: 'doc',
            id: 'user-guide/administration',
          },
          // List the pages within the Administration sub-category,
          // grouped to mirror the in-app Admin menu sections
          items: [
            // Test Management
            {
              type: 'category',
              label: 'Test Management',
              items: [
                'user-guide/projects', // Corresponds to projects.md
                'user-guide/templates-fields', // Corresponds to templates-fields.md
                // Workflows category with Review & Approval as a child
                {
                  type: 'category',
                  label: 'Workflows',
                  link: {
                    type: 'doc',
                    id: 'user-guide/workflows',
                  },
                  items: [
                    'user-guide/review-approvals', // Review & Approval gates on workflow transitions
                  ],
                },
                'user-guide/statuses', // Corresponds to statuses.md
                'user-guide/milestone-types', // Corresponds to milestone-types.md
                'user-guide/configurations', // Corresponds to configurations.md
                'user-guide/tags', // Corresponds to tags.md
                'user-guide/admin-issues', // Global cross-project issues administration
                {
                  type: 'category',
                  label: 'Reporting & Analytics',
                  link: {
                    type: 'doc',
                    id: 'user-guide/reporting',
                  },
                  items: [
                    'user-guide/cross-project-reports', // Cross-project report types + project scoping
                  ],
                },
              ],
            },
            // People & Access
            {
              type: 'category',
              label: 'People & Access',
              items: [
                'user-guide/users', // Corresponds to users.md
                'user-guide/groups', // Corresponds to groups.md
                'user-guide/roles', // Corresponds to roles.md
                'user-guide/permissions-guide', // Permissions guide
              ],
            },
            // Authentication
            {
              type: 'category',
              label: 'Authentication',
              items: [
                'user-guide/sso', // Single Sign-On providers and SAML configuration
                'user-guide/security-settings', // Sign-in enforcement, password policy, lockout, enforcement
                'api-tokens', // API tokens
                'user-guide/scim', // SCIM 2.0 provisioning from external IdP
              ],
            },
            // Tools & Integrations
            {
              type: 'category',
              label: 'Tools & Integrations',
              items: [
                'user-guide/integrations', // Issue integrations administration page
                'user-guide/share-links', // Share Links documentation
                // Convert Notifications to a category with children
                {
                  type: 'category',
                  label: 'Notifications',
                  link: {
                    type: 'doc',
                    id: 'user-guide/notifications',
                  },
                  items: [
                    'user-guide/email-templates', // Email templates configuration
                    'user-guide/system-announcements', // System-wide announcements
                    'upgrade-notifications', // Version upgrade notifications
                  ],
                },
                {
                  type: 'category',
                  label: 'AI Models',
                  link: {
                    type: 'doc',
                    id: 'user-guide/llm-integrations',
                  },
                  items: [
                    'user-guide/llm-test-generation', // AI test case generation
                    'user-guide/llm-magic-select', // AI-powered test case selection
                    'user-guide/llm-quickscript', // AI-powered QuickScript generation
                    'user-guide/llm-writing-assistant', // In-editor AI writing assistant
                    'user-guide/llm-markdown-import', // AI-assisted markdown import
                    'user-guide/llm-auto-tag', // AI-powered auto tagging
                  ],
                },
                'user-guide/prompt-configurations', // AI prompt configuration management
                'user-guide/quickscript-templates', // QuickScript templates for test case export
                'user-guide/code-repositories', // Git repository connections for AI export context
              ],
            },
            // System
            {
              type: 'category',
              label: 'System',
              items: [
                'user-guide/app-config', // Corresponds to app-config.md
                'user-guide/data-imports', // Data Imports (Testmo JSON wizard)
                'user-guide/search-engine', // Elasticsearch status, replicas, reindex
                'user-guide/queues', // Background job queue management
                'user-guide/audit-logs', // Audit logs for compliance and security
                'user-guide/audit-log-reliability', // Audit log retry/backoff policy and ops reference
                'user-guide/trash', // Restore or purge soft-deleted records
              ],
            },
            // Add other admin pages here as they are created
          ],
        },
        'user-guide/dashboard', // Corresponds to dashboard.md
        'user-guide/projects-list', // Corresponds to projects-list.md
        'user-guide/tags-list', // Corresponds to tags-list.md
        'user-guide/issues-list', // Renamed from global-issues
        'user-guide/users-list', // Corresponds to users-list.md
        'user-guide/user-profile', // Corresponds to user-profile.md
        'user-guide/user-menu', // Corresponds to user-menu.md
        'user-guide/notifications-inbox', // User-facing notification center + preferences
        'user-guide/reviews-inbox', // Reviewer inbox for Review & Approval
        // Add the new Projects category here
        {
          type: 'category',
          label: 'Projects', // New category for project-specific features
          // No explicit link, making the label non-clickable and not highlighted when children are active
          // Grouped to mirror the in-app Project menu sections
          items: [
            // Project
            {
              type: 'category',
              label: 'Project',
              items: [
                'user-guide/project-overview', // Use the ID Docusaurus recognizes
                'user-guide/projects/documentation', // Correct ID including subdirectory
                // Convert Milestones to a category
                {
                  type: 'category',
                  label: 'Milestones',
                  // Link the category label to the main milestones list page
                  link: {
                    type: 'doc',
                    id: 'user-guide/projects/milestones',
                  },
                  // Only list child pages here
                  items: [
                    'user-guide/projects/milestone-details', // Milestone details page
                  ],
                },
              ],
            },
            // Management
            {
              type: 'category',
              label: 'Management',
              items: [
                // Add Repository category
                {
                  type: 'category',
                  label: 'Repository',
                  link: {
                    type: 'doc',
                    id: 'user-guide/projects/repository', // Link to the main repository page
                  },
                  items: [
                    'user-guide/projects/repository-add-case', // Corresponds to repository-add-case.md
                    'user-guide/projects/repository-case-details', // Add Test Case Details page
                    'user-guide/projects/repository-case-versions', // Add Test Case Versions page
                    'user-guide/projects/parameterized-test-cases', // Parameterized Test Cases feature hub
                    'user-guide/projects/step-duplicate-detection', // Step sequence duplicate detection
                    'import-export', // Add import-export.md
                    'copy-move-test-cases', // Copy/Move test cases between projects
                    'user-guide/projects/duplicate-detection', // Duplicate test case detection
                    'user-guide/projects/quickscript', // QuickScript from repository
                  ],
                },
                // Shared Steps (separate Management item in the app menu)
                {
                  type: 'category',
                  label: 'Shared Steps',
                  link: {
                    type: 'doc',
                    id: 'user-guide/shared-steps', // Add shared-steps.md
                  },
                  items: [
                    'user-guide/import-shared-steps', // Add import-shared-steps.md
                  ],
                },
                // Add the new Test Runs category
                {
                  type: 'category',
                  label: 'Test Runs & Results',
                  link: {
                    type: 'doc',
                    id: 'user-guide/projects/runs', // Link to the main test runs page
                  },
                  items: [
                    // Add child pages like Add Test Run, Run Details later
                    'user-guide/projects/add-test-run-modal', // Corresponds to add-test-run-modal.md
                    'user-guide/projects/test-run-item', // Corresponds to test-run-item.md
                    'user-guide/projects/run-details', // Corresponds to run-details.md
                    'user-guide/projects/test-case-execution', // Corresponds to test-case-execution.md
                  ],
                },
                // Add the new Sessions category
                {
                  type: 'category',
                  label: 'Sessions',
                  link: {
                    type: 'doc',
                    id: 'user-guide/projects/sessions', // Link to the main sessions page
                  },
                  items: [
                    // Add child pages later
                    'user-guide/projects/sessions-add', // Corresponds to sessions-add.md
                    'user-guide/projects/sessions-item', // Corresponds to sessions-item.md
                    'user-guide/projects/sessions-details', // Corresponds to sessions-details.md
                    'user-guide/projects/sessions-versions', // Corresponds to sessions-versions.md
                    'user-guide/projects/sessions-execution', // Corresponds to sessions-execution.md
                  ],
                },
                'user-guide/projects/tags', // Corresponds to tags.md
                'user-guide/projects/issues', // Add Project Issues page here
                // Reporting & Analytics (per-project) category
                {
                  type: 'category',
                  label: 'Reporting & Analytics',
                  link: {
                    type: 'doc',
                    id: 'user-guide/projects/reports/index',
                  },
                  items: [
                    'user-guide/projects/reports/automation-candidates',
                    'user-guide/projects/reports/automation-trends',
                    'user-guide/projects/reports/execution-log',
                    'user-guide/projects/reports/flaky-tests',
                    'user-guide/projects/reports/issue-test-coverage',
                    'user-guide/projects/reports/iteration-matrix',
                    'user-guide/projects/reports/test-case-health',
                    'user-guide/projects/reports/report-builder',
                  ],
                },
                'user-guide/projects/audit-log', // Project-scoped audit trail (ADMIN + assigned PROJECTADMIN)
              ],
            },
            // Settings
            {
              type: 'category',
              label: 'Settings',
              items: [
                'user-guide/projects/settings/integrations', // Project issue integration selection
                'user-guide/webhooks', // Inbound and outbound webhooks (configured per project)
                'user-guide/projects/settings/ai-models', // Project AI model default + per-feature overrides
                'user-guide/projects/settings/quickscript', // Project QuickScript context + export templates
                'user-guide/projects/settings/parameters', // Test Case Parameters settings (CI mapping + shared datasets)
                'user-guide/projects/settings/advanced', // Per-project feature toggles
                'user-guide/projects/settings/shares', // Project-scoped share link management
              ],
            },
          ],
        },
        'user-guide/advanced-search', // Advanced search documentation
        'user-guide/forecasting', // Add forecasting.md as last item
      ],
      // Remove the generated-index link for the main User Guide category
      // link: {
      //  type: 'generated-index',
      //  title: 'User Guide Overview',
      //  slug: '/category/user-guide'
      // }
    },
    'best-practices', // Best practices guide
    'faq', // Frequently asked questions
    'cli', // CLI tool documentation
    'e2e-testing', // E2E testing guide for contributors
    // SDK & Integrations category
    {
      type: 'category',
      label: 'SDK & Integrations',
      link: {
        type: 'doc',
        id: 'sdk/sdk-overview', // Link to the overview page
      },
      items: [
        'api-reference', // Add api-reference.md
        'data-lake-export', // NDJSON bulk-export endpoints + webhook event catalog
        'sdk/api-client', // @testplanit/api package
        'sdk/jira-forge-app', // Jira Forge app (Marketplace plugin)
        {
          type: 'category',
          label: 'MCP Server',
          link: {
            type: 'doc',
            id: 'sdk/mcp-overview',
          },
          items: [
            'sdk/mcp-configuration', // Configuration: Claude Desktop + Cursor + token scopes
            'sdk/mcp-prompts', // Example agent prompts
          ],
        },
        {
          type: 'category',
          label: 'WebdriverIO Reporter',
          link: {
            type: 'doc',
            id: 'sdk/wdio-overview',
          },
          items: [
            'sdk/wdio-configuration', // Configuration options reference
            'sdk/wdio-test-cases', // Linking & auto-creating test cases
            'sdk/wdio-launcher-service', // Launcher service for single test run
            'sdk/wdio-screenshots', // Screenshot uploads
            'sdk/wdio-ci-cd', // CI/CD, retries, debugging, complete example
          ],
        },
        {
          type: 'category',
          label: 'Playwright Reporter',
          link: {
            type: 'doc',
            id: 'sdk/playwright-overview',
          },
          items: [
            'sdk/playwright-configuration', // Configuration options reference
            'sdk/playwright-test-cases', // Linking & auto-creating test cases
            'sdk/playwright-attachments', // Attachment uploads (screenshots, video, trace)
            'sdk/playwright-ci-cd', // CI/CD, retries, debugging, complete example
          ],
        },
      ],
    },
    // Add other categories or items here if needed in the future
  ],

  // But you can create a sidebar manually
  /*
  tutorialSidebar: [
    'intro',
    'hello',
    {
      type: 'category',
      label: 'Tutorial',
      items: ['tutorial-basics/create-a-document'],
    },
  ],
   */
};

export default sidebars;
