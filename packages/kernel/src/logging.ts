import type { SecurityBaseline } from "./types.js";

export type StructuredLogLevel = "debug" | "info" | "warn" | "error";
export type StructuredLogValue = null | boolean | number | string | readonly StructuredLogValue[] | { readonly [key: string]: StructuredLogValue };
export type StructuredLoggingPolicy = SecurityBaseline["logging"];

export interface StructuredLogInput {
  event: string;
  level: StructuredLogLevel;
  requestId?: string;
  actorId?: string;
  organizationId?: string;
  attributes?: Readonly<Record<string, StructuredLogValue>>;
}

export interface StructuredLogEvent extends StructuredLogInput {
  timestamp: string;
  attributes: Readonly<Record<string, StructuredLogValue>>;
}

export interface StructuredLogSink {
  write(event: StructuredLogEvent): Promise<void>;
}

export class LoggingPolicyError extends Error {
  readonly code:
    | "logging.invalidEvent"
    | "logging.forbiddenField"
    | "logging.invalidAttribute"
    | "logging.eventTooLarge"
    | "logging.sinkUnavailable";
  readonly cause?: unknown;

  constructor(message: string, code: LoggingPolicyError["code"], cause?: unknown) {
    super(message);
    this.name = "LoggingPolicyError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function redactedKey(key: string, configured: readonly string[]): boolean {
  const normalized = normalizedKey(key);
  return configured.some((entry) => {
    const sensitive = normalizedKey(entry);
    return normalized === sensitive || normalized.startsWith(sensitive) || normalized.endsWith(sensitive);
  });
}

function redactString(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|(?:ghp|gho|ghu|ghs|ghr|sb_secret)_[A-Za-z0-9_-]+)\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
}

function sanitizeValue(
  value: unknown,
  key: string,
  policy: StructuredLoggingPolicy,
  depth: number,
  seen: WeakSet<object>
): StructuredLogValue {
  const normalized = normalizedKey(key);
  if (policy.forbiddenKeys.some((entry) => normalizedKey(entry) === normalized)) {
    throw new LoggingPolicyError(`Logging field '${key}' is forbidden`, "logging.forbiddenField");
  }
  if (redactedKey(key, policy.redactedKeys)) return "[REDACTED]";
  if (key !== "attributes" && key !== "item" && !policy.allowedKeys.some((entry) => normalizedKey(entry) === normalized)) {
    throw new LoggingPolicyError(`Logging field '${key}' is not allowlisted`, "logging.invalidAttribute");
  }
  if (depth > policy.maxAttributeDepth) {
    throw new LoggingPolicyError("Structured log attributes exceed the configured depth", "logging.invalidAttribute");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LoggingPolicyError("Structured log numbers must be finite", "logging.invalidAttribute");
    return value;
  }
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") {
    throw new LoggingPolicyError("Structured log attributes must be JSON-compatible", "logging.invalidAttribute");
  }
  if (seen.has(value)) throw new LoggingPolicyError("Structured log attributes must not contain cycles or shared references", "logging.invalidAttribute");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, "item", policy, depth + 1, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new LoggingPolicyError("Structured log objects must be plain records", "logging.invalidAttribute");
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeValue(childValue, childKey, policy, depth + 1, seen)
  ]));
}

export function createStructuredLogEvent(
  input: StructuredLogInput,
  policy: StructuredLoggingPolicy,
  now: () => Date = () => new Date()
): StructuredLogEvent {
  if (!/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/.test(input.event)) {
    throw new LoggingPolicyError("Structured log event name is invalid", "logging.invalidEvent");
  }
  if (!["debug", "info", "warn", "error"].includes(input.level)) {
    throw new LoggingPolicyError("Structured log level is invalid", "logging.invalidEvent");
  }
  for (const [field, value] of [["requestId", input.requestId], ["actorId", input.actorId], ["organizationId", input.organizationId]] as const) {
    if (value !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw new LoggingPolicyError(`${field} is invalid`, "logging.invalidEvent");
    }
  }
  const timestamp = now();
  if (Number.isNaN(timestamp.valueOf())) throw new LoggingPolicyError("Structured log timestamp is invalid", "logging.invalidEvent");
  const attributes = sanitizeValue(input.attributes ?? {}, "attributes", policy, 0, new WeakSet()) as Record<string, StructuredLogValue>;
  const event: StructuredLogEvent = {
    event: input.event,
    level: input.level,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    timestamp: timestamp.toISOString(),
    attributes
  };
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > policy.maxEventBytes) {
    throw new LoggingPolicyError("Structured log event exceeds the configured byte limit", "logging.eventTooLarge");
  }
  return deepFreeze(event);
}

export async function writeStructuredLog(
  sink: StructuredLogSink,
  policy: StructuredLoggingPolicy,
  input: StructuredLogInput,
  now?: () => Date
): Promise<StructuredLogEvent> {
  const event = createStructuredLogEvent(input, policy, now);
  try {
    await sink.write(event);
    return event;
  } catch (error) {
    throw new LoggingPolicyError("Structured log sink is unavailable", "logging.sinkUnavailable", error);
  }
}
