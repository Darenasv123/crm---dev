#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
STACK_ROOT="${STACK_ROOT:?STACK_ROOT is required}"
ARTIFACT_DIR="${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
RUN_SUFFIX="${CI_RUN_SUFFIX:-local-ci}"

BOOTSTRAP_LOG="$ARTIFACT_DIR/bootstrap-validation.log"
VERIFY_OUTPUT="$ARTIFACT_DIR/verify-output.txt"
RUNTIME_OUTPUT="$ARTIFACT_DIR/runtime.txt"
TEST_OUTPUT="$ARTIFACT_DIR/test-results.txt"
RESULT_FILE="$ARTIFACT_DIR/result.txt"
START_OUTPUT="${RUNNER_TEMP:-/tmp}/crm-supabase-start.log"

CURRENT_RESULT="BOOTSTRAP_FAILED"
FINALIZED=0
DB_CONTAINER=""

mkdir -p "$ARTIFACT_DIR" "$STACK_ROOT"
: > "$BOOTSTRAP_LOG"
: > "$VERIFY_OUTPUT"
: > "$RUNTIME_OUTPUT"
: > "$TEST_OUTPUT"
printf '%s\n' "$CURRENT_RESULT" > "$RESULT_FILE"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$BOOTSTRAP_LOG"
}

set_result() {
  CURRENT_RESULT="$1"
  printf '%s\n' "$CURRENT_RESULT" > "$RESULT_FILE"
}

fail() {
  set_result "$1"
  log "$1: $2"
  exit 1
}

stop_stack() {
  if [[ -f "$STACK_ROOT/supabase/config.toml" ]]; then
    log "Stopping disposable Supabase stack without backup"
    (cd "$STACK_ROOT" && supabase stop --no-backup) > /dev/null 2>&1 || true
  fi
  DB_CONTAINER=""
}

finish() {
  stop_stack
  if [[ "$FINALIZED" -ne 1 ]]; then
    printf '%s\n' "$CURRENT_RESULT" > "$RESULT_FILE"
  fi
}
trap finish EXIT

discover_db_container() {
  local matches
  matches="$(docker ps --format '{{.ID}} {{.Names}} {{.Image}}' | awk '$2 ~ /^supabase_db_/ {print $1}')"
  if [[ "$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l)" -ne 1 ]]; then
    return 1
  fi
  DB_CONTAINER="$(printf '%s\n' "$matches" | sed '/^$/d')"
}

wait_for_stack() {
  local attempt health
  for attempt in $(seq 1 90); do
    if discover_db_container; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
      if [[ "$health" == "healthy" || "$health" == "running" ]]; then
        if docker exec "$DB_CONTAINER" pg_isready -U postgres -d postgres > /dev/null 2>&1; then
          if (cd "$STACK_ROOT" && supabase status > /dev/null 2>&1); then
            return 0
          fi
        fi
      fi
    fi
    sleep 2
  done
  return 1
}

