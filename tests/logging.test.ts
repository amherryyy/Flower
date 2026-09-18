import { describe, expect, it } from "vitest";
import {
  createStructuredLogEvent,
  writeStructuredLog,
  type StructuredLogEvent,
  type StructuredLogSink,
  type StructuredLoggingPolicy
} from "../packages/kernel/src/index.js";

const policy: StructuredLoggingPolicy = {
  enabled: true,
  include: ["src/**"],
  forbidConsole: true,
  forbiddenKeys: ["body", "requestBody", "rawBody", "prompt", "messages", "formData"],
  redactedKeys: ["password", "secret", "token", "authorization", "cookie", "apiKey", "privateKey", "email", "phone", "address", "ip", "userAgent"],
  allowedKeys: ["count", "description", "detail", "model", "nested", "self"],
  maxAttributeDepth: 8,
  maxEventBytes: 4096
};

class Sink implements StructuredLogSink {
  events: StructuredLogEvent[] = [];
  fail = false;
  async write(event: StructuredLogEvent): Promise<void> {
    if (this.fail) throw new Error("offline");
    this.events.push(event);
  }
}

describe("structured logging", () => {
  it("redacts personal fields and recognizable secrets recursively", () => {
    const event = createStructuredLogEvent({
      event: "auth.sign-in.failed",
      level: "warn",
      requestId: "request-123",
      attributes: {
        emailAddress: "person@example.test",
        accessToken: "not-for-logs",
        description: "ordinary operational text",
        detail: "Bearer visible-token from 203.0.113.7 and person@example.test"
      }
    }, policy, () => new Date("2026-09-19T00:00:00.000Z"));
    expect(event).toEqual(expect.objectContaining({
      timestamp: "2026-09-19T00:00:00.000Z",
      attributes: {
        emailAddress: "[REDACTED]",
        accessToken: "[REDACTED]",
        description: "ordinary operational text",
        detail: "Bearer [REDACTED] from [REDACTED_IP] and [REDACTED_EMAIL]"
      }
    }));
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.attributes)).toBe(true);
  });

  it("rejects request bodies, prompts, and message collections at any depth", () => {
    expect(() => createStructuredLogEvent({
      event: "ai.request",
      level: "info",
      attributes: { model: "example", nested: { prompt: "private content" } }
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.forbiddenField" }));
    expect(() => createStructuredLogEvent({
      event: "auth.request",
      level: "info",
      attributes: { requestBody: { password: "private" } }
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.forbiddenField" }));
    expect(() => createStructuredLogEvent({
      event: "system.unreviewed",
      level: "info",
      attributes: { arbitraryPayload: "not approved" } as never
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.invalidAttribute" }));
  });

  it("rejects cycles, non-finite values, and oversized events", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createStructuredLogEvent({
      event: "system.cycle",
      level: "error",
      attributes: cyclic as never
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.invalidAttribute" }));
    expect(() => createStructuredLogEvent({
      event: "system.number",
      level: "error",
      attributes: { count: Number.NaN }
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.invalidAttribute" }));
    expect(() => createStructuredLogEvent({
      event: "system.large",
      level: "info",
      attributes: { detail: "x".repeat(5000) }
    }, policy)).toThrowError(expect.objectContaining({ code: "logging.eventTooLarge" }));
  });

  it("writes only the sanitized event and reports sink failure", async () => {
    const sink = new Sink();
    await expect(writeStructuredLog(sink, policy, {
      event: "job.completed",
      level: "info",
      attributes: { apiKey: "hidden", count: 2 }
    })).resolves.toEqual(expect.objectContaining({ attributes: { apiKey: "[REDACTED]", count: 2 } }));
    expect(sink.events).toHaveLength(1);
    sink.fail = true;
    await expect(writeStructuredLog(sink, policy, {
      event: "job.failed",
      level: "error"
    })).rejects.toEqual(expect.objectContaining({ code: "logging.sinkUnavailable" }));
  });
});
