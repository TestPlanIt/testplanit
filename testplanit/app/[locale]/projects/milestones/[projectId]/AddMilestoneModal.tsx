import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useFindManyMilestoneTypes,
  useFindManyMilestones,
  useCreateMilestones,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CirclePlus } from "lucide-react";
import { Label } from "@/components/ui/label";
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
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { HelpPopover } from "@/components/ui/help-popover";
import { DatePickerField } from "@/components/forms/DatePickerField";

const FormSchema = z.object({
  name: z.string().min(2, {
    error: "Please enter a name for the Milestone",
  }),
  parentId: z.union([z.string().nullable(), z.number().optional()]).optional(),
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

export function AddMilestoneModal() {
  const { data: session } = useSession();
  const { projectId } = useParams();
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createMilestones } = useCreateMilestones();

  const { data: milestoneTypes } = useFindManyMilestoneTypes({
    where: {
      AND: [
        {
          projects: {
            some: {
              projectId: Number(projectId),
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
    include: { icon: true },
  });

  const { data: milestones, isLoading: milestonesLoading } =
    useFindManyMilestones({
      where: {
        projectId: Number(projectId),
        isDeleted: false,
        isCompleted: false,
      },
      orderBy: [
        { startedAt: "asc" },
        { completedAt: "asc" },
        { isStarted: "asc" },
      ],
      include: {
        milestoneType: { select: { icon: true, name: true } },
      },
    });

  const milestoneTypesOptions =
    milestoneTypes?.map((milestoneType) => ({
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
    })) || [];

  const milestonesOptions = transformMilestones(milestones || []);

  const handleCancel = () => setOpen(false);

  const defaultMilestoneTypeId = milestoneTypes?.find(
    (type) => type.isDefault
  )?.id;

  const [noteContent, setNoteContent] = useState<object>({});
  const [docsContent, setDocsContent] = useState<object>({});

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      parentId: undefined,
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

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (session) {
        await createMilestones({
          data: {
            project: {
              connect: { id: Number(projectId) },
            },
            name: data.name,
            note: noteContent
              ? JSON.stringify(noteContent)
              : emptyEditorContent,
            docs: docsContent
              ? JSON.stringify(docsContent)
              : emptyEditorContent,
            isStarted: data.isStarted,
            isCompleted: data.isCompleted,
            startedAt: data.startedAt,
            completedAt: data.completedAt,
            automaticCompletion: data.completedAt
              ? data.automaticCompletion
              : false,
            notifyDaysBefore:
              data.completedAt && data.enableNotifications
                ? data.notifyDaysBefore
                : 0,
            createdAt: new Date(),
            creator: {
              connect: { id: session.user.id },
            },
            parent: data.parentId
              ? { connect: { id: Number(data.parentId) } }
              : undefined,
            milestoneType: {
              connect: { id: data.milestoneTypeId },
            },
          },
        });
        setOpen(false);
        setIsSubmitting(false);
      }
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
      setIsSubmitting(false);
      return;
    }
  }

  const renderMilestoneOptions = (
    milestones: {
      value: string;
      label: React.ReactElement;
      parentId: number | null;
    }[],
    parentId: number | null = null,
    level: number = 0
  ): React.ReactElement[] => {
    return milestones
      .filter((milestone) => milestone.parentId === parentId)
      .map((milestone) => (
        <React.Fragment key={milestone.value}>
          <SelectItem
            value={milestone.value}
            style={{ paddingLeft: `${level * 20}px` }}
          >
            {milestone.label}
          </SelectItem>
          {renderMilestoneOptions(
            milestones,
            parseInt(milestone.value),
            level + 1
          )}
        </React.Fragment>
      ));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="new-milestone-button">
          <CirclePlus className="w-4" />
          <span className="hidden md:inline">
            {t("milestones.actions.add")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("milestones.actions.add")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("milestones.actions.add")}
              </DialogDescription>
            </DialogHeader>
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
                      projectId={projectId!.toString()}
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
            <FormField
              control={control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {t("milestones.fields.parent")}
                    <HelpPopover helpKey="milestone.parent" />
                  </FormLabel>
                  <FormControl>
                    <MilestoneSelect
                      value={field.value}
                      onChange={field.onChange}
                      milestones={milestonesOptions}
                      isLoading={milestonesLoading}
                      placeholder={t("milestones.placeholders.selectParent")}
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
                      projectId={projectId!.toString()}
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
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
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
}
