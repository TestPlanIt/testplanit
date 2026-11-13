import { TestPlanItMark } from "@/components/TestPlanItLogo";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import loaderDark from "~/public/tpi_loading_dark.webp";
import loaderLight from "~/public/tpi_loading_light.webp";

// Background images rather than <img>s, so only the active theme's file loads.
const loaderImages = {
  "--tpi-loader-light": `url(${loaderLight.src})`,
  "--tpi-loader-dark": `url(${loaderDark.src})`,
} as CSSProperties;

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
      <div
        aria-hidden="true"
        style={loaderImages}
        className="aspect-[82/53] w-[41px] bg-contain bg-no-repeat bg-[image:var(--tpi-loader-light)] dark:bg-[image:var(--tpi-loader-dark)] motion-reduce:hidden"
      />
      <div aria-hidden="true" className="hidden motion-reduce:block">
        <TestPlanItMark className="w-[40px]" />
      </div>
      <span>{tGlobal("common.loading")}</span>
    </div>
  );
}
