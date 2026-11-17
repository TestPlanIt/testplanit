import { TestPlanItAnimatedMark } from "@/components/TestPlanItLogo";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function Loading({ delay = 300 }: { delay?: number }) {
  const tGlobal = useTranslations();
  const [show, setShow] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) return;
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!show) return null;

  return (
    <div
      role="status"
      className="flex justify-center items-center gap-2 min-h-screen -mt-12"
      data-testid="loading-indicator"
    >
      <TestPlanItAnimatedMark />
      <span>{tGlobal("common.loading")}</span>
    </div>
  );
}
