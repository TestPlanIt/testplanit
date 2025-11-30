"use client";
/* eslint-disable react-hooks/incompatible-library */
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  useCreateTemplates,
  useUpdateManyTemplates,
  useFindManyProjects,
  useCreateManyTemplateProjectAssignment,
  useCreateManyTemplateCaseAssignment,
  useCreateManyTemplateResultAssignment,
  useFindManyCaseFields,
  useFindManyResultFields,
} from "~/lib/hooks";
import { Projects, Templates } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";

import {
  DraggableField,
  DraggableList,
} from "@/components/DraggableCaseFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";

import { CirclePlus } from "lucide-react";

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

import { SelectScrollable } from "@/components/SelectScrollableCaseFields";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

interface ExtendedTemplates extends Templates {
  projects: { projectId: number }[];
  caseFields: { caseFieldId: number }[];
  resultFields: { resultFieldId: number }[];
}

export function AddTemplateModal() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: session } = useSession();
  const t = useTranslations("admin.templates.add");
  const tCommon = useTranslations("common");

  const FormSchema: any = z.object({
    name: z.string().min(2, {
      message: tCommon("fields.validation.nameRequired"),
    }),
    isDefault: z.boolean().prefault(false),
    isEnabled: z.boolean().prefault(false),
    projects: z.array(z.number()).optional(),
    caseFields: z.array(z.number()).optional(),
    resultFields: z.array(z.number()).optional(),
  });

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

  const { mutateAsync: createTemplate } = useCreateTemplates();
  const { mutateAsync: updateManyTemplates } = useUpdateManyTemplates();
  const { mutateAsync: createTemplateProjectAssignment } =
    useCreateManyTemplateProjectAssignment();
  const { mutateAsync: createTemplateCaseAssignment } =
    useCreateManyTemplateCaseAssignment();
  const { mutateAsync: createTemplateResultAssignment } =
    useCreateManyTemplateResultAssignment();

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

  const { data: caseFields } = useFindManyCaseFields({
    where: { isDeleted: false },
    orderBy: { displayName: "asc" },
  });

  const { data: resultFields } = useFindManyResultFields({
    where: { isDeleted: false },
    orderBy: { displayName: "asc" },
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      projects: [],
      caseFields: [],
      resultFields: [],
    },
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
    setAvailableCaseFields(
      caseFields?.map((cf) => ({ id: cf.id, label: cf.displayName })) || []
    );
    setAvailableResultFields(
      resultFields?.map((rf) => ({ id: rf.id, label: rf.displayName })) || []
    );
  }, [caseFields, resultFields]);

  const selectAllProjects = () => {
    const allProjectIds = projectOptions.map((option) => option.value);
    setValue("projects", allProjectIds);
  };

  const handleAddField = (field: any, type: string) => {
    // console.log(`adding ${field.label} to ${type} fields`);
    if (type === "case") {
      setSelectedCaseFields((prev) => [...prev, field]);
      setAvailableCaseFields((prev) => prev.filter((f) => f.id !== field.id));
    } else {
      setSelectedResultFields((prev) => [...prev, field]);
      setAvailableResultFields((prev) => prev.filter((f) => f.id !== field.id));
    }
  };

  const handleRemoveField = (id: number, type: string) => {
    // console.log(`removing ID: ${id} from ${type} fields`);

    if (type === "case") {
      const foundField = availableCaseFields.find((f) => f.id === id);
      // console.log("Found in available (should be null):", foundField);
      setSelectedCaseFields((prev) => {
        const newSelected = prev.filter((f) => f.id !== id);
        // console.log("New selectedCaseFields:", newSelected);
        return newSelected;
      });

      if (!foundField) {
        setAvailableCaseFields((prev) => {
          const newAvailable = [
            ...prev,
            ...selectedCaseFields.filter((f) => f.id === id),
          ];
          // console.log("New availableCaseFields:", newAvailable);
          return newAvailable;
        });
      }
    } else {
      const foundField = availableResultFields.find((f) => f.id === id);
      // console.log("Found in available (should be null):", foundField);
      setSelectedResultFields((prev) => {
        const newSelected = prev.filter((f) => f.id !== id);
        // console.log("New selectedResultFields:", newSelected);
        return newSelected;
      });

      if (!foundField) {
        setAvailableResultFields((prev) => {
          const newAvailable = [
            ...prev,
            ...selectedResultFields.filter((f) => f.id === id),
          ];
          // console.log("New availableResultFields:", newAvailable);
          return newAvailable;
        });
      }
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

      const newTemplate = await createTemplate({
        data: {
          templateName: data.name,
          isDefault: data.isDefault,
          isEnabled: data.isEnabled,
        },
      });

      if (Array.isArray(data.caseFields)) {
        await createTemplateCaseAssignment({
          data: selectedCaseFields.map((field, index) => ({
            caseFieldId: Number(field.id),
            templateId: newTemplate!.id,
            order: index + 1,
          })),
        });
      }

      if (Array.isArray(data.resultFields)) {
        await createTemplateResultAssignment({
          data: selectedResultFields.map((field, index) => ({
            resultFieldId: Number(field.id),
            templateId: newTemplate!.id,
            order: index + 1,
          })),
        });
      }

      if (data.isDefault) {
        if (Array.isArray(projects)) {
          await createTemplateProjectAssignment({
            data: projects.map((project: Projects) => ({
              projectId: project.id,
              templateId: newTemplate!.id,
            })),
          });
        }
      }

      if (Array.isArray(data.projects)) {
        await createTemplateProjectAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            templateId: newTemplate!.id,
          })),
        });
      }

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
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
          <span className="hidden md:inline">{t("title")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="template.name" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("placeholders.name")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex items-center space-x-8">
              <FormField
                control={form.control}
                defaultValue={true}
                name="isEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormLabel className="flex items-center">
                      {tCommon("fields.enabled")}
                      <HelpPopover helpKey="template.isEnabled" />
                    </FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isDefault}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormLabel className="flex items-center mt-0!">
                      {tCommon("fields.default")}
                      <HelpPopover helpKey="template.isDefault" />
                    </FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    {isDefault && (
                      <div className="flex items-center ml-2">
                        <FormMessage>{t("defaultTemplateHint")}</FormMessage>
                      </div>
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
                    <div className="max-h-48 overflow-y-auto">
                      <DraggableList
                        items={selectedCaseFields}
                        setItems={setSelectedCaseFields}
                        onRemove={(item) =>
                          handleRemoveField(Number(item), "case")
                        }
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
                    <div className="max-h-48 overflow-y-auto">
                      <DraggableList
                        items={selectedResultFields}
                        setItems={setSelectedResultFields}
                        onRemove={(item) =>
                          handleRemoveField(Number(item), "result")
                        }
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
                            // Convert selected options to the format expected by react-hook-form (an array of values)
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          // Dynamically set the value based on the form's current state
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
                  {errors.root.message}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
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
