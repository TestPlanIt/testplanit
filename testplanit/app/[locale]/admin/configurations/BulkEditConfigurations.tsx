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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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
  // Opt-in: when `applyProjects` is true, the project assignments on every
  // selected configuration are replaced with `projects`. When false, the
  // project assignments are left untouched.
  applyProjects: z.boolean(),
  // Opt-in: when `applyEnabled` is true, the bulk-edit also sets isEnabled
  // on every selected configuration to the value of `enabledState`. When false
  // the enabled state is left untouched.
  applyEnabled: z.boolean(),
  enabledState: z.boolean(),
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
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
    defaultValues: {
      projects: [],
      // Defaults are unchecked, which makes both project and enabled-state
      // changes opt-in. Without checking the gate the corresponding field is
      // disabled and the submit leaves that aspect untouched.
      applyProjects: false,
      applyEnabled: false,
      enabledState: true,
    },
  });
  const applyProjects = form.watch("applyProjects");
  const applyEnabled = form.watch("applyEnabled");
  const enabledState = form.watch("enabledState");

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
      // Replace project assignments only when the gate is checked; leaves the
      // existing assignments untouched when the user only wants to flip the
      // enabled state.
      if (data.applyProjects) {
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
      }

      // Opt-in: flip isEnabled on every selected configuration when the user
      // checked the "Set enabled state" gate.
      if (data.applyEnabled) {
        await updateManyConfigurations({
          where: { id: { in: configurationIds } },
          data: { isEnabled: data.enabledState },
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
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-8 flex flex-col min-h-[480px]"
          >
            <DialogHeader>
              <DialogTitle>
                {t("bulkEdit.title", { count: configurationIds.length })}
              </DialogTitle>
              <DialogDescription>{t("bulkEdit.description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label
                htmlFor="bulk-apply-enabled"
                className="flex justify-between items-center"
              >
                <span className="flex items-center">
                  {t("bulkEdit.applyEnabledLabel")}
                  <HelpPopover helpKey="config.bulkEnabledState" />
                </span>
              </Label>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="bulk-apply-enabled"
                  checked={applyEnabled}
                  onCheckedChange={(value) => {
                    form.setValue("applyEnabled", !!value);
                  }}
                  data-testid="bulk-apply-enabled-checkbox"
                />
                <Switch
                  checked={enabledState}
                  onCheckedChange={(value) =>
                    form.setValue("enabledState", value)
                  }
                  disabled={!applyEnabled}
                  data-testid="bulk-enabled-state-switch"
                />
              </div>
            </div>

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
                    {applyProjects && (
                      <div
                        onClick={selectAllProjects}
                        style={{ cursor: "pointer" }}
                      >
                        {tCommon("actions.selectAll")}
                      </div>
                    )}
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="bulk-apply-projects"
                        checked={applyProjects}
                        onCheckedChange={(value) => {
                          form.setValue("applyProjects", !!value);
                        }}
                        data-testid="bulk-apply-projects-checkbox"
                      />
                      <Controller
                        control={control}
                        name="projects"
                        render={({ field }) => (
                          <MultiSelect
                            {...field}
                            isMulti
                            isDisabled={!applyProjects}
                            maxMenuHeight={300}
                            className="grow w-[400px] sm:w-[500px] lg:w-[900px]"
                            classNamePrefix="select"
                            // Keep the menu inline (no portal): the shared
                            // `customStyles` already sets the menu's z-index
                            // to 9999 so it stacks above other dialog content,
                            // and the dialog's `min-h` reserves room for it.
                            // Portaling it to the body broke wheel-scrolling
                            // because Radix Dialog's scroll-lock captures
                            // wheel events outside the dialog tree.
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
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="sm:justify-between mt-auto">
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message || tCommon("errors.unknown")}
                </div>
              )}
              <Button
                type="button"
                variant="destructive"
                disabled={isSubmitting || isDeleting}
                onClick={() => setIsDeleteConfirmOpen(true)}
                data-testid="bulk-delete-configurations-button"
              >
                {t("bulkEdit.deleteButton", {
                  count: configurationIds.length,
                })}
              </Button>
              <div className="flex gap-2 sm:gap-2">
                <Button variant="outline" type="button" onClick={onClose}>
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting || isDeleting}>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
