import type { DbClient, TxClient } from "~/lib/zenstack";

import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";

/**
 * Shared guard helpers for human result mutations (recording via
 * `submit-result` and editing via `edit-result`). Centralizes the permission
 * check and the two governance gates — flip justification and required result
 * fields — so both server entry points enforce them identically.
 */

export type OutcomeFlags = {
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
};

/**
 * Whether moving from `prior` to `next` is an outcome flip that requires a
 * justification. Only a change between two *completed* judgments counts —
 * recording the first completed result (prior not completed) or clearing
 * back to an untested/blocked status (next not completed) is not a flip and
 * never demands a note.
 */
export function isOutcomeFlip(
  prior: OutcomeFlags,
  next: OutcomeFlags
): boolean {
  if (!prior.isCompleted || !next.isCompleted) {
    return false;
  }
  return (
    prior.isSuccess !== next.isSuccess || prior.isFailure !== next.isFailure
  );
}

export type RolePermissionSnapshot =
  | {
      name?: string | null;
      rolePermissions?: Array<{ canAddEdit: boolean }> | null;
    }
  | null
  | undefined;

export type ProjectAccessTypeValue =
  | "DEFAULT"
  | "NO_ACCESS"
  | "GLOBAL_ROLE"
  | "SPECIFIC_ROLE";

export function roleCanAddEditTestRunResults(
  role: RolePermissionSnapshot
): boolean {
  return Boolean(
    role?.rolePermissions?.some((permission) => permission.canAddEdit)
  );
}

/**
 * Whether `user` may record or edit a result on the given run-case/project.
 * System admins, the project creator, the run creator, and the case assignee
 * always pass; otherwise resolution falls through explicit user permissions,
 * group permissions, and the project default access type — matching the
 * `canAddEdit` grant on the `TestRunResults` application area.
 */
export function hasResultMutationPermission({
  user,
  testRunCreatedById,
  assignedToId,
  project,
}: {
  user: {
    id: string;
    access: string;
    role: {
      rolePermissions: Array<{ canAddEdit: boolean }>;
    } | null;
  };
  testRunCreatedById: string;
  assignedToId: string | null;
  project: {
    createdBy: string;
    defaultAccessType: ProjectAccessTypeValue;
    defaultRole: RolePermissionSnapshot;
    assignedUsers: Array<{ userId: string }>;
    userPermissions: Array<{
      accessType: ProjectAccessTypeValue;
      role: RolePermissionSnapshot;
    }>;
    groupPermissions: Array<{
      accessType: ProjectAccessTypeValue;
      role: RolePermissionSnapshot;
    }>;
  };
}): boolean {
  if (user.access === "ADMIN") {
    return true;
  }

  if (project.createdBy === user.id) {
    return true;
  }

  if (testRunCreatedById === user.id) {
    return true;
  }

  if (assignedToId === user.id) {
    return true;
  }

  if (
    user.access === "PROJECTADMIN" &&
    project.assignedUsers.some((assignment) => assignment.userId === user.id)
  ) {
    return true;
  }

  const hasGlobalRoleResultPermission = roleCanAddEditTestRunResults(user.role);

  const explicitUserPermission = project.userPermissions[0];
  if (explicitUserPermission) {
    if (explicitUserPermission.accessType === "NO_ACCESS") {
      return false;
    }

    if (explicitUserPermission.accessType === "SPECIFIC_ROLE") {
      return (
        explicitUserPermission.role?.name === "Project Admin" ||
        roleCanAddEditTestRunResults(explicitUserPermission.role)
      );
    }

    if (explicitUserPermission.accessType === "GLOBAL_ROLE") {
      return user.access !== "NONE" && hasGlobalRoleResultPermission;
    }
  }

  const groupPermissionAllows = project.groupPermissions.some(
    (groupPermission) => {
      if (groupPermission.accessType === "SPECIFIC_ROLE") {
        return (
          groupPermission.role?.name === "Project Admin" ||
          roleCanAddEditTestRunResults(groupPermission.role)
        );
      }

      if (groupPermission.accessType === "GLOBAL_ROLE") {
        return user.access !== "NONE" && hasGlobalRoleResultPermission;
      }

      return false;
    }
  );
  if (groupPermissionAllows) {
    return true;
  }

  if (project.defaultAccessType === "GLOBAL_ROLE") {
    return user.access !== "NONE" && hasGlobalRoleResultPermission;
  }

  if (project.defaultAccessType === "SPECIFIC_ROLE") {
    return (
      project.assignedUsers.some(
        (assignment) => assignment.userId === user.id
      ) && roleCanAddEditTestRunResults(project.defaultRole)
    );
  }

  return false;
}

/**
 * Returns true when the template marks a result field required but the
 * submission omits it or supplies an empty value. Emptiness uses the shared
 * TipTap check so rich-text and whitespace-only values count as missing.
 * Returns false (nothing missing) when the template has no required fields.
 * Accepts either the base client or a transaction client.
 */
export async function hasMissingRequiredResultField(
  client: DbClient | TxClient,
  templateId: number | null,
  fieldValues: Array<{ fieldId: number; value: unknown }> | undefined
): Promise<boolean> {
  if (templateId == null) {
    return false;
  }
  const requiredFieldAssignments =
    await client.templateResultAssignment.findMany({
      where: {
        templateId,
        resultField: { isRequired: true, isEnabled: true, isDeleted: false },
      },
      select: { resultFieldId: true },
    });
  if (requiredFieldAssignments.length === 0) {
    return false;
  }
  const submittedValues = new Map(
    (fieldValues ?? []).map((fv) => [fv.fieldId, fv.value])
  );
  return requiredFieldAssignments.some(
    ({ resultFieldId }) =>
      !submittedValues.has(resultFieldId) ||
      isTiptapEmpty(submittedValues.get(resultFieldId))
  );
}

/**
 * True when the project requires a linked Issue on failure, the submitted
 * status is failure-class (its `isFailure` flag is set, not a hardcoded
 * status name), and no Issue is linked. The caller resolves the status flag
 * and the linked-issue count.
 *
 * The gate is inert unless the project has an active issue integration: with
 * no integration the result UI can't link an issue, so enforcing the rule
 * would block submissions the tester can't satisfy. A stored `true` therefore
 * does nothing until an integration is attached (no destructive reset needed).
 */
export function failsIssueOnFailureGate(args: {
  requireIssueOnFailure: boolean;
  hasIssueIntegration: boolean;
  statusIsFailure: boolean;
  linkedIssueCount: number;
}): boolean {
  return (
    args.requireIssueOnFailure &&
    args.hasIssueIntegration &&
    args.statusIsFailure &&
    args.linkedIssueCount === 0
  );
}
