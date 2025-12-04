# Implementation Plan: Milestone Features (Issues #8 and #9)

## Overview

This plan covers two related milestone features:
1. **Issue #8**: Automatic milestone completion when due date is reached
2. **Issue #9**: Notifications when milestone due date is approaching

---

## Feature 1: Automatic Milestone Completion (Issue #8)

### Database Schema Changes

Add a new field to the `Milestones` model in `prisma/schema.prisma`:

```prisma
model Milestones {
  // ... existing fields ...
  automaticCompletion Boolean @default(false)  // NEW FIELD
}
```

### UI Changes

**Files to modify:**
- `app/[locale]/projects/milestones/[projectId]/AddMilestoneModal.tsx`
- `app/[locale]/projects/milestones/[projectId]/[milestoneId]/MilestoneFormControls.tsx`
- `app/[locale]/admin/milestones/MilestoneFormDialog.tsx`

**Changes:**
1. Add `automaticCompletion` to form schema (Zod)
2. Add a Switch component for "Auto-complete on due date" - only enabled when a due date (`completedAt`) is set
3. Include the field in form submission data

### Worker Changes

**File to modify:** `workers/forecastWorker.ts`

Add a new job type `JOB_AUTO_COMPLETE_MILESTONES` that:
1. Queries for all milestones where:
   - `isCompleted = false`
   - `isDeleted = false`
   - `automaticCompletion = true`
   - `completedAt <= now()` (due date has passed)
2. For each matching milestone, mark it as completed:
   - Set `isCompleted = true`
   - Optionally cascade to child milestones if they also have `automaticCompletion = true`

### Translation Updates

Add translations for all 3 locales (en-US, es-ES, fr-FR):
- `milestones.fields.automaticCompletion`: "Auto-complete on due date"
- Help text for the field

---

## Feature 2: Milestone Due Date Notifications (Issue #9)

### Database Schema Changes

Add a new field to the `Milestones` model:

```prisma
model Milestones {
  // ... existing fields ...
  notifyDaysBefore Int @default(0)  // 0 = no notifications, positive = days before due date
}
```

Add a new notification type to the `NotificationType` enum:

```prisma
enum NotificationType {
  // ... existing types ...
  MILESTONE_DUE_REMINDER
}
```

### UI Changes

**Files to modify:**
- `app/[locale]/projects/milestones/[projectId]/AddMilestoneModal.tsx`
- `app/[locale]/projects/milestones/[projectId]/[milestoneId]/MilestoneFormControls.tsx`
- `app/[locale]/admin/milestones/MilestoneFormDialog.tsx`

**Changes:**
1. Add `notifyDaysBefore` to form schema (Zod) - must be >= 0
2. Add a number input field for "Notify days before due date"
   - Disabled when no due date is set
   - Auto-enabled with default of 5 when due date is set
   - Value of 0 means notifications are disabled
3. Include the field in form submission data

### Worker Changes

**File to modify:** `workers/forecastWorker.ts`

Add a new job type `JOB_MILESTONE_DUE_NOTIFICATIONS` that:
1. Queries for all milestones where:
   - `isCompleted = false`
   - `isDeleted = false`
   - `notifyDaysBefore > 0`
   - `completedAt` is set (has a due date)
   - Due date is within `notifyDaysBefore` days from now, OR due date is today/past
2. For each matching milestone:
   - Find all users with assigned work (via `TestRuns.testCases.assignedToId` and `Sessions.assignedToId`)
   - Calculate days remaining (or days overdue)
   - Send notification with appropriate message

### Notification Service Updates

**File to modify:** `lib/services/notificationService.ts`

Add a new method:
```typescript
static async createMilestoneDueNotification(
  userId: string,
  milestoneName: string,
  projectName: string,
  daysRemaining: number,  // negative if overdue
  milestoneId: number,
  projectId: number
)
```

### Email Worker Updates

**File to modify:** `workers/emailWorker.ts`

Add URL builder for `MILESTONE_DUE_REMINDER` notification type:
- URL: `/projects/milestones/{projectId}/{milestoneId}`

### Translation Updates

