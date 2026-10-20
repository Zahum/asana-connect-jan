export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Error thrown for non-2xx Asana responses; keeps the HTTP status for callers. */
export class AsanaApiError extends Error {
  constructor(public status: number, body: string) {
    super(`Asana API error ${status}: ${body}`);
    this.name = "AsanaApiError";
  }
}
