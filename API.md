# Jira Clone Backend — API Reference & Frontend Integration Guide

**Base URL:** `http://localhost:3000/api` (dev) · swap for your production URL  
**Auth:** `Authorization: Bearer <accessToken>` on all 🔒 routes  
**Content-Type:** `application/json`

---

## Response Envelope

Every response follows this shape — always check `success` first.

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": { "code": 401, "message": "..." } }
```

---

## Token Management

### How tokens work

| Token | Lifetime | Purpose |
|---|---|---|
| `accessToken` | 15 minutes | Sent on every protected API call |
| `refreshToken` | 7 days | Used once to get a new token pair |

### What's inside the access token

Decode it at [jwt.io](https://jwt.io) or with any JWT library — no API call needed:

```json
{
  "sub":        "user-uuid",
  "tenantId":   "tenant-uuid",
  "tenantSlug": "acme-corp",
  "role":       "MEMBER",
  "email":      "user@example.com",
  "name":       "Jane Doe",
  "type":       "access",
  "jti":        "unique-per-token-uuid",
  "iat":        1234567890,
  "exp":        1234568790
}
```

> Use these claims to drive your UI without extra API calls — show the user's name, guard routes by `role`, scope requests by `tenantId`.

---

## Frontend SDK (Vanilla JS / TypeScript)

Drop this into your project as `api.js` or `api.ts`. It handles token storage, automatic refresh, and error normalisation.

```typescript
// api.ts

const BASE = 'http://localhost:3000/api';

// ── Token storage (localStorage — swap for httpOnly cookies in production) ──
const Tokens = {
  get access()   { return localStorage.getItem('accessToken') ?? ''; },
  get refresh()  { return localStorage.getItem('refreshToken') ?? ''; },
  set(access: string, refresh: string) {
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  },
  clear() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  },
};

// ── Decode JWT claims without a library ──────────────────────────────────────
export function decodeToken(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

export function getCurrentUser() {
  return decodeToken(Tokens.access) as {
    sub: string;
    tenantId: string;
    tenantSlug: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    email: string;
    name: string;
    exp: number;
  };
}

// ── Core fetch wrapper with auto-refresh ─────────────────────────────────────
async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Tokens.access}`,
      ...options.headers,
    },
  });

  const json = await res.json();

  // Auto-refresh on 401
  if (res.status === 401 && retry && Tokens.refresh) {
    const refreshed = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: Tokens.refresh }),
    }).then(r => r.json());

    if (refreshed.success) {
      Tokens.set(refreshed.data.accessToken, refreshed.data.refreshToken);
      return request<T>(path, options, false); // retry once
    }

    // Refresh failed — user must log in again
    Tokens.clear();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!json.success) throw new Error(json.error?.message ?? 'Request failed');
  return json.data as T;
}

const get  = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del  = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  registerTenant: (body: {
    tenantName: string; adminName: string;
    adminEmail: string; adminPassword: string; timezone?: string;
  }) => post<{ tenant: object; admin: object; tokens: { accessToken: string; refreshToken: string } }>('/tenants/register', body)
    .then(data => { Tokens.set((data as any).tokens.accessToken, (data as any).tokens.refreshToken); return data; }),

  register: (body: { tenantSlug: string; email: string; password: string; name: string }) =>
    post<{ user: object; tokens: { accessToken: string; refreshToken: string } }>('/auth/register', body)
      .then(data => { Tokens.set((data as any).tokens.accessToken, (data as any).tokens.refreshToken); return data; }),

  login: (body: { email: string; password: string; tenantSlug: string }) =>
    post<{ accessToken: string; refreshToken: string; user: object }>('/auth/login', body)
      .then(data => { Tokens.set(data.accessToken, data.refreshToken); return data; }),

  me:             () => get('/auth/me'),
  logout:         () => post('/auth/logout', { refreshToken: Tokens.refresh }).finally(() => Tokens.clear()),
  logoutAll:      () => post('/auth/logout-all', {}).finally(() => Tokens.clear()),
  forgotPassword: (email: string, tenantSlug: string) => post('/auth/forgot-password', { email, tenantSlug }),
  resetPassword:  (token: string, newPassword: string) => post('/auth/reset-password', { token, newPassword }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post('/auth/change-password', { currentPassword, newPassword }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  list:         () => get<{ users: object[]; total: number }>('/users'),
  invite:       (email: string, role = 'MEMBER') => post('/users/invite', { email, role }),
  acceptInvite: (token: string, name: string, password: string) =>
    post<{ user: object; tokens: { accessToken: string; refreshToken: string } }>('/users/accept-invite', { token, name, password })
      .then(data => { Tokens.set((data as any).tokens.accessToken, (data as any).tokens.refreshToken); return data; }),
  changeRole:   (userId: string, role: string) => patch(`/users/${userId}/role`, { role }),
  deactivate:   (userId: string) => del(`/users/${userId}`),
};

// ── Projects ──────────────────────────────────────────────────────────────────
export const projects = {
  create:        (body: { name: string; key: string; description?: string }) => post('/projects', body),
  list:          () => get<{ projects: object[]; total: number }>('/projects'),
  get:           (id: string) => get(`/projects/${id}`),
  update:        (id: string, body: { name?: string; description?: string; isArchived?: boolean }) => patch(`/projects/${id}`, body),
  archive:       (id: string) => del(`/projects/${id}`),
  listMembers:   (id: string) => get(`/projects/${id}/members`),
  addMember:     (id: string, userId: string, role = 'MEMBER') => post(`/projects/${id}/members`, { userId, role }),
  removeMember:  (id: string, userId: string) => del(`/projects/${id}/members/${userId}`),
};
```

