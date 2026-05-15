#!/usr/bin/env bash
set -euo pipefail

PASS=0; FAIL=0
BASE="http://localhost:3000"

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $label"
    PASS=$((PASS+1))
  else
    echo "  ❌ $label — expected='$expected' got='$actual'"
    FAIL=$((FAIL+1))
  fi
}

decode_claim() {
  echo "$1" | cut -d'.' -f2 | python3 -c "
import sys, base64, json
d = sys.stdin.read().strip()
d += '=' * (-len(d) % 4)
print(json.loads(base64.b64decode(d)).get('$2',''))
"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FULL E2E TEST SUITE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── TENANT REGISTER ───────────────────────────────────────────────────────────
echo ""
echo "── Day 1-2: Tenant & Auth ────────────────────────"

R=$(curl -s -X POST $BASE/api/tenants/register \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"E2E Corp","adminName":"Alice Owner","adminEmail":"alice@e2e.com","adminPassword":"Password123!"}')
SLUG=$(echo "$R" | jq -r '.data.tenant.slug')
OWNER=$(echo "$R" | jq -r '.data.tokens.accessToken')
OWNER_REFRESH=$(echo "$R" | jq -r '.data.tokens.refreshToken')
OWNER_ID=$(echo "$R" | jq -r '.data.admin.id')

check "POST /tenants/register" "true" "$(echo $R | jq -r '.success')"
check "JWT claim: tenantSlug" "$SLUG" "$(decode_claim $OWNER tenantSlug)"
check "JWT claim: name" "Alice Owner" "$(decode_claim $OWNER name)"
check "JWT claim: role" "OWNER" "$(decode_claim $OWNER role)"

# Login
R=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"alice@e2e.com\",\"password\":\"Password123!\",\"tenantSlug\":\"$SLUG\"}")
check "POST /auth/login" "true" "$(echo $R | jq -r '.success')"

R=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"alice@e2e.com\",\"password\":\"WRONG\",\"tenantSlug\":\"$SLUG\"}")
check "Login wrong password → 401" "401" "$(echo $R | jq -r '.error.code')"

# Auth register
R=$(curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"tenantSlug\":\"$SLUG\",\"email\":\"bob@e2e.com\",\"password\":\"Password123!\",\"name\":\"Bob\"}")
check "POST /auth/register" "true" "$(echo $R | jq -r '.success')"
BOB=$(echo "$R" | jq -r '.data.tokens.accessToken')
BOB_ID=$(echo "$R" | jq -r '.data.user.id')

R=$(curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"tenantSlug\":\"$SLUG\",\"email\":\"bob@e2e.com\",\"password\":\"Password123!\",\"name\":\"Bob\"}")
check "POST /auth/register duplicate → 409" "409" "$(echo $R | jq -r '.error.code')"

# Tenant isolation
R=$(curl -s -X POST $BASE/api/tenants/register \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"Other Corp","adminName":"Other","adminEmail":"other@other.com","adminPassword":"Password123!"}')
SLUG2=$(echo "$R" | jq -r '.data.tenant.slug')
R=$(curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"tenantSlug\":\"$SLUG2\",\"email\":\"bob@e2e.com\",\"password\":\"Password123!\",\"name\":\"Bob Other\"}")
check "Tenant isolation: same email in Tenant B → 201" "true" "$(echo $R | jq -r '.success')"

# /me
R=$(curl -s $BASE/api/auth/me -H "Authorization: Bearer $OWNER")
check "GET /auth/me" "alice@e2e.com" "$(echo $R | jq -r '.data.email')"
check "GET /auth/me has tenant.slug" "$SLUG" "$(echo $R | jq -r '.data.tenant.slug')"
R=$(curl -s $BASE/api/auth/me)
check "GET /auth/me no token → 401" "401" "$(echo $R | jq -r '.error.code')"

# Refresh & rotation
R=$(curl -s -X POST $BASE/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$OWNER_REFRESH\"}")
check "POST /auth/refresh" "true" "$(echo $R | jq -r '.success')"
NEW_REFRESH=$(echo "$R" | jq -r '.data.refreshToken')
R=$(curl -s -X POST $BASE/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$OWNER_REFRESH\"}")
check "Old refresh token rejected → 401" "401" "$(echo $R | jq -r '.error.code')"

# Forgot / Reset password
R=$(curl -s -X POST $BASE/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"bob@e2e.com\",\"tenantSlug\":\"$SLUG\"}")
check "POST /auth/forgot-password" "true" "$(echo $R | jq -r '.success')"
RESET_TOKEN=$(echo "$R" | jq -r '.data.devToken')

R=$(curl -s -X POST $BASE/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$RESET_TOKEN\",\"newPassword\":\"NewPass456!\"}")
check "POST /auth/reset-password" "true" "$(echo $R | jq -r '.success')"

