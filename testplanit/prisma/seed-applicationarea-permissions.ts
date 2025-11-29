import { ApplicationArea } from "@prisma/client";

/**
 * Comprehensive permission definitions for all ApplicationAreas
 * Including the new areas: SharedSteps, Issues, Reporting, Settings
 * 
 * Note: Forecasting and IssueIntegration are still in the schema but not used:
 * - Forecasting: No page exists for this feature
 * - IssueIntegration: Handled as part of Settings permissions
 */

export const getComprehensiveRolePermissions = () => {
  return {
    // Project Admin - Full access to everything
    projectAdmin: {
      [ApplicationArea.Documentation]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Milestones]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestCaseRepository]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestRuns]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.ClosedTestRuns]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestRunResults]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Sessions]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.ClosedSessions]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.SessionResults]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Tags]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.SharedSteps]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Issues]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.IssueIntegration]: { canAddEdit: true, canDelete: true, canClose: true }, // Not used - part of Settings
      [ApplicationArea.Forecasting]: { canAddEdit: true, canDelete: true, canClose: true }, // Not used - no page exists
      [ApplicationArea.Reporting]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Settings]: { canAddEdit: true, canDelete: true, canClose: true },
    },
    
    // Manager - Can manage most areas but limited in some
    manager: {
      [ApplicationArea.Documentation]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.Milestones]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestCaseRepository]: { canAddEdit: false, canDelete: false, canClose: false }, // Read-only
      [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRuns]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.ClosedTestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRunResults]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Sessions]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedSessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionResults]: { canAddEdit: true, canDelete: true, canClose: true },
      [ApplicationArea.Tags]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.SharedSteps]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.Issues]: { canAddEdit: true, canDelete: false, canClose: true }, // Can manage issues
      [ApplicationArea.IssueIntegration]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Forecasting]: { canAddEdit: true, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Reporting]: { canAddEdit: true, canDelete: false, canClose: false }, // Can create reports
      [ApplicationArea.Settings]: { canAddEdit: false, canDelete: false, canClose: false }, // No settings access
    },
    
    // Tester - Focused on test execution
    tester: {
      [ApplicationArea.Documentation]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Milestones]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestCaseRepository]: { canAddEdit: true, canDelete: false, canClose: false }, // Can add/edit cases
      [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRuns]: { canAddEdit: true, canDelete: false, canClose: true }, // Can execute runs
      [ApplicationArea.ClosedTestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRunResults]: { canAddEdit: true, canDelete: false, canClose: false }, // Can add results
      [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Sessions]: { canAddEdit: false, canDelete: false, canClose: false }, // Limited sessions
      [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedSessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionResults]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Tags]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.SharedSteps]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.Issues]: { canAddEdit: true, canDelete: false, canClose: false }, // Can link issues
      [ApplicationArea.IssueIntegration]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Forecasting]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Reporting]: { canAddEdit: false, canDelete: false, canClose: false }, // View only
      [ApplicationArea.Settings]: { canAddEdit: false, canDelete: false, canClose: false },
    },
    
    // Contributor - Can contribute content in specific areas
    contributor: {
      [ApplicationArea.Documentation]: { canAddEdit: true, canDelete: false, canClose: false },
      [ApplicationArea.Milestones]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestCaseRepository]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedTestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRunResults]: { canAddEdit: true, canDelete: false, canClose: false }, // Can add results only
      [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Sessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedSessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionResults]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Tags]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SharedSteps]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Issues]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.IssueIntegration]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Forecasting]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Reporting]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Settings]: { canAddEdit: false, canDelete: false, canClose: false },
    },
    
    // Viewer - Read-only access to everything
    viewer: {
      // All areas default to false - read-only access
      [ApplicationArea.Documentation]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Milestones]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestCaseRepository]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedTestRuns]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRunResults]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Sessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.ClosedSessions]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SessionResults]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Tags]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.SharedSteps]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Issues]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.IssueIntegration]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Forecasting]: { canAddEdit: false, canDelete: false, canClose: false }, // Not used
      [ApplicationArea.Reporting]: { canAddEdit: false, canDelete: false, canClose: false },
      [ApplicationArea.Settings]: { canAddEdit: false, canDelete: false, canClose: false },
    },
  };
};

/**
 * Helper to get default permissions for a role and area
 * Used for backward compatibility and filling in missing permissions
 */
export function getDefaultPermissionForRoleAndArea(
  roleName: string,
  area: ApplicationArea
): { canAddEdit: boolean; canDelete: boolean; canClose: boolean } {
  const defaultPermissions = { canAddEdit: false, canDelete: false, canClose: false };
  
  const rolePermissions = getComprehensiveRolePermissions();
  const rolePerms = rolePermissions[roleName as keyof typeof rolePermissions];
  
  if (!rolePerms) {
    return defaultPermissions;
  }
  
  return rolePerms[area] || defaultPermissions;
}

/**
 * System-wide permission rules for special ApplicationAreas
 */
export const getSpecialAreaRules = () => {
  return {
    // Settings area should only be accessible to Project Admins and System Admins
    [ApplicationArea.Settings]: {
      requiresProjectAdmin: true,
      allowSystemAdmin: true,
      allowProjectAdmin: true,
      description: "Project settings management"
    },
    
    // IssueIntegration - Not used, handled as part of Settings
    [ApplicationArea.IssueIntegration]: {
      requiresProjectAdmin: true,
      allowSystemAdmin: true,
      allowProjectAdmin: true,
      description: "External issue tracker configuration (part of Settings)"
    },
    
    // Reporting might have special visibility rules
    [ApplicationArea.Reporting]: {
      requiresProjectAdmin: false, // Managers can also create reports
      allowSystemAdmin: true,
      allowProjectAdmin: true,
      description: "Project reports and analytics"
    },
    
    // Forecasting - Not used, no page exists
    [ApplicationArea.Forecasting]: {
      requiresProjectAdmin: false,
      allowSystemAdmin: true,
      allowProjectAdmin: true,
      description: "Test execution forecasting (not implemented)"
    },
  };
};