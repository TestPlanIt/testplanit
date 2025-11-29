# Comments System

A comprehensive commenting system for Repository Cases, Test Runs, and Sessions with user mention functionality.

## Features

- **TipTap Rich Text Editor**: Comments are stored in TipTap (Prose Mirror) JSON format
- **User Mentions**: Mention any user with @ symbol, even non-project members
- **Visual Indicators**:
  - Project members appear with blue highlighting
  - Non-members appear with orange highlighting
  - Deleted/inactive users show as "<deleted user>"
- **Notifications**: Mentioned users receive notifications via the existing notification system
- **Access Control**: Comments inherit access control from their parent project
- **Edit & Delete**: Users can edit their own comments and delete their own comments (admins can delete any)
- **Soft Deletes**: Comments are soft-deleted for audit trail

## Database Schema

### Comment Model
```prisma
model Comment {
  id               String           @id @default(cuid())
  content          Json             // TipTap JSON format
  projectId        Int
  project          Projects         @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // Polymorphic relationship - one of these will be set
  repositoryCaseId Int?
  repositoryCase   RepositoryCases? @relation(fields: [repositoryCaseId], references: [id], onDelete: Cascade)
  testRunId        Int?
  testRun          TestRuns?        @relation(fields: [testRunId], references: [id], onDelete: Cascade)
  sessionId        Int?
  session          Sessions?        @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  creatorId        String
  creator          User             @relation("CommentCreator", fields: [creatorId], references: [id])
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  isEdited         Boolean          @default(false)
  isDeleted        Boolean          @default(false)

  mentionedUsers   CommentMention[]
}
```

### CommentMention Model
```prisma
model CommentMention {
  id        String   @id @default(cuid())
  commentId String
  comment   Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("CommentMentions", fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([commentId, userId])
  @@index([userId, createdAt])  // Fast "mentions of me" lookup
  @@index([commentId])
}
```

## Components

### CommentsSection
Main container component that fetches and displays comments.

```tsx
import { CommentsSection } from "~/components/comments/CommentsSection";

<CommentsSection
  projectId={project.id}
  entityType="repositoryCase" // or "testRun" or "session"
  entityId={case.id}
  currentUserId={session.user.id}
  isAdmin={session.user.access === "ADMIN"}
/>
```

### CommentList
Displays list of comments and handles creating new comments.

### CommentItem
Individual comment with edit/delete functionality.

### CommentEditor
TipTap editor with mention functionality for creating/editing comments.

### MentionSuggestion
Dropdown suggestion list when typing @ to mention users.

## Server Actions

### createComment
```typescript
import { createComment } from "~/app/actions/comments";

const result = await createComment({
  content: tipTapJSON,
  projectId: 123,
  repositoryCaseId: 456, // or testRunId or sessionId
});
```

### updateComment
```typescript
import { updateComment } from "~/app/actions/comments";

const result = await updateComment({
  commentId: "comment-id",
  content: updatedTipTapJSON,
});
```

### deleteComment
```typescript
import { deleteComment } from "~/app/actions/comments";

const result = await deleteComment("comment-id");
```

### getCommentsForEntity
```typescript
import { getCommentsForEntity } from "~/app/actions/comments";

const result = await getCommentsForEntity("repositoryCase", 456);
```

## API Endpoints

### Search Users for Mentions
```
GET /api/users/search-for-mentions?q=john&projectId=123
```

Returns users matching the search query with information about whether they're project members.

### Get User Mention Info
```
GET /api/users/[userId]/mention-info
```

Returns user status (active, deleted) for rendering mentions.

## Services

### CommentService
Handles mention processing, notification creation, and mention record management.

```typescript
import { CommentService } from "~/lib/services/commentService";

// Process mentions and send notifications
await CommentService.processMentions(
  commentId,
  content,
  creatorId,
  creatorName,
  projectId,
  projectName,
  entityType,
  entityName,
  entityId
);

// Create CommentMention records
await CommentService.createCommentMentions(commentId, userIds);

// Remove old mentions (when editing)
await CommentService.removeOldMentions(commentId, currentUserIds);
```

### NotificationService
Extended to support comment mention notifications.

## Utilities

### extractMentionedUserIds
Recursively extracts user IDs from TipTap JSON content.

```typescript
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";

const userIds = extractMentionedUserIds(tipTapContent);
// Returns: ["user-id-1", "user-id-2"]
```

### isValidTipTapContent
Validates TipTap JSON structure.

```typescript
import { isValidTipTapContent } from "~/lib/utils/tiptapMentions";

if (isValidTipTapContent(content)) {
  // Content is valid
}
```

