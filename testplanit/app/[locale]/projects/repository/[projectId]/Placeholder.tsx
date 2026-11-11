export const Placeholder = (props: any) => (
  <div
    className="absolute end-0 top-0 h-0.5 -translate-y-1/2 transform bg-primary"
    style={{ left: props.depth * 24 }}
    data-testid="placeholder"
  ></div>
);