R=$(curl -s -X POST $BASE/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$RESET_TOKEN\",\"newPassword\":\"Another!\"}")
check "Reset token reuse → 400" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"bob@e2e.com\",\"password\":\"NewPass456!\",\"tenantSlug\":\"$SLUG\"}")
check "Login with new password after reset" "bob@e2e.com" "$(echo $R | jq -r '.data.user.email')"
BOB=$(echo "$R" | jq -r '.data.accessToken')

# Change password
R=$(curl -s -X POST $BASE/api/auth/change-password \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOB" \
  -d '{"currentPassword":"WRONG","newPassword":"Final!123"}')
check "Change password wrong current → 400" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/auth/change-password \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOB" \
  -d '{"currentPassword":"NewPass456!","newPassword":"NewPass456!"}')
check "Change password same value → 400" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/auth/change-password \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOB" \
  -d '{"currentPassword":"NewPass456!","newPassword":"Final!123"}')
check "POST /auth/change-password" "true" "$(echo $R | jq -r '.success')"

# Logout-all
R=$(curl -s -X POST $BASE/api/auth/logout-all -H "Authorization: Bearer $OWNER")
check "POST /auth/logout-all" "true" "$(echo $R | jq -r '.success')"

R=$(curl -s -X POST $BASE/api/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH\"}")
check "POST /auth/logout" "true" "$(echo $R | jq -r '.success')"

# Re-login for remaining tests
OWNER=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"alice@e2e.com\",\"password\":\"Password123!\",\"tenantSlug\":\"$SLUG\"}" | jq -r '.data.accessToken')
BOB=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"bob@e2e.com\",\"password\":\"Final!123\",\"tenantSlug\":\"$SLUG\"}" | jq -r '.data.accessToken')

# ── USER MANAGEMENT & RBAC ────────────────────────────────────────────────────
echo ""
echo "── Day 3: User Management & RBAC ────────────────"

# GET /users as OWNER
R=$(curl -s $BASE/api/users -H "Authorization: Bearer $OWNER")
check "GET /users as OWNER → 200" "true" "$(echo $R | jq -r '.success')"

# GET /users as MEMBER
R=$(curl -s $BASE/api/users -H "Authorization: Bearer $BOB")
check "GET /users as MEMBER → 403" "403" "$(echo $R | jq -r '.error.code')"

# Invite
R=$(curl -s -X POST $BASE/api/users/invite \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"email":"carol@e2e.com","role":"ADMIN"}')
check "POST /users/invite ADMIN" "true" "$(echo $R | jq -r '.success')"
INVITE_TOKEN=$(echo "$R" | jq -r '.data.devToken')

R=$(curl -s -X POST $BASE/api/users/invite \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"email":"dave@e2e.com","role":"MEMBER"}')
check "POST /users/invite MEMBER" "true" "$(echo $R | jq -r '.success')"
DAVE_TOKEN=$(echo "$R" | jq -r '.data.devToken')

# Re-invite same email — should invalidate old token
R=$(curl -s -X POST $BASE/api/users/invite \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"email":"carol@e2e.com","role":"MEMBER"}')
check "Re-invite same email resets token" "true" "$(echo $R | jq -r '.success')"
NEW_CAROL_TOKEN=$(echo "$R" | jq -r '.data.devToken')

# Accept invite
R=$(curl -s -X POST $BASE/api/users/accept-invite \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$NEW_CAROL_TOKEN\",\"name\":\"Carol\",\"password\":\"Password123!\"}")
check "POST /users/accept-invite" "true" "$(echo $R | jq -r '.success')"
CAROL=$(echo "$R" | jq -r '.data.tokens.accessToken')
CAROL_ID=$(echo "$R" | jq -r '.data.user.id')

R=$(curl -s -X POST $BASE/api/users/accept-invite \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$NEW_CAROL_TOKEN\",\"name\":\"Carol2\",\"password\":\"Password123!\"}")
check "Accept used invite → 400" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/users/accept-invite \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$INVITE_TOKEN\",\"name\":\"Carol3\",\"password\":\"Password123!\"}")
check "Accept superseded invite → 400 (expired)" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/users/accept-invite \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$DAVE_TOKEN\",\"name\":\"Dave\",\"password\":\"Password123!\"}")
check "POST /users/accept-invite Dave" "true" "$(echo $R | jq -r '.success')"
DAVE=$(echo "$R" | jq -r '.data.tokens.accessToken')
DAVE_ID=$(echo "$R" | jq -r '.data.user.id')

# Role change
R=$(curl -s -X PATCH "$BASE/api/users/$DAVE_ID/role" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"role":"VIEWER"}')
check "PATCH /users/:id/role OWNER → VIEWER" "VIEWER" "$(echo $R | jq -r '.data.user.role')"

R=$(curl -s -X PATCH "$BASE/api/users/$DAVE_ID/role" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $CAROL" \
  -d '{"role":"ADMIN"}')
check "PATCH /users/:id/role MEMBER cannot escalate → 403" "403" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X PATCH "$BASE/api/users/$OWNER_ID/role" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"role":"MEMBER"}')
check "PATCH own role → 400" "400" "$(echo $R | jq -r '.error.code')"

