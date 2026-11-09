export const DEFAULT_TRIAL_CONTACT = "sales@testplanit.com";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The trial contact is whatever `NEXT_PUBLIC_CONTACT_EMAIL` holds: a bare
 * email address, a `mailto:` link, or a web page such as a contact form.
 */
export function resolveTrialContact(
  env: Record<string, string | undefined> = process.env
): string {
  return env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || DEFAULT_TRIAL_CONTACT;
}

/** True when the contact is a link with a scheme rather than a bare email. */
export function isContactLink(contact: string): boolean {
  return URL_SCHEME.test(contact);
}

/** True when the contact opens a web page rather than the mail client. */
export function isContactWebLink(contact: string): boolean {
  return /^https?:/i.test(contact);
}

/**
 * Builds the href for the "Contact Sales" link. A bare email address becomes
 * a `mailto:` link; links are used as given. The subject is only attached to
 * mail links that do not already carry a query string.
 */
export function trialContactHref(contact: string, subject?: string): string {
  const href = isContactLink(contact) ? contact : `mailto:${contact}`;
  if (!subject || !/^mailto:/i.test(href) || href.includes("?")) {
    return href;
  }
  return `${href}?subject=${encodeURIComponent(subject)}`;
}
