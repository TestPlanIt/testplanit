"use client";

import React, { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "~/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { useFindManyProjects } from "~/lib/hooks";
import { Projects } from "@prisma/client";
import { BoxesIcon } from "lucide-react";
import { ProjectIcon } from "../ProjectIcon";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";
import { Skeleton } from "@/components/ui/skeleton";

interface UserProjectsDisplayProps {
  userId: string;
  usePopover?: boolean;
}

export const UserProjectsDisplay: React.FC<UserProjectsDisplayProps> = ({
  userId,
  usePopover = true,
}) => {
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const accessible = await getUserAccessibleProjects(userId);
        setProjectIds(accessible.map((p) => p.projectId));
      } catch (error) {
        console.error("Error fetching accessible projects:", error);
        setProjectIds([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, [userId]);

  const { data: allProjects, isLoading: projectsLoading } = useFindManyProjects(
    {
      where: {
        AND: [
          {
            id: {
              in: projectIds.length > 0 ? projectIds : [-1], // Use -1 if no projects to avoid empty array issue
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
      orderBy: { name: "asc" },
    },
    {
      enabled: !isLoading && projectIds.length > 0,
    }
  );

  if (isLoading || projectsLoading) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!allProjects || allProjects.length === 0) {
    return;
  }

  const renderContent = () => (
    <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
      {allProjects.map((project: Projects) => (
        <Link key={project.id} href={`/projects/overview/${project.id}`}>
          <Badge className="border p-1 m-1 text-primary-foreground bg-primary rounded-xl items-center">
            <div className="flex items-center gap-1">
              <div className="max-w-5 max-h-5">
                <ProjectIcon iconUrl={project?.iconUrl} />
              </div>
              <div>{project?.name}</div>
            </div>
          </Badge>
        </Link>
      ))}
    </div>
  );

  if (usePopover) {
    return (
      <Popover>
        <PopoverTrigger>
          <Badge>
            <BoxesIcon className="w-4 h-4 mr-1" />
            {allProjects.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent>{renderContent()}</PopoverContent>
      </Popover>
    );
  } else {
    return <div>{renderContent()}</div>;
  }
};
