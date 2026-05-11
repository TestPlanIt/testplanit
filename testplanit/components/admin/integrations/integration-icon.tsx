import { IntegrationProvider } from "@prisma/client";
import { Bug } from "lucide-react";
import { siGithub, siGitlab, siJira } from "simple-icons";
import { GiteaPlatformIcon } from "@/components/shared/gitea-family-icon";
import { cn } from "~/utils";

interface IntegrationIconProps {
  provider: IntegrationProvider;
  platform?: string | null;
  className?: string;
}

export function IntegrationIcon({ provider, platform, className }: IntegrationIconProps) {
  const baseClass = cn("flex items-center justify-center rounded", className);

  switch (provider) {
    case "JIRA":
      return (
        <div className={cn(baseClass, "bg-blue-500 text-white")}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d={siJira.path} />
          </svg>
        </div>
      );
    case "GITHUB":
      return (
        <div
          className={cn(baseClass, "bg-gray-900 text-white dark:bg-gray-700")}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d={siGithub.path} />
          </svg>
        </div>
      );
    case "AZURE_DEVOPS":
      return (
        <div className={cn(baseClass, "bg-blue-600 text-white")}>
          <svg viewBox="0 0 18 18" className="h-5 w-5" fill="currentColor">
            <path d="M17,4v9.74l-4,3.28-6.2-2.26V17L3.29,12.41l10.23.8V4.44Zm-3.41.49L7.85,1V3.29L2.58,4.84,1,6.87v4.61l2.26,1V6.57Z" />
          </svg>
        </div>
      );
    case "GITLAB":
      return (
        <div className={cn(baseClass, "bg-[#FC6D26] text-white")}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d={siGitlab.path} />
          </svg>
        </div>
      );
    case "GITEA":
      return (
        <div className={cn(baseClass, "bg-white dark:bg-gray-800 p-0.5")}>
          <GiteaPlatformIcon platform={platform} className="h-full w-full" />
        </div>
      );
    default:
      return (
        <div className={cn(baseClass, "bg-gray-500 text-white")}>
          <Bug className="h-5 w-5" />
        </div>
      );
  }
}
