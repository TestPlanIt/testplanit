"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateProjects,
  useFindManyRoles,
  useFindManyUserProjectPermission,
  useFindManyGroupProjectPermission,
  useFindManyUser,
  useFindManyProjectAssignment,
  useUpsertUserProjectPermission,
  useDeleteManyUserProjectPermission,
  useFindManyGroups,
  useUpsertGroupProjectPermission,
  useDeleteManyGroupProjectPermission,
  useCreateManyProjectAssignment,
  useDeleteManyProjectAssignment,
} from "~/lib/hooks";
import {
  ProjectAccessType,
  UserProjectPermission,
  GroupProjectPermission,
} from "@prisma/client";
import { useTranslations, useLocale } from "next-intl";
import type { Prisma } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { optionalImageUrlSchema } from "~/lib/schemas/imageUrl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpPopover } from "@/components/ui/help-popover";

import { SquarePen, Bug } from "lucide-react";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DatePickerField } from "@/components/forms/DatePickerField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ExtendedProjects } from "./columns";
import { ProjectUserPermissions } from "./ProjectUserPermissions";
import { ProjectGroupPermissions } from "./ProjectGroupPermissions";
import { toast } from "sonner";
import UploadProjectIcon from "@/components/UploadProjectIcon";

interface EditProjectModalProps {
  project: ExtendedProjects;
  isOpen: boolean;
  onClose: () => void;
}

type SelectedIssueConfig = { id: number; name: string; isDefault?: boolean };

const EditProjectFormSchema = z.object({
  iconUrl: optionalImageUrlSchema,
  name: z.string().min(1, {
    error: "Project Name is required",
  }),
  note: z.string().optional(),
  isCompleted: z.boolean(),
  completedAt: z.date().optional().nullable(),
  defaultAccessType: z.enum(ProjectAccessType),
  defaultRoleId: z.string().nullable(),
  userPermissions: z
    .record(
      z.string(),
      z.object({
        accessType: z.string(),
        roleId: z.string().nullable(),
      })
    )
    .optional(),
  groupPermissions: z
    .record(
      z.string(),
      z.object({
        accessType: z.string(),
        roleId: z.string().nullable(),
      })
    )
    .optional(),
});

// --- Type for User Permission in Form State ---
// We use string for accessType to allow for "PROJECT_DEFAULT"
// We use string | null for roleId to store "NONE" or role ID string
type UserPermissionFormState = {
  accessType: string; // ProjectAccessType | "PROJECT_DEFAULT"
  roleId: string | null;
};

// --- Type for Group Permission in Form State ---
type GroupPermissionFormState = {
  accessType: string; // ProjectAccessType | "PROJECT_DEFAULT"
  roleId: string | null;
};

// Use inferred type from Zod schema directly
type EditProjectFormData = z.infer<typeof EditProjectFormSchema>;

// --- Export Types Needed by Child Component ---
export type {
  EditProjectFormData,
  UserPermissionFormState,
  GroupPermissionFormState,
};

