import type { ExecutionProviderKind } from "../types";
import type { CiDispatchAdapter } from "./CiDispatchAdapter";
import { GenericWebhookDispatchAdapter } from "./GenericWebhookDispatchAdapter";
import { GitHubDispatchAdapter } from "./GitHubDispatchAdapter";
import { GitLabDispatchAdapter } from "./GitLabDispatchAdapter";

export interface AdapterTargetShape {
  provider: ExecutionProviderKind | string;
  workflowRef?: string | null;
  url?: string | null;
}

/**
 * Build the adapter for a target. `credentials` are already decrypted and
 * merged (target override wins over the repository's); `settings` are the
 * repository's non-secret settings (owner/repo/projectPath/baseUrl).
 */
export function createCiDispatchAdapter(
  target: AdapterTargetShape,
  credentials: Record<string, string>,
  settings: Record<string, string> | null | undefined
): CiDispatchAdapter {
  switch (target.provider) {
    case "GITHUB_ACTIONS":
      return new GitHubDispatchAdapter(
        credentials,
        settings,
        target.workflowRef
      );
    case "GITLAB_CI":
      return new GitLabDispatchAdapter(credentials, settings);
    case "GENERIC_WEBHOOK":
      return new GenericWebhookDispatchAdapter(
        target.url ?? "",
        credentials.secret ?? ""
      );
    default:
      throw new Error(`Unknown execution provider: ${target.provider}`);
  }
}

/** Which CodeRepository providers can back which execution providers. */
export const REPOSITORY_PROVIDER_FOR: Record<
  Exclude<ExecutionProviderKind, "GENERIC_WEBHOOK">,
  string
> = {
  GITHUB_ACTIONS: "GITHUB",
  GITLAB_CI: "GITLAB",
};

export {
  CiDispatchAdapter,
  DispatchError,
  StatusUnsupportedError,
} from "./CiDispatchAdapter";
export { GenericWebhookDispatchAdapter } from "./GenericWebhookDispatchAdapter";
export { GitHubDispatchAdapter } from "./GitHubDispatchAdapter";
export { GitLabDispatchAdapter } from "./GitLabDispatchAdapter";
