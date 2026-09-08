-- Reporter worker id for a JUnit result attempt (schema.zmodel gained this
-- field in 78b354cb "execution timeline, real parallelization, and result
-- filters for automated runs" without a matching migration, so every deploy
-- since has 400'd on any query selecting JUnitTestResult.worker — the
-- Execution Timeline lanes, the hidden-by-default Worker column, and the
-- run-details page's own suite/results query, which `include`s the relation
-- and so pulls every scalar column). Nullable: existing rows and reporters
-- that don't send a worker id stay unset.
ALTER TABLE "JUnitTestResult" ADD COLUMN "worker" TEXT;
