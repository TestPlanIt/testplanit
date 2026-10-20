import type { FailureClassification } from "~/zenstack/models";

export interface ClassificationRow extends FailureClassification {
  color: { id: number; value: string } | null;
  _count: { signatures: number };
}
