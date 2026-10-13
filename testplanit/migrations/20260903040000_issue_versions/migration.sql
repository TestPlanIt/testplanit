-- Requirement content versioning: one row per historical state of a
-- requirement's title/description/note, written ONLY by the
-- tpl_issue_version_capture trigger (applied by scripts/apply-triggers.ts).
CREATE TABLE "IssueVersions" (
    "id" SERIAL NOT NULL,
    "issueId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "note" JSONB,
    "changedById" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueVersions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueVersions_issueId_version_key" ON "IssueVersions"("issueId", "version");

ALTER TABLE "IssueVersions" ADD CONSTRAINT "IssueVersions_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueVersions" ADD CONSTRAINT "IssueVersions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which text revision a traceability baseline saw at capture.
ALTER TABLE "RequirementTraceabilitySnapshotEntry" ADD COLUMN "requirementVersion" INTEGER;
