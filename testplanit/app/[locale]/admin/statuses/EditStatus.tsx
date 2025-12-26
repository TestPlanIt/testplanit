"use client";
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateStatus,
  useFindManyStatusScope,
  useFindManyProjects,
  useCreateManyStatusScopeAssignment,
  useDeleteManyStatusScopeAssignment,
  useCreateManyProjectStatusAssignment,
  useDeleteManyProjectStatusAssignment,
} from "~/lib/hooks";
import { Status } from "@prisma/client";

import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { StatusUpdateSchema } from "@zenstackhq/runtime/zod/models";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SquarePen } from "lucide-react";
import { ColorPicker } from "@/components/ColorPicker";

import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";

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
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

const createEditStatusFormSchema = (
  t: ReturnType<typeof useTranslations<"admin.statuses.edit">>
) => {
  return z.object({
    name: z.string().min(1),
    systemName: z.string(),
    aliases: z
      .string()
      .regex(/^$|^(?:[A-Za-z][A-Za-z0-9_]*)(?:,(?:[A-Za-z][A-Za-z0-9_]*))*$/, {
        message: t("errors.aliasesInvalid"),
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

interface EditStatusModalProps {
  status: ExtendedStatus;
}

export function EditStatusModal({ status }: EditStatusModalProps) {
  const t = useTranslations("admin.statuses.edit");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(
    status.colorId
  );

  const { mutateAsync: updateStatus } = useUpdateStatus();
  const { mutateAsync: createManyStatusScopeAssignment } =
    useCreateManyStatusScopeAssignment();
  const { mutateAsync: deleteManyStatusScopeAssignment } =
    useDeleteManyStatusScopeAssignment();
  const { mutateAsync: createManyProjectStatusAssignment } =
    useCreateManyProjectStatusAssignment();
  const { mutateAsync: deleteManyProjectStatusAssignment } =
    useDeleteManyProjectStatusAssignment();

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  const { data: scopes } = useFindManyStatusScope();

  const scopeOptions =
    scopes && scopes.length > 0
      ? scopes.map((scope) => ({
          value: scope.id,
          label: (
            <div className="flex gap-1 items-center">
              <DynamicIcon name={scope.icon as IconName} size={20} />
              <span>{scope.name}</span>
            </div>
          ),
        }))
      : [];

  const selectAllScopes = () => {
    form.setValue(
      "scope",
      scopeOptions.map((option) => option.value)
    );
  };

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
    form.setValue(
      "projects",
      projectOptions.map((option) => option.value)
    );
  };

  const handleCancel = () => setOpen(false);

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
    form.setValue("colorId", colorId, { shouldValidate: true });
  };

  const defaultFormValues = useMemo(
    () => ({
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
    }),
    [status]
  );

  const EditStatusFormSchema = createEditStatusFormSchema(t);

  type EditStatusFormData = z.infer<typeof EditStatusFormSchema>;

  const form = useForm<EditStatusFormData>({
    resolver: zodResolver(EditStatusFormSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
      setSelectedColorId(status.colorId);
    }
  }, [open, defaultFormValues, form, status.colorId]);

  const {
    watch,
    setValue,
    handleSubmit,
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
          message: t("errors.missingColor"),
        });
        form.setError("root", {
          type: "manual",
          message: t("errors.missingColor"),
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

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: t("errors.unknown"),
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
                        {tCommon("fields.name")}
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
                      placeholder={t("aliasesHelp")}
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex justify-between items-center">
                        <span className="flex items-center">
                          {tCommon("fields.scope")}
                          <HelpPopover helpKey="status.scope" />
                        </span>
                        <div
                          onClick={selectAllScopes}
                          style={{ cursor: "pointer" }}
                        >
                          {tCommon("actions.selectAll")}
                        </div>
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="scope"
                          render={({ field }) => (
                            <MultiSelect
                              {...field}
                              isMulti
                              maxMenuHeight={300}
                              className="w-[445px] sm:w-[550px] lg:w-[950px]"
                              classNamePrefix="select"
                              styles={customStyles}
                              options={scopeOptions}
                              onChange={(selected: any) => {
                                const value = selected
                                  ? selected.map((option: any) => option.value)
                                  : [];
                                field.onChange(value);
                              }}
                              value={scopeOptions.filter((option) =>
                                field.value?.includes(option.value)
                              )}
                              isDisabled={status.systemName === "untested"}
                            />
                          )}
                        />
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
                        <span className="flex items-center">
                          {tCommon("fields.projects")}
                          <HelpPopover helpKey="status.projects" />
                        </span>
                        <div
                          onClick={selectAllProjects}
                          style={{ cursor: "pointer" }}
                        >
                          {tCommon("actions.selectAll")}
                        </div>
                      </FormLabel>
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
                    ? t("errors.nameExists")
                    : errors.root.message || t("errors.unknown")}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("cancel")}
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
