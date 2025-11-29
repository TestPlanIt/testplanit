---
sidebar_position: 16
title: System Announcements
---

# System Announcements

System Announcements allow administrators to communicate important information to all users across the TestPlanIt platform. These announcements are delivered through the notification system and appear in users' notification centers for maintenance notifications, feature updates, policy changes, and other organization-wide communications.

## Overview

System Announcements provide:

- **Global messaging** to all platform users
- **Rich text formatting** with images and links using TipTap editor
- **Notification center delivery** for all users
- **Read status tracking** for important messages
- **Notification history** for reviewing past announcements

## Types of Announcements

System announcements can be used for various purposes:

**Critical Communications:**
- System maintenance windows
- Security updates
- Critical bug fixes
- Policy violations
- Emergency notifications

**General Updates:**
- New feature releases
- Training announcements
- Process changes
- Upcoming maintenance

**Informational Messages:**
- Tips and best practices
- Community updates
- Optional feature highlights
- General information

### Notification Delivery

All system announcements are delivered as notifications that appear in users' notification centers. Users receive these notifications according to their notification preferences (immediate, daily digest, or in-app only).

## Creating Announcements

### Administrator Access

Only users with administrator privileges can create system announcements:

1. Navigate to **Admin** section
2. Click **Notifications** in the sidebar
3. Click **Create System Notification**

### Announcement Form

**Basic Information:**
- **Title**: Clear, descriptive announcement title
- **Message**: The main content of the announcement

**Content:**
- **Rich Text Editor**: Full formatting capabilities using TipTap editor
- **Images**: Upload or link to relevant images
- **Links**: Include external or internal links
- **Formatting**: Bold, italic, bullet points, headers, and more

**Publishing:**
- **Immediate**: Publish immediately upon creation
- **Recipients**: Delivered to all users across the platform

### Rich Text Features

The announcement editor supports:

- **Text Formatting**: Bold, italic, underline, colors
- **Lists**: Bulleted and numbered lists
- **Headers**: Multiple heading levels
- **Tables**: Data presentation
- **Code Blocks**: Technical information
- **Quotes**: Highlighted text sections
- **Links**: Internal and external references

## Managing Announcements

### Announcement Dashboard

The System Announcements dashboard shows:

- **Active Announcements**: Currently visible to users
- **Scheduled Announcements**: Future publications
- **Draft Announcements**: Unpublished content
- **Archived Announcements**: Historical messages

### Announcement Actions

**Edit Announcement:**
1. Click **Edit** on existing announcement
2. Modify content, priority, or targeting
3. Save changes (live announcements update immediately)

**Schedule Announcement:**
1. Set future publish date and time
2. Optional: Set expiration date
3. Announcement automatically appears/disappears

**Archive Announcement:**
1. Click **Archive** to remove from active display
2. Announcement moves to archived section
3. Remains accessible for reference

**Delete Announcement:**
1. Permanently remove announcement
2. Confirmation required for deletion
3. Cannot be undone

### Analytics and Tracking

View announcement performance:

- **Read Statistics**: How many users have seen the announcement
- **Interaction Rates**: Click-through on embedded links
- **Dismissal Patterns**: When users dismiss announcements
- **Feedback**: User responses (if enabled)

## User Experience

### How Users See Announcements

**Notification Center:**
- Announcements appear in users' notification centers
- Standard notification display with title and message
- Rich text formatting preserved in notification display

**Notification Preferences:**
- Users receive announcements based on their notification settings
- Can be delivered immediately, as daily digest, or in-app only
- Email notifications sent according to user preferences

**Notification History:**
- All announcements are preserved in notification history
- Users can review past announcements at any time
- Mark as read/unread functionality available

### User Actions

**Dismiss Announcement:**
- Click the X button to dismiss
- High-priority announcements may require confirmation
- Dismissed announcements won't reappear

**View Full Details:**
- Click announcement title for complete content
- Access attachments and additional resources
- View related announcements

**Provide Feedback:**
- Rate announcement usefulness (if enabled)
- Submit comments or questions
- Request additional information

## Advanced Features

### Announcement Templates

Create reusable templates for common announcement types:

**Maintenance Template:**
```
🔧 Scheduled Maintenance Notice

We will be performing scheduled maintenance on {{date}} from {{start_time}} to {{end_time}}.

During this time:
- System will be unavailable
- All work should be saved before maintenance begins
- Service will resume automatically

For questions, contact: {{support_email}}
```

