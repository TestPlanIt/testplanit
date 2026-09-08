-- DropForeignKey
ALTER TABLE "CaseFieldVersionValues" DROP CONSTRAINT "CaseFieldVersionValues_versionId_fkey";

-- DropForeignKey
ALTER TABLE "LlmResponseCache" DROP CONSTRAINT "LlmResponseCache_llmIntegrationId_fkey";

-- DropForeignKey
ALTER TABLE "OllamaModelRegistry" DROP CONSTRAINT "OllamaModelRegistry_llmIntegrationId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewRequest" DROP CONSTRAINT "ReviewRequest_projectId_fkey";

-- DropForeignKey
ALTER TABLE "TestRunStepResults" DROP CONSTRAINT "TestRunStepResults_testRunResultId_fkey";

-- AddForeignKey
ALTER TABLE "CaseFieldVersionValues" ADD CONSTRAINT "CaseFieldVersionValues_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RepositoryCaseVersions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunStepResults" ADD CONSTRAINT "TestRunStepResults_testRunResultId_fkey" FOREIGN KEY ("testRunResultId") REFERENCES "TestRunResults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OllamaModelRegistry" ADD CONSTRAINT "OllamaModelRegistry_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmResponseCache" ADD CONSTRAINT "LlmResponseCache_llmIntegrationId_fkey" FOREIGN KEY ("llmIntegrationId") REFERENCES "LlmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