---

## Integration Recipes

### 1. Login flow

```typescript
try {
  await auth.login({ email, password, tenantSlug });
  const user = getCurrentUser(); // decoded from token, no API call
  console.log(`Welcome ${user.name}, role: ${user.role}`);
  window.location.href = '/dashboard';
} catch (e) {
  showError(e.message); // 'Invalid credentials'
}
```

### 2. Register new workspace

```typescript
await auth.registerTenant({
  tenantName: 'Acme Corp',
  adminName: 'Alice',
  adminEmail: 'alice@acme.com',
  adminPassword: 'Password123!',
  timezone: 'America/New_York',
});
// Tokens stored automatically — user is logged in
```

### 3. Guard routes by role

```typescript
const user = getCurrentUser();

// Only render admin UI if role allows it
const canManage = ['OWNER', 'ADMIN'].includes(user.role);

if (!canManage) {
  return renderError('You do not have permission to view this page.');
}
```

### 4. Invite a teammate

```typescript
// Admin invites someone — they get an email with a link containing the token
await users.invite('newcolleague@company.com', 'MEMBER');

// Teammate visits the invite link and accepts:
await users.acceptInvite(tokenFromUrl, 'Their Name', 'TheirPassword!');
// They are now logged in automatically
```

### 5. Load projects dashboard

```typescript
const { projects: list } = await projects.list();

list.forEach(p => {
  console.log(`${p.key} — ${p.name} | ${p._count.members} members, ${p._count.tasks} tasks`);
});
```

### 6. Create a project

```typescript
const { project } = await projects.create({
  name: 'Mobile App',
  key: 'MOB',          // becomes 'MOB', unique per workspace
  description: 'iOS and Android app',
});
```

### 7. Forgot password flow

```typescript
// Step 1 — user submits their email
await auth.forgotPassword('user@company.com', 'acme-corp');
// They receive an email with a reset link: /reset-password?token=abc123

// Step 2 — user visits the link and submits new password
const token = new URLSearchParams(window.location.search).get('token');
await auth.resetPassword(token, 'NewSecurePassword!');
// All old sessions are revoked. Redirect to login.
```

---

## Error Codes Reference

| Code | Meaning | Common cause |
|---|---|---|
| `400` | Bad request | Validation failed, same password on change, expired token |
| `401` | Unauthorized | Missing/expired access token, wrong password |
| `403` | Forbidden | Role not permitted (e.g. MEMBER hitting admin route) |
| `404` | Not found | Wrong ID, wrong tenant slug |
| `409` | Conflict | Duplicate email in tenant, duplicate project key |
| `429` | Rate limited | Too many auth requests (production only) |
| `500` | Server error | Unexpected — report to backend team |

---

## Tenant Isolation — Important

Every user belongs to exactly one tenant. The `tenantSlug` (e.g. `acme-corp`) identifies the workspace and is **required on login**. The same email address can exist in multiple tenants independently — they are completely separate accounts.

> **For frontend routing:** store the `tenantSlug` from the JWT and include it in your login form. A common pattern is to use a subdomain (`acme-corp.yourapp.com`) or a URL path (`/workspaces/acme-corp/login`).

---

## Running Locally

```bash
# 1. Copy env
cp .env.example .env   # fill in your DATABASE_URL + secrets

# 2. Start DB (Docker)
docker-compose up -d

# 3. Run migrations
npm run db:migrate

# 4. Start dev server (auto-restarts on changes)
npm run dev

# 5. Run the full test suite
bash scripts/e2e-test.sh
```

Server runs on **http://localhost:3000**. Rate limiting is disabled in `development` mode.
