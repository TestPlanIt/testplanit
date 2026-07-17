"use client";

import { CopyChip } from "@/components/CopyChip";
import { useRecordKey } from "~/hooks/useRecordKeyConfig";
import type { RecordType } from "~/lib/recordKey";

interface RecordIdProps {
  type: RecordType;
  id: number;
  /** The project's code, when the caller already has it (avoids a lookup). */
  projectKey?: string | null;
  /** Used to fetch the project code when `projectKey` isn't supplied. */
  projectId?: number;
  className?: string;
}

/**
 * The canonical, copyable way to show a record's identifier anywhere in the UI.
 * Displays the cosmetic project-prefixed key (e.g. `WEB-TC-1234`) when the
 * feature is on and the project has a code, otherwise the bare numeric id — and
 * always renders a copy icon so the shown value can be copied. This is the
 * canonical id display — it always renders (never hides itself).
 */
export function RecordId({
  type,
  id,
  projectKey,
  projectId,
  className,
}: RecordIdProps) {
  const key = useRecordKey({ type, id, projectKey, projectId });
  return (
    <CopyChip
      value={key ?? String(id)}
      className={className}
      testId="record-id"
    />
  );
}
