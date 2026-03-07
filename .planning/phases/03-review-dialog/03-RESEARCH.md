# Phase 3: Review Dialog - Research

**Researched:** 2026-03-07
**Domain:** React UI component (modal dialog with two-column layout, toggle chips, polling)
**Confidence:** HIGH

## Summary

Phase 3 builds a review dialog component that displays AI-suggested tags from Phase 2's background job results. The component is a large centered modal with two-column layout: entity list (left) and tag suggestions for the selected entity (right). Users toggle tag chips to accept/reject, can double-click to edit, and apply all accepted suggestions with one action.

The entire implementation uses existing project infrastructure: Radix Dialog (with fullscreen toggle already built), Badge component (for tag chips), sonner (for toasts), React Query / ZenStack hooks (for data fetching and cache invalidation), and standard Tailwind CSS. No new libraries are needed.

**Primary recommendation:** Build as a single feature component with a custom hook for polling/state management. Augment the `AutoTagJobResult` type to include entity names so the dialog doesn't need separate fetch calls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Two-column split: entity list on the left, selected entity's suggestions on the right
- Large centered modal dialog (max-width ~900px) with existing fullscreen toggle -- not a sheet or full page
- Entity list has text search/filter at the top for finding specific entities (helpful at 50+ entities)
- Toggle chips -- each tag is a clickable chip/badge; clicked = accepted (filled), unclicked = rejected (outlined/dimmed)
- All suggestions start as accepted by default (opt-out model)
- Inline edit on double-click to modify a suggestion
- No per-entity bulk actions (accept all / reject all)
- Frontend sends only accepted suggestions to apply endpoint
- New tags use dashed border + small 'New' label
- Existing tags use standard filled chip style
- No near-match warnings in UI
- Show already-applied tags (current tags) as non-interactive context in a separate grayed-out section per entity
- Aggregate summary in dialog footer near Apply button: "12 existing tags, 3 new tags will be created"
- While AI processes: inline progress indicator in the page (replaces trigger button area), not a dialog or toast
- When processing completes: success notification with "Review" button to open the dialog
- After Apply: dialog closes + success toast + React Query invalidation refreshes page data
- On Apply failure: error toast + dialog stays open with selections preserved

### Claude's Discretion
- Entity list display format in left column (name + count, name + preview, or name + status indicator)
- Exact chip styling and animation for toggle state changes
- Polling interval for status endpoint
- Loading states and skeleton patterns within the dialog
- How to handle the edge case of zero suggestions for an entity

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | User can review AI-suggested tags per entity before applying | Two-column dialog layout; entity list + suggestion detail view; data from `AutoTagJobResult.suggestions` |
| UI-02 | User can accept, reject, or modify suggestions per entity | Toggle chip interaction (Badge with click handler); inline edit on double-click; local state management |
| UI-03 | New tag suggestions are visually distinct from existing tags | `isExisting` flag in suggestion data; dashed border + "New" label for new tags vs filled Badge for existing |
| UI-04 | User can apply all accepted suggestions with one action | Apply button posts to `POST /api/auto-tag/apply` with filtered accepted suggestions; React Query invalidation after success |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @radix-ui/react-dialog | (installed) | Modal dialog foundation | Already used via `components/ui/dialog.tsx` with fullscreen toggle |
| Badge (shadcn) | (installed) | Tag chip rendering | Already used for tags throughout the app |
| sonner | (installed) | Toast notifications | Already used for success/error toasts across the app |
| @tanstack/react-query | (installed) | Cache invalidation after apply | Already used via ZenStack hooks |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @radix-ui/react-scroll-area | (installed) | Scrollable entity list and suggestion panels | Both columns need independent scrolling |
| lucide-react | (installed) | Tag icon, search icon, check icon | Icon consistency with rest of app |
| zod | (installed) | Apply request validation (client-side) | Match server-side `applySchema` |
| next-intl | (installed) | Translation keys | All user-visible strings need i18n |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom toggle chips | react-select | Toggle chips are simpler for accept/reject; react-select is overkill here |
| Local state for selections | Zustand/Redux | Local component state with `useState` is sufficient; no cross-component sharing needed |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure
```
components/
  auto-tag/
    AutoTagReviewDialog.tsx        # Main dialog component
    EntityList.tsx                 # Left column: filterable entity list
    EntitySuggestions.tsx          # Right column: tag suggestions for selected entity
    TagChip.tsx                    # Individual toggleable tag chip
    AutoTagProgress.tsx            # Inline progress indicator (replaces trigger button)
    useAutoTagJob.ts               # Custom hook: polling, state management, apply
    types.ts                       # Shared types for the auto-tag UI
```

