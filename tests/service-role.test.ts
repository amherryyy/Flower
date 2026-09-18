import { describe, expect, it } from "vitest";
import {
  executeServiceRoleOperation,
  ServiceRoleBoundaryError,
  ServiceRoleOperationRegistry,
  type PreparedServiceRoleOperation,
  type ServiceRoleAuditEvent,
  type ServiceRoleAuditSink,
  type ServiceRoleAuthorizer,
  type ServiceRoleDataPort
} from "../packages/kernel/src/index.js";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const actorId = "123e4567-e89b-42d3-a456-426614174001";
const organizationId = "123e4567-e89b-42d3-a456-426614174002";

class DataPort implements ServiceRoleDataPort {
  operations: PreparedServiceRoleOperation[] = [];
  async execute(operation: PreparedServiceRoleOperation): Promise<readonly Record<string, unknown>[]> {
    this.operations.push(operation);
    return [{ id: "document-1", status: "approved", private_notes: "must not escape" }];
  }
}

class AuditSink implements ServiceRoleAuditSink {
  events: ServiceRoleAuditEvent[] = [];
  fail = false;
  async record(event: ServiceRoleAuditEvent): Promise<void> {
    if (this.fail) throw new Error("audit unavailable");
    this.events.push(event);
  }
}

class Authorizer implements ServiceRoleAuthorizer {
  allowed = true;
  requests: Parameters<ServiceRoleAuthorizer["authorize"]>[0][] = [];
  async authorize(request: Parameters<ServiceRoleAuthorizer["authorize"]>[0]): Promise<boolean> {
    this.requests.push(request);
    return this.allowed;
  }
}

function registry(): ServiceRoleOperationRegistry {
  return new ServiceRoleOperationRegistry([{
    name: "documents.approve",
    action: "update",
    table: "public.documents",
    selectedColumns: ["id", "status"],
    allowedFilterColumns: ["id"],
    allowedWriteColumns: ["status"],
    organizationColumn: "organization_id"
  }]);
}

describe("service-role operation boundary", () => {
  it("dispatches a named scoped operation and projects fixed result columns", async () => {
    const port = new DataPort();
    const audit = new AuditSink();
    const authorizer = new Authorizer();
    const result = await executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      filters: { id: "document-1" },
      values: { status: "approved" }
    }, () => new Date("2026-09-19T00:00:00.000Z"));

    expect(result).toEqual([{ id: "document-1", status: "approved" }]);
    expect(port.operations[0]).toEqual(expect.objectContaining({
      action: "update",
      table: "public.documents",
      selectedColumns: ["id", "status"],
      filters: { id: "document-1", organization_id: organizationId },
      values: { status: "approved" }
    }));
    expect(audit.events).toEqual([expect.objectContaining({
      operation: "documents.approve",
      organizationId,
      timestamp: "2026-09-19T00:00:00.000Z"
    })]);
    expect(JSON.stringify(audit.events)).not.toContain("document-1");
    expect(JSON.stringify(audit.events)).not.toContain("approved");
    expect(authorizer.requests).toEqual([expect.objectContaining({ actorId, organizationId, operation: "documents.approve" })]);
  });

  it("rejects unknown operations and non-allowlisted columns", async () => {
    const port = new DataPort();
    const audit = new AuditSink();
    const authorizer = new Authorizer();
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.destroy-all",
      requestId,
      actorId
    })).rejects.toEqual(expect.objectContaining({ code: "serviceRole.operationDenied" }));
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      filters: { id: "document-1" },
      values: { private_notes: "leak" }
    })).rejects.toEqual(expect.objectContaining({ code: "serviceRole.invalidRequest" }));
    expect(port.operations).toHaveLength(0);
  });

  it("requires a narrow filter for updates and rejects conflicting tenant scope", async () => {
    const port = new DataPort();
    const audit = new AuditSink();
    const authorizer = new Authorizer();
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      values: { status: "approved" }
    })).rejects.toEqual(expect.objectContaining({ code: "serviceRole.invalidRequest" }));
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      filters: { id: "document-1", organization_id: actorId },
      values: { status: "approved" }
    })).rejects.toEqual(expect.objectContaining({ code: "serviceRole.invalidRequest" }));
  });

  it("fails closed before data access when audit recording is unavailable", async () => {
    const port = new DataPort();
    const audit = new AuditSink();
    const authorizer = new Authorizer();
    audit.fail = true;
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      filters: { id: "document-1" },
      values: { status: "approved" }
    })).rejects.toEqual(expect.objectContaining<Partial<ServiceRoleBoundaryError>>({ code: "serviceRole.auditUnavailable" }));
    expect(port.operations).toHaveLength(0);
  });

  it("requires authorization before audit or privileged data access", async () => {
    const port = new DataPort();
    const audit = new AuditSink();
    const authorizer = new Authorizer();
    authorizer.allowed = false;
    await expect(executeServiceRoleOperation(registry(), port, audit, authorizer, {
      operation: "documents.approve",
      requestId,
      actorId,
      organizationId,
      filters: { id: "document-1" },
      values: { status: "approved" }
    })).rejects.toEqual(expect.objectContaining({ code: "serviceRole.operationDenied" }));
    expect(audit.events).toHaveLength(0);
    expect(port.operations).toHaveLength(0);
  });

  it("rejects policies that expose wildcard columns", () => {
    expect(() => new ServiceRoleOperationRegistry([{
      name: "documents.read",
      action: "select",
      table: "public.documents",
      selectedColumns: ["*"],
      allowedFilterColumns: ["id"],
      allowedWriteColumns: []
    }])).toThrowError(expect.objectContaining({ code: "serviceRole.invalidPolicy" }));
  });

  it("snapshots and freezes policy columns at registration", () => {
    const selectedColumns = ["id"];
    const registered = new ServiceRoleOperationRegistry([{
      name: "documents.read",
      action: "select",
      table: "public.documents",
      selectedColumns,
      allowedFilterColumns: ["id"],
      allowedWriteColumns: []
    }]);
    selectedColumns.push("private_notes");
    expect(registered.get("documents.read")?.selectedColumns).toEqual(["id"]);
    expect(Object.isFrozen(registered.get("documents.read")?.selectedColumns)).toBe(true);
  });
});
