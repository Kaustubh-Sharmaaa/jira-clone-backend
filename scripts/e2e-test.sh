#!/usr/bin/env bash
BASE="http://localhost:3000"
PASS=0; FAIL=0
ID=$(python3 -c "import uuid; print(str(uuid.uuid4())[:8])")

check() {
  [ "$2" = "$3" ] && { echo "  ✅ $1"; PASS=$((PASS+1)); } \
    || { echo "  ❌ $1 — expected='$2' got='$3'"; FAIL=$((FAIL+1)); }
}

jwtclaim() { echo "$1" | cut -d'.' -f2 | python3 -c "
import sys,base64,json; d=sys.stdin.read().strip(); d+='='*(-len(d)%4)
print(json.loads(base64.b64decode(d)).get('$2',''))"; }

echo ""; echo "━━━ FULL E2E — Day 1-5 (run=$ID) ━━━"

# ── SETUP ─────────────────────────────────────────────────────────────────────
R=$(curl -s -X POST $BASE/api/tenants/register -H "Content-Type: application/json" \
  -d "{\"tenantName\":\"Co$ID\",\"adminName\":\"Alice\",\"adminEmail\":\"alice$ID@t.com\",\"adminPassword\":\"Password123!\"}")
SLUG=$(echo $R | jq -r '.data.tenant.slug')
OWNER=$(echo $R | jq -r '.data.tokens.accessToken')
OWNER_REF=$(echo $R | jq -r '.data.tokens.refreshToken')
OWNER_ID=$(echo $R | jq -r '.data.admin.id')

R2=$(curl -s -X POST $BASE/api/tenants/register -H "Content-Type: application/json" \
  -d "{\"tenantName\":\"Other$ID\",\"adminName\":\"X\",\"adminEmail\":\"x$ID@t.com\",\"adminPassword\":\"Password123!\"}")
SLUG2=$(echo $R2 | jq -r '.data.tenant.slug')
OWNER2=$(echo $R2 | jq -r '.data.tokens.accessToken')

echo ""; echo "── Day 1-2: Auth & Tenant ──"
check "POST /tenants/register" "true" "$(echo $R | jq -r '.success')"
check "JWT tenantSlug" "$SLUG" "$(jwtclaim $OWNER tenantSlug)"
check "JWT role=OWNER"  "OWNER" "$(jwtclaim $OWNER role)"
check "JWT name"        "Alice" "$(jwtclaim $OWNER name)"

B="{\"email\":\"alice$ID@t.com\",\"password\":\"Password123!\",\"tenantSlug\":\"$SLUG\"}"
check "POST /auth/login" "true" "$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "$B" | jq -r '.success')"
B="{\"email\":\"alice$ID@t.com\",\"password\":\"WRONG\",\"tenantSlug\":\"$SLUG\"}"
check "Login wrong password -> 401" "401" "$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "$B" | jq -r '.error.code')"

B="{\"tenantSlug\":\"$SLUG\",\"email\":\"bob$ID@t.com\",\"password\":\"Pass123!\",\"name\":\"Bob\"}"
R=$(curl -s -X POST $BASE/api/auth/register -H "Content-Type: application/json" -d "$B")
check "POST /auth/register" "true" "$(echo $R | jq -r '.success')"
BOB=$(echo $R | jq -r '.data.tokens.accessToken'); BOB_ID=$(echo $R | jq -r '.data.user.id')
check "Register duplicate -> 409" "409" "$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d "$B" | jq -r '.error.code')"

curl -s -X POST $BASE/api/auth/register -H "Content-Type: application/json" \
  -d "{\"tenantSlug\":\"$SLUG\",\"email\":\"dave$ID@t.com\",\"password\":\"Pass123!\",\"name\":\"Dave\"}" > /dev/null

B="{\"tenantSlug\":\"$SLUG2\",\"email\":\"bob$ID@t.com\",\"password\":\"Pass123!\",\"name\":\"Bob2\"}"
check "Tenant isolation: same email diff tenant" "true" "$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d "$B" | jq -r '.success')"

check "GET /auth/me" "alice$ID@t.com" "$(curl -s $BASE/api/auth/me -H "Authorization: Bearer $OWNER" | jq -r '.data.email')"
check "GET /auth/me tenant" "$SLUG" "$(curl -s $BASE/api/auth/me -H "Authorization: Bearer $OWNER" | jq -r '.data.tenant.slug')"
check "GET /auth/me no token -> 401" "401" "$(curl -s $BASE/api/auth/me | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\":\"$OWNER_REF\"}")
check "POST /auth/refresh" "true" "$(echo $R | jq -r '.success')"
NEW_REF=$(echo $R | jq -r '.data.refreshToken')
check "Old refresh rejected -> 401" "401" "$(curl -s -X POST $BASE/api/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$OWNER_REF\"}" | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" \
  -d "{\"email\":\"dave$ID@t.com\",\"tenantSlug\":\"$SLUG\"}")
