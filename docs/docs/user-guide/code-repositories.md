---
sidebar_label: 'Code Repositories'
title: 'Code Repositories'
description: Connect Git repositories so AI-powered test export can follow your real code, frameworks, and page objects
---

# Code Repositories

The **Administration → Code Repositories** page registers connections to Git repositories that supply **source-file context** to AI-powered test export (QuickScript). When a project is bound to a repository, AI-generated automation scripts follow your existing code — the same framework, fixtures, and page objects your team already uses — instead of generic boilerplate.

:::note
Administrators register and manage repository connections here. The connection is then **selected and configured per project** under **Project Settings → QuickScript**. See [Project QuickScript settings](projects/settings/quickscript.md).
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Code Repositories** under **AI Tools** in the admin menu.

## Supported providers

| Provider | Connection fields |
| --- | --- |
| **GitHub** | Personal Access Token, Owner, Repository, optional API Base URL (GitHub Enterprise Server only) |
| **GitLab** | Personal Access Token, Project ID or Path, optional GitLab URL (self-hosted) |
| **Bitbucket** (Cloud) | Atlassian account email, API Token, Workspace, Repository Slug |
| **Azure DevOps** | Personal Access Token, Organization URL, Project Name, Repository Name or ID |
| **Gitea / Forgejo / Gogs** | Personal Access Token, Server URL, Owner, Repository |

Authentication is per-repository (token-based, or email + API token for Bitbucket). Credentials are stored encrypted.

## Registering a repository

1. Click **Add** (or **Add Repository** from the empty state).
2. Enter a unique **Name** and choose a **Provider**.
3. Fill in the provider-specific connection fields.
4. Click **Test Connection** to verify the credentials and target. A green **Connection successful** confirms the repo is reachable.
5. Save the repository.

:::tip
Always use `https://` URLs for self-hosted servers. If you enter an `http://` URL, TestPlanIt warns that credentials would be sent in plaintext.
:::

## Managing repositories

The table lists each repository with these columns:

| Column | Description |
| --- | --- |
| **Name** | The repository's display name. |
| **Provider** | GitHub, GitLab, Bitbucket, Azure DevOps, or Gitea / Forgejo / Gogs. |
| **Active** | A toggle that enables or disables the connection. |
| **Last Tested** | When the connection was last verified, or **Never**. |
| **Actions** | Edit and delete. |

- **Edit** reopens the connection form. The **provider cannot be changed** after creation — to switch providers, delete the repository and add a new one.
- **Delete** soft-deletes the repository (it can be restored from [Trash](trash.md)).
- The **Active** toggle enables or disables the connection without deleting it.

### Connection health

A failed **Test Connection** flips the repository into an **Error** state and disables its Active toggle until a successful test re-activates it. Re-run **Test Connection** after fixing the credentials or target.

## How repositories feed AI export

The data flow spans the admin page and project settings:

1. **Admin** registers the repository here (credentials + a successful connection test).
2. A **project admin** binds the repository to a project under **Project Settings → QuickScript**, choosing a branch and one or more path patterns (base path + glob).
3. **AI test export** reads the cached file context for that project so generated scripts match the repository's real code.

Repository file context is capped at **500 KB** per export; when a project's matched files exceed that budget, files are ranked by relevance and the lowest-ranked are skipped. File listings are cached (in Valkey) and can be refreshed from the project's QuickScript settings.

:::info
For security, TestPlanIt blocks repository URLs that resolve to private or loopback addresses (SSRF protection). Self-hosted hosts must be allowlisted via the `ALLOWED_PRIVATE_HOSTS` environment variable.
:::

## Related pages

- [Project QuickScript settings](projects/settings/quickscript.md) — bind a repository to a project.
- [QuickScript Templates](quickscript-templates.md) — define the export templates AI generation follows.
