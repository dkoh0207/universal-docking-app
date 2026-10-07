#!/usr/bin/env bash
# Start / stop the PyMOL Web servers in the background (works in Git Bash on Windows, Linux and macOS).
#
#   ./server.sh start [dev|prod] [--no-build]   dev: Vite (HMR) + uvicorn --reload;  prod: build, then one uvicorn serving API + frontend
#   ./server.sh stop [dev|prod|all]             stop the recorded processes and their children
#   ./server.sh restart [dev|prod]
#   ./server.sh status
#   ./server.sh logs [dev|prod] [-f]
#
# Ports (override with env vars):  WEB_PORT=5179 (dev Vite)   BACKEND_PORT=8787 (dev API)   PROD_PORT=8080 (prod)
# Port 8000 is not the default because other local tools commonly use it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
LOGS="$RUN/logs"
WEB_PORT="${WEB_PORT:-5179}"
BACKEND_PORT="${BACKEND_PORT:-8787}"
PROD_PORT="${PROD_PORT:-8080}"
HOST=127.0.0.1

IS_WIN=0
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) IS_WIN=1 ;; esac
if [ $IS_WIN = 1 ]; then PY="$ROOT/backend/.env/python.exe"; else PY="$ROOT/backend/.env/bin/python"; fi
# Node, npm and the engines come from the conda env first, so nothing system-wide is required
if [ $IS_WIN = 1 ]; then export PATH="$ROOT/backend/.env:$ROOT/backend/.env/Library/bin:$PATH"; else export PATH="$ROOT/backend/.env/bin:$PATH"; fi
VITE="$ROOT/frontend/node_modules/vite/bin/vite.js"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- process helpers
winpid() { if [ $IS_WIN = 1 ] && [ -r "/proc/$1/winpid" ]; then cat "/proc/$1/winpid"; else echo "$1"; fi; }

alive() {
  [ -n "$1" ] || return 1
  if [ $IS_WIN = 1 ]; then
    tasklist //FI "PID eq $1" //NH 2>/dev/null | tr -d '\r' | grep -qE "(^|[[:space:]])$1([[:space:]]|\$)"
  else
    kill -0 "$1" 2>/dev/null
  fi
}

killtree() {
  if [ $IS_WIN = 1 ] && command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$1" //T //F >/dev/null 2>&1
  else
    kill -TERM -- "-$1" 2>/dev/null || kill -TERM "$1" 2>/dev/null
    sleep 1
    kill -KILL -- "-$1" 2>/dev/null || kill -KILL "$1" 2>/dev/null
  fi
  return 0
}

# PID listening on a TCP port (empty when free)
port_pid() {
  if [ $IS_WIN = 1 ]; then
    netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$1" '$1 == "TCP" && $4 == "LISTENING" && substr($2, length($2) - length(p) + 1) == p { print $5; exit }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
  else
    ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1
  fi
}

# ---------------------------------------------------------------- modes
procs_of() { case "$1" in dev) echo "api web" ;; prod) echo "app" ;; esac; }
port_of() {
  case "$1-$2" in
    dev-api) echo "$BACKEND_PORT" ;;
    dev-web) echo "$WEB_PORT" ;;
    prod-app) echo "$PROD_PORT" ;;
  esac
}
pidfile() { echo "$RUN/$1-$2.pid"; }
logfile() { echo "$LOGS/$1-$2.log"; }
read_pid() { [ -f "$(pidfile "$1" "$2")" ] && tr -d '\r\n' <"$(pidfile "$1" "$2")"; }

check_mode() { case "${1:-dev}" in dev | prod) ;; *) die "unknown mode '$1' (use dev or prod)" ;; esac; }

# ---------------------------------------------------------------- start
need_setup() {
  [ -x "$PY" ] || [ -f "$PY" ] || die "backend/.env is missing - run 'npm run setup' first"
  [ -f "$VITE" ] || die "frontend dependencies are missing - run 'npm run setup' first"
}

