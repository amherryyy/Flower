import type { PostgresMigrationClient } from "./postgres-migration.js";

export type AuditPayloadValue = null | boolean | number | string | AuditPayloadValue[] | { [key: string]: AuditPayloadValue };

export interface AppendAuditEventRequest {
  organizationId: string;
  actorUserId?: string;
  eventType: string;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, AuditPayloadValue>;
}

export interface AppendedAuditEvent {
  id: string;
  occurredAt: string;
}

export class AuditEventError extends Error {
  readonly code: "audit.invalidRequest" | "audit.sensitivePayload" | "audit.invalidResponse" | "audit.unavailable";
  readonly cause?: unknown;

  constructor(message: string, code: AuditEventError["code"], cause?: unknown) {
    super(message);
    this.name = "AuditEventError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/;
const FORBIDDEN_KEYS = new Set([
  "password", "secret", "token", "authorization", "cookie", "apikey", "privatekey",
  "body", "requestbody", "rawbody", "prompt", "messages", "formdata"
]);

function validatePayload(value: unknown, seen: Set<object>, depth = 0): void {
  if (depth > 8) throw new AuditEventError("Audit payload exceeds the maximum depth", "audit.invalidRequest");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AuditEventError("Audit payload numbers must be finite", "audit.invalidRequest");
    return;
  }
  if (typeof value !== "object") throw new AuditEventError("Audit payload must contain only JSON values", "audit.invalidRequest");
  if (seen.has(value)) throw new AuditEventError("Audit payload must not contain cycles", "audit.invalidRequest");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validatePayload(item, seen, depth + 1);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new AuditEventError("Audit payload must contain plain objects", "audit.invalidRequest");
    }
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new AuditEventError(`Audit payload field '${key}' is forbidden`, "audit.sensitivePayload");
      }
      validatePayload(item, seen, depth + 1);
    }
  }
  seen.delete(value);
}

export async function appendAuditEvent(
  client: PostgresMigrationClient,
  request: AppendAuditEventRequest
): Promise<AppendedAuditEvent> {
  if (!UUID.test(request.organizationId) || (request.actorUserId !== undefined && !UUID.test(request.actorUserId))) {
    throw new AuditEventError("Organization and actor identifiers must be UUIDs", "audit.invalidRequest");
  }
  if (!EVENT_TYPE.test(request.eventType)) {
    throw new AuditEventError("Audit event type must be a stable lowercase identifier", "audit.invalidRequest");
  }
  const payload = request.payload ?? {};
  validatePayload(payload, new Set());
  try {
    const response = await client.query<{ id: unknown; occurred_at: unknown }>(
      "select id, occurred_at from flower_private.append_audit_event($1, $2, $3, $4, $5, $6);",
      [request.organizationId, request.actorUserId ?? null, request.eventType, request.subjectType ?? null, request.subjectId ?? null, payload]
    );
    const row = response.rows[0];
    const occurredAt = row?.occurred_at instanceof Date
      ? row.occurred_at
      : typeof row?.occurred_at === "string" ? new Date(row.occurred_at) : undefined;
    if (typeof row?.id !== "string" || !UUID.test(row.id) || !occurredAt || Number.isNaN(occurredAt.valueOf())) {
      throw new AuditEventError("PostgreSQL returned an invalid audit event", "audit.invalidResponse");
    }
    return { id: row.id, occurredAt: occurredAt.toISOString() };
  } catch (error) {
    if (error instanceof AuditEventError) throw error;
    throw new AuditEventError("Audit event storage is unavailable", "audit.unavailable", error);
  }
}