### createEmptyTipTapDoc
Creates an empty TipTap document structure.

## Integration Examples

### Repository Case Detail Page

```tsx
import { CommentsSection } from "~/components/comments/CommentsSection";
import { getServerAuthSession } from "~/server/auth";

export default async function CaseDetailPage({ params }) {
  const session = await getServerAuthSession();
  const caseData = await getCaseData(params.caseId);

  return (
    <div>
      {/* Case details */}
      <h1>{caseData.name}</h1>

      {/* Comments section */}
      <div className="mt-8">
        <CommentsSection
          projectId={caseData.projectId}
          entityType="repositoryCase"
          entityId={caseData.id}
          currentUserId={session.user.id}
          isAdmin={session.user.access === "ADMIN"}
        />
      </div>
    </div>
  );
}
```

### Test Run Detail Page

```tsx
<CommentsSection
  projectId={testRun.projectId}
  entityType="testRun"
  entityId={testRun.id}
  currentUserId={session.user.id}
  isAdmin={session.user.access === "ADMIN"}
/>
```

### Session Detail Page

```tsx
<CommentsSection
  projectId={session.projectId}
  entityType="session"
  entityId={session.id}
  currentUserId={session.user.id}
  isAdmin={session.user.access === "ADMIN"}
/>
```

## Internationalization

All comment UI text uses the `comments` translation key:

```json
{
  "comments": {
    "title": "Comments",
    "placeholder": "Write a comment... (use @ to mention users)",
    "editPlaceholder": "Edit your comment...",
    "postComment": "Post Comment",
    "noComments": "No comments yet. Be the first to comment!",
    "edited": "edited",
    "confirmDelete": "Are you sure you want to delete this comment?",
    "errors": {
      "createFailed": "Failed to create comment",
      "updateFailed": "Failed to update comment",
      "deleteFailed": "Failed to delete comment",
      "loadFailed": "Failed to load comments"
    },
    "mentions": {
      "notAMember": "This user is not a member of the project",
      "inactive": "This user is no longer active",
      "noUsersFound": "No users found"
    }
  }
}
```

## Styling

Import the mention styles in your app:

```tsx
import "~/styles/tiptap-mentions.css";
```

The styles handle:
- Project member mentions (blue)
- Non-member mentions (orange)
- Inactive/deleted user mentions (gray with strikethrough)
- Suggestion dropdown styling

## Notifications

When a user is mentioned in a comment:

1. **With Project Access**: Notification includes link to comment, shows full message
2. **Without Project Access**: Notification has no link, shows message about inaccessible project

Notification data includes:
```typescript
{
  commentId: string;
  creatorId: string;
  creatorName: string;
  projectId: number;
  projectName: string;
  entityType: "RepositoryCase" | "TestRun" | "Session";
  entityName: string;
  entityId: string;
  hasProjectAccess: boolean;
}
```

## Access Control

Comments inherit access control from their parent project:

- **Read**: Same as project read access
- **Create**: Same as project read access (anyone who can view can comment)
- **Update**: Only comment creator, not deleted
- **Delete**: Comment creator or system admin

## Performance Considerations

1. **Mention Lookup**: `CommentMention` table with `userId` index for fast "mentions of me" queries
2. **Entity Filtering**: Indexes on `repositoryCaseId`, `testRunId`, `sessionId`
3. **Project Filtering**: Index on `projectId` and `isDeleted`
4. **Lazy Loading**: Comments loaded on-demand when viewing entity
5. **Optimistic Updates**: UI updates immediately, syncs with server

## Future Enhancements

Potential additions (not yet implemented):

1. **Reactions**: Like/emoji reactions to comments
2. **Edit History**: Track all edits to comments
3. **Threading**: Reply to specific comments
4. **Attachments**: Attach files to comments
5. **Search**: Full-text search across comments
6. **@all**: Mention all project members
7. **Real-time**: WebSocket updates for live collaboration
8. **Comment Templates**: Predefined comment templates
9. **Comment Pinning**: Pin important comments to top
10. **Comment Resolution**: Mark comments as resolved

## Troubleshooting

### Mentions not showing in dropdown
- Check `/api/users/search-for-mentions` is returning data
- Verify `projectId` is correct
- Check browser console for errors

### Comments not saving
- Verify user has project access
- Check TipTap content is valid JSON
- Ensure exactly one entity ID is provided

### Notifications not sent
- Check notification queue is running
- Verify `notificationQueue` is available
- Check user has valid email (if email notifications enabled)

### Styles not applying
- Ensure `tiptap-mentions.css` is imported
- Check Tailwind classes are properly configured
- Verify dark mode classes if using dark theme
