"use client";

import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { badgeVariants } from "@/components/ui/badge";
import { Fingerprint } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback } from "react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import type { FailureSignatureWhereInput } from "~/zenstack/input";

interface SignatureOption {
  id: number;
  title: string;
  projectId: number;
  project?: { name: string; iconUrl?: string | null } | null;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Count badge that opens a searchable list of failure signatures, each
 * linking to its signature page. Signatures live in projects, so rows show
 * the project; used where a count spans projects (the admin catalogue).
 */
export const SignaturesListDisplay: React.FC<{
  filter: FailureSignatureWhereInput;
  count: number;
  pageSize?: number;
  triggerVariant?: "default" | "secondary" | "destructive" | "outline";
}> = ({ filter, count, pageSize = DEFAULT_PAGE_SIZE, triggerVariant }) => {
  const locale = useLocale();
  const t = useTranslations("triage");

  const fetchSignatures = useCallback(
    async (query: string, page: number, size: number) => {
      const trimmed = query.trim();
      const where: FailureSignatureWhereInput = trimmed
        ? {
            AND: [
              filter,
              { title: { contains: trimmed, mode: "insensitive" } },
            ],
          }
        : filter;
      const params = {
        where,
        orderBy: { lastSeenAt: "desc" } as const,
        skip: page * size,
        take: size,
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true, iconUrl: true } },
        },
      };
      const response = await fetch(
        `/api/model/FailureSignature/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );
      if (!response.ok) {
        console.error("Failed to load signatures", await response.text());
        return { results: [], total: 0 };
      }
      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as SignatureOption[])
        : [];
      let total = count;
      if (trimmed) {
        const countResponse = await fetch(
          `/api/model/FailureSignature/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
        );
        if (countResponse.ok) {
          const countPayload = await countResponse.json();
          if (typeof countPayload?.data === "number") total = countPayload.data;
        }
      }
      return { results, total };
    },
    [filter, count]
  );

  if (count === 0) return null;

  const searchPlaceholder = t("filters.searchPlaceholder");

  return (
    <AsyncCombobox<SignatureOption>
      value={null}
      onValueChange={() => {}}
      fetchOptions={fetchSignatures}
      renderOption={(option) => (
        <div className="flex w-full items-center justify-between gap-2">
          <Link
            href={`/projects/triage/${option.projectId}/${option.id}`}
            className="min-w-0 truncate font-mono text-sm hover:underline"
            title={option.title}
          >
            {option.title}
          </Link>
          {option.project?.name && (
            <span className="flex w-[90px] shrink-0 justify-start">
              <ProjectNameDisplay
                projectName={option.project.name}
                projectId={option.projectId}
                iconUrl={option.project.iconUrl}
                className="text-xs text-muted-foreground"
                fitContainer
              />
            </span>
          )}
        </div>
      )}
      getOptionValue={(option) => option.id}
      placeholder={searchPlaceholder}
      triggerLabel={count.toLocaleString(locale)}
      renderTrigger={({ triggerLabel }) => (
        <button
          type="button"
          aria-label={searchPlaceholder}
          className={cn(
            badgeVariants({ variant: triggerVariant ?? "default" }),
            "gap-1 whitespace-nowrap text-xs"
          )}
          data-testid="signatures-list-display"
        >
          <Fingerprint className="h-4 w-4" />
          <span>{String(triggerLabel ?? "")}</span>
        </button>
      )}
      dropdownClassName="p-0 min-w-[480px] max-w-[720px]"
      pageSize={pageSize}
      showTotal
    />
  );
};
