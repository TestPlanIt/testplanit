"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { ApplicationArea } from "~/zenstack/models";
import type { Roles } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { RESTRICTED_FIELDS_AREAS } from "~/lib/utils/restrictedFieldsAreas";
import { REVIEW_RELEVANT_AREAS } from "~/lib/utils/reviewAreas";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpPopover } from "@/components/ui/help-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";
import { TriangleAlert } from "lucide-react";
import { Label } from "@radix-ui/react-label";
import { isUniqueConstraintError } from "~/lib/utils/errors";

// Helper to get enum values safely
const applicationAreaValues = Object.values(ApplicationArea);

interface EditRoleProps {
  role: Roles;
  open: boolean;
  onClose: () => void;
}

// Define Zod schema for the form including permissions
function buildEditRoleFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(1, {
      error: t("common.errors.roleNameEmpty"),
    }),
    isDefault: z.boolean(),
    permissions: z.partialRecord(
      z.enum(ApplicationArea),
      z.object({
        canAddEdit: z.boolean(),
        canDelete: z.boolean(),
        canClose: z.boolean(),
        canApprove: z.boolean(),
        canReadSensitive: z.boolean(),
      })
    ),
  });
}

type EditRoleFormData = z.infer<ReturnType<typeof buildEditRoleFormSchema>>;

