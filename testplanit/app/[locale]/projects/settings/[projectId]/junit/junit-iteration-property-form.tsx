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

  const handleAdd = () => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    if (names.includes(trimmed)) {
      setInput("");
      return;
    }
    setNames((prev) => [...prev, trimmed]);
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
          disabled={input.trim().length === 0}
          data-testid="junit-iteration-property-add"
        >
          <Plus className="h-4 w-4" />
          {t("addButton")}
        </Button>
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
                className="ml-1 inline-flex items-center justify-center hover:text-destructive"
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
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("saveButton")}
        </Button>
      </div>
    </div>
  );
}
