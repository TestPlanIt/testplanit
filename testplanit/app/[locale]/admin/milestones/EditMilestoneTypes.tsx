"use client";
import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  useUpdateMilestoneTypes,
  useUpdateManyMilestoneTypes,
  useFindManyProjects,
  useCreateManyMilestoneTypesAssignment,
  useDeleteManyMilestoneTypesAssignment,
} from "~/lib/hooks";
import { MilestoneTypes } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";

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
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

interface ExtendedMilestoneTypes extends MilestoneTypes {
  projects: { projectId: number }[];
}
interface EditMilestoneTypeModalProps {
  milestoneType: ExtendedMilestoneTypes;
}

export function EditMilestoneTypeModal({
  milestoneType,
}: EditMilestoneTypeModalProps) {
  const t = useTranslations("admin.milestones.edit");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIconId, setSelectedIconId] = useState<number | null>(
    milestoneType.iconId
  );

  const FormSchema = z.object({
    name: z.string().min(2, {
        error: "Milestone Type name must be at least 2 characters."
    }),
    isDefault: z.boolean(),
    projects: z.array(z.number()).optional(),
  });

  const { mutateAsync: updateMilestoneType } = useUpdateMilestoneTypes();
  const { mutateAsync: updateManyMilestoneTypes } =
    useUpdateManyMilestoneTypes();
  const { mutateAsync: createManyMilestoneTypesAssignment } =
    useCreateManyMilestoneTypesAssignment();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useDeleteManyMilestoneTypesAssignment();

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

  const handleCancel = () => setOpen(false);

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const defaultFormValues = useMemo(
    () => ({
      name: milestoneType.name,
      isDefault: milestoneType.isDefault,
      projects: (milestoneType.projects || []).map(
        (project) => project.projectId
      ),
    }),
    [milestoneType.name, milestoneType.isDefault, milestoneType.projects]
  );

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
    control,
    setValue,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyMilestoneTypes({
          where: { isDefault: true },
          data: {
            isDefault: false,
          },
        });
      }
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
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
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
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="milestoneType.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={tCommon("fields.name")} {...field} />
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
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="flex items-center !mt-0">
                    {tCommon("fields.default")}
                    <HelpPopover helpKey="milestoneType.isDefault" />
                  </FormLabel>
                  {field.value && (
                    <div>
                      <Alert>
                        <TriangleAlert className="w-8 h-8 -mx-2" />
                        <AlertTitle>{t("setDefault.title")}</AlertTitle>
                        <AlertDescription>
                          {t("setDefault.description")}
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
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
                      <HelpPopover helpKey="milestoneType.projects" />
                    </div>
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
                  {errors.root.message}
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
