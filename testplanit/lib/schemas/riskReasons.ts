import { z } from "zod";
import { RISK_COMPONENT_KEYS } from "./riskWeights";

/**
 * Lenient parse of the persisted `RepositoryCases.riskReasons` Json for
 * rendering. The column is machine-written and update-locked in the schema,
 * but a Json column can still hold anything older writers (or a migration
 * gap) left behind — a malformed value must degrade to an empty breakdown,
 * never crash the case list.
 */

const componentSchema = z.object({
  key: z.enum(RISK_COMPONENT_KEYS),
  raw: z.number().finite().catch(0),
  weight: z.number().finite().catch(0),
  points: z.number().finite().catch(0),
});

const factsSchema = z.object({
  verdictsSampled: z.number().int().nonnegative().catch(0),
  failCount: z.number().int().nonnegative().catch(0),
  flips: z.number().int().nonnegative().catch(0),
  lastExecutedAt: z.string().nullable().catch(null),
  requirementCount: z.number().int().nonnegative().catch(0),
  topRequirementPriority: z.string().nullable().catch(null),
  suspectLinkCount: z.number().int().nonnegative().catch(0),
  defectCount: z.number().int().nonnegative().catch(0),
  topDefectPriority: z.string().nullable().catch(null),
  caseCriticality: z.string().nullable().catch(null),
  quarantined: z.boolean().catch(false),
});

const riskReasonsSchema = z.object({
  components: z.array(componentSchema).catch([]),
  facts: factsSchema.catch(factsSchema.parse({})),
});

export type ParsedRiskReasons = z.infer<typeof riskReasonsSchema>;

export function parseRiskReasons(value: unknown): ParsedRiskReasons | null {
  const parsed = riskReasonsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