launch() { # pidfile dir log cmd...  -> starts a detached process and writes its (Windows) pid to the pidfile
  local pf="$1" dir="$2" log="$3"
  shift 3
  (cd "$dir" && nohup "$@" >"$log" 2>&1 </dev/null & echo $! >"$pf.tmp") >/dev/null 2>&1
  winpid "$(cat "$pf.tmp")" >"$pf"
  rm -f "$pf.tmp"
}

wait_port() { # port seconds
  local i=0
  while [ $i -lt $(($2 * 2)) ]; do
    [ -n "$(port_pid "$1")" ] && return 0
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

start_proc() {
  local mode="$1" name="$2" port wp
  port="$(port_of "$mode" "$name")"
  local cur
  cur="$(read_pid "$mode" "$name")"
  if [ -n "$cur" ] && alive "$cur"; then say "$mode-$name already running (pid $cur)"; return 0; fi
  [ -n "$cur" ] && rm -f "$(pidfile "$mode" "$name")"
  local holder
  holder="$(port_pid "$port")"
  [ -z "$holder" ] || die "port $port is already in use (pid $holder); stop it or set another port"
  mkdir -p "$LOGS"
  : >"$(logfile "$mode" "$name")"
  local pf lf
  pf="$(pidfile "$mode" "$name")"
  lf="$(logfile "$mode" "$name")"
  case "$mode-$name" in
    dev-api) launch "$pf" "$ROOT/backend" "$lf" "$PY" -m uvicorn app.main:app --host $HOST --port "$port" --reload --reload-dir app --timeout-graceful-shutdown 2 ;;
    dev-web) launch "$pf" "$ROOT/frontend" "$lf" env BACKEND_PORT="$BACKEND_PORT" node "$VITE" --host $HOST ;;
    prod-app) launch "$pf" "$ROOT/backend" "$lf" env PYMOL_WEB_STATIC="$ROOT/frontend/dist" "$PY" -m uvicorn app.main:app --host $HOST --port "$port" --timeout-graceful-shutdown 2 ;;
  esac
  wp="$(read_pid "$mode" "$name")"
  if wait_port "$port" 40; then
    # record the process that actually listens (the launcher stub may differ on Windows); killing its tree stops everything
    wp="$(port_pid "$port")"
    echo "$wp" >"$pf"
    say "started $mode-$name  pid $wp  http://$HOST:$port"
  else
    say "$mode-$name failed to start; last log lines:" >&2
    tail -n 15 "$(logfile "$mode" "$name")" >&2
    killtree "$wp"
    rm -f "$(pidfile "$mode" "$name")"
    exit 1
  fi
}

cmd_start() {
  local mode="dev" build=1
  for a in "$@"; do case "$a" in --no-build) build=0 ;; dev | prod) mode="$a" ;; *) die "unknown argument '$a'" ;; esac; done
  need_setup
  if [ "$mode" = prod ] && [ $build = 1 ]; then
    say "building the frontend..."
    mkdir -p "$LOGS"
    (cd "$ROOT" && npm --prefix frontend run build >"$LOGS/build.log" 2>&1) || { die "build failed (see .run/logs/build.log)"; }
  fi
  [ "$mode" = prod ] && [ ! -f "$ROOT/frontend/dist/index.html" ] && die "frontend/dist is missing - run without --no-build"
  mkdir -p "$LOGS"
  for name in $(procs_of "$mode"); do start_proc "$mode" "$name"; done
  [ "$mode" = dev ] && say "open http://localhost:$WEB_PORT/" || say "open http://localhost:$PROD_PORT/"
}

