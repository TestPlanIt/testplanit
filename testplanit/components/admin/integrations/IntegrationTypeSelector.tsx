"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IntegrationProvider } from "@prisma/client";
import { Link } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { siGithub, siGitlab, siJira, siRedmine } from "simple-icons";
import { GiteaPlatformIcon } from "@/components/shared/gitea-family-icon";
import { cn } from "~/utils";

interface IntegrationTypeSelectorProps {
  selectedType: IntegrationProvider | null;
  onSelectType: (type: IntegrationProvider) => void;
}

function BrandIcon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 shrink-0", className)}
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  );
}

// Compact (h-4) icons for the dropdown rows — one per provider.
const integrationTypes: { type: IntegrationProvider; icon: ReactNode }[] = [
  {
    type: IntegrationProvider.SIMPLE_URL,
    icon: <Link className="h-4 w-4 shrink-0 text-purple-600" />,
  },
  {
    type: IntegrationProvider.JIRA,
    icon: <BrandIcon path={siJira.path} className="text-blue-600" />,
  },
  {
    type: IntegrationProvider.GITHUB,
    icon: <BrandIcon path={siGithub.path} />,
  },
  {
    type: IntegrationProvider.GITLAB,
    icon: <BrandIcon path={siGitlab.path} className="text-[#FC6D26]" />,
  },
  {
    type: IntegrationProvider.GITEA,
    icon: <GiteaPlatformIcon className="h-4 w-4 shrink-0" />,
  },
  {
    type: IntegrationProvider.AZURE_DEVOPS,
    icon: (
      <svg
        viewBox="0 0 18 18"
        className="h-4 w-4 shrink-0 text-blue-700"
        fill="currentColor"
      >
        <path d="M17,4v9.74l-4,3.28-6.2-2.26V17L3.29,12.41l10.23.8V4.44Zm-3.41.49L7.85,1V3.29L2.58,4.84,1,6.87v4.61l2.26,1V6.57Z" />
      </svg>
    ),
  },
  {
    type: IntegrationProvider.REDMINE,
    icon: <BrandIcon path={siRedmine.path} className="text-[#B32024]" />,
  },
];

function typeKeyFor(type: IntegrationProvider): string {
  return type === IntegrationProvider.AZURE_DEVOPS
    ? "azureDevops"
    : type.toLowerCase();
}

export function IntegrationTypeSelector({
  selectedType,
  onSelectType,
}: IntegrationTypeSelectorProps) {
  const t = useTranslations("admin.integrations.add");
  const selected = integrationTypes.find((i) => i.type === selectedType);

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">{t("selectType")}</h3>

      <Select
        value={selectedType ?? undefined}
        onValueChange={(value) => onSelectType(value as IntegrationProvider)}
      >
        <SelectTrigger className="w-full" data-testid="integration-type-select">
          <SelectValue placeholder={t("typeDescription")} />
        </SelectTrigger>
        <SelectContent>
          {integrationTypes.map(({ type, icon }) => (
            <SelectItem key={type} value={type}>
              <span className="flex items-center gap-2">
                {icon}
                <span>{t(`${typeKeyFor(type)}.name` as any)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && (
        <p className="text-sm text-muted-foreground">
          {t(`${typeKeyFor(selected.type)}.description` as any)}
        </p>
      )}
    </div>
  );
}
