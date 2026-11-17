"use client";

import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { AlertDescription } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ProjectDefaultRef {
  id: number;
  name: string;
  iconUrl: string | null;
}

/**
 * Of the projects that use a template as their default, the ones it is still
 * assigned to: disabling, deleting or unassigning it sends those to the
 * system default.
 */
export function projectsUsingAsDefault<P extends { id: number }>(
  projectDefaults: readonly P[] | null | undefined,
  assignedProjectIds: readonly number[]
): P[] {
  return (projectDefaults ?? []).filter((project) =>
    assignedProjectIds.includes(project.id)
  );
}

/** Lists the projects that would lose this template as their default. */
export function ProjectDefaultTemplateWarning({
  projects,
}: {
  projects: readonly ProjectDefaultRef[];
}) {
  const t = useTranslations("admin.templates");
  if (projects.length === 0) return null;
  return (
    <WarningAlert data-testid="template-project-default-warning">
      <TriangleAlert className="h-4 w-4" />
      <AlertDescription className="space-y-2">
        <p>{t("projectDefaultWarning", { count: projects.length })}</p>
        <ul className="space-y-1">
          {projects.map((project) => (
            <li key={project.id} className="min-w-0">
              <ProjectNameDisplay
                projectId={project.id}
                projectName={project.name}
                iconUrl={project.iconUrl}
                showLink
                fitContainer
              />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </WarningAlert>
  );
}
