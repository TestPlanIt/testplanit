-- Denormalized count of a case's LIVE (isDeleted = false) steps.
--
-- The repository and run lists can sort by the Steps column, but a relation
-- `_count` orderBy cannot take a `where` — ZenStack builds a correlated count
-- with only the join predicate — so retired steps were counted and the sort
-- disagreed with the number the column displays. Sorting moves to this scalar.
--
-- Maintained by the tpl_case_step_count_steps trigger on "Steps"
-- (scripts/apply-triggers.ts, applied idempotently on db push, deploy and boot).
-- Read-only for application code.
ALTER TABLE "RepositoryCases" ADD COLUMN "liveStepCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill every case in one pass. Cases with no steps keep the 0 default.
UPDATE "RepositoryCases" rc
   SET "liveStepCount" = s.cnt
  FROM (
    SELECT "testCaseId", count(*) AS cnt
      FROM "Steps"
     WHERE "isDeleted" = false
     GROUP BY "testCaseId"
  ) s
 WHERE rc.id = s."testCaseId"
   AND rc."liveStepCount" <> s.cnt;

-- Sorting by the Steps column orders on this alone, so give it an index.
CREATE INDEX "RepositoryCases_liveStepCount_idx" ON "RepositoryCases" ("liveStepCount");
