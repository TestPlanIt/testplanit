"use client";

import { useTranslations } from "next-intl";
import {
  Control,
  UseFormSetValue,
  UseFormWatch,
  UseFormGetValues,
} from "react-hook-form";
import {
  Groups as PrismaGroups,
  Roles,
  ProjectAccessType,
} from "@prisma/client";
import { EditProjectFormData } from "./EditProject"; // Removed GroupPermissionFormState import

// UI Imports
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupNameCell } from "@/components/tables/GroupNameCell"; // Corrected import path
import { RoleNameCell } from "@/components/tables/RoleNameCell"; // Import RoleNameCell
import { UserListDisplay } from "@/components/tables/UserListDisplay"; // Import UserListDisplay

// Define the type for Group with included users
type GroupWithUsers = PrismaGroups & {
  users: { userId: string }[];
};

interface ProjectGroupPermissionsProps {
  projectId: number;
  allGroups: GroupWithUsers[] | undefined; // Use the extended type
  roles: Roles[] | undefined; // All available roles
  control: Control<EditProjectFormData>;
  setValue: UseFormSetValue<EditProjectFormData>;
  watch: UseFormWatch<EditProjectFormData>;
  getValues: UseFormGetValues<EditProjectFormData>;
  isLoading?: boolean; // Optional loading state for groups/roles
  defaultProjectAccessType: ProjectAccessType;
  defaultProjectRoleId: string | null; // "NONE" or roleId string
}

