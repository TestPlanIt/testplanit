---
phase: 22-custom-api-route-tests
plan: 05
subsystem: testing
tags: [vitest, aws-s3, s3-presigned-url, health-check, openapi, metadata, vi.hoisted]

# Dependency graph
requires: []
provides:
  - Upload route unit tests (upload-attachment, upload-avatar, upload-docimage, upload-project-icon)
  - Get presigned URL route unit tests (get-attachment-url, get-avatar-url)
  - Health check route unit tests with service state scenarios
  - Metadata route unit tests for all entity types
  - OpenAPI docs route unit tests
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted() for stable constructor mock refs when S3Client used as new S3Client() in handler"
    - "Function constructor syntax vi.fn(function(this: any){}) for class mocks that use new"
    - "mockPutObjectCommand spy pattern to capture PutObjectCommand params without dynamic import"

key-files:
  created:
    - testplanit/app/api/upload-attachment/route.test.ts
    - testplanit/app/api/upload-avatar/route.test.ts
    - testplanit/app/api/upload-docimage/route.test.ts
    - testplanit/app/api/upload-project-icon/route.test.ts
    - testplanit/app/api/get-attachment-url/route.test.ts
    - testplanit/app/api/get-avatar-url/route.test.ts
    - testplanit/app/api/health/route.test.ts
    - testplanit/app/api/metadata/route.test.ts
    - testplanit/app/api/docs/route.test.ts
  modified: []

key-decisions:
  - "vi.fn(function(this: any){...}) required for class mocks — arrow functions cannot be used as constructors with new keyword"
  - "vi.hoisted() required for mockSend/mockGetSignedUrl refs used inside vi.mock() factory closures"
  - "mockPutObjectCommand hoisted spy captures constructor params without needing dynamic import() in test body"
  - "get-attachment-url and get-avatar-url both generate presigned PUT URLs (not GET) — they use PutObjectCommand with getSignedUrl from s3-request-presigner"

patterns-established:
  - "S3Client class mock pattern: vi.hoisted for send fn + vi.fn(function(this:any){this.send=mockSend}) factory"
  - "Health route test: mock each service check dependency independently, test all status transitions"

requirements-completed: [CAPI-09, CAPI-10]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 22 Plan 05: File Upload/Download and Infrastructure Endpoint Route Tests Summary

**9 Vitest route test files covering S3 upload/presigned-URL endpoints (CAPI-09) and health/metadata/docs public endpoints (CAPI-10) with 68 total passing tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T18:40:52Z
- **Completed:** 2026-03-19T18:45:53Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- 6 file-handling route tests (4 upload routes + 2 get-presigned-URL routes) with S3 mock via vi.hoisted constructor pattern
- Health route tests covering healthy/degraded/unhealthy states, disabled services, CORS headers, and OPTIONS handler
- Metadata route tests for all 5 entity types (test-run, test-case, session, project, milestone) plus validation and fallback behavior
- Docs route tests for category listing, specific spec retrieval, invalid category 400, default behavior, and error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: File upload and download endpoint route tests (CAPI-09)** - `2c354a2b` (feat)
2. **Task 2: Health, metadata, and docs endpoint route tests (CAPI-10)** - `4a6edb46` (feat)

## Files Created/Modified
- `testplanit/app/api/upload-attachment/route.test.ts` - Primary upload test with S3 mock, validation, key prefix, prependString, S3 error handling
- `testplanit/app/api/upload-avatar/route.test.ts` - Avatar upload tests with uploads/avatars/ prefix
- `testplanit/app/api/upload-docimage/route.test.ts` - Doc image upload tests with uploads/docimages/ prefix
- `testplanit/app/api/upload-project-icon/route.test.ts` - Project icon upload tests with uploads/project-icons/ prefix
- `testplanit/app/api/get-attachment-url/route.test.ts` - Presigned PUT URL tests for attachments
- `testplanit/app/api/get-avatar-url/route.test.ts` - Presigned PUT URL tests for avatars
- `testplanit/app/api/health/route.test.ts` - Health check tests: all service states, CORS, OPTIONS
- `testplanit/app/api/metadata/route.test.ts` - OG metadata tests for all entity types
- `testplanit/app/api/docs/route.test.ts` - OpenAPI docs route tests

## Decisions Made
- Used `vi.fn(function(this: any){})` constructor syntax for S3Client mocks — arrow function mocks cannot be instantiated with `new`, causing "not a constructor" error
- Used `vi.hoisted()` for mock function refs referenced inside `vi.mock()` factory closures to avoid hoisting errors
- Used a `mockPutObjectCommand` hoisted spy to capture PutObjectCommand constructor params rather than dynamic `import()` inside test body
- Noted that get-attachment-url and get-avatar-url generate presigned PUT URLs for client-side direct upload, not GET URLs for reading — they use PutObjectCommand + getSignedUrl from @aws-sdk/s3-request-presigner

## Deviations from Plan

None - plan executed exactly as written. The vi.hoisted() pattern for S3Client constructor mocks was a standard fix applied during test authoring, not a deviation.

## Issues Encountered
- Initial S3Client mock used arrow function which cannot be used as constructor with `new` — fixed immediately by switching to function constructor syntax with vi.hoisted() refs
- Standard Vitest mock hoisting requirement for refs used in vi.mock() factory closures

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 9 route test files pass (68 tests total)
- CAPI-09 and CAPI-10 requirements covered
- Phase 22 custom API route tests plan 05 complete
