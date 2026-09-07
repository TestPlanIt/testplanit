-- Per-project group access mapping (v0.37.11 residual: "SCIM per-project
-- access mapping — Groups.mappedAccess has no projectId dimension").
--
-- Groups.mappedAccess grants an org-wide tier. GroupProjectAccessMapping is
-- its project-scoped counterpart: a group can grant an access tier on one
-- project. Mappings are materialized into GroupProjectPermission rows (see
-- lib/scim/access/projectMappings.ts) so the shipped permission engine
-- resolves them, leaving exactly one resolution path.
--
-- derivedFromMapping marks the rows the materializer owns. It defaults to
-- false, so every permission an admin assigned by hand in the project UI
-- stays manual and is never deleted by a mapping change.

-- AlterTable
ALTER TABLE "GroupProjectPermission" ADD COLUMN     "derivedFromMapping" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GroupProjectAccessMapping" (
    "groupId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "mappedAccess" "Access" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "GroupProjectAccessMapping_pkey" PRIMARY KEY ("groupId","projectId")
);

-- CreateIndex
CREATE INDEX "GroupProjectAccessMapping_projectId_idx" ON "GroupProjectAccessMapping"("projectId");

-- AddForeignKey
ALTER TABLE "GroupProjectAccessMapping" ADD CONSTRAINT "GroupProjectAccessMapping_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupProjectAccessMapping" ADD CONSTRAINT "GroupProjectAccessMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
