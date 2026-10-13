import {
  applyReadabilityPass,
  encodeFilterPredicatesForUrl,
} from "./filterUrlCodec";

/** One segment of the project overview's Test Case Breakdown chart. */
export interface BreakdownSegment {
  automated: boolean;
  /** The workflow state ring; null for the automation ring itself. */
  stateId?: number | null;
}

/**
 * The repository page filtered to the cases a breakdown segment counts: the
 * automation ring filters on `automated` and switches View By to automation;
 * a state segment adds its state and switches View By to workflow state.
 * Encoded the way the repository writes its own filter URLs, so the link
 * hydrates through the same parser.
 */
export function repositoryBreakdownHref(
  projectId: number,
  segment: BreakdownSegment
): string {
  const predicates = [
    {
      dimension: "automated",
      operator: "is",
      values: [segment.automated ? "1" : "0"],
    },
    ...(segment.stateId != null
      ? [{ dimension: "states", operator: "in", values: [segment.stateId] }]
      : []),
  ];
  const encoding = encodeFilterPredicatesForUrl(predicates);
  const query = new URLSearchParams();
  query.set("view", segment.stateId != null ? "states" : "automated");
  if (encoding.compressed) query.set("fz", encoding.compressed);
  for (const token of encoding.fParams) query.append("f", token);
  return `/projects/repository/${projectId}?${applyReadabilityPass(query.toString())}`;
}
