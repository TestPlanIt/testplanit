"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateTemplates,
  useUpdateManyTemplates,
  useFindManyProjects,
  useFindManyCaseFields,
  useFindManyResultFields,
  useCreateManyTemplateProjectAssignment,
  useCreateManyTemplateCaseAssignment,
  useCreateManyTemplateResultAssignment,
  useDeleteManyTemplateProjectAssignment,
  useDeleteManyTemplateCaseAssignment,
  useDeleteManyTemplateResultAssignment,
} from "~/lib/hooks";
import { Templates, Projects } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";

import {
  DraggableList,
  DraggableField,
} from "@/components/DraggableCaseFields";
import { SelectScrollable } from "@/components/SelectScrollableCaseFields";

import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";

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
import { HelpPopover } from "@/components/ui/help-popover";

import { useTranslations } from "next-intl";

const FormSchema = z.object({
  name: z.string().min(2, {
      error: "Please enter a name for the Template"
}),
  isDefault: z.boolean().prefault(false),
  isEnabled: z.boolean().prefault(false),
  projects: z.array(z.number()).optional(),
  caseFields: z.array(z.number()).optional(),
  resultFields: z.array(z.number()).optional(),
});

interface ExtendedTemplateCaseField {
  caseFieldId: number;
  order: number;
}

interface ExtendedTemplateResultField {
  resultFieldId: number;
  order: number;
}

interface ExtendedTemplates extends Templates {
  caseFields: ExtendedTemplateCaseField[];
  projects: { projectId: number }[];
  resultFields: ExtendedTemplateResultField[];
}

interface EditTemplateModalProps {
  template: ExtendedTemplates;
}

