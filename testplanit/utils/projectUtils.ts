import {
  Prisma,
  Projects,
  User,
  MilestoneTypesAssignment,
} from "@prisma/client";
import { MilestonesWithTypes } from "@/components/tables/MilestoneListDisplay";

// Define the expected input type based on the Prisma query includes
// Make this more comprehensive based on admin/projects/page.tsx includes
type ProjectWithAdminDataInput = Prisma.ProjectsGetPayload<{
  include: {
    // Includes from admin/projects/page.tsx
    creator: true;
    icon: true;
    milestones: {
      include: { milestoneType: { include: { icon: true } } };
    };
    milestoneTypes: true;
    projectIntegrations: {
      include: { integration: true };
    };
    assignedUsers: { select: { userId: true; projectId: true } }; // Keep projectId if needed
    groupPermissions: {
      select: {
        accessType: true;
        group: { select: { assignedUsers: { select: { userId: true } } } };
      };
    };
    _count: {
      select: {
        milestones: true;
        testRuns: true;
        sessions: true;
        repositoryCases: true;
        issues: true;
      };
    };
  };
}>;

// Define the output type, adding the effective users list
// Ensure this aligns with ExtendedProjects in admin/projects/columns.tsx
export type ProcessedProject = ProjectWithAdminDataInput & {
  effectiveUserIds: string[]; // Field added by the processing logic
  // Ensure all fields from ExtendedProjects are accounted for here or in ProjectWithAdminDataInput
  // Explicitly type fields if necessary to match ExtendedProjects
  creator: User; // Assuming creator is always fetched and non-null based on include: true
  assignedUsers: { userId: string; projectId: number }[]; // Match the actual select
  milestones: MilestonesWithTypes[]; // Use the imported or defined type
  milestoneTypes: MilestoneTypesAssignment[];
  projectIntegrations?: any[]; // Match ExtendedProjects
};

/**
 * Processes raw project data to calculate and add effective members list.
 *
 * Rules:
 * - NO_ACCESS: Only explicitly assigned users (via direct assignment or groups)
 * - GLOBAL_ROLE: All active users except those with access === 'NONE'
 * - SPECIFIC_ROLE: All active users except those with access === 'NONE'
 *
 * @param projectsRaw - Array of projects fetched with specific includes.
 * @param allUsers - Array of all active users with their access level.
 * @returns Array of projects conforming to ProcessedProject type.
 */
export function processProjectsWithEffectiveMembers(
  projectsRaw: ProjectWithAdminDataInput[] | undefined,
  allUsers?: { id: string; access: string | null }[]
): ProcessedProject[] {
  if (!projectsRaw) {
    return [];
  }

  return projectsRaw.map((project) => {
    // Ensure project is treated as the correct input type within the map
    const typedProject = project as ProjectWithAdminDataInput;

    const directUserIds = new Set(
      typedProject.assignedUsers.map((a) => a.userId)
    );
    const groupUserIds = new Set<string>();

    typedProject.groupPermissions?.forEach((perm) => {
      // Only include users from groups that have access (not NO_ACCESS)
      if ((perm as any).accessType !== 'NO_ACCESS') {
        perm.group?.assignedUsers?.forEach((assignment) => {
          groupUserIds.add(assignment.userId);
        });
      }
    });

    // Include users based on default access type
    const defaultAccessUserIds = new Set<string>();

    // For GLOBAL_ROLE or SPECIFIC_ROLE: include ALL active users except those with access === 'NONE'
    if (
      ((typedProject as any).defaultAccessType === 'GLOBAL_ROLE' ||
       (typedProject as any).defaultAccessType === 'SPECIFIC_ROLE') &&
      allUsers
    ) {
      allUsers.forEach((user) => {
        // Exclude users with access === 'NONE'
        if (user.access !== 'NONE') {
          defaultAccessUserIds.add(user.id);
        }
      });
    }

    const effectiveUserIds = Array.from(
      new Set([...directUserIds, ...groupUserIds, ...defaultAccessUserIds])
    );

    // Construct the final object matching ProcessedProject
    return {
      ...typedProject,
      effectiveUserIds,
      // Map effectiveUserIds to the specific format needed if different, but `users` prop handles this now
      // effectiveUsersForCard: effectiveUserIds.map(id => ({ userId: id })),
      // Ensure all required fields for ProcessedProject are present
      // Casts might be needed if Prisma types don't perfectly align initially
      milestones: typedProject.milestones as MilestonesWithTypes[],
      assignedUsers: typedProject.assignedUsers, // Pass the fetched structure
    } as ProcessedProject; // Assert the final type
  });
}
