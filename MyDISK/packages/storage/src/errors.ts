export type StorageErrorCode =
  | "NOT_FOUND"
  | "PATH_TRAVERSAL"
  | "UNREACHABLE"
  | "NOT_IMPLEMENTED"
  | "UPLOAD_SESSION_INVALID"
  | "UNKNOWN";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "StorageError";
    this.code = code;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