### Pattern 1: Custom Hook for Job Lifecycle
**What:** A single hook (`useAutoTagJob`) manages the entire auto-tag workflow: submit, poll, store results, track selections, apply.
**When to use:** Any component that needs to interact with the auto-tag feature.
**Example:**
```typescript
interface UseAutoTagJobReturn {
  // Job lifecycle
  jobId: string | null;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  progress: { analyzed: number; total: number } | null;

  // Results & selections
  suggestions: AutoTagJobResult['suggestions'] | null;
  selections: Map<number, Set<string>>; // entityId -> accepted tagNames

  // Actions
  submit: (entityIds: number[], entityType: EntityType, projectId: number) => Promise<void>;
  toggleTag: (entityId: number, tagName: string) => void;
  editTag: (entityId: number, oldName: string, newName: string) => void;
  apply: () => Promise<void>;
  cancel: () => Promise<void>;

  // Computed
  summary: { existingCount: number; newCount: number };
  isApplying: boolean;
}
```

### Pattern 2: Selections as Derived State from Suggestions
**What:** Initialize selections from suggestions (all accepted by default), then track modifications as a `Map<entityId, Set<tagName>>` where presence in the set = accepted.
**When to use:** Managing the accept/reject state.
**Example:**
```typescript
// Initialize: all suggestions accepted
const initSelections = (suggestions: AutoTagJobResult['suggestions']) => {
  const map = new Map<number, Set<string>>();
  for (const entity of suggestions) {
    map.set(entity.entityId, new Set(entity.tags.map(t => t.tagName)));
  }
  return map;
};

// Toggle: add/remove from set
const toggleTag = (entityId: number, tagName: string) => {
  setSelections(prev => {
    const next = new Map(prev);
    const tags = new Set(next.get(entityId) || []);
    if (tags.has(tagName)) tags.delete(tagName);
    else tags.add(tagName);
    next.set(entityId, tags);
    return next;
  });
};
```

### Pattern 3: Inline Edit via Controlled Input
**What:** Double-click on a tag chip transitions it to an editable input. Press Enter or blur to confirm; Escape to cancel.
**When to use:** For the inline edit on double-click decision.
**Example:**
```typescript
const [editingTag, setEditingTag] = useState<string | null>(null);

// On double-click: enter edit mode
// Render: editingTag === tagName ? <Input /> : <Badge onClick={toggle} onDoubleClick={edit} />
```

### Anti-Patterns to Avoid
- **Fetching entity names in the dialog:** The `AutoTagJobResult` only contains `entityId` and `entityType`, not names. Either augment the worker result to include entity names, or pass entity names from the calling context (Phase 4 entry points already have the entity list). Fetching 100+ entities individually in the dialog is wasteful.
- **Polling in the dialog component:** The progress indicator is inline on the page (not in the dialog). The hook should manage polling; the dialog only opens after completion.
- **Storing selections in a flat array:** A `Map<entityId, Set<tagName>>` is more efficient for toggle operations than filtering/finding in arrays.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal dialog | Custom overlay/focus trap | `components/ui/dialog.tsx` (Radix) | Focus management, escape handling, scroll lock, accessibility |
| Scrollable panels | `overflow-y-auto` div | `components/ui/scroll-area.tsx` (Radix) | Custom scrollbar styling, consistent cross-browser behavior |
| Toast notifications | Custom notification system | `sonner` (already imported across app) | Consistent with existing UX, auto-dismiss, stacking |
| Cache invalidation | Manual refetch calls | `queryClient.invalidateQueries` via `invalidateModelQueries` utility | Already established pattern in `utils/optimistic-updates.ts` |

**Key insight:** This phase is pure UI composition using existing primitives. The complexity is in state management (selections, edits, polling), not in building new UI infrastructure.

## Common Pitfalls

### Pitfall 1: Entity Names Missing from Job Result
**What goes wrong:** The `AutoTagJobResult` type only has `entityId` and `entityType` -- no entity name or title. The dialog needs names for the left column.
**Why it happens:** The worker was built for data processing, not UI display.
**How to avoid:** Two options: (a) Augment `AutoTagJobResult` to include `entityName` in each suggestion entry (preferred -- one-line addition to worker), or (b) pass entity data from the entry point component that already has it loaded (Phase 4 integration concern).
**Warning signs:** Left column showing IDs instead of names.
**Recommendation:** Option (a) -- add `entityName: string` to the worker result. It's already available in `EntityContent.name` during processing.

