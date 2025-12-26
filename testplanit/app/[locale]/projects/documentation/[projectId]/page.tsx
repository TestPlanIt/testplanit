"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { ApplicationArea } from "@prisma/client";

import { useRouter } from "~/lib/navigation";
import {
  useFindFirstProjects,
  useUpdateProjects,
  useFindFirstAppConfig,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

import { useSession } from "next-auth/react";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SquarePen, Save, CircleSlash2 } from "lucide-react";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Loading } from "@/components/Loading";
import { useTranslations } from "next-intl";

type JsonArray = any[];
type JsonObject = any;

interface ProjectDocumentationProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default function ProjectDocumentation({
  params,
  searchParams,
}: ProjectDocumentationProps) {
  const { projectId } = use(params);
  const resolvedSearchParams = use(searchParams);

  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [docs, setDocs] = useState<
    | string
    | number
    | boolean
    | JsonObject
    | JsonArray
    | { type: string; content: any }
    | null
  >(null);
  const {
    data: project,
    refetch: refetchProject,
    isLoading: isProjectLoading,
  } = useFindFirstProjects(
    {
      where: {
        AND: [{ isDeleted: false }, { id: parseInt(projectId) }],
      },
    },
    { enabled: sessionStatus !== "loading" } // Only query when session is loaded
  );

  // Use the custom hook to fetch permissions
  const {
    permissions,
    isLoading: isLoadingPermissions,
    error: permissionsError,
  } = useProjectPermissions(projectId, ApplicationArea.Documentation);

  // Fetch default content from AppConfig
  const { data: appConfig } = useFindFirstAppConfig({
    where: {
      key: "project_docs_default",
    },
  });
  const { mutateAsync: updateProject } = useUpdateProjects();

  // Use a ref to track the original docs from the database
  const originalDocsRef = useRef<object | null>(null);

  const t = useTranslations();

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      await refetchProject();
      setIsLoading(false);
    };

    fetchData();
  }, [refetchProject]);

  useEffect(() => {
    // Don't make routing decisions until session is loaded
    if (sessionStatus === "loading") {
      return;
    }

    // Only redirect to 404 if we're sure the user doesn't have access
    // (session is loaded, project loading is complete, and project is null)
    if (
      !isProjectLoading &&
      project === null &&
      sessionStatus === "authenticated"
    ) {
      router.push("/404");
      return;
    }

    if (project && typeof project !== "string") {
      try {
        let parsedDocs = null;
        if (project.docs) {
          try {
            parsedDocs =
              typeof project.docs === "string"
                ? JSON.parse(project.docs)
                : project.docs;
          } catch (error) {
            // console.error("Failed to parse project.docs as JSON:", error);
          }
        }

        // Step 3: Set the docs state and the original docs ref
        setDocs(parsedDocs || appConfig?.value);
        originalDocsRef.current = parsedDocs || appConfig?.value;
      } catch (error) {
        // console.error("Failed to parse docs as JSON:", error);
        // Fallback to default content if parsing fails
        setDocs(appConfig?.value);
        originalDocsRef.current = appConfig?.value as object;
      }
    }
  }, [project, router, appConfig, isProjectLoading, sessionStatus]);

  const handleCancelEdit = async () => {
    // Reload the original docs from the database
    await refetchProject();
    setDocs(originalDocsRef.current);
    setIsEditing(false);
  };

  // Memoize the onUpdate callback to prevent unnecessary re-renders
  const handleUpdate = useCallback((newContent: object) => {
    setDocs(newContent);
  }, []);

  const handleSaveDocs = async () => {
    try {
      await updateProject({
        where: { id: parseInt(projectId) },
        data: { docs: JSON.stringify(docs) },
      });

      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save documentation:", error);
    }
  };

  // Determine overall loading state (consider permissions loading and session loading)
  const isOverallLoading =
    sessionStatus === "loading" ||
    isLoading ||
    isLoadingPermissions ||
    isProjectLoading ||
    docs === null;

  // Optional: Add error handling for permissions fetch
  if (permissionsError) {
    console.error("Error loading permissions:", permissionsError);
    // Optionally render an error message to the user
    // return <div>Error loading permissions. Please try again later.</div>;
  }

  if (isOverallLoading) {
    // Use combined loading state
    return <Loading />;
  }

  // Use fetched permissions from the hook to determine edit capability
  // Ensure permissions object exists before accessing canAddEdit
  const canEdit = permissions?.canAddEdit ?? false;

  return (
    <div className="h-full flex flex-col">
      <Card className="flex w-full min-w-[400px]">
        <div className="flex-1 w-3/4">
          <CardHeader>
            <CardTitle>
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <div>
                  <CardTitle>{t("common.fields.documentation")}</CardTitle>
                </div>
                {canEdit && !isEditing && (
                  <Button onClick={() => setIsEditing(!isEditing)}>
                    <div className="flex items-center">
                      <div>
                        <SquarePen className="h-5 w-5 mr-2" />
                      </div>
                      <div>
                        {t("common.actions.edit")}{" "}
                        {t("common.fields.documentation")}
                      </div>
                    </div>
                  </Button>
                )}
              </div>
            </CardTitle>
            <CardDescription className="uppercase flex w-full items-top items-center gap-2">
              <span className="flex items-center gap-2 uppercase shrink-0">
                <ProjectIcon iconUrl={project?.iconUrl} />
                {project?.name}
              </span>
            </CardDescription>
          </CardHeader>
        </div>
      </Card>
      <div className="flex-1 h-full ring-2 ring-muted rounded-lg mt-4 bg-primary-foreground overflow-hidden p-4">
        <TipTapEditor
          key={isEditing ? "editing" : "readonly"}
          content={docs}
          onUpdate={isEditing ? handleUpdate : undefined}
          readOnly={!isEditing}
          className="h-auto"
          placeholder={t("common.placeholders.docs")}
          projectId={projectId}
        />
        {isEditing && (
          <div className="flex gap-2 p-4">
            <Button variant="default" onClick={handleSaveDocs}>
              <div className="flex items-center">
                <Save className="w-5 h-5 mr-2" />
                <div>{t("common.actions.save")}</div>
              </div>
            </Button>
            <Button variant="outline" onClick={handleCancelEdit}>
              <div className="flex items-center">
                <CircleSlash2 className="w-5 h-5 mr-2" />
                <div>{t("common.cancel")}</div>
              </div>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
