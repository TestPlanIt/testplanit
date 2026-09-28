-- Per-connection switch: a ticket added to a test result or step result also
-- links the result's case for ticket-derived Code Pins and the issue layer.
ALTER TABLE "ProjectCodeRepositoryConfig"
  ADD COLUMN "issueResultLinks" BOOLEAN NOT NULL DEFAULT false;
