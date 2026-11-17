-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "riskScoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "riskWeights" JSONB;

-- AlterTable
ALTER TABLE "RepositoryCases" ADD COLUMN     "riskComputedAt" TIMESTAMPTZ(6),
ADD COLUMN     "riskReasons" JSONB,
ADD COLUMN     "riskScore" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "RepositoryCases_riskScore_idx" ON "RepositoryCases"("riskScore");
