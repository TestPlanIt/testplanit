# Device-Bound Magic Link Sign-In

TestPlanIt's Magic Link sign-in can run in a **device-bound** mode that is
immune to corporate mail-security link scanners (Microsoft Defender Safe
Links, Mimecast, Proofpoint, Barracuda). With the stock email flow, those
scanners prefetch — and thereby consume — the single-use sign-in link before
the human clicks it, producing "link expired" errors. In device-bound mode the
emailed link is inert on its own: nothing is consumed when a link is opened,
and sign-in completes only in the browser that requested it (or via a short
relay code entered there).

## How it works

1. The user enters their email on the sign-in screen. The server creates a
   pending sign-in and sets an HttpOnly **verifier cookie** in that browser.
   The waiting screen shows a code-entry field.
2. The email contains a **Sign in** link and an 8-character **code**
   (`XXXX-XXXX`).
3. Opening the link **in the same browser** signs the user in with one click.
4. Opening the link **anywhere else** (another device, incognito, an email
   app's in-app browser — or a scanner) shows a page displaying the code.
   Entering that code in the original waiting window completes sign-in there.
5. Sign-in completes exactly once, atomically. A scanner fetching the link any
   number of times changes nothing. Possession of the URL alone can never
   grant access: completing sign-in always requires the verifier cookie held
   only by the requesting browser.

Pending sign-ins last **45 minutes** (mail can be slow), allow **5** code
attempts before locking, and a new request for the same email supersedes any
previous pending link. Only hashes of the secrets are stored: HMAC-SHA256 for
the two 256-bit tokens, and bcrypt over the HMAC for the short relay code.

## Enabling it (per deployment / tenant)

The flow ships behind an environment flag and is **off by default** — the
stock NextAuth email flow keeps working unchanged when the flag is off.

```bash
PASSWORDLESS_DEVICE_BOUND=true
```

Requirements:

- The Magic Link SSO provider must already be enabled (Admin → SSO) and the
  `EMAIL_SERVER_*` / `EMAIL_FROM` variables configured.
- The database schema is synced on boot (`prisma db push`); the flow's
  `PendingAuth` table is purely additive, so the standard rollout picks it up
  automatically. No data migration is involved.

To pilot on a single tenant, set the variable on that tenant's deployment only
and restart it. Roll out fleet-wide by adding it to the shared environment
once validated. Roll back by removing the variable — in-flight device-bound
links stop working (users just request a new link), and the legacy email flow
resumes immediately.

## Validating against a real Safe Links mailbox

Use a mailbox that actually rewrites/prefetches links — an Outlook.com /
Hotmail address, or a Microsoft 365 tenant with Defender Safe Links enabled
(university addresses are ideal).

1. On the staging tenant with `PASSWORDLESS_DEVICE_BOUND=true`, request a
   magic link for a user whose address is on that mailbox.
2. Wait for delivery (Safe Links prefetch happens at delivery time), then wait
   another minute or two for good measure.
3. Click the link in the same browser that requested it. **Expected: signed in
   with one click.** With the stock flow this is the step that failed with
   "link expired".
4. Request a new link, and open it on a phone or an incognito window instead.
   **Expected: a page showing the code, not a session.** Enter the code in the
   original waiting window. **Expected: the original window signs in.**
5. Enter a wrong code 5 times. **Expected: friendly lockout message; the link
   and code stop working; requesting a new link recovers.**
6. Let a link sit past 45 minutes. **Expected: friendly "no longer valid" page
   offering a new link.**

If step 3 fails in a browser that holds the cookie, check that the deployment
serves over HTTPS with a correct `NEXTAUTH_URL` (the verifier cookie is
`__Secure-`-prefixed and `Secure` when `NEXTAUTH_URL` is https).

## Operational notes

- Every step is audited: requests as `MAGIC_LINK_REQUESTED`, completions as
  `LOGIN` (provider `passwordless-complete`), failures as `LOGIN_FAILED` with
  a `passwordless_*` reason.
- The request endpoint is throttled per IP and per email address, and responds
  identically whether or not an account exists.
- Force-2FA-on-all-logins, inactive-user blocking, and session claims behave
  exactly as with the stock email flow.
