import Image from "next/image";
import { motion } from "framer-motion";
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
        <motion.div
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
        </motion.div>
        <Separator orientation="vertical" className="px-1" />
        <motion.div
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
        </motion.div>
      </div>
    </div>
  );
}
