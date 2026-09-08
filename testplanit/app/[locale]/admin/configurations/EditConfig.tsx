"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { Configurations } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { isUniqueConstraintError } from "~/lib/utils/errors";

const FormSchema = (t: any) =>
  z.object({
    name: z.string().min(1, {
      message: t("fields.validation.nameRequired"),
    }),
    projects: z.array(z.number()).optional(),
  });

interface ConfigurationWithProjects extends Configurations {
  projects?: { projectId: number }[];
}

interface EditConfigurationProps {
  configuration: ConfigurationWithProjects;
  open: boolean;
  onClose: () => void;
}

export function EditConfiguration({
  configuration,
  open,
  onClose,
}: EditConfigurationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfiguration } =
    useClientQueries(schema).configurations.useUpdate();
  const { mutateAsync: createManyProjectConfigurationAssignment } =
    useClientQueries(schema).projectConfigurationAssignment.useCreateMany();
  const { mutateAsync: deleteManyProjectConfigurationAssignment } =
    useClientQueries(schema).projectConfigurationAssignment.useDeleteMany();
  const tCommon = useTranslations("common");

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

  const form = useForm<z.infer<ReturnType<typeof FormSchema>>>({
    resolver: standardSchemaResolver(FormSchema(tCommon)),
    defaultValues: {
      name: configuration.name,
      projects: configuration.projects?.map((p) => p.projectId) ?? [],
    },
  });

  const { control } = form;

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<ReturnType<typeof FormSchema>>) {
    setIsSubmitting(true);
    try {
      await updateConfiguration({
        where: { id: configuration.id },
        data: {
          name: data.name,
        },
      });

      await deleteManyProjectConfigurationAssignment({
        where: { configurationId: configuration.id },
      });

      if (Array.isArray(data.projects) && data.projects.length > 0) {
        await createManyProjectConfigurationAssignment({
          data: data.projects.map((projectId: number) => ({
            configurationId: configuration.id,
            projectId,
          })),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.configurationNameExists"),
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
              <DialogTitle>{tCommon("actions.edit")}</DialogTitle>
              <DialogDescription className="sr-only">
                {tCommon("actions.edit")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="config.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                    <HelpPopover helpKey="config.projects" />
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
                  {errors.root.type === "custom" &&
                  errors.root.message === "duplicate"
                    ? tCommon("errors.duplicate")
                    : tCommon("errors.unknown")}
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
