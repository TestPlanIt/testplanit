"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  useFindFirstRepositoryCaseVersions,
  useFindManyRepositoryCaseVersions,
  useFindFirstWorkflows,
  useFindManyTemplates,
  useFindManyIssue,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import {
  RepositoryCaseVersions,
  Attachments,
  Steps,
  Prisma,
} from "@prisma/client";
import { TemplateNameDisplay } from "@/components/TemplateNameDisplay";
import { Loading } from "@/components/Loading";
import { emptyEditorContent } from "~/app/constants";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { ChevronLeft, LinkIcon, Minus, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatSeconds } from "@/components/DurationDisplay";
import { Switch } from "@/components/ui/switch";
import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Separator } from "@/components/ui/separator";
import { StepsDisplay } from "../StepsDisplay";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { IconName } from "~/types/globals";
import { Link } from "~/lib/navigation";
import FieldValueRenderer from "../FieldValueRenderer";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { determineTagDifferences } from "~/utils/determineTagDifferences";
import { determineIssueDifferences } from "~/utils/determineIssueDifferences";
import { VersionNavigation } from "@/components/VersionNavigation";
import { useTranslations, useLocale } from "next-intl";

interface VersionPageIssue {
  id: number;
  name: string;
  externalId?: string | null;
}

interface CaseVersionExtended extends RepositoryCaseVersions {
  caseFieldVersionValues: {
    id: number;
    versionId: number;
    field: string;
    value: string;
  }[];
  tags: string[];
  issues: any;
  // steps here is likely Prisma.JsonValue based on RepositoryCaseVersions
}

