-- Per-template default for the Generate Test Cases wizard: when false, the
-- assigned case field starts unchecked in the wizard (users can still select
-- it manually). Existing assignments keep the current always-on behavior.
ALTER TABLE "TemplateCaseAssignment" ADD COLUMN "generateDefaultEnabled" BOOLEAN NOT NULL DEFAULT true;
