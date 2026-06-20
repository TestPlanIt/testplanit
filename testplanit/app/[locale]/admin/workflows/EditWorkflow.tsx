"use client";
/* eslint-disable react-hooks/incompatible-library */
import { WorkflowType } from "~/zenstack/models";
import type { Projects, Workflows } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  useCreateManyProjectWorkflowAssignment,
  useDeleteManyProjectWorkflowAssignment,
  useFindManyProjects,
  useUpdateManyWorkflows,
  useUpdateWorkflows,
} from "~/lib/hooks";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FieldIconPicker } from "@/components/FieldIconPicker";

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

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { HelpPopover } from "@/components/ui/help-popover";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "next-themes";
import MultiSelect from "react-select";
import { scopeDisplayData } from "~/app/constants";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";

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

interface ExtendedWorkflows extends Workflows {
  projects: { projectId: number }[];
}

interface EditWorkflowsProps {
  workflows: ExtendedWorkflows;
  allWorkflows: ExtendedWorkflows[];
  open: boolean;
  onClose: () => void;
}

// Helper function to check if a workflow is the last of its type in its scope
const isLastWorkflowOfType = (
  workflow: ExtendedWorkflows,
  allWorkflows: ExtendedWorkflows[]
): boolean => {
  const sameTypeAndScope = allWorkflows.filter(
    (w) =>
      w.scope === workflow.scope &&
      w.workflowType === workflow.workflowType &&
      !w.isDeleted
  );
  return sameTypeAndScope.length === 1;
};

export function EditWorkflows({
  workflows: workflows,
  allWorkflows,
  open,
  onClose,
}: EditWorkflowsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIconId, setSelectedIconId] = useState<number | null>(
    workflows.iconId
  );
  const [selectedColorId, setSelectedColorId] = useState<number | null>(
    workflows.colorId
  );

  const { mutateAsync: updateWorkflows } = useUpdateWorkflows();
  const { mutateAsync: updateManyWorkflows } = useUpdateManyWorkflows();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useCreateManyProjectWorkflowAssignment();
  const { mutateAsync: deleteManyProjectWorkflowAssignment } =
    useDeleteManyProjectWorkflowAssignment();

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const projectOptions =
    projects && projects.length > 0
      ? projects.map((project) => ({
          value: project.id,
          label: `${project.name}`,
        }))
      : [];

  const selectAllProjects = () => {
    const allProjectIds = projectOptions.map((option) => option.value);
    setValue("projects", allProjectIds);
  };

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
  };

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const tWorkflowTypes = useTranslations("enums.WorkflowType");
  const workflowTypeOptions = getWorkflowTypeOptions(tWorkflowTypes);

  // D-19: when the system flag is OFF, render the requiresReview Switch as
  // disabled with a "feature disabled" FormDescription.
  const { systemEnabled: reviewFeatureSystemEnabled } =
    useReviewFeatureEnabled();
  const reviewFeatureDisabled = reviewFeatureSystemEnabled === false;

  const FormSchema = z.object({
    scope: z.enum(scopeKeys, {
      message: t("edit.errors.unknownWorkflow"),
    }),
    name: z.string().min(1, {
      message: t("edit.errors.nameRequired"),
    }),
    workflowType: z.enum(WorkflowType, {
      error: (issue) =>
        issue.input === undefined
          ? tCommon("errors.workflowTypeRequired")
          : undefined,
    }),
    isDefault: z.boolean().prefault(false).optional(),
    isEnabled: z.boolean().prefault(true).optional(),
    requiresReview: z.boolean().prefault(false).optional(),
    projects: z.array(z.number()).optional(),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: standardSchemaResolver(FormSchema),
    defaultValues: {
      name: workflows.name,
      isEnabled: workflows.isEnabled,
      isDefault: workflows.isDefault,
      requiresReview: workflows.requiresReview,
      scope: workflows.scope,
      workflowType: workflows.workflowType,
      projects: workflows.projects.map((p) => p.projectId),
    },
  });

  const {
    setValue,
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyWorkflows({
          where: {
            isDefault: true,
            scope: data.scope!,
          },
          data: {
            isDefault: false,
          },
        });
      }

      const newWorkflow = await updateWorkflows({
        where: { id: workflows.id },
        data: {
          name: data.name,
          iconId: selectedIconId || undefined,
          colorId: selectedColorId || undefined,
          isEnabled: data.isEnabled,
          isDefault: data.isDefault,
          requiresReview: data.requiresReview,
          workflowType: data.workflowType,
        },
      });

      await deleteManyProjectWorkflowAssignment({
        where: { workflowId: workflows.id },
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
      } else if (Array.isArray(data.projects)) {
        await createManyProjectWorkflowAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            workflowId: workflows.id,
          })),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "nameExists",
          message: tCommon("errors.workflowStateNameExists"),
        });
      } else {
        form.setError("root", {
          type: "unknown",
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
              <DialogTitle>{t("edit.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("edit.title")}
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
                          <Select
                            disabled
                            onValueChange={onChange}
                            value={value}
                          >
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
                  initialIconId={workflows.iconId}
                  initialColorId={workflows.colorId}
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
                    </div>
                  </div>
                  <FormMessage />
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
                    <HelpPopover helpKey="workflow.type" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isLastWorkflowOfType(workflows, allWorkflows)}
                  >
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
                  {isLastWorkflowOfType(workflows, allWorkflows) && (
                    <div className="text-sm text-muted-foreground">
                      {t("edit.lastWorkflowTypeWarning")}
                    </div>
                  )}
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
                        disabled={workflows.isDefault}
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
                    <FormMessage>
                      {tGlobal("admin.workflows.add.defaultHelp")}
                    </FormMessage>
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
                      <HelpPopover helpKey="workflow.isEnabled" />
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="requiresReview"
              render={({ field }) => {
                const isDefault = form.watch("isDefault");
                const requiresReviewDisabled =
                  reviewFeatureDisabled || isDefault;
                return (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          data-testid="requires-review-switch"
                          checked={field.value && !isDefault}
                          onCheckedChange={field.onChange}
                          disabled={requiresReviewDisabled}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {t("editWorkflow.requiresReviewLabel")}
                        <HelpPopover helpKey="workflow.requiresReview" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                    {reviewFeatureDisabled && (
                      <FormDescription>
                        {t("editWorkflow.requiresReviewFeatureDisabled")}
                      </FormDescription>
                    )}
                    {!reviewFeatureDisabled && isDefault && (
                      <FormDescription>
                        {t("editWorkflow.requiresReviewDefaultDisabled")}
                      </FormDescription>
                    )}
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="projects"
              render={({ field: _field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between items-center">
                    <span className="flex items-center">
                      {tCommon("fields.projects")}
                      <HelpPopover helpKey="workflow.projects" />
                    </span>
                    <div
                      onClick={selectAllProjects}
                      style={{ cursor: "pointer" }}
                    >
                      {tCommon("actions.selectAll")}
                    </div>
                  </FormLabel>{" "}
                  <FormControl>
                    <Controller
                      control={control}
                      name="projects"
                      render={({ field }) => (
                        <MultiSelect
                          {...field}
                          isMulti
                          maxMenuHeight={300}
                          className="w-[445px] sm:w-[550px] lg:w-[950px]"
                          classNamePrefix="select"
                          styles={customStyles}
                          options={projectOptions}
                          onChange={(selected: any) => {
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          value={projectOptions.filter((option) =>
                            field.value?.includes(option.value)
                          )}
                        />
                      )}
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
