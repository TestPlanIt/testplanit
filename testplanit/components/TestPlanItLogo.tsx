import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { useId } from "react";
import loaderDark from "~/public/tpi_loading_dark.webp";
import loaderLight from "~/public/tpi_loading_light.webp";
import { cn } from "~/utils";

// Geometry from assets/brand/*.svg. Light themes draw the primary logo
// (purple mark, purple-grey wordmark); dark themes draw the on-dark logo
// (light purple mark, white wordmark).
const MARK_COLOR = "text-[#8559E9] dark:text-[#A98BF5]";
const WORDMARK_COLOR = "text-[#4B445B] dark:text-white";

const WORDMARK_PATH =
  "M544 -698V-585H358V0H218V-585H32V-698ZM1037 -235H632Q637 -175 674 -141Q711 -107 765 -107Q843 -107 876 -174H1027Q1003 -94 935 -42Q867 9 768 9Q688 9 624 -26Q561 -62 526 -127Q490 -192 490 -277Q490 -363 525 -428Q560 -493 623 -528Q686 -563 768 -563Q847 -563 910 -529Q972 -495 1006 -432Q1041 -370 1041 -289Q1041 -259 1037 -235ZM896 -329Q895 -383 857 -416Q819 -448 764 -448Q712 -448 676 -416Q641 -385 633 -329ZM1093 -175H1234Q1238 -143 1266 -122Q1293 -101 1334 -101Q1374 -101 1396 -117Q1419 -133 1419 -158Q1419 -185 1392 -198Q1364 -212 1304 -228Q1242 -243 1202 -259Q1163 -275 1134 -308Q1106 -341 1106 -397Q1106 -443 1132 -481Q1159 -519 1208 -541Q1258 -563 1325 -563Q1424 -563 1483 -514Q1542 -464 1548 -380H1414Q1411 -413 1386 -432Q1362 -452 1321 -452Q1283 -452 1262 -438Q1242 -424 1242 -399Q1242 -371 1270 -356Q1298 -342 1357 -327Q1417 -312 1456 -296Q1495 -280 1524 -246Q1552 -213 1553 -158Q1553 -110 1526 -72Q1500 -34 1450 -12Q1401 9 1335 9Q1267 9 1213 -16Q1159 -40 1128 -82Q1096 -124 1093 -175ZM1781 -439V-171Q1781 -143 1794 -130Q1808 -118 1840 -118H1905V0H1817Q1640 0 1640 -172V-691H1781V-554H1905V-439ZM2243 -268H2126V0H1986V-698H2243Q2324 -698 2381 -670Q2438 -642 2466 -593Q2495 -544 2495 -482Q2495 -426 2468 -377Q2442 -328 2386 -298Q2329 -268 2243 -268ZM2351 -482Q2351 -584 2237 -584H2126V-381H2237Q2295 -381 2323 -408Q2351 -434 2351 -482ZM2715 -691V-171Q2715 -143 2728 -130Q2742 -118 2774 -118H2839V0H2751Q2574 0 2574 -172V-691ZM3270 0V-111L3262 -135V-330Q3262 -385 3228 -415Q3195 -446 3127 -446Q3081 -446 3037 -432Q2993 -417 2962 -393L2909 -493Q2954 -526 3016 -544Q3079 -561 3145 -561Q3268 -561 3335 -503Q3402 -444 3402 -322V0ZM3098 7Q3034 7 2988 -14Q2941 -36 2916 -73Q2891 -111 2891 -159Q2891 -207 2914 -244Q2937 -281 2989 -303Q3040 -324 3124 -324H3280V-236H3136Q3073 -236 3051 -215Q3029 -195 3029 -165Q3029 -131 3055 -112Q3082 -92 3129 -92Q3174 -92 3210 -112Q3246 -133 3262 -174L3285 -97Q3266 -47 3219 -20Q3171 7 3098 7ZM4045 -325V0H3905V-306Q3905 -372 3872 -408Q3839 -443 3782 -443Q3724 -443 3691 -408Q3657 -372 3657 -306V0H3517V-554H3657V-485Q3685 -521 3729 -542Q3772 -562 3824 -562Q3923 -562 3984 -500Q4045 -437 4045 -325ZM4298 -698V0H4158V-698ZM4549 -439V-171Q4549 -143 4563 -130Q4576 -118 4608 -118H4673V0H4585Q4408 0 4408 -172V-691H4549V-554H4673V-439Z";

function useMaskId() {
  return `tpi-mark-${useId().replace(/[^\w-]/g, "")}`;
}

/** The planet, in the mark's own 120x120 space. */
function MarkShapes({ maskId }: { maskId: string }) {
  return (
    <>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="120"
          height="120"
        >
          <rect width="120" height="120" fill="#fff" />
          <path
            d="M8 60A52 11 0 0 0 112 60"
            transform="rotate(-30 60 60)"
            fill="none"
            stroke="#000"
            strokeWidth="19"
          />
        </mask>
      </defs>
      <circle
        cx="60"
        cy="60"
        r="30"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <path
        d="M60 49A52 11 0 1 0 112 60"
        transform="rotate(-30 60 60)"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </>
  );
}

/** The horizontal logo: mark and wordmark. Size it with a height class. */
export function TestPlanItLogo({ className }: { className?: string }) {
  const t = useTranslations();
  const maskId = useMaskId();

  return (
    <svg
      viewBox="0 -929 6729 1160"
      role="img"
      aria-label={t("common.branding.logoAlt")}
      className={cn("block h-8 w-auto shrink-0", className)}
    >
      <g
        transform="translate(0 -929) scale(17.57) translate(-8 -27)"
        className={MARK_COLOR}
      >
        <MarkShapes maskId={maskId} />
      </g>
      <path
        transform="translate(2056 0)"
        fill="currentColor"
        className={WORDMARK_COLOR}
        d={WORDMARK_PATH}
      />
    </svg>
  );
}

/** The mark on its own, for places too small for the full logo. */
export function TestPlanItMark({ className }: { className?: string }) {
  const t = useTranslations();
  const maskId = useMaskId();

  return (
    <svg
      viewBox="8 27 104 66"
      role="img"
      aria-label={t("common.branding.logoAlt")}
      className={cn("block h-auto w-8 shrink-0", MARK_COLOR, className)}
    >
      <MarkShapes maskId={maskId} />
    </svg>
  );
}

// Background images rather than <img>s, so only the active theme's file loads.
const animatedMarkImages = {
  "--tpi-loader-light": `url(${loaderLight.src})`,
  "--tpi-loader-dark": `url(${loaderDark.src})`,
} as CSSProperties;

/**
 * The orbiting-planet animation, decorative. Size it with a width class.
 * Users who prefer reduced motion get the static mark.
 */
export function TestPlanItAnimatedMark({ className }: { className?: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        style={animatedMarkImages}
        className={cn(
          "aspect-[82/53] w-[41px] shrink-0 bg-contain bg-no-repeat bg-[image:var(--tpi-loader-light)] dark:bg-[image:var(--tpi-loader-dark)] motion-reduce:hidden",
          className
        )}
      />
      <div aria-hidden="true" className="hidden motion-reduce:block">
        <TestPlanItMark className={cn("w-[40px]", className)} />
      </div>
    </>
  );
}
