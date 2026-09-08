"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Status } from "~/zenstack/models";
import { useCallback, useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ColorPicker } from "@/components/ColorPicker";
import DynamicIcon from "@/components/DynamicIcon";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { IconName } from "~/types/globals";

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
import { useTranslations } from "next-intl";
import { isUniqueConstraintError } from "~/lib/utils/errors";

const createEditStatusFormSchema = (
  t: ReturnType<typeof useTranslations<"admin.statuses.edit">>,
  tAdd: ReturnType<typeof useTranslations<"admin.statuses.add">>
) => {
  return z.object({
    name: z.string().min(1),
    systemName: z.string(),
    aliases: z
      .string()
      .regex(/^$|^(?:[A-Za-z][A-Za-z0-9_]*)(?:,(?:[A-Za-z][A-Za-z0-9_]*))*$/, {
        message: tAdd("errors.aliasesInvalid"),
      })
      .optional()
      .nullable(),
    colorId: z.number(),
    isEnabled: z.boolean(),
    isSuccess: z.boolean(),
    isFailure: z.boolean(),
    isCompleted: z.boolean(),
    scope: z.array(z.number()).optional(),
    projects: z.array(z.number()).optional(),
  });
};

interface ExtendedStatus extends Status {
  scope: { scopeId: number }[];
  projects: { projectId: number }[];
}

interface EditStatusProps {
  status: ExtendedStatus;
  open: boolean;
  onClose: () => void;
}

