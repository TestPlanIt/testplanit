import React from "react";
import { cn, type ClassValue } from "~/utils";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface LoadingSpinnerProps {
  className?: ClassValue;
  message?: string;
}

const LoadingSpinnerAlert: React.FC<LoadingSpinnerProps> = ({
  className,
  message,
}) => {
  const t = useTranslations();

  return (
    <AlertDialog defaultOpen={true} data-testid="loading-spinner-alert">
      <AlertDialogTitle className="sr-only">
        {t("common.loading")}
      </AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        {t("common.loading")}
      </AlertDialogDescription>
      <AlertDialogContent className="bg-transparent border-0 border-transparent">
        <div className="flex justify-center items-center min-h-screen">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "flex items-center justify-center text-primary",
                className
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="120"
                height="120"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-spin"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
            {message && (
              <div className="text-center text-primary font-semibold mt-4 text-lg">
                {message}
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default LoadingSpinnerAlert;
