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
import { siGithub, siGitlab, siJira } from "simple-icons";
import { GiteaFamilyIcon } from "@/components/shared/gitea-family-icon";
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
    color: "text-gray-900 dark:text-white",
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
    icon: () => <GiteaFamilyIcon className="h-8 w-8" />,
    color: "",
  },
  {
    type: IntegrationProvider.AZURE_DEVOPS,
    icon: () => (
      <svg viewBox="0 0 18 18" className="h-8 w-8" fill="currentColor">
        <path d="M17,4v9.74l-4,3.28-6.2-2.26V17L3.29,12.41l10.23.8V4.44Zm-3.41.49L7.85,1V3.29L2.58,4.84,1,6.87v4.61l2.26,1V6.57Z" />
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
