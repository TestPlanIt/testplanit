# Phase 4: Entry Point Integrations - Research

**Researched:** 2026-03-07
**Domain:** React UI integration -- wiring existing auto-tag components into four list views
**Confidence:** HIGH

## Summary

Phase 4 is purely frontend integration work. All backend APIs (submit, poll, cancel, apply) and all UI components (useAutoTagJob, AutoTagProgress, AutoTagReviewDialog) are already built and tested in Phases 1-3. The work is wiring these into four pages: cases list bulk actions, test runs page header, sessions page header, and the tags management page.

The integration points are well-understood. Cases.tsx has existing bulk action selection infrastructure (`selectedCaseIdsForBulkEdit`). Test runs and sessions pages use `useFindManyTestRuns`/`useFindManySessions` hooks that provide the entity data from which IDs can be extracted. The tags page is global (not project-scoped) and needs an entity type + project picker before submitting.

**Primary recommendation:** Implement each entry point as an independent task, reusing the exact same hook + component composition pattern: `useAutoTagJob()` instance -> submit trigger -> `AutoTagProgress` banner -> `AutoTagReviewDialog`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cases list: AI Tag button as a dropdown menu entry (not standalone), keeping Bulk Edit and Create Test Run as standalone buttons
- Same `canAddEdit` permission gates AI tagging (no new permission)
- AutoTagProgress banner appears above DataTable, below filter/pagination bar
- Selection uses existing `selectedCaseIdsForBulkEdit` state
- Test runs & sessions: No row selection -- use page-level "Tag All" button
- "Tag All" submits all filtered/visible entities (respects active search/filters)
- "Tag All" button appears in header action area, next to existing page-level actions
- Tags page: "AI Auto-Tag" button in page header
- Tags page: Clicking opens popover/dialog to pick entity type and project
- Tags page: Project auto-detected from tag's project associations
- Tags page: Submits all entities of chosen type in selected project
- Each page owns its own `useAutoTagJob` hook instance (no global provider/context)
- Job persistence via localStorage: store jobId keyed by `entityType+projectId`
- Hook checks localStorage on mount and resumes polling if active job found

### Claude's Discretion
- Dropdown component choice and styling for the cases bulk action
- Exact layout of the entity type + project picker on the tags page
- How to fetch filtered entity IDs for "Tag All" on runs/sessions pages
- Loading/disabled states while job is submitting

### Deferred Ideas (OUT OF SCOPE)
- Row selection for test runs and sessions lists
- Per-tag "Auto-tag more entities" action on the tags management page
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EP-01 | User can trigger AI tagging from bulk action menu on cases list | Cases.tsx line ~3205 has bulk action bar with `selectedCaseIdsForBulkEdit`; use DropdownMenu from shadcn; add AI Tag option inside dropdown |
| EP-02 | User can trigger AI tagging from bulk action menu on test runs list | Test runs page header (line ~1022) has `canAddEdit` gated button area; extract IDs from `incompleteTestRuns`/`completedTestRuns` based on active tab |
| EP-03 | User can trigger AI tagging from bulk action menu on sessions list | Sessions page header (line ~706) has similar pattern; extract IDs from `incompleteSessions`/`allCompletedSessions` based on active tab and filter |
| EP-04 | User can trigger AI tagging from tags management page with entity type selection | Tags page (line ~384) CardHeader; add Popover with entity type select + project picker; fetch project list from `tagProjects` state |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `useAutoTagJob` | custom | Job lifecycle management | Built in Phase 3, handles submit/poll/cancel/apply |
| `AutoTagProgress` | custom | Inline progress banner | Built in Phase 3, i18n-ready |
| `AutoTagReviewDialog` | custom | Review/apply dialog | Built in Phase 3, full review flow |
| shadcn `DropdownMenu` | Radix-based | Cases bulk action dropdown | Already used in test runs page |
| shadcn `Popover` | Radix-based | Tags page entity/project picker | Already in project |
| shadcn `Select` | Radix-based | Entity type selector in popover | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | existing | Icons (Sparkles for AI Tag) | Button icons |
| `next-intl` | existing | i18n translations | All display strings |
| `sonner` | existing | Toast notifications | Error/success feedback |

**Installation:** No new packages needed. Everything is already in the project.

## Architecture Patterns

### Recommended Integration Pattern (same for all 4 entry points)