export function EditTemplateModal({ template }: EditTemplateModalProps) {
  const t = useTranslations("admin.templates.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableCaseFields, setAvailableCaseFields] = useState<
    DraggableField[]
  >([]);
  const [selectedCaseFields, setSelectedCaseFields] = useState<
    DraggableField[]
  >([]);
  const [availableResultFields, setAvailableResultFields] = useState<
    DraggableField[]
  >([]);
  const [selectedResultFields, setSelectedResultFields] = useState<
    DraggableField[]
  >([]);

  const { mutateAsync: updateTemplate } = useUpdateTemplates();
  const { mutateAsync: updateManyTemplates } = useUpdateManyTemplates();
  const { mutateAsync: createManyTemplateProjectAssignment } =
    useCreateManyTemplateProjectAssignment();
  const { mutateAsync: deleteManyTemplateProjectAssignment } =
    useDeleteManyTemplateProjectAssignment();
  const { mutateAsync: createManyTemplateCaseAssignment } =
    useCreateManyTemplateCaseAssignment();
  const { mutateAsync: deleteManyTemplateCaseAssignment } =
    useDeleteManyTemplateCaseAssignment();
  const { mutateAsync: createManyTemplateResultAssignment } =
    useCreateManyTemplateResultAssignment();
  const { mutateAsync: deleteManyTemplateResultAssignment } =
    useDeleteManyTemplateResultAssignment();

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  const { data: projects } = useFindManyProjects({
    orderBy: { name: "asc" },
    where: { isDeleted: false },
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

  const { data: caseFields } = useFindManyCaseFields({
    where: { isDeleted: false },
    orderBy: { displayName: "asc" },
  });

  const { data: resultFields } = useFindManyResultFields({
    where: { isDeleted: false },
    orderBy: { displayName: "asc" },
  });

  const defaultFormValues = useMemo(
    () => ({
      name: template.templateName,
      isDefault: template.isDefault,
      isEnabled: template.isEnabled,
      projects: template.projects.map((p) => p.projectId),
      caseFields: template.caseFields.map((cf) => cf.caseFieldId),
      resultFields: template.resultFields.map((rf) => rf.resultFieldId),
    }),
    [template]
  );

  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: defaultFormValues,
  });

  const {
    watch,
    setValue,
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  const isDefault = watch("isDefault");

  useEffect(() => {
    if (isDefault) {
      setValue("isEnabled", true);
    }
  }, [isDefault, setValue]);

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form, form.reset]);

  useEffect(() => {
    if (caseFields && template.caseFields) {
      const selectedIds = new Set(
        template.caseFields.map((cf) => cf.caseFieldId)
      );
      const sortedSelectedFields = template.caseFields
        .map((cf) => ({
          id: cf.caseFieldId,
          label:
            caseFields.find((field) => field.id === cf.caseFieldId)
              ?.displayName || "Unknown Field",
          order: cf.order,
        }))
        .sort((a, b) => a.order - b.order);

      const availableFields = caseFields
        .filter((cf) => !selectedIds.has(cf.id))
        .map((cf) => ({ id: cf.id as string | number, label: cf.displayName }));

      setSelectedCaseFields(sortedSelectedFields);
      setAvailableCaseFields(availableFields);
    }
  }, [caseFields, template.caseFields]);

  useEffect(() => {
    if (resultFields && template.resultFields) {
      const selectedIds = new Set(
        template.resultFields.map((rf) => rf.resultFieldId)
      );
      const sortedSelectedFields = template.resultFields
        .map((rf) => ({
          id: rf.resultFieldId,
          label:
            resultFields.find((field) => field.id === rf.resultFieldId)
              ?.displayName || "Unknown Field",
          order: rf.order,
        }))
        .sort((a, b) => a.order - b.order);

      const availableFields = resultFields
        .filter((rf) => !selectedIds.has(rf.id))
        .map((rf) => ({ id: rf.id as string | number, label: rf.displayName }));

      setSelectedResultFields(sortedSelectedFields);
      setAvailableResultFields(availableFields);
    }
  }, [resultFields, template.resultFields]);

  const handleAddField = (field: DraggableField, type: string) => {
    if (type === "case") {
      setSelectedCaseFields((prev) => [...prev, field]);
      setAvailableCaseFields((prev) => prev.filter((f) => f.id !== field.id));
    } else {
      setSelectedResultFields((prev) => [...prev, field]);
      setAvailableResultFields((prev) => prev.filter((f) => f.id !== field.id));
    }
  };

  const handleRemoveField = (id: string | number, type: string) => {
    if (type === "case") {
      const field = selectedCaseFields.find((f) => f.id === id);
      setSelectedCaseFields((prev) => prev.filter((f) => f.id !== id));
      if (field) setAvailableCaseFields((prev) => [...prev, field]);
    } else {
      const field = selectedResultFields.find((f) => f.id === id);
      setSelectedResultFields((prev) => prev.filter((f) => f.id !== id));
      if (field) setAvailableResultFields((prev) => [...prev, field]);
    }
  };

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyTemplates({
          where: { isDefault: true },
          data: {
            isDefault: false,
          },
        });
      }

      // Update the template details
      await updateTemplate({
        where: { id: template.id },
        data: {
          templateName: data.name,
          isDefault: data.isDefault,
          isEnabled: data.isEnabled,
        },
      });

      // Handle project assignments
      await deleteManyTemplateProjectAssignment({
        where: { templateId: template.id },
      });

      if (data.isDefault) {
        if (Array.isArray(projects)) {
          await createManyTemplateProjectAssignment({
            data: projects.map((project: Projects) => ({
              projectId: project.id,
              templateId: template.id,
            })),
          });
        }
      }

      if (!data.isDefault && data.projects && data.projects.length) {
        await createManyTemplateProjectAssignment({
          data: data.projects.map((projectId) => ({
            projectId,
            templateId: template.id,
          })),
        });
      }

      // Handle case field assignments
      await deleteManyTemplateCaseAssignment({
        where: { templateId: template.id },
      });

      if (selectedCaseFields && selectedCaseFields.length) {
        await createManyTemplateCaseAssignment({
          data: selectedCaseFields.map((field, index) => ({
            caseFieldId:
              typeof field.id === "string" ? parseInt(field.id, 10) : field.id,
            templateId: template.id,
            order: index + 1,
          })),
        });
      }

      // Handle result field assignments
      await deleteManyTemplateResultAssignment({
        where: { templateId: template.id },
      });

      if (selectedResultFields && selectedResultFields.length) {
        await createManyTemplateResultAssignment({
          data: selectedResultFields.map((field, index) => ({
            resultFieldId:
              typeof field.id === "string" ? parseInt(field.id, 10) : field.id,
            templateId: template.id,
            order: index + 1,
          })),
        });
      }

      setIsSubmitting(false);
      setOpen(false);
    } catch (err: any) {
      console.error("Failed to update template:", err);
      setIsSubmitting(false);
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
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 w-fit">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="template.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-row items-center space-x-8">
              <FormField
                control={form.control}
                name="isEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isDefault}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("status.enabled")}
                      <HelpPopover helpKey="template.isEnabled" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={template.isDefault}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center !mt-0">
                      {tCommon("fields.default")}
                      <HelpPopover helpKey="template.isDefault" />
                    </FormLabel>
                    {isDefault && (
                      <FormMessage>{tGlobal("admin.templates.add.defaultTemplateHint")}</FormMessage>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="caseFields"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center space-x-2">
                    <FormLabel className="flex items-center">
                      {tCommon("fields.caseFields")}
                      <HelpPopover helpKey="template.caseFields" />
                    </FormLabel>
                    <SelectScrollable
                      fields={availableCaseFields}
                      onAddField={handleAddField}
                      type="case"
                    />
                  </div>
                  <FormControl>
                    <div className="max-h-48 overflow-auto">
                      <DraggableList
                        items={selectedCaseFields}
                        setItems={setSelectedCaseFields}
                        onRemove={(item) => handleRemoveField(item, "case")}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="resultFields"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center space-x-2">
                    <FormLabel className="flex items-center">
                      {tCommon("fields.resultFields")}
                      <HelpPopover helpKey="template.resultFields" />
                    </FormLabel>
                    <SelectScrollable
                      fields={availableResultFields}
                      onAddField={handleAddField}
                      type="result"
                    />
                  </div>
                  <FormControl>
                    <div className="max-h-48 overflow-auto">
                      <DraggableList
                        items={selectedResultFields}
                        setItems={setSelectedResultFields}
                        onRemove={(item) => handleRemoveField(item, "result")}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="projects"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between items-center">
                    <div className="flex items-center">
                      {tCommon("fields.projects")}
                      <HelpPopover helpKey="template.projects" />
                    </div>
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
              <Button
                type="button"
                onClick={() => setOpen(false)}
                variant="outline"
              >
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
