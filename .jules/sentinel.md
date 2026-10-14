## 2026-10-14 - Prevent Stack Trace/Error Detail Leakage via API and Database

**Vulnerability:** The application was catching exceptions from AI calls and database operations, extracting `err.message` (or `String(err)`), and sending it directly back in `5xx` JSON error responses (e.g. `jsonError(500, 'internal_error', err.message)`). Additionally, `processCapture.ts` was persisting these unfiltered exception messages directly into the database.

**Learning:** This is a classic information disclosure vulnerability. If an unhandled exception occurs (e.g., database connection string issue, network timeout with specific internal URLs, or Claude API misconfiguration), the raw error message could leak internal system state, configuration details, or internal identifiers to end users or anonymous attackers.

**Prevention:** Always "fail securely". Return generic, safe error messages to clients (e.g., `'ai_failed'`, `'internal_error'`) and persist similarly generic status messages in the database. Raw error details should be sent exclusively to secure, internal server logs (`log.error(..., { err })`), never across trust boundaries.
