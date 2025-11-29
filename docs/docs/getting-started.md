---
title: Getting Started
sidebar_position: 2
---

# Getting Started with TestPlanIt

Welcome! This guide assumes you have successfully installed TestPlanIt either via [Docker](./docker-setup.md) or [manually](./manual-setup.md). Let's dive into the core workflow.

## 1. Logging In

Navigate to the URL where TestPlanIt is hosted. You should be presented with a login screen.

The initial administrator account is created by the database seed script (`pnpm prisma db seed`). Log in using the credentials configured during setup:

- **Email:** The value of the `ADMIN_EMAIL` environment variable used during seeding (defaults to `admin@example.com` if not set in your `.env`).
- **Password:** The value of the `ADMIN_PASSWORD` environment variable used during seeding (defaults to `admin` if not set in your `.env`).

:::tip Alternative Authentication Methods
TestPlanIt also supports alternative authentication methods including Magic Link (passwordless email authentication), Google OAuth, Apple Sign In, and SAML 2.0. See the [Authentication documentation](./user-guide/sso.md) for setup instructions.
:::

:::warning Important Security Note
If the initial administrator account was created with the **default** credentials (e.g., `admin@example.com` / `admin`) and you plan to use a different personal administrator account, remember to create your own account and delete the default initial one (see Step 3 for instructions).

If you configured your desired admin credentials using the `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` variables in your `.env` file **before** the initial setup process, then the created admin account is your intended primary account, and you do not need to delete it unless you create another one later.
:::

## 2. Exploring Administration

Before creating tests, you might want to familiarize yourself with the administration settings.

1. Click Admin from the top navigation menu.
2. Explore sections like:
    - **Projects:** Manage your test projects.
    - **Users & Groups:** Manage user accounts and permissions.
    - **Configurations:** Define test environments (e.g., browsers, OS).
    - **Templates & Fields:** Customize test case and result fields.
    - **Statuses & Workflows:** Define custom statuses and state transitions.

See the [Administration section](./user-guide/administration.md) for details.

## 3. Creating Your User Account

**(Optional: Skip this step if you configured your desired admin credentials using the `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` variables in your `.env` file before running the initial application setup.)**

If you logged in using the default initial credentials and want to create a separate, personal administrator account, follow these steps:

1. While logged in as the default admin, navigate to **Administration > Users** using the top navigation menu.
2. Click the **Add User** button.
3. Fill in the details for your own user account (Name, Email, Password). Assign appropriate **Roles** (e.g., Administrator) and **Groups** if applicable.
4. Click **Submit**.
5. Log out of the default admin account (User Menu > Logout).
6. Log back in using the credentials for the **new account** you just created.
7. Navigate back to **Administration > Users**.
8. Find the default `admin@testplanit.com` user in the list.
9. Click the **Delete** (trash can) icon next to the default admin user.
10. Confirm the deletion.

Now you are logged in as your own administrative user!

## 4. Creating Your First Project

Test cases and runs are organized within Projects.

1. Navigate to **Administration > Projects**.
2. Click the **Add Project** button.
3. Give your project a **Name** (e.g., "My First Project").
4. Optionally add a description.
5. Click **Submit**.

See [Managing Projects](./user-guide/projects.md) for more.

## 5. Navigating Your Project

Click the TestPlanIt logo or the main navigation menu to go back to the main application view.

1. Click the **Projects** link in the main navigation (or find your project on the [Dashboard](./user-guide/dashboard.md)).
2. Select "My First Project" from the list.
3. You are now on the [Project Overview](./user-guide/project-overview.md) page.

From here, you can access key project areas via the left-hand sidebar:

- **Repository:** Where you define your test cases.
- **Runs:** Where you organize and execute test runs.
- **Milestones:** Track progress against deadlines.
- **Sessions:** Manage test sessions (often used for exploratory testing).
- **Tags:** Organize cases with tags.
- **Documentation:** Project-specific documentation.

## 6. Creating a Basic Test Case

1. Navigate to **Repository** in the project sidebar.
2. Click **Add Test Case**.
3. Enter a **Name** (e.g., "Verify Login Functionality").
4. (Optional) Add steps: Click **Add Step**, type an action (e.g., "Enter username and password"), type an expected result (e.g., "User is logged in successfully").
5. Click **Save**.

See the [Test Case Repository](./user-guide/projects/repository.md) guide for details.

## 7. Creating a Test Run

1. Navigate to **Runs** in the project sidebar.
2. Click **Add Test Run**.
3. Enter a **Name** (e.g., "Login Smoke Test - Week 1").
4. Click **Next**.
5. Select the test case(s) you want to include (e.g., "Verify Login Functionality"). You can use the filters or browse the repository structure.
6. Click **Submit**.

See [Test Runs](./user-guide/projects/runs.md) for more.

## 8. Executing the Test Run

1. From the Test Runs list, click on the name of the run you just created ("Login Smoke Test - Week 1").
2. You are now in the execution view.
3. Select the test case ("Verify Login Functionality").
4. Follow the steps displayed.
5. Set the **Status** (e.g., Passed, Failed) for the overall case (and individual steps if applicable).
6. Add **Notes**, **Elapsed Time**, or **Attachments** if needed.
7. The result is saved automatically.

See [Test Case Execution](./user-guide/projects/test-case-execution.md).

## 9. Viewing Results

- Results are visible immediately within the **Test Run** view.
- You can also see the history for a specific test case by navigating back to **Repository**, clicking the test case name, and viewing the **Test Result History** section at the bottom.

## Next Steps

This was a very basic overview. Explore the detailed documentation for each section to understand the full capabilities of TestPlanIt!