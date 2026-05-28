"use client";
import { zodResolver } from "@hookform/resolvers/zod";
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
  useUpdateManyConfigurations,
} from "~/lib/hooks";
import { getCustomStyles } from "~/styles/multiSelectStyles";

import { Button } from "@/components/ui/button";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TriangleAlert } from "lucide-react";

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

const FormSchema = z.object({
  projects: z.array(z.number()),
});

type BulkEditFormData = z.infer<typeof FormSchema>;

interface BulkEditConfigurationsProps {
  /** IDs of configurations whose project assignments will be replaced. */
  configurationIds: number[];
  open: boolean;
  onClose: () => void;
}

/**
 * Bulk-edit the project assignments of multiple configurations.
 *
 * Replace semantic: on submit, every selected configuration's existing
 * ProjectConfigurationAssignment rows are deleted and replaced with one row
 * per project chosen in the multi-select. Name and other configuration fields
 * are intentionally not editable in bulk.
 */
export function BulkEditConfigurations({
  configurationIds,
  open,
  onClose,
}: BulkEditConfigurationsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  async function bulkSetEnabled(isEnabled: boolean) {
    if (configurationIds.length === 0) {
      onClose();
      return;
    }
    setIsToggling(true);
    try {
      await updateManyConfigurations({
        where: { id: { in: configurationIds } },
        data: { isEnabled },
      });
      onClose();
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
    } finally {
      setIsToggling(false);
    }
  }
  const tCommon = useTranslations("common");
  const t = useTranslations("admin.configurations");
  const { mutateAsync: createManyProjectConfigurationAssignment } =
    useCreateManyProjectConfigurationAssignment();
  const { mutateAsync: deleteManyProjectConfigurationAssignment } =
    useDeleteManyProjectConfigurationAssignment();
  const { mutateAsync: updateManyConfigurations } =
    useUpdateManyConfigurations();

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

  const form = useForm<BulkEditFormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: { projects: [] },
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

  async function onSubmit(data: BulkEditFormData) {
    if (configurationIds.length === 0) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    try {
      // Replace assignments for all selected configurations.
      await deleteManyProjectConfigurationAssignment({
        where: { configurationId: { in: configurationIds } },
      });

      if (data.projects.length > 0) {
        await createManyProjectConfigurationAssignment({
          data: configurationIds.flatMap((configurationId) =>
            data.projects.map((projectId) => ({
              configurationId,
              projectId,
            }))
          ),
        });
      }

      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {t("bulkEdit.title", { count: configurationIds.length })}
              </DialogTitle>
              <DialogDescription>{t("bulkEdit.description")}</DialogDescription>
            </DialogHeader>
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

            <DialogFooter className="sm:justify-between">
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message || tCommon("errors.unknown")}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSubmitting || isDeleting || isToggling}
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  data-testid="bulk-delete-configurations-button"
                >
                  {t("bulkEdit.deleteButton", {
                    count: configurationIds.length,
                  })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting || isDeleting || isToggling}
                  onClick={() => bulkSetEnabled(false)}
                  data-testid="bulk-disable-configurations-button"
                >
                  {t("bulkEdit.disableButton", {
                    count: configurationIds.length,
                  })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting || isDeleting || isToggling}
                  onClick={() => bulkSetEnabled(true)}
                  data-testid="bulk-enable-configurations-button"
                >
                  {t("bulkEdit.enableButton", {
                    count: configurationIds.length,
                  })}
                </Button>
              </div>
              <div className="flex gap-2 sm:gap-2">
                <Button variant="outline" type="button" onClick={onClose}>
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || isDeleting || isToggling}
                >
                  {isSubmitting
                    ? tCommon("actions.submitting")
                    : t("bulkEdit.applyButton", {
                        count: configurationIds.length,
                      })}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      <AlertDialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
      >
        <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[450px] border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 mr-2" />
              {t("bulkEdit.deleteConfirmTitle", {
                count: configurationIds.length,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("bulkEdit.deleteConfirmMessage", {
                count: configurationIds.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isDeleting}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
              onClick={async (e) => {
                // Prevent the default AlertDialog close so we can keep it open
                // until the async soft-delete resolves.
                e.preventDefault();
                if (configurationIds.length === 0) {
                  setIsDeleteConfirmOpen(false);
                  onClose();
                  return;
                }
                setIsDeleting(true);
                try {
                  await updateManyConfigurations({
                    where: { id: { in: configurationIds } },
                    data: { isDeleted: true },
                  });
                  setIsDeleteConfirmOpen(false);
                  onClose();
                } catch {
                  form.setError("root", {
                    type: "custom",
                    message: tCommon("errors.unknown"),
                  });
                  setIsDeleteConfirmOpen(false);
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting
                ? tCommon("actions.deleting")
                : tCommon("actions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
