"use client";
import { useState, useMemo, useEffect } from "react";
import {
  useCreateRoles,
  useUpdateManyRoles,
  useUpsertRolePermission,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";
import { ApplicationArea } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CirclePlus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

import {
  Form,
  FormControl,
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
import { Label } from "@radix-ui/react-label";
import { HelpPopover } from "@/components/ui/help-popover";

// Helper to get enum values safely (copied from EditRoles)
const applicationAreaValues = Object.values(ApplicationArea);

// Define Zod schema for the form including permissions (copied from EditRoles)
const AddRoleFormSchema = z.object({
  name: z.string().min(1, {
    error: "Role name cannot be empty",
  }),
  isDefault: z.boolean(),
  permissions: z.partialRecord(
    z.enum(ApplicationArea),
    z.object({
      canAddEdit: z.boolean(),
      canDelete: z.boolean(),
      canClose: z.boolean(),
    })
  ),
});

type AddRoleFormData = z.infer<typeof AddRoleFormSchema>;

export function AddRoleModal() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createRole } = useCreateRoles();
  const { mutateAsync: updateManyRoles } = useUpdateManyRoles();
  const upsertRolePermission = useUpsertRolePermission();

  const handleCancel = () => setOpen(false);

  // Initialize permissions with all false values
  const initialPermissions = useMemo(
    () =>
      applicationAreaValues.reduce(
        (acc, area) => {
          acc[area] = { canAddEdit: false, canDelete: false, canClose: false };
          return acc;
        },
        {} as AddRoleFormData["permissions"]
      ),
    []
  );

  const form = useForm<AddRoleFormData>({
    resolver: zodResolver(AddRoleFormSchema),
    defaultValues: {
      name: "",
      isDefault: false,
      permissions: initialPermissions,
    },
  });

  const {
    control,
    setValue,
    watch,
    reset,
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  // --- Start Re-added Handlers and Watcher ---
  const handleSelectAll = (
    field: "canAddEdit" | "canDelete" | "canClose",
    checked: boolean
  ) => {
    applicationAreaValues.forEach((area) => {
      // Determine relevance
      const isRelevant =
        (field === "canAddEdit" &&
          area !== ApplicationArea.ClosedTestRuns &&
          area !== ApplicationArea.ClosedSessions) ||
        (field === "canDelete" &&
          area !== ApplicationArea.Documentation &&
          area !== ApplicationArea.TestCaseRestrictedFields &&
          area !== ApplicationArea.TestRunResultRestrictedFields &&
          area !== ApplicationArea.SessionsRestrictedFields &&
          area !== ApplicationArea.Tags) ||
        (field === "canClose" &&
          (area === ApplicationArea.TestRuns ||
            area === ApplicationArea.Sessions));

      if (isRelevant) {
        setValue(`permissions.${area}.${field}`, checked, {
          shouldDirty: true,
        });
      }
    });
  };

  const watchedPermissions = watch("permissions");
  const getHeaderCheckboxState = (
    field: "canAddEdit" | "canDelete" | "canClose"
  ): { checked: boolean; indeterminate: boolean } => {
    let relevantCount = 0;
    let checkedCount = 0;
    applicationAreaValues.forEach((area) => {
      const isRelevant =
        (field === "canAddEdit" &&
          area !== ApplicationArea.ClosedTestRuns &&
          area !== ApplicationArea.ClosedSessions) ||
        (field === "canDelete" &&
          area !== ApplicationArea.Documentation &&
          area !== ApplicationArea.TestCaseRestrictedFields &&
          area !== ApplicationArea.TestRunResultRestrictedFields &&
          area !== ApplicationArea.SessionsRestrictedFields &&
          // Exclude Tags and Issues for Delete
          area !== ApplicationArea.Tags) ||
        (field === "canClose" &&
          (area === ApplicationArea.TestRuns ||
            area === ApplicationArea.Sessions));

      if (isRelevant) {
        relevantCount++;
        // Use optional chaining as watchedPermissions might initially be undefined briefly
        if (watchedPermissions?.[area]?.[field]) {
          checkedCount++;
        }
      }
    });
    const isChecked = relevantCount > 0 && checkedCount === relevantCount;
    const isIndeterminate = checkedCount > 0 && checkedCount < relevantCount;
    return { checked: isChecked, indeterminate: isIndeterminate };
  };
  // --- End Re-added Handlers and Watcher ---

  useEffect(() => {
    // Reset form when modal opens
    if (open) {
      reset({
        name: "",
        isDefault: false,
        permissions: initialPermissions,
      });
    }
  }, [open, reset, initialPermissions]);

  async function onSubmit(data: AddRoleFormData) {
    setIsSubmitting(true);
    let newRole: { id: number } | undefined;
    try {
      // 1. Handle default role status update (if applicable)
      if (data.isDefault) {
        await updateManyRoles({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      // 2. Create the new Role record (without permissions)
      newRole = await createRole({
        data: {
          name: data.name,
          isDefault: data.isDefault,
          // Permissions are NOT included here
        },
      });

      if (!newRole?.id) {
        throw new Error("Failed to create role or retrieve its ID.");
      }

      // Assign to a new const after the null check for type safety within the map
      const createdRole = newRole;

      // 3. Create RolePermission records for the new role
      const permissionPromises = applicationAreaValues.map(async (area) => {
        const perms = data.permissions[area];
        if (!perms) {
          console.warn(`Permissions data missing for area: ${area}`);
          return;
        }
        await upsertRolePermission.mutateAsync({
          where: { roleId_area: { roleId: createdRole.id, area: area } },
          create: { roleId: createdRole.id, area: area, ...perms },
          update: perms, // Effectively ignored on create, but needed for upsert args
        });
      });

      // Wait for all permission creations to complete
      await Promise.all(permissionPromises);

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      // Error Handling (check for unique constraint, log others)
      if (err.info?.prisma && err.info?.code === "P2002") {
        setError("name", {
          type: "custom",
          message: t("admin.roles.add.errors.nameExists"),
        });
      } else {
        console.error("Error creating role or permissions:", err);
        setError("root", {
          type: "custom",
          message: t("admin.roles.add.errors.unknown"),
        });
      }
      // Optional: Rollback? If role was created but permissions failed?
      // Depends on desired transactionality. For now, we show an error.
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CirclePlus className="w-4" />
          <span className="hidden md:inline">
            {t("admin.roles.add.button")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("admin.roles.add.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("admin.roles.add.title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {t("admin.roles.fields.name")}
                    <HelpPopover helpKey="role.name" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("admin.roles.fields.name")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                  <FormLabel className="flex items-center">
                    {t("admin.roles.fields.default")}
                    <HelpPopover helpKey="role.isDefault" />
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Permissions Table Section (moved here) */}
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-medium">
                {t("admin.roles.edit.permissionsTitle")}
              </h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left font-medium text-muted-foreground">
                      {t("admin.roles.edit.areaHeader")}
                    </th>
                    {/* Add/Edit Header Checkbox */}
                    <th className="p-2 text-center font-medium text-muted-foreground w-24">
                      <Label className="flex items-center gap-1 justify-center">
                        <Checkbox
                          checked={getHeaderCheckboxState("canAddEdit").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canAddEdit", !!checked)
                          }
                          aria-label="Select/Deselect All Add/Edit"
                          data-state={
                            getHeaderCheckboxState("canAddEdit").indeterminate
                              ? "indeterminate"
                              : getHeaderCheckboxState("canAddEdit").checked
                                ? "checked"
                                : "unchecked"
                          }
                        />
                        {t("common.permissions.addEdit")}
                        <HelpPopover helpKey="role.permissions.canAddEdit" />
                      </Label>
                    </th>
                    {/* Delete Header Checkbox */}
                    <th className="p-2 text-center font-medium text-muted-foreground w-24">
                      <Label className="flex items-center gap-1 justify-center">
                        <Checkbox
                          checked={getHeaderCheckboxState("canDelete").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canDelete", !!checked)
                          }
                          aria-label="Select/Deselect All Delete"
                          data-state={
                            getHeaderCheckboxState("canDelete").indeterminate
                              ? "indeterminate"
                              : getHeaderCheckboxState("canDelete").checked
                                ? "checked"
                                : "unchecked"
                          }
                        />
                        {t("common.permissions.delete")}
                        <HelpPopover helpKey="role.permissions.canDelete" />
                      </Label>
                    </th>
                    {/* Close Header Checkbox */}
                    <th className="p-2 text-center font-medium text-muted-foreground w-24">
                      <Label className="flex items-center gap-1 justify-center">
                        <Checkbox
                          checked={getHeaderCheckboxState("canClose").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canClose", !!checked)
                          }
                          aria-label="Select/Deselect All Close"
                          data-state={
                            getHeaderCheckboxState("canClose").indeterminate
                              ? "indeterminate"
                              : getHeaderCheckboxState("canClose").checked
                                ? "checked"
                                : "unchecked"
                          }
                        />
                        {t("common.permissions.close")}
                        <HelpPopover helpKey="role.permissions.canClose" />
                      </Label>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {applicationAreaValues.map((area) => {
                    // Determine which controls are relevant for the area
                    let showDelete =
                      area !== ApplicationArea.Documentation &&
                      area !== ApplicationArea.TestCaseRestrictedFields &&
                      area !== ApplicationArea.TestRunResultRestrictedFields &&
                      area !== ApplicationArea.SessionsRestrictedFields;

                    // Specifically hide Delete for Tags and Issues
                    if (area === ApplicationArea.Tags) {
                      showDelete = false;
                    }

                    const showClose =
                      area === ApplicationArea.TestRuns ||
                      area === ApplicationArea.Sessions;

                    const showAddEdit =
                      area !== ApplicationArea.ClosedTestRuns &&
                      area !== ApplicationArea.ClosedSessions;

                    return (
                      <tr
                        key={area}
                        className="border-b last:border-b-0 hover:bg-muted/50"
                      >
                        {/* Area Name */}
                        <td className="p-2 align-middle">
                          <span className="font-medium">
                            {t(`enums.ApplicationArea.${area}`)}
                          </span>
                        </td>
                        {/* Add/Edit Switch */}
                        <td className="p-2 align-middle text-center">
                          {showAddEdit ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canAddEdit`}
                              render={({ field }) => (
                                <FormItem className="flex justify-center items-center space-x-0 space-y-0">
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      aria-label={`${t(`enums.ApplicationArea.${area}`)} ${t("common.permissions.addEdit")}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        {/* Delete Switch */}
                        <td className="p-2 align-middle text-center">
                          {showDelete ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canDelete`}
                              render={({ field }) => (
                                <FormItem className="flex justify-center items-center space-x-0 space-y-0">
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      aria-label={`${t(`enums.ApplicationArea.${area}`)} ${t("common.permissions.delete")}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        {/* Close Switch */}
                        <td className="p-2 align-middle text-center">
                          {showClose ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canClose`}
                              render={({ field }) => (
                                <FormItem className="flex justify-center items-center space-x-0 space-y-0">
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      aria-label={`${t(`enums.ApplicationArea.${area}`)} ${t("common.permissions.close")}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.status.submitting")
                  : t("common.actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
