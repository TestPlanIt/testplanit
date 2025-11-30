"use client";
import { useState, useEffect } from "react";
import {
  useCreateStatus,
  useFindFirstColor,
  useFindManyStatusScope,
  useCreateManyStatusScopeAssignment,
  useFindManyProjects,
  useCreateManyProjectStatusAssignment,
} from "~/lib/hooks";
import { IconName } from "~/types/globals";
import DynamicIcon from "@/components/DynamicIcon";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { StatusCreateSchema } from "@zenstackhq/runtime/zod/models";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CirclePlus } from "lucide-react";
import { ColorPicker } from "@/components/ColorPicker";

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
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

const createAddStatusFormSchema = (
  t: ReturnType<typeof useTranslations<"admin.statuses.add">>
) => {
  return z.object({
    name: z.string().min(1),
    systemName: z
      .string()
      .min(1, {
        message: t("errors.systemNameEmpty"),
      })
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
        message: t("errors.systemNameInvalid"),
      }),
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

export function AddStatusModal() {
  const t = useTranslations("admin.statuses.add");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [systemNameFocused, setSystemNameFocused] = useState(false);
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null);
  const { data: defaultColorData, isLoading: isDefaultColorLoading } =
    useFindFirstColor();

  const { mutateAsync: createStatus } = useCreateStatus();
  const { mutateAsync: createManyStatusScopeAssignment } =
    useCreateManyStatusScopeAssignment();
  const { mutateAsync: createManyProjectStatusAssignment } =
    useCreateManyProjectStatusAssignment();

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
    const allScopeIds = scopeOptions.map((option) => option.value);
    setValue("scope", allScopeIds);
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
    const allProjectIds = projectOptions.map((option) => option.value);
    setValue("projects", allProjectIds);
  };

  const handleCancel = () => setOpen(false);

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
    form.setValue("colorId", colorId, { shouldValidate: true });
  };

  const AddStatusFormSchema = createAddStatusFormSchema(t);

  type AddStatusFormData = z.infer<typeof AddStatusFormSchema>;

  const form = useForm<AddStatusFormData>({
    resolver: zodResolver(AddStatusFormSchema),
    defaultValues: {
      name: "",
      systemName: "",
      aliases: "",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: undefined,
      scope: [],
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

  const name = watch("name");

  useEffect(() => {
    if (!systemNameFocused && name) {
      const formattedName = name
        .toLowerCase() // Convert to lowercase
        .replace(/\s+/g, "_") // Replace spaces with underscores
        .replace(/[^a-z0-9_]/g, "") // Remove all characters that are not letters, numbers, or underscores
        .replace(/^[^a-z]+/, ""); // Remove any leading characters that are not letters

      setValue("systemName", formattedName, { shouldValidate: true });
    }
  }, [name, systemNameFocused, setValue]);

  useEffect(() => {
    if (open) {
      reset({
        name: "",
        systemName: "",
        aliases: "",
        isEnabled: true,
        isSuccess: false,
        isFailure: false,
        isCompleted: false,
        colorId: undefined,
        scope: [],
        projects: [],
      });
      setSystemNameFocused(false);
    }
  }, [open, reset]);

  useEffect(() => {
    if (defaultColorData?.id && selectedColorId === null) {
      form.setValue("colorId", defaultColorData.id, { shouldValidate: true });
    }
  }, [defaultColorData, selectedColorId, form]);

  async function onSubmit(data: AddStatusFormData) {
    setIsSubmitting(true);
    try {
      const colorIdToUse = selectedColorId ?? defaultColorData?.id;

      if (form.formState.errors.colorId || typeof colorIdToUse !== "number") {
        console.error(
          "Color ID validation failed or value missing.",
          form.formState.errors
        );
        if (!form.formState.errors.colorId) {
          form.setError("colorId", {
            type: "manual",
            message: t("errors.missingColor"),
          });
        }
        form.setError("root", {
          type: "manual",
          message: t("errors.missingColor"),
        });
        setIsSubmitting(false);
        return;
      }

      const statusData = {
        name: data.name,
        systemName: data.systemName,
        aliases: data.aliases ?? null,
        colorId: colorIdToUse,
        isEnabled: data.isEnabled ?? true,
        isSuccess: data.isSuccess ?? false,
        isFailure: data.isFailure ?? false,
        isCompleted: data.isCompleted ?? false,
      };

      const newStatus = await createStatus({ data: statusData });

      if (Array.isArray(data.scope) && data.scope.length > 0) {
        await createManyStatusScopeAssignment({
          data: data.scope.map((scopeId: number) => ({
            statusId: newStatus!.id,
            scopeId: scopeId,
          })),
        });
      }

      if (Array.isArray(data.projects) && data.projects.length > 0) {
        await createManyProjectStatusAssignment({
          data: data.projects.map((projectId: number) => ({
            projectId: projectId,
            statusId: newStatus!.id,
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
        form.setError("root", { type: "custom", message: t("errors.unknown") });
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
          <span className="hidden md:inline">{t("button")}</span>
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
                <ColorPicker onColorSelect={handleColorSelect} />
                <FormField
                  control={form.control}
                  name="colorId"
                  render={({ field }) => <FormMessage className="mt-1" />}
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
                        <Input
                          placeholder={tCommon("fields.name")}
                          {...field}
                        />
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
                    <div className="text-muted-foreground text-sm ml-1">
                      {t("systemNameHelp")}
                    </div>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("fields.systemName")}
                      {...field}
                      onFocus={() => setSystemNameFocused(true)}
                    />
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
                            form.setValue("isSuccess", newIsSuccess);
                            if (newIsSuccess) form.setValue("isFailure", false);
                          }}
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
                            form.setValue("isFailure", newIsFailure);
                            if (newIsFailure) form.setValue("isSuccess", false);
                          }}
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
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.type === "nameExists"
                    ? t("errors.nameExists")
                    : errors.root.type === "manual"
                      ? t("errors.missingColor")
                      : t("errors.unknown")}
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
