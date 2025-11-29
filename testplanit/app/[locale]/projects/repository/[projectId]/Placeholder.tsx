export const Placeholder = (props: any) => (
  <div
    className="bg-primary h-0.5 absolute right-0 transform -translate-y-1/2 top-0"
    style={{ left: props.depth * 24 }}
    data-testid="placeholder"
  ></div>
);
