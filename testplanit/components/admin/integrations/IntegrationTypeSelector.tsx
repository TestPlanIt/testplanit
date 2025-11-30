"use client";

import { useTranslations } from "next-intl";
import { IntegrationProvider } from "@prisma/client";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "~/utils";
import { Check, Link } from "lucide-react";
import { siJira, siGithub } from "simple-icons";

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
  // These are commented out until implementation is ready
  // {
  //   type: IntegrationProvider.GITLAB,
  //   icon: GitBranch,
  //   color: "text-orange-600",
  // },
  // {
  //   type: IntegrationProvider.AZURE_DEVOPS,
  //   icon: Cloud,
  //   color: "text-blue-700",
  // },
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
          const typeKey = type.toLowerCase();

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
