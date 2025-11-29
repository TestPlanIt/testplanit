---
title: Email Templates
---

# Email Template Development

This guide explains how to create and customize email templates in TestPlanIt using the Handlebars templating system.

## Overview

TestPlanIt uses Handlebars for email templating, providing:

- Separation of content and presentation
- Reusable layouts and partials
- Template helpers for common operations
- Responsive, professional email designs

## Template Structure

### Directory Layout

```text
lib/email/
├── template-service.ts      # Template rendering engine
├── notificationTemplates.ts # Email sending functions
├── templates/
│   ├── layouts/            # Base layouts
│   │   └── main.hbs       # Default layout
│   ├── partials/          # Reusable components
│   │   └── header.hbs     # Logo header
│   ├── notification.hbs   # Single notification
│   └── daily-digest.hbs   # Daily summary
```

### Template Hierarchy

1. **Layout** - Base HTML structure (header, footer, styles)
2. **Template** - Specific email content
3. **Partials** - Reusable components

## Creating Email Templates

### Basic Template

Create a new file in `lib/email/templates/`:

```handlebars
<!-- welcome.hbs -->
<h2>Welcome to TestPlanIt!</h2>

{{#if userName}}
  <p>Hi {{userName}},</p>
{{else}}
  <p>Hello,</p>
{{/if}}

<p>Welcome to TestPlanIt. We're excited to have you!</p>

<div class="text-center">
  <a href="{{appUrl}}/getting-started" class="button">
    Get Started
  </a>
</div>
```

### Using the Template

```typescript
import { renderEmailTemplate } from './lib/email/template-service';

// Render the template
const { html, subject } = await renderEmailTemplate('welcome', {
  userName: 'John Doe',
  appUrl: process.env.NEXTAUTH_URL,
  subject: 'Welcome to TestPlanIt!'
});

// Send the email
await transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: user.email,
  subject,
  html
});
```

## Available Helpers

### Date Formatting

```handlebars
<!-- Format as "January 1, 2024" -->
{{formatDate createdAt}}

<!-- Format as "January 1, 2024, 2:30 PM" -->
{{formatDateTime createdAt}}
```

### Comparisons

```handlebars
{{#if (eq status "completed")}}
  <span class="success">✓ Completed</span>
{{/if}}

{{#if (gt count 0)}}
  <p>You have {{count}} notifications</p>
{{/if}}
```

### Available Operators

- `eq` - Equal to
- `ne` - Not equal to
- `gt` - Greater than
- `gte` - Greater than or equal
- `lt` - Less than
- `lte` - Less than or equal

## Template Variables

### Common Variables

All templates receive these variables:

```typescript
{
  appUrl: string;        // Application URL
  userId: string;        // Current user ID
  currentYear: number;   // For copyright
  userName?: string;     // User's display name
  subject: string;       // Email subject
}
```

### Custom Variables

Pass additional data as needed:

```typescript
await renderEmailTemplate('custom-template', {
  // Common variables
  ...commonData,

  // Custom variables
  projectName: 'My Project',
  testResults: {
    passed: 95,
    failed: 5,
    total: 100
  }
});
```

## Layouts

### Default Layout

The `main.hbs` layout provides:

- Responsive design
- Consistent header/footer
- Base styles
- Unsubscribe links

### Custom Layouts

Create new layouts in `templates/layouts/`:

```handlebars
<!-- minimal.hbs -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{subject}}</title>
</head>
<body>
  {{{content}}}
</body>
</html>
```

Use custom layout:

```typescript
await renderEmailTemplate('alert', data, {
  layout: 'minimal'
});
```

## Partials

### Creating Partials

Add files to `templates/partials/`:

```handlebars
<!-- button.hbs -->
<div class="text-center">
  <a href="{{url}}" class="button {{class}}">
    {{text}}
  </a>
</div>
```

### Using Partials

```handlebars
{{> button url="/dashboard" text="View Dashboard" class="primary"}}
```

## Styling Emails

### Inline Styles

Email clients require inline styles:

```handlebars
<div style="padding: 20px; background-color: #f5f5f5;">
  <h2 style="color: #333; margin-bottom: 10px;">
    {{title}}
  </h2>
</div>
```

### CSS Classes

Define classes in the layout:

```handlebars
<style>
  .notification-item {
    padding: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 16px;
  }
</style>
```

### Responsive Design

Use media queries for mobile:

```handlebars
<style>
  @media only screen and (max-width: 600px) {
    .email-body {
      padding: 20px !important;
    }
  }
</style>
```

## Testing Templates

### Local Development

1. **Set up MailHog** for local email testing:

   ```bash
   docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
   ```

2. **Configure `.env`**:

   ```text
   EMAIL_SERVER_HOST=localhost
   EMAIL_SERVER_PORT=1025
   EMAIL_SERVER_USER=
   EMAIL_SERVER_PASSWORD=
   ```

3. **View emails** at [http://localhost:8025](http://localhost:8025)

### Preview Templates

Create a preview script:

```typescript
// scripts/preview-email.ts
import { renderEmailTemplate } from '../lib/email/template-service';

async function preview() {
  const { html } = await renderEmailTemplate('notification', {
    userName: 'Test User',
    notification: {
      title: 'Test Notification',
      message: 'This is a test',
      createdAt: new Date()
    },
    appUrl: 'http://localhost:3000'
  });

  console.log(html);
}

preview();
```

## Best Practices

### Content

- Keep subject lines under 50 characters
- Use preheader text effectively
- Include alt text for images
- Provide text-only alternatives

### Design

- Use tables for layout (better email client support)
- Stick to web-safe fonts
- Test with images disabled
- Keep width under 600px

### Development

- Test across email clients (Gmail, Outlook, Apple Mail)
- Validate HTML markup
- Minimize external dependencies
- Use absolute URLs for links and images

### Security

- Sanitize user input
- Don't include sensitive data
- Use HTTPS URLs
- Include unsubscribe links

## Common Patterns

### Notification List

```handlebars
{{#each notifications}}
  <div class="notification-item">
    <h3>{{this.title}}</h3>
    <p>{{this.message}}</p>
    <small>{{formatDateTime this.createdAt}}</small>
  </div>
{{/each}}
```

### Conditional Content

```handlebars
{{#if urgent}}
  <div class="alert alert-urgent">
    ⚠️ This requires immediate attention
  </div>
{{/if}}
```

### Call-to-Action Buttons

```handlebars
<table cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center">
      <a href="{{actionUrl}}" class="button">
        {{actionText}}
      </a>
    </td>
  </tr>
</table>
```

## Troubleshooting

### Template Not Found

- Ensure file exists in `templates/` directory
- Check file extension is `.hbs`
- Verify template name in code matches filename

### Variables Not Rendering

- Check variable names match exactly
- Ensure data is passed to template
- Use `{{{variable}}}` for HTML content

### Styles Not Working

- Use inline styles for better support
- Test in target email clients
- Avoid advanced CSS features

### Email Not Sending

- Verify SMTP configuration
- Check email worker is running
- Review logs for errors
- Test with simple template first