export function EditProjectModal({
  project,
  isOpen,
  onClose,
}: EditProjectModalProps) {
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  const { mutateAsync: updateProject } = useUpdateProjects();
  const { data: roles, isLoading: rolesLoading } = useFindManyRoles(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
    },
    { enabled: isOpen }
  );

  const { data: userPermissionsData, isLoading: userPermsLoading } =
    useFindManyUserProjectPermission(
      {
        where: { projectId: project.id },
      },
      { enabled: isOpen }
    );
  const { data: groupPermissionsData, isLoading: groupPermsLoading } =
    useFindManyGroupProjectPermission(
      {
        where: { projectId: project.id },
        include: { group: true, role: true },
      },
      { enabled: isOpen }
    );

  const { data: projectAssignments, isLoading: assignmentsLoading } =
    useFindManyProjectAssignment(
      {
        where: { projectId: project.id },
        select: { userId: true },
      },
      { enabled: isOpen }
    );

  const { data: allUsers, isLoading: allUsersLoading } = useFindManyUser(
    {
      where: { isActive: true, isDeleted: false },
      include: { role: true },
      orderBy: { name: "asc" },
    },
    { enabled: isOpen }
  );

  const { data: allGroups, isLoading: groupsLoading } = useFindManyGroups(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      include: {
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
        },
      },
    },
    { enabled: isOpen }
  );

  const upsertUserPermission = useUpsertUserProjectPermission({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error upserting user permission:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const deleteManyUserPermission = useDeleteManyUserProjectPermission({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error deleting user permissions:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const upsertGroupPermission = useUpsertGroupProjectPermission({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error upserting group permission:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const deleteManyGroupPermission = useDeleteManyGroupProjectPermission({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error deleting group permissions:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const createManyProjectAssignment = useCreateManyProjectAssignment({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error creating project assignments:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const deleteManyProjectAssignment = useDeleteManyProjectAssignment({
    onSuccess: () => {},
    onError: (error) => {
      console.error("Error deleting project assignments:", error);
      toast.error(tCommon("errors.unknown"));
    },
  });

  const handleCancel = () => onClose();

  // Use inferred type for useForm
  const form = useForm<EditProjectFormData>({
    resolver: zodResolver(EditProjectFormSchema),
    defaultValues: {
      iconUrl: project.iconUrl ?? null,
      name: project.name ?? "",
      note: project.note ?? "",
      isCompleted: project.isCompleted ?? false,
      completedAt: project.completedAt ?? null,
      defaultAccessType:
        project.defaultAccessType ?? ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: project.defaultRoleId?.toString() ?? "NONE",
      userPermissions: {},
      groupPermissions: {},
    },
  });

  const {
    watch,
    setValue,
    control,
    formState: { errors },
    reset,
    handleSubmit,
    setError,
    getValues,
  } = form;

  const isCompleted = watch("isCompleted");
  const defaultAccessType = watch("defaultAccessType");

  const t = useTranslations("admin.projects.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  // Store initial permissions to compare against on submit
  const [initialUserPermissions, setInitialUserPermissions] = useState<Record<
    string,
    UserPermissionFormState
  > | null>(null);
  const [initialGroupPermissions, setInitialGroupPermissions] = useState<Record<
    string,
    GroupPermissionFormState
  > | null>(null);

  // --- Effect to Reset Form when Project or Permissions Data Changes ---
  useEffect(() => {
    // Wait for project, assignments, and initial permissions data to load
    if (
      project &&
      projectAssignments &&
      userPermissionsData &&
      groupPermissionsData &&
      allGroups
    ) {
      // Create a map of existing specific permissions for quick lookup
      const specificPermissionsMap = new Map<string, UserProjectPermission>();
      userPermissionsData.forEach((perm) =>
        specificPermissionsMap.set(perm.userId, perm)
      );

      // Process assigned users, applying specific perms or defaulting
      const processedUserPerms: Record<string, UserPermissionFormState> =
        projectAssignments.reduce(
          (acc, assignment) => {
            const specificPerm = specificPermissionsMap.get(assignment.userId);
            if (specificPerm) {
              // User has a specific permission override
              acc[assignment.userId] = {
                accessType: specificPerm.accessType,
                roleId: specificPerm.roleId?.toString() ?? "NONE",
              };
            } else {
              // User exists in project but uses default permissions
              acc[assignment.userId] = {
                accessType: "PROJECT_DEFAULT",
                roleId: "NONE",
              };
            }
            return acc;
          },
          {} as Record<string, UserPermissionFormState>
        );

      // Create a map of existing specific group permissions
      const specificGroupPermissionsMap = new Map<
        string,
        GroupProjectPermission
      >();
      groupPermissionsData.forEach((perm) =>
        specificGroupPermissionsMap.set(perm.groupId.toString(), perm)
      );

      // Process all available groups to determine their initial state in the form
      const processedGroupPerms: Record<string, GroupPermissionFormState> =
        allGroups.reduce(
          (acc, group) => {
            const groupIdStr = group.id.toString(); // Convert ID to string for key
            const specificPerm = specificGroupPermissionsMap.get(groupIdStr);
            if (specificPerm) {
              // Group has a specific permission override
              acc[groupIdStr] = {
                accessType: specificPerm.accessType,
                roleId: specificPerm.roleId?.toString() ?? "NONE",
              };
            } else {
              // Group uses default permissions (or no specific permission set)
              // We represent this state initially in the form as PROJECT_DEFAULT
              // We only show groups that *could* have permissions (i.e., all non-deleted groups)
              acc[groupIdStr] = {
                accessType: "PROJECT_DEFAULT",
                roleId: "NONE",
              };
            }
            return acc;
          },
          {} as Record<string, GroupPermissionFormState>
        );

      reset({
        iconUrl: project.iconUrl ?? null,
        name: project.name ?? "",
        note: project.note ?? "",
        isCompleted: project.isCompleted ?? false,
        completedAt: project.completedAt ?? null,
        defaultAccessType:
          project.defaultAccessType ?? ProjectAccessType.GLOBAL_ROLE,
        defaultRoleId: project.defaultRoleId?.toString() ?? "NONE",
        userPermissions: processedUserPerms,
        groupPermissions: processedGroupPerms,
      });

      // Store the initial state *after* processing and setting defaults
      setInitialUserPermissions(processedUserPerms);
      setInitialGroupPermissions(processedGroupPerms);
    }
  }, [
    project,
    reset,
    userPermissionsData,
    projectAssignments,
    groupPermissionsData,
    allGroups,
  ]);

  useEffect(() => {
    if (defaultAccessType !== ProjectAccessType.SPECIFIC_ROLE) {
      setValue("defaultRoleId", "NONE");
    }
  }, [defaultAccessType, setValue]);

  useEffect(() => {
    if (!isCompleted) {
      setValue("completedAt", null);
    }
  }, [isCompleted, setValue]);

  // --- onSubmit (use inferred type) ---
  async function onSubmit(data: EditProjectFormData) {
    // --- Pre-checks ---
    if (!initialUserPermissions) {
      console.error("Initial user permissions not loaded.");
      toast.error(tCommon("errors.unknown"));
      return;
    }
    if (!initialGroupPermissions) {
      console.error("Initial group permissions not loaded.");
      toast.error(tCommon("errors.unknown"));
      return;
    }

    setIsSubmitting(true);
    try {
      const roleIdToSend =
        data.defaultRoleId === "NONE" || data.defaultRoleId === null
          ? null
          : parseInt(data.defaultRoleId, 10);
      if (
        data.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        roleIdToSend === null &&
        data.defaultRoleId !== "NONE"
      ) {
        setError("defaultRoleId", {
          type: "manual",
          message: "Invalid Role ID",
        });
        setIsSubmitting(false);
        return;
      }

      await updateProject({
        where: { id: project.id },
        data: {
          iconUrl: data.iconUrl || undefined,
          name: data.name,
          note: data.note,
          isCompleted: data.isCompleted,
          completedAt: data.isCompleted ? data.completedAt : null,
          defaultAccessType: data.defaultAccessType,
          ...(roleIdToSend !== null
            ? {
                defaultRole: {
                  connect: { id: roleIdToSend },
                },
              }
            : {
                defaultRole: {
                  disconnect: true,
                },
              }),
        },
      });

      // --- Handle Project Assignments (User Membership) ---
      const initialAssignedUserIds = new Set(
        projectAssignments?.map((a) => a.userId) ?? []
      );
      const submittedUserIdsSet = new Set(
        Object.keys(data.userPermissions || {})
      );

      const assignmentsToCreate = Object.keys(data.userPermissions || {})
        .filter((userId) => !initialAssignedUserIds.has(userId))
        .map((userId) => ({ userId, projectId: project.id }));

      // Calculate assignments to delete safely
      let assignmentsToDelete: { userId: string; projectId: number }[] = [];
      if (projectAssignments) {
        assignmentsToDelete = projectAssignments
          .filter((assignment) => !submittedUserIdsSet.has(assignment.userId))
          .map((assignment) => ({
            userId: assignment.userId,
            projectId: project.id,
          }));
      }

      let assignmentErrors = false;

      // Create new assignments
      if (assignmentsToCreate.length > 0) {
        try {
          await createManyProjectAssignment.mutateAsync({
            data: assignmentsToCreate,
          });
        } catch (err) {
          console.error("Failed to create project assignments:", err);
          assignmentErrors = true;
        }
      }

      // Delete removed assignments
      if (assignmentsToDelete.length > 0) {
        try {
          await deleteManyProjectAssignment.mutateAsync({
            where: {
              OR: assignmentsToDelete.map((a) => ({
                userId: a.userId,
                projectId: a.projectId,
              })),
            },
          });
        } catch (err) {
          console.error("Failed to delete project assignments:", err);
          assignmentErrors = true;
        }
      }

      // --- Handle User Permission Changes ---
      const permissionsToUpsert: Prisma.UserProjectPermissionUpsertArgs[] = [];
      const permissionIdsToDelete: { userId: string; projectId: number }[] = [];

      const submittedPermissions = data.userPermissions || {};

      // Determine upserts and deletes by comparing initial state with submitted state
      for (const userId in submittedPermissions) {
        const submittedPerm = submittedPermissions[userId];
        const initialPerm = initialUserPermissions[userId];

        if (submittedPerm.accessType === "PROJECT_DEFAULT") {
          // If it was initially specific, mark for deletion (revert to default)
          if (initialPerm && initialPerm.accessType !== "PROJECT_DEFAULT") {
            permissionIdsToDelete.push({ userId, projectId: project.id });
          }
          // If it was already default, do nothing
        } else {
          // Submitted permission is specific (NO_ACCESS, GLOBAL_ROLE, SPECIFIC_ROLE)
          const permRoleId =
            submittedPerm.roleId === "NONE" || submittedPerm.roleId === null
              ? null
              : parseInt(submittedPerm.roleId, 10);

          // Check if roleId is valid when accessType is SPECIFIC_ROLE
          if (
            submittedPerm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
            permRoleId === null
          ) {
            // This should ideally be caught by form validation, but double-check
            console.error(
              `Invalid state: SPECIFIC_ROLE requires a Role ID for user ${userId}`
            );
            continue; // Skip this potentially invalid permission
          }

          const upsertData: Prisma.UserProjectPermissionUpsertArgs = {
            where: { userId_projectId: { userId, projectId: project.id } },
            create: {
              userId,
              projectId: project.id,
              accessType: submittedPerm.accessType as ProjectAccessType, // Cast needed here
              roleId: permRoleId,
            },
            update: {
              accessType: submittedPerm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
          };
          permissionsToUpsert.push(upsertData);
        }
      }

      // Check for users who were initially specific but are now missing (should revert to default -> delete)
      for (const userId in initialUserPermissions) {
        if (
          initialUserPermissions[userId].accessType !== "PROJECT_DEFAULT" &&
          !submittedPermissions[userId]
        ) {
          // User had a specific permission but is no longer in the submitted list
          permissionIdsToDelete.push({ userId, projectId: project.id });
        }
      }

      // --- Execute Permission Updates ---
      let permissionErrors = false;

      // Deletions first
      if (permissionIdsToDelete.length > 0) {
        try {
          await deleteManyUserPermission.mutateAsync({
            where: {
              OR: permissionIdsToDelete.map((id) => ({
                userId: id.userId,
                projectId: id.projectId,
              })),
            },
          });
        } catch (err) {
          console.error("Failed to delete user permissions:", err);
          permissionErrors = true;
        }
      }

      // Then Upserts (one by one for now, check if ZenStack offers batch upsert)
      if (permissionsToUpsert.length > 0) {
        for (const upsertArg of permissionsToUpsert) {
          try {
            await upsertUserPermission.mutateAsync(upsertArg);
          } catch (err) {
            console.error(
              `Failed to upsert permission for user ${upsertArg.where.userId_projectId!.userId}:`,
              err
            );
            permissionErrors = true; // Continue trying others but flag error
          }
        }
      }

      // --- Handle Group Permission Changes (Similar logic to users) ---
      const groupPermissionsToUpsert: Prisma.GroupProjectPermissionUpsertArgs[] =
        [];
      const groupPermissionIdsToDelete: {
        groupId: string;
        projectId: number;
      }[] = [];

      const submittedGroupPermissions = data.groupPermissions || {};

      for (const groupIdStr in submittedGroupPermissions) {
        const submittedPerm = submittedGroupPermissions[groupIdStr];
        const initialPerm = initialGroupPermissions[groupIdStr]; // Use string key

        if (submittedPerm.accessType === "PROJECT_DEFAULT") {
          // If it was initially specific, mark for deletion
          if (initialPerm && initialPerm.accessType !== "PROJECT_DEFAULT") {
            groupPermissionIdsToDelete.push({
              groupId: groupIdStr,
              projectId: project.id,
            });
          }
        } else {
          // Specific group permission
          const permRoleId =
            submittedPerm.roleId === "NONE" || submittedPerm.roleId === null
              ? null
              : parseInt(submittedPerm.roleId, 10);
          if (
            submittedPerm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
            permRoleId === null
          ) {
            console.error(
              `Invalid state: SPECIFIC_ROLE requires a Role ID for group ${groupIdStr}`
            );
            continue;
          }

          const upsertData: Prisma.GroupProjectPermissionUpsertArgs = {
            // Use number for the actual DB operation if the schema expects numbers
            // Assuming Prisma schema uses Int for groupId in the relation table
            where: {
              groupId_projectId: {
                groupId: parseInt(groupIdStr, 10),
                projectId: project.id,
              },
            },
            create: {
              groupId: parseInt(groupIdStr, 10),
              projectId: project.id,
              accessType: submittedPerm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
            update: {
              accessType: submittedPerm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
          };
          groupPermissionsToUpsert.push(upsertData);
        }
      }

      // Check for groups initially specific but now missing
      for (const groupIdStr in initialGroupPermissions) {
        if (
          initialGroupPermissions[groupIdStr].accessType !==
            "PROJECT_DEFAULT" &&
          !submittedGroupPermissions[groupIdStr]
        ) {
          groupPermissionIdsToDelete.push({
            groupId: groupIdStr,
            projectId: project.id,
          });
        }
      }

      // --- Execute Group Permission Updates ---
      // Deletions first
      if (groupPermissionIdsToDelete.length > 0) {
        try {
          // Need to convert groupId back to number for the where clause if schema uses Int
          const whereClauses = groupPermissionIdsToDelete.map((id) => ({
            groupId: parseInt(id.groupId, 10),
            projectId: id.projectId,
          }));

          await deleteManyGroupPermission.mutateAsync({
            where: { OR: whereClauses },
          });
        } catch (err) {
          console.error("Failed to delete group permissions:", err);
          permissionErrors = true;
        }
      }

      // Then Upserts
      if (groupPermissionsToUpsert.length > 0) {
        for (const upsertArg of groupPermissionsToUpsert) {
          try {
            await upsertGroupPermission.mutateAsync(upsertArg);
          } catch (err) {
            // Use number ID in error message if that's what upsertArg.where contains
            console.error(
              `Failed to upsert permission for group ${upsertArg.where.groupId_projectId!.groupId}:`,
              err
            );
            permissionErrors = true;
          }
        }
      }

      // --- Final Feedback & Closing ---
      if (permissionErrors || assignmentErrors) {
        toast.error(tCommon("messages.projectUpdateError")); // Use user's specific error message
        // Keep dialog open on error
      } else {
        toast.success(tCommon("messages.projectUpdated"));
        setIsSubmitting(false); // Stop loading on success
        onClose(); // Use props.onClose
      }
    } catch (err: any) {
      console.error("Failed to update project or permissions:", err);
      if (err.info?.prisma && err.info?.code === "P2002") {
        setError("name", {
          type: "custom",
          message: tCommon("errors.projectNameExists"),
        });
      } else {
        setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
      setIsSubmitting(false); // Stop loading on error
      // Keep dialog open on error
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(newOpenState) => {
        // Only allow changing the state (closing via overlay/escape) if NOT submitting
        // Also check if the new state is actually false (attempting to close)
        if (!isSubmitting && !newOpenState) {
          onClose(); // Use props.onClose
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon">
          <SquarePen className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details">{tGlobal("admin.imports.testmo.mapping.columnSourceDetails")}</TabsTrigger>
                <TabsTrigger value="users">{tGlobal("users.title")}</TabsTrigger>
                <TabsTrigger value="groups">{tGlobal("common.fields.groups")}</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4 pt-4">
                <FormField
                  control={control}
                  name="iconUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.icon")}
                        <HelpPopover helpKey="project.icon" />
                      </FormLabel>
                      <FormControl>
                        <UploadProjectIcon
                          onUpload={field.onChange}
                          initialUrl={field.value ?? undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.name")}
                        <HelpPopover helpKey="project.name" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.description")}
                        <HelpPopover helpKey="project.description" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Project notes..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* --- Combined Default Permissions Section --- */}
                <div className="space-y-4 pt-4 border-t">
                  <FormLabel className="flex items-center">
                    {tGlobal("common.labels.defaultProjectAccess")}
                    <HelpPopover helpKey="project.defaultAccess" />
                  </FormLabel>{" "}
                  <FormField
                    control={control}
                    name="defaultAccessType"
                    render={() => {
                      const currentAccessType =
                        form.getValues("defaultAccessType");
                      const currentRoleId = form.getValues("defaultRoleId");
                      let combinedValue = "";
                      if (currentAccessType === ProjectAccessType.NO_ACCESS) {
                        combinedValue = "NO_ACCESS";
                      } else if (
                        currentAccessType === ProjectAccessType.GLOBAL_ROLE
                      ) {
                        combinedValue = "GLOBAL_ROLE";
                      } else if (
                        currentAccessType === ProjectAccessType.SPECIFIC_ROLE &&
                        currentRoleId &&
                        currentRoleId !== "NONE"
                      ) {
                        combinedValue = `ROLE_${currentRoleId}`;
                      } else {
                        combinedValue = "GLOBAL_ROLE";
                      }

                      const handleAccessChange = (value: string) => {
                        if (value === "NO_ACCESS") {
                          setValue(
                            "defaultAccessType",
                            ProjectAccessType.NO_ACCESS,
                            { shouldValidate: true }
                          );
                          setValue("defaultRoleId", "NONE", {
                            shouldValidate: true,
                          });
                        } else if (value === "GLOBAL_ROLE") {
                          setValue(
                            "defaultAccessType",
                            ProjectAccessType.GLOBAL_ROLE,
                            { shouldValidate: true }
                          );
                          setValue("defaultRoleId", "NONE", {
                            shouldValidate: true,
                          });
                        } else if (value.startsWith("ROLE_")) {
                          const roleId = value.substring(5);
                          setValue(
                            "defaultAccessType",
                            ProjectAccessType.SPECIFIC_ROLE,
                            { shouldValidate: true }
                          );
                          setValue("defaultRoleId", roleId, {
                            shouldValidate: true,
                          });
                        }
                      };

                      // Determine which hint to show based on current access type
                      const getAccessHintKey = () => {
                        if (currentAccessType === ProjectAccessType.NO_ACCESS) {
                          return "labels.accessHints.noAccess";
                        } else if (
                          currentAccessType === ProjectAccessType.GLOBAL_ROLE
                        ) {
                          return "labels.accessHints.globalRole";
                        } else {
                          return "labels.accessHints.specificRole";
                        }
                      };

                      return (
                        <FormItem>
                          <Select
                            onValueChange={handleAccessChange}
                            value={combinedValue}
                            disabled={rolesLoading}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "placeholders.selectDefaultAccess"
                                  )}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="NO_ACCESS">
                                {tGlobal("common.labels.access.noAccess")}
                              </SelectItem>
                              <SelectItem value="GLOBAL_ROLE">
                                {tGlobal("common.labels.access.globalRole")}
                              </SelectItem>
                              <SelectSeparator />
                              {roles?.map((role) => (
                                <SelectItem
                                  key={role.id}
                                  value={`ROLE_${role.id}`}
                                >
                                  {role.name}{" "}
                                  {role.isDefault &&
                                    `(${tCommon("fields.default")})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">
                            {t(getAccessHintKey() as any)}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </div>

                {/* isCompleted Switch (Moved Back Here) */}
                <FormField
                  control={control}
                  name="isCompleted"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.completed")}
                        <HelpPopover helpKey="project.completed" />
                      </FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* completedAt Date Picker (Moved Back Here) */}
                {isCompleted && (
                  <DatePickerField
                    control={control}
                    name="completedAt"
                    label={tCommon("fields.completedOn")}
                    placeholder={tCommon("placeholders.date")}
                    helpKey="project.completedAt"
                  />
                )}
              </TabsContent>

              <TabsContent value="users" className="space-y-4 pt-4">
                <ProjectUserPermissions
                  projectId={project.id}
                  allUsers={allUsers}
                  defaultProjectAccessType={defaultAccessType}
                  defaultProjectRoleId={form.getValues("defaultRoleId")}
                  roles={roles}
                  control={control}
                  setValue={setValue}
                  watch={watch}
                  getValues={getValues}
                  isLoading={
                    assignmentsLoading ||
                    allUsersLoading ||
                    userPermsLoading ||
                    rolesLoading
                  }
                  assignedUsersList={projectAssignments}
                />
              </TabsContent>

              <TabsContent value="groups" className="space-y-4 pt-4">
                <ProjectGroupPermissions
                  projectId={project.id}
                  allGroups={allGroups?.map((g) => ({
                    ...g,
                    users: g.assignedUsers,
                  }))}
                  defaultProjectAccessType={defaultAccessType}
                  defaultProjectRoleId={form.getValues("defaultRoleId")}
                  roles={roles}
                  control={control}
                  setValue={setValue}
                  watch={watch}
                  getValues={getValues}
                  isLoading={groupsLoading || rolesLoading}
                />
              </TabsContent>
            </Tabs>

            <DialogFooter>
              {errors.root && (
                <div className="text-sm text-destructive p-2 rounded">
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("actions.saving")
                  : tCommon("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
