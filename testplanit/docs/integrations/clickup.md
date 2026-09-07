# ClickUp Integration

TestPlanIt can push issues to ClickUp — creating and updating ClickUp tasks,
searching for tasks, and commenting when an issue is linked to a test case —
via an OAuth2 app registered with ClickUp. This mirrors the GitHub/Jira
integrations: create an `Integration` row (Admin → Integrations), authorize
it against your ClickUp workspace, then attach it to a project (Project
Settings → Integrations).

## 1. Register a ClickUp OAuth app

1. Go to `https://app.clickup.com/settings/apps` and create a new app.
2. Set the **Redirect URL** to:

   ```
   <your TestPlanIt URL>/api/integrations/oauth/clickup/callback
   ```

   This must match exactly what TestPlanIt sends during authorization —
   TestPlanIt derives it from `NEXTAUTH_URL`, so the value shown on the
   integration's config form (once you select ClickUp) is the one to copy.
3. Copy the app's **Client ID** and **Client Secret** — you'll paste these
   into TestPlanIt in the next step.

No environment variables need to be set for this integration: the client ID
and secret are stored per-`Integration` row (encrypted), not in `.env`. The
only prerequisite is that `NEXTAUTH_URL` is already configured, as it is for
every OAuth-based integration.

## 2. Create the Integration in TestPlanIt

1. Admin → Integrations → Add Integration → **ClickUp**.
2. Paste the **Client ID** / **Client Secret** from step 1.
3. Fill in:
   - **ClickUp Team (Workspace) ID** — required. Visible in the ClickUp URL
     (`app.clickup.com/<teamId>/...`).
   - **Default ClickUp List ID** — optional. The List new tasks are created
     in by default; a different List can be chosen per issue instead.
4. Save, then click **Authorize** and complete ClickUp's consent screen.

## 3. Link the integration to a project

Project Settings → Integrations → select the ClickUp integration you just
authorized.

## Notes and limitations

- **Authentication is OAuth2 only** — there is no personal-API-token mode
  for this integration.
- **ClickUp OAuth access tokens do not expire** and there is no refresh
  endpoint, unlike GitHub/GitLab OAuth apps — you will not be asked to
  re-authorize periodically.
- **ClickUp has no flat "project" concept.** Tasks live in a List, nested
  under an optional Folder, under a Space, under the Team (workspace) you
  configured. The project picker in TestPlanIt's issue-linking flow lists
  every List as `Space / [Folder /] List`.
- Custom fields and file attachments are not yet supported by this
  integration.