### Pitfall 2: DialogContent max-width Override
**What goes wrong:** The default `DialogContent` has `max-w-lg` (~32rem). The design requires ~900px (~56rem).
**Why it happens:** The className override needs to explicitly replace, not just add to, the default.
**How to avoid:** Pass `className="max-w-[900px]"` to `DialogContent`. Tailwind v4 should handle the override, but verify the specificity works. If not, use `!max-w-[900px]` or a wrapper.
**Warning signs:** Dialog appears too narrow.

### Pitfall 3: Stale Selections After Edit
**What goes wrong:** Editing a tag name (e.g., "auth" -> "authentication") but the selections map still has the old name.
**Why it happens:** The edit modifies the tag name but doesn't update the selection tracking.
**How to avoid:** The `editTag` function must: (1) update the tag in the suggestions list, (2) remove old name from selections set and add new name.
**Warning signs:** Edited tag appears as rejected after editing.

### Pitfall 4: Apply Payload Construction
**What goes wrong:** Sending ALL suggestions to the apply endpoint instead of only accepted ones.
**Why it happens:** Phase 2 decision: "frontend sends only accepted suggestions."
**How to avoid:** Filter suggestions through the selections map before constructing the apply request. The `applySchema` expects `{ suggestions: [{ entityId, entityType, tagName }] }`.

### Pitfall 5: Already-Applied Tags from Current Entity Data
**What goes wrong:** The "already-applied tags" section needs the entity's CURRENT tags, but the job result only has SUGGESTED tags.
**Why it happens:** Current tags are entity data, not job output.
**How to avoid:** The `EntityContent.existingTagNames` field holds current entity tags during processing. Include this in the job result, OR fetch current tags via ZenStack hooks when the dialog opens. Since entities might have many tags and the dialog could show 50+ entities, including in the job result is more efficient.
**Recommendation:** Add `currentTags: string[]` per entity to the job result.

### Pitfall 6: React Query Key Invalidation After Apply
**What goes wrong:** After applying tags, the entity lists don't refresh to show new tags.
**Why it happens:** Need to invalidate the right query keys for the entity type being tagged.
**How to avoid:** Use `invalidateModelQueries(queryClient, modelName)` from `utils/optimistic-updates.ts`. Map entity type to model name: `repositoryCase` -> `RepositoryCases`, `testRun` -> `TestRuns`, `session` -> `Sessions`. Also invalidate `Tags` queries since new tags may have been created.

## Code Examples

### Tag Chip Component (Toggle + New Tag Distinction)
```typescript
// Based on existing Badge component and TagsDisplay pattern
interface TagChipProps {
  tagName: string;
  isExisting: boolean;
  isAccepted: boolean;
  onToggle: () => void;
  onEdit: (newName: string) => void;
}

function TagChip({ tagName, isExisting, isAccepted, onToggle, onEdit }: TagChipProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tagName);

  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => { onEdit(editValue); setIsEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onEdit(editValue); setIsEditing(false); }
          if (e.key === 'Escape') { setEditValue(tagName); setIsEditing(false); }
        }}
        className="h-6 w-auto min-w-[60px] text-xs"
        autoFocus
      />
    );
  }

  return (
    <Badge
      variant={isAccepted ? "default" : "outline"}
      className={cn(
        "cursor-pointer select-none transition-all",
        !isExisting && "border-dashed",
        !isAccepted && "opacity-50"
      )}
      onClick={onToggle}
      onDoubleClick={() => setIsEditing(true)}
    >
      <Tag className="w-3 h-3 mr-1 shrink-0" />
      {tagName}
      {!isExisting && (
        <span className="ml-1 text-[10px] font-normal opacity-70">New</span>
      )}
    </Badge>
  );
}
```

### Apply Request Construction
```typescript
// Filter accepted suggestions and build apply payload
const buildApplyPayload = (
  suggestions: AutoTagJobResult['suggestions'],
  selections: Map<number, Set<string>>,
  edits: Map<string, string>, // old name -> new name
) => {
  const payload: Array<{ entityId: number; entityType: EntityType; tagName: string }> = [];

  for (const entity of suggestions) {
    const acceptedTags = selections.get(entity.entityId);
    if (!acceptedTags || acceptedTags.size === 0) continue;

    for (const tagName of acceptedTags) {
      // Apply any edits
      const finalName = edits.get(tagName) ?? tagName;
      payload.push({
        entityId: entity.entityId,
        entityType: entity.entityType,
        tagName: finalName,
      });
    }
  }

  return { suggestions: payload };
};
```

