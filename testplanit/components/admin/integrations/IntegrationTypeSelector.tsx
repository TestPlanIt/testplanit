"use client";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IntegrationProvider } from "@prisma/client";
import { Check, Link } from "lucide-react";
import { useTranslations } from "next-intl";
import { siGitea, siGithub, siGitlab, siJira } from "simple-icons";
import { cn } from "~/utils";

interface IntegrationTypeSelectorProps {
  selectedType: IntegrationProvider | null;
  onSelectType: (type: IntegrationProvider) => void;
}

const JiraIcon = () => (
  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
    <path d={siJira.path} />
  </svg>
);

const integrationTypes = [
  {
    type: IntegrationProvider.SIMPLE_URL,
    icon: Link,
    color: "text-purple-600",
  },
  {
    type: IntegrationProvider.JIRA,
    icon: JiraIcon,
    color: "text-blue-600",
  },
  {
    type: IntegrationProvider.GITHUB,
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
        <path d={siGithub.path} />
      </svg>
    ),
    color: "text-gray-800 dark:text-gray-200",
  },
  {
    type: IntegrationProvider.GITLAB,
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
        <path d={siGitlab.path} />
      </svg>
    ),
    color: "text-[#FC6D26]",
  },
  {
    type: IntegrationProvider.GITEA,
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
        <path d={siGitea.path} />
      </svg>
    ),
    color: "text-[#609926]",
  },
  {
    type: IntegrationProvider.AZURE_DEVOPS,
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
        <path d="M23.034 5.458L15.862 0v4.358l3.099 1.906v.522l-.031.017v1.89l-2.25 1.322v7.042l2.287 1.034v5.414l5.598-3.364c.554-.227.866-.779.869-1.37V6.799c-.02-.544-.358-1.026-.899-1.246l-.501-.095zm-6.359 5.965V7.045l-4.986-.786-2.089 4.818 7.075 3.948v-3.602zM11.593 4.227L.9 6.805c-.55.134-.913.646-.899 1.192v10.774c-.014.724.482 1.352 1.191 1.51l9.72 2.407 1.197-2.289v-5.322l2.033-1.322V4.273L11.61 1.845c-.554-.237-1.193-.059-1.547.43a1.51 1.51 0 00-.292.784c0 .29.082.567.222.802l-.4 1.366zm.01 12.22l.025 4.086-7.075 1.96v-2.07c0-.41-.224-.788-.584-.99l-.03-.017V8.742l7.664 7.705z" />
      </svg>
    ),
    color: "text-blue-700",
  },
];

export function IntegrationTypeSelector({
  selectedType,
  onSelectType,
}: IntegrationTypeSelectorProps) {
  const t = useTranslations("admin.integrations.add");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("selectType")}</h3>
        <p className="text-sm text-muted-foreground">{t("typeDescription")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrationTypes.map(({ type, icon: Icon, color }) => {
          const isSelected = selectedType === type;
          const typeKey =
            type === IntegrationProvider.AZURE_DEVOPS
              ? "azureDevops"
              : type.toLowerCase();

          return (
            <Card
              key={type}
              className={cn(
                "cursor-pointer transition-colors hover:border-primary",
                isSelected && "border-primary"
              )}
              onClick={() => onSelectType(type)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className={cn("h-8 w-8", color)}>
                    <Icon />
                  </div>
                  {isSelected && <Check className="h-5 w-5 text-primary" />}
                </div>
                <CardTitle className="text-base">
                  {t(`${typeKey}.name` as any)}
                </CardTitle>
                <CardDescription>
                  {t(`${typeKey}.description` as any)}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
