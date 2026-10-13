-- Execution scope (milestone/configuration axes) frozen onto a traceability
-- snapshot at capture. Empty array = axis inactive (a global capture).
ALTER TABLE "RequirementTraceabilitySnapshot"
    ADD COLUMN "scopeMilestoneIds" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "scopeConfigIds" JSONB NOT NULL DEFAULT '[]';