export default function TestCaseVersions() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { projectId, caseId, version } = useParams();
  const t = useTranslations();
  const panelRightRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);
  const panelLeftRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);
  const [panelRightWidth, setPanelRightWidth] = useState<number>(30);
  const [isCollapsedRight, setIsCollapsedRight] = useState<boolean>(false);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const locale = useLocale();

  // Fetch current issue data to display issues properly with all metadata
  const { data: allIssues } = useFindManyIssue({
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      title: true,
      externalId: true,
      externalUrl: true,
      externalStatus: true,
      externalKey: true,
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
  });

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const { data, isLoading, refetch } = useFindFirstRepositoryCaseVersions({
    where: {
      repositoryCaseId: Number(caseId),
      version: Number(version),
      isDeleted: false,
    },
    include: {
      caseFieldVersionValues: true,
      repositoryCase: {
        select: {
          source: true,
        },
      },
    },
  });

  const { data: versions } = useFindManyRepositoryCaseVersions({
    where: { repositoryCaseId: Number(caseId) },
    orderBy: { version: "desc" },
  });

  const currentVersionIndex = versions?.findIndex(
    (v) => v.version === Number(version)
  );

  const previousVersionNumber =
    currentVersionIndex !== undefined &&
    currentVersionIndex < (versions?.length ?? 0) - 1
      ? (versions?.[currentVersionIndex + 1]?.version ?? null)
      : null;

  const { data: previousData } = useFindFirstRepositoryCaseVersions({
    where: {
      repositoryCaseId: Number(caseId),
      version: previousVersionNumber || -1,
      isDeleted: false,
    },
    include: {
      caseFieldVersionValues: true,
      repositoryCase: {
        select: {
          source: true,
        },
      },
    },
  });

  const testcase = data
    ? {
        ...(data as CaseVersionExtended),
        source: (data as any).repositoryCase?.source,
      }
    : undefined;
  const previousTestcase = previousData
    ? {
        ...(previousData as CaseVersionExtended),
        source: (previousData as any).repositoryCase?.source,
      }
    : undefined;

  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      caseFields: {
        include: {
          caseField: {
            include: {
              fieldOptions: {
                include: {
                  fieldOption: { include: { icon: true, iconColor: true } },
                },
                orderBy: { fieldOption: { order: "asc" } },
              },
              type: true,
            },
          },
        },
        orderBy: {
          order: "asc",
        },
      },
    },
    orderBy: {
      templateName: "asc",
    },
  });

  const { data: workflowState } = useFindFirstWorkflows({
    where: { id: testcase?.stateId },
    include: { icon: true, color: true },
  });

  const { data: previousWorkflowState } = useFindFirstWorkflows({
    where: { id: previousTestcase?.stateId ?? 0 },
    include: { icon: true, color: true },
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const toggleCollapseRight = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const toggleCollapseLeft = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const viewVersion = (versionNum: string) => {
    router.push(`/projects/repository/${projectId}/${caseId}/${versionNum}`);
  };

  const goToPreviousVersion = () => {
    if (currentVersionIndex !== undefined && currentVersionIndex > 0) {
      const prevIndex = currentVersionIndex - 1;
      viewVersion(versions![prevIndex].version.toString());
    }
  };

  const goToNextVersion = () => {
    if (
      currentVersionIndex !== undefined &&
      versions !== undefined &&
      currentVersionIndex < versions.length - 1
    ) {
      const nextIndex = currentVersionIndex + 1;
      viewVersion(versions[nextIndex].version.toString());
    }
  };

  const handleResize = async (size: number) => {
    setPanelRightWidth(size);
  };

  if (status === "loading" || isLoading) return <Loading />;

  // Only redirect if session is authenticated and data is not found
  // This prevents race conditions on refresh
  if (status === "authenticated" && !data) {
    router.push(`/projects/repository/${projectId}/${caseId}`);
    return (
      <div className="text-muted-foreground text-center p-4">
        <div>{t("repository.version.notFound")}</div>
      </div>
    );
  }

  // If data is still loading or not ready, return null
  if (!data) {
    return null;
  }

  if (!testcase) return <Loading />;

  const transformSteps = (stepsData: Prisma.JsonValue | undefined): Steps[] => {
    if (!stepsData) return [];
    try {
      const parsedSteps =
        typeof stepsData === "string" ? JSON.parse(stepsData) : stepsData;
      if (Array.isArray(parsedSteps)) {
        return parsedSteps.map((step: any, index: number) => ({
          id: step.id || index,
          step: step.step as Prisma.JsonValue,
          expectedResult: step.expectedResult as Prisma.JsonValue,
          order: step.order !== undefined ? step.order : index,
          testCaseId: testcase.id,
          isDeleted: step.isDeleted !== undefined ? step.isDeleted : false,
          sharedStepGroupId:
            step.sharedStepGroupId !== undefined
              ? step.sharedStepGroupId
              : null,
          repositoryCaseStepBlockId:
            step.repositoryCaseStepBlockId !== undefined
              ? step.repositoryCaseStepBlockId
              : null,
        }));
      }
      console.warn(
        "Steps data is not in the expected array format:",
        parsedSteps
      );
      return [];
    } catch (error) {
      console.error("Error parsing steps data:", error);
      return [];
    }
  };

  const transformedSteps: Steps[] = transformSteps(testcase.steps);
  const transformedPreviousSteps: Steps[] = transformSteps(
    previousTestcase?.steps
  );

  const deepEqual = (a: any, b: any) => {
    if (a === b) return true;

    if (typeof a !== typeof b) return false;

    if (a && b && typeof a === "object") {
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
      } else if (!Array.isArray(a) && !Array.isArray(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
          if (!deepEqual(a[key], b[key])) return false;
        }
        return true;
      }
    }

    return false;
  };

  const diffResults: { [key: string]: boolean } = {};

  const hasDifference = (key: string, fieldValue: any, previousValue: any) => {
    const isDifferent = !deepEqual(fieldValue, previousValue);
    diffResults[key] = isDifferent;
    return isDifferent;
  };

  const renderFieldValue = (
    key: string,
    fieldValue: React.ReactNode,
    previousFieldValue: React.ReactNode
  ) => {
    if (diffResults[key]) {
      return (
        <div>
          {previousFieldValue !== undefined && previousFieldValue !== null && (
            <div className="relative p-1 rounded">
              <div className="absolute inset-0 bg-red-500/20 rounded pointer-events-none" />
              <span className="relative text-red-600 dark:text-red-400 flex space-x-1 items-center">
                <div>
                  <Minus className="w-4 h-4" />
                </div>
                {previousFieldValue}
              </span>
            </div>
          )}
          <div className="relative p-1 rounded">
            <div className="absolute inset-0 bg-green-500/20 rounded pointer-events-none" />
            <span className="relative text-green-600 dark:text-green-400 flex space-x-1 items-center">
              <div>
                <Plus className="w-4 h-4" />
              </div>
              {fieldValue}
            </span>
          </div>
        </div>
      );
    } else {
      return <div>{fieldValue}</div>;
    }
  };

  const parseIssues = (issuesData: any): VersionPageIssue[] => {
    if (!issuesData) return [];
    try {
      const parsed =
        typeof issuesData === "string" ? JSON.parse(issuesData) : issuesData;
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Error parsing issues data:", error);
      return [];
    }
  };

  const currentIssues = parseIssues(testcase?.issues);
  const previousIssues = parseIssues(previousTestcase?.issues);

  const { addedIssues, removedIssues, commonIssues } =
    determineIssueDifferences(currentIssues, previousIssues);

  if (testcase && previousTestcase) {
    hasDifference("name", testcase.name, previousTestcase.name);
    hasDifference("workflowState", testcase.stateId, previousTestcase.stateId);
    hasDifference(
      "templateName",
      testcase.templateName,
      previousTestcase.templateName
    );
    hasDifference("estimate", testcase.estimate, previousTestcase.estimate);
    hasDifference("automated", testcase.automated, previousTestcase.automated);

    testcase.caseFieldVersionValues.forEach((field) => {
      const previousFieldValue = previousTestcase.caseFieldVersionValues.find(
        (prevField) => prevField.field === field.field
      )?.value;
      hasDifference(`field-${field.field}`, field.value, previousFieldValue);
    });
  }

  const { addedTags, removedTags, tCommonTags } = determineTagDifferences(
    testcase?.tags || [],
    previousTestcase?.tags || []
  );

  const renderTag = (tag: string, type: "added" | "removed" | "common") => {
    let prefix: React.ReactNode = "";
    let bgColor = "";
    let paddingClass = "";

    if (testcase.version === 1 && type === "added") {
      type = "common";
    }

    switch (type) {
      case "added":
        prefix = <Plus className="w-4 h-4" />;
        bgColor = "relative text-green-600 dark:text-green-400";
        paddingClass = "px-2 py-2";
        break;
      case "removed":
        prefix = <Minus className="w-4 h-4" />;
        bgColor = "relative text-red-600 dark:text-red-400";
        paddingClass = "px-2 py-2";
        break;
      case "common":
        bgColor = "";
        paddingClass = "";
        break;
    }

    return (
      <div
        className={`flex font-extrabold items-center m-1 rounded ${bgColor} ${paddingClass}`}
        key={tag}
      >
        {type !== "common" && (
          <div className={`absolute inset-0 ${type === "added" ? "bg-green-500/20" : "bg-red-500/20"} rounded pointer-events-none`} />
        )}
        {prefix && <span className="relative mr-1">{prefix}</span>}
        <div className="relative">
          <TagsDisplay id={tag} name={tag} size="large" />
        </div>
      </div>
    );
  };

  const renderIssue = (
    issue: VersionPageIssue,
    type: "added" | "removed" | "common"
  ) => {
    let prefix: React.ReactNode = "";
    let bgColor = "";
    let paddingClass = "";

    if (testcase.version === 1 && (type === "added" || type === "removed")) {
      type = "common";
    }

    switch (type) {
      case "added":
        prefix = <Plus className="w-4 h-4" />;
        bgColor = "relative text-green-600 dark:text-green-400";
        paddingClass = "px-2 py-2";
        break;
      case "removed":
        prefix = <Minus className="w-4 h-4" />;
        bgColor = "relative text-red-600 dark:text-red-400";
        paddingClass = "px-2 py-2";
        break;
      case "common":
        bgColor = "";
        paddingClass = "";
        break;
    }

    // Find current issue data to get all metadata
    const currentIssueData = allIssues?.find(
      (currentIssue) => currentIssue.id === issue.id
    );

    return (
      <div
        className={`flex font-extrabold items-center m-1 rounded ${bgColor} ${paddingClass}`}
        key={issue.id}
      >
        {type !== "common" && (
          <div className={`absolute inset-0 ${type === "added" ? "bg-green-500/20" : "bg-red-500/20"} rounded pointer-events-none`} />
        )}
        {prefix && <span className="relative mr-1">{prefix}</span>}
        <div className="relative">
          <IssuesDisplay
          id={issue.id}
          name={issue.name}
          externalId={issue.externalId || currentIssueData?.externalId}
          externalUrl={currentIssueData?.externalUrl}
          title={currentIssueData?.title}
          status={currentIssueData?.externalStatus}
          size="large"
          projectIds={[testcase.projectId]}
          data={currentIssueData?.data}
          integrationProvider={currentIssueData?.integration?.provider}
          integrationId={currentIssueData?.integrationId || undefined}
          lastSyncedAt={currentIssueData?.lastSyncedAt}
          issueTypeName={currentIssueData?.issueTypeName}
          issueTypeIconUrl={currentIssueData?.issueTypeIconUrl}
        />
        </div>
      </div>
    );
  };

  return (
    <Card>
      <div className="bg-linear-to-b from-primary/0 to-primary/10  rounded-xl">
        <CardHeader>
          <CardTitle>
            <div className="flex items-start justify-between text-primary text-xl md:text-2xl max-w-full">
              <div className="flex items-center space-x-2 w-fit">
                {renderFieldValue(
                  "name",
                  <CaseDisplay
                    id={testcase.id}
                    name={testcase.name}
                    size="large"
                    source={testcase.source}
                  />,
                  previousTestcase ? (
                    <CaseDisplay
                      id={previousTestcase.id}
                      name={previousTestcase.name}
                      size="large"
                      source={previousTestcase.source}
                    />
                  ) : null
                )}
              </div>
              <div className="flex items-center space-x-2 w-fit">
                {versions?.length && versions.length > 1 && (
                  <>
                    <Select
                      value={currentVersionIndex !== undefined && currentVersionIndex >= 0 ? currentVersionIndex.toString() : "0"}
                      onValueChange={(indexStr) => {
                        const idx = parseInt(indexStr, 10);
                        if (versions && idx >= 0 && idx < versions.length) {
                          viewVersion(versions[idx].version.toString());
                        }
                      }}
                    >
                      <SelectTrigger className="w-fit">
                        <SelectValue placeholder="Select Version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions?.map((v, index) => (
                          <SelectItem
                            key={`version-select-${index}`}
                            value={index.toString()}
                          >
                            <div className="flex items-center space-x-1 whitespace-nowrap">
                              <Badge className="text-primary-foreground text-xs">
                                {t("common.version.prefix")}
                                {v.version.toString()}{" "}
                              </Badge>
                              <div className="text-xs flex">
                                <DateFormatter
                                  date={v.createdAt}
                                  formatString={
                                    session?.user.preferences?.dateFormat +
                                    " " +
                                    session?.user.preferences?.timeFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <VersionNavigation
                      versions={versions}
                      currentVersion={version?.toString() || ""}
                      currentVersionIndex={currentVersionIndex}
                      onPrevVersion={goToPreviousVersion}
                      onNextVersion={goToNextVersion}
                      backHref={`/projects/repository/${projectId}/${caseId}`}
                      backTitle="Back to Test Case"
                    />
                  </>
                )}
              </div>
            </div>
          </CardTitle>
          <CardDescription className="flex items-center justify-between">
            {workflowState &&
            previousWorkflowState &&
            testcase &&
            previousTestcase
              ? renderFieldValue(
                  "workflowState",
                  <WorkflowStateDisplay
                    state={{
                      name: workflowState.name,
                      icon: {
                        name: workflowState.icon.name as IconName,
                      },
                      color: workflowState.color,
                    }}
                  />,
                  <WorkflowStateDisplay
                    state={{
                      name: previousTestcase?.stateName ?? "",
                      icon: {
                        name: previousWorkflowState?.icon?.name as IconName,
                      },
                      color: previousWorkflowState?.color,
                    }}
                  />
                )
              : workflowState &&
                testcase && (
                  <WorkflowStateDisplay
                    state={{
                      name: workflowState.name,
                      icon: {
                        name: workflowState.icon.name as IconName,
                      },
                      color: workflowState.color,
                    }}
                  />
                )}
            {testcase && previousTestcase
              ? renderFieldValue(
                  "templateName",
                  <TemplateNameDisplay name={testcase.templateName} />,
                  <TemplateNameDisplay name={previousTestcase.templateName} />
                )
              : testcase && (
                  <TemplateNameDisplay name={testcase.templateName} />
                )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="case-version-panels"
          >
            <ResizablePanel
              order={1}
              ref={panelLeftRef}
              className={`p-0 m-0 min-w-6 ${
                isTransitioning ? "transition-all duration-300 ease-in-out" : ""
              }`}
              collapsedSize={0}
              minSize={0}
              collapsible
              onCollapse={() => setIsCollapsedLeft(true)}
              onExpand={() => setIsCollapsedLeft(false)}
            >
              <div
                className="mb-4"
                role="region"
                aria-label={t("repository.version.detailsRegion")}
              >
                <ul className="list-none" role="list">
                  {(
                    templates?.find(
                      (template) => template.id === testcase.templateId
                    )?.caseFields || []
                  ).map((field) => {
                    const fieldValue = testcase.caseFieldVersionValues.find(
                      (value) => value.field === field.caseField.displayName
                    )?.value;
                    const previousFieldValue =
                      previousTestcase?.caseFieldVersionValues.find(
                        (value) => value.field === field.caseField.displayName
                      )?.value;
                    if (
                      (!fieldValue ||
                        JSON.stringify(fieldValue) ===
                          JSON.stringify(emptyEditorContent)) &&
                      (!previousFieldValue ||
                        JSON.stringify(previousFieldValue) ===
                          JSON.stringify(emptyEditorContent))
                    ) {
                      return null;
                    }

                    return (
                      <li key={field.caseField.id} className="mb-2 mr-6">
                        {field.caseField.type.type !== "Steps" && (
                          <div className="font-bold">
                            {field.caseField.displayName}
                          </div>
                        )}
                        {previousTestcase && previousFieldValue ? (
                          <FieldValueRenderer
                            fieldValue={fieldValue}
                            fieldType={field.caseField.type.type}
                            previousFieldValue={previousFieldValue}
                            caseId={caseId?.toString() || ""}
                            template={{
                              caseFields:
                                templates?.find(
                                  (template) =>
                                    template.id === testcase.templateId
                                )?.caseFields || [],
                            }}
                            fieldId={field.caseField.id}
                            session={session}
                            isEditMode={false}
                            isSubmitting={false}
                            control={null}
                            errors={null}
                          />
                        ) : (
                          <FieldValueRenderer
                            fieldValue={fieldValue}
                            fieldType={field.caseField.type.type}
                            caseId={caseId?.toString() || ""}
                            template={{
                              caseFields:
                                templates?.find(
                                  (template) =>
                                    template.id === testcase.templateId
                                )?.caseFields || [],
                            }}
                            fieldId={field.caseField.id}
                            session={session}
                            isEditMode={false}
                            isSubmitting={false}
                            control={null}
                            errors={null}
                          />
                        )}
                        {field.caseField.type.type !== "Steps" && (
                          <Separator
                            orientation="horizontal"
                            className="mt-2 bg-primary/30"
                          />
                        )}
                      </li>
                    );
                  })}
                  {testcase?.steps &&
                    (transformedSteps.length > 0 ||
                      transformedPreviousSteps.length > 0) && (
                      <li className="mb-2 mr-6">
                        {previousTestcase ? (
                          <StepsDisplay
                            steps={transformedSteps}
                            previousSteps={transformedPreviousSteps}
                          />
                        ) : (
                          <StepsDisplay steps={transformedSteps} />
                        )}
                        <Separator
                          orientation="horizontal"
                          className="mt-2 bg-primary/30"
                        />
                      </li>
                    )}
                </ul>
              </div>
            </ResizablePanel>
            <div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={toggleCollapseLeft}
                      variant="secondary"
                      size="sm"
                      className={`p-0 transform ${
                        isCollapsedLeft
                          ? "rounded-l-none rotate-180"
                          : "rounded-r-none"
                      }`}
                    >
                      <ChevronLeft />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div>
                      {isCollapsedLeft
                        ? t("common.actions.expandLeftPanel")
                        : t("common.actions.collapseLeftPanel")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <ResizableHandle withHandle className="w-1" />
            <div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={toggleCollapseRight}
                      variant="secondary"
                      size="sm"
                      className={`p-0 transform ${
                        isCollapsedRight
                          ? "rounded-l-none"
                          : "rounded-r-none rotate-180"
                      }`}
                    >
                      <ChevronLeft />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div>
                      {isCollapsedRight
                        ? t("common.actions.expandRightPanel")
                        : t("common.actions.collapseRightPanel")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <ResizablePanel
              order={2}
              ref={panelRightRef}
              defaultSize={panelRightWidth || 30}
              onResize={handleResize}
              collapsedSize={0}
              minSize={0}
              collapsible
              onCollapse={() => setIsCollapsedRight(true)}
              onExpand={() => setIsCollapsedRight(false)}
              className={`${isTransitioning ? "transition-all duration-300 ease-in-out" : ""} w-["${panelRightWidth}%"]`}
            >
              <div
                className={`${isTransitioning ? "transition-all duration-300 ease-in-out" : ""} w-["${panelRightWidth}%"]`}
                role="region"
                aria-label={t("repository.version.metadataRegion")}
              >
                <ul className="list-none ml-1" role="list">
                  {testcase.estimate !== null && (
                    <li className="mb-2 mr-6">
                      <div className="font-bold">
                        {t("common.fields.estimate")}
                      </div>
                      {testcase && previousTestcase
                        ? renderFieldValue(
                            "estimate",
                            formatSeconds(testcase.estimate, locale),
                            previousTestcase.estimate !== null
                              ? formatSeconds(previousTestcase.estimate, locale)
                              : null
                          )
                        : testcase.estimate !== null &&
                          formatSeconds(testcase.estimate, locale)}
                      <Separator
                        orientation="horizontal"
                        className="mt-2 bg-primary/30"
                      />
                    </li>
                  )}

                  <div className="font-bold">
                    {t("common.fields.automated")}
                  </div>
                  <li className="mb-2 mr-6">
                    {testcase && previousTestcase
                      ? renderFieldValue(
                          "automated",
                          <Switch disabled checked={testcase.automated} />,
                          <Switch
                            disabled
                            checked={previousTestcase.automated}
                          />
                        )
                      : testcase && (
                          <Switch disabled checked={testcase.automated} />
                        )}
                    <Separator
                      orientation="horizontal"
                      className="mt-2 bg-primary/30"
                    />
                  </li>
                  <li className="mt-2">
                    <div className="font-bold mb-1">
                      {t("common.fields.tags")}
                    </div>
                    <div className="flex flex-wrap w-fit mb-4">
                      {addedTags.map((tag) => renderTag(tag, "added"))}
                      {removedTags.map((tag) => renderTag(tag, "removed"))}
                      {tCommonTags.map((tag) => renderTag(tag, "common"))}
                    </div>
                    <Separator
                      orientation="horizontal"
                      className="mt-2 bg-primary/30"
                    />
                  </li>
                  <li className="mt-2">
                    <div className="font-bold mb-1">
                      {t("common.fields.issues")}
                    </div>
                    <div className="flex flex-wrap w-fit mb-4">
                      {addedIssues.map((issue) => renderIssue(issue, "added"))}
                      {removedIssues.map((issue) =>
                        renderIssue(issue, "removed")
                      )}
                      {commonIssues.map((issue) =>
                        renderIssue(issue, "common")
                      )}
                    </div>
                    <Separator
                      orientation="horizontal"
                      className="mt-2 bg-primary/30"
                    />
                  </li>
                  <li>
                    {testcase.attachments && (
                      <AttachmentsDisplay
                        attachments={
                          testcase.attachments as unknown as Attachments[]
                        }
                        preventEditing={true}
                        previousAttachments={
                          previousTestcase?.attachments as unknown as
                            | Attachments[]
                            | undefined
                        }
                        onSelect={handleSelect}
                      />
                    )}
                  </li>

                  <div className="font-bold mt-2">
                    {t("repository.version.versionCreated", {
                      version: version?.toString() || "",
                    })}
                  </div>
                  <li className="mb-2 mr-6">
                    <div className="flex space-x-1">
                      <div>
                        <DateFormatter
                          date={testcase.createdAt}
                          formatString={
                            session?.user.preferences?.dateFormat +
                            " " +
                            session?.user.preferences?.timeFormat
                          }
                          timezone={session?.user.preferences?.timezone}
                        />
                      </div>
                      <div>{t("common.by")}</div>
                      <UserNameCell userId={testcase.creatorId} />
                    </div>
                  </li>
                  <Separator
                    orientation="horizontal"
                    className="mt-2 bg-primary/30"
                  />
                  {versions?.length && versions.length > 1 && (
                    <>
                      <div className="font-bold mt-2">
                        <Link
                          href={`/projects/repository/${projectId}/${caseId}`}
                          className="group"
                          title={t("sessions.version.backToLatest")}
                        >
                          {t("repository.version.latestVersionUpdated", {
                            version: versions[0].version,
                          })}
                          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </Link>
                      </div>
                      <li className="mb-2 mr-6">
                        <div className="flex space-x-1">
                          <div>
                            <DateFormatter
                              date={versions[0].createdAt}
                              formatString={
                                session?.user.preferences?.dateFormat +
                                " " +
                                session?.user.preferences?.timeFormat
                              }
                              timezone={session?.user.preferences?.timezone}
                            />
                          </div>
                          <div>{t("common.by")}</div>
                          <UserNameCell userId={versions[0].creatorId} />
                        </div>
                      </li>
                      <Separator
                        orientation="horizontal"
                        className="mt-2 bg-primary/30"
                      />
                    </>
                  )}
                </ul>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </CardContent>
        <CardFooter className="text-xs">
          {t("repository.version.historyView")}
        </CardFooter>
      </div>
    </Card>
  );
}
