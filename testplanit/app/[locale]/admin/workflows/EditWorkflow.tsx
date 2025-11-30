"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateWorkflows,
  useUpdateManyWorkflows,
  useFindManyProjects,
  useCreateManyProjectWorkflowAssignment,
  useDeleteManyProjectWorkflowAssignment,
} from "~/lib/hooks";
import { Workflows, Projects, WorkflowType } from "@prisma/client";
import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SquarePen } from "lucide-react";
import { FieldIconPicker } from "@/components/FieldIconPicker";

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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";

import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import { scopeDisplayData } from "~/app/constants";
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

const scopeKeys = Object.keys(scopeDisplayData) as [
  keyof typeof scopeDisplayData,
  ...Array<keyof typeof scopeDisplayData>,
];

const getWorkflowTypeOptions = (
  t: ReturnType<typeof useTranslations<"admin.workflows">>
) => [
  { value: WorkflowType.NOT_STARTED, label: t("types.NOT_STARTED") },
  { value: WorkflowType.IN_PROGRESS, label: t("types.IN_PROGRESS") },
  { value: WorkflowType.DONE, label: t("types.DONE") },
];

interface ExtendedWorkflows extends Workflows {
  projects: { projectId: number }[];
}

interface EditWorkflowsModalProps {
  workflows: ExtendedWorkflows;
  allWorkflows: ExtendedWorkflows[];
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

export function EditWorkflowsModal({
  workflows: workflows,
  allWorkflows,
}: EditWorkflowsModalProps) {
  const [open, setOpen] = useState(false);
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

  const handleCancel = () => setOpen(false);

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
  };

  const defaultFormValues = useMemo(
    () => ({
      name: workflows.name,
      isEnabled: workflows.isEnabled,
      isDefault: workflows.isDefault,
      scope: workflows.scope,
      workflowType: workflows.workflowType,
      projects: workflows.projects.map((p) => p.projectId),
    }),
    [workflows]
  );

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const workflowTypeOptions = getWorkflowTypeOptions(t);

  const FormSchema = z.object({
    scope: z.enum(scopeKeys, {
      message: t("edit.errors.unknownWorkflow"),
    }),
    name: z.string().min(1, {
      message: t("edit.errors.nameRequired"),
    }),
    workflowType: z.enum(WorkflowType, {
      error: (issue) =>
        issue.input === undefined ? "Please select a workflow type" : undefined,
    }),
    isDefault: z.boolean().prefault(false).optional(),
    isEnabled: z.boolean().prefault(true).optional(),
    projects: z.array(z.number()).optional(),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form, form.reset]);

  const {
    watch,
    setValue,
    handleSubmit,
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
      }

      if (Array.isArray(data.projects)) {
        await createManyProjectWorkflowAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            workflowId: workflows.id,
          })),
        });
      }

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "nameExists",
          message:
            "Workflow State name already exists. Please choose a different name.",
        });
      } else {
        form.setError("root", {
          type: "unknown",
          message: `An unknown error occurred. Error: ${err.message}`,
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        {workflows.id}
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
              render={({ field }) => (
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
                                placeholder={t("fields.selectWorkflow")}
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
                  {t("fields.iconColor")}
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
                        {t("fields.name")}
                        <HelpPopover helpKey="workflow.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("fields.name")} {...field} />
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
                    {t("fields.type")}
                    <HelpPopover helpKey="workflow.type" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isLastWorkflowOfType(workflows, allWorkflows)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select workflow type" />
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
                      {t("fields.default")}
                      <HelpPopover helpKey="workflow.isDefault" />
                    </FormLabel>
                    <FormMessage />
                  </div>
                  {form.watch("isDefault") && (
                    <FormMessage>{t("edit.defaultHelp")}</FormMessage>
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
                      {t("fields.enabled")}
                      <HelpPopover helpKey="workflow.isEnabled" />
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projects"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between items-center">
                    <span className="flex items-center">
                      {t("fields.projects")}
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
                    ? t("edit.errors.nameExists")
                    : t("edit.errors.unknown")}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("status.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
