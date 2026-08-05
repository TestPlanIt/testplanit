"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { AttachmentChanges } from "@/components/AttachmentsDisplay";
import {
  ConfigurationGroupLinkField,
  type ConfigurationGroupLinkChange,
} from "@/components/ConfigurationGroupLinkField";
import { Loading } from "@/components/Loading";
import { RequestReviewButton } from "@/components/reviews/RequestReviewButton";
import { SessionAuditLogSheet } from "@/components/sessions/SessionAuditLogSheet";
import { RecordId } from "@/components/RecordId";
import { ReviewStatusBanner } from "@/components/reviews/ReviewStatusBanner";
import { useTransitionGateStatus } from "~/hooks/useTransitionGateStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useSession } from "next-auth/react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { z } from "zod/v4";
import { notifySessionAssignment } from "~/app/actions/session-notifications";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { CommentsSection } from "~/components/comments/CommentsSection";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { ConfigurationSelect } from "@/components/forms/ConfigurationSelect";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import { CreationInfo } from "@/components/CreationInfo";
import { DateFormatter } from "@/components/DateFormatter";
import DynamicIcon from "@/components/DynamicIcon";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { ManageTags } from "@/components/ManageTags";
import SessionResultForm from "@/components/SessionResultForm";
import SessionResultsList from "@/components/SessionResultsList";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import {
  ActionBar,
  ActionButtonContent,
  ActionOverflow,
  collapsibleActionClass,
  useContainerCompact,
} from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import UploadAttachments, {
  type LinkAttachmentInput,
} from "@/components/UploadAttachments";
import { VersionSelect } from "@/components/VersionSelect";
import type { Attachments, Sessions } from "~/zenstack/models";
import { ApplicationArea } from "~/zenstack/models";
import type { JSONContent } from "@tiptap/react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CircleSlash2,
  Combine,
  Compass,
  FileDown,
  History,
  Save,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import parseDuration from "parse-duration";
import type { Control, FieldErrors, Resolver } from "react-hook-form";
import { PanelImperativeHandle } from "react-resizable-panels";
import { emptyEditorContent, MAX_DURATION } from "~/app/constants";
import {
  applyConfigurationGroupPeerStamp,
  canEditConfigurationGroup,
  configurationGroupUpdateData,
} from "~/lib/configurationGroupLink";
import {
  buildConfigurationGroupMemberLabels,
  buildConfigurationGroupWhere,
  isConfigurationGroupQueryEnabled,
} from "~/lib/configurationGroupSwitcher";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { useExportSessionPdf } from "~/hooks/pdf/useExportSessionPdf";
import SessionResultsSummary from "~/components/SessionResultsSummary";
import { Link } from "~/lib/navigation";
import { IconName } from "~/types/globals";
import { toHumanReadable } from "~/utils/duration";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import {
  CompletableSession,
  CompleteSessionDialog,
} from "./CompleteSessionDialog";
import { DeleteSessionModal } from "./DeleteSession";

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
  /** Configuration-group membership; null when this session is not linked. */
  configurationGroupId: string | null;
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
  configurationGroupId: z.string().nullable(),
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
  requiresReview?: boolean;
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

  workflows: WorkflowState[] | undefined;
  milestones: Milestone[];
  numericProjectId: number;
  selectedTags: number[];
  setSelectedTags: (tags: number[]) => void;
  projectId: string | string[];
  handleFileSelect: (files: File[]) => void;
  handleLinksChange?: (links: LinkAttachmentInput[]) => void;
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
  canAddEditTags: boolean;
  /** Rendered between Configuration and Milestone — the configuration-group
   *  link belongs with the configuration it qualifies. Passed as a slot so
   *  this component stays free of the group's state and mutations. */
  configurationGroupSlot?: React.ReactNode;
  onAttachmentPendingChanges?: (changes: AttachmentChanges) => void;
  transitionCheck?: {
    allowed: boolean;
    blockingGate: { id: number; name: string } | null;
  };
}

