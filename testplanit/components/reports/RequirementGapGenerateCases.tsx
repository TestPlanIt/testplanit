"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { extractTextWithImageMarkers } from "~/utils/extractTextFromJson";
import {
  resolveRequirementDisplayPriority,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";
import { schema } from "~/zenstack/schema";

// Type-only import: erased at compile time, so the (large) wizard module
// itself never lands in this chunk — the runtime component arrives through
// next/dynamic below, the same treatment MemberIssuesTable gives it.
import type { GenerateTestCasesSeedIssue } from "@/[locale]/projects/repository/[projectId]/GenerateTestCasesWizard";

const GenerateTestCasesWizard = dynamic(
  () =>
    import("@/[locale]/projects/repository/[projectId]/GenerateTestCasesWizard").then(
      (m) => m.GenerateTestCasesWizard
    ),
  { ssr: false }
);

interface RequirementGapGenerateCasesProps {
  projectId: number;
  requirementId: number;
  /** Row-level fallbacks, used only if the requirement read resolves empty. */
  requirementKey: string;
  requirementTitle: string;
  onClose: () => void;
  onImportComplete?: () => void;
}

/**
 * Mounts the AI test-case generation wizard seeded from a coverage-gap
 * report row. The gap row carries only display fields, so the requirement
 * is re-read here to give the wizard the full seed (description/note body,
 * tracker identity for comment enrichment). Because a requirement IS an
 * Issue row, `seedIssue.issueId` makes the wizard's import link the
 * generated cases straight back to the requirement — closing the gap the
 * row reported.
 */
export function RequirementGapGenerateCases({
  projectId,
  requirementId,
  requirementKey,
  requirementTitle,
  onClose,
  onImportComplete,
}: RequirementGapGenerateCasesProps) {
  const { data: requirement, isLoading } = useClientQueries(
    schema
  ).issue.useFindFirst({
    where: {
      id: requirementId,
      // The id comes from report data that may be stale — the requirement
      // role predicate (HYG-01) plus the project pin keep it from ever
      // resolving a defect, or another project's issue, into the seed.
      projectId,
      ...REQUIREMENT_SCOPE_WHERE,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      note: true,
      status: true,
      externalStatus: true,
      priority: true,
      externalPriority: true,
      externalId: true,
      externalUrl: true,
      externalKey: true,
      integrationId: true,
      isRequirement: true,
      requirementDetachedAt: true,
    },
  });

  const seedIssue = useMemo<GenerateTestCasesSeedIssue | null>(() => {
    if (isLoading) return null;
    if (!requirement) {
      // The read can settle empty (requirement deleted or declassified
      // since the report ran) — seed from the row's own display fields so
      // the action still opens rather than dead-ending silently.
      return {
        issueId: requirementId,
        key: requirementKey,
        title: requirementTitle,
      };
    }
    // A native requirement's body lives in the rich-text `note` (its
    // `description` column is empty by construction); a synced one carries
    // the tracker's text in `description`. Flatten whichever is present so
    // the generator always sees the requirement's actual content.
    const noteText = requirement.note
      ? extractTextWithImageMarkers(ensureTipTapJSON(requirement.note))
      : "";
    const description = requirement.description?.trim()
      ? requirement.description
      : noteText || undefined;
    return {
      issueId: requirement.id,
      key: requirement.externalKey ?? requirement.name,
      title: requirement.title,
      description,
      // Lock-aware resolvers — the only status/priority reads permitted on
      // requirement surfaces (utils/issueDisplayText.ts).
      status: resolveRequirementDisplayStatus(requirement) ?? undefined,
      priority: resolveRequirementDisplayPriority(requirement) ?? undefined,
      externalId: requirement.externalId,
      externalUrl: requirement.externalUrl,
      integrationId: requirement.integrationId,
    };
  }, [isLoading, requirement, requirementId, requirementKey, requirementTitle]);

  if (!seedIssue) return null;

  return (
    <GenerateTestCasesWizard
      folderId={0}
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      seedIssue={seedIssue}
      onImportComplete={onImportComplete}
    />
  );
}
