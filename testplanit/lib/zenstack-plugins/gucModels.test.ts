import { describe, expect, it } from "vitest";
import { GUC_MODELS } from "./sideEffectsPlugin";

describe("GUC_MODELS — audit actor-context coverage", () => {
  // Regression: milestone edits made through the model API were mis-attributed
  // to `__system__` because "Milestones" was missing here, so the CDC trigger
  // recorded a null actor. Any user-editable audited root entity written
  // directly through the model API (i.e. not inside an auditedTransaction) must
  // be listed, or its changes lose the acting user.
  it("covers the content root entities that write via the model API", () => {
    for (const model of [
      "RepositoryCases",
      "TestRuns",
      "Sessions",
      "Milestones",
      "Projects",
      "Comment",
      "SharedStepGroup",
      "Issue",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });

  it("covers the admin-config catalog entities (CDC-only, no semantic overlap)", () => {
    for (const model of [
      "Workflows",
      "Status",
      "CaseFields",
      "ResultFields",
      "FieldOptions",
      "Tags",
      "Templates",
      "Roles",
      "MilestoneTypes",
      "Configurations",
      "Integration",
      "LlmIntegration",
      "CodeRepository",
      "SamlConfiguration",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });

  // Regression: a case save's standalone child writes (CaseFieldValues, tag and
  // issue links) recorded a null actor and materialized as orphaned __system__
  // AuditLog rows next to the attributed RepositoryCases row, because only root
  // entities were listed. Child rows also need the GUC for operationId grouping
  // (the rollup only folds rows that share one), not just the actor.
  it("covers child/value/link tables mutated as top-level operations", () => {
    for (const model of [
      "CaseFieldValues",
      "Steps",
      "TestCaseParameter",
      "RepositoryCaseTag",
      "RepositoryCaseIssue",
      "Attachments",
      "TestRunCases",
      "TestRunCaseIteration",
      "TestRunStepResults",
      "ResultFieldValues",
      "SessionFieldValues",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });

  it("covers project-setup assignment tables (bulk-written on project create)", () => {
    for (const model of [
      "ProjectAssignment",
      "ProjectWorkflowAssignment",
      "ProjectStatusAssignment",
      "ProjectConfigurationAssignment",
      "MilestoneTypesAssignment",
      "IntegrationProject",
      "ProjectIntegration",
      "ProjectLlmIntegration",
      "ProjectCodeRepositoryConfig",
      "PromptConfigPrompt",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });

  it("covers access/permission tables whose CDC row is the sole audit record", () => {
    for (const model of [
      "UserProjectPermission",
      "GroupProjectPermission",
      "GroupAssignment",
      "RolePermission",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });

  it("excludes entities that emit their own semantic audit event (would double-log)", () => {
    // These attribute the actor through captureAuditEvent / auditSystemConfigChange
    // for their edits; adding them here would flip their CDC row from __system__
    // to a duplicate attributed row alongside the semantic one.
    for (const model of [
      "User",
      "Groups",
      "ApiToken",
      "DataSet",
      "ReviewRequest",
      "SsoProvider",
      "AppConfig",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(false);
    }
  });
});
