---
sidebar_position: 74
title: Share Links
---

# Share Links

Share Links enable you to share reports and other content with stakeholders via secure, customizable URLs with flexible access control options.

## Overview

Share Links provide:

- **Three access modes** for different security requirements
- **Customizable expiration dates** for time-limited access
- **Password protection** for sensitive content
- **View notifications** when links are accessed
- **Access analytics** with detailed logs
- **Link management** to revoke or modify shares

## What are Share Links?

Share Links are shareable URLs that allow you to distribute reports and other content to team members, clients, or external stakeholders without requiring them to have a TestPlanIt account.

### Key Use Cases

- **Client Reporting**: Share test results with clients using password-protected links
- **Public Dashboards**: Distribute metrics openly for transparency
- **Team Collaboration**: Share reports with team members who have project access
- **Stakeholder Updates**: Provide weekly/monthly reports via expiring links
- **Executive Summaries**: Share high-level metrics with leadership

## Share Modes

### Authenticated Mode

Requires users to sign in with project access.

**When to use**:

- Sharing with team members
- Internal stakeholder reports
- Sensitive data requiring authentication

**Features**:

- Redirects to full app with report configuration
- Preserves all report settings and filters
- Full navigation and interactive features
- Requires project permissions

**Security**: Highest level - requires authentication and project access

### Public Mode

No authentication required - accessible to anyone with the link.

**When to use**:

- Public dashboards
- Marketing reports
- Open data sharing
- Non-sensitive metrics

**Features**:

- Minimal UI (no navigation header)
- Read-only report view
- Data filtering (emails/IDs removed)
- Optimized for external viewing

**Security**: No authentication required - use only for public data

### Password-Protected Mode

Public access with password requirement.

**When to use**:

- Client reports
- Partner collaboration
- Confidential external sharing
- Controlled public access

**Features**:

- Password gate before content access
- Auth bypass for logged-in users with project access
- Rate limiting (5 attempts per 15 minutes)
- Session persistence after verification

**Security**: Moderate - password protection with rate limiting

## Creating Share Links

### From Report Builder

1. **Configure Your Report**
   - Navigate to Reports page
   - Select report type (Test Execution, Automation Trends, etc.)
   - Set date range, dimensions, and metrics
   - Apply any filters needed
   - Generate the report

2. **Click Share Button**
   - Located in the report toolbar
   - Opens the Share Dialog

3. **Choose Access Mode**
   - **Authenticated**: Requires login with project access
   - **Public**: No authentication required
   - **Password-Protected**: Requires password to access

4. **Configure Share Settings**

   **Title** (optional)
   - Custom name for the share
   - Defaults to report type if not provided

   **Description** (optional)
   - Context or notes for viewers
   - Helpful for identifying share purpose

   **Expiration Date** (optional)
   - Set automatic expiration
   - Leave blank for no expiration
   - Can be updated later

   **Password** (for Password-Protected mode)
   - Minimum 4 characters recommended
   - Use strong passwords (12+ characters, mixed case, numbers, symbols)
   - Password is hashed with bcrypt (10 rounds)

   **Notify on View**
   - Enable to receive email notifications when link is accessed
   - Shows viewer name/email (if authenticated) or "Anonymous"
   - Can be toggled on/off anytime

5. **Create and Copy Link**
   - Click "Create Share"
   - Share URL is generated: `/share/{shareKey}`
   - Click "Copy Link" to copy to clipboard
   - Share the URL via email, chat, or other channels

### Share Link Format

```text
https://app.testplanit.io/share/A8j2KmPqR5vWxYz7BnC3DfG9HkL4MtN6
```

- 43-character random share key
- 256-bit entropy for security
- URL-safe characters only
- Outside locale prefix for shorter URLs

## Managing Share Links

### Accessing Share Management

**From Project Settings**:

1. Navigate to your project
2. Click **Settings** in the project menu
3. Click **Shares** in the settings navigation
4. View all shares for the project

**From Admin (Cross-Project)**:

1. Navigate to **Admin** section
2. Click **Shares** to view all shares across all projects

**From Share Dialog**:

1. Click Share button in Report Builder
2. Select "My Shares" tab
3. View and manage existing shares

### Share List Features

**Columns**:

- **Title**: Share name with link to view
- **Mode**: Access mode (Authenticated/Public/Password-Protected)
- **Views**: Number of times accessed
- **Notifications**: On/Off indicator
- **Created**: Creation date
- **Expires**: Expiration date or "Never"
- **Status**: Active, Expired, or Revoked

### Available Actions

**Copy Link**

- Copy share URL to clipboard
- Quick access for distribution

**Edit Share**

- Update title and description
- Change expiration date
- Update password (for password-protected shares)
- Toggle notify on view

**Toggle Notifications**

- Enable/disable view notifications
- Quick toggle button in list
- Only available for active shares

**Revoke Share**

- Immediately disable access
- Link shows "Link revoked" message
- Can be reversed by editing and un-revoking
- Preserves access logs

**Delete Share**

- Permanently remove share
- Link shows 404 Not Found
- Cannot be undone
- Removes all access logs

## Accessing Shared Content

### Public Share Access

1. Click or paste share URL in browser
2. Report loads immediately (no authentication)
3. View read-only report content
4. Minimal UI - no navigation or header

### Password-Protected Share Access

1. Click or paste share URL in browser
2. Password gate appears
3. Enter password
4. On success, report loads
5. Access persists in browser session

**Rate Limiting**: 5 password attempts per 15 minutes per IP address

**Auth Bypass**: If logged in with project access, password is skipped automatically

### Authenticated Share Access

1. Click or paste share URL in browser
2. If not logged in, redirected to signin page
3. After signin, redirected to full app with report configuration
4. Report loads with all settings preserved

**Access Denied**: Users without project access see "Access denied" message

## Access Analytics

### View Count

- Increments each time link is accessed
- Tracks unique views per browser session
- Prevents double-counting refreshes
- Displayed in share list

### Last Viewed

- Timestamp of most recent access
- Shows when link was last used
- Helps identify stale shares

### Access Logs

View detailed access history:

**Log Information**:

- Viewer name (if authenticated) or "Anonymous"
- Viewer email (if authenticated)
- IP address
- User agent (browser/device)
- Access timestamp
- Was authenticated (yes/no)

**Accessing Logs**:

1. Navigate to Share Management
2. Click on share title
3. View access log table
4. Filter and sort as needed

## Notifications

### Share Link Accessed Notification

Triggered when `notifyOnView` is enabled and link is accessed.

**Notification Contains**:

- Share title
- Viewer name (or "Anonymous")
- Viewer email (if authenticated)
- Access timestamp
- Link to access logs

**Configuration**:

- Enable during share creation
- Toggle on/off in share list
- Only share owner receives notifications
- Email notification delivery

### When Notifications are Sent

- ✅ First view by new viewer
- ✅ View after session expiration
- ❌ Same viewer refreshing page
- ❌ Same viewer within session

## Security Features

### Share Key Generation

- **Entropy**: 256 bits (32 bytes)
- **Encoding**: base64url (URL-safe)
- **Length**: 43 characters
- **Method**: crypto.randomBytes
- **Uniqueness**: Collision probability negligible

### Password Protection

- **Hashing**: bcrypt with 10 rounds
- **Storage**: Hash only, never plain text
- **Strength**: Minimum 4 characters (12+ recommended)
- **Verification**: Secure comparison
- **Rate Limiting**: 5 attempts per 15 minutes per IP

### Access Control

- **Expiration**: Enforced on every access
- **Revocation**: Checked on every access
- **Data Filtering**: Emails and internal IDs removed for public shares
- **Audit Logging**: Every access recorded with IP and timestamp

### Auth Bypass

Logged-in users with project access automatically bypass password protection:

- Check project permissions
- Skip password gate if access granted
- Show notification with "View in Full App" link
- Seamless experience for team members

### Multi-Tenant Security

- All queries tenant-scoped via middleware
- Cross-tenant access blocked
- Share management shows only current tenant's shares
- Access logs respect tenant boundaries

## Best Practices

### Choosing Share Modes

**Use Authenticated for**:

- Team members with project access
- Internal stakeholder reports
- Sensitive data requiring authentication
- Reports needing interactive features

**Use Public for**:

- Public dashboards and metrics
- Marketing and transparency reports
- Open data sharing
- Non-sensitive information

**Use Password-Protected for**:

- Client reports and deliverables
- Partner collaboration
- Confidential external sharing
- Time-limited access to sensitive data

### Security Recommendations

**Password Strength**:

- Use 12+ characters
- Mix uppercase, lowercase, numbers, symbols
- Avoid common words or patterns
- Don't reuse passwords from other services

**Expiration Dates**:

- Set expiration for temporary shares
- Review and extend if needed
- Expire shares when no longer needed
- Regular cleanup of old shares

**Link Distribution**:

- Don't share passwords via same channel as link
- Use separate communication methods
- Verify recipient before sharing
- Consider short-lived shares for sensitive data

**Access Monitoring**:

- Enable notifications for sensitive shares
- Review access logs periodically
- Investigate unexpected access
- Revoke compromised links immediately

**Regular Maintenance**:

- Review active shares monthly
- Delete unused shares
- Update expired shares or extend expiration
- Revoke shares when no longer needed

### Performance Tips

- Public shares are optimized for read-only access
- Large reports may take longer to load
- Consider filtering data before sharing
- Set reasonable date ranges for better performance

## Troubleshooting

### "Link expired" message

**Cause**: Share has passed expiration date

**Solutions**:

- Contact share creator to extend expiration
- Request new share link
- If you're the owner, edit share and update expiration date

### "Link revoked" message

**Cause**: Share was manually revoked by creator

**Solutions**:

- Contact share creator for explanation
- Request new share link if access still needed
- If you're the owner, edit share and un-revoke if needed

### "Access denied" for authenticated shares

**Cause**: User doesn't have project access

**Solutions**:

- Contact project owner to request access
- Verify you're logged in with correct account
- Check if your project permissions were removed

### Password not working

**Causes**:

- Typo in password (case-sensitive)
- Rate limiting after failed attempts
- Incorrect password provided

**Solutions**:

- Verify password carefully (check caps lock)
- Wait 15 minutes if rate limited
- Contact share creator to verify password
- Request password reset if available

### Report not loading

**Causes**:

- Network connectivity issues
- Browser cache problems
- Server error

**Solutions**:

- Check internet connection
- Try refreshing the page
- Clear browser cache and cookies
- Try different browser
- Contact support if issue persists

### Password rate limiting

**Message**: "Too many attempts. Try again in 15 minutes."

**Cause**: 5 or more failed password attempts from your IP address

**Solutions**:

- Wait 15 minutes before trying again
- Verify you have the correct password
- Use different network if urgent
- Contact share creator if password is unclear

## API Reference

### ShareLink Model

```typescript
{
  id: string;                    // Unique identifier
  shareKey: string;              // 32-64 char random key
  entityType: "REPORT";          // Currently only REPORT supported
  entityConfig: {                // Report configuration
    reportType: string;
    dimensions: string[];
    metrics: string[];
    startDate: string;
    endDate: string;
    page: number;
    pageSize: number;
  };
  projectId: number;
  mode: "AUTHENTICATED" | "PUBLIC" | "PASSWORD_PROTECTED";
  expiresAt: Date | null;
  notifyOnView: boolean;
  title: string | null;
  description: string | null;
  isRevoked: boolean;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### ShareLinkAccessLog Model

```typescript
{
  id: string;
  shareLinkId: string;
  accessedById: string | null;    // User ID if authenticated
  ipAddress: string | null;
  userAgent: string | null;
  wasAuthenticated: boolean;
  accessedAt: Date;
}
```

### Access Modes

```typescript
enum ShareLinkMode {
  AUTHENTICATED       // Requires login + project access
  PUBLIC             // No auth required
  PASSWORD_PROTECTED // Public but requires password
}
```

### Entity Types

```typescript
enum ShareLinkEntityType {
  REPORT            // Currently supported
  TEST_CASE         // Future
  TEST_RUN          // Future
  SESSION           // Future
  DASHBOARD         // Future
}
```

## Future Enhancements

### Planned Entity Types

- **Test Cases**: Share individual test case details
- **Test Runs**: Share test run results and metrics
- **Sessions**: Share session-based testing results
- **Dashboards**: Share custom dashboard views

### Potential Features

- **Custom Branding**: Logo and colors for public shares
- **Embed Support**: iframe embedding for websites
- **Download Options**: Export as PDF or CSV from share
- **Share Templates**: Predefined share configurations
- **Bulk Operations**: Create multiple shares at once
- **Analytics Dashboard**: Comprehensive share analytics
- **Custom Expiration**: Notifications before expiration
- **Access Restrictions**: IP whitelisting, domain restrictions
