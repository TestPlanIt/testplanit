"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useFindManyMilestoneTypes } from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { HelpPopover } from "@/components/ui/help-popover";
import { DatePickerField } from "@/components/forms/DatePickerField";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { MilestoneFormData } from "./AddMilestonesToProjectsWizard";

const FormSchema = z.object({
  name: z.string().min(2, {
    error: "Please enter a name for the Milestone",
  }),
  note: z.any().nullable(),
  docs: z.any().nullable(),
  isStarted: z.boolean(),
  isCompleted: z.boolean(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  automaticCompletion: z.boolean(),
  enableNotifications: z.boolean(),
  notifyDaysBefore: z.number().min(1),
  milestoneTypeId: z.number({
    error: (issue) =>
      issue.input === undefined ? "Please select a Milestone Type" : undefined,
  }),
});

interface MilestoneFormDialogProps {
  open: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onSubmit: (data: MilestoneFormData, userId: string) => Promise<void>;
  selectedProjectIds: number[];
  isSubmitting: boolean;
}

export const MilestoneFormDialog: React.FC<MilestoneFormDialogProps> = ({
  open,
  onClose,
  onPrevious,
  onSubmit,
  selectedProjectIds,
  isSubmitting,
}) => {
  const { data: session } = useSession();
  const t = useTranslations();

  const [noteContent, setNoteContent] = useState<object>({});
  const [docsContent, setDocsContent] = useState<object>({});

  // Fetch milestone types for all selected projects
  const { data: allMilestoneTypes, isLoading: milestoneTypesLoading } =
    useFindManyMilestoneTypes({
      where: {
        AND: [
          {
            projects: {
              some: {
                projectId: {
                  in: selectedProjectIds,
                },
              },
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
      orderBy: {
        name: "asc",
      },
      include: {
        icon: true,
        projects: true,
      },
    });

  // Calculate common milestone types (present in ALL selected projects)
  const commonMilestoneTypes = useMemo(() => {
    if (!allMilestoneTypes || selectedProjectIds.length === 0) {
      return [];
    }

    return allMilestoneTypes.filter((milestoneType) => {
      // Check if this milestone type is assigned to ALL selected projects
      const assignedProjectIds = milestoneType.projects.map(
        (p) => p.projectId
      );
      return selectedProjectIds.every((projectId) =>
        assignedProjectIds.includes(projectId)
      );
    });
  }, [allMilestoneTypes, selectedProjectIds]);

  const milestoneTypesOptions = useMemo(
    () =>
      commonMilestoneTypes?.map((milestoneType) => ({
        value: milestoneType.id.toString(),
        label: (
          <div className="flex items-center">
            <DynamicIcon
              className="w-5 h-5"
              name={milestoneType.icon?.name as IconName}
            />
            <span className="ml-1">{milestoneType.name}</span>
          </div>
        ),
      })) || [],
    [commonMilestoneTypes]
  );

  const defaultMilestoneTypeId = commonMilestoneTypes?.find(
    (type) => type.isDefault
  )?.id;

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      note: null,
      docs: null,
      isStarted: false,
      isCompleted: false,
      startedAt: undefined,
      completedAt: undefined,
      automaticCompletion: false,
      enableNotifications: true,
      notifyDaysBefore: 5,
      milestoneTypeId: defaultMilestoneTypeId,
    },
  });

  const {
    handleSubmit,
    control,
    formState: { errors },
    setValue,
    reset,
    watch,
  } = form;

  const completedAt = watch("completedAt");
  const enableNotifications = watch("enableNotifications");
  const hasDueDate = !!completedAt;

  useEffect(() => {
    if (defaultMilestoneTypeId) {
      setValue("milestoneTypeId", defaultMilestoneTypeId);
    }
  }, [defaultMilestoneTypeId, setValue]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        name: "",
        note: null,
        docs: null,
        isStarted: false,
        isCompleted: false,
        startedAt: undefined,
        completedAt: undefined,
        automaticCompletion: false,
        enableNotifications: true,
        notifyDaysBefore: 5,
        milestoneTypeId: defaultMilestoneTypeId,
      });
      setNoteContent({});
      setDocsContent({});
    }
  }, [open, reset, defaultMilestoneTypeId]);

  // Toggle enableNotifications based on due date presence
  useEffect(() => {
    if (completedAt) {
      setValue("enableNotifications", true);
    } else {
      setValue("enableNotifications", false);
    }
  }, [completedAt, setValue]);

  if (!session || !session.user.access) {
    return null;
  }

  async function handleFormSubmit(data: z.infer<typeof FormSchema>) {
    if (!session?.user?.id) {
      form.setError("root", {
        type: "custom",
        message: t("common.errors.unknown"),
      });
      return;
    }

    try {
      await onSubmit(
        {
          name: data.name,
          milestoneTypeId: data.milestoneTypeId,
          note: noteContent,
          docs: docsContent,
          isStarted: data.isStarted,
          isCompleted: data.isCompleted,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          automaticCompletion: data.completedAt ? data.automaticCompletion : false,
          notifyDaysBefore:
            data.completedAt && data.enableNotifications
              ? data.notifyDaysBefore
              : 0,
        },
        session.user.id
      );
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("milestones.errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: `${t("common.errors.unknown")} ${err.message}`,
        });
      }
      return;
    }
  }

  const hasNoCommonTypes = !milestoneTypesLoading && commonMilestoneTypes.length === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("admin.milestones.wizard.createMilestone")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("admin.milestones.wizard.createMilestone")}
              </DialogDescription>
            </DialogHeader>

            {hasNoCommonTypes ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("admin.milestones.wizard.noCommonTypesTitle")}</AlertTitle>
                <AlertDescription>
                  {t("admin.milestones.wizard.noCommonTypesDescription")}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.name")}
                        <HelpPopover helpKey="milestone.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("common.fields.name")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.description")}
                        <HelpPopover helpKey="milestone.description" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key="editing-note"
                          content={emptyEditorContent}
                          onUpdate={(newContent) => {
                            setNoteContent(newContent);
                            setValue("note", JSON.stringify(newContent));
                          }}
                          readOnly={false}
                          className="h-auto max-h-[150px]"
                          placeholder={t("milestones.placeholders.description")}
                          projectId={selectedProjectIds[0]?.toString()}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="milestoneTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("milestones.fields.type")}
                        <HelpPopover helpKey="milestone.type" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="milestoneTypeId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) => onChange(Number(val))}
                              value={value ? value.toString() : ""}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "milestones.placeholders.selectType"
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {milestoneTypesOptions.map((milestoneType) => (
                                    <SelectItem
                                      key={milestoneType.value}
                                      value={milestoneType.value}
                                    >
                                      {milestoneType.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-row items-start space-x-3 space-y-0">
                    <FormField
                      control={control}
                      name="isStarted"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="flex items-center">
                            {t("milestones.fields.started")}
                            <HelpPopover helpKey="milestone.started" />
                          </FormLabel>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex flex-col">
                    <FormField
                      control={control}
                      name="startedAt"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <DatePickerField
                            control={control}
                            name="startedAt"
                            label={t("milestones.fields.startDate")}
                            placeholder={t("milestones.fields.startDate")}
                            helpKey="milestone.startDate"
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex flex-row items-start space-x-3 space-y-0">
                    <FormField
                      control={control}
                      name="isCompleted"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="flex items-center">
                            {t("common.fields.completed")}
                            <HelpPopover helpKey="milestone.completed" />
                          </FormLabel>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex flex-col">
                    <FormField
                      control={control}
                      name="completedAt"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <DatePickerField
                            control={control}
                            name="completedAt"
                            label={t("milestones.fields.dueDate")}
                            placeholder={t("milestones.fields.dueDate")}
                            helpKey="milestone.dueDate"
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex flex-row items-start space-x-3 space-y-0">
                    <FormField
                      control={control}
                      name="automaticCompletion"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={!hasDueDate}
                            />
                          </FormControl>
                          <FormLabel className="flex items-center">
                            {t("milestones.fields.automaticCompletion")}
                            <HelpPopover helpKey="milestone.automaticCompletion" />
                          </FormLabel>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex flex-col">
                    <FormField
                      control={control}
                      name="enableNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={!hasDueDate}
                            />
                          </FormControl>
                          <FormLabel className="flex items-center">
                            {t("milestones.fields.notifyDaysBefore")}
                            <HelpPopover helpKey="milestone.notifyDaysBefore" />
                          </FormLabel>
                          <FormField
                            control={control}
                            name="notifyDaysBefore"
                            render={({ field: daysField }) => (
                              <FormControl>
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="5"
                                  disabled={!hasDueDate || !enableNotifications}
                                  {...daysField}
                                  onChange={(e) =>
                                    daysField.onChange(parseInt(e.target.value) || 1)
                                  }
                                  className="max-w-[80px]"
                                />
                              </FormControl>
                            )}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                <FormField
                  control={control}
                  name="docs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.documentation")}
                        <HelpPopover helpKey="milestone.documentation" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key="editing-docs"
                          content={emptyEditorContent}
                          onUpdate={(newContent) => {
                            setDocsContent(newContent);
                            setValue("docs", JSON.stringify(newContent));
                          }}
                          readOnly={false}
                          className="h-auto"
                          placeholder={t("milestones.placeholders.documentation")}
                          projectId={selectedProjectIds[0]?.toString()}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={onPrevious}
                disabled={isSubmitting}
              >
                {t("common.actions.previous")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || hasNoCommonTypes}>
                {isSubmitting
                  ? t("common.status.saving")
                  : t("common.actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