### Polling Hook Pattern
```typescript
// Follow existing patterns -- useEffect with setInterval
const useAutoTagPolling = (jobId: string | null, enabled: boolean) => {
  const [status, setStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    if (!jobId || !enabled) return;

    const poll = async () => {
      const res = await fetch(`/api/auto-tag/status/${jobId}`);
      const data = await res.json();
      setStatus(data);

      if (data.state === 'completed' || data.state === 'failed') {
        clearInterval(intervalId);
      }
    };

    poll(); // Initial fetch
    const intervalId = setInterval(poll, 2000); // 2s interval

    return () => clearInterval(intervalId);
  }, [jobId, enabled]);

  return status;
};
```

### Summary Computation
```typescript
const computeSummary = (
  suggestions: AutoTagJobResult['suggestions'],
  selections: Map<number, Set<string>>,
) => {
  let existingCount = 0;
  let newCount = 0;

  for (const entity of suggestions) {
    const accepted = selections.get(entity.entityId);
    if (!accepted) continue;

    for (const tag of entity.tags) {
      if (accepted.has(tag.tagName)) {
        if (tag.isExisting) existingCount++;
        else newCount++;
      }
    }
  }

  return { existingCount, newCount };
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-select for tag management | Toggle chips with Badge | This phase | Simpler UX for binary accept/reject; react-select stays for ManageTags |
| Full page for review flows | Large modal with fullscreen toggle | Existing pattern | Consistent with other dialogs in the app |

**Notes:**
- The project uses Tailwind CSS v4 (not v3) -- class merging behavior may differ slightly. The `cn()` utility handles this.
- The project uses React 19 -- `use()` hook is available if needed for suspense patterns, but standard `useState`/`useEffect` are preferred for this feature.

## Open Questions

1. **Entity Names in Job Result**
   - What we know: `AutoTagJobResult` has `entityId` but not entity names. The dialog needs names.
   - What's unclear: Whether to augment the worker result or pass names from calling context.
   - Recommendation: Augment `AutoTagJobResult` to include `entityName` per entity (trivial change, data already available in worker). This also enables the dialog to work independently of calling context.

2. **Current Tags in Job Result**
   - What we know: The "already-applied tags" section needs current entity tags. `EntityContent.existingTagNames` exists during processing but isn't in the job result.
   - What's unclear: Whether to include in job result or fetch separately.
   - Recommendation: Include `currentTags: string[]` per entity in the job result. Avoids N+1 fetches for large entity sets.

3. **Edited Tags and the Apply Endpoint**
   - What we know: The apply endpoint expects `tagName` per suggestion. If a user edits "auth" to "authentication", we send "authentication".
   - What's unclear: Should edits that match an existing tag name switch `isExisting` to true?
   - Recommendation: Don't worry about it -- the apply endpoint does `upsert` by name, so it handles both cases correctly. The visual distinction in the UI is cosmetic.

## Sources

### Primary (HIGH confidence)
- Project codebase: `workers/autoTagWorker.ts` -- job result structure (`AutoTagJobResult`)
- Project codebase: `app/api/auto-tag/apply/route.ts` -- apply endpoint schema and behavior
- Project codebase: `app/api/auto-tag/status/[jobId]/route.ts` -- polling response shape
- Project codebase: `components/ui/dialog.tsx` -- Radix Dialog with fullscreen toggle
- Project codebase: `components/ui/badge.tsx` -- Badge variants (default, secondary, outline, destructive)
- Project codebase: `components/ManageTags.tsx` -- tag creation/selection patterns
- Project codebase: `components/tables/TagDisplay.tsx` -- tag rendering with Badge + Tag icon
- Project codebase: `utils/optimistic-updates.ts` -- `invalidateModelQueries` utility, `toast` from sonner

### Secondary (MEDIUM confidence)
- Project codebase: `lib/llm/services/auto-tag/types.ts` -- `EntityType`, `EntityContent` with `name` field

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all components already exist in the codebase, no new dependencies
- Architecture: HIGH -- patterns follow existing codebase conventions (hooks, Radix primitives, sonner toasts)
- Pitfalls: HIGH -- identified from direct code reading (missing entity names, selection state sync, query invalidation)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- all based on existing project code)
