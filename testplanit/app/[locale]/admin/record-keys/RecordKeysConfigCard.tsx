"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_TYPE_TOKENS,
  formatRecordKey,
  isValidTypeToken,
  normalizeTypeToken,
  RECORD_TYPE_LIST,
  resolveTypeTokens,
  sanitizeKeyInput,
  type RecordType,
  type TypeTokenMap,
} from "~/lib/recordKey";
import {
  RECORD_KEY_ENABLED_KEY,
  RECORD_KEY_TOKENS_KEY,
} from "~/lib/services/recordKeyConfig";
import { schema } from "~/zenstack/schema";

/** Sample project code used only for the live preview column. */
const PREVIEW_PROJECT_CODE = "PROJECT";
const PREVIEW_ID = 1234;

/**
 * Each record type's label reuses an existing translation key rather than
 * shipping a duplicate string to Crowdin.
 */
const TYPE_LABEL_KEY: Record<RecordType, string> = {
  TEST_CASE: "reports.dimensions.testCase",
  TEST_RUN: "reports.dimensions.testRun",
  SESSION: "reports.dimensions.session",
  MILESTONE: "reports.dimensions.milestone",
  RESULT: "common.fields.resultStatus",
  DATASET: "parameters.tabDataset",
  TAG: "reports.dimensions.tag",
  SHARED_STEPS: "common.fields.sharedSteps",
  ISSUE: "repository.views.byIssue",
};

export function RecordKeysConfigCard() {
  const t = useTranslations("admin.recordKeys");
  // Reuse existing entity-label translations rather than duplicating them.
  const tRoot = useTranslations();
  const { data: session } = useSession();
  const isAdmin = session?.user?.access === "ADMIN";

  const appConfig = useClientQueries(schema).appConfig;
  const upsert = appConfig.useUpsert();

  const { data: enabledRow, isLoading: enabledLoading } =
    appConfig.useFindUnique({ where: { key: RECORD_KEY_ENABLED_KEY } });
  const { data: tokensRow, isLoading: tokensLoading } = appConfig.useFindUnique(
    { where: { key: RECORD_KEY_TOKENS_KEY } }
  );

  const enabled = enabledRow?.value === true;
  const persistedTokens = useMemo(
    () => resolveTypeTokens(tokensRow?.value),
    [tokensRow?.value]
  );

  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!tokensLoading) setTokenInputs({ ...persistedTokens });
  }, [tokensLoading, persistedTokens]);

  const controlsDisabled = !isAdmin || upsert.isPending || enabledLoading;

  const normalizedInputs = useMemo<TypeTokenMap>(() => {
    const out = { ...DEFAULT_TYPE_TOKENS };
    for (const type of RECORD_TYPE_LIST) {
      out[type] = normalizeTypeToken(tokenInputs[type] ?? "");
    }
    return out;
  }, [tokenInputs]);

  const invalidTypes = RECORD_TYPE_LIST.filter(
    (type) => !isValidTypeToken(normalizedInputs[type])
  );
  const duplicateTokens = useMemo(() => {
    const seen = new Map<string, number>();
    for (const type of RECORD_TYPE_LIST) {
      const tok = normalizedInputs[type];
      seen.set(tok, (seen.get(tok) ?? 0) + 1);
    }
    return new Set(
      Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([tok]) => tok)
    );
  }, [normalizedInputs]);

  const isDirty = RECORD_TYPE_LIST.some(
    (type) => normalizedInputs[type] !== persistedTokens[type]
  );
  const saveDisabled =
    controlsDisabled ||
    tokensLoading ||
    invalidTypes.length > 0 ||
    duplicateTokens.size > 0 ||
    !isDirty;

  const handleToggle = async (next: boolean) => {
    try {
      await upsert.mutateAsync({
        where: { key: RECORD_KEY_ENABLED_KEY },
        create: { key: RECORD_KEY_ENABLED_KEY, value: next },
        update: { value: next },
      });
      toast.success(next ? t("enableSuccess") : t("disableSuccess"));
    } catch {
      toast.error(t("saveError"));
    }
  };

  const handleSaveTokens = async () => {
    if (saveDisabled) return;
    try {
      await upsert.mutateAsync({
        where: { key: RECORD_KEY_TOKENS_KEY },
        create: { key: RECORD_KEY_TOKENS_KEY, value: normalizedInputs },
        update: { value: normalizedInputs },
      });
      toast.success(t("tokensSaved"));
    } catch {
      toast.error(t("saveError"));
    }
  };

  const handleReset = () => setTokenInputs({ ...DEFAULT_TYPE_TOKENS });

  return (
    <Card data-testid="record-keys-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Label className="flex items-center gap-3">
            <Switch
              id="record-keys-toggle"
              data-testid="record-keys-toggle"
              aria-label={t("toggleAriaLabel")}
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={controlsDisabled}
            />
            <CardTitle>{t("title")}</CardTitle>
          </Label>
          <HelpPopover helpKey="recordKeysEnabled" />
        </div>
      </CardHeader>

      {!isAdmin && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {tRoot("admin.workflows.systemFeatureCard.adminOnlyNotice")}
          </p>
        </CardContent>
      )}

      {isAdmin && enabled && (
        <CardContent>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium">{t("tokensHeading")}</h3>
              <p className="text-sm text-muted-foreground">{t("tokensHelp")}</p>
            </div>

            <div
              className="flex flex-col divide-y rounded-md border"
              data-testid="record-keys-token-table"
            >
              {RECORD_TYPE_LIST.map((type) => {
                const value = tokenInputs[type] ?? "";
                const normalized = normalizedInputs[type];
                const invalid = !isValidTypeToken(normalized);
                const duplicated = !invalid && duplicateTokens.has(normalized);
                const preview = formatRecordKey({
                  projectKey: PREVIEW_PROJECT_CODE,
                  type,
                  id: PREVIEW_ID,
                  tokens: normalizedInputs,
                });
                return (
                  <div
                    key={type}
                    className="flex flex-wrap items-center gap-3 p-3"
                    data-testid={`record-keys-row-${type}`}
                  >
                    <Label
                      htmlFor={`record-keys-input-${type}`}
                      className="w-40 text-sm font-medium"
                    >
                      {tRoot(TYPE_LABEL_KEY[type] as never)}
                    </Label>
                    <Input
                      id={`record-keys-input-${type}`}
                      data-testid={`record-keys-input-${type}`}
                      value={value}
                      maxLength={6}
                      onChange={(e) =>
                        setTokenInputs((prev) => ({
                          ...prev,
                          [type]: sanitizeKeyInput(e.target.value),
                        }))
                      }
                      disabled={controlsDisabled}
                      aria-invalid={invalid || duplicated}
                      className="w-28 uppercase"
                    />
                    <span
                      className="font-mono text-sm text-muted-foreground"
                      data-testid={`record-keys-preview-${type}`}
                    >
                      {invalid ? t("invalidToken") : preview}
                    </span>
                    {duplicated && (
                      <span className="text-sm text-destructive">
                        {t("duplicateToken")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                data-testid="record-keys-save"
                onClick={handleSaveTokens}
                disabled={saveDisabled}
              >
                {tRoot("common.actions.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="record-keys-reset"
                onClick={handleReset}
                disabled={controlsDisabled}
              >
                {tRoot("common.actions.reset")}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
