export type ServiceRoleScalar = string | number | boolean | null;
export type ServiceRoleAction = "select" | "insert" | "update" | "delete";

export interface ServiceRoleOperationPolicy {
  name: string;
  action: ServiceRoleAction;
  table: string;
  selectedColumns: readonly string[];
  allowedFilterColumns: readonly string[];
  allowedWriteColumns: readonly string[];
  organizationColumn?: string;
}

export interface ServiceRoleOperationRequest {
  operation: string;
  requestId: string;
  actorId: string;
  organizationId?: string;
  filters?: Readonly<Record<string, ServiceRoleScalar>>;
  values?: Readonly<Record<string, ServiceRoleScalar>>;
}

export interface PreparedServiceRoleOperation {
  operation: string;
  action: ServiceRoleAction;
  table: string;
  selectedColumns: readonly string[];
  filters: Readonly<Record<string, ServiceRoleScalar>>;
  values: Readonly<Record<string, ServiceRoleScalar>>;
}

export interface ServiceRoleDataPort {
  execute(operation: PreparedServiceRoleOperation): Promise<readonly Record<string, unknown>[]>;
}

export interface ServiceRoleAuditEvent {
  event: "service-role.operation.attempt";
  requestId: string;
  actorId: string;
  operation: string;
  action: ServiceRoleAction;
  table: string;
  organizationId?: string;
  timestamp: string;
}

export interface ServiceRoleAuditSink {
  record(event: ServiceRoleAuditEvent): Promise<void>;
}

export interface ServiceRoleAuthorizationRequest {
  actorId: string;
  operation: string;
  action: ServiceRoleAction;
  table: string;
  organizationId?: string;
}

export interface ServiceRoleAuthorizer {
  authorize(request: ServiceRoleAuthorizationRequest): Promise<boolean>;
}

export class ServiceRoleBoundaryError extends Error {
  readonly code:
    | "serviceRole.invalidPolicy"
    | "serviceRole.operationDenied"
    | "serviceRole.invalidRequest"
    | "serviceRole.authorizationUnavailable"
    | "serviceRole.auditUnavailable"
    | "serviceRole.operationFailed";
  readonly cause?: unknown;

  constructor(message: string, code: ServiceRoleBoundaryError["code"], cause?: unknown) {
    super(message);
    this.name = "ServiceRoleBoundaryError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const OPERATION = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTable(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 2 && parts.every((part) => IDENTIFIER.test(part));
}

function assertPolicy(policy: ServiceRoleOperationPolicy): void {
  const columns = [...policy.selectedColumns, ...policy.allowedFilterColumns, ...policy.allowedWriteColumns];
  if (
    !OPERATION.test(policy.name) ||
    !validTable(policy.table) ||
    policy.selectedColumns.length === 0 ||
    columns.some((column) => !IDENTIFIER.test(column)) ||
    (policy.organizationColumn !== undefined && !IDENTIFIER.test(policy.organizationColumn)) ||
    ((policy.action === "insert" || policy.action === "update") && policy.allowedWriteColumns.length === 0) ||
    ((policy.action === "select" || policy.action === "delete") && policy.allowedWriteColumns.length > 0)
  ) {
    throw new ServiceRoleBoundaryError(`Service-role policy '${policy.name}' is invalid`, "serviceRole.invalidPolicy");
  }
}

export class ServiceRoleOperationRegistry {
  readonly #policies = new Map<string, ServiceRoleOperationPolicy>();

  constructor(policies: readonly ServiceRoleOperationPolicy[]) {
    for (const policy of policies) {
      assertPolicy(policy);
      if (this.#policies.has(policy.name)) {
        throw new ServiceRoleBoundaryError(`Duplicate service-role operation '${policy.name}'`, "serviceRole.invalidPolicy");
      }
      this.#policies.set(policy.name, Object.freeze({
        ...policy,
        selectedColumns: Object.freeze([...policy.selectedColumns]),
        allowedFilterColumns: Object.freeze([...policy.allowedFilterColumns]),
        allowedWriteColumns: Object.freeze([...policy.allowedWriteColumns])
      }));
    }
  }

  get(name: string): ServiceRoleOperationPolicy | undefined {
    return this.#policies.get(name);
  }
}

