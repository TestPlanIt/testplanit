"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WorkflowType } from "~/zenstack/models";
import type { Projects } from "~/zenstack/models";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FieldIconPicker } from "@/components/FieldIconPicker";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
} from "@/components/ui/dialog";

import { HelpPopover } from "@/components/ui/help-popover";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { scopeDisplayData } from "~/app/constants";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { isUniqueConstraintError } from "~/lib/utils/errors";

const scopeKeys = Object.keys(scopeDisplayData) as [
  keyof typeof scopeDisplayData,
  ...Array<keyof typeof scopeDisplayData>,
];

const getWorkflowTypeOptions = (
  tWorkflowTypes: ReturnType<typeof useTranslations<"enums.WorkflowType">>
) => [
  { value: WorkflowType.NOT_STARTED, label: tWorkflowTypes("NOT_STARTED") },
  { value: WorkflowType.IN_PROGRESS, label: tWorkflowTypes("IN_PROGRESS") },
  { value: WorkflowType.DONE, label: tWorkflowTypes("DONE") },
];

function buildFormSchema(t: (key: any) => string): any {
  return z.object({
    scope: z.enum(scopeKeys, {
      message: t("common.errors.workflowScopeRequired"),
    }),
    name: z.string().min(1, {
      error: t("common.errors.workflowStateNameRequired"),
    }),
    workflowType: z.enum(WorkflowType, {
      error: (issue) =>
        issue.input === undefined
          ? t("common.errors.workflowTypeRequired")
          : undefined,
    }),
    isDefault: z.boolean().prefault(false).optional(),
    isEnabled: z.boolean().prefault(true).optional(),
    requiresReview: z.boolean().prefault(false).optional(),
    projects: z.array(z.number()).optional(),
  });
}

interface AddWorkflowsProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select the scope (e.g. when opened from a specific scope's card). */
  defaultScope?: (typeof scopeKeys)[number];
}

