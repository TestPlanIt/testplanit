"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface JunitIterationPropertyFormProps {
  projectId: number;
  initialNames: readonly string[];
}

// Mirrors the server validation in
// app/api/projects/[projectId]/junit-iteration-property-names/route.ts so the
// user sees a specific reason inline instead of a generic "Invalid request
// body" on save.
const MAX_NAMES = 16;
const MAX_NAME_LENGTH = 64;
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

/**
 * Per-project tag-input UI for the JUnit iteration property names list
 * (INT-02 D-01). The list is the set of `<property name="...">` attribute
 * values the import route will look up (case-insensitively) on each
 * `<testcase>` to find the iteration index.
 *
 * Default behavior (empty list) is "iteration" only — the form surfaces
 * that hint instead of pre-populating the input, so admins can opt in to
 * custom names without ever clearing a stub default.
 */
export function JunitIterationPropertyForm({
  projectId,
  initialNames,
}: JunitIterationPropertyFormProps) {
  const t = useTranslations("projects.settings.junitIterationProperties");
  const [names, setNames] = useState<string[]>([...initialNames]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Keep state in sync if the parent re-fetches the project row.
  useEffect(() => {
    setNames([...initialNames]);
  }, [initialNames]);

  const isDirty = useMemo(() => {
    if (names.length !== initialNames.length) return true;
    return names.some((n, i) => n !== initialNames[i]);
  }, [names, initialNames]);

  const trimmedInput = input.trim();
  const atLimit = names.length >= MAX_NAMES;

  // Returns a localized reason the candidate can't be added, or null if valid.
  const getInputError = (candidate: string): string | null => {
    if (candidate.length === 0) return null;
    if (candidate.length > MAX_NAME_LENGTH)
      return t("errorTooLong", { maxLength: String(MAX_NAME_LENGTH) });
    if (/\s/.test(candidate)) return t("errorWhitespace");
    if (RESERVED_KEYS.includes(candidate))
      return t("errorReserved", { name: candidate });
    if (names.includes(candidate))
      return t("errorDuplicate", { name: candidate });
    return null;
  };

  const inputError = getInputError(trimmedInput);
  const canAdd = trimmedInput.length > 0 && !inputError && !atLimit;

  const handleAdd = () => {
    if (!canAdd) return;
    setNames((prev) => [...prev, trimmedInput]);
    setInput("");
  };

  const handleRemove = (name: string) => {
    setNames((prev) => prev.filter((n) => n !== name));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/junit-iteration-property-names`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyNames: names }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? t("saveError"));
        return;
      }
      toast.success(t("saveSuccess"));
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="junit-iteration-property-input">
              {t("addLabel")}
            </Label>
            <Input
              id="junit-iteration-property-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("placeholder")}
              disabled={atLimit}
              aria-invalid={!!inputError}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              data-testid="junit-iteration-property-input"
            />
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            data-testid="junit-iteration-property-add"
          >
            <Plus className="h-4 w-4" />
            {t("addButton")}
          </Button>
        </div>

        <div className="space-y-1">
          <p
            className="text-xs text-muted-foreground"
            data-testid="junit-iteration-property-count"
          >
            {t("counter", {
              count: String(names.length),
              max: String(MAX_NAMES),
            })}
          </p>
          <p
            className={`text-sm ${
              inputError || atLimit
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
            data-testid="junit-iteration-property-constraints"
          >
            {inputError
              ? inputError
              : atLimit
                ? t("limitReached", { max: String(MAX_NAMES) })
                : t("constraints", {
                    max: String(MAX_NAMES),
                    maxLength: String(MAX_NAME_LENGTH),
                  })}
          </p>
        </div>
      </div>

      {names.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="junit-iteration-property-default-hint"
        >
          {t("defaultHint")}
        </p>
      ) : (
        <div
          className="flex flex-wrap gap-2"
          data-testid="junit-iteration-property-tags"
        >
          {names.map((name) => (
            <Badge
              key={name}
              variant="secondary"
              className="font-mono"
              data-testid={`junit-iteration-property-tag-${name}`}
            >
              {name}
              <button
                type="button"
                className="ms-1 inline-flex items-center justify-center hover:text-destructive"
                onClick={() => handleRemove(name)}
                aria-label={t("removeAria", { name })}
                data-testid={`junit-iteration-property-remove-${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving}
          data-testid="junit-iteration-property-save"
          aria-label={t("saveButton")}
          className="group gap-0 transition-all duration-200 hover:gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
            {t("saveButton")}
          </span>
        </Button>
      </div>
    </div>
  );
}
