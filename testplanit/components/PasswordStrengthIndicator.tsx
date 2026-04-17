"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PasswordPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requiredSpecialChars: string | null;
}

interface PasswordStrengthIndicatorProps {
  password: string;
  policy: PasswordPolicy | null;
}

// Score labels map: 0=veryWeak, 1=weak, 2=fair, 3=good, 4=strong
const SCORE_LABELS = ["veryWeak", "weak", "fair", "good", "strong"] as const;

// Tailwind color classes for each filled segment by score level
const SCORE_COLORS: Record<number, string> = {
  0: "bg-red-500",
  1: "bg-red-500",
  2: "bg-orange-400",
  3: "bg-yellow-400",
  4: "bg-green-500",
};

export function PasswordStrengthIndicator({
  password,
  policy,
}: PasswordStrengthIndicatorProps) {
  const t = useTranslations("passwordStrength");
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<string>("");
  const zxcvbnRef = useRef<((pw: string) => any) | null>(null);

  // Dynamic import of zxcvbn-ts (D-09, avoid adding ~800KB to initial bundle)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { zxcvbn, zxcvbnOptions } = await import("@zxcvbn-ts/core");
      const { dictionary } = await import("@zxcvbn-ts/language-en");
      zxcvbnOptions.setOptions({ dictionary });
      if (!cancelled) {
        zxcvbnRef.current = zxcvbn;
        // Re-evaluate current password if already typed
        if (password) {
          const result = zxcvbn(password);
          setScore(result.score);
          setFeedback(result.feedback?.warning ?? "");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // Load once on mount

  // Re-evaluate score when password changes
  useEffect(() => {
    if (!password) {
      setScore(0);
      setFeedback("");
      return;
    }
    if (zxcvbnRef.current) {
      const result = zxcvbnRef.current(password);
      setScore(result.score);
      setFeedback(result.feedback?.warning ?? "");
    }
  }, [password]);

  // Policy requirements check (D-10, pure synchronous -- no zxcvbn needed)
  const requirements = useMemo(() => {
    if (!policy) return [];

    const checks: { key: string; label: string; met: boolean }[] = [];

    checks.push({
      key: "minLength",
      label: t("minLength", { count: policy.minPasswordLength }),
      met: password.length >= policy.minPasswordLength,
    });

    if (policy.requireUppercase) {
      checks.push({
        key: "uppercase",
        label: t("uppercase"),
        met: /[A-Z]/.test(password),
      });
    }

    if (policy.requireLowercase) {
      checks.push({
        key: "lowercase",
        label: t("lowercase"),
        met: /[a-z]/.test(password),
      });
    }

    if (policy.requireNumbers) {
      checks.push({
        key: "numbers",
        label: t("numbers"),
        met: /[0-9]/.test(password),
      });
    }

    if (policy.requiredSpecialChars) {
      checks.push({
        key: "specialChars",
        label: t("specialChars", { chars: policy.requiredSpecialChars }),
        met: [...policy.requiredSpecialChars].some((c) => password.includes(c)),
      });
    }

    return checks;
  }, [password, policy, t]);

  // Don't render anything if password is empty
  if (!password) return null;

  const segmentCount = 4;
  const filledCount = score; // score 0=0 filled, 1=1, 2=2, 3=3, 4=4

  return (
    <div className="space-y-2 mt-2">
      {/* Segmented strength bar (D-09) */}
      <div className="flex gap-1">
        {Array.from({ length: segmentCount }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full transition-colors ${
              i < filledCount ? SCORE_COLORS[score] : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Score label */}
      <p className="text-sm text-muted-foreground">{t(SCORE_LABELS[score])}</p>

      {/* zxcvbn feedback warning (show when score <= 1) */}
      {feedback && score <= 1 && (
        <p className="text-sm text-destructive">{feedback}</p>
      )}

      {/* Policy requirements checklist (D-10) */}
      {requirements.length > 0 && (
        <ul className="space-y-1">
          {requirements.map((req) => (
            <li key={req.key} className="flex items-center gap-2 text-sm">
              {req.met ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              )}
              <span
                className={
                  req.met ? "text-muted-foreground" : "text-foreground"
                }
              >
                {req.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