psql_ci() {
  docker exec -i "$DB_CONTAINER" psql --no-psqlrc -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

initialize_stack_project() {
  if [[ ! -f "$STACK_ROOT/supabase/config.toml" ]]; then
    (cd "$STACK_ROOT" && supabase init --force) > /dev/null
    sed -i 's/^project_id = .*/project_id = "crm-bootstrap-ci"/' "$STACK_ROOT/supabase/config.toml"
  fi
}

start_stack() {
  local iteration="$1"
  log "Starting disposable Supabase stack (iteration $iteration)"
  : > "$START_OUTPUT"
  if ! (cd "$STACK_ROOT" && supabase start) > "$START_OUTPUT" 2>&1; then
    fail "BOOTSTRAP_FAILED" "supabase start failed during iteration $iteration (raw CLI output withheld because it contains disposable keys)"
  fi
  wait_for_stack || fail "BOOTSTRAP_FAILED" "Supabase health checks timed out during iteration $iteration"
  log "Supabase health checks passed (iteration $iteration)"
}

record_runtime() {
  {
    echo "captured_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "runner=$(uname -a)"
    echo "cpus=$(nproc)"
    free -h
    df -h "$RUNNER_TEMP"
    docker version
    docker info --format 'server={{.ServerVersion}} os={{.OperatingSystem}} arch={{.Architecture}} cpus={{.NCPU}} memory={{.MemTotal}}'
    supabase --version
    docker ps --format 'container={{.Names}} image={{.Image}} status={{.Status}}'
    psql_ci -Atqc "select version();"
  } > "$RUNTIME_OUTPUT"
}

check_runtime_major() {
  local version_num
  version_num="$(psql_ci -Atqc "select current_setting('server_version_num');")"
  if [[ ! "$version_num" =~ ^17[0-9]{4}$ ]]; then
    fail "RUNTIME_MISMATCH" "Supabase CLI started PostgreSQL server_version_num=$version_num; PostgreSQL 17.x is mandatory"
  fi
  log "PostgreSQL runtime accepted: server_version_num=$version_num"
}

run_preflight() {
  local iteration="$1"
  log "Running preflight (iteration $iteration)"
  if ! psql_ci < "$REPO_ROOT/scripts/ci/self-hosted-bootstrap/preflight.sql" >> "$BOOTSTRAP_LOG" 2>&1; then
    fail "BOOTSTRAP_FAILED" "preflight failed during iteration $iteration"
  fi
}

object_snapshot() {
  psql_ci -Atqc "
    select json_build_object(
      'tables', (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
      'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
      'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and not t.tgisinternal),
      'policies', (select count(*) from pg_policies where schemaname in ('public','storage'))
    );" | tee -a "$BOOTSTRAP_LOG"
}

apply_bootstrap() {
  local iteration="$1" file started finished duration
  for file in "$REPO_ROOT"/supabase/self-hosted/000[1-7]_*.sql; do
    started="$(date +%s)"
    log "BEGIN $(basename "$file") iteration=$iteration"
    if ! psql_ci < "$file" >> "$BOOTSTRAP_LOG" 2>&1; then
      fail "BOOTSTRAP_FAILED" "$(basename "$file") failed during iteration $iteration"
    fi
    finished="$(date +%s)"
    duration="$((finished - started))"
    log "PASS $(basename "$file") iteration=$iteration duration_seconds=$duration"
    object_snapshot
  done
  psql_ci -c "select pg_notify('pgrst', 'reload schema');" > /dev/null
  sleep 3
}

run_verify() {
  local iteration="$1" temp_output
  temp_output="${RUNNER_TEMP:-/tmp}/verify-$iteration.txt"
  log "Running 0008_verify.sql (iteration $iteration)"
  if ! psql_ci < "$REPO_ROOT/supabase/self-hosted/0008_verify.sql" > "$temp_output" 2>&1; then
    cat "$temp_output" >> "$VERIFY_OUTPUT"
    fail "VERIFY_FAILED" "0008_verify.sql raised an error during iteration $iteration"
  fi
  {
    printf '\n===== ITERATION %s =====\n' "$iteration"
    cat "$temp_output"
  } >> "$VERIFY_OUTPUT"
  if grep -Eq '(^|[[:space:]|])FAIL([[:space:]|]|$)' "$temp_output"; then
    fail "VERIFY_FAILED" "0008_verify.sql reported at least one FAIL during iteration $iteration"
  fi
  log "0008_verify.sql passed (iteration $iteration)"
}

load_disposable_api_credentials() {
  local status_json
  status_json="$(cd "$STACK_ROOT" && supabase status -o json 2>/dev/null)"
  TEST_SUPABASE_URL="$(jq -r '.API_URL // .api_url // empty' <<< "$status_json")"
  TEST_SUPABASE_ANON_KEY="$(jq -r '.ANON_KEY // .anon_key // .PUBLISHABLE_KEY // .publishable_key // empty' <<< "$status_json")"
  TEST_SUPABASE_SERVICE_ROLE_KEY="$(jq -r '.SERVICE_ROLE_KEY // .service_role_key // .SECRET_KEY // .secret_key // empty' <<< "$status_json")"
  if [[ -z "$TEST_SUPABASE_URL" || -z "$TEST_SUPABASE_ANON_KEY" || -z "$TEST_SUPABASE_SERVICE_ROLE_KEY" ]]; then
    fail "TEST_FAILED" "Supabase CLI status did not provide disposable API credentials"
  fi
  export TEST_SUPABASE_URL TEST_SUPABASE_ANON_KEY TEST_SUPABASE_SERVICE_ROLE_KEY
}

run_functional_tests() {
  log "Running disposable Auth/RLS/task/document/payment/Storage/Google tests"
  load_disposable_api_credentials
  if ! CI_RUN_SUFFIX="$RUN_SUFFIX" node "$REPO_ROOT/scripts/ci/self-hosted-bootstrap/functional-tests.mjs" >> "$TEST_OUTPUT" 2>&1; then
    unset TEST_SUPABASE_ANON_KEY TEST_SUPABASE_SERVICE_ROLE_KEY
    fail "TEST_FAILED" "functional backend tests failed"
  fi
  unset TEST_SUPABASE_ANON_KEY TEST_SUPABASE_SERVICE_ROLE_KEY
  log "Functional backend tests passed"
}

run_repository_tests() {
  log "Running repository tests, TypeScript, ESLint and build"
  {
    cd "$REPO_ROOT"
    ./node_modules/.bin/vitest run \
      tests/self-hosted-bootstrap.test.ts \
      tests/self-hosted-ci-validation.test.ts \
      tests/task-claim-migration.test.ts \
      tests/document-folders.test.ts \
      tests/document-migration.test.ts \
      tests/payments-atomic.test.ts \
      tests/permissions.test.ts \
      tests/google-calendar-security.test.ts
    ./node_modules/.bin/tsc --noEmit --pretty false
    ./node_modules/.bin/eslint \
      src \
      tests \
      scripts/ci/self-hosted-bootstrap/functional-tests.mjs
    VITE_SUPABASE_URL=http://127.0.0.1:54321 \
      VITE_SUPABASE_ANON_KEY=ci-disposable-placeholder \
      npm run build
  } >> "$TEST_OUTPUT" 2>&1 || fail "TEST_FAILED" "repository validation failed"
  log "Repository validation passed"
}

verify_stack_removed() {
  local remaining
  remaining="$(docker ps -a --format '{{.Names}}' | grep '^supabase_.*crm-bootstrap-ci' || true)"
  if [[ -n "$remaining" ]]; then
    fail "BOOTSTRAP_FAILED" "Supabase containers remained after stop --no-backup"
  fi
}

initialize_stack_project
start_stack 1
record_runtime
check_runtime_major
run_preflight 1
apply_bootstrap 1
run_verify 1
run_functional_tests
run_repository_tests

stop_stack
verify_stack_removed

start_stack 2
check_runtime_major
run_preflight 2
apply_bootstrap 2
run_verify 2

set_result "PASS"
FINALIZED=1
log "PASS: both clean reconstructions and all tests completed"
