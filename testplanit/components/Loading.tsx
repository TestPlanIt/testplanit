import Image from "next/image";
import { div as MotionDiv } from "motion/react-client";
import { Separator } from "@/components/ui/separator";
import svgIcon from "~/public/tpi_logo.svg";
import { useTranslations } from "next-intl";

export function Loading() {
  const tGlobal = useTranslations();

  return (
    <div
      className="flex justify-center items-center min-h-screen -mt-12"
      data-testid="loading-indicator"
    >
      <div className="flex items-center">
        <MotionDiv
          animate={{
            x: [-20, 20, -20],
            rotate: [0, 360, 0],
          }}
          transition={{
            duration: 2,
            ease: "easeInOut",
            repeat: Infinity,
          }}
        >
          <Image
            alt={tGlobal("common.branding.logoAlt")}
            src={svgIcon}
            width={25}
            priority={true}
          />
        </MotionDiv>
        <Separator orientation="vertical" className="px-1" />
        <MotionDiv
          initial={{ x: 0 }}
          animate={{
            x: [0, 0, 0, 50, 0],
          }}
          transition={{
            duration: 2,
            ease: "easeInOut",
            times: [0, 0.15, 0.35, 0.51, 1],
            repeat: Infinity,
          }}
        >
          {tGlobal("common.loading")}
        </MotionDiv>
      </div>
    </div>
  );
}
