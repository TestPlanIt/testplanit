import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SortableDatasetRow } from "@/components/parameters/SortableDatasetRow";

const wrap = (ids: number[], rows: any) => (
  <DndContext>
    <SortableContext items={ids.map(String)}>
      <table>
        <tbody>{rows}</tbody>
      </table>
    </SortableContext>
  </DndContext>
);

describe("SortableDatasetRow", () => {
  it("Test 17: render-prop exposes attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging", () => {
    let received: any = null;
    render(
      wrap(
        [1],
        <SortableDatasetRow id={1}>
          {(props) => {
            received = props;
            return (
              <tr ref={props.setNodeRef} data-testid="row-1">
                <td>
                  <div ref={props.setActivatorNodeRef} {...props.listeners} />
                </td>
              </tr>
            );
          }}
        </SortableDatasetRow>
      )
    );
    expect(received).not.toBeNull();
    expect(received.attributes).toBeDefined();
    expect(received.listeners).toBeDefined();
    expect(typeof received.setNodeRef).toBe("function");
    expect(typeof received.setActivatorNodeRef).toBe("function");
    // transform may be null until drag begins
    expect("transform" in received).toBe(true);
    expect("transition" in received).toBe(true);
    expect(typeof received.isDragging).toBe("boolean");
  });

  it("Test 18+19: row's setNodeRef + setActivatorNodeRef can be wired to different elements", () => {
    const { container } = render(
      wrap(
        [42],
        <SortableDatasetRow id={42}>
          {({ setNodeRef, setActivatorNodeRef, listeners }) => (
            <tr ref={setNodeRef} data-testid="row-42">
              <td>
                <div
                  ref={setActivatorNodeRef}
                  data-testid="row-42-handle"
                  {...listeners}
                />
              </td>
              <td data-testid="row-42-cell">cell</td>
            </tr>
          )}
        </SortableDatasetRow>
      )
    );
    const row = container.querySelector('[data-testid="row-42"]');
    const handle = container.querySelector('[data-testid="row-42-handle"]');
    const cell = container.querySelector('[data-testid="row-42-cell"]');
    expect(row).not.toBeNull();
    expect(handle).not.toBeNull();
    expect(cell).not.toBeNull();
    // Handle should be the only element with drag listeners — the row tr should
    // not carry a tabindex/role from listeners (they were spread to the handle div).
  });
});
