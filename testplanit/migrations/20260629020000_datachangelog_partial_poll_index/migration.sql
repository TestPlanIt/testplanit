-- CDC worker poll hot path: `WHERE "processed" = false ORDER BY "seq"`.
--
-- The init migration created `dcl_unprocessed_seq` as a PLAIN btree("seq")
-- because Prisma/ZenStack `@@index` cannot express a partial-index predicate
-- (the schema comment already notes the intended `WHERE processed = false`
-- clause). Once DataChangeLog grew to millions of rows, every poll scanned
-- the whole index + heap to confirm there was no unprocessed backlog,
-- pinning a CPU core continuously.
--
-- Recreate it as the intended PARTIAL index. When there is no backlog the
-- index is empty, so the poll returns instantly instead of scanning the
-- entire table.
DROP INDEX IF EXISTS "dcl_unprocessed_seq";
CREATE INDEX "dcl_unprocessed_seq" ON "DataChangeLog"("seq") WHERE "processed" = false;
