import React from "react";
import { ProjectIcon } from "@/components/ProjectIcon";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { DateFormatter } from "@/components/DateFormatter";
import { Projects } from "@prisma/client";
import { useTranslations } from "next-intl";

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
      <CardTitle>
        <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-3 pt-1.5">
          <div>
            <CardTitle>{t("projects.overview.title")}</CardTitle>
          </div>
        </div>
      </CardTitle>
      <CardDescription className="flex w-full items-start justify-between ">
        <span className="flex items-center gap-2 uppercase shrink-0">
          <ProjectIcon iconUrl={project.iconUrl} />
          {project.name}
        </span>
        <span className="block">
          <span className="block">
            {t("projects.status.id", { id: project.id })}
          </span>
          <span className="block">
            {project.isCompleted
              ? t("projects.status.completed")
              : t("projects.status.active")}
          </span>
          <span className="block">
            {t("projects.overview.createdOn")}{" "}
            {project.createdAt && (
              <DateFormatter
                date={project.createdAt}
                formatString={dateFormat}
              />
            )}
          </span>
          {project.completedAt && (
            <span className="block">
              {t("projects.overview.completedOn")}{" "}
              <DateFormatter
                date={project.completedAt}
                formatString={dateFormat}
              />
            </span>
          )}
        </span>
      </CardDescription>
    </div>
  );
};

export default ProjectHeader;
