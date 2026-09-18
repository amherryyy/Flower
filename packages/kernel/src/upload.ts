import path from "node:path";
import type { Diagnostic, ValidationResult } from "./types.js";

export interface UploadPolicy {
  $schema?: string;
  schemaVersion: 1;
  maxBytes: number;
  ownerScopes: Array<"user" | "organization">;
  mediaTypes: Array<{
    mediaType: string;
    extensions: string[];
    signatures: string[];
  }>;
}

export interface UploadCandidate {
  fileName: string;
  size: number;
  declaredMediaType: string;
  headerBytes: Uint8Array;
  owner: { scope: "user" | "organization"; id: string };
}

export interface UploadActor {
  userId: string;
  organizationIds: readonly string[];
}

export interface UploadContent {
  candidate: UploadCandidate;
  open(): AsyncIterable<Uint8Array>;
}

export interface UploadMalwareScanner {
  scan(content: UploadContent): Promise<{ verdict: "clean" | "infected" | "unknown"; engine: string }>;
}

export interface UploadSanitizer {
  sanitize(content: UploadContent): Promise<UploadContent>;
}

export interface InspectedUpload {
  content: UploadContent;
  scannerEngines: readonly [string, string];
}

export class UploadInspectionError extends Error {
  readonly code:
    | "upload.validationRejected"
    | "upload.malwareDetected"
    | "upload.scanInconclusive"
    | "upload.scannerUnavailable"
    | "upload.sanitizerUnavailable"
    | "upload.sanitizationRejected";
  readonly diagnostics?: Diagnostic[];
  readonly cause?: unknown;

  constructor(message: string, code: UploadInspectionError["code"], options: { diagnostics?: Diagnostic[]; cause?: unknown } = {}) {
    super(message);
    this.name = "UploadInspectionError";
    this.code = code;
    if (options.diagnostics) this.diagnostics = options.diagnostics;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function issue(code: string, path: string, message: string): Diagnostic {
  return { code, path, message, severity: "error" };
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function signatureMatches(bytes: Uint8Array, signature: string): boolean {
  if (!/^(?:[a-f0-9]{2})+$/i.test(signature)) return false;
  const expected = Buffer.from(signature, "hex");
  return bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value);
}

export function validateUpload(
  policy: UploadPolicy,
  candidate: UploadCandidate,
  actor: UploadActor
): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1 || policy.mediaTypes.length === 0) {
    return { valid: false, diagnostics: [issue("upload.policy.invalid", "/policy", "Upload policy is invalid or empty.")] };
  }
  if (
    candidate.fileName.length < 1 ||
    candidate.fileName.length > 255 ||
    candidate.fileName !== path.basename(candidate.fileName) ||
    /[\\/\u0000-\u001f\u007f]/.test(candidate.fileName) ||
    candidate.fileName === "." ||
    candidate.fileName === ".."
  ) {
    diagnostics.push(issue("upload.fileName", "/fileName", "File name must be a plain, control-free base name of at most 255 characters."));
  }
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 1 || candidate.size > policy.maxBytes) {
    diagnostics.push(issue("upload.size", "/size", `Upload size must be between 1 and ${policy.maxBytes} bytes.`));
  }
  const mediaType = policy.mediaTypes.find((entry) => entry.mediaType === candidate.declaredMediaType.toLowerCase());
  if (!mediaType) {
    diagnostics.push(issue("upload.mediaType", "/declaredMediaType", "Declared media type is not allowed."));
  } else {
    const extension = path.extname(candidate.fileName).toLowerCase();
    if (!mediaType.extensions.includes(extension)) {
      diagnostics.push(issue("upload.extension", "/fileName", "File extension does not match the declared media type."));
    }
    if (!mediaType.signatures.some((signature) => signatureMatches(candidate.headerBytes, signature))) {
      diagnostics.push(issue("upload.signature", "/headerBytes", "File signature does not match the declared media type."));
    }
  }
  if (!policy.ownerScopes.includes(candidate.owner.scope) || !uuid(candidate.owner.id) || !uuid(actor.userId)) {
    diagnostics.push(issue("upload.owner", "/owner", "Upload owner is invalid or uses a disallowed scope."));
  } else if (
    (candidate.owner.scope === "user" && candidate.owner.id !== actor.userId) ||
    (candidate.owner.scope === "organization" && !actor.organizationIds.includes(candidate.owner.id))
  ) {
    diagnostics.push(issue("upload.ownerDenied", "/owner", "The authenticated actor does not own the requested upload scope."));
  }
  diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return { valid: diagnostics.length === 0, diagnostics };
}

async function requireClean(scanner: UploadMalwareScanner, content: UploadContent): Promise<string> {
  let result: Awaited<ReturnType<UploadMalwareScanner["scan"]>>;
  try {
    result = await scanner.scan(content);
  } catch (error) {
    throw new UploadInspectionError("Upload malware scanner is unavailable", "upload.scannerUnavailable", { cause: error });
  }
  if (result.verdict === "infected") {
    throw new UploadInspectionError("Upload was rejected by malware scanning", "upload.malwareDetected");
  }
  if (result.verdict !== "clean" || typeof result.engine !== "string" || result.engine.trim().length === 0) {
    throw new UploadInspectionError("Upload malware scan was inconclusive", "upload.scanInconclusive");
  }
  return result.engine.trim();
}

export async function inspectUpload(
  policy: UploadPolicy,
  content: UploadContent,
  actor: UploadActor,
  scanner: UploadMalwareScanner,
  sanitizer: UploadSanitizer
): Promise<InspectedUpload> {
  if (!content || typeof content.open !== "function" || !content.candidate) {
    throw new UploadInspectionError("Upload content source is invalid", "upload.validationRejected");
  }
  const initial = validateUpload(policy, content.candidate, actor);
  if (!initial.valid) {
    throw new UploadInspectionError("Upload failed policy validation", "upload.validationRejected", { diagnostics: initial.diagnostics });
  }
  const originalEngine = await requireClean(scanner, content);
  let sanitized: UploadContent;
  try {
    sanitized = await sanitizer.sanitize(content);
  } catch (error) {
    throw new UploadInspectionError("Upload sanitizer is unavailable", "upload.sanitizerUnavailable", { cause: error });
  }
  if (!sanitized || typeof sanitized.open !== "function" || !sanitized.candidate) {
    throw new UploadInspectionError("Sanitizer returned an invalid content source", "upload.sanitizationRejected");
  }
  const sanitizedCandidate: UploadCandidate = {
    ...sanitized.candidate,
    fileName: content.candidate.fileName,
    owner: content.candidate.owner
  };
  sanitized = { ...sanitized, candidate: sanitizedCandidate };
  const transformed = validateUpload(policy, sanitized.candidate, actor);
  if (!transformed.valid) {
    throw new UploadInspectionError("Sanitized upload failed policy validation", "upload.sanitizationRejected", { diagnostics: transformed.diagnostics });
  }
  const sanitizedEngine = await requireClean(scanner, sanitized);
  return Object.freeze({ content: sanitized, scannerEngines: Object.freeze([originalEngine, sanitizedEngine]) }) as InspectedUpload;
}
