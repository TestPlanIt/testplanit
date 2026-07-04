"use client";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BoxesIcon } from "lucide-react";
import React from "react";
import {
  getUsersAccessibleProjects,
  type AccessibleProject,
} from "~/app/actions/getUserAccessibleProjects";
import { Link } from "~/lib/navigation";
import { ProjectIcon } from "../ProjectIcon";

interface UserProjectsDisplayProps {
  /**
   * Precomputed accessible projects, batched by the parent. When provided the
   * component renders directly with no fetching; `undefined` means the parent's
   * batch is still loading (a skeleton is shown).
   */
  projects?: AccessibleProject[];
  /**
   * Self-fetch mode for single-row surfaces (e.g. a user profile). Used only
   * when `projects` is not supplied — resolves this user's accessible projects
   * in one round-trip.
   */
  userId?: string;
  usePopover?: boolean;
}

export const UserProjectsDisplay: React.FC<UserProjectsDisplayProps> = ({
  projects: projectsProp,
  userId,
  usePopover = true,
}) => {
  const selfFetch = projectsProp === undefined && userId !== undefined;

  const { data: fetched, isLoading: fetchLoading } = useQuery({
    queryKey: ["user-accessible-projects", userId],
    queryFn: async () => {
      const map = await getUsersAccessibleProjects([userId!]);
      return map[userId!] ?? [];
    },
    enabled: selfFetch,
  });

  const projects = selfFetch ? fetched : projectsProp;
  const isLoading = selfFetch ? fetchLoading : projectsProp === undefined;

  if (isLoading) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!projects || projects.length === 0) {
    return null;
  }

  const renderContent = () => (
    <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
      {projects.map((project) => (
        <Link key={project.id} href={`/projects/overview/${project.id}`}>
          <Badge className="border p-1 m-1 text-primary-foreground bg-primary rounded-xl items-center">
            <div className="flex items-center gap-1">
              <div className="max-w-5 max-h-5">
                <ProjectIcon iconUrl={project.iconUrl} />
              </div>
              <div>{project.name}</div>
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
            {projects.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent>{renderContent()}</PopoverContent>
      </Popover>
    );
  }
  return <div>{renderContent()}</div>;
};
