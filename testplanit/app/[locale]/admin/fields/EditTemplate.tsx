"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Projects, Templates } from "~/zenstack/models";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import {
  DraggableField,
  DraggableList,
} from "@/components/DraggableCaseFields";
import { SelectScrollable } from "@/components/SelectScrollableCaseFields";

import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

function buildFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(2, {
      error: t("common.errors.templateNameRequired"),
    }),
    isDefault: z.boolean().prefault(false),
    isEnabled: z.boolean().prefault(false),
    projects: z.array(z.number()).optional(),
    caseFields: z.array(z.number()).optional(),
    resultFields: z.array(z.number()).optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

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

interface EditTemplateProps {
  template: ExtendedTemplates;
  open: boolean;
  onClose: () => void;
}

export function EditTemplate({ template, open, onClose }: EditTemplateProps) {
  const t = useTranslations("admin.templates.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

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

  // Track whether fields have been initialized for this dialog session
  // This prevents React Query refetches from resetting user selections
  const caseFieldsInitializedRef = useRef(false);
  const resultFieldsInitializedRef = useRef(false);

  const { mutateAsync: updateTemplate } =
    useClientQueries(schema).templates.useUpdate();
  const { mutateAsync: createManyTemplateProjectAssignment } =
    useClientQueries(schema).templateProjectAssignment.useCreateMany();
  const { mutateAsync: deleteManyTemplateProjectAssignment } =
    useClientQueries(schema).templateProjectAssignment.useDeleteMany();
  const { mutateAsync: createManyTemplateCaseAssignment } =
    useClientQueries(schema).templateCaseAssignment.useCreateMany();
  const { mutateAsync: deleteManyTemplateCaseAssignment } =
    useClientQueries(schema).templateCaseAssignment.useDeleteMany();
  const { mutateAsync: createManyTemplateResultAssignment } =
    useClientQueries(schema).templateResultAssignment.useCreateMany();
  const { mutateAsync: deleteManyTemplateResultAssignment } =
    useClientQueries(schema).templateResultAssignment.useDeleteMany();

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    orderBy: { name: "asc" },
    where: { isDeleted: false },
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

  const { data: caseFields } = useClientQueries(schema).caseFields.useFindMany({
    where: { isDeleted: false },
    orderBy: { displayName: "asc" },
  });

  const { data: resultFields } = useClientQueries(
    schema
  ).resultFields.useFindMany({
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

  const formSchema = useMemo(() => buildFormSchema(tGlobal), [tGlobal]);
  const form = useForm({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  const {
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors: _errors },
  } = form;

  const isDefault = watch("isDefault");

  useEffect(() => {
    if (isDefault) {
      setValue("isEnabled", true);
    }
  }, [isDefault, setValue]);

  // Initialize case fields only once when data is available. Component is mounted
  // fresh on each open by the parent so this only runs once per edit cycle.
  // Using a ref to prevent React Query refetches from resetting user selections during form submission
  useEffect(() => {
    // Only initialize if data is available and we haven't initialized yet
    if (caseFieldsInitializedRef.current || !caseFields) return;

    const caseSelectedIds = new Set(
      template.caseFields.map((cf) => cf.caseFieldId)
    );
    const sortedSelectedCaseFields = template.caseFields
      .map((cf) => ({
        id: cf.caseFieldId,
        label:
          caseFields.find((field) => field.id === cf.caseFieldId)
            ?.displayName || "Unknown Field",
        order: cf.order,
      }))
      .sort((a, b) => a.order - b.order);

    const availableCaseFieldsList = caseFields
      .filter((cf) => !caseSelectedIds.has(cf.id))
      .map((cf) => ({ id: cf.id as string | number, label: cf.displayName }));

    setSelectedCaseFields(sortedSelectedCaseFields);
    setAvailableCaseFields(availableCaseFieldsList);

    // Mark as initialized to prevent re-runs from React Query refetches
    caseFieldsInitializedRef.current = true;
  }, [caseFields, template.caseFields]);

  // Initialize result fields only once when data is available
  // Using a ref to prevent React Query refetches from resetting user selections during form submission
  useEffect(() => {
    // Only initialize if data is available and we haven't initialized yet
    if (resultFieldsInitializedRef.current || !resultFields) return;

    const resultSelectedIds = new Set(
      template.resultFields.map((rf) => rf.resultFieldId)
    );
    const sortedSelectedResultFields = template.resultFields
      .map((rf) => ({
        id: rf.resultFieldId,
        label:
          resultFields.find((field) => field.id === rf.resultFieldId)
            ?.displayName || "Unknown Field",
        order: rf.order,
      }))
      .sort((a, b) => a.order - b.order);

    const availableResultFieldsList = resultFields
      .filter((rf) => !resultSelectedIds.has(rf.id))
      .map((rf) => ({ id: rf.id as string | number, label: rf.displayName }));

    setSelectedResultFields(sortedSelectedResultFields);
    setAvailableResultFields(availableResultFieldsList);

    // Mark as initialized to prevent re-runs from React Query refetches
    resultFieldsInitializedRef.current = true;
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

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    try {
      // Update the template details. The single-default DB trigger
      // (tpl_single_default_templates) clears the previous default atomically.
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
      onClose();
    } catch (err: any) {
      console.error("Failed to update template:", err);
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[600px] lg:max-w-[1000px]"
        data-testid="template-dialog"
      >
        <Form {...form}>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 w-fit"
            data-testid="template-form"
          >
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
                    {tCommon("name")}
                    <HelpPopover helpKey="template.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="template-name-input" />
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
                        data-testid="template-enabled-switch"
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.enabled")}
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
                        data-testid="template-default-switch"
                      />
                    </FormControl>
                    <FormLabel className="flex items-center mt-0!">
                      {tCommon("fields.default")}
                      <HelpPopover helpKey="template.isDefault" />
                    </FormLabel>
                    {isDefault && (
                      <FormMessage>
                        {tGlobal("admin.templates.add.defaultTemplateHint")}
                      </FormMessage>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="caseFields"
              render={({ field: _field }) => (
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
              render={({ field: _field }) => (
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
              render={() => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.projects")}
                    <HelpPopover helpKey="template.projects" />
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
              <Button
                type="button"
                onClick={onClose}
                variant="outline"
                data-testid="template-cancel-button"
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="template-submit-button"
              >
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
