## 2025-10-24 - Do not leak internal error details

**Vulnerability:** API endpoints were returning internal error details (`err.message` or `String(err)`) to the client inside `500` or `502` json responses.
**Learning:** Detailed error messages can leak internal system architecture, stack traces, and database constraints.
**Prevention:** Catch blocks should log the detailed error internally (`log.error`) but only return a generic HTTP status response to the client (e.g., `jsonError(500, "internal_error")`).
