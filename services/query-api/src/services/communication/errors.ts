export class CommunicationDomainError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CommunicationDomainError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function communicationError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): CommunicationDomainError {
  return new CommunicationDomainError(statusCode, code, message, details);
}