# ---------------------------------------------------------------- stop
stop_mode() {
  local mode="$1" name pid
  for name in $(procs_of "$mode"); do
    pid="$(read_pid "$mode" "$name")"
    if [ -z "$pid" ]; then continue; fi
    if alive "$pid"; then
      killtree "$pid"
      say "stopped $mode-$name (pid $pid)"
    else
      say "$mode-$name: removed stale pid file ($pid)"
    fi
    rm -f "$(pidfile "$mode" "$name")"
    local port left i=0
    port="$(port_of "$mode" "$name")"
    while [ -n "$(port_pid "$port")" ] && [ $i -lt 10 ]; do sleep 0.5; i=$((i + 1)); done
    left="$(port_pid "$port")"
    [ -z "$left" ] || say "warning: port $port is still held by pid $left (not started by this script?)"
  done
}

cmd_stop() {
  local what="${1:-all}"
  case "$what" in
    all) stop_mode dev; stop_mode prod ;;
    dev | prod) stop_mode "$what" ;;
    *) die "unknown target '$what' (use dev, prod or all)" ;;
  esac
}

# ---------------------------------------------------------------- status & logs
cmd_status() {
  local mode name pid port state health
  printf '%-10s %-9s %-8s %-6s %-26s %s\n' PROCESS STATE PID PORT URL HEALTH
  for mode in dev prod; do
    for name in $(procs_of "$mode"); do
      pid="$(read_pid "$mode" "$name")"
      port="$(port_of "$mode" "$name")"
      if [ -z "$pid" ]; then state=stopped; elif alive "$pid"; then state=running; else state="stale"; fi
      health="-"
      if [ "$state" = running ]; then
        if [ "$name" = web ]; then
          curl -fsS --max-time 3 -o /dev/null "http://$HOST:$port/" 2>/dev/null && health="ok (page)" || health="no response"
          curl -fsS --max-time 3 -o /dev/null "http://$HOST:$port/api/health" 2>/dev/null && health="$health, proxy ok" || health="$health, proxy down"
        else
          health="$(curl -fsS --max-time 3 "http://$HOST:$port/api/health" 2>/dev/null | head -c 70)"
          [ -n "$health" ] && health="ok $health" || health="no response"
        fi
      fi
      printf '%-10s %-9s %-8s %-6s %-26s %s\n' "$mode-$name" "$state" "${pid:--}" "$port" "http://$HOST:$port/" "$health"
    done
  done
}

cmd_logs() {
  local mode="dev" follow=0
  for a in "$@"; do case "$a" in -f) follow=1 ;; dev | prod) mode="$a" ;; *) die "unknown argument '$a'" ;; esac; done
  local files=() name
  for name in $(procs_of "$mode"); do [ -f "$(logfile "$mode" "$name")" ] && files+=("$(logfile "$mode" "$name")"); done
  [ ${#files[@]} -gt 0 ] || die "no $mode logs yet"
  if [ $follow = 1 ]; then tail -n 30 -f "${files[@]}"; else tail -n 60 "${files[@]}"; fi
}

usage() {
  cat <<EOF
Usage: ./server.sh <command> [args]

  start [dev|prod] [--no-build]   start in the background (default: dev)
                                    dev   Vite on :$WEB_PORT (HMR, proxies /api) + uvicorn --reload on :$BACKEND_PORT
                                    prod  builds frontend/dist (unless --no-build), then one uvicorn on :$PROD_PORT
                                          serving the API under /api and the built frontend at /
  stop [dev|prod|all]             stop recorded processes and their children (default: all)
  restart [dev|prod]              stop, then start (default: dev)
  status                          state, PID, port, URL and /api/health result of every process
  logs [dev|prod] [-f]            show (or follow) the logs in .run/logs

PIDs are kept in .run/<mode>-<name>.pid, logs in .run/logs/<mode>-<name>.log.
Ports: WEB_PORT=$WEB_PORT  BACKEND_PORT=$BACKEND_PORT  PROD_PORT=$PROD_PORT (environment variables override them).
First time? Run 'npm run setup'.
EOF
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  restart) shift; m="${1:-dev}"; check_mode "$m"; cmd_stop "$m"; cmd_start "$m" ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  "" | help | -h | --help) usage ;;
  *) usage >&2; exit 1 ;;
esac
