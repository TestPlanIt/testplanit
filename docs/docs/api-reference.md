---
sidebar_position: 12
title: API Reference
---

# API Reference

TestPlanIt provides a comprehensive RESTful API for programmatic access to all test management functionality. The API uses ZenStack-generated endpoints with built-in type safety, authentication, and row-level security.

## Overview

The API provides:

- **RESTful endpoints** for all entities and operations
- **Type-safe requests** with automatic validation
- **Row-level security** based on user permissions
- **Authentication** via NextAuth.js sessions
- **Rate limiting** and security measures
- **OpenAPI compatibility** for documentation generation

## Authentication

### Session-Based Authentication

TestPlanIt uses NextAuth.js for session management. All API requests require a valid session cookie.

#### Browser-Based Requests

For requests from the browser, authentication is handled automatically:

```javascript
// Fetch with automatic session handling
const response = await fetch('/api/projects', {
  method: 'GET',
  credentials: 'include' // Include session cookies
});
```

#### Server-Side Requests

For server-side integrations, authentication is handled through session cookies. External integrations should use the standard session-based authentication flow.

```javascript
// Server-side requests use session cookies
const response = await fetch('/api/projects', {
  headers: {
    'Content-Type': 'application/json'
  },
  credentials: 'include' // Include session cookies
});
```

### Authentication Limitations

Currently, TestPlanIt uses session-based authentication only. API key authentication for server-to-server integration is not implemented but may be added in future releases.

## Base URL and Endpoints

**Base URL:** `https://your-domain.com/api`

**Endpoint Pattern:** `/api/{entity}/{action?}`

## Core Entities

### Projects

#### Get All Projects

```http
GET /api/projects
```

Response:

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "My Test Project",
      "description": "Project description",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Project

```http
POST /api/projects
Content-Type: application/json

{
  "name": "New Project",
  "description": "Project description",
  "settings": {
    "allowPublicAccess": false
  }
}
```

#### Get Project by ID

```http
GET /api/projects/{projectId}
```

#### Update Project

```http
PUT /api/projects/{projectId}
Content-Type: application/json

{
  "name": "Updated Project Name",
  "description": "Updated description"
}
```

#### Delete Project

```http
DELETE /api/projects/{projectId}
```

### Test Cases (Repository)

#### Get Test Cases

```http
GET /api/repository-cases?projectId={projectId}&folderId={folderId}
```

Query Parameters:

- `projectId`: Filter by project (required)
- `folderId`: Filter by folder (optional)
- `tags`: Filter by tags (comma-separated)
- `templateId`: Filter by template
- `search`: Text search query
- `limit`: Number of results (default: 50)
- `offset`: Pagination offset

#### Create Test Case

```http
POST /api/repository-cases
Content-Type: application/json

{
  "projectId": "uuid",
  "folderId": "uuid",
  "title": "Test Case Title",
  "description": "Test case description",
  "steps": [
    {
      "action": "Navigate to login page",
      "expected": "Login form displays",
      "order": 1
    }
  ],
  "tags": ["authentication", "smoke"],
  "automationStatus": "MANUAL",
  "estimate": 300
}
```

#### Get Test Case by ID

```http
GET /api/repository-cases/{caseId}
```

#### Update Test Case

```http
PUT /api/repository-cases/{caseId}
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description",
  "steps": [
    {
      "action": "Updated step",
      "expected": "Updated expected result",
      "order": 1
    }
  ]
}
```

### Test Runs

#### Get Test Runs

```http
GET /api/test-runs?projectId={projectId}
```

#### Create Test Run

```http
POST /api/test-runs
Content-Type: application/json

{
  "projectId": "uuid",
  "name": "Test Run Name",
  "description": "Test run description",
  "milestoneId": "uuid",
  "configurationId": "uuid",
  "testCases": [
    {
      "repositoryCaseId": "uuid",
      "assignedTo": "user-uuid"
    }
  ]
}
```

#### Execute Test Case

