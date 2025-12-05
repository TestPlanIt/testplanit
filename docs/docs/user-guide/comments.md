---
sidebar_position: 16
title: Comments & Mentions
---

# Comments & Mentions

TestPlanIt's commenting system enables team collaboration by allowing users to add contextual comments and discussions directly on test cases, test runs, exploratory sessions, and milestones. The mention feature ensures the right team members are notified about important discussions.

## Overview

Comments provide:

- **Contextual Discussions** - Add notes and discussions directly on test items
- **User Mentions** - Notify specific team members using @ mentions
- **Edit History** - Track when comments are modified
- **Access Control** - Comments inherit project permissions
- **Notifications** - Mentioned users receive notifications

## Where Comments Are Available

Comments can be added to:

- **Test Cases** - In the repository, on individual test case details pages
- **Test Runs** - On test run overview and details pages
- **Exploratory Sessions** - On session details pages
- **Milestones** - On milestone details pages

## Adding Comments

### Creating a New Comment

1. Navigate to a test case, test run, session, or milestone
2. Scroll to the **Comments** section (usually at the bottom of the page)
3. Click in the comment editor field
4. Type your comment using the rich text editor
5. Optionally mention users (see User Mentions below)
6. Click **Post Comment** to publish

### User Mentions

Mention team members to notify them about your comment:

1. Type `@` in the comment editor
2. A dropdown list of project members appears
3. Start typing a name to filter the list
4. Click a user or press Enter to select
5. The mention appears highlighted in your comment
6. The mentioned user receives a notification

**Example:**

```text
@john.doe - Please review the test results for this scenario.
```

### Placeholder Text

The editor shows: "Write a comment... (use @ to mention users)" when empty, reminding you of the mention functionality.

## Managing Comments

### Viewing Comments

Comments are displayed in chronological order (oldest first) in the Comments section:

- **User Avatar** - Visual identification of the comment author
- **User Name and Email** - Who created the comment
- **Timestamp** - When the comment was posted
- **Edit Indicator** - "(edited)" label if the comment was modified
- **Comment Content** - The formatted comment text with mentions highlighted
- **Action Buttons** - Edit and Delete options (if you have permission)

### Editing Comments

You can edit your own comments:

1. Click the **Edit** button (pencil icon) on your comment
2. The comment editor opens with the existing content
3. Make your changes
4. Click **Save** to update the comment
5. The comment shows an "(edited)" indicator

**Permissions:**

- You can edit your own comments
- Project admins can edit any comment in their projects
- System admins can edit all comments

### Deleting Comments

You can delete your own comments:

1. Click the **Delete** button (trash icon) on your comment
2. Confirm the deletion in the dialog
3. The comment is removed from the thread

**Permissions:**

- You can delete your own comments
- Project admins can delete any comment in their projects
- System admins can delete all comments

:::warning Permanent Action
Deleting a comment is permanent and cannot be undone. The comment content and all mentions are removed.
:::

## Comment Notifications

### Mention Notifications

When you're mentioned in a comment:

1. You receive an **in-app notification** in the notification center
2. Depending on your notification preferences, you may also receive an **email notification**
3. The notification includes:
   - Who mentioned you
   - The comment content preview
   - Which item was commented on (test case, run, session, or milestone)
   - A direct link to the comment

### Notification Settings

Control how you're notified about comments:

1. Navigate to your **User Profile**
2. Go to **Notification Preferences**
3. Configure settings for comment mentions:
   - **Immediate Email** - Receive emails as mentions happen
   - **Daily Digest** - Receive a daily summary of mentions
   - **In-App Only** - Only show notifications in the app
   - **None** - Disable mention notifications

## Comments in Context

### Test Case Comments

Use comments on test cases for:

- **Clarifications** - Ask questions about test steps or expected results
- **Design Discussions** - Discuss test case design and coverage
- **Maintenance Notes** - Document why certain changes were made
- **Review Feedback** - Provide feedback during test case reviews
- **Historical Context** - Preserve knowledge about test rationale

**Example Scenarios:**

- "@qa-lead - Should we add a negative test case for invalid email formats?"
- "Updated this test case to cover the new validation requirements from ticket-123"
- "@developer - Can you clarify the expected behavior when the API times out?"

### Test Run Comments

Use comments on test runs for:

- **Execution Notes** - Document important observations during test execution
- **Blocker Communication** - Alert team members about blockers
- **Results Discussion** - Discuss unexpected results or failures
- **Environment Issues** - Report environment or configuration problems
- **Milestone Updates** - Communicate progress on test milestones

**Example Scenarios:**

- "@manager - 15% of tests are failing due to the database issue. Pausing execution."
- "All payment tests passed successfully. Ready for deployment approval."
- "@devops - Test environment is experiencing performance issues"

### Session Comments

Use comments on exploratory sessions for:

- **Findings Documentation** - Record bugs or issues discovered
- **Coverage Notes** - Document areas explored
- **Questions** - Ask for clarification about unexpected behavior
- **Follow-up Actions** - Propose follow-up test cases or investigations
- **Session Summary** - Summarize key findings at session end

