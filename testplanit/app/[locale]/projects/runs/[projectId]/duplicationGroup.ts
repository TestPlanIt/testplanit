/**
 * Which configuration group the runs created by a DUPLICATE flow land in.
 *
 * Two shapes, chosen in `DuplicateTestRunDialog`:
 *
 *   - separate    the copies form their own group when 2+ configurations are
 *                 picked, and the run being duplicated stays out of it. This is
 *                 the default, so the duplicate flow behaves exactly as before
 *                 unless the user asks for something else.
 *   - join source the copies join the source run's group, so the source and
 *                 every copy are flat peers. A single copy joins too — the
 *                 group already has the source in it, so the "2+ configs"
 *                 rule of the separate mode does not apply.
 *
 * When the source has no group yet, one is minted and the SOURCE must be
 * stamped with it as well; otherwise the copies group up without it, which is
 * the exact defect this option exists to fix. `stampSource` reports that.
 *
 * Ids come from `newConfigurationGroupId` so a group formed here is
 * indistinguishable from one formed at create time.
 */

import { newConfigurationGroupId } from "~/lib/services/configurationGroups";

export interface DuplicationGroupPlan {
  /** Stamped on every run created by this duplication; null = no group. */
  configurationGroupId: string | null;
  /** True when the source run must be stamped with the same id. */
  stampSource: boolean;
}

export function planDuplicationGroup(args: {
  /** How many runs this duplication will create (one per configuration). */
  configCount: number;
  /** The user opted into joining the source run's group. */
  joinSourceGroup: boolean;
  /** The source run's current group, if it already has one. */
  sourceGroupId?: string | null;
  /** Injectable for deterministic ids in tests. */
  mintId?: () => string;
}): DuplicationGroupPlan {
  const mintId = args.mintId ?? newConfigurationGroupId;

  if (!args.joinSourceGroup) {
    return {
      configurationGroupId: args.configCount > 1 ? mintId() : null,
      stampSource: false,
    };
  }

  const sourceGroupId = args.sourceGroupId ?? null;
  if (sourceGroupId) {
    return { configurationGroupId: sourceGroupId, stampSource: false };
  }
  return { configurationGroupId: mintId(), stampSource: true };
}
