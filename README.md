# repo-device-management

Device Management — enrollment, assignment, key binding, revocation

## Local

- Install:       npm ci
- Build:       npm run build
- Test:       npm test -- --passWithNoTests

## Runtime

- Health:         GET /health
- Metrics:         GET /metrics
- Internal service auth: set `INTERNAL_SERVICE_TOKEN`; internal callers send `X-Internal-Token`.
- Audit sink: set `AUDIT_SERVICE_URL` (for Docker: `http://audit-service:3009`).
- Audit events: `device.enrolled` on register/enroll, `device.assigned` on group assignment.
