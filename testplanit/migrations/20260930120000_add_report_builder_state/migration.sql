-- Report Builder selections persisted server-side so the page URL carries a
-- short state id instead of the full dimension-filter id list (a "Select all"
-- over 1,000+ test runs produced 8 KB+ URLs that ingress rejected with 414).

-- CreateTable
CREATE TABLE "ReportBuilderState" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER,
    "createdById" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportBuilderState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportBuilderState_projectId_configHash_idx" ON "ReportBuilderState"("projectId", "configHash");

-- CreateIndex
CREATE INDEX "ReportBuilderState_createdById_idx" ON "ReportBuilderState"("createdById");

-- AddForeignKey
ALTER TABLE "ReportBuilderState" ADD CONSTRAINT "ReportBuilderState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportBuilderState" ADD CONSTRAINT "ReportBuilderState_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