check "POST /auth/forgot-password" "true" "$(echo $R | jq -r '.success')"
RTOK=$(echo $R | jq -r '.data.devToken')
BODY_RESET=$(printf '{"token":"%s","newPassword":"NewPass456!"}' "$RTOK")
check "POST /auth/reset-password" "true" "$(curl -s -X POST $BASE/api/auth/reset-password -H 'Content-Type: application/json' -d "$BODY_RESET" | jq -r '.success')"
BODY_RESET_REUSE=$(printf '{"token":"%s","newPassword":"Another!"}' "$RTOK")
check "Reset token reuse -> 400" "400" "$(curl -s -X POST $BASE/api/auth/reset-password -H 'Content-Type: application/json' -d "$BODY_RESET_REUSE" | jq -r '.error.code')"

check "Change password wrong current -> 400" "400" "$(curl -s -X POST $BASE/api/auth/change-password -H 'Content-Type: application/json' -H "Authorization: Bearer $BOB" -d '{"currentPassword":"WRONG","newPassword":"Final!123"}' | jq -r '.error.code')"
check "Change password same -> 400" "400" "$(curl -s -X POST $BASE/api/auth/change-password -H 'Content-Type: application/json' -H "Authorization: Bearer $BOB" -d '{"currentPassword":"Pass123!","newPassword":"Pass123!"}' | jq -r '.error.code')"
check "POST /auth/change-password" "true" "$(curl -s -X POST $BASE/api/auth/change-password -H 'Content-Type: application/json' -H "Authorization: Bearer $BOB" -d '{"currentPassword":"Pass123!","newPassword":"Final!123"}' | jq -r '.success')"
check "POST /auth/logout-all" "true" "$(curl -s -X POST $BASE/api/auth/logout-all -H "Authorization: Bearer $OWNER" | jq -r '.success')"
check "POST /auth/logout" "true" "$(curl -s -X POST $BASE/api/auth/logout -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$NEW_REF\"}" | jq -r '.success')"

OWNER=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"alice$ID@t.com\",\"password\":\"Password123!\",\"tenantSlug\":\"$SLUG\"}" | jq -r '.data.accessToken')
BOB=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"bob$ID@t.com\",\"password\":\"Final!123\",\"tenantSlug\":\"$SLUG\"}" | jq -r '.data.accessToken')

echo ""; echo "── Day 3: Users & RBAC ──"
check "GET /users as OWNER" "true"  "$(curl -s $BASE/api/users -H "Authorization: Bearer $OWNER" | jq -r '.success')"
check "GET /users as MEMBER -> 403" "403" "$(curl -s $BASE/api/users -H "Authorization: Bearer $BOB" | jq -r '.error.code')"

R=$(curl -s -X POST $BASE/api/users/invite -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d "{\"email\":\"carol$ID@t.com\",\"role\":\"MEMBER\"}")
check "POST /users/invite (new)" "true"  "$(echo $R | jq -r '.success')"
check "isExistingUser=false"     "false" "$(echo $R | jq -r '.data.invitation.isExistingUser')"
CTOK=$(echo $R | jq -r '.data.devToken')

R=$(curl -s $BASE/api/users/check-invite/$CTOK)
check "GET /users/check-invite/:token" "carol$ID@t.com" "$(echo $R | jq -r '.data.email')"
check "check-invite isExistingUser"    "false"           "$(echo $R | jq -r '.data.isExistingUser')"

BODY_NO_NAME=$(printf '{"token":"%s","password":"Pass123!"}' "$CTOK")
check "Accept new user without name -> 400" "400" "$(curl -s -X POST $BASE/api/users/accept-invite -H 'Content-Type: application/json' -d "$BODY_NO_NAME" | jq -r '.error.code')"
R=$(curl -s -X POST $BASE/api/users/accept-invite -H "Content-Type: application/json" -d "{\"token\":\"$CTOK\",\"name\":\"Carol\",\"password\":\"Pass123!\"}")
check "POST /users/accept-invite (new)"  "true"  "$(echo $R | jq -r '.success')"
CAROL=$(echo $R | jq -r '.data.tokens.accessToken'); CAROL_ID=$(echo $R | jq -r '.data.user.id')