```typescript
// 1. Instantiate hook
const autoTag = useAutoTagJob();
const [showReviewDialog, setShowReviewDialog] = useState(false);

// 2. Trigger (varies per page)
const handleAutoTag = () => {
  autoTag.submit(entityIds, entityType, projectId);
};

// 3. Progress banner (above DataTable)
<AutoTagProgress
  status={autoTag.status}
  progress={autoTag.progress}
  error={autoTag.error}
  onReview={() => setShowReviewDialog(true)}
  onCancel={autoTag.cancel}
/>

// 4. Review dialog (at component bottom)
<AutoTagReviewDialog
  open={showReviewDialog}
  onOpenChange={setShowReviewDialog}
  job={autoTag}
/>
```

### Cases List: Dropdown in Bulk Actions Bar
```typescript
// Inside the flex gap-2 bar at Cases.tsx line ~3205
// Add a DropdownMenu ONLY when selectedCaseIdsForBulkEdit.length > 0 && canAddEdit
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">
      <Tags className="w-4 h-4" />
      {t("repository.cases.tagActions")}
      <ChevronDown className="w-3 h-3 ml-1" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={handleAutoTag}>
      <Sparkles className="w-4 h-4 mr-2" />
      {t("autoTag.actions.aiTag")}
      <span>({selectedCaseIdsForBulkEdit.length})</span>
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Test Runs / Sessions: "Tag All" Button in Header
```typescript
// In the header action area div, next to "Add Test Run" / "Add Session"
{canAddEdit && (
  <Button
    variant="outline"
    onClick={handleAutoTag}
    disabled={autoTag.isSubmitting || visibleEntityIds.length === 0}
  >
    <Sparkles className="h-4 w-4" />
    {t("autoTag.actions.tagAll")}
  </Button>
)}
```

### Extracting Filtered Entity IDs for "Tag All"
```typescript
// Test Runs: depends on activeTab
const visibleRunIds = useMemo(() => {
  if (activeTab === "active") {
    return (incompleteTestRuns || []).map(r => r.id);
  } else {
    return (completedTestRuns || []).map(r => r.id);
  }
}, [activeTab, incompleteTestRuns, completedTestRuns]);

// Sessions: same pattern
const visibleSessionIds = useMemo(() => {
  if (activeTab === "active") {
    return (incompleteSessions || []).map(s => s.id);
  } else {
    // Use filteredData (client-side filtered completed sessions)
    return filteredData.map(s => s.id);
  }
}, [activeTab, incompleteSessions, filteredData]);
```

### Tags Page: Popover with Entity Type + Project Picker
```typescript
// The tags page already fetches tagProjects per tag, but for the "AI Auto-Tag"
// we need all projects the user has access to. Two approaches:
// 1. Use existing tagProjects state (already fetched) - shows only projects that have tags
// 2. Fetch all user projects via useFindManyProjects - shows all projects
// Recommendation: Use approach 2 (useFindManyProjects) since the user may want
// to tag entities in projects that don't have tags yet.

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">
      <Sparkles className="h-4 w-4" />
      {t("autoTag.actions.aiAutoTag")}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-80">
    {/* Entity type select */}
    <Select value={entityType} onValueChange={setEntityType}>
      <SelectItem value="repositoryCase">{t("common.fields.testCases")}</SelectItem>
      <SelectItem value="testRun">{t("common.fields.testRuns")}</SelectItem>
      <SelectItem value="session">{t("common.fields.sessions")}</SelectItem>
    </Select>
    {/* Project select */}
    <Select value={projectId} onValueChange={setProjectId}>
      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
    </Select>
    <Button onClick={handleSubmit}>
      {t("autoTag.actions.startTagging")}
    </Button>
  </PopoverContent>
</Popover>
```

### localStorage Persistence Pattern
```typescript
// Key format: `autoTagJob:${entityType}:${projectId}`
const STORAGE_KEY_PREFIX = "autoTagJob";

function getStorageKey(entityType: EntityType, projectId: number): string {
  return `${STORAGE_KEY_PREFIX}:${entityType}:${projectId}`;
}

// On submit success, store jobId
localStorage.setItem(getStorageKey(entityType, projectId), jobId);

// On mount, check for active job and resume polling
useEffect(() => {
  const stored = localStorage.getItem(getStorageKey(entityType, projectId));
  if (stored) {
    // Resume polling by setting jobId and status
    setJobId(stored);
    setStatus("active");
  }
}, [entityType, projectId]);