export function EditStatus({ status, open, onClose }: EditStatusProps) {
  const t = useTranslations("admin.statuses.edit");
  const tAdd = useTranslations("admin.statuses.add");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(
    status.colorId
  );

  const { mutateAsync: updateStatus } =
    useClientQueries(schema).status.useUpdate();
  const { mutateAsync: createManyStatusScopeAssignment } =
    useClientQueries(schema).statusScopeAssignment.useCreateMany();
  const { mutateAsync: deleteManyStatusScopeAssignment } =
    useClientQueries(schema).statusScopeAssignment.useDeleteMany();
  const { mutateAsync: createManyProjectStatusAssignment } =
    useClientQueries(schema).projectStatusAssignment.useCreateMany();
  const { mutateAsync: deleteManyProjectStatusAssignment } =
    useClientQueries(schema).projectStatusAssignment.useDeleteMany();

  const { data: scopes } = useClientQueries(schema).statusScope.useFindMany();

  type ScopeOption = NonNullable<typeof scopes>[number];

  const fetchScopeOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (scopes ?? []).filter((scope) =>
        scope.name.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [scopes]
  );

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  type ProjectOption = NonNullable<typeof projects>[number];

  const fetchProjectOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (projects ?? []).filter((project) =>
        project.name.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [projects]
  );

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
    form.setValue("colorId", colorId, { shouldValidate: true });
  };

  const EditStatusFormSchema = createEditStatusFormSchema(t, tAdd);

  type EditStatusFormData = z.infer<typeof EditStatusFormSchema>;

  const form = useForm<EditStatusFormData>({
    resolver: standardSchemaResolver(EditStatusFormSchema),
    defaultValues: {
      name: status.name,
      systemName: status.systemName,
      aliases: status.aliases ?? "",
      colorId: status.colorId,
      isEnabled: status.isEnabled,
      isSuccess: status.isSuccess,
      isFailure: status.isFailure,
      isCompleted: status.isCompleted,
      scope: status.scope.map((p) => p.scopeId),
      projects: status.projects.map((p) => p.projectId),
    },
  });

  const {
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: EditStatusFormData) {
    setIsSubmitting(true);
    try {
      const colorIdToUse = data.colorId;
      if (typeof colorIdToUse !== "number") {
        console.error("Color ID is missing.");
        form.setError("colorId", {
          type: "manual",
          message: tAdd("errors.missingColor"),
        });
        form.setError("root", {
          type: "manual",
          message: tAdd("errors.missingColor"),
        });
        setIsSubmitting(false);
        return;
      }

      const statusUpdateData = {
        name: data.name,
        systemName: data.systemName,
        aliases: data.aliases ?? null,
        colorId: colorIdToUse,
        isEnabled: data.isEnabled,
        isSuccess: data.isSuccess,
        isFailure: data.isFailure,
        isCompleted: data.isCompleted,
      };

      await updateStatus({
        where: { id: status.id },
        data: statusUpdateData,
      });

      await deleteManyStatusScopeAssignment({ where: { statusId: status.id } });
      await deleteManyProjectStatusAssignment({
        where: { statusId: status.id },
      });

      if (Array.isArray(data.scope) && data.scope.length > 0) {
        await createManyStatusScopeAssignment({
          data: data.scope.map((scopeId: number) => ({
            statusId: status.id,
            scopeId: scopeId,
          })),
        });
      }

      if (status.systemName === "untested") {
        if (projects && Array.isArray(data.projects)) {
          await createManyProjectStatusAssignment({
            data: projects.map((project) => ({
              projectId: project.id,
              statusId: status.id,
            })),
          });
        }
      } else if (Array.isArray(data.projects) && data.projects.length > 0) {
        await createManyProjectStatusAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            statusId: status.id,
          })),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        form.setError("name", {
          type: "custom",
          message: tAdd("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tGlobal("common.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, (validationErrors) => {
              console.error("Form Validation Errors:", validationErrors);
            })}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <div className="w-16 h-full">
                <ColorPicker
                  initialColorId={selectedColorId}
                  onColorSelect={handleColorSelect}
                />
                <FormField
                  control={form.control}
                  name="colorId"
                  render={() => <FormMessage className="mt-1" />}
                />
              </div>
              <div className="w-full">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("name")}
                        <HelpPopover helpKey="status.name" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="systemName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.systemName")}
                    <HelpPopover helpKey="status.systemName" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} disabled />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="aliases"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.aliases")}
                    <HelpPopover helpKey="status.aliases" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tAdd("aliasesHelp")}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex w-full items-center space-x-8">
              <FormField
                control={form.control}
                name="isEnabled"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={status.systemName === "untested"}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.enabled")}
                        <HelpPopover helpKey="status.isEnabled" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isSuccess"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(newIsSuccess) => {
                            const isSuccess = newIsSuccess === true;
                            form.setValue("isSuccess", isSuccess);
                            if (isSuccess) form.setValue("isFailure", false);
                          }}
                          disabled={status.systemName === "untested"}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.success")}
                        <HelpPopover helpKey="status.isSuccess" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isFailure"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(newIsFailure) => {
                            const isFailure = newIsFailure === true;
                            form.setValue("isFailure", isFailure);
                            if (isFailure) form.setValue("isSuccess", false);
                          }}
                          disabled={status.systemName === "untested"}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.failure")}
                        <HelpPopover helpKey="status.isFailure" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isCompleted"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={status.systemName === "untested"}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.completed")}
                        <HelpPopover helpKey="status.isCompleted" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </div>
            {status.systemName !== "untested" ? (
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="scope"
                  render={() => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.scope")}
                        <HelpPopover helpKey="status.scope" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="scope"
                          render={({ field }) => {
                            const selectedScopes = (scopes ?? []).filter(
                              (scope) => field.value?.includes(scope.id)
                            );
                            return (
                              <MultiAsyncCombobox<ScopeOption>
                                value={selectedScopes}
                                onValueChange={(selected) =>
                                  field.onChange(
                                    selected.map((scope) => scope.id)
                                  )
                                }
                                fetchOptions={fetchScopeOptions}
                                renderOption={(scope) => (
                                  <div className="flex min-w-0 items-center gap-2">
                                    <DynamicIcon
                                      name={scope.icon as IconName}
                                      size={16}
                                    />
                                    <span className="truncate">
                                      {scope.name}
                                    </span>
                                  </div>
                                )}
                                renderSelectedOption={(scope) => (
                                  <span>{scope.name}</span>
                                )}
                                getOptionValue={(scope) => scope.id}
                                getOptionLabel={(scope) => scope.name}
                                placeholder={tCommon("fields.scope")}
                                className="w-full"
                                pageSize={20}
                                showTotal
                              />
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="projects"
                  render={() => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.projects")}
                        <HelpPopover helpKey="status.projects" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="projects"
                          render={({ field }) => {
                            const selectedProjects = (projects ?? []).filter(
                              (project) => field.value?.includes(project.id)
                            );
                            return (
                              <MultiAsyncCombobox<ProjectOption>
                                value={selectedProjects}
                                onValueChange={(selected) =>
                                  field.onChange(
                                    selected.map((project) => project.id)
                                  )
                                }
                                fetchOptions={fetchProjectOptions}
                                renderOption={(project) => (
                                  <div className="flex min-w-0 items-center gap-2">
                                    <ProjectIcon
                                      iconUrl={project.iconUrl}
                                      width={16}
                                      height={16}
                                    />
                                    <span className="truncate">
                                      {project.name}
                                    </span>
                                  </div>
                                )}
                                renderSelectedOption={(project) => (
                                  <span>{project.name}</span>
                                )}
                                getOptionValue={(project) => project.id}
                                getOptionLabel={(project) => project.name}
                                placeholder={tCommon("fields.projects")}
                                className="w-full"
                                pageSize={20}
                                showTotal
                              />
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t("untestedHelp")}
              </div>
            )}
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.type === "nameExists"
                    ? tAdd("errors.nameExists")
                    : errors.root.message || tGlobal("common.errors.unknown")}
                </div>
              )}
              <Button variant="outline" type="button" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
