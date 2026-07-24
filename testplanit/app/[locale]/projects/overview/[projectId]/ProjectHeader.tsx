import { ProjectIcon } from "@/components/ProjectIcon";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { ProjectInfoPopover } from "./ProjectInfoPopover";
import type { Projects } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import React from "react";

interface ProjectHeaderProps {
  project: Projects;
  dateFormat?: string;
}

const ProjectHeader: React.FC<ProjectHeaderProps> = ({
  project,
  dateFormat,
}) => {
  const t = useTranslations();

  return (
    <div>
      <SectionHeader className="flex items-center gap-2 pb-3 pt-1.5">
        <CardTitle>{t("projects.overview.title")}</CardTitle>
        <ProjectInfoPopover project={project} dateFormat={dateFormat} />
      </SectionHeader>
      <CardDescription>
        <span className="flex items-center gap-2 uppercase">
          <ProjectIcon iconUrl={project.iconUrl} />
          {project.name}
        </span>
      </CardDescription>
    </div>
  );
};

export default ProjectHeader;
