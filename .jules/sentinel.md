## 2023-10-27 - [Information Leakage]
**Vulnerability:** Internal application errors and stack traces were exposed to clients when API routes failed.
**Learning:** API routes in Next.js should handle errors gracefully and only log internal details server-side while returning generic errors to clients.
**Prevention:** Avoid passing raw `err.message` or similar properties to client responses.
