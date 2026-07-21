"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { MilestoneTypes } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TriangleAlert } from "lucide-react";

import { FieldIconPicker } from "@/components/FieldIconPicker";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";

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
import { isUniqueConstraintError } from "~/lib/utils/errors";

export interface ExtendedMilestoneTypes extends MilestoneTypes {
  projects: { projectId: number }[];
}
interface EditMilestoneTypeProps {
  milestoneType: ExtendedMilestoneTypes;
  open: boolean;
  onClose: () => void;
}

export function EditMilestoneType({
  milestoneType,
  open,
  onClose,
}: EditMilestoneTypeProps) {
  const t = useTranslations("admin.milestones.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIconId, setSelectedIconId] = useState<number | null>(
    milestoneType.iconId
  );

  const FormSchema = z.object({
    name: z.string().min(2, {
      error: tCommon("errors.milestoneTypeNameMinLength"),
    }),
    isDefault: z.boolean(),
    projects: z.array(z.number()).optional(),
  });

  const { mutateAsync: updateMilestoneType } =
    useClientQueries(schema).milestoneTypes.useUpdate();
  const { mutateAsync: createManyMilestoneTypesAssignment } =
    useClientQueries(schema).milestoneTypesAssignment.useCreateMany();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useClientQueries(schema).milestoneTypesAssignment.useDeleteMany();

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

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: standardSchemaResolver(FormSchema),
    defaultValues: {
      name: milestoneType.name,
      isDefault: milestoneType.isDefault,
      projects: (milestoneType.projects || []).map(
        (project) => project.projectId
      ),
    },
  });

  const {
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      // Setting isDefault=true clears the previous default atomically via the
      // tpl_single_default_milestonetypes DB trigger — no app-side clear needed.
      await updateMilestoneType({
        where: { id: milestoneType.id },
        data: {
          name: data.name,
          iconId: selectedIconId,
          isDefault: data.isDefault,
        },
      });

      await deleteManyMilestoneTypesAssignment({
        where: { milestoneTypeId: milestoneType.id },
      });

      if (Array.isArray(data.projects) && data.isDefault === false) {
        await createManyMilestoneTypesAssignment({
          data: data.projects.map((projectId) => ({
            milestoneTypeId: milestoneType.id,
            projectId: projectId,
          })),
        });
      }

      if (Array.isArray(data.projects) && data.isDefault) {
        await createManyMilestoneTypesAssignment({
          data: (projects || []).map((project) => ({
            milestoneTypeId: milestoneType.id,
            projectId: project.id,
          })),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
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
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <div>
              <div className="w-16 h-full">
                <FormLabel className="whitespace-nowrap flex items-center">
                  {tCommon("fields.icon")}
                  <HelpPopover helpKey="milestoneType.icon" />
                </FormLabel>
                <FieldIconPicker
                  initialIconId={selectedIconId}
                  onIconSelect={(newIconId) => handleIconSelect(newIconId)}
                />
              </div>
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="milestoneType.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={tCommon("name")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem>
                  <div className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        // There must always be exactly one default milestone
                        // type, so the current default can't be unset directly —
                        // it moves when another type is set as the default.
                        disabled={milestoneType.isDefault}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center mt-0!">
                      {tCommon("fields.default")}
                      <HelpPopover helpKey="milestoneType.isDefault" />
                    </FormLabel>
                  </div>
                  {milestoneType.isDefault ? (
                    <WarningAlert data-testid="milestone-type-default-locked-warning">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        {tGlobal("admin.milestones.defaultLockedTitle")}
                      </AlertTitle>
                      <AlertDescription>
                        {tGlobal("admin.milestones.defaultLockedDescription")}
                      </AlertDescription>
                    </WarningAlert>
                  ) : (
                    field.value && (
                      <WarningAlert data-testid="milestone-type-set-default-warning">
                        <TriangleAlert className="h-4 w-4" />
                        <AlertTitle>
                          {tGlobal(
                            "admin.milestones.confirmDefaultDescription"
                          )}
                        </AlertTitle>
                        <AlertDescription>
                          {tGlobal("admin.milestones.warning")}
                        </AlertDescription>
                      </WarningAlert>
                    )
                  )}
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
                    <HelpPopover helpKey="milestoneType.projects" />
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
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
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
