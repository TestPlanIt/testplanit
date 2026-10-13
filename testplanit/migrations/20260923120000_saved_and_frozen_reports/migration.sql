-- Saved reports are private ShareLink rows of their own type, the same way
-- saved searches and repository views are stored.
ALTER TYPE "ShareLinkEntityType" ADD VALUE 'SAVED_REPORT';

-- A frozen link keeps the report output captured when it was created.
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalRowCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportSnapshot_shareLinkId_key" ON "ReportSnapshot"("shareLinkId");

CREATE INDEX "ReportSnapshot_capturedById_idx" ON "ReportSnapshot"("capturedById");

ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
