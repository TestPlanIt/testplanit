-- CreateTable
CREATE TABLE "QaseImportMapping" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL DEFAULT '',
    "entity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaseImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QaseImportMapping_jobId_entity_projectCode_sourceId_key" ON "QaseImportMapping"("jobId", "entity", "projectCode", "sourceId");


-- AddForeignKey
ALTER TABLE "QaseImportMapping" ADD CONSTRAINT "QaseImportMapping_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "QaseImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
