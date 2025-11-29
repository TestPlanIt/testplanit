import { cn } from "~/utils";
import { Bug } from "lucide-react";
import { IntegrationProvider } from "@prisma/client";
import * as icons from "simple-icons";

interface IntegrationIconProps {
  provider: IntegrationProvider;
  className?: string;
}

export function IntegrationIcon({ provider, className }: IntegrationIconProps) {
  const baseClass = cn("flex items-center justify-center rounded", className);

  switch (provider) {
    case "JIRA":
      return (
        <div className={cn(baseClass, "bg-blue-500 text-white")}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d={icons.siJira.path} />
          </svg>
        </div>
      );
    case "GITHUB":
      return (
        <div
          className={cn(baseClass, "bg-gray-900 text-white dark:bg-gray-700")}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d={icons.siGithub.path} />
          </svg>
        </div>
      );
    case "AZURE_DEVOPS":
      return (
        <div className={cn(baseClass, "bg-blue-600 text-white")}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M23.034 5.458L15.862 0v4.358l3.099 1.906v.522l-.031.017v1.89l-2.25 1.322v7.042l2.287 1.034v5.414l5.598-3.364c.554-.227.866-.779.869-1.37V6.799c-.02-.544-.358-1.026-.899-1.246l-.501-.095zm-6.359 5.965V7.045l-4.986-.786-2.089 4.818 7.075 3.948v-3.602zM11.593 4.227L.9 6.805c-.55.134-.913.646-.899 1.192v10.774c-.014.724.482 1.352 1.191 1.51l9.72 2.407 1.197-2.289v-5.322l2.033-1.322V4.273L11.61 1.845c-.554-.237-1.193-.059-1.547.43a1.51 1.51 0 00-.292.784c0 .29.082.567.222.802l-.4 1.366zm.01 12.22l.025 4.086-7.075 1.96v-2.07c0-.41-.224-.788-.584-.99l-.03-.017V8.742l7.664 7.705z" />
          </svg>
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