R=$(curl -s -X POST $BASE/api/users/invite -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER2" -d "{\"email\":\"alice$ID@t.com\",\"role\":\"VIEWER\"}")
check "Invite existing user (other tenant)" "true" "$(echo $R | jq -r '.data.invitation.isExistingUser')"
ETOK=$(echo $R | jq -r '.data.devToken')
R=$(curl -s $BASE/api/users/check-invite/$ETOK)
check "check-invite isExistingUser=true"   "true"  "$(echo $R | jq -r '.data.isExistingUser')"
check "check-invite existingName set"      "Alice"  "$(echo $R | jq -r '.data.existingName')"
R=$(curl -s -X POST $BASE/api/users/accept-invite -H "Content-Type: application/json" -d "{\"token\":\"$ETOK\",\"password\":\"Password123!\"}")
check "Accept existing user (no name)"    "true"  "$(echo $R | jq -r '.success')"
check "Name auto-resolved"                "Alice"  "$(echo $R | jq -r '.data.user.name')"
check "isExistingUser in response"        "true"   "$(echo $R | jq -r '.data.user.isExistingUser')"

BODY_INVITE_DUP=$(printf '{"email":"%s","role":"MEMBER"}' "alice$ID@t.com")
check "Invite already-in-tenant -> 409" "409" "$(curl -s -X POST $BASE/api/users/invite -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d "$BODY_INVITE_DUP" | jq -r '.error.code')"
check "PATCH /users/:id/role" "VIEWER" "$(curl -s -X PATCH "$BASE/api/users/$BOB_ID/role" -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"role":"VIEWER"}' | jq -r '.data.user.role')"
check "PATCH own role -> 400" "400" "$(curl -s -X PATCH "$BASE/api/users/$OWNER_ID/role" -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"role":"MEMBER"}' | jq -r '.error.code')"
check "DELETE /users self -> 400" "400" "$(curl -s -X DELETE "$BASE/api/users/$OWNER_ID" -H "Authorization: Bearer $OWNER" | jq -r '.error.code')"
check "DELETE /users/:id (deactivate Bob)" "false" "$(curl -s -X DELETE "$BASE/api/users/$BOB_ID" -H "Authorization: Bearer $OWNER" | jq -r '.data.user.isActive')"

echo ""; echo "── Day 4: Projects ──"
R=$(curl -s -X POST $BASE/api/projects -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"name":"Shop App","key":"SHOP"}')
check "POST /projects"                "true" "$(echo $R | jq -r '.success')"
check "Creator auto-added as member" "1"    "$(echo $R | jq -r '.data.project._count.members')"
PID=$(echo $R | jq -r '.data.project.id')

R=$(curl -s -X POST $BASE/api/projects -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"name":"Admin","key":"ADMN"}')
check "POST second project"     "true" "$(echo $R | jq -r '.success')"
PID2=$(echo $R | jq -r '.data.project.id')
check "Duplicate key -> 409"    "409"  "$(curl -s -X POST $BASE/api/projects -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"name":"X","key":"SHOP"}' | jq -r '.error.code')"
check "Create as MEMBER -> 403" "403"  "$(curl -s -X POST $BASE/api/projects -H 'Content-Type: application/json' -H "Authorization: Bearer $CAROL" -d '{"name":"X","key":"XXX"}' | jq -r '.error.code')"
check "GET /projects total=2"   "2"    "$(curl -s $BASE/api/projects -H "Authorization: Bearer $OWNER" | jq -r '.data.total')"
check "GET /projects as MEMBER" "true" "$(curl -s $BASE/api/projects -H "Authorization: Bearer $CAROL" | jq -r '.success')"
check "GET /projects/:id"       "Shop App" "$(curl -s $BASE/api/projects/$PID -H "Authorization: Bearer $OWNER" | jq -r '.data.project.name')"
check "GET /projects not found -> 404" "404" "$(curl -s $BASE/api/projects/00000000-0000-0000-0000-000000000000 -H "Authorization: Bearer $OWNER" | jq -r '.error.code')"
check "PATCH /projects/:id"     "Shop v2" "$(curl -s -X PATCH $BASE/api/projects/$PID -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"name":"Shop v2"}' | jq -r '.data.project.name')"
check "PATCH as MEMBER -> 403"  "403"  "$(curl -s -X PATCH $BASE/api/projects/$PID -H 'Content-Type: application/json' -H "Authorization: Bearer $CAROL" -d '{"name":"Hack"}' | jq -r '.error.code')"
BODY_ADD_MEMBER=$(printf '{"userId":"%s","role":"MEMBER"}' "$CAROL_ID")
check "POST /projects/:id/members" "true" "$(curl -s -X POST "$BASE/api/projects/$PID/members" -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d "$BODY_ADD_MEMBER" | jq -r '.success')"
check "GET /projects/:id/members count=2" "2" "$(curl -s "$BASE/api/projects/$PID/members" -H "Authorization: Bearer $OWNER" | jq -r '.data.total')"
check "DELETE /projects/:id/members/:userId" "true" "$(curl -s -X DELETE "$BASE/api/projects/$PID/members/$CAROL_ID" -H "Authorization: Bearer $OWNER" | jq -r '.success')"
check "Archive project" "true" "$(curl -s -X DELETE $BASE/api/projects/$PID2 -H "Authorization: Bearer $OWNER" | jq -r '.data.project.isArchived')"

echo ""; echo "── Day 5: Tasks & Board ──"
echo "  Creating 5 tasks with different statuses..."
T1=$(curl -s -X POST "$BASE/api/projects/$PID/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"title":"Task 1","status":"TODO","priority":"LOW","labels":["backend"]}')
T1ID=$(echo $T1 | jq -r '.data.task.id')
check "Task 1: SHOP-1 TODO"        "SHOP-1" "$(echo $T1 | jq -r '.data.task.taskKey')"
T2=$(curl -s -X POST "$BASE/api/projects/$PID/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"title":"Task 2","status":"IN_PROGRESS","priority":"MEDIUM"}')
T2ID=$(echo $T2 | jq -r '.data.task.id')
check "Task 2: SHOP-2 IN_PROGRESS" "SHOP-2" "$(echo $T2 | jq -r '.data.task.taskKey')"
T3=$(curl -s -X POST "$BASE/api/projects/$PID/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"title":"Task 3","status":"IN_REVIEW","priority":"HIGH"}')
T3ID=$(echo $T3 | jq -r '.data.task.id')
check "Task 3: SHOP-3 IN_REVIEW"   "SHOP-3" "$(echo $T3 | jq -r '.data.task.taskKey')"
T4=$(curl -s -X POST "$BASE/api/projects/$PID/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"title":"Task 4","status":"DONE","priority":"URGENT","labels":["release"]}')
T4ID=$(echo $T4 | jq -r '.data.task.id')
check "Task 4: SHOP-4 DONE"        "SHOP-4" "$(echo $T4 | jq -r '.data.task.taskKey')"
T5=$(curl -s -X POST "$BASE/api/projects/$PID/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"title":"Task 5","status":"CANCELLED","priority":"LOW"}')
T5ID=$(echo $T5 | jq -r '.data.task.id')
check "Task 5: SHOP-5 CANCELLED"   "SHOP-5" "$(echo $T5 | jq -r '.data.task.taskKey')"

echo ""; echo "  Board grouping (DELIVERABLE)..."
BOARD=$(curl -s "$BASE/api/projects/$PID/tasks/board" -H "Authorization: Bearer $OWNER")
check "DELIVERABLE Board TODO=1"        "1" "$(echo $BOARD | jq -r '.data.columnCounts.TODO')"
check "DELIVERABLE Board IN_PROGRESS=1" "1" "$(echo $BOARD | jq -r '.data.columnCounts.IN_PROGRESS')"
check "DELIVERABLE Board IN_REVIEW=1"   "1" "$(echo $BOARD | jq -r '.data.columnCounts.IN_REVIEW')"
check "DELIVERABLE Board DONE=1"        "1" "$(echo $BOARD | jq -r '.data.columnCounts.DONE')"
check "DELIVERABLE Board CANCELLED=1"   "1" "$(echo $BOARD | jq -r '.data.columnCounts.CANCELLED')"
check "SHOP-1 in TODO col"        "SHOP-1" "$(echo $BOARD | jq -r '.data.board.TODO[0].taskKey')"
check "SHOP-2 in IN_PROGRESS col" "SHOP-2" "$(echo $BOARD | jq -r '.data.board.IN_PROGRESS[0].taskKey')"
check "SHOP-3 in IN_REVIEW col"   "SHOP-3" "$(echo $BOARD | jq -r '.data.board.IN_REVIEW[0].taskKey')"
check "SHOP-4 in DONE col"        "SHOP-4" "$(echo $BOARD | jq -r '.data.board.DONE[0].taskKey')"
check "SHOP-5 in CANCELLED col"   "SHOP-5" "$(echo $BOARD | jq -r '.data.board.CANCELLED[0].taskKey')"

echo ""; echo "  Status change + history (DELIVERABLE)..."
R=$(curl -s -X PATCH "$BASE/api/tasks/$T1ID/status" -H "Content-Type: application/json" -H "Authorization: Bearer $OWNER" -d '{"status":"IN_PROGRESS"}')
check "PATCH /tasks/:id/status TODO->IN_PROGRESS" "IN_PROGRESS" "$(echo $R | jq -r '.data.task.status')"
D=$(curl -s "$BASE/api/tasks/$T1ID" -H "Authorization: Bearer $OWNER")
check "DELIVERABLE STATUS_CHANGE recorded" "STATUS_CHANGE" "$(echo $D | jq -r '.data.task.activities[0].type')"
check "DELIVERABLE History from=TODO"      "TODO"           "$(echo $D | jq -r '.data.task.activities[0].oldValue')"
check "DELIVERABLE History to=IN_PROGRESS" "IN_PROGRESS"    "$(echo $D | jq -r '.data.task.activities[0].newValue')"
check "Same status -> 400" "400" "$(curl -s -X PATCH "$BASE/api/tasks/$T1ID/status" -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"status":"IN_PROGRESS"}' | jq -r '.error.code')"
BOARD2=$(curl -s "$BASE/api/projects/$PID/tasks/board" -H "Authorization: Bearer $OWNER")
check "Board TODO=0 after move"        "0" "$(echo $BOARD2 | jq -r '.data.columnCounts.TODO')"
check "Board IN_PROGRESS=2 after move" "2" "$(echo $BOARD2 | jq -r '.data.columnCounts.IN_PROGRESS')"

echo ""; echo "  Task CRUD edge cases..."
check "GET /tasks/:id"                "SHOP-1" "$(curl -s "$BASE/api/tasks/$T1ID" -H "Authorization: Bearer $OWNER" | jq -r '.data.task.taskKey')"
check "GET /tasks/:id has activities" "true"   "$(curl -s "$BASE/api/tasks/$T1ID" -H "Authorization: Bearer $OWNER" | jq -r '(.data.task.activities|length)>0')"
check "PATCH /tasks/:id update"       "New Title" "$(curl -s -X PATCH "$BASE/api/tasks/$T1ID" -H 'Content-Type: application/json' -H "Authorization: Bearer $OWNER" -d '{"title":"New Title"}' | jq -r '.data.task.title')"
check "List filter by label=release"          "1" "$(curl -s "$BASE/api/projects/$PID/tasks?label=release" -H "Authorization: Bearer $OWNER" | jq -r '.data.total')"
check "List filter by status=IN_PROGRESS (2)" "2" "$(curl -s "$BASE/api/projects/$PID/tasks?status=IN_PROGRESS" -H "Authorization: Bearer $OWNER" | jq -r '.data.total')"
check "DELETE /tasks/:id soft delete" "true" "$(curl -s -X DELETE "$BASE/api/tasks/$T5ID" -H "Authorization: Bearer $OWNER" | jq -r '.success')"
check "Deleted task -> 404"           "404"  "$(curl -s "$BASE/api/tasks/$T5ID" -H "Authorization: Bearer $OWNER" | jq -r '.error.code')"
check "Board excludes deleted (CANCELLED=0)" "0" "$(curl -s "$BASE/api/projects/$PID/tasks/board" -H "Authorization: Bearer $OWNER" | jq -r '.data.columnCounts.CANCELLED')"
check "GET /tasks not found -> 404"   "404"  "$(curl -s "$BASE/api/tasks/00000000-0000-0000-0000-000000000000" -H "Authorization: Bearer $OWNER" | jq -r '.error.code')"

echo ""; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  RESULTS: %d passed  |  %d failed\n" $PASS $FAIL
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ $FAIL -eq 0 ] && echo "  All tests passed!" || echo "  Some tests failed"
exit $FAIL
