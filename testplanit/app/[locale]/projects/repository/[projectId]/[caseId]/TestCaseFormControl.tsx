import React from "react";
import { useFormContext } from "react-hook-form";
import { Attachments, Tags } from "@prisma/client";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { FormField, FormControl, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { ManageTags } from "@/components/ManageTags";
import UploadAttachments from "@/components/UploadAttachments";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import {
  AttachmentsDisplay,
  AttachmentChanges,
} from "@/components/AttachmentsDisplay";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { DurationDisplay } from "@/components/DurationDisplay";
import { useTranslations } from "next-intl";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ForecastDisplay } from "~/components/ForecastDisplay";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import { CommentsSection } from "~/components/comments/CommentsSection";
import { UserDisplay } from "@/components/search/UserDisplay";
import { DateFormatter } from "@/components/DateFormatter";

interface TestCaseFormControlsProps {
  isEditMode: boolean;
  isSubmitting: boolean;
  testcase: any;
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  selectedFiles: File[];
  handleSelect: (attachments: Attachments[], index: number) => void;
  selectedAttachmentIndex: number | null;
  selectedAttachments: Attachments[];
  handleClose: () => void;
  errors: Record<string, any>;
  projectIntegration?: any;
  canAddEdit: boolean;
  canCreateTags?: boolean;
  session?: any;
  onAttachmentPendingChanges?: (changes: AttachmentChanges) => void;
}

