/**
 * Pure, DB-free, log-free bidirectional SCIM ↔ Prisma User mapper.
 *
 * Stubs only — every export throws "not implemented" until the GREEN step.
 */

export interface ScimEmail {
  value: string;
  primary?: boolean;
  type?: string;
  display?: string;
}

export interface ScimUserName {
  formatted?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
}

export interface ScimUserBody {
  schemas?: string[];
  userName: string;
  externalId?: string;
  name?: ScimUserName;
  emails?: ScimEmail[];
  active?: boolean;
  displayName?: string;
  locale?: string;
  title?: string;
  timezone?: string;
  profileUrl?: string;
  roles?: unknown[];
  groups?: unknown[];
  password?: string;
  [urn: string]: unknown;
}

export interface ScimMeta {
  resourceType: "User";
  location: string;
  version: string;
  lastModified: string;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName?: string;
  externalId?: string;
  name?: ScimUserName;
  emails?: ScimEmail[];
  active?: boolean;
  groups?: Array<{ value: string; display: string }>;
  meta: ScimMeta;
  [urn: string]: unknown;
}

export interface PrismaUserForScim {
  id: string;
  email: string;
  name: string;
  scimUserName: string | null;
  scimExternalId: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  scimExtensions: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  groups?: Array<{ group: { id: number; name: string } }>;
}

export interface ScimUserCreatePayload {
  scimUserName: string | null;
  scimExternalId: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  name: string;
  email: string | undefined;
  isActive: boolean;
  scimExtensions: Record<string, unknown> | null;
}

export interface ScimUserUpdatePayload {
  scimUserName?: string;
  scimExternalId?: string;
  scimGivenName?: string;
  scimFamilyName?: string;
  name?: string;
  email?: string;
  isActive?: boolean;
  scimExtensions?: Record<string, unknown> | null;
}

export function mergeExtensions(
  _current: unknown,
  _incoming: Record<string, unknown>,
): Record<string, unknown> | null {
  throw new Error("not implemented");
}

export function extractPrimaryEmail(
  _emails: ScimEmail[] | undefined,
): string | undefined {
  throw new Error("not implemented");
}

export function deriveDisplayName(_body: ScimUserBody): string {
  throw new Error("not implemented");
}

export function extractNonWritableUrns(
  _body: Record<string, unknown>,
): Record<string, unknown> {
  throw new Error("not implemented");
}

export function scimToUserCreate(_body: ScimUserBody): ScimUserCreatePayload {
  throw new Error("not implemented");
}

export function userToScim(_user: PrismaUserForScim): ScimUserResource {
  throw new Error("not implemented");
}

export function computeUserUpdatesFromScim(
  _currentScim: ScimUserResource,
  _draftScim: ScimUserResource,
): ScimUserUpdatePayload {
  throw new Error("not implemented");
}
