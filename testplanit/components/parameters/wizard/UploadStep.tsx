"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export interface UploadStepProps {
  onFileSelected: (file: File, csvText: string) => void;
}

/**
 * Surface E.2 — Step 1 (Upload).
 *
 * Validates extension (.csv) and size (5 MB cap) client-side BEFORE
 * reading file contents. The same caps live server-side in Plan 02-02
 * import-csv route as defense-in-depth.
 */
export function UploadStep({ onFileSelected }: UploadStepProps) {
  const t = useTranslations("parameters");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(t("importStep1ErrorWrongType"));
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t("importStep1ErrorTooBig"));
      return;
    }
    setError(null);
    const text = await file.text();
    onFileSelected(file, text);
  };

  return (
    <div
      className="p-6 space-y-4"
      data-testid="dataset-import-wizard-step-upload"
    >
      <h3 className="text-base font-semibold">{t("importStep1Heading")}</h3>
      <p className="text-sm text-muted-foreground">{t("importStep1Body")}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleChange}
        className="hidden"
        data-testid="dataset-import-wizard-file-input"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        data-testid="dataset-import-wizard-choose-button"
      >
        {t("importStep1Choose")}
      </Button>
      {error && (
        <Alert
          variant="destructive"
          data-testid="dataset-import-wizard-upload-error"
        >
          {error}
        </Alert>
      )}
    </div>
  );
}
