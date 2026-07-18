-- Execution-start composition lock (BOR-1). Additive, no backfill:
--   TestRuns.compositionLockedAt   — when the run's case composition was frozen
--                                    (NULL = unlocked); execution continues while locked.
--   TestRuns.compositionLockedById — who locked it, or NULL when auto-locked on
--                                    entering an IN_PROGRESS state.
--   Projects.autoLockCompositionOnInProgress — per-project opt-in for auto-lock.
-- The authoritative add/remove/reorder guard is the tpl_composition_lock_guard
-- Postgres trigger applied by scripts/apply-triggers.ts.

-- AlterTable
ALTER TABLE "TestRuns" ADD COLUMN     "compositionLockedAt" TIMESTAMPTZ(6),
ADD COLUMN     "compositionLockedById" TEXT;

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "autoLockCompositionOnInProgress" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "TestRuns" ADD CONSTRAINT "TestRuns_compositionLockedById_fkey" FOREIGN KEY ("compositionLockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
