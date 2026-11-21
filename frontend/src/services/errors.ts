export class ApiError extends Error {
  constructor(
    message: string,
    /** Form field the error belongs to, when applicable. */
    public field?: string,
    /** Machine-readable error code from the backend (e.g. GNANI_BUSY), when applicable. */
    public code?: string,
    /** HTTP status, when the error came from an HTTP response. */
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
