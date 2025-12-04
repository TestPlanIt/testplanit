"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  Control,
  UseFormSetValue,
  UseFormWatch,
  UseFormGetValues,
} from "react-hook-form";
import { User, Roles, ProjectAccessType } from "@prisma/client";
import { EditProjectFormData } from "./EditProject";
import {
  getBatchUserEffectiveProjectAccess,
  UserEffectiveAccess,
} from "~/app/actions/getUserEffectiveProjectAccess";

// UI Imports (Add as needed)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { RoleNameCell } from "@/components/tables/RoleNameCell";
import { Loader2 } from "lucide-react";

// Type for user data including their global role
type UserWithRole = User & { role: Roles | null };

interface ProjectUserPermissionsProps {
  projectId: number;
  allUsers: UserWithRole[] | undefined; // All active users with roles
  assignedUsersList: { userId: string }[] | undefined | null; // Add this prop
  roles: Roles[] | undefined; // All available roles
  control: Control<EditProjectFormData>;
  setValue: UseFormSetValue<EditProjectFormData>;
  watch: UseFormWatch<EditProjectFormData>;
  getValues: UseFormGetValues<EditProjectFormData>;
  isLoading?: boolean; // Optional loading state
  defaultProjectAccessType: ProjectAccessType;
  defaultProjectRoleId: string | null; // "NONE" or roleId string
}

// Type for managing individual user permission state in the form
export type UserPermissionFormState = {
  accessType: string;
  roleId: string | null;
};

