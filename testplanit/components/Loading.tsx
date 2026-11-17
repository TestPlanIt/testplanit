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

  // Next scrolls a new page to the top by measuring what the page first
  // renders. Rendering nothing here leaves it nothing to measure, and the
  // page keeps the previous page's scroll position.
  if (!show) return <div className="-mt-12 min-h-screen" />;

  return (
    <div
      role="status"
      className="-mt-12 flex min-h-screen items-center justify-center gap-2"
      data-testid="loading-indicator"
    >
      <TestPlanItAnimatedMark />
      <span>{tGlobal("common.loading")}</span>
    </div>
  );
}