**Feature Release Template:**
```
🎉 New Feature Release: {{feature_name}}

We're excited to announce {{feature_name}} is now available!

Key benefits:
- {{benefit_1}}
- {{benefit_2}}
- {{benefit_3}}

Learn more: {{documentation_link}}
```

### Conditional Display

Configure announcements to display based on:

- **User Role**: Show only to specific roles
- **Project Membership**: Target project team members
- **Last Login**: Show to users who haven't logged in recently
- **Feature Usage**: Target users of specific features

### Integration with External Systems

Connect announcements to external tools:

- **ITSM Integration**: Pull from service management systems
- **Slack/Teams**: Cross-post to communication platforms
- **Email Systems**: Automated email distribution
- **Monitoring**: Trigger announcements from system alerts

## Best Practices

### Writing Effective Announcements

1. **Clear Headlines**: Use descriptive, action-oriented titles
2. **Concise Content**: Keep announcements brief and scannable
3. **Call-to-Action**: Include clear next steps when needed
4. **Contact Information**: Provide support or follow-up contacts
5. **Visual Hierarchy**: Use formatting to highlight key information

### Timing and Frequency

1. **Strategic Timing**: Publish when users are most likely to see them
2. **Advance Notice**: Give adequate warning for changes
3. **Avoid Overload**: Don't overwhelm users with too many announcements
4. **Consistent Schedule**: Establish regular communication patterns

### Content Guidelines

1. **Professional Tone**: Maintain consistent organizational voice
2. **Relevant Information**: Ensure announcements add value
3. **Accurate Details**: Verify all dates, times, and instructions
4. **Accessible Language**: Use clear, jargon-free communication
5. **Mobile-Friendly**: Consider mobile users in formatting

## Examples

### Maintenance Announcement

```
🔧 Scheduled System Maintenance

**When:** Saturday, March 15th, 2:00 AM - 6:00 AM PST
**Impact:** TestPlanIt will be unavailable during this window

We're upgrading our database infrastructure to improve performance. 

**Before maintenance:**
- Save all work in progress
- Export any needed reports
- Plan testing activities for after 6:00 AM

**Questions?** Contact support@testplanit.com

Thank you for your patience!
```

### Feature Announcement

```
🎉 New Feature: Advanced Search Filters

You can now use advanced filters in the global search!

**What's New:**
- Filter by custom fields
- Date range selection
- Tag combinations
- User assignments

**How to Use:**
1. Open search (Ctrl+K)
2. Click the filter icon
3. Configure your filters
4. Save favorite searches

📖 View documentation: [Advanced Search Guide](/docs/advanced-search)
```

### Policy Update

```
📋 Updated Password Policy - Effective April 1st

Our password policy has been updated for enhanced security:

**New Requirements:**
- Minimum 12 characters (previously 8)
- Must include special characters
- Cannot reuse last 5 passwords
- Expires every 90 days

**Action Required:**
- Update your password by March 31st
- Review team account passwords
- Update stored credentials in automation tools

**Need Help?** Contact IT support at ext. 2845
```

## Troubleshooting

### Common Issues

**Announcement Not Displaying:**
- Check user role permissions
- Verify publish date and time
- Confirm announcement is not archived
- Check targeting criteria

**Formatting Problems:**
- Use rich text editor preview
- Test with different browsers
- Check mobile display
- Validate HTML if using custom formatting

**Low Read Rates:**
- Review announcement priority
- Check timing of publication
- Consider announcement fatigue
- Improve title and content

### Resolution Steps

1. **Check Settings**: Verify announcement configuration
2. **Test Display**: Preview announcement as different user types
3. **Review Analytics**: Analyze read and interaction statistics
4. **Gather Feedback**: Ask users about announcement visibility
5. **Update Content**: Revise based on user feedback

## API Reference

### Create Announcement

```http
POST /api/admin/announcements
Content-Type: application/json

{
  "title": "System Maintenance Notice",
  "content": "Scheduled maintenance on...",
  "priority": "HIGH",
  "category": "MAINTENANCE",
  "publishAt": "2024-03-15T02:00:00Z",
  "expiresAt": "2024-03-15T06:00:00Z",
  "targetRoles": ["ALL"]
}
```

### Get Active Announcements

```http
GET /api/announcements/active
```

### Mark Announcement as Read

```http
POST /api/announcements/{announcementId}/read
```

### Get Announcement Analytics

```http
GET /api/admin/announcements/{announcementId}/analytics
```