# Deactivate
R=$(curl -s -X DELETE "$BASE/api/users/$DAVE_ID" -H "Authorization: Bearer $OWNER")
check "DELETE /users/:id (deactivate)" "false" "$(echo $R | jq -r '.data.user.isActive')"

R=$(curl -s -X DELETE "$BASE/api/users/$OWNER_ID" -H "Authorization: Bearer $OWNER")
check "DELETE /users/:id self → 400" "400" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X DELETE "$BASE/api/users/$CAROL_ID" -H "Authorization: Bearer $BOB")
check "DELETE /users/:id as MEMBER → 403" "403" "$(echo $R | jq -r '.error.code')"

# ── PROJECTS ──────────────────────────────────────────────────────────────────
echo ""
echo "── Day 4: Project Management ────────────────────"

# Create two projects
R=$(curl -s -X POST $BASE/api/projects \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"name":"Project Alpha","description":"First","key":"ALPH"}')
check "POST /projects (Alpha)" "true" "$(echo $R | jq -r '.success')"
check "Creator auto-added as member" "1" "$(echo $R | jq -r '.data.project._count.members')"
P1=$(echo "$R" | jq -r '.data.project.id')

R=$(curl -s -X POST $BASE/api/projects \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"name":"Project Beta","description":"Second","key":"BETA"}')
check "POST /projects (Beta)" "true" "$(echo $R | jq -r '.success')"
P2=$(echo "$R" | jq -r '.data.project.id')

R=$(curl -s -X POST $BASE/api/projects \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"name":"Dup","key":"ALPH"}')
check "POST /projects duplicate key → 409" "409" "$(echo $R | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/projects \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOB" \
  -d '{"name":"Forbidden","key":"FORB"}')
check "POST /projects as MEMBER → 403" "403" "$(echo $R | jq -r '.error.code')"

# List
R=$(curl -s $BASE/api/projects -H "Authorization: Bearer $OWNER")
check "GET /projects — total 2" "2" "$(echo $R | jq -r '.data.total')"
check "GET /projects as MEMBER → 200" "true" "$(curl -s $BASE/api/projects -H "Authorization: Bearer $BOB" | jq -r '.success')"

# Get detail
R=$(curl -s $BASE/api/projects/$P1 -H "Authorization: Bearer $OWNER")
check "GET /projects/:id" "Project Alpha" "$(echo $R | jq -r '.data.project.name')"
check "GET /projects/:id memberCount" "1" "$(echo $R | jq -r '.data.project._count.members')"

R=$(curl -s "$BASE/api/projects/00000000-0000-0000-0000-000000000000" -H "Authorization: Bearer $OWNER")
check "GET /projects/:id not found → 404" "404" "$(echo $R | jq -r '.error.code')"

# Update
R=$(curl -s -X PATCH $BASE/api/projects/$P1 \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d '{"name":"Alpha Updated"}')
check "PATCH /projects/:id" "Alpha Updated" "$(echo $R | jq -r '.data.project.name')"

R=$(curl -s -X PATCH $BASE/api/projects/$P1 \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOB" \
  -d '{"name":"Hacked"}')
check "PATCH /projects/:id as MEMBER → 403" "403" "$(echo $R | jq -r '.error.code')"

# Members
R=$(curl -s -X POST $BASE/api/projects/$P1/members \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" \
  -d "{\"userId\":\"$BOB_ID\",\"role\":\"MEMBER\"}")
check "POST /projects/:id/members" "true" "$(echo $R | jq -r '.success')"

R=$(curl -s $BASE/api/projects/$P1/members -H "Authorization: Bearer $OWNER")
check "GET /projects/:id/members count=2" "2" "$(echo $R | jq -r '.data.total')"
check "GET /projects/:id/members has Bob" "Bob" "$(echo $R | jq -r '[.data.members[].user.name] | join(",")'| grep -o 'Bob')"

R=$(curl -s -X DELETE "$BASE/api/projects/$P1/members/$BOB_ID" -H "Authorization: Bearer $OWNER")
check "DELETE /projects/:id/members/:userId" "true" "$(echo $R | jq -r '.success')"
check "Member count back to 1" "1" "$(curl -s $BASE/api/projects/$P1/members \
  -H "Authorization: Bearer $OWNER" | jq -r '.data.total')"

R=$(curl -s -X DELETE "$BASE/api/projects/$P1/members/$OWNER_ID" -H "Authorization: Bearer $OWNER")
check "DELETE self from project → 400" "400" "$(echo $R | jq -r '.error.code')"

# Archive
R=$(curl -s -X DELETE $BASE/api/projects/$P2 -H "Authorization: Bearer $OWNER")
check "DELETE /projects/:id (archive)" "true" "$(echo $R | jq -r '.data.project.isArchived')"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS: $PASS passed  |  $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ $FAIL -eq 0 ] && echo "  🎉 All tests passed!" || echo "  ⚠️  Some tests failed"
