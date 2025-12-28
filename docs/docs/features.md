---
title: Features
sidebar_position: 3
slug: /features
---

# Features

TestPlanIt is a comprehensive test management platform designed to help teams plan, execute, and track their testing efforts. Here's an overview of the key features.

## Test Case Management

### Test Case Editor

- **Rich text editing** - Create detailed test steps with formatted text, images, and attachments
- **Shared steps** - Define reusable step sequences that can be included in multiple test cases
- **Custom fields** - Define custom fields to capture additional metadata for your test cases
- **Expected results** - Clearly define what success looks like for each step

### Repository Organization

- **Hierarchical folders** - Organize test cases into nested folders for logical grouping
- **Custom fields** - Filter test cases by custom fields
- **Tags** - Apply tags to categorize and filter test cases across projects
- **Issues** - Attach issues to quickly navigate between test cases and related issues
- **Version history** - Track changes to test cases over time with full version control
- **Documentation pages** - Create wiki-style documentation pages within projects

## Test Execution

### Test Runs

- **Flexible run creation** - Create test runs from entire folders, filtered sets, or individual test cases
- **Magic Select** - Create test runs from similar test cases using AI
- **Configuration support** - Execute tests against different configurations (browsers, environments, etc.)
- **Bulk status updates** - Quickly update multiple test results at once
- **Execution history** - View the complete history of test executions for any run or individual test case

### Automation Integration

- **CI/CD friendly** - Designed to fit into your continuous integration pipelines
- **SDK support** - Integrate automated test results using the TestPlanIt SDK
- **TestPlanIt CLI** - CLI tool for submitting test case results in popular formats
- **API access** - Push results programmatically via the REST API
- **WebdriverIO reporter** - Native integration with WebdriverIO test framework

## Exploratory Testing

### Session-Based Testing

- **Timed sessions** - Create focused exploratory testing sessions with time limits
- **Charter-driven** - Define clear objectives and scope for each session
- **Real-time notes** - Capture observations, issues, and insights as you explore
- **Session reports** - Generate summaries of findings from exploratory sessions

## Project Management

### Milestones

- **Release tracking** - Organize test activities around releases or sprints
- **Progress monitoring** - Track completion status across milestones
- **Due dates** - Set target dates and monitor timeline adherence
- **Alerts** - Receive notifications when milestone due dates are approaching
- **Milestone types** - Define custom milestone categories (releases, sprints, etc.)

### Issue Tracking Integration

- **Jira integration** - Link test cases and results to Jira issues
- **GitHub integration** - Connect with GitHub Issues for defect tracking
- **Azure DevOps integration** - Sync with Azure Boards work items
- **Bi-directional linking** - Navigate seamlessly between tests and issues

## Reporting & Analytics

### Dashboards

- **Project dashboards** - Get an at-a-glance view of testing progress
- **Custom widgets** - Configure dashboards to show the metrics that matter to you
- **Real-time updates** - See live status as testing progresses

### Reports

- **Report builder** - Create custom reports with drag-and-drop interface
- **Test run reports** - Detailed breakdowns of test execution results
- **Coverage analysis** - Understand what has been tested and what remains
- **Trend analysis** - Track quality metrics over time
- **Export options** - Export reports in CSV for stakeholders

### Forecasting

- **Completion predictions** - Estimates of when testing will complete
- **Resource planning** - Plan testing capacity based on historical data

## AI-Powered Features

### LLM Integration

- **Test case generation** - Generate test cases from requirements using AI
- **Enhance Writing** - Get AI recommendations to improve writing for any rich text field
- **Magic Select** - AI-assisted test case selection for quickly building test runs
- **Multiple providers** - Support for OpenAI, Azure OpenAI, Anthropic, Ollama, and more
- **Privacy options** - Use local models for sensitive data with Ollama integration

## Administration

### User Management

- **Role-based access** - Define custom roles with granular permissions
- **Groups** - Organize users into groups for easier permission management
- **SSO support** - Integrate with your identity provider via SAML or OAuth2

### Customization

- **Custom workflows** - Define status workflows that match your process
- **Custom statuses** - Create statuses with custom icons and colors
- **Templates** - Create templates for consistent test case structure
- **User preferences** - Configure theme, locale, timezone, and date/time formats

### Security & Compliance

- **Audit logs** - Track all changes for compliance and security review
- **Two-factor authentication** - Add an extra layer of security for user accounts
- **Data encryption** - Secure data at rest and in transit

## Collaboration

### Team Features

- **Comments** - Discuss test cases and results with your team
- **Notifications** - Stay informed about changes and assignments
- **@mentions** - Tag team members in discussions
- **Activity feeds** - See recent activity across your projects

### Import & Export

- **Bulk import** - Import test cases from CSV or other test management tools
- **Test Results import** - Import automated test results via popular formats like JUnit XML
- **TestMo migration** - Special import support for migrating from Testmo
- **Export capabilities** - Export data for backup or migration
- **API access** - Full programmatic access to all features

## Search & Discovery

- **Advanced search** - Powerful search across all entities with complex filters
- **Global search** - Quick access search from anywhere (Cmd+K / Ctrl+K)
- **Elasticsearch integration** - Full-text search for large datasets
- **Custom field filtering** - Filter by any custom field values

## System & Operations

- **Background job processing** - Asynchronous task processing with BullMQ
- **System health monitoring** - Monitor system status and queue health
- **Upgrade notifications** - Get notified about new features since the last time you logged in
