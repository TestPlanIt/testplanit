import React, { useState, useEffect } from "react";
import { cn, type ClassValue } from "~/utils";
import { useTranslations } from "next-intl";

interface LoadingSpinnerProps {
  className?: ClassValue;
  delay?: number; // Delay in milliseconds before showing spinner
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  className,
  delay = 500,
}) => {
  const t = useTranslations("common");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  if (!show) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex justify-center items-center w-full h-full",
        className
      )}
      data-testid="loading-spinner"
    >
      <div className="flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-spin"
          role="status"
          aria-live="polite"
        >
          <title>{t("loading")}</title>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    </div>
  );
};

export default LoadingSpinner;
