/** Stable outcomes shared by domain, storage and media operations. */
export type FailureCode = 'stale_revision' | 'permission_denied' | 'storage_capacity' | 'storage_unavailable' | 'invalid_media' | 'cancelled' | 'processing_failure' | 'invalid_state' | 'recovery_required';
export interface OperationFailure { code: FailureCode; message: string }
export class OperationError extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); this.name = 'OperationError'; }
}
export function operationFailure(error: unknown, fallback: FailureCode = 'processing_failure'): OperationFailure {
  return error instanceof OperationError ? { code: error.code, message: error.message } : { code: fallback, message: error instanceof Error ? error.message : 'The operation failed.' };
}
