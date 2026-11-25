import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";

/** True once at least one active AI model exists on this install. */
export function useHasActiveAiModel(): boolean {
  const { data: activeModels } = useClientQueries(
    schema
  ).llmIntegration.useCount({
    where: { isDeleted: false, status: "ACTIVE" },
  });
  return (activeModels ?? 0) > 0;
}
