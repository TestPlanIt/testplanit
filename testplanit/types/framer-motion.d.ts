// Type augmentation for framer-motion v12 with React 19
// See: https://github.com/framer/motion/issues/2900
import type { HTMLMotionProps as OriginalHTMLMotionProps } from "framer-motion";

declare module "framer-motion" {
  export interface HTMLMotionProps<T extends keyof HTMLElementTagNameMap>
    extends OriginalHTMLMotionProps<T> {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
    variants?: unknown;
    whileHover?: unknown;
    whileTap?: unknown;
    whileFocus?: unknown;
    whileDrag?: unknown;
    whileInView?: unknown;
    layout?: boolean | "position" | "size";
    layoutId?: string;
  }
}

declare module "motion/react-client" {
  import type { ForwardRefExoticComponent, RefAttributes } from "react";

  interface MotionProps {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
    variants?: unknown;
    whileHover?: unknown;
    whileTap?: unknown;
    whileFocus?: unknown;
    whileDrag?: unknown;
    whileInView?: unknown;
    layout?: boolean | "position" | "size";
    layoutId?: string;
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    [key: string]: unknown;
  }

  export const div: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLDivElement>
  >;
  export const span: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLSpanElement>
  >;
  export const button: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLButtonElement>
  >;
  export const a: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLAnchorElement>
  >;
  export const ul: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLUListElement>
  >;
  export const li: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLLIElement>
  >;
  export const img: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLImageElement>
  >;
  export const section: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const article: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const nav: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const header: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const footer: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const main: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLElement>
  >;
  export const p: ForwardRefExoticComponent<
    MotionProps & RefAttributes<HTMLParagraphElement>
  >;
}