Add translations for all 3 locales:
- `milestones.fields.notifyDaysBefore`: "Notify days before due date"
- `milestones.notifications.dueSoon`: "Milestone \"{name}\" is due on {dueDate}"
- `milestones.notifications.overdue`: "Milestone \"{name}\" was due on {dueDate}"
- Help text for the field

**Note:** Avoid relative date terms like "today" or "in X days" to prevent timezone confusion. Always show explicit dates formatted according to user locale.

---

## Implementation Steps

### Step 1: Database Schema Changes
1. Add both new fields to `Milestones` model in `prisma/schema.prisma`
2. Add `MILESTONE_DUE_REMINDER` to `NotificationType` enum
3. Run `npx zenstack generate` to regenerate ZenStack hooks
4. Create and run database migration

### Step 2: UI Changes for Issue #8 (Auto-completion)
1. Update `AddMilestoneModal.tsx`:
   - Add `automaticCompletion` to Zod schema with default `false`
   - Add Switch field (disabled when no due date)
   - Wire up conditional enabling when due date is set
   - Add to form submission
2. Update `MilestoneFormControls.tsx` with same changes
3. Update `MilestoneFormDialog.tsx` (admin) with same changes
4. Add translations

### Step 3: UI Changes for Issue #9 (Notifications)
1. Update `AddMilestoneModal.tsx`:
   - Add `notifyDaysBefore` to Zod schema with default `0`
   - Add number input field (disabled when no due date)
   - Auto-set to 5 when due date is first set
   - Add to form submission
2. Update `MilestoneFormControls.tsx` with same changes
3. Update `MilestoneFormDialog.tsx` (admin) with same changes
4. Add translations

### Step 4: Worker Implementation
1. Add new job types to `forecastWorker.ts`:
   - `JOB_AUTO_COMPLETE_MILESTONES`
   - `JOB_MILESTONE_DUE_NOTIFICATIONS`
2. Implement processor logic for both job types
3. Add job scheduling (likely via cron job that runs daily)

### Step 5: Notification Service
1. Add `createMilestoneDueNotification` method to `NotificationService`
2. Update `emailWorker.ts` to handle `MILESTONE_DUE_REMINDER` type
3. Add email template for milestone due notifications

### Step 6: Testing
1. Test auto-completion with various due date scenarios
2. Test notification sending with various day ranges
3. Verify notifications go to correct users (those with assigned work)
4. Test edge cases (milestone completed manually, due date changed, etc.)

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `automaticCompletion`, `notifyDaysBefore` fields and `MILESTONE_DUE_REMINDER` enum |
| `app/[locale]/projects/milestones/[projectId]/AddMilestoneModal.tsx` | Add form fields for both features |
| `app/[locale]/projects/milestones/[projectId]/[milestoneId]/MilestoneFormControls.tsx` | Add form fields for both features |
| `app/[locale]/admin/milestones/MilestoneFormDialog.tsx` | Add form fields for both features |
| `workers/forecastWorker.ts` | Add job types and processing logic |
| `lib/services/notificationService.ts` | Add milestone notification method |
| `workers/emailWorker.ts` | Handle `MILESTONE_DUE_REMINDER` URL building |
| `messages/en-US.json` | Add English translations |
| `messages/es-ES.json` | Add Spanish translations |
| `messages/fr-FR.json` | Add French translations |

---

## Considerations

1. **Scheduling**: The worker jobs for auto-completion and notifications should run daily (e.g., at midnight UTC or a configurable time)
2. **Timezone handling**:
   - Due dates are stored as `DateTime` with timezone (`Timestamptz`)
   - All comparisons should use UTC to avoid timezone issues
   - Notification messages should display explicit dates (e.g., "due on Dec 15, 2025") rather than relative terms like "today" or "in 3 days" to avoid confusion across timezones
   - Dates should be formatted according to user's locale preference
3. **Multi-tenant support**: Both features must respect multi-tenant architecture already in place
4. **Cascade behavior**: Auto-completion should respect existing cascade logic for child milestones
5. **Notification deduplication**: Ensure users don't receive duplicate notifications for the same milestone on the same day
