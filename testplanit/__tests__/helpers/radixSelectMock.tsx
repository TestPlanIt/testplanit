/**
 * Shared jsdom stand-in for the shadcn/Radix `Select`.
 *
 * Radix's Select relies on `hasPointerCapture`, which jsdom does not
 * implement, so component specs render a native `<select>` instead. The
 * substitute walks the children to collect `SelectItem` values and forwards
 * the trigger's props (data-testid, aria-label) onto the real element, so a
 * spec can find and drive it exactly as it would the real control.
 *
 * Use from a spec:
 *
 *   vi.mock("@/components/ui/select", async () =>
 *     (await import("~/__tests__/helpers/radixSelectMock")).createSelectMock()
 *   );
 */

import React from "react";

const SelectTriggerSentinel = Symbol("SelectTrigger");
const SelectItemSentinel = Symbol("SelectItem");

export function createSelectMock() {
  function Select({ children, value, onValueChange, disabled }: any) {
    const items: Array<{ value: string; label: React.ReactNode }> = [];
    let triggerProps: Record<string, unknown> = {};

    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child: any) => {
        if (!React.isValidElement(child)) return;
        const elementType: any = (child as any).type;
        const props: any = (child as any).props ?? {};
        if (elementType?.__sentinel === SelectTriggerSentinel) {
          const { children: _c, ...rest } = props;
          triggerProps = rest;
        } else if (elementType?.__sentinel === SelectItemSentinel) {
          items.push({ value: props.value, label: props.children });
        }
        if (props.children) walk(props.children);
      });
    };
    walk(children);

    return (
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...(triggerProps as any)}
      >
        {/* Placeholder slot so an unset value has something to render. */}
        {value ? null : <option value="" />}
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {String(it.label)}
          </option>
        ))}
      </select>
    );
  }

  function SelectTrigger({ children, ...rest }: any) {
    return (
      <span {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectTrigger as any).__sentinel = SelectTriggerSentinel;

  function SelectItem({ value, children, ...rest }: any) {
    return (
      <span value={value} {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectItem as any).__sentinel = SelectItemSentinel;

  return {
    Select,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem,
    SelectTrigger,
    SelectValue: ({ children }: any) => <span>{children}</span>,
  };
}
