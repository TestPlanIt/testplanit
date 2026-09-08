---
"@testplanit/api": patch
"@testplanit/wdio-reporter": patch
"@testplanit/playwright-reporter": patch
---

Stop losing test results when parallel workers race to create the same folder. The API client now recognizes a unique-constraint violation in every form the server reports it (Postgres SQLSTATE 23505 and message, Prisma message, P2002 code) and recovers by fetching the folder the other worker created. Folder creation is also memoized per `projectId` + `parentId` + `name` within a client instance, so concurrent describe paths that share an ancestor issue a single create instead of racing. And if folder resolution still fails, both reporters now file the case under the configured parent folder instead of dropping the result.
