-- Per-template opt-in for the Jira plugin panel: when true, the assigned case
-- field's resolved value is included with each linked test case shown in the
-- Jira panel. Disabled by default so no field data leaves the app unless an
-- admin turns it on.
ALTER TABLE "TemplateCaseAssignment" ADD COLUMN "jiraPanelEnabled" BOOLEAN NOT NULL DEFAULT false;
