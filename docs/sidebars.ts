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
      ],
    },
    'getting-started', // Corresponds to getting-started.md
    'api-reference', // Add api-reference.md

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
          // List the pages within the Administration sub-category
          items: [
            'user-guide/app-config', // Corresponds to app-config.md
            'user-guide/projects', // Corresponds to projects.md
            'user-guide/templates-fields', // Corresponds to templates-fields.md
            'user-guide/workflows', // Corresponds to workflows.md
            'user-guide/statuses', // Corresponds to statuses.md
            'user-guide/milestone-types', // Corresponds to milestone-types.md
            'user-guide/configurations', // Corresponds to configurations.md
            'user-guide/users', // Corresponds to users.md
            'user-guide/groups', // Corresponds to groups.md
            'user-guide/roles', // Corresponds to roles.md
            'user-guide/tags', // Corresponds to tags.md
            'user-guide/reporting', // Add reporting.md
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
            'user-guide/integrations', // Issue integrations administration page
            'user-guide/llm-integrations', // LLM/AI integrations administration page
            'user-guide/sso', // Authentication configuration and management
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
        // Add the new Projects category here
        {
          type: 'category',
          label: 'Projects', // New category for project-specific features
          // No explicit link, making the label non-clickable and not highlighted when children are active
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
                'user-guide/shared-steps', // Add shared-steps.md
                'user-guide/import-shared-steps', // Add import-shared-steps.md
                'import-export', // Add import-export.md
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
            // Add other project-specific pages here later
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