// On completion/failure/cancel, remove from storage
localStorage.removeItem(getStorageKey(entityType, projectId));
```

### Anti-Patterns to Avoid
- **Global auto-tag context/provider:** User explicitly decided each page owns its own hook instance
- **Adding row selection to runs/sessions:** Deferred -- use "Tag All" button instead
- **New permission for AI tagging:** Reuse existing `canAddEdit` permission
- **Fetching entity IDs separately for "Tag All":** Extract from already-fetched data in useFindMany hooks

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job lifecycle | Custom state machine | `useAutoTagJob()` hook | Already built and tested |
| Progress UI | Custom progress component | `AutoTagProgress` | Already built with i18n |
| Review flow | Custom review dialog | `AutoTagReviewDialog` | Already built with opt-out model |
| Dropdown menu | Custom dropdown | shadcn `DropdownMenu` | Already in project, Radix-based |
| Entity/project picker | Custom form | shadcn `Popover` + `Select` | Standard UI primitives |

**Key insight:** This phase adds zero new backend logic and zero new UI components. It purely composes existing pieces into existing pages.

## Common Pitfalls

### Pitfall 1: localStorage SSR Crash
**What goes wrong:** Accessing `localStorage` during server-side rendering causes `ReferenceError`
**Why it happens:** Next.js renders components on server where `window` is undefined
**How to avoid:** Guard with `typeof window !== "undefined"` or use inside `useEffect` only
**Warning signs:** Hydration errors, "window is not defined" errors

### Pitfall 2: Stale Entity IDs on "Tag All"
**What goes wrong:** User filters list, clicks "Tag All", but IDs come from previous render
**Why it happens:** useMemo dependency not including filter/search state
**How to avoid:** Ensure `visibleEntityIds` memo depends on all filter states (search string, tab, run type filter)
**Warning signs:** Tagged entities don't match what user sees on screen

### Pitfall 3: Test Runs Completed Tab Uses Custom API
**What goes wrong:** Trying to extract IDs from `useFindManyTestRuns` for completed runs
**Why it happens:** Completed test runs on the runs page use a custom `useQuery` to `/api/test-runs/completed`, not the standard `useFindManyTestRuns` hook
**How to avoid:** For active tab use `incompleteTestRuns` (from `useFindManyTestRuns`), for completed tab use `completedTestRuns` (from custom `useQuery`)
**Warning signs:** Empty entity list when clicking Tag All on completed tab

### Pitfall 4: Tags Page Has No Project Context
**What goes wrong:** Calling `autoTag.submit(ids, entityType, projectId)` without a projectId
**Why it happens:** Tags page is global -- no `projectId` in URL params
**How to avoid:** User must select a project in the popover before submitting; disable submit button until project is selected
**Warning signs:** 400 error from submit API

### Pitfall 5: Multiple Concurrent Jobs
**What goes wrong:** User triggers Tag All, navigates to another page, triggers another job
**Why it happens:** Each page has its own hook instance, localStorage stores per entityType+projectId
**How to avoid:** This is actually fine by design -- each entityType+projectId combo is independent. But warn user if resuming a job on mount (show progress banner immediately).

### Pitfall 6: Cases.tsx is 3400+ Lines
**What goes wrong:** Getting lost in the huge component, breaking existing functionality
**Why it happens:** The file is very large with complex state management
**How to avoid:** Make minimal, surgical changes. Add hook at top, dropdown in bulk actions bar, progress banner before DataTable, dialog at bottom near other modals.
**Warning signs:** Regression in bulk edit, export, test run creation

## Code Examples

### Existing Hook API (verified from source)
```typescript
// Source: testplanit/components/auto-tag/useAutoTagJob.ts
const autoTag = useAutoTagJob();

// Submit: triggers background job
await autoTag.submit(entityIds, entityType, projectId);
// entityIds: number[], entityType: EntityType, projectId: number

// Status values: "idle" | "waiting" | "active" | "completed" | "failed"
autoTag.status;
autoTag.progress; // { analyzed: number; total: number } | null
autoTag.error; // string | null
autoTag.isSubmitting; // boolean
autoTag.isApplying; // boolean