export function EditRole({ role, open, onClose }: EditRoleProps) {
  const t = useTranslations();
  const tAreas = useTranslations("enums.ApplicationArea");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateRole } =
    useClientQueries(schema).roles.useUpdate();
  const { mutateAsync: upsertRolePermission } =
    useClientQueries(schema).rolePermission.useUpsert();

  // Fetch existing permissions for this role
  const { data: existingPermissions, isLoading: isLoadingPermissions } =
    useClientQueries(schema).rolePermission.useFindMany({
      where: { roleId: role.id },
    });

  // Prepare default form values, including permissions
  const defaultFormValues = useMemo(() => {
    // Initialize all areas with default false values first
    const initialPermissions = applicationAreaValues.reduce(
      (acc, area) => {
        acc[area] = {
          canAddEdit: false,
          canDelete: false,
          canClose: false,
          canApprove: false,
          canReadSensitive: false,
        };
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
          canApprove: perm.canApprove,
          canReadSensitive: perm.canReadSensitive,
        };
      }
    });

    return {
      name: role.name,
      isDefault: role.isDefault,
      permissions: initialPermissions, // Should now match the required type
    };
  }, [role.name, role.isDefault, existingPermissions]);

  const formSchema = useMemo(() => buildEditRoleFormSchema(t), [t]);
  const form = useForm<EditRoleFormData>({
    resolver: standardSchemaResolver(formSchema),
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

  // Reset the form ONCE per dialog open — when existingPermissions first
  // resolves. Re-running reset on every defaultFormValues identity change
  // wipes mid-edit input if React Query refetches in the background and
  // returns a new array reference (same values, fresh ref). A ref guard
  // ensures we only seed the form once per mount, and keepDirtyValues keeps
  // anything the user typed (e.g. a new name) while permissions were loading.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (!isLoadingPermissions && !hasSeededRef.current) {
      reset(defaultFormValues, { keepDirtyValues: true });
      hasSeededRef.current = true;
    }
  }, [defaultFormValues, reset, isLoadingPermissions]);

  async function onSubmit(data: EditRoleFormData) {
    setIsSubmitting(true);
    try {
      // 1. Update Role name and isDefault status. The single-default DB trigger
      // (tpl_single_default_roles) clears the previous default atomically.
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

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      // Handle potential errors (e.g., unique constraint on name)
      if (isUniqueConstraintError(err)) {
        setError("name", {
          type: "custom",
          message: t("admin.roles.add.errors.nameExists"),
        });
      } else {
        console.error("Error updating role or permissions:", err); // Log other errors
        setError("root", {
          type: "custom",
          message: t("common.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  // Handlers for header checkboxes
  type PermissionField =
    "canAddEdit" | "canDelete" | "canClose" | "canApprove" | "canReadSensitive";

  const fieldAppliesToArea = (
    field: PermissionField,
    area: ApplicationArea
  ): boolean =>
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
        area === ApplicationArea.Sessions)) ||
    (field === "canApprove" &&
      (REVIEW_RELEVANT_AREAS as readonly ApplicationArea[]).includes(area)) ||
    (field === "canReadSensitive" &&
      (RESTRICTED_FIELDS_AREAS as readonly ApplicationArea[]).includes(area));

  const handleSelectAll = (field: PermissionField, checked: boolean) => {
    applicationAreaValues.forEach((area) => {
      if (fieldAppliesToArea(field, area)) {
        setValue(`permissions.${area}.${field}`, checked, {
          shouldDirty: true,
        });
      }
    });
  };

  // Watch permission values to determine header checkbox state (indeterminate/checked)
  const watchedPermissions = watch("permissions");
  const getHeaderCheckboxState = (
    field: PermissionField
  ): { checked: boolean; indeterminate: boolean } => {
    let relevantCount = 0;
    let checkedCount = 0;
    applicationAreaValues.forEach((area) => {
      if (fieldAppliesToArea(field, area)) {
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
    <Dialog open={open} onOpenChange={onClose}>
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
                    {t("common.name")}
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
                <FormItem>
                  <div className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={role.isDefault}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center mt-0!">
                      {t("common.fields.default")}
                      <HelpPopover helpKey="role.isDefault" />
                    </FormLabel>
                  </div>
                  {role.isDefault ? (
                    <WarningAlert data-testid="role-default-locked-warning">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        {t("admin.roles.defaultLockedTitle")}
                      </AlertTitle>
                      <AlertDescription>
                        {t("admin.roles.defaultLockedDescription")}
                      </AlertDescription>
                    </WarningAlert>
                  ) : (
                    field.value && (
                      <WarningAlert data-testid="role-set-default-warning">
                        <TriangleAlert className="h-4 w-4" />
                        <AlertTitle>
                          {t("admin.roles.confirmDefaultDescription")}
                        </AlertTitle>
                        <AlertDescription>
                          {t("admin.roles.defaultWarning")}
                        </AlertDescription>
                      </WarningAlert>
                    )
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Permissions Section */}
            <div className="space-y-4 pt-4 border-t">
              <SectionTitle>
                {t("admin.roles.edit.permissionsTitle")}
              </SectionTitle>
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
                <table className="w-full border-collapse border-2">
                  <thead className="bg-primary/10 border">
                    <tr className="border-b">
                      <th className="p-2 text-start text-sm font-medium">
                        {t("admin.roles.edit.areaHeader")}
                      </th>
                      {/* Add/Edit Header Checkbox */}
                      <th className="p-2 text-center text-sm font-medium">
                        <Label className="flex items-center gap-1 justify-center">
                          <Checkbox
                            checked={
                              getHeaderCheckboxState("canAddEdit").checked
                            }
                            onCheckedChange={(checked) =>
                              handleSelectAll("canAddEdit", !!checked)
                            }
                            aria-label={t(
                              "common.aria.selectDeselectAllAddEdit"
                            )}
                            data-state={
                              getHeaderCheckboxState("canAddEdit").indeterminate
                                ? "indeterminate"
                                : getHeaderCheckboxState("canAddEdit").checked
                                  ? "checked"
                                  : "unchecked"
                            }
                          />
                          <span className="flex items-center">
                            {t("common.permissions.addEdit")}

                            <HelpPopover helpKey="role.permissions.canAddEdit" />
                          </span>
                        </Label>
                      </th>
                      {/* Delete Header Checkbox */}
                      <th className="p-2 text-center text-sm font-medium">
                        <Label className="flex items-center gap-1 justify-center">
                          <Checkbox
                            checked={
                              getHeaderCheckboxState("canDelete").checked
                            }
                            onCheckedChange={(checked) =>
                              handleSelectAll("canDelete", !!checked)
                            }
                            aria-label={t(
                              "common.aria.selectDeselectAllDelete"
                            )}
                            data-state={
                              getHeaderCheckboxState("canDelete").indeterminate
                                ? "indeterminate"
                                : getHeaderCheckboxState("canDelete").checked
                                  ? "checked"
                                  : "unchecked"
                            }
                          />
                          <span className="flex items-center">
                            {t("common.actions.delete")}
                            <HelpPopover helpKey="role.permissions.canDelete" />
                          </span>
                        </Label>
                      </th>
                      {/* Close Header Checkbox */}
                      <th className="p-2 text-center text-sm font-medium">
                        <Label className="flex items-center gap-1 justify-center">
                          <Checkbox
                            checked={getHeaderCheckboxState("canClose").checked}
                            onCheckedChange={(checked) =>
                              handleSelectAll("canClose", !!checked)
                            }
                            aria-label={t("common.aria.selectDeselectAllClose")}
                            data-state={
                              getHeaderCheckboxState("canClose").indeterminate
                                ? "indeterminate"
                                : getHeaderCheckboxState("canClose").checked
                                  ? "checked"
                                  : "unchecked"
                            }
                          />
                          <span className="flex items-center">
                            {t("common.actions.complete")}
                            <HelpPopover helpKey="role.permissions.canClose" />
                          </span>
                        </Label>
                      </th>
                      {/* Approve Header Checkbox */}
                      <th className="p-2 text-center text-sm font-medium">
                        <Label className="flex items-center gap-1 justify-center">
                          <Checkbox
                            checked={
                              getHeaderCheckboxState("canApprove").checked
                            }
                            onCheckedChange={(checked) =>
                              handleSelectAll("canApprove", !!checked)
                            }
                            aria-label={t(
                              "common.aria.selectDeselectAllApprove"
                            )}
                            data-state={
                              getHeaderCheckboxState("canApprove").indeterminate
                                ? "indeterminate"
                                : getHeaderCheckboxState("canApprove").checked
                                  ? "checked"
                                  : "unchecked"
                            }
                          />
                          <span className="flex items-center">
                            {t("common.permissions.approve")}
                            <HelpPopover helpKey="role.permissions.canApprove" />
                          </span>
                        </Label>
                      </th>
                      {/* Read Sensitive Header Checkbox */}
                      <th className="p-2 text-center text-sm font-medium">
                        <Label className="flex items-center gap-1 justify-center">
                          <Checkbox
                            checked={
                              getHeaderCheckboxState("canReadSensitive").checked
                            }
                            onCheckedChange={(checked) =>
                              handleSelectAll("canReadSensitive", !!checked)
                            }
                            aria-label={t(
                              "common.aria.selectDeselectAllReadSensitive"
                            )}
                            data-state={
                              getHeaderCheckboxState("canReadSensitive")
                                .indeterminate
                                ? "indeterminate"
                                : getHeaderCheckboxState("canReadSensitive")
                                      .checked
                                  ? "checked"
                                  : "unchecked"
                            }
                          />
                          <span className="flex items-center">
                            {t("common.permissions.readSensitive")}
                            <HelpPopover helpKey="role.permissions.canReadSensitive" />
                          </span>
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

                      const showCanApprove = (
                        REVIEW_RELEVANT_AREAS as readonly ApplicationArea[]
                      ).includes(area);

                      const showCanReadSensitive = (
                        RESTRICTED_FIELDS_AREAS as readonly ApplicationArea[]
                      ).includes(area);

                      return (
                        <tr
                          key={area}
                          className="border-b last:border-b-0 hover:bg-muted/50"
                        >
                          {/* Area Name */}
                          <td className="p-2 align-middle">
                            <span className="font-medium">{tAreas(area)}</span>
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
                                        aria-label={`${tAreas(area)} ${t("common.permissions.addEdit")}`}
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
                                        aria-label={`${tAreas(area)} ${t("common.actions.delete")}`}
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
                                        aria-label={`${tAreas(area)} ${t("common.actions.complete")}`}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          {/* Approve Switch */}
                          <td className="p-2 align-middle text-center">
                            {showCanApprove ? (
                              <FormField
                                control={control}
                                name={`permissions.${area}.canApprove`}
                                render={({ field }) => (
                                  <FormItem className="flex justify-center items-center space-x-0 space-y-0">
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        aria-label={`${tAreas(area)} ${t("common.permissions.approve")}`}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          {/* Read Sensitive Switch */}
                          <td className="p-2 align-middle text-center">
                            {showCanReadSensitive ? (
                              <FormField
                                control={control}
                                name={`permissions.${area}.canReadSensitive`}
                                render={({ field }) => (
                                  <FormItem className="flex justify-center items-center space-x-0 space-y-0">
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        aria-label={`${tAreas(area)} ${t("common.permissions.readSensitive")}`}
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
              <Button variant="outline" type="button" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.actions.submitting")
                  : t("common.actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
