import { useRouter, usePathname } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useFindManyProjects } from "~/lib/hooks";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

interface ProjectDropdownMenuProps {
  isCollapsed?: boolean;
}

export const ProjectDropdownMenu = ({
  isCollapsed,
}: ProjectDropdownMenuProps) => {
  const { data: session } = useSession();
  const router = useRouter();
  const { projectId } = useParams();
  const path = usePathname();
  const t = useTranslations();

  // ZenStack now handles all access control automatically based on the schema rules
  const { data: projects } = useFindManyProjects(
    {
      where: {
        isDeleted: false,
      },
      orderBy: [{ isCompleted: "asc" }, { name: "asc" }],
    },
    {
      enabled: !!session?.user,
    }
  );

  function navigateToProject(id: string) {
    // Always redirect to the Overview page when selecting a different project
    router.push("/projects/overview/" + id);
  }

  const handleProjectSelect = (projectId: string) => {
    navigateToProject(projectId);
  };

  if (!projects) return null;
  const currentProject = projects.find(
    (project) => project.id.toString() === projectId
  );

  return (
    <Select onValueChange={handleProjectSelect}>
      <SelectTrigger
        data-testid="project-dropdown-trigger"
        className={`${isCollapsed ? "w-[60px]" : "w-[60px] md:w-[175px]"} -ml-5 md:ml-0 ${currentProject?.isCompleted ? "bg-muted-foreground/20" : ""}`}
      >
        <div
          className={`${isCollapsed ? "w-[60px]" : "w-[60px] md:w-[175px]"}`}
        >
          <div className="text-left mr-4">
            <div className="flex items-center gap-1 min-w-5 min-h-5">
              <div className="max-w-5 max-h-5">
                <ProjectIcon
                  iconUrl={currentProject?.iconUrl}
                  height={20}
                  width={20}
                />
              </div>
              <div
                className={`truncate ${isCollapsed ? "hidden" : "hidden md:inline"}`}
              >
                {currentProject?.name ||
                  t("navigation.projects.dropdown.selectProject")}
              </div>
            </div>
          </div>
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {projects.map((project) => (
            <SelectItem
              key={project.id}
              value={project.id.toString()}
              aria-label={t(
                "navigation.projects.dropdown.selectProjectAriaLabel",
                {
                  name: project.name,
                }
              )}
              className={`${project.isCompleted ? "bg-muted-foreground/20" : ""}`}
            >
              <div className="flex items-center gap-1 min-w-5 min-h-5">
                <div className="max-w-5 max-h-5">
                  <ProjectIcon
                    iconUrl={project?.iconUrl}
                    height={20}
                    width={20}
                  />
                </div>
                <div className="truncate">{project?.name}</div>
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