// Actions
autoTag.cancel(); // Cancels job and resets state
autoTag.reset(); // Resets state without cancelling
await autoTag.apply(); // Applies accepted suggestions
```

### Existing Progress Component Props (verified from source)
```typescript
// Source: testplanit/components/auto-tag/AutoTagProgress.tsx
interface AutoTagProgressProps {
  status: AutoTagJobState;
  progress: { analyzed: number; total: number } | null;
  error: string | null;
  onReview: () => void;
  onCancel: () => void;
}
```

### Existing Review Dialog Props (verified from source)
```typescript
// Source: testplanit/components/auto-tag/AutoTagReviewDialog.tsx
interface AutoTagReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: UseAutoTagJobReturn;
}
```

### EntityType Values (verified from source)
```typescript
// Source: testplanit/lib/llm/services/auto-tag/types.ts
type EntityType = "repositoryCase" | "testRun" | "session";
```

### Cases.tsx Bulk Action Bar Location (verified from source, line ~3205)
```typescript
// The bulk action bar is a flex container with existing buttons:
// 1. Bulk Edit button (canAddEdit && selectedCaseIdsForBulkEdit.length > 0)
// 2. Create Test Run button (canAddEditRun && selectedCaseIdsForBulkEdit.length > 0)
// 3. Export button (canAddEdit)
// Add dropdown menu as 4th item in this bar
<div className="flex gap-2 pt-2 items-center -mb-2">
```

### Test Runs Header Button Area (verified from source, line ~1022)
```typescript
// Header has a flex row with "Add Test Run" and "Import" buttons
// wrapped in: {canAddEdit && (<div className="flex flex-row gap-2">...)}
// Add "Tag All" button in this same div
```

### Sessions Header Button Area (verified from source, line ~713)
```typescript
// Header has "Add Session" button
// wrapped in: {canAddEditSession && (<AddSessionModal trigger={<Button>...}/>)}
// Add "Tag All" button next to it
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | All auto-tag infrastructure built in Phases 1-3 | This project | Phase 4 is pure integration |

## Open Questions

1. **Tags page: fetch all entities count before submitting?**
   - What we know: Submit endpoint accepts entity IDs, but "Tag All in project" means we need to fetch all IDs first
   - What's unclear: Should we fetch count first to show user how many entities will be tagged?
   - Recommendation: Show a count in the popover (fetch via `useCount*` hooks) and submit by fetching all IDs via a lightweight `findMany` with `select: { id: true }` before calling submit

2. **useAutoTagJob localStorage enhancement**
   - What we know: Current hook has no localStorage support -- it was built as a stateless hook
   - What's unclear: Should localStorage logic go inside useAutoTagJob or in a wrapper?
   - Recommendation: Add localStorage support directly inside `useAutoTagJob` by adding optional `persistKey` parameter. If provided, hook stores/restores jobId automatically. This keeps the hook self-contained.

3. **i18n keys for new UI elements**
   - What we know: `autoTag.progress.*` and `autoTag.review.*` namespaces exist
   - What's unclear: Where to add new keys for "AI Tag", "Tag All", entity type labels
   - Recommendation: Add under `autoTag.actions.*` namespace in en-US.json

## Sources

### Primary (HIGH confidence)
- `testplanit/components/auto-tag/useAutoTagJob.ts` - Complete hook source, verified API
- `testplanit/components/auto-tag/AutoTagProgress.tsx` - Props interface verified
- `testplanit/components/auto-tag/AutoTagReviewDialog.tsx` - Props interface verified
- `testplanit/components/auto-tag/types.ts` - Type definitions verified
- `testplanit/app/[locale]/projects/repository/[projectId]/Cases.tsx` - Bulk action bar at line 3205
- `testplanit/app/[locale]/projects/runs/[projectId]/page.tsx` - Header at line 1014, data fetching patterns
- `testplanit/app/[locale]/projects/sessions/[projectId]/page.tsx` - Header at line 706, data fetching patterns
- `testplanit/app/[locale]/tags/page.tsx` - Tags page structure, tagProjects state
- `testplanit/messages/en-US.json` - Existing autoTag i18n keys

### Secondary (MEDIUM confidence)
- `.planning/phases/04-entry-point-integrations/04-CONTEXT.md` - User decisions and code context notes

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all components already built and verified in codebase
- Architecture: HIGH - integration points inspected, patterns clear from existing code
- Pitfalls: HIGH - derived from actual code inspection (e.g., completed runs custom API)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- integration of existing code)
