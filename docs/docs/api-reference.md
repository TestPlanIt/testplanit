---
sidebar_position: 12
title: API Reference
---

# API Reference

TestPlanIt provides a comprehensive RESTful API for programmatic access to all test management functionality. The API uses ZenStack-generated endpoints with built-in type safety, authentication, and row-level security.

## Interactive API Documentation

TestPlanIt includes interactive Swagger UI documentation for exploring and testing the API:

**Access the API documentation at:** `/docs/api` in your TestPlanIt instance

The interactive documentation is organized into categories:

| Category | Description |
|----------|-------------|
| **Custom API Endpoints** | Authentication, file uploads, JUnit imports, search, and admin endpoints |
| **Projects & Folders** | Project and folder management |
| **Test Cases & Repository** | Test case management, steps, templates, and custom fields |
| **Test Runs & Execution** | Test run management, sessions, and execution tracking |
| **Planning & Organization** | Milestones, configurations, tags, workflows, and statuses |
| **Users & Accounts** | User management, roles, groups, and account settings |
| **Integrations & SSO** | External integrations, SSO, and AI/LLM features |
| **Attachments & Other** | File attachments, comments, and imports |

## Overview

The API provides:

- **RESTful endpoints** for all entities and operations
- **Type-safe requests** with automatic validation
- **Row-level security** based on user permissions
- **Authentication** via NextAuth.js sessions
- **Rate limiting** and security measures
- **OpenAPI 3.0 specification** for documentation and client generation

## OpenAPI Specification

The OpenAPI specification is available programmatically:

```bash
# Get list of API categories
curl https://your-domain.com/api/docs

# Get OpenAPI spec for a specific category
curl https://your-domain.com/api/docs?category=custom
curl https://your-domain.com/api/docs?category=projects
curl https://your-domain.com/api/docs?category=testCases
curl https://your-domain.com/api/docs?category=testRuns
curl https://your-domain.com/api/docs?category=planning
curl https://your-domain.com/api/docs?category=users
curl https://your-domain.com/api/docs?category=integrations
curl https://your-domain.com/api/docs?category=other
```

You can use these specifications to:

- Generate API clients in any language
- Import into tools like Postman or Insomnia
- Build custom integrations

## Authentication

### Session-Based Authentication

TestPlanIt uses NextAuth.js for session management. All API requests require a valid session cookie.

#### Browser-Based Requests

For requests from the browser, authentication is handled automatically:

```javascript
// Fetch with automatic session handling
const response = await fetch('/api/model/project/findMany', {
  method: 'GET',
  credentials: 'include' // Include session cookies
});
```

#### Server-Side Requests

For server-side integrations, authentication is handled through session cookies. External integrations should use the standard session-based authentication flow.

```javascript
// Server-side requests use session cookies
const response = await fetch('/api/model/project/findMany', {
  headers: {
    'Content-Type': 'application/json'
  },
  credentials: 'include'
});
```

### Authentication Limitations

Currently, TestPlanIt uses session-based authentication only. API key authentication for server-to-server integration is not implemented but may be added in future releases.

## Base URL and Endpoints

**Base URL:** `https://your-domain.com/api`

### ZenStack Model Endpoints

ZenStack generates RESTful endpoints for all data models:

```text
/api/model/{entity}/findMany     - List entities with filtering
/api/model/{entity}/findUnique   - Get single entity by ID
/api/model/{entity}/create       - Create new entity
/api/model/{entity}/update       - Update existing entity
/api/model/{entity}/delete       - Delete entity
/api/model/{entity}/count        - Count entities
/api/model/{entity}/aggregate    - Aggregate operations
```

### Custom Endpoints

Additional endpoints for specialized operations:

```text
/api/junit/import          - Import JUnit XML test results
/api/search                - Full-text search
/api/files/upload          - File uploads
/api/admin/*               - Administrative operations
```

## Common Operations

### Querying Data

All ZenStack endpoints support Prisma-style query parameters:

```javascript
// Find all projects with filtering and includes
const response = await fetch('/api/model/project/findMany', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    where: {
      name: { contains: 'Test' }
    },
    include: {
      folders: true,
      assignments: {
        include: { user: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    skip: 0
  })
});
```

### Creating Records

```javascript
// Create a new test case
const response = await fetch('/api/model/repositoryCase/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    data: {
      title: 'Login Test',
      description: 'Verify user can log in',
      project: { connect: { id: projectId } },
      folder: { connect: { id: folderId } }
    }
  })
});
```

### Updating Records

```javascript
// Update a test case
const response = await fetch('/api/model/repositoryCase/update', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    where: { id: caseId },
    data: {
      title: 'Updated Title',
      description: 'Updated description'
    }
  })
});
```

### Deleting Records

```javascript
// Delete a test case
const response = await fetch('/api/model/repositoryCase/delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    where: { id: caseId }
  })
});
```

## JUnit Import API

Import JUnit XML test results to create test runs with test cases:

```bash
curl -X POST "https://your-domain/api/junit/import" \
  -H "Cookie: your-auth-cookie" \
  -F "name=My Test Run" \
  -F "projectId=1" \
  -F "files=@/path/to/junit-results.xml" \
  -F "stateId=5" \
  -F "parentFolderId=10" \
  -F "configId=2" \
  -F "milestoneId=3" \
  -F "tagIds=1" \
  -F "tagIds=2"
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Name for the test run |
| `projectId` | Yes | Project ID |
| `files` | Yes | One or more JUnit XML files |
| `stateId` | No | Workflow state ID for the test run |
| `parentFolderId` | No | Folder ID for storing test cases |
| `testRunId` | No | Existing test run ID to append results to |
| `configId` | No | Configuration ID |
| `milestoneId` | No | Milestone ID |
| `tagIds` | No | Tag IDs (repeat for multiple) |

**Response:**

The API returns a Server-Sent Events (SSE) stream with progress updates:

```text
data: {"progress": 10, "status": "Validating input..."}
data: {"progress": 50, "status": "Processing test case 25 of 50..."}
data: {"progress": 100, "status": "Import completed!"}
data: {"complete": true, "testRunId": 456}
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 500 | Internal Server Error |

## Rate Limiting

API requests may be subject to rate limiting. When rate limited, you'll receive a 429 status code with a `Retry-After` header indicating when to retry.

## Further Resources

- **Interactive Documentation:** Access `/docs/api` in your TestPlanIt instance
- **OpenAPI Spec:** Available at `/api/docs?category={category}`
- **ZenStack Documentation:** [zenstack.dev](https://zenstack.dev/docs)