```http
POST /api/test-runs/{runId}/cases/{caseId}/execute
Content-Type: application/json

{
  "status": "PASSED",
  "notes": "Test executed successfully",
  "duration": 180,
  "stepResults": [
    {
      "stepId": "uuid",
      "status": "PASSED",
      "notes": "Step completed",
      "duration": 60
    }
  ],
  "attachments": [
    {
      "name": "screenshot.png",
      "url": "https://storage.example.com/screenshot.png"
    }
  ]
}
```

### Sessions (Exploratory Testing)

#### Get Sessions

```http
GET /api/sessions?projectId={projectId}
```

#### Create Session

```http
POST /api/sessions
Content-Type: application/json

{
  "projectId": "uuid",
  "name": "Exploratory Session",
  "description": "Session description",
  "templateId": "uuid",
  "assignedTo": "user-uuid",
  "estimate": 7200
}
```

#### Record Session Results

```http
POST /api/sessions/{sessionId}/results
Content-Type: application/json

{
  "notes": "Session findings",
  "duration": 3600,
  "findings": [
    {
      "type": "BUG",
      "title": "Issue found",
      "description": "Detailed description",
      "severity": "HIGH"
    }
  ]
}
```

### Issues

#### Get Issues

```http
GET /api/issues?projectId={projectId}
```

Query Parameters:
- `projectId`: Filter by project (optional)
- `integrationId`: Filter by integration (optional)
- `isDeleted`: Include deleted issues (default: false)

#### Create Issue

```http
POST /api/issues/create
Content-Type: application/json

{
  "projectId": "uuid",
  "name": "Issue Name",
  "title": "Issue Title",
  "description": "Issue description",
  "priority": "HIGH",
  "severity": "CRITICAL",
  "assignedTo": "user-uuid",
  "externalId": "JIRA-123",
  "externalUrl": "https://jira.example.com/JIRA-123",
  "integrationId": "uuid"
}
```

#### Get Issue by ID

```http
GET /api/issues/{issueId}
```

#### Update Issue

```http
PUT /api/issues/{issueId}
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description",
  "status": "IN_PROGRESS"
}
```

#### Delete Issue

```http
DELETE /api/issues/{issueId}
```

#### Link Issue to Entity

```http
POST /api/issues/{issueId}/link
Content-Type: application/json

{
  "entityType": "testCase" | "testRun" | "session" | "testRunResult",
  "entityId": "uuid"
}
```

#### Unlink Issue from Entity

```http
POST /api/issues/{issueId}/unlink
Content-Type: application/json

{
  "entityType": "testCase" | "testRun" | "session" | "testRunResult",
  "entityId": "uuid"
}
```

### Integrations

#### Get All Integrations (Admin)

```http
GET /api/integrations
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Production Jira",
      "provider": "JIRA",
      "authType": "API_KEY",
      "status": "ACTIVE",
      "settings": {...}
    }
  ]
}
```

#### Test Integration Connection

```http
POST /api/integrations/test-connection
Content-Type: application/json

{
  "integrationId": "uuid"
}
```

#### Get Integration by ID

```http
GET /api/integrations/{id}
```

#### Get Integration Projects

```http
GET /api/integrations/{id}/projects
```

Response:
```json
{
  "projects": [
    {
      "id": "PROJECT-KEY",
      "key": "PROJECT",
      "name": "Project Name"
    }
  ]
}
```

#### Get Issue Types

```http
GET /api/integrations/{id}/issue-types?projectKey={projectKey}
```

Response:
```json
{
  "issueTypes": [
    {
      "id": "10001",
      "name": "Bug",
      "subtask": false
    }
  ]
}
```

#### Get Issue Type Fields

```http
GET /api/integrations/{id}/issue-type-fields?projectKey={projectKey}&issueTypeId={issueTypeId}
```

Response:
```json
{
  "fields": [
    {
      "key": "summary",
      "name": "Summary",
      "required": true,
      "schema": {
        "type": "string"
      }
    }
  ]
}
```

#### Create External Issue

```http
POST /api/integrations/{id}/create-issue
Content-Type: application/json

{
  "projectKey": "PROJECT",
  "issueType": "Bug",
  "fields": {
    "summary": "Issue summary",
    "description": "Detailed description",
    "priority": "High"
  }
}
```

