---
title: FAQ
sidebar_position: 4
slug: /faq
---

# Frequently Asked Questions

## General

### What is TestPlanIt?

TestPlanIt is an open-source test management platform for creating, managing, and executing test plans. It supports manual testing, automated test result integration, exploratory testing sessions, and integrates with popular issue trackers like Jira, GitHub, and Azure DevOps.

### Is TestPlanIt free?

Yes, TestPlanIt is **open-source** and **free** to use. You can self-host it on your own infrastructure at no cost. The source code is available on [GitHub](https://github.com/TestPlanIt/testplanit).

The TestPlanIt Team will be offering a hosted solution for users who do not want to self-host. However, be aware there will be a charge for hosting, but we will never charge for the use of the software. This means no features will be paywalled because you've chosen to host with us. Sign up on the [waitlist](https://testplanit.com/waitlist) to find out when it becomes available.

### What are the system requirements?

TestPlanIt requires:

- **RAM** 8GB to build/run the whole stack. 16GB recommended
- **Disk** 25GB+ space for data and file attachments
- **Node.js** 20 or later
- **PostgreSQL** 14 or later
- **Redis/Valkey** for background job processing
- **Elasticsearch** for advanced search
- **S3-compatible storage** for file attachments (AWS, Minio or other S3-compatible storage solutions)

For Docker deployments, you just need Docker and Docker Compose installed.

### Can I use TestPlanIt in the cloud?

Yes, you can deploy TestPlanIt to any cloud provider that supports Docker containers or Node.js applications. See the [deployment guide](/docs/deployment) for detailed instructions.

## Installation & Setup

### How do I install TestPlanIt?

You have several options:

1. **Docker** - The easiest way to get started. See the [Docker setup guide](/docs/docker-setup).
2. **Manual installation** - For more control over your environment. See the [manual setup guide](/docs/manual-setup).

### How do I upgrade TestPlanIt?

Pull the latest Docker image or code from the repository and run the database migrations. The application will automatically apply any necessary schema changes on startup.

### Can I migrate from another test management tool?

Yes, TestPlanIt supports importing test cases from CSV files. For specific tools like Testmo, see the [import guide](/docs/import-export). If you need to migrate from a tool that isn't directly supported, you can use the API to programmatically import your data.

## Features

### Does TestPlanIt support automated testing?

TestPlanIt doesn't run automated tests directly, but it integrates with your existing automation frameworks. You can push automated test results to TestPlanIt using:

- The [TestPlanIt SDK](/docs/sdk/) for programmatic access
- The [WebdriverIO reporter](/docs/sdk/webdriverio-reporter) for WebdriverIO integration
- The REST API for custom integrations

### Can I integrate with Jira/GitHub/Azure DevOps?

Yes, TestPlanIt has built-in integrations with:

- **Jira** - Link test cases to Jira issues and create issues from failed tests
- **GitHub** - Connect with GitHub Issues for defect tracking
- **Azure DevOps** - Sync with Azure Boards work items

See the [integrations documentation](/docs/user-guide/integrations) for setup instructions.

### Does TestPlanIt support exploratory testing?

Yes, TestPlanIt includes session-based exploratory testing features. You can create timed testing sessions with defined charters, capture notes and findings in real-time, and generate session reports. See the [sessions documentation](/docs/user-guide/projects/sessions) for details.

### Can I use AI to generate test cases?

Yes, TestPlanIt integrates with various LLM providers including OpenAI, Azure OpenAI, Anthropic, and Ollama (for local/private deployments). The AI features can help generate test cases from requirements and suggest test steps. See the [LLM integrations guide](/docs/user-guide/llm-integrations).

### Does TestPlanIt support multiple languages?

The TestPlanIt interface supports multiple languages including English, Spanish, and French. Contributions for additional languages are welcome.

## Administration

### How do I manage user access?

TestPlanIt includes role-based access control:

- Create custom roles with specific permissions
- Organize users into groups
- Assign roles at the global or project level

See the [roles documentation](/docs/user-guide/roles) for details.

### Does TestPlanIt support SSO?

Yes, TestPlanIt supports:

- **SAML 2.0** - For enterprise identity providers
- **OAuth 2.0** - For social and corporate logins
- **Magic links** - Passwordless email authentication

See the [SSO configuration guide](/docs/user-guide/sso) for setup instructions.

### How do I back up my data?

Since TestPlanIt uses PostgreSQL, you can use standard PostgreSQL backup tools like `pg_dump`. For file attachments stored in S3, use your S3 provider's backup features.

### Where are audit logs stored?

Audit logs are stored in the database and accessible through the administration interface. They track user actions, configuration changes, and data modifications. See the [audit logs documentation](/docs/user-guide/audit-logs).

## Troubleshooting

### The application won't start

Check the following:

1. Ensure all required environment variables are set (see `.env.example`)
2. Verify PostgreSQL is running and accessible
3. Verify Redis/Valkey is running and accessible
4. Check the application logs for specific error messages

### Search isn't working

If you're using Elasticsearch:

1. Verify Elasticsearch is running and accessible
2. Check that the `ELASTICSEARCH_URL` environment variable is correctly set
3. Rebuild the search index if needed

If you're not using Elasticsearch, basic search functionality is available using PostgreSQL's built-in text search.

### Background jobs aren't processing

Check the following:

1. Ensure the worker processes are running (`pnpm workers`)
2. Verify Redis/Valkey is running and the `VALKEY_URL` is correct
3. Check the worker logs for error messages

### How do I report a bug or request a feature?

Please open an issue on the [GitHub repository](https://github.com/testplanit/testplanit). Include:

- A clear description of the issue or feature request
- Steps to reproduce (for bugs)
- Your environment details (version, deployment method, etc.)

## Contributing

### How can I contribute to TestPlanIt?

We welcome contributions! You can:

- Report bugs and suggest features via GitHub Issues
- Submit pull requests for bug fixes or new features
- Help with documentation improvements
- Contribute translations for additional languages

See the contribution guidelines in the GitHub repository for more details.

### Where can I get help?

- **Documentation** - You're already here!
- **GitHub Issues** - For [bug reports and feature requests](https://github.com/TestPlanIt/testplanit/issues)
- **Twitter/X** - Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
