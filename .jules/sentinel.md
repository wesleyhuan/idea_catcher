## 2024-10-24 - Stack Trace and Error Leakage in API Responses
**Vulnerability:** Internal error messages (e.g. AI processing errors, specific system failures) were being leaked in the JSON response details for HTTP 500/502 on multiple API routes (`/api/process`, `/api/spec`, `/api/digest`).
**Learning:** Returning `err.message` in error payloads can expose backend internals (like stack traces or infrastructure specifics) to a potential attacker.
**Prevention:** Avoid passing raw exception messages or stack traces into `jsonError` or directly to clients. Ensure only generic error descriptors are returned unless it's a safe validation message.