Response:
```json
{
  "key": "PROJECT-123",
  "id": "10001",
  "self": "https://jira.example.com/rest/api/2/issue/10001",
  "url": "https://jira.example.com/browse/PROJECT-123"
}
```

#### Search External Issues

```http
GET /api/integrations/{id}/search?query={searchQuery}&projectKey={projectKey}
```

Response:
```json
{
  "issues": [
    {
      "key": "PROJECT-123",
      "summary": "Issue summary",
      "status": "Open",
      "assignee": "user@example.com"
    }
  ]
}
```

#### Link Existing External Issue

```http
POST /api/integrations/{id}/link-issue
Content-Type: application/json

{
  "issueKey": "PROJECT-123",
  "entityType": "testCase",
  "entityId": "uuid"
}
```

#### Search Users (for assignee fields)

```http
GET /api/integrations/{id}/search-users?query={userQuery}
```

Response:
```json
{
  "users": [
    {
      "accountId": "user-id",
      "displayName": "John Doe",
      "emailAddress": "john@example.com"
    }
  ]
}
```

### Project Integrations

#### Get Project Integrations

```http
GET /api/projects/{projectId}/integrations
```

#### Assign Integration to Project

```http
POST /api/projects/{projectId}/integrations
Content-Type: application/json

{
  "integrationId": "uuid",
  "config": {
    "externalProjectId": "PROJECT-KEY",
    "defaultIssueType": "Bug"
  }
}
```

#### Update Project Integration Settings

```http
PUT /api/projects/{projectId}/integrations/{integrationProjectId}
Content-Type: application/json

{
  "config": {
    "externalProjectId": "PROJECT-KEY",
    "defaultIssueType": "Task",
    "autoSync": true
  }
}
```

#### Remove Integration from Project

```http
DELETE /api/projects/{projectId}/integrations/{integrationProjectId}
```

### OAuth Authentication (Jira)

#### Initiate OAuth Flow

```http
GET /api/integrations/jira/auth?integrationId={integrationId}
```

Redirects to Jira authorization page.

#### OAuth Callback

```http
GET /api/integrations/jira/callback?code={authCode}&state={state}
```

Handles OAuth callback and stores user authorization.

#### Check OAuth Status

```http
GET /api/integrations/{id}/auth/check
```

Response:
```json
{
  "authorized": true,
  "user": {
    "email": "user@example.com",
    "displayName": "John Doe"
  },
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

### Milestones

#### Get Milestones

```http
GET /api/milestones?projectId={projectId}
```

#### Create Milestone

```http
POST /api/milestones
Content-Type: application/json

{
  "projectId": "uuid",
  "name": "Release 1.0",
  "description": "First major release",
  "dueDate": "2024-12-31",
  "parentId": "uuid"
}
```

### Comments

#### Get Comments for Entity

```http
GET /api/comments/{entityType}/{entityId}
```

Path Parameters:
- `entityType`: `repositoryCase`, `testRun`, or `session`
- `entityId`: ID of the entity

Response:
```json
{
  "comments": [
    {
      "id": "uuid",
      "content": {
        "type": "doc",
        "content": [...]
      },
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "user": {
        "id": "uuid",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "mentionedUsers": [
        {
          "id": "uuid",
          "name": "Jane Smith",
          "email": "jane@example.com"
        }
      ]
    }
  ]
}
```

#### Create Comment

```http
POST /api/comments
Content-Type: application/json

{
  "projectId": "uuid",
  "entityType": "repositoryCase",
  "entityId": "uuid",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Comment with " },
          {
            "type": "mention",
            "attrs": {
              "id": "user-uuid",
              "label": "John Doe"
            }
          }
        ]
      }
    ]
  },
  "mentionedUserIds": ["user-uuid"]
}
```

#### Update Comment

```http
PUT /api/comments/{commentId}
Content-Type: application/json

