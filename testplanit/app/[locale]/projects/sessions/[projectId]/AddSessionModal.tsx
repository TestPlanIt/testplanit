import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  useFindManyTemplates,
  useFindManyConfigurations,
  useFindManyWorkflows,
  useFindManyMilestones,
  useFindManyProjectAssignment,
  useCreateSessions,
  useFindManyTags,
  useCreateSessionVersions,
  useFindFirstProjects,
  useCreateAttachments,
  useFindManyIssue,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CirclePlus,
  LayoutList,
  Combine,
  AlertTriangle,
  Asterisk,
} from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import parseDuration from "parse-duration";
import { MAX_DURATION, emptyEditorContent } from "~/app/constants";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { ManageTags } from "@/components/ManageTags";
import type { Attachments } from "@prisma/client";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import UploadAttachments from "@/components/UploadAttachments";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { HelpPopover } from "@/components/ui/help-popover";
import { useTranslations, useLocale } from "next-intl";
import { toHumanReadable } from "~/utils/duration";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { notifySessionAssignment } from "~/app/actions/session-notifications";

interface AddSessionModalProps {
  defaultMilestoneId?: number;
  trigger?: React.ReactNode; // Optional custom trigger
}

export function AddSessionModal({
  defaultMilestoneId,
  trigger,
}: AddSessionModalProps) {
  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const t = useTranslations();
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createSessions } = useCreateSessions();
  const { mutateAsync: createSessionVersions } = useCreateSessionVersions();
  const { mutateAsync: createAttachments } = useCreateAttachments();

  const { data: project } = useFindFirstProjects({
    where: {
      id: Number(projectId),
    },
    select: {
      name: true,
      projectIntegrations: {
        where: { isActive: true },
        include: { integration: true },
      },
    },
  });

  const { data: allIssues } = useFindManyIssue(
    {
      where: {
        // Filter by projectId
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: { id: true, name: true, externalId: true },
    },
    {
      enabled: Boolean(project?.projectIntegrations?.[0]),
    }
  );

  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    orderBy: {
      templateName: "asc",
    },
  });

  const { data: configurations } = useFindManyConfigurations({
    where: {
      isDeleted: false,
      isEnabled: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "SESSIONS",
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      icon: true,
      color: true,
    },
    orderBy: {
      order: "asc",
    },
  });

  const { data: milestones } = useFindManyMilestones({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      isCompleted: false,
    },
    include: {
      milestoneType: { include: { icon: true } },
    },
    orderBy: [{ startedAt: "asc" }, { isStarted: "asc" }],
  });

  const { data: projectAssignments } = useFindManyProjectAssignment({
    where: {
      projectId: Number(projectId),
      user: {
        isActive: true,
        isDeleted: false,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const { data: tags } = useFindManyTags({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  const defaultTemplate = templates?.find((template) => template.isDefault);
  const defaultWorkflow = workflows?.find((workflow) => workflow.isDefault);

  const templatesOptions =
    templates?.map((template) => ({
      value: template.id.toString(),
      label: template.templateName,
    })) || [];

  const configurationsOptions =
    configurations?.map((configuration) => ({
      value: configuration.id.toString(),
      label: configuration.name,
    })) || [];

  const workflowsOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: workflow.name,
      icon: workflow.icon?.name,
      color: workflow.color?.value,
    })) || [];

  const milestonesOptions = transformMilestones(milestones || []);

  const assignedToOptions =
    projectAssignments?.map((assignment) => ({
      value: assignment.user.id,
      label: assignment.user.name,
    })) || [];

  const handleCancel = () => setOpen(false);

  type JsonArray = any[];
  type JsonObject = any;

  const [missionContent, setMissionContent] = useState<
    | string
    | number
    | boolean
    | JsonObject
    | JsonArray
    | { type: string; content: any }
    | null
  >(null);

  const [noteContent, setNoteContent] = useState<object>({});

  const handleUpdate = useCallback((newContent: object) => {
    setMissionContent(newContent);
  }, []);

  const FormSchema = z.object({
    name: z.string().min(2, {
      message: t("common.validation.nameMinLength"),
    }),
    templateId: z.number(),
    configId: z.number().nullable(),
    milestoneId: z.number().nullable(),
    stateId: z.number(),
    assignedToId: z.string().optional(),
    estimate: z
      .string()
      .nullable()
      .refine(
        (value) => {
          if (!value) return true;
          return parseDuration(value) !== null;
        },
        {
          message: t("common.validation.invalidDurationFormat"),
        }
      )
      .refine(
        (value) => {
          if (!value) return true;
          const durationInMilliseconds = parseDuration(value);
          if (!durationInMilliseconds) return false;
          const durationInSeconds = Math.round(durationInMilliseconds / 1000);
          return durationInSeconds <= MAX_DURATION;
        },
        {
          message: `Estimate must be less than or equal to ${toHumanReadable(
            MAX_DURATION,
            {
              isSeconds: true,
              locale,
            }
          )}.`,
        }
      ),
    note: z.any().nullable(),
    mission: z.any().optional(),
    attachments: z.array(z.any()).optional(),
    issueIds: z.array(z.number()).optional(),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      templateId: defaultTemplate?.id || 0,
      configId: null,
      milestoneId: defaultMilestoneId || null,
      stateId: defaultWorkflow?.id || 0,
      assignedToId: "",
      estimate: "",
      note: null,
      mission: null,
      attachments: [],
      issueIds: [],
    },
  });

  const {
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
    setValue,
  } = form;

  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);

  useEffect(() => {
    if (defaultTemplate && defaultWorkflow) {
      reset({
        name: "",
        templateId: defaultTemplate.id,
        configId: null,
        stateId: defaultWorkflow.id,
        assignedToId: "",
        estimate: "",
        note: null,
        mission: null,
        milestoneId: defaultMilestoneId ?? null,
        attachments: [],
        issueIds: [],
      });
      setLinkedIssueIds([]);
      setMissionContent(null);
      setNoteContent({});
      setSelectedTags([]);
      setSelectedFiles([]);
    }
  }, [defaultTemplate, defaultWorkflow, reset, defaultMilestoneId]);

  useEffect(() => {
    if (open) {
      const initialTemplateId =
        defaultTemplate?.id || (templates && templates[0]?.id) || 0;
      const initialWorkflowId =
        defaultWorkflow?.id || (workflows && workflows[0]?.id) || 0;

      reset({
        name: "",
        templateId: initialTemplateId,
        configId: null,
        stateId: initialWorkflowId,
        assignedToId: "",
        estimate: "",
        note: null,
        mission: null,
        milestoneId: defaultMilestoneId ?? null,
        attachments: [],
        issueIds: [],
      });
      setLinkedIssueIds([]);
      setMissionContent(null);
      setNoteContent({});
      setSelectedTags([]);
      setSelectedFiles([]);
    }
  }, [
    open,
    reset,
    defaultTemplate,
    defaultWorkflow,
    defaultMilestoneId,
    templates,
    workflows,
  ]);

  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  const assignedUsers = projectAssignments;

  const userName = session?.user?.name || t("common.labels.unknownUser");

  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const uploadFiles = async (sessionId: number) => {
    const prependString = session!.user.id;
    const sanitizedFolder = projectId?.toString() || "";

    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      const attachment = await createAttachments({
        data: {
          session: {
            connect: { id: sessionId },
          },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: {
            connect: { id: session!.user.id },
          },
        },
      });

      return {
        id: attachment?.id || 0,
        testCaseId: null,
        sessionId: sessionId,
        url: fileUrl,
        name: file.name,
        note: "",
        isDeleted: false,
        mimeType: file.type,
        size: attachment?.size.toString(),
        createdAt: new Date().toISOString(),
        createdById: session!.user.id,
      };
    });

    const attachments = await Promise.all(attachmentsPromises);
    return attachments;
  };

  // --- Fetch Permissions ---
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.Tags);
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  if (!session || !session.user.access) {
    return null;
  }

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (!session?.user?.id) {
        throw new Error(t("common.errors.noUserSession"));
      }

      if (!projectId) {
        throw new Error(t("common.errors.noProjectId"));
      }

      const estimateInSeconds = data.estimate
        ? Math.round(parseDuration(data.estimate) || 0) / 1000
        : null;

      const newSession = await createSessions({
        data: {
          project: {
            connect: { id: Number(projectId) },
          },
          template: {
            connect: { id: data.templateId || defaultTemplate?.id },
          },
          name: data.name,
          currentVersion: 1,
          configuration: data.configId
            ? { connect: { id: data.configId } }
            : undefined,
          milestone: data.milestoneId
            ? { connect: { id: data.milestoneId } }
            : undefined,
          state: {
            connect: { id: data.stateId },
          },
          assignedTo: data.assignedToId
            ? { connect: { id: data.assignedToId } }
            : undefined,
          estimate: estimateInSeconds,
          note: noteContent
            ? JSON.stringify(noteContent)
            : JSON.stringify(emptyEditorContent),
          mission: data.mission
            ? JSON.stringify(data.mission)
            : JSON.stringify(emptyEditorContent),
          createdAt: new Date(),
          createdBy: {
            connect: { id: session.user.id },
          },
          tags: {
            connect: selectedTags.map((tagId) => ({ id: tagId })),
          },
          issues: linkedIssueIds?.length
            ? {
                connect: linkedIssueIds.map((id) => ({ id })),
              }
            : undefined,
        },
      });

      if (!newSession) throw new Error(t("sessions.errors.failedToCreate"));

      const uploadedAttachments =
        selectedFiles.length > 0 ? await uploadFiles(newSession.id) : [];

      const issuesDataForVersion = (linkedIssueIds || [])
        .map((issueId: number) => {
          const issue = allIssues?.find((iss) => iss.id === issueId);
          return issue
            ? { id: issue.id, name: issue.name, externalId: issue.externalId }
            : null;
        })
        .filter(Boolean);

      const newSessionVersion = await createSessionVersions({
        data: {
          session: {
            connect: { id: newSession.id },
          },
          name: data.name,
          staticProjectId: Number(projectId),
          staticProjectName: project?.name || t("common.labels.unknownProject"),
          project: {
            connect: { id: Number(projectId!) },
          },
          templateId: data.templateId,
          templateName:
            templates?.find((template) => template.id === data.templateId)
              ?.templateName || "",
          configId: data.configId || null,
          configurationName:
            configurations?.find((c) => c.id === data.configId)?.name || null,
          milestoneId: data.milestoneId || null,
          milestoneName:
            milestones?.find((m) => m.id === data.milestoneId)?.name || null,
          stateId: data.stateId,
          stateName:
            workflows?.find((workflow) => workflow.id === data.stateId)?.name ||
            "",
          assignedToId: data.assignedToId || null,
          assignedToName:
            assignedUsers?.find((u) => u.userId === data.assignedToId)?.user
              .name || null,
          createdById: session.user.id,
          createdByName: userName,
          estimate: estimateInSeconds,
          forecastManual: null,
          forecastAutomated: null,
          note: noteContent
            ? JSON.stringify(noteContent)
            : JSON.stringify(emptyEditorContent),
          mission: missionContent
            ? JSON.stringify(missionContent)
            : JSON.stringify(emptyEditorContent),
          isCompleted: false,
          completedAt: null,
          version: 1,
          tags: JSON.stringify(
            selectedTags.map((tagId) => ({
              id: tagId,
              name:
                tags?.find((tag) => tag.id === tagId)?.name ||
                t("common.labels.unknownTag"),
            })) || []
          ),
          attachments: JSON.stringify(uploadedAttachments),
          issues: JSON.stringify(issuesDataForVersion),
        },
      });

      if (!newSessionVersion)
        throw new Error(t("sessions.errors.failedToCreateVersion"));

      // Send notification if session was assigned during creation
      if (data.assignedToId) {
        await notifySessionAssignment(newSession.id, data.assignedToId, null);
      }

      setOpen(false);
      setIsSubmitting(false);
      toast.success(t("sessions.messages.createSuccess"));
      if (typeof window !== "undefined") {
        const event = new CustomEvent("sessionCreated", {
          detail: newSession.id,
        });
        window.dispatchEvent(event);
      }
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("sessions.errors.nameAlreadyExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: t("common.errors.unknownErrorWithMessage", {
            message: err.message,
          }),
        });
      }
      setIsSubmitting(false);
      toast.error(t("sessions.errors.createFailed"));
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="icon">
            <CirclePlus className="h-5 w-5" />
          </Button>
        </DialogTrigger>
      )}
      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleClose}
          canEdit={false} // TODO: Add canEdit
        />
      )}
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("sessions.actions.add")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("sessions.actions.add")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[60%_5%_35%] gap-x-4">
              <div className="space-y-4">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.name")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("common.name")} {...field} />
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
                        <HelpPopover helpKey="session.description" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key="editing-note"
                          content={emptyEditorContent}
                          onUpdate={(newContent) => {
                            setNoteContent(newContent);
                          }}
                          readOnly={false}
                          className="h-auto max-h-[150px]"
                          placeholder={t(
                            "common.fields.description_placeholder"
                          )}
                          projectId={projectId!.toString()}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="configId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.configuration")}
                        <HelpPopover helpKey="session.configuration" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="configId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) =>
                                onChange(val === "0" ? null : Number(val))
                              }
                              value={value ? value.toString() : "0"}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("common.access.none")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="0">
                                    {t("common.access.none")}
                                  </SelectItem>
                                  {configurationsOptions.map(
                                    (configuration) => (
                                      <SelectItem
                                        key={configuration.value}
                                        value={configuration.value}
                                      >
                                        <div className="flex items-center gap-1">
                                          <Combine className="w-4 h-4" />
                                          {configuration.label}
                                        </div>
                                      </SelectItem>
                                    )
                                  )}
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
                  name="milestoneId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.milestone")}
                        <HelpPopover helpKey="session.milestone" />
                      </FormLabel>
                      <FormControl>
                        <MilestoneSelect
                          value={field.value}
                          onChange={(value) => {
                            const numericValue = value ? Number(value) : null;
                            field.onChange(numericValue);
                          }}
                          milestones={milestonesOptions}
                          placeholder={t("common.access.none")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="mission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.mission")}
                        <HelpPopover helpKey="session.mission" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key="editing-mission"
                          content={missionContent || emptyEditorContent}
                          onUpdate={(newContent) => {
                            setMissionContent(newContent);
                          }}
                          readOnly={false}
                          className="h-auto"
                          placeholder={t("common.placeholders.mission")}
                          projectId={projectId?.toString() || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="attachments"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.attachments")}
                        <HelpPopover helpKey="session.attachments" />
                      </FormLabel>
                      <FormControl>
                        <div className="space-y-4">
                          <UploadAttachments onFileSelect={handleFileSelect} />
                          {selectedFiles.length > 0 && (
                            <div className="mt-2 text-sm text-muted-foreground">
                              {t("common.labels.filesSelectedForUpload", {
                                count: selectedFiles.length,
                              })}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex items-center justify-center">
                <Separator orientation="vertical" className="h-full" />
              </div>
              <div className="space-y-4 mr-6">
                <FormField
                  control={control}
                  name="templateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.template")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.template" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="templateId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) => onChange(Number(val))}
                              value={value ? value.toString() : ""}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "common.placeholders.selectTemplate"
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {templatesOptions.map((template) => (
                                    <SelectItem
                                      key={template.value}
                                      value={template.value}
                                    >
                                      <div className="flex items-center gap-1">
                                        <LayoutList className="w-4 h-4" />
                                        {template.label}
                                      </div>
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
                  name="stateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.state")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.state" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="stateId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) => onChange(Number(val))}
                              value={value ? value.toString() : ""}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "common.placeholders.selectState"
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {workflowsOptions.map((workflow) => (
                                    <SelectItem
                                      key={workflow.value}
                                      value={workflow.value}
                                    >
                                      <div className="flex items-center gap-1">
                                        <DynamicIcon
                                          className="w-4 h-4 shrink-0"
                                          name={workflow.icon as IconName}
                                          color={workflow.color}
                                        />
                                        {workflow.label}
                                      </div>
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
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.assignedTo")}
                        <HelpPopover helpKey="session.assignedTo" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="assignedToId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) =>
                                onChange(val === "none" ? null : val)
                              }
                              value={value ? value.toString() : "none"}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("common.access.none")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="none">
                                    {t("common.access.none")}
                                  </SelectItem>
                                  {assignedToOptions.map((user) => (
                                    <SelectItem
                                      key={user.value}
                                      value={user.value}
                                    >
                                      <UserNameCell
                                        userId={user.value}
                                        hideLink
                                      />
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
                  name="estimate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.estimate")}
                        <HelpPopover helpKey="session.estimate" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder={t("sessions.placeholders.estimate")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div>
                  <FormLabel className="flex items-center mb-2">
                    {t("common.fields.tags")}
                    <HelpPopover helpKey="session.tags" />
                  </FormLabel>
                  <ManageTags
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    canCreateTags={showAddEditTagsPerm}
                  />
                </div>
                {project?.projectIntegrations?.[0] ? (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {t("common.fields.issues")}
                      <HelpPopover helpKey="session.issues" />
                    </FormLabel>
                    <UnifiedIssueManager
                      projectId={Number(projectId)}
                      linkedIssueIds={linkedIssueIds}
                      setLinkedIssueIds={setLinkedIssueIds}
                      entityType="session"
                    />
                    <FormMessage />
                  </FormItem>
                ) : (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {t("common.errors.issueTrackerNotConfigured")}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              {errors.root && (
                <div
                  className="w-full text-center bg-destructive text-destructive-foreground text-sm p-2 rounded"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.actions.submitting")
                  : t("common.actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
