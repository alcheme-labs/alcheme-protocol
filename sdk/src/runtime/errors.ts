export class AlchemeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "AlchemeApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

export async function parseApiErrorResponse(
  response: Response,
  fallbackCode = "request_failed",
): Promise<AlchemeApiError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    return new AlchemeApiError({
      status: response.status,
      code: fallbackCode,
      message: `${fallbackCode}: ${response.status}`,
    });
  }
  const { error, message, ...details } =
    body && typeof body === "object" ? body : {};
  return new AlchemeApiError({
    status: response.status,
    code: typeof error === "string" ? error : fallbackCode,
    message:
      typeof message === "string"
        ? message
        : typeof error === "string"
          ? error
          : `${fallbackCode}: ${response.status}`,
    details: Object.keys(details).length > 0 ? details : undefined,
  });
}