{
  "content": {
    "type": "doc",
    "content": [...]
  },
  "mentionedUserIds": ["user-uuid"]
}
```

#### Delete Comment

```http
DELETE /api/comments/{commentId}
```

#### Search Users for Mentions

```http
GET /api/users/search-for-mentions?projectId={projectId}&query={searchQuery}
```

Query Parameters:
- `projectId`: Filter users by project assignment
- `query`: Search term for user name or email

Response:
```json
{
  "users": [
    {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": "https://..."
    }
  ]
}
```

### Test Case Links

#### Get Links for Test Case

```http
GET /api/model/RepositoryCaseLink/findMany?q={
  "where": {
    "OR": [
      {"caseAId": 123, "isDeleted": false},
      {"caseBId": 123, "isDeleted": false}
    ]
  },
  "include": {
    "caseA": true,
    "caseB": true
  }
}
```

#### Create Test Case Link

```http
POST /api/model/RepositoryCaseLink/create
Content-Type: application/json

{
  "data": {
    "caseA": {"connect": {"id": 123}},
    "caseB": {"connect": {"id": 456}},
    "type": "SAME_TEST_DIFFERENT_SOURCE"
  }
}
```

Link Types:
- `SAME_TEST_DIFFERENT_SOURCE`: Links manual and automated versions of same test
- `DEPENDS_ON`: Indicates dependency relationship

#### Remove Link (Soft Delete)

```http
PUT /api/model/RepositoryCaseLink/update
Content-Type: application/json

{
  "where": {"id": 789},
  "data": {"isDeleted": true}
}
```

### Testmo Import

#### Get Upload URL for Testmo Export

```http
POST /api/imports/testmo/upload-url
Content-Type: application/json

{
  "fileName": "testmo-export.zip",
  "fileSize": 10485760,
  "contentType": "application/zip"
}
```

Response:
```json
{
  "uploadUrl": "https://s3.../...",
  "fileKey": "imports/testmo/...",
  "jobId": "uuid"
}
```

#### Create Import Job

```http
POST /api/imports/testmo/jobs
Content-Type: application/json

{
  "fileKey": "imports/testmo/...",
  "fileName": "testmo-export.zip"
}
```

#### Get Import Job Status

```http
GET /api/imports/testmo/jobs/{jobId}
```

Response:
```json
{
  "id": "uuid",
  "status": "UPLOADING" | "ANALYZING" | "CONFIGURING" | "IMPORTING" | "COMPLETED" | "FAILED",
  "progress": 75,
  "currentPhase": "Importing projects",
  "error": null,
  "result": {
    "projectsImported": 5,
    "testCasesImported": 150
  }
}
```

#### Get Import Analysis

```http
GET /api/imports/testmo/jobs/{jobId}/analysis
```

Response:
```json
{
  "datasets": [
    {
      "name": "projects",
      "rowCount": 5,
      "sampleData": [...]
    }
  ],
  "summary": {
    "totalProjects": 5,
    "totalTestCases": 150
  }
}
```

#### Get Import Datasets

```http
GET /api/imports/testmo/jobs/{jobId}/datasets
```

#### Get Dataset Details

```http
GET /api/imports/testmo/jobs/{jobId}/datasets/{datasetId}
```

#### Configure Import Mappings

```http
PUT /api/imports/testmo/jobs/{jobId}/configuration
Content-Type: application/json

{
  "mappings": {
    "states": [
      {
        "sourceId": "testmo-state-1",
        "targetId": "testplanit-state-1",
        "action": "MAP" | "CREATE"
      }
    ],
    "users": [
      {
        "sourceEmail": "user@example.com",
        "targetUserId": "uuid",
        "action": "MAP" | "CREATE_PLACEHOLDER"
      }
    ]
  }
}
```

#### Execute Import

```http
POST /api/imports/testmo/jobs/{jobId}/import
```

### LLM Integrations

#### Chat with LLM (AI Assistance)

```http
POST /api/llm/chat
Content-Type: application/json

{
  "projectId": "uuid",
  "messages": [
    {
      "role": "user",
      "content": "Improve this text: [content]"
    }
  ],
  "action": "improve" | "shorten" | "expand" | "fix_grammar" | "change_tone" | "simplify" | "custom"
}
```

Response:
```json
{
  "message": {
    "role": "assistant",
    "content": "Improved text here..."
  },
  "usage": {
    "promptTokens": 50,
    "completionTokens": 75,
    "totalTokens": 125
  }
}
```

#### Generate Test Cases with AI

```http
POST /api/llm/generate-test-cases
Content-Type: application/json

