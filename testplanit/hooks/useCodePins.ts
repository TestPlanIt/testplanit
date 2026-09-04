"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  CodePinKind,
  PinStaleness,
  PinStaleReason,
} from "~/lib/services/impact/codePins";

export type { CodePinKind, PinStaleness, PinStaleReason };

/** The literal first element of every query key this hook issues. */
export const CODE_PINS_QUERY_KEY_ROOT = "codePins";

export type CodePinSource = "MANUAL" | "AI" | "ANNOTATION" | "MAPFILE";

export interface CodePin {
  id: number;
  caseId: number;
  configId: number;
  kind: CodePinKind;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  anchorSha: string | null;
  source: CodePinSource;
  note: string | null;
  staleDismissedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null };
  staleness: PinStaleness | null;
}

export interface CodePinsResponse {
  pins: CodePin[];
  stalenessError: string | null;
}

export interface CodePinCreateInput {
  configId: number;
  kind: CodePinKind;
  filePath: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  note?: string;
  ref?: string;
}

/**
 * What an existing pin may change. Kind and file are absent by design: those
 * make the pin a different claim, so they stay a remove and add. `filePath`
 * is accepted only for a GLOB pin, whose pattern lives there.
 */
export interface CodePinUpdateInput {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  note?: string | null;
  ref?: string;
}

export interface CodePinReanchorInput {
  ref?: string;
  startLine?: number;
  endLine?: number;
}

export type CodePinErrorCode =
  | "duplicate"
  | "managed"
  | "file_not_found"
  | "line_out_of_range"
  | "symbol_not_found"
  | "snippet_too_large";

const CODE_PIN_ERROR_CODES: readonly CodePinErrorCode[] = [
  "duplicate",
  "managed",
  "file_not_found",
  "line_out_of_range",
  "symbol_not_found",
  "snippet_too_large",
];

function isCodePinErrorCode(value: unknown): value is CodePinErrorCode {
  return (
    typeof value === "string" &&
    (CODE_PIN_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class CodePinRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: CodePinErrorCode | null = null,
    public readonly duplicateId: number | null = null
  ) {
    super(message);
    this.name = "CodePinRequestError";
  }
}

const ERROR_KEY_BY_CODE: Record<CodePinErrorCode, string> = {
  duplicate: "duplicate",
  managed: "managedTooltip",
  file_not_found: "errorFileNotFound",
  line_out_of_range: "errorLineOutOfRange",
  symbol_not_found: "errorSymbolNotFound",
  snippet_too_large: "errorSnippetTooLarge",
};

/**
 * The `repository.codePins.*` key that describes a failed pin request, or
 * null when the failure carries no code the UI has a message for.
 */
export function codePinErrorKey(error: unknown): string | null {
  if (error instanceof CodePinRequestError && error.code) {
    return ERROR_KEY_BY_CODE[error.code];
  }
  return null;
}

export function isManagedCodePin(pin: Pick<CodePin, "source">): boolean {
  return pin.source === "ANNOTATION" || pin.source === "MAPFILE";
}

interface ErrorBody {
  error?: string;
  code?: string;
  id?: number;
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = fallbackMessage;
    let code: CodePinErrorCode | null = null;
    let duplicateId: number | null = null;
    try {
      const data = (await res.json()) as ErrorBody;
      if (data?.error) message = data.error;
      if (isCodePinErrorCode(data?.code)) {
        code = data.code;
      } else if (res.status === 409) {
        code = "duplicate";
        duplicateId = typeof data?.id === "number" ? data.id : null;
      }
    } catch {
      // Non-JSON body: keep the fallback message.
    }
    throw new CodePinRequestError(message, res.status, code, duplicateId);
  }
  return (await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function codePinsUrl(caseId: number, staleness = true): string {
  return `/api/repository-cases/${caseId}/code-pins${
    staleness ? "" : "?staleness=0"
  }`;
}

export async function fetchCodePins(
  caseId: number,
  staleness = true
): Promise<CodePinsResponse> {
  const data = await requestJson<Partial<CodePinsResponse>>(
    codePinsUrl(caseId, staleness),
    undefined,
    "Failed to load code pins."
  );
  return {
    pins: Array.isArray(data.pins) ? data.pins : [],
    stalenessError: data.stalenessError ?? null,
  };
}

export async function createCodePin(
  caseId: number,
  input: CodePinCreateInput
): Promise<CodePin> {
  const data = await requestJson<{ pin: CodePin }>(
    codePinsUrl(caseId),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) },
    "Failed to create code pin."
  );
  return data.pin;
}

