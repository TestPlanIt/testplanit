"use client";
import { ApplicationArea } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  useCreateRoles,
  useUpdateManyRoles,
  useUpsertRolePermission,
} from "~/lib/hooks";
import { RESTRICTED_FIELDS_AREAS } from "~/lib/utils/restrictedFieldsAreas";
import { REVIEW_RELEVANT_AREAS } from "~/lib/utils/reviewAreas";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
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
import { Label } from "@radix-ui/react-label";

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
  const { mutateAsync: createRole } = useCreateRoles();
  const { mutateAsync: updateManyRoles } = useUpdateManyRoles();
  const upsertRolePermission = useUpsertRolePermission();

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
    resolver: zodResolver(formSchema),
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
    | "canAddEdit"
    | "canDelete"
    | "canClose"
    | "canApprove"
    | "canReadSensitive";

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

      onClose();
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
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                  <FormLabel className="flex items-center">
                    {t("common.fields.default")}
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
              <table className="w-full border-collape border-2">
                <thead className="bg-primary/10 border">
                  <tr className="border-b">
                    <th className="p-2 text-left text-sm font-medium">
                      {t("admin.roles.edit.areaHeader")}
                    </th>
                    {/* Add/Edit Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label className="flex items-center gap-1 justify-center">
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
                      </Label>
                    </th>
                    {/* Delete Header Checkbox */}
                    <th className="p-2 text-center text-sm font-medium">
                      <Label className="flex items-center gap-1 justify-center">
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