{
  "projectId": "uuid",
  "prompt": "Generate test cases for user login functionality",
  "count": 5,
  "templateId": "uuid"
}
```

Response:
```json
{
  "testCases": [
    {
      "title": "Successful login with valid credentials",
      "description": "Verify user can log in with correct username and password",
      "steps": [
        {
          "action": "Navigate to login page",
          "expected": "Login form is displayed"
        }
      ]
    }
  ]
}
```

#### Test LLM Integration

```http
POST /api/llm/test
Content-Type: application/json

{
  "projectId": "uuid"
}
```

#### Test LLM Credentials (Admin)

```http
POST /api/admin/llm/test-credentials
Content-Type: application/json

{
  "provider": "OPENAI" | "ANTHROPIC" | "AZURE_OPENAI" | "GEMINI" | "OLLAMA" | "CUSTOM_LLM",
  "apiKey": "key",
  "endpoint": "https://...",
  "model": "gpt-4"
}
```

#### Get Available Models (Admin)

```http
GET /api/admin/llm/available-models?provider={provider}&apiKey={apiKey}
```

### Forecasting

#### Update Forecast for Entity

```http
POST /api/forecast/update
Content-Type: application/json

{
  "entityType": "testCase" | "testRun" | "milestone",
  "entityId": "uuid"
}
```

#### Get Test Case Forecast

```http
GET /api/repository-cases/forecast?caseId={caseId}
```

Response:
```json
{
  "estimatedDuration": 300,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "basedOn": {
    "historicalExecutions": 15,
    "averageDuration": 285,
    "lastExecutionDuration": 310
  }
}
```

#### Get Milestone Forecast

```http
GET /api/milestones/{milestoneId}/forecast
```

Response:
```json
{
  "estimatedCompletion": "2024-12-31T00:00:00Z",
  "estimatedDuration": 86400,
  "progress": {
    "completed": 45,
    "total": 100,
    "percentComplete": 45
  },
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "childMilestones": [
    {
      "id": "uuid",
      "name": "Sprint 1",
      "estimatedCompletion": "2024-12-15T00:00:00Z"
    }
  ]
}
```

### Elasticsearch Administration

#### Get Elasticsearch Settings

```http
GET /api/admin/elasticsearch/settings
```

Response:
```json
{
  "enabled": true,
  "node": "http://elasticsearch:9200",
  "indices": [
    {
      "name": "testplanit-repository-cases",
      "documentCount": 1523,
      "sizeInBytes": 5242880
    }
  ]
}
```

#### Trigger Reindex

```http
POST /api/admin/elasticsearch/reindex
Content-Type: application/json

{
  "indices": ["repository-cases", "test-runs", "sessions"] | "all",
  "fresh": false
}
```

Parameters:
- `indices`: Specific indices to reindex or "all" for all indices
- `fresh`: If true, deletes and recreates indices before reindexing

Response:
```json
{
  "jobId": "uuid",
  "status": "QUEUED",
  "message": "Reindex job queued successfully"
}
```

#### Get Reindex Job Status

```http
GET /api/admin/elasticsearch/reindex/{jobId}
```

Response:
```json
{
  "id": "uuid",
  "status": "RUNNING" | "COMPLETED" | "FAILED",
  "progress": 65,
  "processedIndices": ["repository-cases"],
  "currentIndex": "test-runs",
  "documentsIndexed": 1523,
  "errors": []
}
```

### Report Builder

#### Generate Report

```http
POST /api/report-builder
Content-Type: application/json

{
  "reportType": "test-execution" | "repository-stats" | "session-analysis" | "issue-tracking" | "user-engagement" | "project-health",
  "projectId": "uuid",
  "dateRange": {
    "from": "2024-01-01",
    "to": "2024-12-31"
  },
  "filters": {
    "milestoneId": "uuid",
    "assignedTo": "user-uuid"
  }
}
```

#### Test Execution Report

```http
POST /api/report-builder/test-execution
Content-Type: application/json

