-- Tri-state per-issue classification override: FORCE_ON/FORCE_OFF pin
-- isRequirement regardless of the requirement type config; NULL inherits
-- the config. Honored by the sync write paths and the classification
-- recompute (rows with a non-null override are skipped by both).
CREATE TYPE "RequirementOverride" AS ENUM ('FORCE_ON', 'FORCE_OFF');

ALTER TABLE "Issue" ADD COLUMN "requirementOverride" "RequirementOverride";
