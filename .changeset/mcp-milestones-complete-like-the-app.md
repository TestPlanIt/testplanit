---
"@testplanit/mcp-server": patch
---

`milestones_update` completes a milestone the way the app does

Completing used to overwrite the planned due date with the current time and
touch nothing else. It now goes through the app's completion: the due date
(or a given `completedAt`) becomes the completion date, child milestones
complete with it, and its active runs and sessions complete only with the
new `completeTestRuns` / `completeSessions` flags, subject to the caller's
close permissions and the review gate. `startedAt` and `completedAt` are
accepted on create and update as calendar days, starting keeps a planned
start date, reopening is refused while the parent milestone is completed,
and a parent in another project or a cycle is refused server-side.
Milestones synced from an external tracker refuse changes to their
tracker-owned fields instead of failing the whole update.
