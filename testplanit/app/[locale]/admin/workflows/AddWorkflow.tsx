"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useState, useEffect } from "react";
import {
  useCreateWorkflows,
  useFindFirstColor,
  useFindFirstFieldIcon,
  useFindManyProjects,
  useCreateManyProjectWorkflowAssignment,
  useUpdateManyWorkflows,
} from "~/lib/hooks";

import { Projects, WorkflowType } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CirclePlus } from "lucide-react";
import { FieldIconPicker } from "@/components/FieldIconPicker";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";

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

import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import { scopeDisplayData } from "~/app/constants";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
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

const FormSchema: any = z.object({
  scope: z.enum(scopeKeys, {
    message: `Please choose a Workflow for the State`,
  }),
  name: z.string().min(1, {
      error: "Please enter a name for the Workflow State"
}),
  workflowType: z.enum(WorkflowType, {
      error: (issue) => issue.input === undefined ? "Please select a workflow type" : undefined
}),
  isDefault: z.boolean().prefault(false).optional(),
  isEnabled: z.boolean().prefault(true).optional(),
  projects: z.array(z.number()).optional(),
});

export function AddWorkflowsModal() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const workflowTypeOptions = getWorkflowTypeOptions(t);

  const { data: defaultIconData } = useFindFirstFieldIcon({
    where: { name: "layout-list" },
  });
  const { data: defaultColorData } = useFindFirstColor();
  const [selectedIconId, setSelectedIconId] = useState<number | null>(null);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null);

  const { mutateAsync: createWorkflows } = useCreateWorkflows();
  const { mutateAsync: updateManyWorkflows } = useUpdateManyWorkflows();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useCreateManyProjectWorkflowAssignment();

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

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      scope: undefined,
      name: "",
      isDefault: false,
      isEnabled: true,
      projects: [],
    },
  });

  const {
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = form;

  useEffect(() => {
    if (defaultIconData && defaultColorData) {
      setSelectedIconId(defaultIconData.id);
      setSelectedColorId(defaultColorData.id);
    }
  }, [defaultIconData, defaultColorData]);

  useEffect(() => {
    if (open) {
      reset({
        name: "",
        isDefault: false,
        isEnabled: true,
        scope: undefined,
        projects: [],
      });
    }
  }, [open, reset]);

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyWorkflows({
          where: {
            isDefault: true,
            scope: data.scope,
          },
          data: {
            isDefault: false,
          },
        });
      }

      const newWorkflow = await createWorkflows({
        data: {
          name: data.name,
          iconId: selectedIconId || defaultIconData?.id!,
          colorId: selectedColorId || defaultColorData?.id!,
          isEnabled: data.isEnabled || true,
          isDefault: data.isDefault || false,
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

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: "Workflow State already exists. Please choose a new name.",
        });
      } else {
        form.setError("root", {
          type: "custom",
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
        <Button>
          <CirclePlus className="w-4" />
          <span className="hidden md:inline">{t("add.button")}</span>
        </Button>
      </DialogTrigger>
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
              render={({ field }) => (
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
                        {t("fields.name")}
                        <HelpPopover helpKey="workflow.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("fields.name")} {...field} />
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
                    {t("fields.type")}
                    <HelpPopover helpKey="workflow.workflowType" />
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
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
                      {t("fields.default")}
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
                      {t("fields.enabled")}
                      <HelpPopover helpKey="workflow.isActive" />
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
                    ? t("add.errors.nameExists")
                    : t("add.errors.unknown")}
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
