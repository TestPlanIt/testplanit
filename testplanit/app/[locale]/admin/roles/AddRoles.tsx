"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { FirstDefaultNotice } from "@/components/admin/FirstDefaultNotice";
import { schema } from "~/zenstack/schema";
import { ApplicationArea } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RESTRICTED_FIELDS_AREAS } from "~/lib/utils/restrictedFieldsAreas";
import { REVIEW_RELEVANT_AREAS } from "~/lib/utils/reviewAreas";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";

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
} from "@/components/ui/dialog";
import { HelpPopover } from "@/components/ui/help-popover";
import { Switch } from "@/components/ui/switch";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";
import { TriangleAlert } from "lucide-react";
import { Label } from "radix-ui";
import { isUniqueConstraintError } from "~/lib/utils/errors";

// Helper to get enum values safely (copied from EditRoles)
const applicationAreaValues = Object.values(ApplicationArea);

// Define Zod schema for the form including permissions (copied from EditRoles)
function buildAddRoleFormSchema(t: (key: any) => string) {
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

type AddRoleFormData = z.infer<ReturnType<typeof buildAddRoleFormSchema>>;

interface AddRoleProps {
  open: boolean;
  onClose: () => void;
}

export function AddRole({ open, onClose }: AddRoleProps) {
  const t = useTranslations();
  const tAreas = useTranslations("enums.ApplicationArea");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createRole } =
    useClientQueries(schema).roles.useCreate();

  // The first row of a catalog with no default becomes it (the DB also
  // refuses to let a catalog lose its default once it has one).
  const { data: currentDefault, isLoading: defaultLoading } = useClientQueries(
    schema
  ).roles.useFindFirst({
    where: { isDefault: true, isDeleted: false },
  });
  const mustBeDefault = !defaultLoading && !currentDefault;
  const upsertRolePermission =
    useClientQueries(schema).rolePermission.useUpsert();

  // Initialize permissions with all false values
  const initialPermissions = useMemo(
    () =>
      applicationAreaValues.reduce(
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
        {} as AddRoleFormData["permissions"]
      ),
    []
  );

  const formSchema = useMemo(() => buildAddRoleFormSchema(t), [t]);
  const form = useForm<AddRoleFormData>({
    resolver: standardSchemaResolver(formSchema),
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
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

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
      area !== ApplicationArea.AutomatedExecution &&
      area !== ApplicationArea.FailurePatterns &&
      area !== ApplicationArea.Alerts &&
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

  // --- Start Re-added Handlers and Watcher ---
  const handleSelectAll = (field: PermissionField, checked: boolean) => {
    applicationAreaValues.forEach((area) => {
      if (fieldAppliesToArea(field, area)) {
        setValue(`permissions.${area}.${field}`, checked, {
          shouldDirty: true,
        });
      }
    });
  };

  const watchedPermissions = watch("permissions");
  const getHeaderCheckboxState = (
    field: PermissionField
  ): { checked: boolean; indeterminate: boolean } => {
    let relevantCount = 0;
    let checkedCount = 0;
    applicationAreaValues.forEach((area) => {
      if (fieldAppliesToArea(field, area)) {
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
    if (mustBeDefault) {
      setValue("isDefault", true);
    }
  }, [mustBeDefault, setValue]);

  async function onSubmit(data: AddRoleFormData) {
    setIsSubmitting(true);
    let newRole: { id: number } | undefined;
    try {
      // 1. Create the new Role record (without permissions). The single-default
      // DB trigger (tpl_single_default_roles) clears the previous default
      // atomically when this role is created as the default.
      newRole = await createRole({
        data: {
          name: data.name,
          isDefault: data.isDefault || mustBeDefault,
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

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      // Error Handling (check for unique constraint, log others)
      if (isUniqueConstraintError(err)) {
        setError("name", {
          type: "custom",
          message: t("admin.roles.add.errors.nameExists"),
        });
      } else {
        console.error("Error creating role or permissions:", err);
        setError("root", {
          type: "custom",
          message: t("common.errors.unknown"),
        });
      }
      // Optional: Rollback? If role was created but permissions failed?
      // Depends on desired transactionality. For now, we show an error.
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
                    {t("common.name")}
                    <HelpPopover helpKey="role.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={t("common.name")} {...field} />
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
                  <div className="flex flex-row items-center space-y-0 space-x-3">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={mustBeDefault}
                      />
                    </FormControl>
                    <FormLabel className="mt-0! flex items-center">
                      {t("common.fields.default")}
                      <HelpPopover helpKey="role.isDefault" />
                    </FormLabel>
                  </div>
                  {mustBeDefault && <FirstDefaultNotice />}
                  {field.value && !mustBeDefault && (
                    <WarningAlert data-testid="role-set-default-warning">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        {t("admin.roles.confirmDefaultDescription")}
                      </AlertTitle>
                      <AlertDescription>
                        {t("admin.roles.defaultWarning")}
                      </AlertDescription>
                    </WarningAlert>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Permissions Table Section (moved here) */}
            <div className="space-y-4 border-t pt-4">
              <SectionTitle>
                {t("admin.roles.edit.permissionsTitle")}
              </SectionTitle>
              <table className="w-full border-collapse border-2">
                <thead className="border bg-primary/10">
                  <tr className="border-b">
                    <th className="p-2 text-start text-sm font-medium">
                      {t("admin.roles.edit.areaHeader")}
                    </th>
                    {/* Add/Edit Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label.Root className="flex items-center justify-center gap-1">
                        <Checkbox
                          checked={getHeaderCheckboxState("canAddEdit").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canAddEdit", !!checked)
                          }
                          aria-label={t("common.aria.selectDeselectAllAddEdit")}
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
                      </Label.Root>
                    </th>
                    {/* Delete Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label.Root className="flex items-center justify-center gap-1">
                        <Checkbox
                          checked={getHeaderCheckboxState("canDelete").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canDelete", !!checked)
                          }
                          aria-label={t("common.aria.selectDeselectAllDelete")}
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
                      </Label.Root>
                    </th>
                    {/* Close Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label.Root className="flex items-center justify-center gap-1">
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
                      </Label.Root>
                    </th>
                    {/* Approve Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label.Root className="flex items-center justify-center gap-1">
                        <Checkbox
                          checked={getHeaderCheckboxState("canApprove").checked}
                          onCheckedChange={(checked) =>
                            handleSelectAll("canApprove", !!checked)
                          }
                          aria-label={t("common.aria.selectDeselectAllApprove")}
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
                      </Label.Root>
                    </th>
                    {/* Read Sensitive Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label.Root className="flex items-center justify-center gap-1">
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
                      </Label.Root>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {applicationAreaValues.map((area) => {
                    // Determine which controls are relevant for the area
                    let showDelete =
                      area !== ApplicationArea.Documentation &&
                      area !== ApplicationArea.AutomatedExecution &&
                      area !== ApplicationArea.FailurePatterns &&
                      area !== ApplicationArea.Alerts &&
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
                        <td className="p-2 text-center align-middle">
                          {showAddEdit ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canAddEdit`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-center space-y-0 space-x-0">
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
                        <td className="p-2 text-center align-middle">
                          {showDelete ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canDelete`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-center space-y-0 space-x-0">
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
                        <td className="p-2 text-center align-middle">
                          {showClose ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canClose`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-center space-y-0 space-x-0">
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
                        <td className="p-2 text-center align-middle">
                          {showCanApprove ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canApprove`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-center space-y-0 space-x-0">
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
                        <td className="p-2 text-center align-middle">
                          {showCanReadSensitive ? (
                            <FormField
                              control={control}
                              name={`permissions.${area}.canReadSensitive`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-center space-y-0 space-x-0">
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
            </div>
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive p-2 text-sm text-destructive-foreground"
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
