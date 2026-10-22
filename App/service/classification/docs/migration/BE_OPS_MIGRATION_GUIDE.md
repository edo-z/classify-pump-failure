# Migration Guide: Classification Backend (HTTP → Socket.IO)

## 1. Overview
The classification backend has migrated from a stateless HTTP API (Fastify) to a persistent event-driven transport using Socket.IO. This change is part of the P0–P9 migration to optimize telemetry and real-time communication.

**Production Canonical Port:** `:3031`
**Socket.IO Path:** `/socket.io`
**Connection URL:** `https://class-api.aldozeno.my.id`

---

## 2. Classification Migration
The classification contract remains functionally identical at the business logic level. Only the transport and response wrapper have changed.

### Legacy
`POST /classify` $	o$ JSON Response

### New
**Event:** `classify`
**Payload:** Existing classification request payload (No changes required).
**Response:** Acknowledgement (Ack) envelope.

#### Response Envelopes
**Success:**
```json
{
  "ok": true,
  "data": {
    "profile_id": "...",
    "namespace": "...",
    "evidence_size": 0,
    "classification": { ... }
  }
}
```

**Validation Error (e.g., invalid readings):**
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION",
    "message": "readings: at least 1 reading required"
  }
}
```

**Not Found (e.g., unknown profile):**
```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Unknown pump profile: ..."
  }
}
```

---

## 3. Health Monitoring Migration
The health check is now an event-driven request. **A successful TCP/WebSocket connection does NOT guarantee the classification service is healthy.**

### Legacy
`GET /health`

### New
**Event:** `health`
**Payload:** None
**Response:** Acknowledgement (Ack) envelope.

**Success Response:**
```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "rules_exists": true,
    "rules_loaded": true,
    "rules_error": null,
    "setpoints_exists": true,
    "setpoints_loaded": true,
    "setpoints_error": null
  }
}
```

Monitoring systems must evaluate the `data.status` and `rules_loaded/setpoints_loaded` flags to determine the actual service state.

---

## 4. Profile Setpoints Migration
Setpoint management is consolidated into two event-based endpoints.

### Legacy
- `GET /profile-setpoints`
- `GET /profile-setpoints/:id`
- `PUT /profile-setpoints/:id`

### New
**1. Get Setpoints**
- **Event:** `profile-setpoints:get`
- **Payload:** `{ "profile_id": "string" }` (optional)
  - If `profile_id` is provided $	o$ returns single profile setpoint.
  - If `profile_id` is omitted $	o$ returns all profile setpoints.
- **Response:** Ack `{ ok: true, data: ... }`

**2. Update Setpoints**
- **Event:** `profile-setpoints:update`
- **Payload:** `{ "profile_id": "string", ...updateFields }`
- **Response:** Ack `{ ok: true, data: ... }`

⚠️ **SECURITY WARNING:** The `profile-setpoints:update` event is currently **BLOCKED FOR PUBLIC DEPLOYMENT**. It may be tested in local/staging environments only. Do not target production until the security gate is officially cleared.

---

## 5. Connection Contract
- **Persistent Connection**: Clients must establish a Socket.IO connection and handle `reconnect` events.
- **Authentication**: No Socket.IO-level authentication token is used in this migration phase.
- **Transport**: WebSocket is preferred.

---

## 6. Cutover Checklist
Each consumer must verify the following before sign-off:

- [ ] Client updated to Socket.IO client library.
- [ ] Connection to staging/shadow runtime verified.
- [ ] `classify` event success verified with valid payload.
- [ ] `classify` error handling (VALIDATION/NOT_FOUND) verified.
- [ ] `health` monitoring logic updated and verified.
- [ ] Connection reconnect behavior verified.
- [ ] Owner sign-off recorded.

---

## 7. Rollback Plan
In the event of critical production failure:
- **Rollback Baseline:** Commit `dad8034`.
- **Effect:** Reverts server to a Dual-Transport state (HTTP + Socket.IO), restoring compatibility for legacy HTTP consumers.

---

## 8. Deployment Readiness Status
`UNKNOWN_CONSUMERS=UNVERIFIED`
`ACTIVE_LEGACY_HTTP_CONSUMERS=LandingPage, BE_Team, Ops_Monitoring`
`PUBLIC_UPDATE_EVENT=BLOCKED_FOR_PUBLIC`
`ROLLBACK_BASELINE=dad8034`
`GO_NO_GO=NO_GO`
