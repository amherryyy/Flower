import type { RlsBehaviorScenario } from "./rls-behavior.js";

export interface OfficialRlsFixtureIds {
  organizationId: string;
  ownerUserId: string;
  memberUserId: string;
  outsiderUserId: string;
  auditEventId: string;
  roleId: string;
}

export function officialRlsBehaviorScenarios(fixtures: OfficialRlsFixtureIds): RlsBehaviorScenario[] {
  return [
    {
      id: "member-sees-organization",
      role: "authenticated",
      userId: fixtures.memberUserId,
      sql: "select exists(select 1 from public.organizations where id = $1) as visible;",
      values: [fixtures.organizationId],
      expected: { kind: "scalar-equals", value: true }
    },
    {
      id: "outsider-cannot-see-organization",
      role: "authenticated",
      userId: fixtures.outsiderUserId,
      sql: "select exists(select 1 from public.organizations where id = $1) as visible;",
      values: [fixtures.organizationId],
      expected: { kind: "scalar-equals", value: false }
    },
    {
      id: "owner-with-permission-sees-audit",
      role: "authenticated",
      userId: fixtures.ownerUserId,
      sql: "select exists(select 1 from public.audit_events where id = $1) as visible;",
      values: [fixtures.auditEventId],
      expected: { kind: "scalar-equals", value: true }
    },
    {
      id: "member-without-permission-cannot-see-audit",
      role: "authenticated",
      userId: fixtures.memberUserId,
      sql: "select exists(select 1 from public.audit_events where id = $1) as visible;",
      values: [fixtures.auditEventId],
      expected: { kind: "scalar-equals", value: false }
    },
    {
      id: "anonymous-cannot-read-organizations",
      role: "anon",
      userId: null,
      sql: "select count(*) from public.organizations;",
      expected: { kind: "error", sqlState: "42501" }
    },
    {
      id: "member-cannot-write-role-table",
      role: "authenticated",
      userId: fixtures.memberUserId,
      sql: "insert into public.roles (id, organization_id, name) values ($1, $2, 'forbidden');",
      values: [fixtures.roleId, fixtures.organizationId],
      expected: { kind: "error", sqlState: "42501" }
    },
    {
      id: "last-owner-cannot-remove-self",
      role: "authenticated",
      userId: fixtures.ownerUserId,
      sql: "select flower_private.remove_organization_member($1, $2);",
      values: [fixtures.organizationId, fixtures.ownerUserId],
      expected: { kind: "error", sqlState: "23514" }
    }
  ];
}
