#!/usr/bin/env bash
#
# Shared helpers for the smoke scripts (smoke-test.sh, difftool-accumulate.sh,
# ground-truth.sh). Sourced, never executed directly.

# Is something already listening on a loopback TCP port?
#
# Uses curl, which every smoke script already depends on, rather than lsof/ss
# (absent or differently-flagged across macOS, Linux, and Git Bash). curl exits
# 7 (CURLE_COULDNT_CONNECT) when nothing is listening; any other outcome means
# something accepted the connection, even if it spoke no HTTP. Treating
# "unsure" as in-use is deliberate — it produces a readable failure instead of
# letting the server die on an unhandled EADDRINUSE.
#
# --max-time as well as --connect-timeout, because the kernel completes the TCP
# handshake into the listen backlog even when the owning process never calls
# accept(). Against such a port connect() returns immediately and only the
# response is missing, so a connect timeout alone would hang here forever.
smoke_port_in_use() {
  local port="$1" rc=0
  curl -s -o /dev/null --connect-timeout 2 --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || rc=$?
  [[ $rc -ne 7 ]]
}

# Resolve the port a smoke server should bind, failing early and readably when
# it is taken. Sets SMOKE_PORT.
#
#   $1 — default port
#   $2 — name of the environment variable that overrides it
#
# Sets a variable rather than echoing one: the failure path has to `exit`, and
# an `exit` inside a `$(...)` substitution would only leave the subshell.
#
# Every smoke server runs with --strict-port (the test has to know where to
# send its requests, so silently sliding to another port would be worse), which
# means a collision otherwise surfaces as a raw Node `listen EADDRINUSE` stack
# dump with no hint that an unrelated local service — not the code under test —
# is what broke the run.
smoke_resolve_port() {
  local default_port="$1" var_name="$2" port
  port="${!var_name-}"
  port="${port:-$default_port}"

  if smoke_port_in_use "$port"; then
    echo "" >&2
    echo "  port $port is already in use — cannot start the smoke server." >&2
    echo "  Something unrelated is listening on it (another dev server, or a" >&2
    echo "  previous run that did not shut down)." >&2
    echo "" >&2
    echo "  Free the port, or pick another one:" >&2
    echo "      $var_name=<port> $0" >&2
    echo "" >&2
    exit 1
  fi

  SMOKE_PORT="$port"
}