{
  "projectId": "uuid",
  "dateRange": {
    "from": "2024-01-01",
    "to": "2024-12-31"
  }
}
```

Response:
```json
{
  "summary": {
    "totalRuns": 45,
    "totalCases": 523,
    "passRate": 94.5,
    "avgDuration": 3600
  },
  "trends": [
    {
      "date": "2024-01-01",
      "passed": 45,
      "failed": 3,
      "blocked": 1
    }
  ],
  "topFailures": [
    {
      "testCase": "Login Test",
      "failureCount": 5,
      "lastFailed": "2024-01-15T00:00:00Z"
    }
  ]
}
```

#### Cross-Project Reports

```http
POST /api/report-builder/cross-project-test-execution
POST /api/report-builder/cross-project-repository-stats
POST /api/report-builder/cross-project-issue-tracking
POST /api/report-builder/cross-project-user-engagement
```

All accept similar parameters with array of `projectIds` instead of single `projectId`.

### Admin Queue Management

#### Get All Queues

```http
GET /api/admin/queues
```

Response:
```json
{
  "queues": [
    {
      "name": "notifications",
      "jobCounts": {
        "active": 2,
        "waiting": 15,
        "completed": 1523,
        "failed": 3
      }
    }
  ]
}
```

#### Get Queue Details

```http
GET /api/admin/queues/{queueName}
```

#### Get Queue Jobs

```http
GET /api/admin/queues/{queueName}/jobs?status=active&limit=50&offset=0
```

Query Parameters:
- `status`: `active`, `waiting`, `completed`, `failed`, `delayed`
- `limit`: Number of jobs to return
- `offset`: Pagination offset

#### Get Job Details

```http
GET /api/admin/queues/{queueName}/jobs/{jobId}
```

#### Retry Failed Job

```http
POST /api/admin/queues/{queueName}/jobs/{jobId}/retry
```

#### Delete Job

```http
DELETE /api/admin/queues/{queueName}/jobs/{jobId}
```

## Specialized Endpoints

### File Upload

#### Get Upload URL

```http
POST /api/get-attachment-url
Content-Type: application/json

{
  "fileName": "screenshot.png",
  "fileSize": 1024000,
  "contentType": "image/png"
}
```

Response:

```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket/signed-url",
  "fileKey": "attachments/uuid/screenshot.png",
  "expires": "2024-01-01T01:00:00Z"
}
```

### Search

#### Global Search

```http
GET /api/search?q={query}&type={entityType}&project={projectId}
```

#### Advanced Search

```http
POST /api/search
Content-Type: application/json

{
  "query": "authentication test",
  "filters": {
    "type": ["repository_cases", "sessions"],
    "projectId": "uuid",
    "tags": ["authentication"],
    "dateRange": {
      "field": "createdAt",
      "from": "2024-01-01",
      "to": "2024-12-31"
    }
  },
  "sort": [
    { "_score": { "order": "desc" } }
  ],
  "limit": 25,
  "offset": 0
}
```

### Import/Export

#### CSV Import

```http
POST /api/repository/import
Content-Type: multipart/form-data

file: [CSV file]
options: {
  "projectId": "uuid",
  "folderId": "uuid",
  "templateId": "uuid",
  "mergeTags": true
}
```

#### JUnit Import

```http
POST /api/junit/import
Content-Type: multipart/form-data

file: [JUnit XML file]
testRunId: "uuid"
createTestCases: true
```

#### Export Data

```http
GET /api/repository/export?projectId={projectId}&format=csv&folderId={folderId}
```

## Data Models

### Common Fields

All entities include these standard fields:

```typescript
interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  deleted?: boolean;
}
```

### Project Model

```typescript
interface Project extends BaseEntity {
  name: string;
  description?: string;
  settings: {
    allowPublicAccess: boolean;
    requireApproval: boolean;
  };
  icon?: string;
  color?: string;
}
```

### Test Case Model

```typescript
interface RepositoryCase extends BaseEntity {
  projectId: string;
  folderId?: string;
  title: string;
  description?: string;
  steps: Step[];
  expectedResult?: string;
  tags: string[];
  automationStatus: 'MANUAL' | 'AUTOMATED' | 'SEMI_AUTOMATED';
  estimate?: number; // in seconds
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  templateId?: string;
  customFields?: CustomFieldValue[];
}

