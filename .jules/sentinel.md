## 2026-09-24 - Stop leaking error stack traces in API routes
**Vulnerability:** API routes (process, spec, digest) were leaking raw error messages (like `err.message` or AI processing errors) directly in HTTP 500/502 responses.
**Learning:** Returning `String(err)` or `err.message` in Next.js/Express responses exposes internal failure reasons, which can help attackers understand the backend structure or trigger specific edge cases.
**Prevention:** Catch blocks should log the detailed error using a secure logger but only return generic error codes or messages to the client (e.g. `jsonError(500, 'internal_error')`). Always fail securely without leaking internal state.
