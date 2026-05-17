# Jira Clone — API Reference

All routes are prefixed with `/api`. Protected routes require `Authorization: Bearer <accessToken>`.

---

## 1. Tenants

### `POST /api/tenants/register`
Bootstrap a new workspace with the first OWNER account.

**Body**
```json
{ "tenantName": "Acme Inc", "adminName": "Alice", "adminEmail": "alice@acme.com", "adminPassword": "Password123!" }
```
**Response**
```json
{
  "success": true,
  "data": {
    "tenant": { "id": "...", "name": "Acme Inc", "slug": "acme-inc" },
    "admin":  { "id": "...", "email": "alice@acme.com", "role": "OWNER" },
    "tokens": { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
  }
}
```

---

## 2. Auth

All unauthenticated except `/me`, `/change-password`, and `/logout-all`.

### `POST /api/auth/register`
Register a new member in an existing tenant (open registration — use invite flow for controlled access).

**Body:** `tenantSlug`, `email`, `password`, `name`

### `POST /api/auth/login`
Authenticate and receive JWT pair.

**Body:** `email`, `password`, `tenantSlug`

**Response**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "id": "...", "email": "alice@acme.com", "role": "OWNER", "tenantSlug": "acme-inc" }
  }
}
```

### `GET /api/auth/me` 🔒
Returns the currently authenticated user with tenant info.

**Response**
```json
{
  "data": { "id": "...", "email": "alice@acme.com", "role": "OWNER",
            "tenant": { "id": "...", "name": "Acme Inc", "slug": "acme-inc" } }
}
```

### `POST /api/auth/refresh`
Rotate the refresh token and issue a new JWT pair. Old refresh token is invalidated.

**Body:** `refreshToken`

### `POST /api/auth/logout`
Revoke a single refresh token.

**Body:** `refreshToken`

### `POST /api/auth/logout-all` 🔒
Revoke all active sessions for the current user.

### `POST /api/auth/forgot-password`
Generate a password-reset token (logged to console in dev, emailed in prod).

**Body:** `email`, `tenantSlug`

**Response** *(dev only)*
```json
{ "data": { "message": "...", "devToken": "abc123..." } }
```

### `POST /api/auth/reset-password`
Set a new password using a valid reset token.

**Body:** `token`, `newPassword`

### `POST /api/auth/change-password` 🔒
Change password for the currently logged-in user.

**Body:** `currentPassword`, `newPassword`

---

## 3. Users & Invitations

> `OWNER` / `ADMIN` required for all write operations.

### `POST /api/users/invite` 🔒 *(ADMIN+)*
Invite a user by email — creates a pending invitation record. Detects if the email already exists in another workspace and sets `isExistingUser` accordingly.

**Body:** `email`, `role` (`ADMIN | MEMBER | VIEWER`)

**Response**
```json
{
  "data": {
    "invitation": { "id": "...", "email": "bob@acme.com", "role": "MEMBER", "isExistingUser": false, "expiresAt": "..." },
    "devToken": "abc123..."
  }
}
```

### `GET /api/users/check-invite/:token`
Returns invite metadata so the frontend knows which form to show (new user needs name + password; existing user only needs password).

**Response**
```json
{
  "data": { "email": "bob@acme.com", "role": "MEMBER", "isExistingUser": false, "existingName": null, "expiresAt": "..." }
}
```

### `POST /api/users/accept-invite`
Activate an invite. New users must supply `name`; existing users only need `password` (name is resolved from their other tenant). Returns JWT pair so the user is logged in immediately.

**Body:** `token`, `password`, `name` *(required for new users only)*

**Response**
```json
{
  "data": {
    "user": { "id": "...", "email": "bob@acme.com", "name": "Bob", "role": "MEMBER", "tenantSlug": "acme-inc", "isExistingUser": false },
    "tokens": { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
  }
}
```

### `GET /api/users` 🔒 *(ADMIN+)*
List all users in the current tenant.

**Response**
```json
{ "data": { "users": [{ "id": "...", "email": "...", "name": "...", "role": "MEMBER", "isActive": true }], "total": 3 } }
```

### `PATCH /api/users/:id/role` 🔒 *(ADMIN+)*
Change a user's role. Actor must outrank both the target's current role and the new role.

**Body:** `role`

### `DELETE /api/users/:id` 🔒 *(ADMIN+)*
Deactivate a user (soft delete). Cannot deactivate yourself.

---

## 4. Projects

> All routes are scoped to the authenticated user's tenant.

### `POST /api/projects` 🔒 *(ADMIN+)*
Create a project with a globally-unique key prefix used for task keys (e.g. `SHOP`).

**Body:** `name`, `key` *(2–6 uppercase letters, unique per tenant)*, `description?`

**Response**
```json
{
  "data": {
    "project": { "id": "...", "name": "Shop App", "key": "SHOP", "status": "ACTIVE",
                 "_count": { "members": 1, "tasks": 0 } }
  }
}
```

### `GET /api/projects` 🔒
List all active projects for the tenant, including member and task counts.

### `GET /api/projects/:id` 🔒
Project detail including member list.

### `PATCH /api/projects/:id` 🔒 *(ADMIN+)*
Update project name, description, or status.

**Body:** `name?`, `description?`, `status?` (`ACTIVE | ON_HOLD | COMPLETED`)

### `DELETE /api/projects/:id` 🔒 *(ADMIN+)*
Soft-archive a project (`isArchived: true`). Archived projects are excluded from listings.

### `POST /api/projects/:id/members` 🔒 *(ADMIN+)*
Add a tenant user to the project.

**Body:** `userId`, `role` (`OWNER | ADMIN | MEMBER | VIEWER`)

### `GET /api/projects/:id/members` 🔒
List all members of a project.

**Response**
```json
{ "data": { "members": [{ "userId": "...", "name": "Alice", "email": "...", "role": "OWNER" }], "total": 2 } }
```

### `DELETE /api/projects/:id/members/:userId` 🔒 *(ADMIN+)*
Remove a user from the project.

---

## 5. Tasks

> Task keys are auto-generated (`SHOP-1`, `SHOP-2`, ...) and never reused.

### `POST /api/projects/:id/tasks` 🔒
Create a task in the project.

**Body:** `title` *(required)*, `description?`, `status?`, `priority?`, `assigneeId?`, `dueDate?`, `estimatedHours?`, `labels?`, `parentTaskId?`, `sprintId?`

**Enums:** `status`: `TODO | IN_PROGRESS | IN_REVIEW | DONE | CANCELLED` · `priority`: `LOW | MEDIUM | HIGH | URGENT`

**Response**
```json
{
  "data": {
    "task": {
      "id": "...", "taskKey": "SHOP-1", "title": "Build login page",
      "status": "TODO", "priority": "HIGH", "labels": ["frontend"],
      "assignee": { "id": "...", "name": "Alice", "email": "alice@acme.com" },
      "reporter": { "id": "...", "name": "Alice", "email": "alice@acme.com" },
      "dueDate": null, "estimatedHours": null, "taskOrder": 0,
      "createdAt": "2026-05-17T22:57:11Z"
    }
  }
}
```

### `GET /api/projects/:id/tasks` 🔒
List tasks with optional filters.

**Query params:** `status?`, `priority?`, `assigneeId?`, `label?`

**Response**
```json
{ "data": { "tasks": [ ...taskObjects ], "total": 5 } }
```

### `GET /api/projects/:id/tasks/board` 🔒
Return all tasks grouped by status column, with per-column counts.

**Response**
```json
{
  "data": {
    "board": {
      "TODO":        [{ "taskKey": "SHOP-1", "title": "...", "priority": "LOW", ... }],
      "IN_PROGRESS": [{ "taskKey": "SHOP-2", ... }],
      "IN_REVIEW":   [],
      "DONE":        [],
      "CANCELLED":   []
    },
    "columnCounts": { "TODO": 1, "IN_PROGRESS": 1, "IN_REVIEW": 0, "DONE": 0, "CANCELLED": 0 }
  }
}
```

### `GET /api/tasks/:id` 🔒
Full task detail including comments, sub-tasks, and the last 20 activity log entries.

**Response**
```json
{
  "data": {
    "task": {
      "taskKey": "SHOP-1", "title": "Build login page", "status": "IN_REVIEW",
      "subTasks": [],
      "comments": [],
      "activities": [
        { "type": "STATUS_CHANGE", "field": "status", "oldValue": "TODO", "newValue": "IN_REVIEW",
          "actor": { "id": "...", "name": "Alice" }, "createdAt": "..." },
        { "type": "FIELD_CHANGE",  "field": "priority", "oldValue": "HIGH", "newValue": "URGENT",
          "actor": { "id": "...", "name": "Alice" }, "createdAt": "..." }
      ]
    }
  }
}
```

### `PATCH /api/tasks/:id` 🔒
Update task fields. Each changed field is logged as a `FIELD_CHANGE` activity.

**Body:** `title?`, `description?`, `priority?`, `assigneeId?`, `dueDate?`, `estimatedHours?`, `labels?`, `taskOrder?`

### `PATCH /api/tasks/:id/status` 🔒
Transition task status. Logs a `STATUS_CHANGE` entry in the activity history. Returns `400` if the status is unchanged.

**Body:** `status`

**Response**
```json
{ "data": { "task": { "taskKey": "SHOP-1", "status": "IN_PROGRESS", ... } } }
```

### `DELETE /api/tasks/:id` 🔒
Soft-delete a task (`isDeleted: true`). Deleted tasks are excluded from all listings and the board view.

---

## Error Format

All errors follow a consistent shape:

```json
{
  "success": false,
  "error": {
    "code": 404,
    "message": "Task not found"
  }
}
```

| Code | Meaning |
|------|---------|
| `400` | Validation error / bad request |
| `401` | Missing or invalid token |
| `403` | Insufficient role |
| `404` | Resource not found |
| `409` | Conflict (duplicate email, key, etc.) |
| `500` | Internal server error |

---

## RBAC Quick Reference

| Role | Invite | Manage Users | Create Project | Manage Members | Create Task | View |
|------|--------|-------------|----------------|----------------|-------------|------|
| OWNER  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ADMIN  | ✅ (MEMBER/VIEWER only) | ✅ | ✅ | ✅ | ✅ | ✅ |
| MEMBER | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| VIEWER | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## JWT Payload

The access token contains everything the frontend needs to drive UI state without extra API calls:

```json
{
  "sub": "<userId>",
  "tenantId": "<tenantId>",
  "tenantSlug": "acme-inc",
  "role": "OWNER",
  "email": "alice@acme.com",
  "name": "Alice"
}
```

Access tokens expire in **15 minutes**. Refresh tokens expire in **7 days**.