**Example Scenarios:**

- "Found 3 usability issues in the checkout flow - will create formal test cases"
- "@product - Is the slow loading time on the search page expected?"
- "Covered all main user workflows. No critical issues found."

### Milestone Comments

Use comments on milestones for:

- **Progress Updates** - Communicate milestone progress to stakeholders
- **Risk Communication** - Alert team about risks to milestone delivery
- **Scope Discussions** - Discuss milestone scope changes
- **Coordination** - Coordinate between test runs and sessions in a milestone
- **Status Reporting** - Document milestone status changes and reasons

**Example Scenarios:**

- "@project-manager - All test runs are now complete. Ready for sign-off."
- "Adding two additional test runs to cover the new requirements from sprint planning"
- "@qa-team - Please prioritize the payment tests - they're blocking this milestone"
- "Milestone completion delayed due to environment issues. New target: end of week."

## Best Practices

### Writing Effective Comments

1. **Be Specific** - Provide context and details
2. **Use Mentions Wisely** - Only mention users who need to see the comment
3. **Stay Professional** - Keep comments constructive and work-focused
4. **Format for Clarity** - Use lists and formatting to improve readability
5. **Reference Related Items** - Link to tickets, test cases, or issues when relevant

### Comment Organization

1. **One Topic Per Comment** - Keep comments focused on a single topic
2. **Thread Responses** - Add new comments to continue discussions
3. **Update vs. New Comment** - Edit for typos, create new comment for updates
4. **Avoid Duplication** - Read existing comments before adding similar ones
5. **Archive Old Discussions** - Delete or summarize resolved discussions

### Collaboration Etiquette

1. **Response Time** - Respond to mentions within 24 hours
2. **Acknowledge** - Let people know you've seen their mention
3. **Tag Appropriately** - Don't over-mention people unnecessarily
4. **Be Clear** - Use clear language and avoid ambiguity
5. **Follow Up** - Close loops on discussions you start

## Use Cases

### Code Review Collaboration

```text
@sarah - Can you verify the new validation rules in steps 3-5?
They're based on the requirements from epic-456.
```

### Bug Reporting

```text
**Bug Found During Execution:**

- Browser: Chrome 120
- Environment: Staging
- Issue: Payment button does not respond on mobile viewport

@dev-team - Can you investigate? Marking this run as blocked.
```

### Knowledge Sharing

```text
FYI - This test case always fails on first run due to cache warming.
Just re-run it if you see a failure. We've documented this in TECH-789.

@new-team-members - Good to know about this quirk!
```

### Decision Documentation

```text
Decided to split this mega test case into 3 smaller ones for better
maintainability. The split test cases are:
- TC-101: Basic user registration
- TC-102: Email verification flow
- TC-103: Profile completion

@qa-team - Please review the new structure.
```

## Troubleshooting

### Cannot Add Comments

**Possible causes:**

- You don't have write access to the project
- The item is in a read-only state
- Network connectivity issues

**Solutions:**

- Check your project role and permissions
- Contact a project admin for access
- Refresh the page and try again

### Mentions Not Working

**Possible causes:**

- User is not a member of the project
- Typing `@` doesn't trigger the dropdown
- Selected user doesn't receive notifications

**Solutions:**

- Ensure the user is assigned to the project
- Click directly in the editor and type `@` followed by a name
- Check the user's notification preferences
- Verify the user's email is valid

### Comments Not Loading

**Possible causes:**

- Slow network connection
- Large number of comments
- Browser caching issues

**Solutions:**

- Wait for the loading indicator to complete
- Refresh the browser page
- Clear browser cache if issues persist

## Security and Privacy

### Access Control

- Comments inherit the access control of their parent item
- You can only view comments on items you have access to
- Deleted users' comments remain but show as "[Deleted User]"

### Data Retention

- Comments are stored permanently unless explicitly deleted
- Edit history is tracked but previous versions are not stored
- Deleted comments are permanently removed from the database

### Audit Trail

- Comment creation, editing, and deletion events are logged
- Timestamps track when each action occurred
- Administrators can review comment activity in audit logs

## API Reference

For developers integrating with TestPlanIt's comment system:

### Get Comments

```http
GET /api/comments/{entityType}/{entityId}
```

### Create Comment

```http
POST /api/comments
Content-Type: application/json

{
  "projectId": 123,
  "entityType": "repositoryCase",
  "entityId": 456,
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Comment text here" }
        ]
      }
    ]
  },
  "mentionedUserIds": ["user-id-1", "user-id-2"]
}
```

### Update Comment

```http
PUT /api/comments/{commentId}
Content-Type: application/json

{
  "content": { /* TipTap JSON format */ },
  "mentionedUserIds": ["user-id-1"]
}
```

### Delete Comment

```http
DELETE /api/comments/{commentId}
```

---

**Related Documentation:**

- [Notifications](./notifications.md) - Configure notification preferences
- [User Profile](./user-profile.md) - Manage your profile settings
- [Projects](./projects.md) - Understanding project access control