export function ProjectGroupPermissions({
  projectId,
  allGroups,
  roles,
  control,
  setValue,
  watch,
  getValues,
  isLoading,
  defaultProjectAccessType,
  defaultProjectRoleId,
}: ProjectGroupPermissionsProps) {
  const t = useTranslations("admin.projects.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common"); // Assuming Shared translations exist

  const groupPermissionsState = watch("groupPermissions");

  // Handler for Combined Select change for a specific group
  const handleCombinedGroupAccessChange = (
    groupId: string,
    combinedValue: string
  ) => {
    let accessType: string;
    let roleId: string | null;

    if (combinedValue === "PROJECT_DEFAULT") {
      accessType = "PROJECT_DEFAULT";
      roleId = "NONE";
    } else if (combinedValue === "NO_ACCESS") {
      accessType = ProjectAccessType.NO_ACCESS; // Use enum value
      roleId = "NONE";
    } else if (combinedValue === "GLOBAL_ROLE") {
      // For groups, GLOBAL_ROLE means each user in the group uses their own global role
      accessType = ProjectAccessType.GLOBAL_ROLE; // Use enum value
      roleId = "NONE";
    } else if (combinedValue.startsWith("ROLE_")) {
      accessType = ProjectAccessType.SPECIFIC_ROLE; // Use enum value
      roleId = combinedValue.substring(5);
    } else {
      // Fallback
      accessType = "PROJECT_DEFAULT";
      roleId = "NONE";
    }

    setValue(`groupPermissions.${groupId}.accessType`, accessType, {
      shouldDirty: true,
    });
    setValue(`groupPermissions.${groupId}.roleId`, roleId, {
      shouldDirty: true,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/4" />
        <div className="rounded-md border p-4 space-y-3">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
    );
  }

  if (!allGroups || allGroups.length === 0) {
    return <div>{t("messages.noGroupsFound")}</div>; // Assuming this key exists
  }

  return (
    <div className="space-y-4">
      <Label>{t("labels.groupProjectAccess")}</Label>
      {/* List of Groups */}
      <div className="rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {tGlobal("reports.dimensions.group")}
              </th>
              {/* Add Members Header */}
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {tCommon("fields.members")}
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {t("tableHeaders.projectAccess")}
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {allGroups.map((group) => {
              const groupIdStr = group.id.toString();
              const permission = groupPermissionsState?.[groupIdStr];

              // Should always have a permission state due to initialization logic
              if (!permission) {
                console.warn(
                  `No permission state found for group ${groupIdStr}, skipping render.`
                );
                return null;
              }

              let effectiveAccessDisplay = "";
              let combinedValue = ""; // For the Select component value

              const currentAccessType = permission.accessType;
              const currentRoleId = permission.roleId;

              // Determine the current combined value for the select dropdown
              if (currentAccessType === "PROJECT_DEFAULT") {
                combinedValue = "PROJECT_DEFAULT";
                effectiveAccessDisplay = tGlobal("common.labels.access.projectDefault");
              } else if (currentAccessType === ProjectAccessType.NO_ACCESS) {
                combinedValue = "NO_ACCESS";
                effectiveAccessDisplay = tGlobal("common.labels.access.noAccess");
              } else if (currentAccessType === ProjectAccessType.GLOBAL_ROLE) {
                combinedValue = "GLOBAL_ROLE";
                effectiveAccessDisplay = tGlobal("common.labels.access.usersGlobalRole");
              } else if (
                currentAccessType === ProjectAccessType.SPECIFIC_ROLE &&
                currentRoleId &&
                currentRoleId !== "NONE"
              ) {
                combinedValue = `ROLE_${currentRoleId}`;
                effectiveAccessDisplay = tGlobal("common.labels.access.specificRole");
              } else {
                // Fallback or inconsistent state - default to Project Default display
                console.warn(
                  `Inconsistent permission state for group ${groupIdStr}: accessType=${currentAccessType}, roleId=${currentRoleId}`
                );
                combinedValue = "PROJECT_DEFAULT";
                effectiveAccessDisplay = tGlobal("common.labels.access.projectDefault");
              }

              return (
                <tr
                  key={groupIdStr}
                  className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  <td className="px-4 align-middle font-medium">
                    <GroupNameCell groupId={groupIdStr} />
                  </td>
                  {/* Add Members Cell */}
                  <td className="px-4 align-middle">
                    <UserListDisplay users={group.users} />{" "}
                    {/* Pass group users */}
                  </td>
                  <td className="px-1 align-middle">
                    {/* Wrap Select and Effective Access in a flex container */}
                    <div className="flex items-center space-x-2">
                      <Select
                        onValueChange={(value) =>
                          handleCombinedGroupAccessChange(groupIdStr, value)
                        }
                        value={combinedValue}
                        disabled={!roles} // Disable if roles haven't loaded
                      >
                        <SelectTrigger className="w-[200px]">
                          {" "}
                          {/* Adjust width if needed */}
                          <SelectValue
                            placeholder={t("placeholders.selectAccess")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PROJECT_DEFAULT">
                            {tGlobal("common.labels.access.projectDefault")}
                          </SelectItem>
                          <SelectSeparator />
                          <SelectItem value="NO_ACCESS">
                            {tGlobal("common.labels.access.noAccess")}
                          </SelectItem>
                          <SelectItem value="GLOBAL_ROLE">
                            {tGlobal("common.labels.access.usersGlobalRole")}
                          </SelectItem>
                          <SelectSeparator />
                          {roles?.map((role) => (
                            <SelectItem key={role.id} value={`ROLE_${role.id}`}>
                              {role.name}{" "}
                              {role.isDefault &&
                                `(${tCommon("fields.default")})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Display the effective access based on selection */}
                      <p className="text-xs text-muted-foreground flex items-center whitespace-nowrap">
                        {" "}
                        {/* Removed pt-1, added whitespace-nowrap */}
                        <span className="mr-1">
                          {t("labels.access.effectiveAccess")}:
                        </span>
                        {/* Render RoleNameCell or text based on logic */}
                        {currentAccessType ===
                          ProjectAccessType.SPECIFIC_ROLE &&
                          currentRoleId &&
                          currentRoleId !== "NONE" && (
                            <RoleNameCell roleId={currentRoleId} />
                          )}
                        {currentAccessType === ProjectAccessType.GLOBAL_ROLE && (
                          <span className="italic text-muted-foreground ml-1">
                            {tGlobal("common.labels.access.usersGlobalRole")}
                          </span>
                        )}
                        {currentAccessType === "PROJECT_DEFAULT" &&
                          defaultProjectAccessType ===
                            ProjectAccessType.SPECIFIC_ROLE &&
                          defaultProjectRoleId &&
                          defaultProjectRoleId !== "NONE" && (
                            <RoleNameCell roleId={defaultProjectRoleId} />
                          )}
                        {currentAccessType === "PROJECT_DEFAULT" &&
                          defaultProjectAccessType ===
                            ProjectAccessType.GLOBAL_ROLE && (
                            <span className="italic text-muted-foreground ml-1">
                              {tGlobal("common.labels.access.usersGlobalRole")}
                            </span>
                          )}
                        {/* Handle text-based displays for other cases */}
                        {(currentAccessType === ProjectAccessType.NO_ACCESS ||
                          (currentAccessType === "PROJECT_DEFAULT" &&
                            (defaultProjectAccessType ===
                              ProjectAccessType.NO_ACCESS ||
                              defaultProjectAccessType ===
                                ProjectAccessType.DEFAULT)) ||
                          (currentAccessType ===
                            ProjectAccessType.SPECIFIC_ROLE &&
                            (!currentRoleId || currentRoleId === "NONE"))) && (
                          <span className="italic text-muted-foreground ml-1">
                            {currentAccessType === ProjectAccessType.NO_ACCESS
                              ? "-"
                              : t("labels.noEffect")}
                          </span>
                        )}
                      </p>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Type for Group Permission in Form State --- Need to export this
export type GroupPermissionFormState = {
  accessType: string; // ProjectAccessType | "PROJECT_DEFAULT"
  roleId: string | null;
};
