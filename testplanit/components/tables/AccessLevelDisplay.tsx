interface AccessLevelCellProps {
  accessLevel: string;
}

export const AccessLevelDisplay: React.FC<AccessLevelCellProps> = ({
  accessLevel,
}) => {
  const prettyAccessName = (accessLevel: string): string => {
    switch (accessLevel) {
      case "ADMIN":
        return "System Admin";
      case "PROJECTADMIN":
        return "Project Admin";
      case "USER":
        return "User";
      case "NONE":
        return "No Access";
      default:
        return "Unknown Access Level";
    }
  };

  return <span>{prettyAccessName(accessLevel)}</span>;
};