interface Step {
  id: string;
  action: string;
  expected?: string;
  order: number;
  attachments?: Attachment[];
}
```

### Test Run Model

```typescript
interface TestRun extends BaseEntity {
  projectId: string;
  name: string;
  description?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  milestoneId?: string;
  configurationId?: string;
  testCases: TestRunCase[];
  results?: TestRunResult[];
}

interface TestRunCase {
  id: string;
  repositoryCaseId: string;
  assignedTo?: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
  executedAt?: string;
  duration?: number;
}
```

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "field": "title",
      "message": "Title is required"
    }
  }
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 422 | Invalid input data |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

API requests are rate-limited to ensure system stability:

- **Authenticated Users**: 1000 requests per hour
- **Anonymous Users**: 100 requests per hour
- **Burst Limit**: 50 requests per minute

Rate limit headers are included in responses:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Webhooks

### Webhook Events

TestPlanIt can send webhook notifications for:

- `test_case.created`
- `test_case.updated`
- `test_run.completed`
- `session.completed`
- `issue.created`
- `milestone.completed`

### Webhook Configuration

```http
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": ["test_run.completed", "session.completed"],
  "secret": "webhook-secret-key",
  "active": true
}
```

### Webhook Payload

```json
{
  "event": "test_run.completed",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "id": "test-run-uuid",
    "projectId": "project-uuid",
    "name": "Test Run Name",
    "status": "COMPLETED",
    "results": {
      "passed": 45,
      "failed": 3,
      "blocked": 1,
      "skipped": 0
    }
  }
}
```

## Usage Examples

### JavaScript/TypeScript

```typescript
// Browser-based usage with session authentication
const response = await fetch('/api/projects', {
  method: 'GET',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
});

const projects = await response.json();

// Create test case
const testCase = await fetch('/api/repository-cases', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    projectId: 'uuid',
    title: 'Login Test',
    description: 'Test user login functionality',
    steps: [
      {
        action: 'Navigate to login page',
        expected: 'Login form displays'
      }
    ]
  })
});
```

### Python

```python
import requests
from typing import Dict, Any

# Example using session-based authentication
session = requests.Session()

# First authenticate (login process)
# Then use session for subsequent requests

def get_projects(session) -> Dict[str, Any]:
    response = session.get('https://your-domain.com/api/projects')
    return response.json()

def create_test_case(session, data: Dict[str, Any]) -> Dict[str, Any]:
    response = session.post(
        'https://your-domain.com/api/repository-cases',
        json=data
    )
    return response.json()

# Usage requires authenticated session
projects = get_projects(session)
```

## Best Practices

### API Usage

1. **Authentication**: Always include proper authentication headers
2. **Rate Limiting**: Respect rate limits and implement backoff strategies
3. **Error Handling**: Handle all error responses appropriately
4. **Pagination**: Use pagination for large datasets
5. **Filtering**: Use query parameters to filter results

### Performance

1. **Caching**: Cache responses when appropriate
2. **Batch Operations**: Use bulk endpoints when available
3. **Selective Fields**: Request only needed fields
4. **Connection Pooling**: Reuse HTTP connections
5. **Compression**: Enable gzip compression

### Security

1. **HTTPS Only**: Always use HTTPS for API requests
2. **Token Security**: Securely store and transmit tokens
3. **Input Validation**: Validate all input data
4. **Permission Checks**: Verify user permissions
5. **Audit Logging**: Log API access for security

## Support and Resources

### Documentation

- **Interactive API Explorer**: Available at `/api/docs`
- **OpenAPI Specification**: Available at `/api/openapi.json`
- **Postman Collection**: Download from documentation site

### Community

- **GitHub Issues**: Report bugs and feature requests
- **Discord Community**: Join for discussions and support
- **Stack Overflow**: Tag questions with `testplanit`

### Enterprise Support

- **Priority Support**: Available for enterprise customers
- **Custom Integrations**: Professional services available
- **Training**: API training sessions available