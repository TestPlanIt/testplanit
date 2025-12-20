"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";

import { useSession } from "next-auth/react";
import {
  useFindFirstSessions,
  useFindManyTemplates,
  useUpdateSessions,
  useFindManyWorkflows,
  useCreateAttachments,
  useUpdateAttachments,
  useCreateSessionVersions,
  useFindManyConfigurations,
  useFindManyMilestones,
  useFindManyProjectAssignment,
  useFindManySessionVersions,
  useFindManyTags,
  useFindFirstProjects,
} from "~/lib/hooks";
import {
  AttachmentChanges,
} from "@/components/AttachmentsDisplay";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { notifySessionAssignment } from "~/app/actions/session-notifications";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { z } from "zod/v4";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { Loading } from "@/components/Loading";
import { CommentsSection } from "~/components/comments/CommentsSection";

import { emptyEditorContent } from "~/app/constants";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  Save,
  SquarePen,
  CircleSlash2,
  CircleCheckBig,
  Trash2,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ManageTags } from "@/components/ManageTags";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import parseDuration from "parse-duration";
import { MAX_DURATION } from "~/app/constants";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import type { Control, FieldErrors, Resolver } from "react-hook-form";
import type { Sessions, Attachments } from "@prisma/client";
import { ApplicationArea } from "@prisma/client";
import type { JSONContent } from "@tiptap/react";
import { IconName } from "~/types/globals";
import DynamicIcon from "@/components/DynamicIcon";
import { toHumanReadable } from "~/utils/duration";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { ImperativePanelHandle } from "react-resizable-panels";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { Badge } from "@/components/ui/badge";
import { DateFormatter } from "@/components/DateFormatter";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import UploadAttachments from "@/components/UploadAttachments";
import { VersionSelect } from "@/components/VersionSelect";
import { DeleteSessionModal } from "./DeleteSession";
import {
  CompleteSessionDialog,
  CompletableSession,
} from "./CompleteSessionDialog";
import { Link } from "~/lib/navigation";
import { useTranslations, useLocale } from "next-intl";
import SessionResultForm from "@/components/SessionResultForm";
import SessionResultsList from "@/components/SessionResultsList";
import { Separator } from "@/components/ui/separator";
import SessionResultsSummary from "~/components/SessionResultsSummary";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ManageExternalIssues } from "@/components/issues/ManageExternalIssues";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { ForecastDisplay } from "@/components/ForecastDisplay";

// First, define the FormValues interface before the BaseFormSchema
interface FormValues {
  name: string;
  templateId: number;
  configId: number | null;
  milestoneId: number | null;
  stateId: number;
  assignedToId?: string;
  estimate: string;
  note: any;
  mission?: any;
  attachments: Attachments[];
  tags: number[];
  issueIds: number[];
  forecastManual: number | null | undefined;
  forecastAutomated: number | null | undefined;
}

// Then define the base schema
const BaseFormSchema = z.object({
  name: z.string().min(2),
  templateId: z.number(),
  configId: z.number().nullable(),
  milestoneId: z.number().nullable(),
  stateId: z.number(),
  assignedToId: z.string().optional(),
  estimate: z.string().nullable().prefault(""),
  note: z.any().nullable(),
  mission: z.any().optional(),
  attachments: z.array(z.any()).optional(),
  tags: z.array(z.number()).optional(),
  issueIds: z.array(z.number()).optional(),
  forecastManual: z.number().nullable().optional(),
  forecastAutomated: z.number().nullable().optional(),
});

interface Template {
  id: number;
  templateName: string;
}

interface MilestoneType {
  icon?: {
    name: string;
  } | null;
}

interface Milestone {
  id: number;
  name: string;
  milestoneType?: MilestoneType;
  parentId: number | null;
}

interface WorkflowState {
  id: number;
  name: string;
  icon: {
    id: number;
    name: string;
  } | null;
  color: {
    id: number;
    value: string;
  } | null;
}

interface SessionFormControlsProps {
  isEditMode: boolean;
  isSubmitting: boolean;
  testSession:
    | (Sessions & {
        project: { id: number; name: string };
        template: Template;
        configuration: { id: number; name: string } | null;
        milestone: {
          id: number;
          name: string;
          milestoneType?: {
            icon?: {
              name: string;
            } | null;
          } | null;
        } | null;
        state: WorkflowState;
        assignedTo: { id: string; name: string } | null;
        createdBy: { id: string; name: string };
        versions: any[];
        attachments: Attachments[];
        tags: { id: number; name: string }[];
        issues: {
          id: number;
          name: string;
          externalId?: string | null;
          externalUrl?: string | null;
          externalKey?: string | null;
          title?: string | null;
          externalStatus?: string | null;
          data?: any;
          integrationId?: number | null;
          lastSyncedAt?: Date | null;
          issueTypeName?: string | null;
          issueTypeIconUrl?: string | null;
          integration?: {
            id: number;
            provider: string;
            name: string;
          } | null;
        }[];
      })
    | null;
  control: Control<FormValues>;
  errors: FieldErrors<FormValues>;
  templates: Template[] | undefined;
  configurations: { id: number; name: string }[] | undefined;
  workflows: WorkflowState[] | undefined;
  milestones: Milestone[];
  projectAssignments:
    | {
        userId: string;
        user: { id: string; name: string };
      }[]
    | undefined;
  selectedTags: number[];
  setSelectedTags: (tags: number[]) => void;
  projectId: string | string[];
  handleFileSelect: (files: File[]) => void;
  handleSelect: (attachments: Attachments[], index: number) => void;
  issues:
    | {
        id: number;
        name: string;
        externalId?: string | null;
        externalUrl?: string | null;
        title?: string | null;
        externalStatus?: string | null;
        data?: any;
        integrationId?: number | null;
        lastSyncedAt?: Date | null;
        issueTypeName?: string | null;
        issueTypeIconUrl?: string | null;
        integration?: {
          id: number;
          provider: string;
          name: string;
        } | null;
      }[]
    | undefined;
  projectIntegration?: any;
  canAddEditTags: boolean;
  onAttachmentPendingChanges?: (changes: AttachmentChanges) => void;
}

