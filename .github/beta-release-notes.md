**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.14

#### Permissions & access

- **The menu no longer advertises pages that 404.** A user whose role granted
  Reporting could see the Reports link and get a 404 on it: the navigation, the
  page's own guard, and the API each decided "can you see this?" independently,
  so wherever they disagreed the menu offered a page that refused to open. Each
  page now gates on exactly what its own server side enforces. Two deliberate
  consequences: project settings pages require project admin — the rule the
  server was already applying, so system Project Admins not assigned to a
  project lose a settings UI whose every save would have failed — and the
  `lead` role no longer shows a settings menu whose pages all 404'd.
- **Permission changes now take up to a minute to appear.** Project access
  resolution is cached for 60 seconds, so granting or revoking project
  permissions, changing project assignments, editing a project's default access
  type or role, and adding or removing someone from a group are all bounded by
  that window. Two things are not: deactivating an account and changing a
  password both apply on the user's next request. Changing someone's system
  access level reaches the resolver through the session cache, so an
  already-signed-in user can briefly keep the previous level. **For an urgent
  removal, deactivate the account** — that is the only change that applies
  immediately. The permissions guide documents this under Permission Resolution.

#### Search

- **Records created inside long transactions reach the index.** Elasticsearch
  syncing ran inside the still-open transaction and read the row back on a
  separate connection, which couldn't see it yet — short writes usually won the
  race and indexed fine, long ones silently didn't. On this instance that left
  27 API-created cases missing from the index, all in consecutive runs: the
  signature of bulk imports sharing one transaction. Worse than lossy for
  repository cases, where a row that isn't visible yet reads as "deleted" and
  the document was removed. Indexing now runs after the commit, and never at
  all if the write rolls back.
- **Deleting a record now removes it from search.** Most models simply skipped
  deletes, which is why orphaned documents could outlive their rows.
- **Milestones synced from a tracker are indexed as they sync.** They reached
  the index only if a full reindex happened to run later — 49 live milestones
  were absent here, and 5 more were indexed as active after the row had been
  completed.
- **Forecast recalculations reindex the cases and runs they touch.** The
  forecast fields are part of the indexed document, so search kept whatever
  values the row had when something else last reindexed it.

#### Integrations

- **Integration credentials are encrypted on every save.** The admin form wrote
  the model directly, so client secrets and API tokens typed into it were stored
  in cleartext — the encrypting routes had no callers. Saving now goes through
  them. Because secrets are never sent back to the browser, those inputs start
  blank and a blank field means "keep what's stored", so re-entering only a
  client secret no longer drops the client ID with it. Editing an integration
  also evicts the cached adapter, which used to keep serving the old values
  until restart, and creating one now keeps its settings and status instead of
  discarding them.
- **Jira integrations that stored a cleartext secret work again.** beta.14
  tightened the credential read to refuse anything that wasn't ciphertext, which
  broke every OAuth2 path — authorize, callback, projects, search, create issue
  — for rows written before the encrypting path existed, with advice to re-enter
  the credentials that couldn't be followed because authorization itself failed.
  Stored cleartext is read and used; new writes are encrypted.
- **Releasing a Jira version registers even under load.** A sync lock already
  held by another refresh was reported as success, so a lifecycle event arriving
  behind a burst of edits was discarded while the lock holder wrote back
  pre-transition state. Observed here: seven `version_released` deliveries
  dropped in about 100ms each, leaving the version reading `active` across five
  projects for roughly seven hours. State transitions now wait for the lock, and
  a transition that still can't get it is recorded in the delivery's audit
  metadata instead of logging as a clean refresh.

#### Milestones

- **Start and due dates are calendar dates.** A Jira version dated Aug 13 showed
  as "Aug 12, 7:00 PM" west of UTC and went overdue a full day early, because a
  bare `yyyy-MM-dd` was being read as UTC midnight and then converted into the
  viewer's timezone. The two write paths disagreed as well — the date picker
  stored browser-local midnight, the sync stored UTC. Dates are now pinned and
  read as calendar days, and "overdue" compares whole days against the reader's
  own day. Jira sprints keep converting: their boundaries carry a real time,
  typically 23:59 in the Jira instance's own zone.

#### Repository

- **Export and column sort work while a custom-field filter is active.** The
  "has a value" filter couldn't survive the trip from browser to server, and the
  failure was swallowed as an empty result — so CSV and PDF export produced no
  file and no error, and sorting by a dropdown column emptied the table.

#### Reviews

- **System administrators are never blocked by a workflow review gate** and can
  set any case, run, or session to any state without an approved request.
  Crossing a gate this way consumes no approval, so a pending request stays
  available for the transition it was raised for.

#### Performance

- **Two of the heaviest query patterns on the instance are gone.** The password
  change and deactivation guards each ran their own lookup against the same user
  row on every session check — together 16% of all database queries — and now
  read in one. Project access resolution, another 37%, was running four queries
  per request with no caching and is now cached for 60 seconds (see Permissions
  above). Neither guard is weakened: both are still uncached reads on every
  session check, so a stale session cannot outlive a password change or a
  deactivation.

### Try it

1. Download **Source code (zip / tar.gz)** from the Assets below (or
   `git checkout` this tag).
2. Configure your environment:
   ```bash
   cp testplanit/.env.example testplanit/.env.production   # then fill in values
   ```
3. Build and run (the compose file builds from source):
   ```bash
   docker compose -f testplanit/docker-compose.prod.yml up -d --build
   ```
   Serving multiple subdomains off one image? Build with your own wildcard:
   `--build-arg BASE_DOMAIN=<your-domain>`.
4. **Upgrading an existing database?** v3 uses versioned migrations. Run the
   one-time baseline **before** first boot, then start normally (the container
   applies the rest on startup):
   ```bash
   cd testplanit
   npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
   ```

Full walkthrough: **https://docs.testplanit.com/docs/building-from-source**

Found a problem? [Open an issue](https://github.com/TestPlanIt/testplanit/issues/new)
and add the **beta** label.
