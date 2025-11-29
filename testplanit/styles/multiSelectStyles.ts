export const getCustomStyles = ({ theme = "light" }: { theme?: string }) => ({
  control: (provided: any, state: { isFocused: boolean }) => ({
    ...provided,
    backgroundColor: "hsl(var(--background))",
    borderColor: state.isFocused
      ? "hsl(var(--ring))"
      : "hsl(var(--border))",
    boxShadow: state.isFocused ? "0 0 0 2px hsl(var(--ring) / 0.2)" : "none",
    "&:hover": {
      borderColor: state.isFocused
        ? "hsl(var(--ring))"
        : "hsl(var(--border))",
    },
    borderRadius: "calc(var(--radius) - 2px)",
    color: "hsl(var(--foreground))",
  }),
  menu: (provided: any) => ({
    ...provided,
    backgroundColor: "hsl(var(--popover))",
    borderRadius: "calc(var(--radius) - 2px)",
    border: "1px solid hsl(var(--border))",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
    zIndex: 9999,
  }),
  menuPortal: (provided: any) => ({
    ...provided,
    zIndex: 9999,
  }),
  option: (
    provided: any,
    state: { isSelected: boolean; isFocused: boolean }
  ) => ({
    ...provided,
    backgroundColor: state.isSelected
      ? "hsl(var(--primary))"
      : state.isFocused
        ? "hsl(var(--accent))"
        : "transparent",
    color: state.isSelected 
      ? "hsl(var(--primary-foreground))"
      : "hsl(var(--popover-foreground))",
    "&:active": {
      backgroundColor: "hsl(var(--primary) / 0.9)",
      color: "hsl(var(--primary-foreground))",
    },
    cursor: "pointer",
  }),
  multiValue: (provided: any) => ({
    ...provided,
    backgroundColor: "hsl(var(--secondary))",
    borderRadius: "calc(var(--radius) - 4px)",
  }),
  multiValueLabel: (provided: any) => ({
    ...provided,
    color: "hsl(var(--secondary-foreground))",
  }),
  multiValueRemove: (provided: any) => ({
    ...provided,
    color: "hsl(var(--secondary-foreground))",
    "&:hover": {
      backgroundColor: "hsl(var(--destructive))",
      color: "hsl(var(--destructive-foreground))",
      borderRadius: "calc(var(--radius) - 4px)",
    },
    cursor: "pointer",
  }),
  input: (provided: any) => ({
    ...provided,
    color: "hsl(var(--foreground))",
  }),
  placeholder: (provided: any) => ({
    ...provided,
    color: "hsl(var(--muted-foreground))",
  }),
  singleValue: (provided: any) => ({
    ...provided,
    color: "hsl(var(--foreground))",
  }),
  indicatorSeparator: (provided: any) => ({
    ...provided,
    backgroundColor: "hsl(var(--border))",
  }),
  dropdownIndicator: (provided: any, state: { isFocused: boolean }) => ({
    ...provided,
    color: state.isFocused
      ? "hsl(var(--foreground))"
      : "hsl(var(--muted-foreground))",
    "&:hover": {
      color: "hsl(var(--foreground))",
    },
  }),
  clearIndicator: (provided: any, state: { isFocused: boolean }) => ({
    ...provided,
    color: state.isFocused
      ? "hsl(var(--foreground))"
      : "hsl(var(--muted-foreground))",
    "&:hover": {
      color: "hsl(var(--destructive))",
    },
    cursor: "pointer",
  }),
  loadingIndicator: (provided: any) => ({
    ...provided,
    color: "hsl(var(--primary))",
  }),
  noOptionsMessage: (provided: any) => ({
    ...provided,
    color: "hsl(var(--muted-foreground))",
  }),
  groupHeading: (provided: any) => ({
    ...provided,
    color: "hsl(var(--muted-foreground))",
    fontSize: "0.75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    backgroundColor: "hsl(var(--popover))",
    paddingLeft: "12px",
    paddingRight: "12px",
  }),
});