function SessionFormControls({
  isEditMode,
  isSubmitting,
  testSession,
  control,
  errors,
  templates,
  configurations,
  workflows,
  milestones,
  projectAssignments,
  selectedTags,
  setSelectedTags,
  projectId,
  handleFileSelect,
  handleSelect,
  issues,
  projectIntegration,
  canAddEditTags,
  onAttachmentPendingChanges,
}: SessionFormControlsProps) {
  const t = useTranslations("sessions");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const locale = useLocale();
  const { setValue } = useFormContext<FormValues>();

  if (!testSession) return null;

  return (
    <div className="space-y-4">
      {/* Template */}
      <FormField
        control={control}
        name="templateId"
        render={({ field }) => {
          // Check if current value exists in templates
          const currentValueExists = templates?.some(
            (t) => t.id.toString() === field.value?.toString()
          );

          // If value doesn't exist and we have templates, set to first template
          if (!currentValueExists && templates?.length) {
            field.onChange(templates[0].id);
          }

          return (
            <FormItem>
              <FormLabel>{tCommon("fields.template")}</FormLabel>
              <div className="flex items-center gap-2">
                {isEditMode ? (
                  <Select
                    value={field.value?.toString()}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select Template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates?.map((template) => (
                        <SelectItem
                          key={template.id}
                          value={template.id.toString()}
                        >
                          <div className="flex items-start gap-1">
                            <DynamicIcon
                              name="layout-list"
                              className="w-4 h-4 shrink-0 mt-0.5"
                            />
                            {template.templateName}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-start gap-1">
                    <DynamicIcon
                      name="layout-list"
                      className="w-4 h-4 shrink-0 mt-1"
                    />
                    {testSession?.template?.templateName}
                  </div>
                )}
              </div>
            </FormItem>
          );
        }}
      />

      {/* State */}
      <FormField
        control={control}
        name="stateId"
        render={({ field }) => {
          // Check if current value exists in workflows
          const currentValueExists = workflows?.some(
            (w) => w.id.toString() === field.value?.toString()
          );

          // If value doesn't exist and we have workflows, set to first workflow
          if (!currentValueExists && workflows?.length) {
            field.onChange(workflows[0].id);
          }

          return (
            <FormItem>
              <FormLabel>{tGlobal("common.fields.state")}</FormLabel>
              <FormControl>
                {isEditMode ? (
                  <Select
                    onValueChange={(val) => field.onChange(Number(val))}
                    value={field.value?.toString()}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select State" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {workflows?.map((workflow) => (
                          <SelectItem
                            key={workflow.id}
                            value={workflow.id.toString()}
                          >
                            <div className="flex items-start gap-1">
                              <DynamicIcon
                                name={workflow.icon?.name as IconName}
                                color={workflow.color?.value}
                                className="w-4 h-4 shrink-0 mt-0.5"
                              />
                              {workflow.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <WorkflowStateDisplay
                    state={{
                      name: testSession.state.name,
                      icon: testSession?.state.icon
                        ? { name: testSession.state.icon.name as IconName }
                        : { name: "circle" as IconName },
                      color: testSession.state.color || { value: "" },
                    }}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      {/* Configuration */}
      <FormField
        control={control}
        name="configId"
        render={({ field }) => {
          // Check if current value exists in configurations
          const currentValueExists = configurations?.some(
            (c) => c.id.toString() === field.value?.toString()
          );

          // For configuration, we allow null/0 as a valid value ("None")
          if (field.value && !currentValueExists) {
            field.onChange(null);
          }

          return (
            <FormItem>
              <FormLabel>{tGlobal("common.fields.configuration")}</FormLabel>
              <FormControl>
                {isEditMode ? (
                  <Select
                    onValueChange={(val) =>
                      field.onChange(val === "0" ? null : Number(val))
                    }
                    value={field.value?.toString() || "0"}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={tCommon(
                          "placeholders.selectConfiguration"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="0">
                          <div className="flex items-center gap-2">
                            {tCommon("labels.none")}
                          </div>
                        </SelectItem>
                        {configurations?.map((config) => (
                          <SelectItem
                            key={config.id}
                            value={config.id.toString()}
                          >
                            <div className="flex items-center gap-1">
                              <DynamicIcon
                                name="combine"
                                className="h-4 w-4 shrink-0"
                              />
                              {config.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items- gap-1">
                    <DynamicIcon
                      name="combine"
                      className="h-4 w-4 shrink-0 mt-1"
                    />
                    {testSession?.configuration?.name || tCommon("labels.none")}
                  </div>
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      {/* Milestone */}
      <FormField
        control={control}
        name="milestoneId"
        render={({ field }) => {
          return (
            <FormItem>
              <FormLabel>{tGlobal("common.fields.milestone")}</FormLabel>
              <FormControl>
                {isEditMode ? (
                  <MilestoneSelect
                    value={field.value}
                    onChange={(val) =>
                      field.onChange(val === "0" ? null : Number(val))
                    }
                    milestones={transformMilestones(milestones)}
                  />
                ) : (
                  <div className="flex items-start gap-1">
                    <DynamicIcon
                      name={
                        (testSession?.milestone?.milestoneType?.icon?.name ||
                          "milestone") as IconName
                      }
                      className="h-4 w-4 shrink-0 mt-1"
                    />
                    {testSession?.milestone?.name || tGlobal("common.actions.none")}
                  </div>
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      {/* Assigned To */}
      <FormField
        control={control}
        name="assignedToId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tGlobal("common.fields.assignedTo")}</FormLabel>
            <FormControl>
              {isEditMode ? (
                <Select
                  onValueChange={field.onChange}
                  value={field.value || "none"}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("placeholders.selectUser")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">
                        <div className="flex items-center gap-2">
                          <DynamicIcon
                            name="user-round-x"
                            className="h-4 w-4"
                          />
                          {tGlobal("common.actions.none")}
                        </div>
                      </SelectItem>
                      {projectAssignments?.map((assignment) => (
                        <SelectItem
                          key={assignment.userId}
                          value={assignment.userId}
                        >
                          <div className="flex items-center gap-2">
                            <UserNameCell
                              userId={assignment.userId}
                              hideLink={true}
                            />
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <div className="w-fit">
                  {testSession?.assignedTo ? (
                    <UserNameCell
                      userId={testSession.assignedTo.id}
                      hideLink={false}
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <DynamicIcon name="user-round-x" className="h-4 w-4" />
                      {t("placeholders.unassigned")}
                    </div>
                  )}
                </div>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Estimate */}
      <FormField
        control={control}
        name="estimate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tGlobal("common.fields.estimate")}</FormLabel>
            <FormControl>
              {isEditMode ? (
                <Input
                  {...field}
                  placeholder={t("placeholders.estimateHint")}
                  disabled={isSubmitting}
                  value={field.value}
                />
              ) : (
                <div>
                  {testSession?.estimate ? (
                    <span className="text-sm">
                      {toHumanReadable(testSession.estimate, {
                        isSeconds: true,
                        locale,
                      })}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t("placeholders.noEstimate")}
                    </span>
                  )}
                </div>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Tags */}
      <div className="space-y-2">
        <FormLabel>{tGlobal("tags.title")}</FormLabel>
        {isEditMode ? (
          // Wrap ManageTags in FormControl for consistent width in edit mode
          <FormControl>
            <ManageTags
              selectedTags={selectedTags}
              setSelectedTags={setSelectedTags}
              canCreateTags={canAddEditTags}
            />
          </FormControl>
        ) : (
          // View mode remains unchanged
          <div className="flex flex-wrap gap-2">
            {testSession.tags.map((tag) => (
              <TagsDisplay
                key={tag.id}
                id={tag.id}
                name={tag.name}
                link={`/projects/tags/${projectId}/${tag.id}`}
              />
            ))}
            {/* Display 'None' if no tags in view mode */}
            {!testSession.tags ||
              (testSession.tags.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {tCommon("labels.none")}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Issues */}
      <FormField
        control={control}
        name="issueIds"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tCommon("fields.issues")}</FormLabel>
            <FormControl>
              {isEditMode ? (
                <UnifiedIssueManager
                  projectId={Number(projectId)}
                  linkedIssueIds={field.value || []}
                  setLinkedIssueIds={(ids: number[]) =>
                    setValue("issueIds", ids)
                  }
                  entityType="session"
                  entityId={testSession?.id}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {issues?.map((issue) => (
                    <IssuesDisplay
                      key={issue.id}
                      id={issue.id}
                      name={issue.name}
                      externalId={issue.externalId}
                      externalUrl={issue.externalUrl}
                      title={issue.title}
                      status={issue.externalStatus}
                      projectIds={[Number(projectId)]}
                      data={issue.data}
                      integrationProvider={
                        projectIntegration?.integration?.provider
                      }
                      integrationId={projectIntegration?.integration?.id}
                      lastSyncedAt={issue.lastSyncedAt}
                      issueTypeName={issue.issueTypeName}
                      issueTypeIconUrl={issue.issueTypeIconUrl}
                    />
                  ))}
                  {(!issues || issues.length === 0) && (
                    <span className="text-sm text-muted-foreground">
                      {tCommon("labels.none")}
                    </span>
                  )}
                </div>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Forecasts - only shown in view mode and if data exists */}
      {!isEditMode &&
        (testSession?.forecastManual || testSession?.forecastAutomated) && (
          <>
            {testSession?.forecastManual && (
              <div className="space-y-2">
                <FormLabel>{tCommon("fields.forecastManual")}</FormLabel>
                <ForecastDisplay
                  seconds={testSession.forecastManual}
                  type="manual"
                />
              </div>
            )}
            {testSession?.forecastAutomated && (
              <div className="space-y-2">
                <FormLabel>{tCommon("fields.forecastAutomated")}</FormLabel>
                {/* Assuming forecastAutomated is also in seconds */}
                <ForecastDisplay
                  seconds={testSession.forecastAutomated}
                  type="automated"
                />
              </div>
            )}
          </>
        )}

      {/* Attachments */}
      <FormField
        control={control}
        name="attachments"
        render={({ field }) => {
          return (
            <FormItem>
              <FormLabel>{tGlobal("common.fields.attachments")}</FormLabel>
              <FormControl>
                <div className="space-y-4">
                  {isEditMode && (
                    <UploadAttachments onFileSelect={handleFileSelect} />
                  )}
                  <AttachmentsDisplay
                    attachments={
                      isEditMode
                        ? (field.value as Attachments[]) || []
                        : testSession.attachments
                    }
                    preventEditing={false}
                    onSelect={(attachments, index) => {
                      handleSelect(attachments, index);
                    }}
                    deferredMode={isEditMode}
                    onPendingChanges={onAttachmentPendingChanges}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      {/* Created By - only shown in view mode */}
      {!isEditMode && (
        <div className="w-fit space-y-2">
          <FormLabel>{tCommon("fields.createdBy")}</FormLabel>
          <UserNameCell userId={testSession?.createdBy.id} hideLink={false} />
        </div>
      )}
    </div>
  );
}

export default function SessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projectId, sessionId } = useParams();
  const safeProjectId = projectId?.toString() || "";
  const numericProjectId = useMemo(() => {
    const id = parseInt(safeProjectId, 10);
    return isNaN(id) ? null : id;
  }, [safeProjectId]);
  const { data: session, status: sessionStatus } = useSession();
  const [isEditMode, setIsEditMode] = useState(
    searchParams.get("edit") === "true"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [missionContent, setMissionContent] =
    useState<JSONContent>(emptyEditorContent);
  const [noteContent, setNoteContent] =
    useState<JSONContent>(emptyEditorContent);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState(false);
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [panelRightWidth, setPanelRightWidth] = useState(20);
  const panelRightRef = useRef<ImperativePanelHandle>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormLoading, setIsFormLoading] = useState(false);
  const [initialValues, setInitialValues] = useState<FormValues | null>(null);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const panelLeftRef = useRef<ImperativePanelHandle>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: updateAttachments } = useUpdateAttachments();
  const version = searchParams.get("version");
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const t = useTranslations("sessions");
  const tProjects = useTranslations("projects");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [refreshResults, setRefreshResults] = useState(0);
  const { data: projectData, isLoading: isLoadingProjectData } =
    useFindFirstProjects({
      where: { id: numericProjectId ?? undefined },
      select: {
        projectIntegrations: {
          where: {
            isActive: true,
            integration: {
              status: "ACTIVE",
            },
          },
          include: {
            integration: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    });
  const [statusColor, setStatusColor] = useState<string>("#B3B3B3");

  // --- Fetch Permissions ---
  const { permissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId ?? -1, ApplicationArea.Sessions);

  // Fetch ClosedSessions permissions
  const {
    permissions: closedPermissions,
    isLoading: isLoadingClosedPermissions,
  } = useProjectPermissions(
    numericProjectId ?? -1,
    ApplicationArea.ClosedSessions
  );

  // Fetch SessionResults permissions (Corrected Area)
  const {
    permissions: resultsPermissions,
    isLoading: isLoadingResultsPermissions,
  } = useProjectPermissions(
    numericProjectId ?? -1,
    ApplicationArea.SessionResults
  );

  // Fetch Tags permissions
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(numericProjectId ?? -1, ApplicationArea.Tags);

  const canAddEditSession = permissions?.canAddEdit ?? false;
  const canDeleteSession = permissions?.canDelete ?? false;
  const canCloseSession = permissions?.canClose ?? false;
  const canDeleteClosedSession = closedPermissions?.canDelete ?? false;
  const canAddEditResults = resultsPermissions?.canAddEdit ?? false;
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";

  // Combine flags for easier use in JSX
  const showEditButtonPerm = canAddEditSession || isSuperAdmin;
  const showCompleteButtonPerm = canCloseSession || isSuperAdmin;
  const showAddResultFormPerm = canAddEditResults || isSuperAdmin;
  const showEditResultButtonPerm = canAddEditResults || isSuperAdmin;
  const showDeleteResultButtonPerm =
    resultsPermissions?.canDelete || isSuperAdmin;
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  // Define the form schema with translations inside the component
  const FormSchema = BaseFormSchema.superRefine((data, ctx) => {
    // Validate estimate
    if (data.estimate) {
      const estimateDuration = parseDuration(data.estimate);
      if (estimateDuration === null) {
        ctx.issues.push({
          code: z.ZodIssueCode.custom,
          message: tGlobal("common.validation.invalidDurationFormat"),
          path: ["estimate"],
          input: "",
        });
      } else {
        const durationInSeconds = Math.round(estimateDuration / 1000);
        if (durationInSeconds > MAX_DURATION) {
          const maxDurationReadable = toHumanReadable(MAX_DURATION, {
            isSeconds: true,
            locale,
          });
          ctx.issues.push({
            code: z.ZodIssueCode.custom,
            message: t("validation.maxDuration", {
              max: maxDurationReadable,
            }),
            path: ["estimate"],
            input: "",
          });
        }
      }
    }
  });

  // Fetch session data
  const {
    data: sessionData,
    refetch: refetchSession,
    isLoading: isLoadingSession,
  } = useFindFirstSessions({
    where: {
      id: Number(sessionId),
    },
    include: {
      project: true,
      template: true,
      configuration: true,
      milestone: {
        include: {
          milestoneType: {
            include: {
              icon: true,
            },
          },
        },
      },
      state: {
        include: {
          icon: true,
          color: true,
        },
      },
      assignedTo: true,
      createdBy: true,
      versions: true,
      attachments: {
        where: {
          isDeleted: false,
        },
      },
      tags: true,
      issues: {
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          externalId: true,
          externalUrl: true,
          externalKey: true,
          title: true,
          externalStatus: true,
          data: true,
          integrationId: true,
          lastSyncedAt: true,
          issueTypeName: true,
          issueTypeIconUrl: true,
          integration: {
            select: {
              id: true,
              provider: true,
              name: true,
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  // Fetch versions
  const { data: versions, isLoading: isLoadingVersions } =
    useFindManySessionVersions({
      where: { sessionId: Number(sessionId) },
      orderBy: { version: "desc" },
    });

  // Fetch all tags to get their correct names
  const { data: allTags, isLoading: isLoadingTags } = useFindManyTags({
    where: {
      isDeleted: false,
    },
  });

  // Set up form with proper typing
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema) as Resolver<FormValues>,
    defaultValues: {
      name: "",
      templateId: 0,
      configId: null,
      milestoneId: null,
      stateId: 0,
      assignedToId: undefined,
      estimate: "",
      note: null,
      mission: undefined,
      attachments: [],
      tags: [],
      issueIds: [],
      forecastManual: null,
      forecastAutomated: null,
    },
    mode: "onSubmit",
  });

  // Add data fetching queries
  const { data: templates, isLoading: isLoadingTemplates } =
    useFindManyTemplates({
      where: {
        projects: {
          some: {
            projectId: numericProjectId ?? undefined,
          },
        },
        isDeleted: false,
        isEnabled: true,
      },
      orderBy: {
        templateName: "asc",
      },
    });

  const { data: configurations, isLoading: isLoadingConfigurations } =
    useFindManyConfigurations({
      where: {
        isDeleted: false,
        isEnabled: true,
      },
      orderBy: {
        name: "asc",
      },
    });

  const { data: workflows, isLoading: isLoadingWorkflows } =
    useFindManyWorkflows({
      where: {
        isDeleted: false,
        isEnabled: true,
        scope: "SESSIONS",
        projects: {
          some: {
            projectId: numericProjectId ?? undefined,
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

  const { data: milestones, isLoading: isLoadingMilestones } =
    useFindManyMilestones({
      where: {
        projectId: numericProjectId ?? undefined,
        isDeleted: false,
        isCompleted: false,
      },
      include: {
        milestoneType: {
          include: {
            icon: true,
          },
        },
      },
      orderBy: [{ startedAt: "asc" }, { isStarted: "asc" }],
    }) as { data: Milestone[]; isLoading: boolean };

  const { data: projectAssignments, isLoading: isLoadingAssignments } =
    useFindManyProjectAssignment({
      where: {
        projectId: numericProjectId ?? undefined,
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

  // Update form initialization
  useEffect(() => {
    if (sessionData) {
      const formValues: FormValues = {
        name: sessionData.name,
        templateId: sessionData.templateId,
        configId: sessionData.configId,
        milestoneId: sessionData.milestoneId,
        stateId: sessionData.stateId,
        assignedToId: sessionData.assignedToId || undefined,
        estimate: sessionData.estimate
          ? toHumanReadable(sessionData.estimate, {
              isSeconds: true,
              locale,
            })
          : "",
        note: sessionData.note,
        mission: sessionData.mission,
        attachments: sessionData.attachments || [],
        tags: sessionData.tags.map((tag) => tag.id),
        issueIds: sessionData.issues?.map((issue) => issue.id) || [],
        forecastManual: sessionData.forecastManual,
        forecastAutomated: sessionData.forecastAutomated,
      };

      // Reset form and ensure values are set
      form.reset(formValues, {
        keepDefaultValues: true,
      });
      setInitialValues(formValues);
      setSelectedTags(sessionData.tags.map((tag) => tag.id));

      // Delay setting form as initialized
      requestAnimationFrame(() => {
        setIsFormInitialized(true);
      });
    }
  }, [sessionData, form, locale]);

  // Handle edit mode changes
  useEffect(() => {
    // Update isEditMode based on URL parameter
    const isEditing = searchParams.get("edit") === "true";
    if (isEditing !== isEditMode) {
      setIsEditMode(isEditing);
    }
  }, [searchParams, isEditMode]);

  // Update loading state when data changes
  useEffect(() => {
    setIsLoading(
      isLoadingSession ||
        isLoadingTemplates ||
        isLoadingConfigurations ||
        isLoadingWorkflows ||
        isLoadingAssignments ||
        isLoadingMilestones ||
        isLoadingPermissions ||
        isLoadingClosedPermissions ||
        isLoadingResultsPermissions ||
        isLoadingProjectData ||
        isLoadingTagsPermissions ||
        !contentLoaded
    );
  }, [
    isLoadingSession,
    isLoadingTemplates,
    isLoadingConfigurations,
    isLoadingWorkflows,
    isLoadingAssignments,
    isLoadingMilestones,
    isLoadingPermissions,
    isLoadingClosedPermissions,
    isLoadingResultsPermissions,
    isLoadingProjectData,
    isLoadingTagsPermissions,
    contentLoaded,
  ]);

  // Scroll to hash anchor after page loads
  useEffect(() => {
    if (!isLoading && typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash) {
        // Wait a bit for the DOM to be fully rendered
        setTimeout(() => {
          const element = document.querySelector(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [isLoading]);

  // Add mutation hooks
  const { mutateAsync: updateSessions } = useUpdateSessions();
  const { mutateAsync: createSessionVersions } = useCreateSessionVersions();

  // Add form controls
  const {
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = form;

  // Add these functions
  const toggleCollapseLeft = () => {
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
  };

  const toggleCollapseRight = () => {
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
  };

  const handleResize = useCallback((size: number) => {
    setPanelRightWidth(size);
  }, []);

  // Fix the useEffect for content initialization
  useEffect(() => {
    if (sessionData) {
      // Initialize note content
      const noteData = sessionData.note || JSON.stringify(emptyEditorContent);
      try {
        const parsedNote = JSON.parse(noteData as string);
        if (parsedNote.type === "doc") {
          setNoteContent(parsedNote);
        } else {
          setNoteContent(emptyEditorContent);
        }
      } catch (e) {
        console.error("Failed to parse note content:", e);
        setNoteContent(emptyEditorContent);
      }

      // Initialize mission content
      const missionData =
        sessionData.mission || JSON.stringify(emptyEditorContent);
      try {
        const parsedMission = JSON.parse(missionData as string);
        if (parsedMission.type === "doc") {
          setMissionContent(parsedMission);
        } else {
          setMissionContent(emptyEditorContent);
        }
      } catch (e) {
        console.error("Failed to parse mission content:", e);
        setMissionContent(emptyEditorContent);
      }

      // Mark content as loaded after initialization
      setContentLoaded(true);
    }
  }, [sessionData, sessionData?.note, sessionData?.mission]);

  // Add useEffect for initial tags
  useEffect(() => {
    if (sessionData) {
      setSelectedTags(sessionData.tags.map((tag) => tag.id));
    }
  }, [sessionData]);

  // Update onSubmit function
  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      // Transform the data before sending to the server
      const transformedData = {
        ...data,
        assignedToId: data.assignedToId === "none" ? null : data.assignedToId,
        estimate: data.estimate
          ? (() => {
              const duration = parseDuration(data.estimate);
              return duration !== null ? Math.round(duration / 1000) : null;
            })()
          : null,
        note:
          typeof data.note === "string" ? data.note : JSON.stringify(data.note),
        mission:
          typeof data.mission === "string"
            ? data.mission
            : JSON.stringify(data.mission),
      };

      // Update session
      const updatedSession = await updateSessions({
        where: {
          id: Number(sessionId),
        },
        data: {
          name: transformedData.name,
          currentVersion: (sessionData?.versions?.length || 0) + 1,
          templateId: transformedData.templateId,
          configId: transformedData.configId || null,
          milestoneId: transformedData.milestoneId || null,
          stateId: transformedData.stateId,
          assignedToId: transformedData.assignedToId,
          estimate: transformedData.estimate,
          note: transformedData.note,
          mission: transformedData.mission,
          attachments: {
            set: [], // Clear existing attachments
            connect:
              transformedData.attachments?.map((attachment) => ({
                id: attachment.id,
              })) || [],
          },
          tags: {
            set: [],
            connect: selectedTags.map((tagId) => ({
              id: tagId,
            })),
          },
          issues: {
            set: (data.issueIds || []).map((issueId: number) => ({
              id: issueId,
            })),
          },
        },
      });

      if (!updatedSession) throw new Error("Failed to update session");

      // Create new version
      const issuesDataForVersion = (data.issueIds || [])
        .map((issueId: number) => {
          // Need access to allIssues data here or pass it down
          const issue = sessionData?.issues?.find(
            (iss: any) => iss.id === issueId
          );
          return issue
            ? { id: issue.id, name: issue.name, externalId: issue.externalId }
            : null;
        })
        .filter(Boolean);

      const finalAttachments = await uploadFiles(Number(sessionId));

      const newVersion = await createSessionVersions({
        data: {
          session: { connect: { id: Number(sessionId) } },
          name: transformedData.name,
          staticProjectId: Number(projectId),
          staticProjectName: sessionData?.project?.name || "Unknown Project",
          project: { connect: { id: Number(projectId) } },
          templateId: transformedData.templateId,
          templateName:
            templates?.find((t) => t.id === transformedData.templateId)
              ?.templateName || "",
          configId: transformedData.configId || null,
          configurationName:
            configurations?.find((c) => c.id === transformedData.configId)
              ?.name || null,
          milestoneId: transformedData.milestoneId || null,
          milestoneName:
            milestones?.find((m) => m.id === transformedData.milestoneId)
              ?.name || null,
          stateId: transformedData.stateId,
          stateName:
            workflows?.find((w) => w.id === transformedData.stateId)?.name ||
            "",
          assignedToId: transformedData.assignedToId || null,
          assignedToName:
            projectAssignments?.find(
              (u) => u.userId === transformedData.assignedToId
            )?.user.name || null,
          createdById: session!.user.id,
          createdByName: session!.user.name || "Unknown User",
          estimate: transformedData.estimate,
          forecastManual: transformedData.forecastManual,
          forecastAutomated: transformedData.forecastAutomated,
          note: transformedData.note,
          mission: transformedData.mission,
          isCompleted: sessionData?.isCompleted || false,
          completedAt: sessionData?.completedAt || null,
          version: (sessionData?.versions?.length || 0) + 1,
          tags: JSON.stringify(
            selectedTags.map((tagId) => ({
              id: tagId,
            }))
          ),
          attachments: JSON.stringify(
            finalAttachments.map((att) => ({
              ...att,
              size: att.size.toString(),
              createdAt: att.createdAt.toISOString(),
            }))
          ),
        },
      });

      if (!newVersion) throw new Error("Failed to create version");

      // Apply pending attachment edits
      const editPromises = pendingAttachmentChanges.edits.map(async (edit) => {
        await updateAttachments({
          where: { id: edit.id },
          data: {
            name: edit.name,
            note: edit.note,
          },
        });
      });

      // Apply pending attachment deletes (soft delete)
      const deletePromises = pendingAttachmentChanges.deletes.map(
        async (attachmentId) => {
          await updateAttachments({
            where: { id: attachmentId },
            data: { isDeleted: true },
          });
        }
      );

      // Wait for all pending changes to be applied
      await Promise.all([...editPromises, ...deletePromises]);

      // Reset pending changes
      setPendingAttachmentChanges({ edits: [], deletes: [] });
      setSelectedFiles([]);

      await refetchSession();
      const params = new URLSearchParams(searchParams);
      params.delete("edit");
      router.replace(`?${params.toString()}`);

      // Send notification if assignment changed
      if (transformedData.assignedToId !== sessionData?.assignedToId) {
        await notifySessionAssignment(
          Number(sessionId),
          transformedData.assignedToId ?? null,
          sessionData?.assignedToId ?? null
        );
      }
    } catch (err: any) {
      console.error("Submit error:", err);
      form.setError("root", {
        type: "custom",
        message: `An error occurred: ${err.message}`,
      });
    }
    setIsSubmitting(false);
  };

  // Handle edit mode toggle
  const handleEditClick = () => {
    const params = new URLSearchParams(searchParams);
    params.set("edit", "true");
    router.replace(`?${params.toString()}`);
  };

  // Handle cancel
  const handleCancel = () => {
    if (initialValues) {
      form.reset(initialValues);
      const noteData = initialValues.note || JSON.stringify(emptyEditorContent);
      try {
        setNoteContent(JSON.parse(noteData as string));
      } catch {
        setNoteContent(emptyEditorContent);
      }
      const missionData =
        initialValues.mission || JSON.stringify(emptyEditorContent);
      try {
        setMissionContent(JSON.parse(missionData as string));
      } catch {
        setMissionContent(emptyEditorContent);
      }
      setSelectedTags(initialValues.tags || []);
    }
    // Reset pending attachment changes
    setPendingAttachmentChanges({ edits: [], deletes: [] });
    setSelectedFiles([]);
    const params = new URLSearchParams(searchParams);
    params.delete("edit");
    router.replace(`?${params.toString()}`);
  };

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const uploadFiles = async (sessionId: number): Promise<Attachments[]> => {
    const prependString = session!.user.id;
    const sanitizedFolder = projectId?.toString() || "";
    const uploadedAttachments: Attachments[] = [];

    for (const file of selectedFiles) {
      try {
        const fileUrl = await fetchSignedUrl(
          file,
          `/api/get-attachment-url/`,
          `${sanitizedFolder}/${prependString}`
        );

        const attachmentData = {
          session: { connect: { id: sessionId } },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: { connect: { id: session!.user.id } },
        };

        const createdAttachment = await createAttachments({
          data: attachmentData,
        });

        if (createdAttachment) {
          uploadedAttachments.push(createdAttachment as Attachments);
        }
      } catch (error) {
        console.error(`Failed to upload file ${file.name}:`, error);
      }
    }
    return uploadedAttachments;
  };

  const handleVersionChange = (selectedVersion: string) => {
    router.push(
      `/projects/sessions/${projectId}/${sessionId}/${selectedVersion}`
    );
  };

  // Add this function to handle when a new result is added
  const handleResultAdded = () => {
    setRefreshResults((prev) => prev + 1);
  };

  const handleStatusColorChange = useCallback((color: string) => {
    setStatusColor(color);
  }, []);

  if (isLoading || !isFormInitialized || !initialValues) return <Loading />;

  // If we're deleting and sessionData is gone, just show loading while navigation happens
  if (isDeletingSession && !sessionData) {
    return <Loading />;
  }

  if (!sessionData) {
    return (
      <div className="text-muted-foreground text-center p-4">
        {t("notFound")}
      </div>
    );
  }

  const completableSession: CompletableSession = {
    ...sessionData,
    tags: JSON.stringify(
      sessionData.tags
        .map((tag) => ({
          id: tag.id,
          name: tag.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    ),
    attachments: JSON.stringify(
      sessionData.attachments.map((attachment) => ({
        ...attachment,
        size: attachment.size.toString(),
        createdAt: attachment.createdAt.toISOString(),
      }))
    ),
  };
  return (
    <Card
      className={`group-hover:bg-accent/50 transition-colors ${sessionData?.isCompleted ? "bg-muted-foreground/20 border-muted-foreground" : "border-primary"}`}
    >
      {isSubmitting && <LoadingSpinnerAlert />}
      {isFormLoading && <LoadingSpinnerAlert />}
      <FormProvider {...form}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardHeader>
            <div className="flex justify-between items-start">
              {!isEditMode && (
                <div className="mr-2">
                  <Link href={`/projects/sessions/${projectId}`}>
                    <Button variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
              <CardTitle className="w-full pr-4 text-xl md:text-2xl mr-4">
                {isEditMode ? (
                  <FormField
                    control={control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="text-xl md:text-2xl font-semibold border-0 focus-visible:ring-1 focus-visible:ring-ring p-0 h-auto min-h-8 resize-none overflow-hidden"
                            rows={1}
                            onInput={(e) => {
                              const target = e.target as HTMLTextAreaElement;
                              target.style.height = "inherit";
                              target.style.height = `${target.scrollHeight}px`;
                            }}
                            disabled={isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  sessionData?.name || ""
                )}
              </CardTitle>
              <div className="flex items-start gap-2">
                {sessionData?.isCompleted ? (
                  <div className="flex flex-col gap-2">
                    <Badge
                      variant="secondary"
                      className="flex items-center text-md whitespace-nowrap text-sm gap-1 p-2 px-4"
                    >
                      <CircleCheckBig className="h-6 w-6 shrink-0" />
                      <div className="hidden md:block">
                        <span className="mr-1">
                          {tProjects("overview.completedOn")}
                        </span>
                        <DateFormatter
                          date={sessionData?.completedAt}
                          formatString={session?.user.preferences?.dateFormat}
                          timezone={session?.user.preferences?.timezone}
                        />
                      </div>
                    </Badge>
                    {(canDeleteClosedSession || isSuperAdmin) && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setIsDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        {t("actions.delete")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {versions && versions.length > 1 && (
                      <VersionSelect
                        versions={versions || []}
                        currentVersion={
                          sessionData?.versions.length.toString() || "latest"
                        }
                        onVersionChange={handleVersionChange}
                        userDateFormat={session?.user.preferences?.dateFormat}
                        userTimeFormat={session?.user.preferences?.timeFormat}
                      />
                    )}
                    {!isEditMode ? (
                      <div className="flex flex-col gap-2">
                        {showEditButtonPerm && !sessionData?.isCompleted && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleEditClick}
                          >
                            <SquarePen className="h-4 w-4" />
                            {tCommon("actions.edit")}
                          </Button>
                        )}
                        {showCompleteButtonPerm &&
                          !sessionData?.isCompleted && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setIsCompleteDialogOpen(true)}
                            >
                              <CircleCheckBig className="h-4 w-4" />
                              {tCommon("actions.complete")}
                            </Button>
                          )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            variant="default"
                            disabled={isSubmitting}
                          >
                            <Save className="h-4 w-4" />
                            {tCommon("actions.save")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancel}
                            disabled={isSubmitting}
                          >
                            <CircleSlash2 className="h-4 w-4" />
                            {tCommon("actions.cancel")}
                          </Button>
                        </div>
                        {(sessionData?.isCompleted
                          ? canDeleteClosedSession || isSuperAdmin
                          : canDeleteSession || isSuperAdmin) && (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => setIsDeleteDialogOpen(true)}
                            disabled={isSubmitting}
                          >
                            <Trash2 className="h-4 w-4" />
                            {tCommon("actions.delete")}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <ResizablePanelGroup
              direction="horizontal"
              className="min-h-[600px] rounded-lg border"
              autoSaveId="session-panels"
            >
              <ResizablePanel
                ref={panelLeftRef}
                defaultSize={80}
                collapsible
                minSize={30}
                collapsedSize={0}
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
              >
                <div className="flex flex-col h-full p-4">
                  {/* Left panel content */}
                  <div className="space-y-4">
                    {/* Description - hide completely if empty in view mode */}
                    {isEditMode ||
                    (contentLoaded &&
                      JSON.stringify(noteContent) !==
                        JSON.stringify(emptyEditorContent)) ? (
                      <FormField
                        control={control}
                        name="note"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tGlobal("issues.description")}</FormLabel>
                            <FormControl>
                              {contentLoaded ? (
                                <div className="min-h-[50px] max-h-[125px] overflow-y-auto">
                                  <TipTapEditor
                                    key={`editing-note-${isEditMode}`}
                                    content={noteContent}
                                    onUpdate={(newContent) => {
                                      if (isEditMode) {
                                        setNoteContent(newContent);
                                        setValue(
                                          "note",
                                          JSON.stringify(newContent),
                                          {
                                            shouldValidate: true,
                                          }
                                        );
                                      }
                                    }}
                                    readOnly={!isEditMode}
                                    className="h-auto"
                                    placeholder="Add a description..."
                                    projectId={safeProjectId}
                                  />
                                </div>
                              ) : (
                                <div className="h-[150px] flex items-center justify-center bg-muted rounded-md">
                                  <Loading />
                                </div>
                              )}
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}

                    {/* Mission - hide completely if empty in view mode */}
                    {isEditMode ||
                    (contentLoaded &&
                      JSON.stringify(missionContent) !==
                        JSON.stringify(emptyEditorContent)) ? (
                      <FormField
                        control={control}
                        name="mission"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tGlobal("common.fields.mission")}</FormLabel>
                            <FormControl>
                              {contentLoaded ? (
                                <div className="min-h-[50px] max-h-[250px] overflow-y-auto">
                                  <TipTapEditor
                                    key={`editing-mission-${isEditMode}`}
                                    content={missionContent}
                                    onUpdate={(newContent) => {
                                      if (isEditMode) {
                                        setMissionContent(newContent);
                                        setValue(
                                          "mission",
                                          JSON.stringify(newContent),
                                          {
                                            shouldValidate: true,
                                          }
                                        );
                                      }
                                    }}
                                    readOnly={!isEditMode}
                                    className="h-auto"
                                    placeholder="Add a description..."
                                    projectId={safeProjectId}
                                  />
                                </div>
                              ) : (
                                <div className="h-[250px] flex items-center justify-center bg-muted rounded-md">
                                  <Loading />
                                </div>
                              )}
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                  </div>
                  {!isEditMode && sessionData && (
                    <div className="w-full space-y-4">
                      {/* Only show separator if either description or mission is not empty */}
                      {contentLoaded &&
                        (JSON.stringify(noteContent) !==
                          JSON.stringify(emptyEditorContent) ||
                          JSON.stringify(missionContent) !==
                            JSON.stringify(emptyEditorContent)) && (
                          <Separator className="my-4" />
                        )}

                      <div className="flex items-end justify-end mb-2">
                        <SessionResultsSummary
                          sessionId={sessionData.id}
                          className="mb-2"
                          textSize="md"
                        />
                      </div>

                      {/* Session Results Section */}
                      {!sessionData.isCompleted && showAddResultFormPerm && (
                        <Card
                          className="mb-4"
                          style={{
                            border: `6px solid ${statusColor}`,
                            borderRadius: "0.5rem",
                          }}
                        >
                          <CardHeader className="pb-3">
                            <CardTitle className="text-md">
                              {t("results.add")}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <SessionResultForm
                              sessionId={sessionData.id}
                              projectId={safeProjectId}
                              onResultAdded={handleResultAdded}
                              onStatusColorChange={handleStatusColorChange}
                              alwaysShowForm={true}
                              className="mb-0"
                            />
                          </CardContent>
                        </Card>
                      )}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-md">
                            {t("results.title")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <SessionResultsList
                            sessionId={sessionData.id}
                            projectId={safeProjectId}
                            key={`results-list-${refreshResults}`}
                            canEditResults={showEditResultButtonPerm}
                            canDeleteResults={showDeleteResultButtonPerm}
                            isCompleted={sessionData?.isCompleted ?? false}
                          />
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </ResizablePanel>

              <div>
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseLeft}
                          variant="ghost"
                          size="sm"
                          className={`p-1 h-full border-y ${isCollapsedLeft ? "rounded-l-none" : "rounded-r-none"}`}
                          aria-label={
                            isCollapsedLeft
                              ? tCommon("actions.expandLeftPanel")
                              : tCommon("actions.collapseLeftPanel")
                          }
                        >
                          <ChevronLeft
                            className={`h-4 w-4 transition-transform ${isCollapsedLeft ? "rotate-180" : ""}`}
                          />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>
                        {isCollapsedLeft
                          ? tCommon("actions.expandLeftPanel")
                          : tCommon("actions.collapseLeftPanel")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <ResizableHandle
                withHandle
                className="w-1 bg-border hover:bg-primary transition-colors duration-200"
              />

              <div>
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseRight}
                          variant="ghost"
                          size="sm"
                          className={`p-1 h-full border-y ${isCollapsedRight ? "rounded-r-none" : "rounded-l-none rotate-180"}`}
                          aria-label={
                            isCollapsedRight
                              ? tCommon("actions.expandRightPanel")
                              : tCommon("actions.collapseRightPanel")
                          }
                        >
                          <ChevronLeft className="h-4 w-4 transition-transform" />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>
                        {isCollapsedRight
                          ? tCommon("actions.expandRightPanel")
                          : tCommon("actions.collapseRightPanel")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <ResizablePanel
                ref={panelRightRef}
                defaultSize={panelRightWidth}
                onResize={handleResize}
                collapsedSize={0}
                minSize={10}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
              >
                <div className="p-4 space-y-4">
                  {sessionData && (
                    <>
                      <SessionFormControls
                        isEditMode={isEditMode}
                        isSubmitting={isSubmitting}
                        testSession={sessionData}
                        control={control}
                        errors={errors}
                        templates={templates}
                        configurations={configurations}
                        workflows={workflows}
                        milestones={milestones || []}
                        projectAssignments={projectAssignments}
                        selectedTags={selectedTags}
                        setSelectedTags={setSelectedTags}
                        projectId={safeProjectId}
                        handleFileSelect={handleFileSelect}
                        handleSelect={handleSelect}
                        issues={sessionData.issues}
                        projectIntegration={
                          projectData?.projectIntegrations?.[0]
                        }
                        canAddEditTags={showAddEditTagsPerm}
                        onAttachmentPendingChanges={setPendingAttachmentChanges}
                      />
                      {selectedAttachmentIndex !== null && (
                        <AttachmentsCarousel
                          attachments={selectedAttachments}
                          initialIndex={selectedAttachmentIndex}
                          onClose={handleClose}
                          canEdit={canAddEditSession || isSuperAdmin}
                        />
                      )}
                      {!isEditMode && session?.user && (
                        <>
                          <Separator className="my-4" />
                          <div id="comments">
                            <CommentsSection
                              projectId={Number(projectId)}
                              entityType="session"
                              entityId={sessionData.id}
                              currentUserId={session.user.id}
                              isAdmin={session.user.access === "ADMIN"}
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}
                  <CompleteSessionDialog
                    open={isCompleteDialogOpen}
                    onOpenChange={setIsCompleteDialogOpen}
                    session={completableSession}
                    projectId={numericProjectId!}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </CardContent>
        </form>
      </FormProvider>
      <DeleteSessionModal
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        sessionId={Number(sessionId)}
        projectId={numericProjectId!}
        testSession={sessionData}
        onBeforeDelete={() => setIsDeletingSession(true)}
      />
    </Card>
  );
}