const TestCaseFormControls: React.FC<TestCaseFormControlsProps> = ({
  isEditMode,
  isSubmitting,
  testcase,
  setSelectedFiles,
  selectedFiles,
  handleSelect,
  selectedAttachmentIndex,
  selectedAttachments,
  handleClose,
  errors,
  projectIntegration,
  canAddEdit,
  canCreateTags = false,
  session,
  onAttachmentPendingChanges,
}) => {
  const { control } = useFormContext();
  const t = useTranslations();

  return (
    <div role="region" aria-label={t("repository.version.detailsRegion")}>
      <ul className="ml-1 list-none" role="list">
        {isEditMode && !isSubmitting ? (
          <>
            <FormField
              name="estimate"
              render={({ field }) => (
                <li className="mb-2 mr-6">
                  <label htmlFor="estimate" className="font-bold">
                    {t("repository.fields.estimate")}
                  </label>
                  <FormControl>
                    <Input
                      id="estimate"
                      type="text"
                      placeholder={t("repository.fields.estimate")}
                      {...field}
                      disabled={
                        isSubmitting ||
                        (isEditMode && isAutomatedCaseSource(testcase?.source))
                      }
                    />
                  </FormControl>
                  {errors["estimate"] && (
                    <FormMessage>{errors["estimate"].message}</FormMessage>
                  )}
                  <Separator
                    orientation="horizontal"
                    className="mt-2 bg-primary/30"
                  />
                </li>
              )}
            />
            <FormField
              name="automated"
              render={({ field }) => (
                <li className="mb-2 mr-6">
                  <div className="flex items-center gap-1">
                    <label htmlFor="automated" className="font-bold">
                      {t("repository.fields.automated")}
                    </label>
                    <FormControl>
                      <Switch
                        id="automated"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label={t("repository.testCase.toggleAutomated")}
                        disabled={
                          isSubmitting ||
                          (isEditMode && isAutomatedCaseSource(testcase?.source))
                        }
                      />
                    </FormControl>
                    {errors["automated"] && (
                      <FormMessage>{errors["automated"].message}</FormMessage>
                    )}
                  </div>
                  <Separator
                    orientation="horizontal"
                    className="mt-2 bg-primary/30"
                  />
                </li>
              )}
            />
            <FormField
              name="tags"
              render={({ field }) => (
                <li className="mt-2">
                  <div id="tags-label" className="font-bold mb-1">
                    {t("common.fields.tags")}
                  </div>
                  <div aria-labelledby="tags-label">
                    <ManageTags
                      selectedTags={field.value}
                      setSelectedTags={field.onChange}
                      canCreateTags={canCreateTags}
                    />
                  </div>
                  {errors["tags"] && (
                    <FormMessage>{errors["tags"].message}</FormMessage>
                  )}
                  <Separator
                    orientation="horizontal"
                    className="bg-primary/30"
                  />
                </li>
              )}
            />
            <FormField
              name="issues"
              render={({ field }) => (
                <li className="mt-2">
                  <div id="issues-label" className="font-bold mb-1">
                    {t("common.fields.issues")}
                  </div>
                  <div aria-labelledby="issues-label">
                    <UnifiedIssueManager
                      projectId={testcase.projectId}
                      linkedIssueIds={field.value || []}
                      setLinkedIssueIds={field.onChange}
                      entityType="testCase"
                      entityId={testcase.id}
                    />
                    {!projectIntegration && (
                      <div className="text-sm text-muted-foreground">
                        {t("common.errors.issueTrackerNotConfigured")}
                      </div>
                    )}
                  </div>
                  {errors["issues"] && (
                    <FormMessage>{errors["issues"].message}</FormMessage>
                  )}
                  <Separator
                    orientation="horizontal"
                    className="bg-primary/30"
                  />
                </li>
              )}
            />
            <li className="mt-2">
              <div id="attachments-label" className="font-bold mt-2">
                {t("common.fields.attachments")}
              </div>
              <div aria-labelledby="attachments-label">
                <UploadAttachments
                  onFileSelect={(files: File[]) => {
                    setSelectedFiles(files);
                  }}
                />
              </div>
              {testcase.attachments.length > 0 && (
                <div className="mt-4">
                  <AttachmentsDisplay
                    attachments={testcase.attachments}
                    onSelect={handleSelect}
                    preventEditing={!canAddEdit}
                    deferredMode={true}
                    onPendingChanges={onAttachmentPendingChanges}
                  />
                </div>
              )}
            </li>
          </>
        ) : (
          <>
            {testcase.estimate != null && testcase.estimate > 0 && (
              <li className="mb-2 mr-6">
                <div id="estimate-display" className="font-bold">
                  {t("repository.fields.estimate")}
                </div>
                <div aria-labelledby="estimate-display">
                  <DurationDisplay seconds={testcase.estimate} />
                </div>
                <Separator
                  orientation="horizontal"
                  className="mt-2 bg-primary/30"
                />
              </li>
            )}

            {testcase.forecastManual != null && testcase.forecastManual > 0 && (
              <li className="mb-2 mr-6">
                <div id="forecast-display" className="font-bold">
                  {t("common.fields.forecast")}
                </div>
                <div aria-labelledby="forecast-display">
                  <ForecastDisplay seconds={testcase.forecastManual} />
                </div>
                {testcase.forecastAutomated != null &&
                  testcase.forecastAutomated > 0 && (
                    <>
                      <div aria-labelledby="forecast-display">
                        <ForecastDisplay
                          seconds={testcase.forecastAutomated}
                          round={false}
                          type="automated"
                        />
                      </div>
                      <Separator
                        orientation="horizontal"
                        className="mt-2 bg-primary/30"
                      />
                    </>
                  )}
              </li>
            )}

            <li className="mb-2 mr-6 flex items-center gap-1">
              <div id="automated-display" className="font-bold">
                {t("repository.fields.automated")}
              </div>
              <div aria-labelledby="automated-display">
                <Switch
                  disabled
                  checked={testcase.automated}
                  aria-label={t("repository.testCase.automatedStatus", {
                    status: testcase.automated
                      ? t("common.status.enabled")
                      : t("common.status.disabled"),
                  })}
                />
              </div>
            </li>
            <Separator
              orientation="horizontal"
              className="mt-2 bg-primary/30"
            />
            {testcase.tags && testcase.tags.length > 0 && (
              <li className="mt-2">
                <div id="tags-display" className="font-bold mb-1">
                  {t("common.fields.tags")}
                </div>
                <div
                  className="flex flex-wrap w-fit mb-4"
                  aria-labelledby="tags-display"
                  role="list"
                >
                  {testcase.tags.map((tag: Tags) => (
                    <div
                      key={tag.id}
                      className={
                        isSubmitting ? "opacity-50 cursor-not-allowed" : ""
                      }
                      role="listitem"
                    >
                      <TagsDisplay
                        id={tag.id}
                        name={tag.name}
                        link={`/projects/tags/${testcase.projectId}/${tag.id}`}
                        size="large"
                      />
                    </div>
                  ))}
                </div>
                <Separator
                  orientation="horizontal"
                  className="mt-2 bg-primary/30"
                />
              </li>
            )}
            {testcase.issues && testcase.issues.length > 0 && (
              <li className="mt-2">
                <div id="issues-display" className="font-bold mb-1">
                  {t("common.fields.issues")}
                </div>
                <div
                  className="flex flex-col gap-2 w-full max-w-full mb-4"
                  aria-labelledby="issues-display"
                  role="list"
                >
                  {testcase.issues.map((issue: any) => (
                    <div
                      key={issue.id}
                      className={
                        isSubmitting ? "opacity-50 cursor-not-allowed w-full" : "w-full"
                      }
                      role="listitem"
                    >
                      <IssuesDisplay
                        id={issue.id}
                        name={issue.name}
                        externalId={issue.externalId}
                        externalUrl={issue.externalUrl}
                        title={issue.title}
                        status={issue.externalStatus}
                        projectIds={[testcase.projectId]}
                        size="large"
                        data={issue.data}
                        integrationProvider={
                          issue.integration?.provider ||
                          (issue.externalUrl ? "JIRA" : undefined)
                        }
                        integrationId={
                          issue.integrationId || issue.integration?.id
                        }
                        lastSyncedAt={issue.lastSyncedAt}
                        issueTypeName={issue.issueTypeName}
                        issueTypeIconUrl={issue.issueTypeIconUrl}
                      />
                    </div>
                  ))}
                </div>
                <Separator
                  orientation="horizontal"
                  className="mt-2 bg-primary/30"
                />
              </li>
            )}
            {testcase.attachments.length > 0 && (
              <li className="mt-2">
                <div id="attachments-display" className="font-bold mt-2">
                  {t("common.fields.attachments")}
                </div>
                <div aria-labelledby="attachments-display">
                  <AttachmentsDisplay
                    attachments={testcase.attachments}
                    onSelect={handleSelect}
                    preventEditing={!canAddEdit}
                  />
                  {selectedAttachmentIndex !== null && (
                    <AttachmentsCarousel
                      attachments={selectedAttachments}
                      initialIndex={selectedAttachmentIndex}
                      onClose={handleClose}
                      canEdit={canAddEdit}
                    />
                  )}
                </div>
              </li>
            )}
            {!isEditMode &&
              !isSubmitting &&
              (testcase.creator || testcase.createdAt) && (
                <li className="mt-3">
                  <div className="space-y-2 w-full">
                    {testcase.creator && (
                      <div className="flex items-center gap-2 min-w-0 w-full">
                        <UserDisplay
                          userId={testcase.creator.id}
                          userName={testcase.creator.name}
                          userImage={testcase.creator.image}
                          prefix={t("common.fields.createdBy")}
                          size="large"
                        />
                      </div>
                    )}
                    {testcase.createdAt && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 w-full">
                        <span className="shrink-0">
                          {t("common.fields.createdAt")}:
                        </span>
                        <span className="truncate">
                          <DateFormatter
                            date={testcase.createdAt}
                            formatString={
                              (session?.user.preferences?.dateFormat ||
                                "MM-dd-yyyy") +
                              " " +
                              (session?.user.preferences?.timeFormat || "HH:mm")
                            }
                            timezone={session?.user.preferences?.timezone}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                  <Separator
                    orientation="horizontal"
                    className="mt-4 bg-primary/30"
                  />
                </li>
              )}
            {!isEditMode && !isSubmitting && session?.user && (
              <li id="comments" className="mt-2 mr-1">
                <CommentsSection
                  projectId={testcase.projectId}
                  entityType="repositoryCase"
                  entityId={testcase.id}
                  currentUserId={session.user.id}
                  isAdmin={session.user.access === "ADMIN"}
                />
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
};

export default TestCaseFormControls;
