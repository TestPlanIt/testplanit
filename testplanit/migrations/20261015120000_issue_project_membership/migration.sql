-- CreateTable
CREATE TABLE "IssueProjectMembership" (
    "issueId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueProjectMembership_pkey" PRIMARY KEY ("issueId","projectId")
);

-- CreateIndex
CREATE INDEX "IssueProjectMembership_projectId_idx" ON "IssueProjectMembership"("projectId");

-- AddForeignKey
ALTER TABLE "IssueProjectMembership" ADD CONSTRAINT "IssueProjectMembership_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueProjectMembership" ADD CONSTRAINT "IssueProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every issue already owned by a project is a member of that project, so the
-- membership predicate answers the same rows the ownership column did.
INSERT INTO "IssueProjectMembership" ("issueId", "projectId")
SELECT i."id", i."projectId"
FROM "Issue" i
WHERE i."projectId" IS NOT NULL
ON CONFLICT ("issueId", "projectId") DO NOTHING;
