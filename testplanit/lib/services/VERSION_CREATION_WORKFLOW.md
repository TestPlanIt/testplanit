# Test Case Version Creation Workflow

This document describes the correct workflow for creating test case versions using the centralized API endpoint.

## Key Principle

**The version number in `RepositoryCaseVersions.version` must ALWAYS match `RepositoryCases.currentVersion`.**

When you create a version, you're creating a snapshot of the test case at that specific version number.

## Data Model

```text
RepositoryCases
├── id: 123
├── name: "Updated Test Name"
├── currentVersion: 2
└── ... other fields

RepositoryCaseVersions
├── version: 1, name: "Original Test Name", ... (snapshot of version 1)
└── version: 2, name: "Updated Test Name", ... (snapshot of version 2)
```

## Correct Workflow

### Scenario 1: Creating a NEW test case

```typescript
// Step 1: Create the test case (currentVersion defaults to 1)
const newCase = await prisma.repositoryCases.create({
  data: {
    name: "My Test Case",
    // ... other fields
    // currentVersion: 1 (default from schema)
  }
});

// Step 2: Create version 1 snapshot (matches currentVersion = 1)
const response = await fetch(`/api/repository/cases/${newCase.id}/versions`, {
  method: 'POST',
  body: JSON.stringify({
    // No version specified - will use currentVersion (1)
    overrides: {
      // Any fields that differ from what's in the test case
      // For new cases, typically no overrides needed
    }
  })
});
```

### Scenario 2: Editing an EXISTING test case

```typescript
// Step 1: Update the test case AND increment currentVersion
await prisma.repositoryCases.update({
  where: { id: caseId },
  data: {
    name: "Updated Test Name",
    currentVersion: testCase.currentVersion + 1, // 1 → 2
    // ... other fields
  }
});

// Step 2: Create version snapshot (matches new currentVersion = 2)
const response = await fetch(`/api/repository/cases/${caseId}/versions`, {
  method: 'POST',
  body: JSON.stringify({
    // No version specified - will use currentVersion (2)
    overrides: {
      // Any fields that differ from what's in the test case
      // Typically you'd override steps, tags, issues, attachments
    }
  })
});
```

### Scenario 3: Bulk editing multiple test cases

```typescript
await prisma.$transaction(async (tx) => {
  for (const caseId of caseIds) {
    // Step 1: Update the test case AND increment currentVersion
    await tx.repositoryCases.update({
      where: { id: caseId },
      data: {
        name: newName,
        currentVersion: { increment: 1 }, // Atomic increment
        // ... other fields
      }
    });

    // Step 2: Create version snapshot using helper function
    await createTestCaseVersionInTransaction(tx, caseId, {
      overrides: {
        name: newName,
        // ... other overrides
      }
    });
  }
});
```

### Scenario 4: Importing test cases with specific version numbers

```typescript
// For imports, you may want to preserve version numbers from the source system
await prisma.repositoryCases.create({
  data: {
    name: "Imported Test",
    currentVersion: 5, // Set to match imported version
    // ... other fields
  }
});

// Create version with explicit version number
const response = await fetch(`/api/repository/cases/${newCase.id}/versions`, {
  method: 'POST',
  body: JSON.stringify({
    version: 5, // Explicit version to match import data
    creatorId: importedCreatorId, // Preserve original creator
    createdAt: importedDate, // Preserve original date
    overrides: {
      // ... imported data
    }
  })
});
```

## API Endpoint Reference

### POST `/api/repository/cases/[caseId]/versions`

Creates a version snapshot of a test case.

**Request Body:**
```typescript
{
  // Optional: explicit version number (for imports)
  // If not provided, uses testCase.currentVersion
  version?: number;

  // Optional: override creator metadata (for imports)
  creatorId?: string;
  creatorName?: string;
  createdAt?: string; // ISO date string

  // Optional: data to override in the version
  // If not provided, copies from current test case
  overrides?: {
    name?: string;
    stateId?: number;
    stateName?: string;
    automated?: boolean;
    estimate?: number | null;
    forecastManual?: number | null;
    forecastAutomated?: number | null;
    steps?: any; // JSON field
    tags?: string[]; // Array of tag names
    issues?: Array<{
      id: number;
      name: string;
      externalId?: string;
    }>;
    attachments?: any; // JSON field
    links?: any; // JSON field
    isArchived?: boolean;
    order?: number;
  };
}
```

**Response:**
```typescript
{
  success: true;
  version: RepositoryCaseVersions; // The created version
}
```

## Helper Functions

### `createTestCaseVersionInTransaction(tx, caseId, options)`

Use this helper when you're already in a Prisma transaction context (e.g., bulk operations, workers).

```typescript
import { createTestCaseVersionInTransaction } from '~/lib/services/testCaseVersionService';

await prisma.$transaction(async (tx) => {
  // Update the test case first
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: {
      name: "New Name",
      currentVersion: { increment: 1 },
    }
  });

  // Then create the version snapshot
  await createTestCaseVersionInTransaction(tx, caseId, {
    overrides: {
      name: "New Name",
      // ... other overrides
    }
  });
});
```

## Common Mistakes

### ❌ WRONG: Creating version before updating currentVersion

```typescript
// This will create version 1, but currentVersion is still 1
await createVersion(caseId, { overrides: { name: "New Name" } });
await prisma.repositoryCases.update({
  where: { id: caseId },
  data: { currentVersion: 2 }
});
```

### ❌ WRONG: Not incrementing currentVersion when editing

```typescript
// Only updates the case, doesn't create a version
await prisma.repositoryCases.update({
  where: { id: caseId },
  data: { name: "New Name" }
  // Missing: currentVersion: { increment: 1 }
});
```

### ✅ CORRECT: Update currentVersion, then create version

```typescript
await prisma.repositoryCases.update({
  where: { id: caseId },
  data: {
    name: "New Name",
    currentVersion: { increment: 1 },
  }
});

await createVersion(caseId, {
  overrides: { name: "New Name" }
});
```

## Migration Checklist

When migrating existing code to use this centralized endpoint:

1. ✅ Ensure `currentVersion` is updated BEFORE calling the version endpoint
2. ✅ Remove manual version calculation logic (endpoint handles it)
3. ✅ Pass data via `overrides` instead of constructing the full version object
4. ✅ For new cases, don't specify `version` (defaults to 1)
5. ✅ For edits, ensure `currentVersion` is incremented
6. ✅ Use `createTestCaseVersionInTransaction` for transaction contexts
