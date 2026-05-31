"use client";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Configurations } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import MultiSelect from "react-select";
import { z } from "zod/v4";
import {
  useCreateManyProjectConfigurationAssignment,
  useDeleteManyProjectConfigurationAssignment,
  useFindManyProjects,
  useUpdateConfigurations,
} from "~/lib/hooks";
import { getCustomStyles } from "~/styles/multiSelectStyles";

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
  const { mutateAsync: updateConfiguration } = useUpdateConfigurations();
  const { mutateAsync: createManyProjectConfigurationAssignment } =
    useCreateManyProjectConfigurationAssignment();
  const { mutateAsync: deleteManyProjectConfigurationAssignment } =
    useDeleteManyProjectConfigurationAssignment();
  const tCommon = useTranslations("common");

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

  const form = useForm<z.infer<ReturnType<typeof FormSchema>>>({
    resolver: standardSchemaResolver(FormSchema(tCommon)),
    defaultValues: {
      name: configuration.name,
      projects: configuration.projects?.map((p) => p.projectId) ?? [],
    },
  });

  const { control } = form;

  const selectAllProjects = () => {
    form.setValue(
      "projects",
      projectOptions.map((option) => option.value)
    );
  };

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
      if (err.info?.prisma && err.info?.code === "P2002") {
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
                  <FormLabel className="flex justify-between items-center">
                    <span className="flex items-center">
                      {tCommon("fields.projects")}
                      <HelpPopover helpKey="config.projects" />
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