export async function updateCodePin(
  caseId: number,
  pinId: number,
  input: CodePinUpdateInput
): Promise<CodePin> {
  const data = await requestJson<{ pin: CodePin }>(
    `${codePinsUrl(caseId)}/${pinId}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(input) },
    "Failed to update code pin."
  );
  return data.pin;
}

export async function deleteCodePin(
  caseId: number,
  pinId: number
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `${codePinsUrl(caseId)}/${pinId}`,
    { method: "DELETE" },
    "Failed to delete code pin."
  );
}

export async function reanchorCodePin(
  caseId: number,
  pinId: number,
  body: CodePinReanchorInput = {}
): Promise<CodePin> {
  const data = await requestJson<{ pin: CodePin }>(
    `${codePinsUrl(caseId)}/${pinId}/reanchor`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    "Failed to re-anchor code pin."
  );
  return data.pin;
}

export async function dismissCodePinStale(
  caseId: number,
  pinId: number
): Promise<string | null> {
  const data = await requestJson<{ dismissedAt: string | null }>(
    `${codePinsUrl(caseId)}/${pinId}/stale-dismissal`,
    { method: "POST" },
    "Failed to dismiss stale flag."
  );
  return data.dismissedAt ?? null;
}

/**
 * The predicate `invalidateCodePins` is built on: this hook's own key, for
 * one case when `caseId` is given, otherwise for every open panel.
 */
export function isCodePinsQueryKey(
  queryKey: QueryKey,
  caseId?: number
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === CODE_PINS_QUERY_KEY_ROOT &&
    (caseId === undefined || queryKey[1] === caseId)
  );
}

export function invalidateCodePins(
  queryClient: QueryClient,
  caseId?: number
): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isCodePinsQueryKey(query.queryKey, caseId),
  });
}

function invalidateAfterMutation(
  queryClient: QueryClient,
  caseId: number | undefined
): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      isCodePinsQueryKey(query.queryKey, caseId) ||
      JSON.stringify(query.queryKey).includes("RepositoryCases"),
  });
}

const EMPTY_PINS: CodePin[] = [];

interface UseCodePinsOptions {
  enabled?: boolean;
  staleness?: boolean;
}

/**
 * A case's Code Pins plus the mutations that change them. Toast-free: the
 * callers own their success and failure messages.
 */
export function useCodePins(
  caseId: number | undefined,
  { enabled = true, staleness = true }: UseCodePinsOptions = {}
) {
  const queryClient = useQueryClient();

  const query = useQuery<CodePinsResponse>({
    queryKey: [CODE_PINS_QUERY_KEY_ROOT, caseId, { staleness }],
    queryFn: () => fetchCodePins(caseId as number, staleness),
    enabled: enabled && Number.isFinite(caseId),
    staleTime: 30000,
  });

  const onMutationSuccess = useCallback(() => {
    invalidateAfterMutation(queryClient, caseId);
  }, [queryClient, caseId]);

  const addMutation = useMutation({
    mutationFn: (input: CodePinCreateInput) =>
      createCodePin(caseId as number, input),
    onSuccess: onMutationSuccess,
  });

  const removeMutation = useMutation({
    mutationFn: (pinId: number) => deleteCodePin(caseId as number, pinId),
    onSuccess: onMutationSuccess,
  });

  const reanchorMutation = useMutation({
    mutationFn: ({
      pinId,
      body,
    }: {
      pinId: number;
      body?: CodePinReanchorInput;
    }) => reanchorCodePin(caseId as number, pinId, body),
    onSuccess: onMutationSuccess,
  });

  const dismissMutation = useMutation({
    mutationFn: (pinId: number) => dismissCodePinStale(caseId as number, pinId),
    onSuccess: onMutationSuccess,
  });

  const { mutateAsync: add } = addMutation;
  const { mutateAsync: remove } = removeMutation;
  const { mutateAsync: reanchorAsync } = reanchorMutation;
  const { mutateAsync: dismissStale } = dismissMutation;

  const reanchor = useCallback(
    (pinId: number, body?: CodePinReanchorInput) =>
      reanchorAsync({ pinId, body }),
    [reanchorAsync]
  );

  return {
    pins: query.data?.pins ?? EMPTY_PINS,
    stalenessError: query.data?.stalenessError ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    add,
    remove,
    reanchor,
    dismissStale,
    isMutating:
      addMutation.isPending ||
      removeMutation.isPending ||
      reanchorMutation.isPending ||
      dismissMutation.isPending,
  };
}
