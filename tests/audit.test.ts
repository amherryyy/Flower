import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  type PostgresMigrationClient,
  type PostgresQueryResult
} from "../packages/kernel/src/index.js";

class AuditClient implements PostgresMigrationClient {
  calls: Array<{ text: string; values: readonly unknown[] }> = [];
  row: Record<string, unknown> = {
    id: "123e4567-e89b-42d3-a456-426614174003",
    occurred_at: "2026-09-19T01:00:00.000Z"
  };
  error?: Error;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ text, values });
    if (this.error) throw this.error;
    return { rows: [this.row as Row] };
  }
}

const base = {
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  actorUserId: "123e4567-e89b-42d3-a456-426614174001",
  eventType: "membership.role_changed",
  subjectType: "membership",
  subjectId: "member-1"
};

describe("append-only audit events", () => {
  it("appends a validated organization-scoped event", async () => {
    const client = new AuditClient();
    await expect(appendAuditEvent(client, { ...base, payload: { role: { from: "member", to: "owner" } } })).resolves.toEqual({
      id: "123e4567-e89b-42d3-a456-426614174003",
      occurredAt: "2026-09-19T01:00:00.000Z"
    });
    expect(client.calls[0]).toEqual(expect.objectContaining({
      text: expect.stringContaining("append_audit_event"),
      values: [base.organizationId, base.actorUserId, base.eventType, "membership", "member-1", { role: { from: "member", to: "owner" } }]
    }));
  });

  it("rejects sensitive fields recursively before storage", async () => {
    const client = new AuditClient();
    await expect(appendAuditEvent(client, {
      ...base,
      payload: { change: { authorization: "Bearer secret" } }
    })).rejects.toEqual(expect.objectContaining({ code: "audit.sensitivePayload" }));
    expect(client.calls).toHaveLength(0);
  });

  it("rejects malformed identifiers, cycles, and storage responses", async () => {
    const client = new AuditClient();
    await expect(appendAuditEvent(client, { ...base, organizationId: "not-a-uuid" })).rejects.toEqual(
      expect.objectContaining({ code: "audit.invalidRequest" })
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(appendAuditEvent(client, { ...base, payload: cyclic as never })).rejects.toEqual(
      expect.objectContaining({ code: "audit.invalidRequest" })
    );
    client.row = { id: "bad", occurred_at: "never" };
    await expect(appendAuditEvent(client, base)).rejects.toEqual(expect.objectContaining({ code: "audit.invalidResponse" }));
  });

  it("fails closed when audit storage is unavailable", async () => {
    const client = new AuditClient();
    client.error = new Error("database offline");
    await expect(appendAuditEvent(client, base)).rejects.toEqual(expect.objectContaining({ code: "audit.unavailable" }));
  });
});