export function ProjectUserPermissions({
  projectId,
  allUsers,
  assignedUsersList,
  roles,
  control,
  setValue,
  watch,
  getValues,
  isLoading,
  defaultProjectAccessType,
  defaultProjectRoleId,
}: ProjectUserPermissionsProps) {
  const t = useTranslations("admin.projects.edit");

  const userPermissionsState = watch("userPermissions");
  const [effectiveAccess, setEffectiveAccess] = useState<
    Map<string, UserEffectiveAccess>
  >(new Map());
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);

  // Load effective access when component mounts or when assigned users change
  useEffect(() => {
    const loadEffectiveAccess = async () => {
      const assignedUserIds = Object.keys(userPermissionsState || {});
      if (assignedUserIds.length === 0) {
        setEffectiveAccess(new Map());
        return;
      }

      setIsLoadingAccess(true);
      try {
        const accessMap = await getBatchUserEffectiveProjectAccess(
          projectId,
          assignedUserIds
        );
        setEffectiveAccess(accessMap);
      } catch (error) {
        console.error("Failed to load effective access:", error);
      } finally {
        setIsLoadingAccess(false);
      }
    };

    loadEffectiveAccess();
  }, [projectId, userPermissionsState]);

  // --- Handlers ---
  const handleAddUser = (userId: string | null) => {
    if (!userId) return;

    const currentPermissions = getValues("userPermissions") || {};
    if (!currentPermissions[userId]) {
      setValue(
        `userPermissions.${userId}`,
        {
          accessType: "PROJECT_DEFAULT", // Default to project default
          roleId: "NONE",
        },
        { shouldDirty: true }
      );
    }
  };

  const handleClearUserPermission = (userId: string) => {
    const currentPermissions = { ...getValues("userPermissions") };
    if (currentPermissions[userId]) {
      delete currentPermissions[userId];
      setValue("userPermissions" as any, currentPermissions, {
        shouldDirty: true,
      });
    }
  };

  // --- New Handler for Combined Select ---
  const handleCombinedUserAccessChange = (
    userId: string,
    combinedValue: string
  ) => {
    let accessType: string;
    let roleId: string | null;

    if (combinedValue === "PROJECT_DEFAULT") {
      accessType = "PROJECT_DEFAULT";
      roleId = "NONE";
    } else if (combinedValue === "NO_ACCESS") {
      accessType = "NO_ACCESS";
      roleId = "NONE";
    } else if (combinedValue === "GLOBAL_ROLE") {
      accessType = "GLOBAL_ROLE";
      roleId = "NONE";
    } else if (combinedValue.startsWith("ROLE_")) {
      accessType = "SPECIFIC_ROLE";
      roleId = combinedValue.substring(5);
    } else {
      // Should not happen, fallback or error?
      accessType = "PROJECT_DEFAULT";
      roleId = "NONE";
    }

    setValue(`userPermissions.${userId}.accessType`, accessType, {
      shouldDirty: true,
    });
    setValue(`userPermissions.${userId}.roleId`, roleId, { shouldDirty: true });
  };

  // --- Derived State ---
  const assignedUserIds = Object.keys(userPermissionsState || {});
  const availableUsersToAdd =
    allUsers?.filter((u) => !userPermissionsState?.[u.id]) ?? [];

  // AsyncCombobox functions
  const fetchUsers = async (
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ results: UserWithRole[]; total: number }> => {
    const filtered = availableUsersToAdd.filter((user) => {
      const searchString = `${user.name} ${user.email}`.toLowerCase();
      return searchString.includes(query.toLowerCase());
    });

    const start = page * pageSize;
    const end = start + pageSize;
    const paginatedResults = filtered.slice(start, end);

    return {
      results: paginatedResults,
      total: filtered.length,
    };
  };

  const renderUserOption = (user: UserWithRole) => (
    <UserNameCell userId={user.id} hideLink={true} />
  );

  const getUserValue = (user: UserWithRole) => user.id;

  if (isLoading) {
    return <div>{t("loadingUserPermissions")}</div>;
  }

  // Helper function to determine the role display for project default
  const getProjectDefaultRoleDisplay = (
    user: UserWithRole,
    userEffectiveAccess: UserEffectiveAccess | undefined
  ) => {
    // First check if we have effective access data
    if (userEffectiveAccess && userEffectiveAccess.effectiveRoleId) {
      return (
        <RoleNameCell roleId={userEffectiveAccess.effectiveRoleId.toString()} />
      );
    }

    // Fallback to determining based on project defaults
    if (
      defaultProjectAccessType === ProjectAccessType.SPECIFIC_ROLE &&
      defaultProjectRoleId &&
      defaultProjectRoleId !== "NONE"
    ) {
      return <RoleNameCell roleId={defaultProjectRoleId} />;
    } else if (defaultProjectAccessType === ProjectAccessType.GLOBAL_ROLE) {
      return (
        <RoleNameCell roleId={user.roleId ? user.roleId.toString() : null} />
      );
    } else if (defaultProjectAccessType === ProjectAccessType.NO_ACCESS) {
      return <span className="italic text-muted-foreground">-</span>;
    } else {
      // For DEFAULT or any other case
      return (
        <span className="italic text-muted-foreground">
          {t("labels.access.projectDefault")}
        </span>
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Table/List of Assigned Users */}
      <div className="rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {t("tableHeaders.user")}
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {t("tableHeaders.globalRole")}
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                {t("tableHeaders.projectAccess")}
              </th>
              <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground">
                {t("actions.remove")}
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {assignedUserIds.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-4 text-center text-muted-foreground"
                >
                  {t("messages.noUsersAssigned")}
                </td>
              </tr>
            )}
            {assignedUserIds.map((userId) => {
              const user = allUsers?.find((u) => u.id === userId);
              const permission = userPermissionsState?.[userId];

              if (!user || !permission) return null;

              const effectiveRoleDisplay = "";
              let effectiveAccessDisplay = "";

              const currentAccessType = permission.accessType;
              const currentRoleId = permission.roleId;
              const userEffectiveAccess = effectiveAccess.get(userId);

              // Always use the current form state for display to reflect changes immediately
              if (
                currentAccessType === "PROJECT_DEFAULT" ||
                currentAccessType === "DEFAULT" ||
                currentAccessType === ProjectAccessType.DEFAULT
              ) {
                effectiveAccessDisplay = t("labels.access.projectDefault");
              } else if (
                currentAccessType === "NO_ACCESS" ||
                currentAccessType === ProjectAccessType.NO_ACCESS
              ) {
                effectiveAccessDisplay = t("labels.access.noAccess");
              } else if (
                currentAccessType === "GLOBAL_ROLE" ||
                currentAccessType === ProjectAccessType.GLOBAL_ROLE
              ) {
                effectiveAccessDisplay = t("labels.access.usersGlobalRole");
              } else if (
                currentAccessType === "SPECIFIC_ROLE" ||
                currentAccessType === ProjectAccessType.SPECIFIC_ROLE
              ) {
                effectiveAccessDisplay = t("labels.access.specificRole");
              } else {
                // Fallback for any unexpected values
                console.warn(`Unexpected access type: ${currentAccessType}`);
                effectiveAccessDisplay = t("labels.access.projectDefault");
              }

              let combinedValue = "PROJECT_DEFAULT";
              if (
                permission.accessType === "NO_ACCESS" ||
                permission.accessType === ProjectAccessType.NO_ACCESS
              ) {
                combinedValue = "NO_ACCESS";
              } else if (
                permission.accessType === "GLOBAL_ROLE" ||
                permission.accessType === ProjectAccessType.GLOBAL_ROLE
              ) {
                combinedValue = "GLOBAL_ROLE";
              } else if (
                (permission.accessType === "SPECIFIC_ROLE" ||
                  permission.accessType === ProjectAccessType.SPECIFIC_ROLE) &&
                permission.roleId &&
                permission.roleId !== "NONE"
              ) {
                combinedValue = `ROLE_${permission.roleId}`;
              }

              return (
                <tr
                  key={userId}
                  className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  <td className="pl-4 align-middle">
                    <UserNameCell userId={userId} hideLink={true} />
                  </td>
                  <td className="pl-4 align-middle text-muted-foreground">
                    <RoleNameCell
                      roleId={user.roleId ? user.roleId.toString() : null}
                    />
                  </td>
                  <td className="pl-1 align-middle">
                    <Select
                      value={combinedValue}
                      onValueChange={(value) =>
                        handleCombinedUserAccessChange(userId, value)
                      }
                      disabled={isLoadingAccess}
                    >
                      <SelectTrigger className="w-[250px]">
                        {isLoadingAccess ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <span
                              className="truncate"
                              title={effectiveAccessDisplay}
                            >
                              {effectiveAccessDisplay}
                            </span>
                            <span className="ml-1 text-xs text-muted-foreground truncate flex items-center">
                              {/* Show the role based on current form state */}
                              {currentAccessType === "SPECIFIC_ROLE" &&
                              currentRoleId &&
                              currentRoleId !== "NONE" ? (
                                <RoleNameCell roleId={currentRoleId} />
                              ) : currentAccessType === "GLOBAL_ROLE" ? (
                                <RoleNameCell
                                  roleId={
                                    user.roleId ? user.roleId.toString() : null
                                  }
                                />
                              ) : currentAccessType === "PROJECT_DEFAULT" ||
                                currentAccessType === "DEFAULT" ||
                                currentAccessType ===
                                  ProjectAccessType.DEFAULT ? (
                                // For PROJECT_DEFAULT, use helper function
                                getProjectDefaultRoleDisplay(
                                  user,
                                  userEffectiveAccess
                                )
                              ) : currentAccessType === "NO_ACCESS" ? (
                                <span className="italic text-muted-foreground">
                                  -
                                </span>
                              ) : (
                                <span className="italic text-muted-foreground">
                                  {t("labels.none")}
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PROJECT_DEFAULT">
                          {t("labels.access.projectDefault")}
                        </SelectItem>
                        <SelectSeparator />
                        <SelectItem value="NO_ACCESS">
                          {t("labels.access.noAccess")}
                        </SelectItem>
                        <SelectItem value="GLOBAL_ROLE">
                          {t("labels.access.usersGlobalRole")}
                        </SelectItem>
                        <SelectSeparator />
                        {roles?.map((role) => (
                          <SelectItem
                            key={role.id}
                            value={`ROLE_${role.id.toString()}`}
                          >
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="align-middle text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleClearUserPermission(userId)}
                      aria-label={t("actions.removeUser")}
                      disabled={!permission}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add User Combobox */}
      <div className="pt-4">
        <AsyncCombobox<UserWithRole>
          value={null}
          onValueChange={(user) => handleAddUser(user?.id ?? null)}
          fetchOptions={fetchUsers}
          renderOption={renderUserOption}
          getOptionValue={getUserValue}
          placeholder={t("labels.addUser")}
          className="w-full md:w-[300px]"
          pageSize={10}
          showTotal={true}
        />
      </div>
    </div>
  );
}
