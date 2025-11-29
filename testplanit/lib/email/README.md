# Email Templates

This directory contains the email template system for TestPlanIt using Handlebars.

> **📖 Full Documentation**: For comprehensive documentation on creating and customizing email templates, see the [Email Template Development Guide](https://testplanit.com/docs/user-guide/email-templates)

## Quick Reference

### Structure

```text
lib/email/
├── template-service.ts      # Main template rendering service
├── notificationTemplates.ts # Email sending functions
├── templates/
│   ├── layouts/
│   │   └── main.hbs        # Base layout for all emails
│   ├── partials/           # Reusable template parts
│   │   └── header.hbs      # Logo header
│   ├── notification.hbs    # Single notification email
│   └── daily-digest.hbs    # Daily digest email
```

### Quick Start

1. **Create a new template** in `templates/`:

```handlebars
<!-- templates/welcome.hbs -->
<h2>Welcome to TestPlanIt!</h2>
<p>Hi {{userName}},</p>
<p>Welcome to TestPlanIt. We're excited to have you on board!</p>
```

1. **Use the template** in your code:

```typescript
import { renderEmailTemplate } from './lib/email/template-service';

const { html, subject } = await renderEmailTemplate('welcome', {
  userName: 'John Doe',
  appUrl: process.env.NEXTAUTH_URL,
  subject: 'Welcome to TestPlanIt!'
});
```

### Available Helpers

- `{{formatDate date}}` - Format as "January 1, 2024"
- `{{formatDateTime date}}` - Format with time
- `{{eq a b}}`, `{{ne a b}}` - Equality comparisons
- `{{gt a b}}`, `{{gte a b}}`, `{{lt a b}}`, `{{lte a b}}` - Numeric comparisons

### Common Variables

All templates receive:

- `appUrl` - Application URL
- `userId` - Current user ID
- `currentYear` - For copyright
- `userName` - User's display name (optional)

### Testing Locally

```bash
# Run MailHog for local email testing
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog

# Configure .env
EMAIL_SERVER_HOST=localhost
EMAIL_SERVER_PORT=1025

# View emails at http://localhost:8025
```

## Learn More

For detailed information on:

- Creating custom layouts and partials
- Using advanced template helpers
- Styling best practices
- Testing across email clients
- Troubleshooting common issues

See the [Email Template Development Guide](https://testplanit.com/docs/user-guide/email-templates)