export function AddWorkflows({
  open,
  onClose,
  defaultScope,
}: AddWorkflowsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const tWorkflowTypes = useTranslations("enums.WorkflowType");
  const workflowTypeOptions = getWorkflowTypeOptions(tWorkflowTypes);

  const { systemEnabled: reviewFeatureSystemEnabled } =
    useReviewFeatureEnabled();
  const reviewFeatureDisabled = reviewFeatureSystemEnabled === false;

  const { data: defaultIconData } = useClientQueries(
    schema
  ).fieldIcon.useFindFirst({
    where: { name: "layout-list" },
  });
  const { data: defaultColorData } =
    useClientQueries(schema).color.useFindFirst();
  const [selectedIconId, setSelectedIconId] = useState<number | null>(null);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null);

  const { mutateAsync: createWorkflows } =
    useClientQueries(schema).workflows.useCreate();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useClientQueries(schema).projectWorkflowAssignment.useCreateMany();

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

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
  };

  const formSchema = useMemo(() => buildFormSchema(tGlobal), [tGlobal]);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      scope: defaultScope,
      name: "",
      isDefault: false,
      isEnabled: true,
      requiresReview: false,
      projects: [],
    },
  });

  const {
    control,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (defaultIconData && defaultColorData) {
      setSelectedIconId(defaultIconData.id);
      setSelectedColorId(defaultColorData.id);
    }
  }, [defaultIconData, defaultColorData]);

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    try {
      // The single-default DB trigger (tpl_single_default_workflows) clears the
      // previous default for this scope atomically.
      const newWorkflow = await createWorkflows({
        data: {
          name: data.name,
          iconId: selectedIconId || defaultIconData?.id!,
          colorId: selectedColorId || defaultColorData?.id!,
          isEnabled: data.isEnabled || true,
          isDefault: data.isDefault || false,
          requiresReview: data.requiresReview || false,
          scope: data.scope || "",
          workflowType: data.workflowType,
        },
      });

      if (data.isDefault) {
        if (Array.isArray(projects)) {
          await createManyProjectWorkflowAssignment({
            data: projects.map((project: Projects) => ({
              projectId: project.id,
              workflowId: newWorkflow!.id,
            })),
          });
        }
      }

      if (Array.isArray(data.projects)) {
        await createManyProjectWorkflowAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            workflowId: newWorkflow!.id,
          })),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.workflowStateExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknownErrorWithMessage", {
            message: err.message ?? "",
          }),
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("add.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("add.title")}
              </DialogDescription>
            </DialogHeader>
            <FormItem>
              <FormLabel className="flex items-center">
                {tCommon("fields.scope")}
                <HelpPopover helpKey="workflow.scope" />
              </FormLabel>
            </FormItem>
            <FormField
              control={form.control}
              name="scope"
              render={({ field: _field }) => (
                <FormItem>
                  <FormLabel>
                    <FormControl>
                      <Controller
                        control={control}
                        name="scope"
                        render={({ field: { onChange, value } }) => (
                          <Select onValueChange={onChange} value={value}>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={tCommon("fields.selectWorkflow")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {Object.entries(scopeDisplayData).map(
                                  ([key, { text, icon: Icon }]) => (
                                    <SelectItem key={key} value={key}>
                                      <div className="flex items-center gap-1">
                                        <Icon />
                                        {text}
                                      </div>
                                    </SelectItem>
                                  )
                                )}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </FormControl>
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div>
              <div className=" w-16 h-full">
                <FormLabel className="whitespace-nowrap flex items-center">
                  {tCommon("fields.iconColor")}
                  <HelpPopover helpKey="workflow.iconColor" />
                </FormLabel>
                <FieldIconPicker
                  initialIconId={defaultIconData?.id ?? 0}
                  initialColorId={defaultColorData?.id ?? 0}
                  onIconSelect={(newIconId) => handleIconSelect(newIconId)}
                  onColorSelect={(newColorId) => handleColorSelect(newColorId)}
                />
              </div>
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <div className="w-full">
                      <FormLabel className="flex items-center">
                        {tCommon("name")}
                        <HelpPopover helpKey="workflow.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={tCommon("name")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </div>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="workflowType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.type")}
                    <HelpPopover helpKey="workflow.workflowType" />
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={tCommon("placeholders.selectWorkflowType")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {workflowTypeOptions.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center space-x-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(newValue) => {
                          field.onChange(newValue);
                          if (newValue) {
                            form.setValue("isEnabled", true);
                          }
                        }}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.default")}
                      <HelpPopover helpKey="workflow.isDefault" />
                    </FormLabel>
                    <FormMessage />
                  </div>
                  {form.watch("isDefault") && (
                    <FormMessage>{t("add.defaultHelp")}</FormMessage>
                  )}
                </FormItem>
              )}
            />
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
                        disabled={form.watch("isDefault")}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.enabled")}
                      <HelpPopover helpKey="workflow.isActive" />
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            {!reviewFeatureDisabled && (
              <FormField
                control={form.control}
                name="requiresReview"
                render={({ field }) => {
                  const isDefault = form.watch("isDefault");
                  return (
                    <FormItem>
                      <div className="flex items-center space-x-2">
                        <FormControl>
                          <Switch
                            data-testid="add-requires-review-switch"
                            checked={field.value && !isDefault}
                            onCheckedChange={field.onChange}
                            disabled={isDefault}
                          />
                        </FormControl>
                        <FormLabel className="flex items-center">
                          {t("editWorkflow.requiresReviewLabel")}
                          <HelpPopover helpKey="workflow.requiresReview" />
                        </FormLabel>
                        <FormMessage />
                      </div>
                      {isDefault && (
                        <FormDescription>
                          {t("editWorkflow.requiresReviewDefaultDisabled")}
                        </FormDescription>
                      )}
                    </FormItem>
                  );
                }}
              />
            )}

            <FormField
              control={form.control}
              name="projects"
              render={() => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.projects")}
                    <HelpPopover helpKey="workflow.projects" />
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
                                <span className="truncate">{project.name}</span>
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
            <DialogFooter>
              {errors.root && (
                <div
                  className=" bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.type === "nameExists"
                    ? tGlobal("admin.workflows.add.errors.nameExists")
                    : tGlobal("common.errors.unknown")}
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