function SessionFormControls({
  isEditMode,
  isSubmitting,
  testSession,
  control,
  errors: _errors,
  templates,
  workflows,
  milestones,
  numericProjectId,
  selectedTags,
  setSelectedTags,
  projectId,
  handleFileSelect,
  handleLinksChange,
  handleSelect,
  issues,
  canAddEditTags,
  configurationGroupSlot,
  onAttachmentPendingChanges,
  transitionCheck,
}: SessionFormControlsProps) {
  const t = useTranslations("sessions");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const locale = useLocale();
  const { setValue } = useFormContext<FormValues>();

  if (!testSession) return null;

  return (
    <div className="space-y-4 [&_label]:text-base [&_label]:font-bold">
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
                      <SelectValue
                        placeholder={tCommon("placeholders.selectTemplate")}
                      />
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
                    <SelectTrigger className="w-fit">
                      <SelectValue
                        placeholder={tCommon("placeholders.selectState")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {workflows?.map((workflow) => (
                          <SelectItem
                            key={workflow.id}
                            value={workflow.id.toString()}
                          >
                            <WorkflowStateDisplay
                              state={{
                                name: workflow.name,
                                icon: {
                                  name: (workflow.icon?.name ??
                                    "circle") as IconName,
                                },
                                color: {
                                  value: workflow.color?.value ?? "",
                                },
                                requiresReview: workflow.requiresReview,
                              }}
                              size="sm"
                            />
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
                      requiresReview: testSession.state.requiresReview,
                    }}
                  />
                )}
              </FormControl>
              <FormMessage />
              {isEditMode &&
                transitionCheck &&
                !transitionCheck.allowed &&
                transitionCheck.blockingGate && (
                  <p className="text-[0.8rem] font-medium text-destructive mt-1">
                    {tGlobal("reviews.transitionGate.blockedByGate", {
                      gateName: transitionCheck.blockingGate.name,
                    })}
                  </p>
                )}
            </FormItem>
          );
        }}
      />

      {/* Configuration */}
      <FormField
        control={control}
        name="configId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tGlobal("common.fields.configuration")}</FormLabel>
            <FormControl>
              {isEditMode ? (
                <ConfigurationSelect
                  value={field.value}
                  onChange={(val) => field.onChange(val)}
                  disabled={isSubmitting}
                  projectId={Number(projectId)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <DynamicIcon
                    name="combine"
                    className="h-4 w-4 shrink-0 mt-1"
                  />
                  {testSession?.configuration?.name || tCommon("access.none")}
                </div>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {configurationGroupSlot}

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
                    {testSession?.milestone?.name ||
                      tGlobal("common.access.none")}
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
                <AsyncCombobox
                  value={
                    field.value && field.value !== "none"
                      ? {
                          id: field.value,
                          name:
                            testSession?.assignedTo?.id === field.value
                              ? testSession.assignedTo.name
                              : field.value,
                          email: null as string | null,
                          image: null as string | null,
                        }
                      : null
                  }
                  onValueChange={(user) => {
                    field.onChange(user ? user.id : "none");
                  }}
                  fetchOptions={(query, page, pageSize) =>
                    searchProjectMembers(
                      numericProjectId,
                      query,
                      page,
                      pageSize
                    )
                  }
                  renderOption={(user) => (
                    <UserNameCell userId={user.id} hideLink />
                  )}
                  getOptionValue={(user) => user.id}
                  placeholder={tGlobal("sessions.placeholders.selectUser")}
                  disabled={isSubmitting}
                  className="w-full"
                  pageSize={20}
                  showTotal={true}
                  showUnassigned={true}
                />
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
                      {tGlobal("common.labels.unassigned")}
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
        <FormLabel>{tGlobal("common.fields.tags")}</FormLabel>
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
                size="small"
              />
            ))}
            {/* Display 'None' if no tags in view mode */}
            {!testSession.tags ||
              (testSession.tags.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {tCommon("access.none")}
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
                      size="small"
                      data={issue.data}
                      integrationProvider={issue.integration?.provider}
                      integrationId={
                        issue.integration?.id ??
                        issue.integrationId ??
                        undefined
                      }
                      issueTypeName={issue.issueTypeName}
                      issueTypeIconUrl={issue.issueTypeIconUrl}
                    />
                  ))}
                  {(!issues || issues.length === 0) && (
                    <span className="text-sm text-muted-foreground">
                      {tCommon("access.none")}
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
                    <UploadAttachments
                      onFileSelect={handleFileSelect}
                      allowLinks={!!handleLinksChange}
                      onLinksChange={handleLinksChange}
                    />
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
                  {!isEditMode &&
                    (!testSession.attachments ||
                      testSession.attachments.length === 0) && (
                      <span className="text-sm text-muted-foreground">
                        {tCommon("access.none")}
                      </span>
                    )}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      {/* Created By - only shown in view mode */}
      {!isEditMode && (
        <CreationInfo
          userId={testSession?.createdBy.id}
          createdAt={testSession?.createdAt}
          className="w-fit"
        />
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
  const { data: session } = useSession();
  const [isEditMode, setIsEditMode] = useState(
    searchParams.get("edit") === "true"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  // Initialize selectedTags from the loaded session ONCE. Creating a tag invalidates parent queries
  // (the session includes its tags), refetching sessionData; without this guard the re-sync effect
  // below would revert the user's in-progress tag edits on that refetch.
  const hasInitializedTagsRef = useRef(false);
  const [missionContent, setMissionContent] =
    useState<JSONContent>(emptyEditorContent);
  const [noteContent, setNoteContent] =
    useState<JSONContent>(emptyEditorContent);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState(false);
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [isTransitioningLeft, setIsTransitioningLeft] = useState(false);
  const [isTransitioningRight, setIsTransitioningRight] = useState(false);
  const panelRightRef = useRef<PanelImperativeHandle>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormLoading, _setIsFormLoading] = useState(false);
  const [initialValues, setInitialValues] = useState<FormValues | null>(null);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const panelLeftRef = useRef<PanelImperativeHandle>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });
  const { mutateAsync: createAttachments } =
    useClientQueries(schema).attachments.useCreate();
  const { mutateAsync: updateAttachments } =
    useClientQueries(schema).attachments.useUpdate();
  const _version = searchParams.get("version");
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  // Action bar collapses into a kebab when the header is narrow (mirrors the
  // repository case details bar).
  const { ref: headerRef, compact: headerCompact } = useContainerCompact();
  const [auditOpen, setAuditOpen] = useState(false);
  // Peer awaiting a `configurationGroupId` stamp — set when the user links
  // this session to a peer that had no group of its own, cleared once saved.
  const [configGroupStampTargetId, setConfigGroupStampTargetId] = useState<
    number | null
  >(null);
  const t = useTranslations("sessions");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [refreshResults, setRefreshResults] = useState(0);
  const { isLoading: isLoadingProjectData } = useClientQueries(
    schema
  ).projects.useFindFirst({
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
  } = useClientQueries(schema).sessions.useFindFirst({
    where: {
      id: Number(sessionId),
    },
    include: {
      project: true,
      template: {
        include: {
          caseFields: {
            include: {
              caseField: {
                include: {
                  type: true,
                  fieldOptions: {
                    include: { fieldOption: true },
                  },
                },
              },
            },
          },
        },
      },
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
      sessionFieldValues: {
        include: {
          field: { include: { type: true } },
        },
      },
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

  // Fetch sibling sessions for multi-config groups
  type SiblingSession = {
    id: number;
    name: string;
    configuration: { id: number; name: string } | null;
  };

  // Group membership is editable, so the sibling query is scoped to this
  // session's project: a stale or hand-written group id must not surface
  // sessions from another project.
  const siblingQueryScope = {
    configurationGroupId: sessionData?.configurationGroupId,
    projectId: sessionData?.projectId ?? numericProjectId,
  };

  const { data: siblingSessions } = useClientQueries(
    schema
  ).sessions.useFindMany(
    {
      where: buildConfigurationGroupWhere(siblingQueryScope),
      select: {
        id: true,
        name: true,
        configuration: { select: { id: true, name: true } },
      },
      // Members may share a configuration, so break ties on id for a stable
      // switcher order.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
    { enabled: isConfigurationGroupQueryEnabled(siblingQueryScope) }
  );

  const siblingList: SiblingSession[] = useMemo(
    () => (siblingSessions as SiblingSession[]) || [],
    [siblingSessions]
  );
  const isMultiConfigSession =
    !!sessionData?.configurationGroupId && siblingList.length > 1;

  const currentSibling = useMemo(
    () => siblingList.find((s) => s.id === Number(sessionId)) || null,
    [siblingList, sessionId]
  );

  // Two sessions in a group may share a configuration, so entries the
  // configuration cannot identify carry the session name as well.
  const siblingLabels = useMemo(
    () =>
      buildConfigurationGroupMemberLabels(siblingList, {
        noConfiguration: tCommon("labels.noConfiguration"),
        withMemberName: (values) =>
          tCommon("labels.configurationWithName", values),
      }),
    [siblingList, tCommon]
  );

  const siblingLabel = useCallback(
    (sibling: SiblingSession) => siblingLabels.get(sibling.id) ?? sibling.name,
    [siblingLabels]
  );

  const fetchSiblingConfigurations = useCallback(
    async (query: string, page: number, pageSize: number) => {
      let filtered = siblingList;
      if (query) {
        const lower = query.toLowerCase();
        filtered = siblingList.filter(
          (s) =>
            s.name.toLowerCase().includes(lower) ||
            s.configuration?.name?.toLowerCase().includes(lower) ||
            siblingLabel(s).toLowerCase().includes(lower)
        );
      }
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [siblingList, siblingLabel]
  );

  // Fetch versions
  const { data: versions } = useClientQueries(
    schema
  ).sessionVersions.useFindMany({
    where: { sessionId: Number(sessionId) },
    orderBy: { version: "desc" },
  });

  // Fetch session results for PDF export
  const { data: sessionResultsForExport } = useClientQueries(
    schema
  ).sessionResults.useFindMany({
    where: { sessionId: Number(sessionId), isDeleted: false },
    include: {
      status: { include: { color: true } },
      createdBy: { select: { name: true } },
      attachments: { where: { isDeleted: false } },
      issues: {
        select: {
          name: true,
          title: true,
          externalId: true,
          externalKey: true,
        },
      },
      resultFieldValues: {
        include: {
          field: { include: { type: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // PDF export hook
  const sessionExportData = sessionData
    ? {
        ...sessionData,
        sessionResults: sessionResultsForExport || [],
      }
    : null;
  const { isExporting: isExportingPdf, handleExport: handleExportPdf } =
    useExportSessionPdf({
      sessionData: sessionExportData,
      locale: locale,
    });

  // Set up form with proper typing
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(FormSchema) as Resolver<FormValues>,
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
      configurationGroupId: null,
    },
    mode: "onSubmit",
  });

  // Add data fetching queries
  const { data: templates, isLoading: isLoadingTemplates } = useClientQueries(
    schema
  ).templates.useFindMany({
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

  const { data: workflows, isLoading: isLoadingWorkflows } = useClientQueries(
    schema
  ).workflows.useFindMany({
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

  const reachableGatedStates = useMemo(() => {
    if (!workflows || !sessionData) return [];
    const currentStateId = sessionData.stateId;
    // Only gates STRICTLY AFTER the current state — see the matching
    // comment on the test-case detail page.
    const currentStateOrder =
      workflows.find((w) => w.id === currentStateId)?.order ?? -Infinity;
    return workflows
      .filter(
        (w) =>
          w.requiresReview === true &&
          w.id !== currentStateId &&
          w.order > currentStateOrder
      )
      .map((w) => ({
        id: w.id,
        name: w.name,
        icon: { name: (w.icon?.name ?? "circle") as string },
        color: { value: w.color?.value ?? "" },
      }));
  }, [workflows, sessionData]);

  const { data: milestones, isLoading: isLoadingMilestones } = useClientQueries(
    schema
  ).milestones.useFindMany({
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
        configurationGroupId: sessionData.configurationGroupId ?? null,
      };

      // Reset form and ensure values are set
      form.reset(formValues, {
        keepDefaultValues: true,
      });
      setInitialValues(formValues);

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
        isLoadingWorkflows ||
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
    isLoadingWorkflows,
    isLoadingMilestones,
    isLoadingPermissions,
    isLoadingClosedPermissions,
    isLoadingResultsPermissions,
    isLoadingProjectData,
    isLoadingTagsPermissions,
    contentLoaded,
  ]);

  // Scroll to hash anchor after page loads
  const scrolledHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoading && typeof window !== "undefined") {
      const hash = window.location.hash;
      // Scroll once per hash so loading-state flips don't yank the viewport back
      if (hash && scrolledHashRef.current !== hash) {
        // Wait a bit for the DOM to be fully rendered
        setTimeout(() => {
          const element = document.querySelector(hash);
          if (element) {
            scrolledHashRef.current = hash;
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [isLoading]);

  // Add mutation hooks
  const { mutateAsync: updateSessions } =
    useClientQueries(schema).sessions.useUpdate();
  const { mutateAsync: createSessionVersions } =
    useClientQueries(schema).sessionVersions.useCreate();

  // Add form controls
  const {
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = form;

  // Client mirror of the strict-transitive review gate. The live inline
  // error rendered under the state Select reads off `transitionCheck`;
  // `onSubmit` re-runs the preflight before firing the mutation. We do NOT
  // mirror the gate result through `setError` — that previously caused an
  // infinite render loop via the `errors.stateId` dep.
  const transitionGate = useTransitionGateStatus(
    "SESSION",
    sessionData?.id ?? 0,
    sessionData?.stateId ?? null,
    Number(projectId)
  );
  const watchedStateId = form.watch("stateId");
  const transitionCheck = transitionGate.canTransitionTo(watchedStateId);

  // Add these functions
  const toggleCollapseLeft = () => {
    setIsTransitioningLeft(true);
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
    setTimeout(() => setIsTransitioningLeft(false), 300);
  };

  const toggleCollapseRight = () => {
    setIsTransitioningRight(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioningRight(false), 300);
  };

  // Fix the useEffect for content initialization
  useEffect(() => {
    if (sessionData) {
      // Initialize note content
      const noteData = sessionData.note || JSON.stringify(emptyEditorContent);
      try {
        const parsedNote = JSON.parse(noteData as string);
        if (parsedNote && parsedNote.type === "doc") {
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
        if (parsedMission && parsedMission.type === "doc") {
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

  // Initialize the tag selection from the loaded session, once (see hasInitializedTagsRef) so a
  // tag-create refetch of sessionData does not revert in-progress edits.
  useEffect(() => {
    if (sessionData && !hasInitializedTagsRef.current) {
      setSelectedTags(sessionData.tags.map((tag) => tag.id));
      hasInitializedTagsRef.current = true;
    }
  }, [sessionData]);

  // Configuration-group link/unlink. The control is offered in edit mode only,
  // so the change is staged here and written by the form's submit path.
  const handleConfigurationGroupChange = (
    change: ConfigurationGroupLinkChange
  ) => {
    setValue("configurationGroupId", change.groupId, { shouldDirty: true });
    setConfigGroupStampTargetId(change.stampTargetId);
  };

  // Update onSubmit function
  const onSubmit = async (data: FormValues) => {
    // Strict-transitive review-gate preflight. The live inline error
    // rendered under the state Select reads off the same `transitionGate`,
    // so we DON'T also `setError` here — that double-renders the message
    // (once inline + once via `FormMessage`) and previously caused an
    // infinite render loop via the `errors.stateId` dep.
    const gatePreflight = transitionGate.canTransitionTo(data.stateId);
    if (!gatePreflight.allowed && gatePreflight.blockingGate) {
      return;
    }

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
          // Assigning `configurationGroupId` makes the RPC guard re-validate
          // the group and sweep it for auto-dissolve, so only send it when the
          // user actually changed it — an unchanged value can neither break an
          // invariant nor orphan a group.
          ...((data.configurationGroupId ?? null) !==
          (sessionData?.configurationGroupId ?? null)
            ? configurationGroupUpdateData(data.configurationGroupId)
            : {}),
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

      // A join against a peer that had no group of its own mints one uuid for
      // both records; this session was just stamped above, the peer is stamped
      // here. Rolls this session back if the peer write fails.
      await applyConfigurationGroupPeerStamp({
        update: (args) => updateSessions(args),
        recordId: Number(sessionId),
        groupId: data.configurationGroupId,
        stampTargetId: configGroupStampTargetId,
        previousGroupId: sessionData?.configurationGroupId ?? null,
      });
      setConfigGroupStampTargetId(null);

      // Create new version
      const _issuesDataForVersion = (data.issueIds || [])
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
            sessionData?.configuration?.id === transformedData.configId
              ? sessionData.configuration.name
              : null,
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
            sessionData?.assignedTo?.id === transformedData.assignedToId
              ? (sessionData?.assignedTo?.name ?? null)
              : null,
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
      setSelectedLinks([]);

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

    for (const link of selectedLinks) {
      try {
        const createdAttachment = await createAttachments({
          data: {
            session: { connect: { id: sessionId } },
            url: link.url,
            name: link.name,
            note: link.note ?? "",
            mimeType: link.mimeType,
            size: BigInt(link.size),
            createdBy: { connect: { id: session!.user.id } },
          },
        });

        if (createdAttachment) {
          uploadedAttachments.push(createdAttachment as Attachments);
        }
      } catch (error) {
        console.error(`Failed to register link ${link.url}:`, error);
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
          <div className="px-6 pt-6">
            <ReviewStatusBanner
              entityType="SESSION"
              entityId={sessionData.id}
              projectId={Number(projectId)}
              entityName={sessionData.name}
              reachableGatedStates={reachableGatedStates}
              currentStateId={sessionData.stateId}
            />
          </div>
          <CardHeader>
            <div
              ref={headerRef}
              className="flex justify-between items-center gap-2"
            >
              {!isEditMode && (
                <div className="me-2">
                  <Link href={`/projects/sessions/${projectId}`}>
                    <Button type="button" variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
              <CardTitle className="w-full pe-4 text-xl md:text-2xl me-4">
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
                  <span className="flex items-center gap-2">
                    <Compass className="h-6 w-6 shrink-0" />
                    {sessionData?.name || ""}
                  </span>
                )}
              </CardTitle>
              <div className="flex flex-col items-end gap-1">
                {!isEditMode && sessionData && (
                  <RecordId
                    type="SESSION"
                    id={sessionData.id}
                    projectId={numericProjectId ?? undefined}
                    className="shrink-0 whitespace-nowrap"
                  />
                )}
                <ActionBar
                  compact={headerCompact}
                  className="items-start gap-2"
                >
                  {sessionData && (
                    <SessionAuditLogSheet
                      sessionId={sessionData.id}
                      hideTrigger
                      open={auditOpen}
                      onOpenChange={setAuditOpen}
                    />
                  )}
                  {sessionData?.isCompleted ? (
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="secondary"
                        className="flex items-center text-md whitespace-nowrap text-sm gap-1 p-2 px-4"
                      >
                        <CircleCheckBig className="h-6 w-6 shrink-0" />
                        <div className="hidden md:block">
                          <span className="me-1">
                            {tCommon("fields.completedOn")}
                          </span>
                          <DateFormatter
                            date={sessionData?.completedAt}
                            formatString={session?.user.preferences?.dateFormat}
                            timezone={session?.user.preferences?.timezone}
                          />
                        </div>
                      </Badge>
                      <ActionOverflow
                        compact={headerCompact}
                        menuLabel={tCommon("actions.actionsLabel")}
                        actions={[
                          {
                            key: "activity",
                            icon: History,
                            label: tCommon("fields.activityLog"),
                            onClick: () => setAuditOpen(true),
                          },
                          {
                            key: "export",
                            icon: FileDown,
                            label: isExportingPdf
                              ? tCommon("actions.exportingPdf")
                              : tCommon("actions.exportPdf"),
                            onClick: handleExportPdf,
                            disabled: isExportingPdf,
                          },
                          {
                            key: "delete",
                            icon: Trash2,
                            label: t("actions.delete"),
                            onClick: () => setIsDeleteDialogOpen(true),
                            destructive: true,
                            hidden: !(canDeleteClosedSession || isSuperAdmin),
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <>
                      {versions && versions.length > 1 && (
                        <VersionSelect
                          versions={versions}
                          currentVersion={
                            sessionData?.versions.length.toString() || "latest"
                          }
                          onVersionChange={handleVersionChange}
                          userDateFormat={session?.user.preferences?.dateFormat}
                          userTimeFormat={session?.user.preferences?.timeFormat}
                        />
                      )}
                      {!isEditMode ? (
                        <div className="flex items-center gap-1">
                          <RequestReviewButton
                            entityType="SESSION"
                            entityId={sessionData.id}
                            projectId={Number(projectId)}
                            currentStateId={sessionData.stateId}
                            reachableGatedStates={reachableGatedStates}
                          />
                          <ActionOverflow
                            compact={headerCompact}
                            menuLabel={tCommon("actions.actionsLabel")}
                            actions={[
                              {
                                key: "activity",
                                icon: History,
                                label: tCommon("fields.activityLog"),
                                onClick: () => setAuditOpen(true),
                              },
                              {
                                key: "edit",
                                icon: SquarePen,
                                label: tCommon("actions.edit"),
                                onClick: handleEditClick,
                                hidden: !(
                                  showEditButtonPerm &&
                                  !sessionData?.isCompleted
                                ),
                              },
                              {
                                key: "export",
                                icon: FileDown,
                                label: isExportingPdf
                                  ? tCommon("actions.exportingPdf")
                                  : tCommon("actions.exportPdf"),
                                onClick: handleExportPdf,
                                disabled: isExportingPdf,
                              },
                              {
                                key: "complete",
                                icon: CircleCheckBig,
                                label: tCommon("actions.complete"),
                                onClick: () => setIsCompleteDialogOpen(true),
                                hidden: !(
                                  showCompleteButtonPerm &&
                                  !sessionData?.isCompleted
                                ),
                              },
                            ]}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            {(() => {
                              const gateBlocked =
                                !transitionCheck.allowed &&
                                transitionCheck.blockingGate;
                              const formHasErrors =
                                Object.keys(errors).length > 0;
                              const saveBlocked = gateBlocked || formHasErrors;
                              const tooltipMessage = gateBlocked
                                ? tGlobal(
                                    "reviews.transitionGate.blockedByGate",
                                    {
                                      gateName:
                                        transitionCheck.blockingGate!.name,
                                    }
                                  )
                                : tGlobal(
                                    "reviews.transitionGate.saveBlockedByFormErrors"
                                  );

                              if (!saveBlocked) {
                                return (
                                  <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={isSubmitting}
                                    className={collapsibleActionClass(
                                      headerCompact
                                    )}
                                  >
                                    <ActionButtonContent
                                      icon={Save}
                                      label={tCommon("actions.save")}
                                    />
                                  </Button>
                                );
                              }

                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span tabIndex={0}>
                                      <Button
                                        type="submit"
                                        variant="outline"
                                        disabled
                                        className={collapsibleActionClass(
                                          headerCompact,
                                          "ring-2 ring-destructive ring-offset-2 ring-offset-background"
                                        )}
                                      >
                                        <ActionButtonContent
                                          icon={Save}
                                          label={tCommon("actions.save")}
                                        />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {tooltipMessage}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })()}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCancel}
                              disabled={isSubmitting}
                              className={collapsibleActionClass(headerCompact)}
                            >
                              <ActionButtonContent
                                icon={CircleSlash2}
                                label={tCommon("cancel")}
                              />
                            </Button>
                          </div>
                          {(sessionData?.isCompleted
                            ? canDeleteClosedSession || isSuperAdmin
                            : canDeleteSession || isSuperAdmin) && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setIsDeleteDialogOpen(true)}
                              disabled={isSubmitting}
                              className={collapsibleActionClass(
                                headerCompact,
                                "text-destructive"
                              )}
                            >
                              <ActionButtonContent
                                icon={Trash2}
                                label={tCommon("actions.delete")}
                              />
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </ActionBar>
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
                id="session-left"
                order={1}
                ref={panelLeftRef}
                defaultSize={80}
                collapsible
                minSize={30}
                collapsedSize={0}
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
                className={
                  isTransitioningLeft
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="flex flex-col h-full p-4">
                  {/* Left panel content */}
                  <div className="space-y-4">
                    {/* Description - hide completely if empty in view mode */}
                    {isEditMode ||
                    (contentLoaded && !isTiptapEmpty(noteContent)) ? (
                      <FormField
                        control={control}
                        name="note"
                        render={({ field: _field }) => (
                          <FormItem>
                            <FormLabel>
                              {tCommon("fields.description")}
                            </FormLabel>
                            <FormControl>
                              {contentLoaded ? (
                                <div className="min-h-[50px]">
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
                                    placeholder={tCommon(
                                      "placeholders.addADescription"
                                    )}
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
                    (contentLoaded && !isTiptapEmpty(missionContent)) ? (
                      <FormField
                        control={control}
                        name="mission"
                        render={({ field: _field }) => (
                          <FormItem>
                            <FormLabel>
                              {tGlobal("common.fields.mission")}
                            </FormLabel>
                            <FormControl>
                              {contentLoaded ? (
                                <div className="min-h-[50px]">
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
                                    placeholder={tCommon(
                                      "placeholders.addADescription"
                                    )}
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
                        (!isTiptapEmpty(noteContent) ||
                          !isTiptapEmpty(missionContent)) && (
                          <Separator className="my-4" />
                        )}

                      {/* Configuration selector for multi-config sessions */}
                      {isMultiConfigSession && (
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex items-center gap-1 shrink-0 font-semibold">
                            <Combine className="w-4 h-4" />
                            <span>{tCommon("fields.configurations")}:</span>
                          </div>
                          <AsyncCombobox<SiblingSession>
                            value={currentSibling}
                            onValueChange={(selected) => {
                              if (
                                selected &&
                                selected.id !== Number(sessionId)
                              ) {
                                router.push(
                                  `/projects/sessions/${projectId}/${selected.id}`
                                );
                              }
                            }}
                            fetchOptions={fetchSiblingConfigurations}
                            renderOption={(option) => (
                              <div className="flex items-center gap-2 min-w-0">
                                <ConfigurationNameDisplay
                                  configuration={option.configuration}
                                  name={siblingLabel(option)}
                                  truncate
                                />
                              </div>
                            )}
                            getOptionValue={(option) => option.id}
                            placeholder={tCommon(
                              "placeholders.selectConfiguration"
                            )}
                            className="flex-1"
                          />
                        </div>
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
                            {tCommon("fields.title")}
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
                <Button
                  type="button"
                  onClick={toggleCollapseLeft}
                  variant="secondary"
                  className="p-0 rounded-e-none"
                >
                  {isCollapsedLeft ? <ChevronRight /> : <ChevronLeft />}
                </Button>
              </div>

              <ResizableHandle withHandle className="w-1" />

              <div>
                <Button
                  type="button"
                  onClick={toggleCollapseRight}
                  variant="secondary"
                  className={`p-0 transform ${isCollapsedRight ? "rounded-s-none" : "rounded-e-none rotate-180"}`}
                >
                  <ChevronLeft />
                </Button>
              </div>

              <ResizablePanel
                id="session-right"
                order={2}
                ref={panelRightRef}
                defaultSize={20}
                collapsedSize={0}
                minSize={10}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={
                  isTransitioningRight
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="p-4 space-y-4">
                  <SessionFormControls
                    isEditMode={isEditMode}
                    isSubmitting={isSubmitting}
                    testSession={sessionData}
                    control={control}
                    errors={errors}
                    templates={templates}
                    workflows={workflows}
                    milestones={milestones || []}
                    numericProjectId={numericProjectId!}
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    projectId={safeProjectId}
                    handleFileSelect={handleFileSelect}
                    handleLinksChange={setSelectedLinks}
                    handleSelect={handleSelect}
                    issues={sessionData.issues}
                    canAddEditTags={showAddEditTagsPerm}
                    onAttachmentPendingChanges={setPendingAttachmentChanges}
                    transitionCheck={transitionCheck}
                    configurationGroupSlot={
                      <ConfigurationGroupLinkField
                        model="sessions"
                        recordId={sessionData.id}
                        projectId={numericProjectId!}
                        value={form.watch("configurationGroupId") ?? null}
                        savedValue={sessionData.configurationGroupId ?? null}
                        onChange={handleConfigurationGroupChange}
                        editable={
                          isEditMode &&
                          canEditConfigurationGroup({
                            canAddEdit: canAddEditSession || isSuperAdmin,
                            isCompleted: !!sessionData.isCompleted,
                          })
                        }
                        disabled={isSubmitting}
                      />
                    }
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