function keysAllowed(values: Readonly<Record<string, ServiceRoleScalar>>, allowed: readonly string[]): boolean {
  return Object.keys(values).every((key) => allowed.includes(key));
}

export async function executeServiceRoleOperation(
  registry: ServiceRoleOperationRegistry,
  port: ServiceRoleDataPort,
  audit: ServiceRoleAuditSink,
  authorizer: ServiceRoleAuthorizer,
  request: ServiceRoleOperationRequest,
  now: () => Date = () => new Date()
): Promise<readonly Record<string, unknown>[]> {
  const policy = registry.get(request.operation);
  if (!policy) throw new ServiceRoleBoundaryError("Service-role operation is not allowlisted", "serviceRole.operationDenied");
  const filters = { ...(request.filters ?? {}) };
  const values = { ...(request.values ?? {}) };
  if (!UUID.test(request.requestId) || !UUID.test(request.actorId)) {
    throw new ServiceRoleBoundaryError("Request and actor identifiers must be UUIDs", "serviceRole.invalidRequest");
  }
  if (!keysAllowed(filters, policy.allowedFilterColumns) || !keysAllowed(values, policy.allowedWriteColumns)) {
    throw new ServiceRoleBoundaryError("Request contains a non-allowlisted filter or write column", "serviceRole.invalidRequest");
  }
  if ((policy.action === "insert" || policy.action === "update") !== (Object.keys(values).length > 0)) {
    throw new ServiceRoleBoundaryError("Write values do not match the allowlisted action", "serviceRole.invalidRequest");
  }
  if ((policy.action === "update" || policy.action === "delete") && Object.keys(filters).length === 0) {
    throw new ServiceRoleBoundaryError("Update and delete operations require a caller-supplied filter", "serviceRole.invalidRequest");
  }
  if (policy.organizationColumn) {
    if (!request.organizationId || !UUID.test(request.organizationId)) {
      throw new ServiceRoleBoundaryError("Organization-scoped operation requires an organization UUID", "serviceRole.invalidRequest");
    }
    const supplied = filters[policy.organizationColumn] ?? values[policy.organizationColumn];
    if (supplied !== undefined && supplied !== request.organizationId) {
      throw new ServiceRoleBoundaryError("Organization scope conflicts with request data", "serviceRole.invalidRequest");
    }
    if (policy.action === "insert") values[policy.organizationColumn] = request.organizationId;
    else filters[policy.organizationColumn] = request.organizationId;
  }


  try {
    const authorized = await authorizer.authorize({
      actorId: request.actorId,
      operation: policy.name,
      action: policy.action,
      table: policy.table,
      ...(request.organizationId ? { organizationId: request.organizationId } : {})
    });
    if (!authorized) throw new ServiceRoleBoundaryError("Actor is not authorized for the service-role operation", "serviceRole.operationDenied");
  } catch (error) {
    if (error instanceof ServiceRoleBoundaryError) throw error;
    throw new ServiceRoleBoundaryError("Service-role authorization is unavailable", "serviceRole.authorizationUnavailable", error);
  }

  const event: ServiceRoleAuditEvent = {
    event: "service-role.operation.attempt",
    requestId: request.requestId,
    actorId: request.actorId,
    operation: policy.name,
    action: policy.action,
    table: policy.table,
    ...(request.organizationId ? { organizationId: request.organizationId } : {}),
    timestamp: now().toISOString()
  };
  try {
    await audit.record(event);
  } catch (error) {
    throw new ServiceRoleBoundaryError("Service-role audit sink is unavailable", "serviceRole.auditUnavailable", error);
  }
  try {
    const rows = await port.execute(Object.freeze({
      operation: policy.name,
      action: policy.action,
      table: policy.table,
      selectedColumns: Object.freeze([...policy.selectedColumns]),
      filters: Object.freeze(filters),
      values: Object.freeze(values)
    }));
    return rows.map((row) => Object.fromEntries(
      policy.selectedColumns.filter((column) => Object.hasOwn(row, column)).map((column) => [column, row[column]])
    ));
  } catch (error) {
    throw new ServiceRoleBoundaryError("Allowlisted service-role operation failed", "serviceRole.operationFailed", error);
  }
}
