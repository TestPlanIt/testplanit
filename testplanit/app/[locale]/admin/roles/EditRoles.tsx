"use client";
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateRoles,
  useUpdateManyRoles,
  useFindManyRolePermission,
  useUpsertRolePermission,
} from "~/lib/hooks";
import { Roles, ApplicationArea } from "@prisma/client";
import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SquarePen } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@radix-ui/react-label";
import { HelpPopover } from "@/components/ui/help-popover";

// Helper to get enum values safely
const applicationAreaValues = Object.values(ApplicationArea);

interface EditRoleModalProps {
  role: Roles;
}

// Define Zod schema for the form including permissions
const EditRoleFormSchema = z.object({
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

type EditRoleFormData = z.infer<typeof EditRoleFormSchema>;

export function EditRoleModal({ role }: EditRoleModalProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateRole } = useUpdateRoles();
  const { mutateAsync: updateManyRoles } = useUpdateManyRoles();
  const { mutateAsync: upsertRolePermission } = useUpsertRolePermission();

  // Fetch existing permissions for this role
  const { data: existingPermissions, isLoading: isLoadingPermissions } =
    useFindManyRolePermission({
      where: { roleId: role.id },
    });

  const handleCancel = () => setOpen(false);

  // Prepare default form values, including permissions
  const defaultFormValues = useMemo(() => {
    // Initialize all areas with default false values first
    const initialPermissions = applicationAreaValues.reduce(
      (acc, area) => {
        acc[area] = { canAddEdit: false, canDelete: false, canClose: false };
        return acc;
      },
      {} as EditRoleFormData["permissions"]
    );

    // Populate with existing permissions, overwriting defaults
    existingPermissions?.forEach((perm) => {
      // Check if the area from the DB is a valid key in our enum-based object
      if (perm.area in initialPermissions) {
        initialPermissions[perm.area] = {
          canAddEdit: perm.canAddEdit,
          canDelete: perm.canDelete,
          canClose: perm.canClose,
        };
      }
    });

    return {
      name: role.name,
      isDefault: role.isDefault,
      permissions: initialPermissions, // Should now match the required type
    };
  }, [role.name, role.isDefault, existingPermissions]);

  const form = useForm<EditRoleFormData>({
    resolver: zodResolver(EditRoleFormSchema),
    defaultValues: defaultFormValues, // Use pre-calculated defaults
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

  // Effect to reset form when modal opens or defaults change
  useEffect(() => {
    if (open) {
      // Only reset if existingPermissions have loaded or there are none
      if (!isLoadingPermissions) {
        reset(defaultFormValues);
      }
    } // Reset dependency includes isLoadingPermissions now
  }, [open, defaultFormValues, reset, isLoadingPermissions]);

  async function onSubmit(data: EditRoleFormData) {
    setIsSubmitting(true);
    try {
      // 1. Update Role name and isDefault status (existing logic)
      if (data.isDefault && !role.isDefault) {
        // Check if default status changed to true
        // Ensure only one role is default
        await updateManyRoles({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      await updateRole({
        where: { id: role.id },
        data: {
          name: data.name,
          isDefault: data.isDefault,
        },
      });

      // 2. Upsert permissions for each ApplicationArea
      const permissionPromises = applicationAreaValues.map(async (area) => {
        const perms = data.permissions[area];
        if (!perms) {
          // Should not happen with current default value logic, but good practice
          console.warn(`Permissions data missing for area: ${area}`);
          return;
        }
        await upsertRolePermission({
          where: { roleId_area: { roleId: role.id, area: area } },
          create: { roleId: role.id, area: area, ...perms },
          update: perms, // Update with the submitted values
        });
      });

      // Wait for all permission updates to complete
      await Promise.all(permissionPromises);

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      // Handle potential errors (e.g., unique constraint on name)
      if (err.info?.prisma && err.info?.code === "P2002") {
        setError("name", {
          type: "custom",
          message: t("admin.roles.edit.errors.nameExists"),
        });
      } else {
        console.error("Error updating role or permissions:", err); // Log other errors
        setError("root", {
          type: "custom",
          message: t("admin.roles.edit.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  // Handlers for header checkboxes
  const handleSelectAll = (
    field: "canAddEdit" | "canDelete" | "canClose",
    checked: boolean
  ) => {
    applicationAreaValues.forEach((area) => {
      // Determine relevance (copied logic from table row)
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

  // Watch permission values to determine header checkbox state (indeterminate/checked)
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
        if (watchedPermissions?.[area]?.[field]) {
          checkedCount++;
        }
      }
    });
    const isChecked = relevantCount > 0 && checkedCount === relevantCount;
    const isIndeterminate = checkedCount > 0 && checkedCount < relevantCount;
    return { checked: isChecked, indeterminate: isIndeterminate };
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("admin.roles.edit.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("admin.roles.edit.title")}
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
                    <Input {...field} />
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
                      disabled={role.isDefault}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Permissions Section */}
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-medium">
                {t("admin.roles.edit.permissionsTitle")}
              </h3>
              {isLoadingPermissions ? (
                // Loading Skeleton
                <div className="space-y-3">
                  {applicationAreaValues.map((area) => (
                    <div
                      key={area}
                      className="flex justify-between items-center"
                    >
                      <Skeleton className="h-5 w-1/3" />
                      <div className="flex gap-4">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Actual Permissions Table
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
                            checked={
                              getHeaderCheckboxState("canAddEdit").checked
                            }
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
                            checked={
                              getHeaderCheckboxState("canDelete").checked
                            }
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
                        area !==
                          ApplicationArea.TestRunResultRestrictedFields &&
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
              )}
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
