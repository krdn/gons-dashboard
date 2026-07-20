#!/usr/bin/env bash
# gons-monitoring-agent — 호스트 vitals 수집 → dashboard /api/agent/metrics-ingest push.
# 이슈 #323 Phase 1·2. 컨테이너 격리로 앱이 직접 못 읽는 /proc·hwmon·GPU 지표와
# systemd·cron 관찰치를 호스트에서 수집해 Bearer 인증으로 push 한다.
#
# 사용:
#   agent.sh            # 루프 모드 (systemd 서비스용, INTERVAL_SEC 주기)
#   agent.sh --once     # 1회 수집·전송 후 종료 (설치 스모크 — checks 포함)
#   agent.sh --dry-run  # 1회 수집·payload 출력만 (전송 없음)
#
# env:
#   METRICS_INGEST_TOKEN  (필수, --dry-run 제외) 대시보드 .env 와 동일 값
#   DASHBOARD_URL         기본 http://localhost:3020
#   HOST_NAME             기본 hostname — 대시보드 hosts.name 과 일치해야 함
#   INTERVAL_SEC          기본 15
#   CHECKS_EVERY_N        기본 4 — N사이클(기본 60초)마다 checks payload push
#   WATCH_SERVICES        공백 구분 systemd 서비스 목록 (예: "nginx docker fail2ban")
#   WATCH_TIMERS          공백 구분 타이머 유닛 목록 (예: "n8n-backup.timer certbot.timer")
#   HOSTCRON_SPECS        공백 구분 "이름|로그경로|maxAge분" (예: "self-healing|/var/log/self-healing.log|75")
#                         — maxAge분: 이 시간 넘게 로그 mtime 정지면 실행 흔적 없음 판정(서버측)
set -u
LC_ALL=C # awk printf 소수점이 로케일에 따라 콤마가 되는 것 방지

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3020}"
HOST_NAME="${HOST_NAME:-$(hostname)}"
HOST_NAME="${HOST_NAME//[^A-Za-z0-9._-]/}" # JSON 안전 문자만
INTERVAL_SEC="${INTERVAL_SEC:-15}"
CHECKS_EVERY_N="${CHECKS_EVERY_N:-4}"
# 양의 정수가 아니면 기본값 — 0 은 나머지 연산 오류, 비정수는 산술 오류로
# 에이전트가 재시작 루프에 빠진다 (Codex P2).
[[ "$CHECKS_EVERY_N" =~ ^[1-9][0-9]*$ ]] || CHECKS_EVERY_N=4
WATCH_SERVICES="${WATCH_SERVICES:-}"
WATCH_TIMERS="${WATCH_TIMERS:-}"
HOSTCRON_SPECS="${HOSTCRON_SPECS:-}"

MODE="loop"
case "${1:-}" in
  --once) MODE="once" ;;
  --dry-run) MODE="dry-run" ;;
esac
if [ "$MODE" != "dry-run" ]; then
  : "${METRICS_INGEST_TOKEN:?METRICS_INGEST_TOKEN 환경변수가 필요합니다}"
fi

# 임시 파일 — 예측 불가 경로(mktemp) + 종료 시 정리 (고정 /tmp 경로의 symlink 공격 방지).
# 토큰은 curl 인자가 아닌 헤더 파일(-H @file, mode 600)로 전달 — /proc cmdline 노출 방지.
RESP_FILE=$(mktemp)
HDR_FILE=$(mktemp)
trap 'rm -f "$RESP_FILE" "$HDR_FILE"' EXIT
if [ "$MODE" != "dry-run" ]; then
  chmod 600 "$HDR_FILE"
  printf 'Authorization: Bearer %s\n' "$METRICS_INGEST_TOKEN" >"$HDR_FILE"
fi

# ---------- 스냅샷 상태 (delta 기반 지표: cpu, net) ----------
PREV_CPU_IDLE=""
PREV_CPU_TOTAL=""
declare -A PREV_RX
declare -A PREV_TX
PREV_TS=0

cpu_snapshot() {
  # "idle total" — idle=idle+iowait, total=user..steal 합
  awk '/^cpu /{ idle=$5+$6; total=$2+$3+$4+$5+$6+$7+$8+$9; print idle, total }' /proc/stat
}

net_snapshot() {
  # "iface rx_bytes tx_bytes" — 물리 인터페이스만 (lo/veth/br/docker 제외)
  awk '/:/ {
    line=$0; sub(/^ +/, "", line); split(line, a, ":");
    iface=a[1];
    if (iface !~ /^(en|eth|wl|bond)/) next;
    split(a[2], f, " ");
    print iface, f[1], f[9];
  }' /proc/net/dev
}

take_snapshots() {
  read -r PREV_CPU_IDLE PREV_CPU_TOTAL <<<"$(cpu_snapshot)"
  while read -r iface rx tx; do
    [ -n "$iface" ] || continue
    PREV_RX[$iface]=$rx
    PREV_TX[$iface]=$tx
  done <<<"$(net_snapshot)"
  PREV_TS=$(date +%s)
}

# ---------- 수집 ----------
collect() {
  local now elapsed
  now=$(date +%s)
  elapsed=$((now - PREV_TS))
  [ "$elapsed" -lt 1 ] && elapsed=1

  # CPU % (직전 스냅샷 대비)
  local idle total
  read -r idle total <<<"$(cpu_snapshot)"
  CPU_PCT=$(awk -v pi="$PREV_CPU_IDLE" -v pt="$PREV_CPU_TOTAL" -v i="$idle" -v t="$total" \
    'BEGIN { dt=t-pt; if (dt<=0) { print "0"; exit } printf "%.1f", (1-(i-pi)/dt)*100 }')
  PREV_CPU_IDLE=$idle
  PREV_CPU_TOTAL=$total

  # Load
  read -r L1 L5 L15 _ </proc/loadavg

  # 메모리·스왑
  read -r MEM_PCT SWAP_MB <<<"$(awk '
    /^MemTotal:/ { mt=$2 } /^MemAvailable:/ { ma=$2 }
    /^SwapTotal:/ { st=$2 } /^SwapFree:/ { sf=$2 }
    END {
      pct = (mt>0) ? (1-ma/mt)*100 : 0;
      printf "%.1f %.0f", pct, (st-sf)/1024;
    }' /proc/meminfo)"

  # 디스크 (used% + inode%) — 실 파일시스템만, mount 는 JSON 안전 문자만, 최대 20개.
  # NF!=6 skip: 공백 포함 마운트/장치명이 잘린 이름으로 기록되는 것을 방지.
  DISKS_JSON=$(awk '
    FNR==NR { if (NF != 6) next; p=$5; gsub(/%/,"",p); if (p ~ /^[0-9]+$/) inode[$6]=p; next }
    FNR>1 {
      if (NF != 6) next;
      p=$5; gsub(/%/,"",p); m=$6;
      if (m !~ /^[A-Za-z0-9\/._-]+$/ || p !~ /^[0-9]+$/ || n>=20) next;
      printf "%s{\"mount\":\"%s\",\"usedPct\":%s", (n++?",":""), m, p;
      if (m in inode) printf ",\"inodePct\":%s", inode[m];
      printf "}";
    }' \
    <(df -Pi -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null) \
    <(df -P -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null))

  # CPU 온도 (hwmon 최대값, millidegree → °C)
  TEMP_C=$(cat /sys/class/hwmon/hwmon*/temp*_input 2>/dev/null | sort -n | tail -1 |
    awk '{ if ($1 > 1000) printf "%.1f", $1/1000; else if ($1 != "") printf "%.1f", $1 }')

  # GPU (nvidia-smi 있을 때만)
  GPU_JSON=""
  if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_JSON=$(nvidia-smi \
      --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu \
      --format=csv,noheader,nounits 2>/dev/null | head -1 |
      awk -F', *' 'NF>=4 && $3+0>0 { printf "{\"utilPct\":%s,\"vramPct\":%.1f,\"tempC\":%s}", $1, $2/$3*100, $4 }')
  fi

  # 네트워크 bps (직전 스냅샷 대비, 최대 10 인터페이스)
  NET_JSON=""
  local iface rx tx n=0
  while read -r iface rx tx; do
    [ -n "$iface" ] || continue
    [ "$n" -ge 10 ] && break
    local prx="${PREV_RX[$iface]:-}" ptx="${PREV_TX[$iface]:-}"
    PREV_RX[$iface]=$rx
    PREV_TX[$iface]=$tx
    [ -n "$prx" ] || continue
    local rbps=$(((rx - prx) / elapsed)) tbps=$(((tx - ptx) / elapsed))
    [ "$rbps" -lt 0 ] && rbps=0
    [ "$tbps" -lt 0 ] && tbps=0
    NET_JSON="${NET_JSON:+$NET_JSON,}{\"iface\":\"${iface//[^A-Za-z0-9._-]/}\",\"rxBps\":$rbps,\"txBps\":$tbps}"
    n=$((n + 1))
  done <<<"$(net_snapshot)"
  PREV_TS=$now

  UPTIME=$(awk '{ print int($1) }' /proc/uptime)
  if [ -f /var/run/reboot-required ]; then REBOOT=true; else REBOOT=false; fi
}

# ---------- checks 수집 (Phase 2 — systemd 서비스/타이머·호스트 cron 관찰치) ----------
# systemd 타임스탬프 문자열("Sun 2026-07-19 03:00:05 KST" 등) → epoch 초.
# 직접 파싱 실패 시 요일·타임존 어간을 떼고 호스트 로컬타임으로 재시도.
ts_to_epoch() {
  local s="$1" stripped
  [ -n "$s" ] && [ "$s" != "n/a" ] || { echo ""; return; }
  if date -d "$s" +%s 2>/dev/null; then return; fi
  stripped=$(echo "$s" | sed 's/^[A-Za-z]\+ //; s/ [A-Z]\+$//')
  date -d "$stripped" +%s 2>/dev/null || echo ""
}

# 보안 관측치 (Phase 3 §H) — root collector 가 /run 에 쓴 JSON 을 **읽기만** 한다.
# 에이전트는 NoNewPrivileges=yes 라 sudo 가 불가능하므로 직접 수집하지 않는다.
# 파일이 없거나 노후(기본 15분 초과)면 빈 문자열 → security 섹션 생략 → 서버가
# not-reported unknown 으로 판정한다 (낡은 스냅샷을 현재값으로 재사용하지 않는다).
SECURITY_FILE="${SECURITY_FILE:-/run/gons-monitoring/security.json}"
SECURITY_MAX_AGE_MIN="${SECURITY_MAX_AGE_MIN:-15}"

read_security_json() {
  [ -r "$SECURITY_FILE" ] || return 1
  local mtime age_min
  mtime=$(stat -c %Y "$SECURITY_FILE" 2>/dev/null) || return 1
  age_min=$(((  $(date +%s) - mtime ) / 60))
  [ "$age_min" -le "$SECURITY_MAX_AGE_MIN" ] || return 1
  # 한 줄 JSON 이 아니면(부분 기록 등) 중계하지 않는다 — collector 는 원자적 mv 를
  # 쓰므로 정상 상황에서 부분 파일은 관측되지 않는다.
  head -c 100000 "$SECURITY_FILE" | tr -d '\n'
}

# 데이터스토어 liveness (Phase 3 §G) — 특권 불요라 에이전트가 직접 프로브한다.
#
# ⚠️ `nc -z`(TCP 핸드셰이크만) 를 쓰지 않는다. 도커 포트포워딩은 살아있는데
# 뒤의 프로세스가 죽은 경우에도 성공해 "죽었는데 초록" 이 된다. 대신 각
# 프로토콜의 최소 요청을 보내고 **응답 시그니처를 화이트리스트로** 확인한다.
#
# 운영 실측 2026-07-20 (이 판정의 유일한 가드 — TS 테스트가 닿지 않는다):
#   PG 살아있음   → 'S' 또는 'N'  (SSLRequest 응답)
#   Redis 살아있음 → '+PONG'
#   포트 닫힘      → 빈 응답
#   다른 프로토콜(nginx) → 'H' / 'HTTP/'  ← 비어있지 않다고 ok 로 보면 오탐
#
# pg_isready/redis-cli 는 운영 호스트에 없어 nc 단독으로 구현한다(스펙 편차).
DATASTORE_SPECS="${DATASTORE_SPECS:-}"
DATASTORE_PROBE_TIMEOUT="${DATASTORE_PROBE_TIMEOUT:-5}"

# PG SSLRequest: 길이 8 + 코드 80877103. 살아있으면 'S'(SSL 가능)/'N'(불가) 1바이트.
probe_pg() {
  local port="$1" reply
  reply=$( { printf '\000\000\000\010\004\322\026\057'; sleep 1; } \
    | timeout "$DATASTORE_PROBE_TIMEOUT" nc 127.0.0.1 "$port" 2>/dev/null | head -c 1 )
  [ "$reply" = "S" ] || [ "$reply" = "N" ]
}

# PING → '+PONG'. 비밀번호가 걸린 인스턴스는 '-NOAUTH Authentication required.' 를
# 돌려주는데 이것도 **살아있다는 증거**라 ok 다(스펙 §B-1). 다만 '-' 로 시작하는
# 응답 전체를 허용하면 안 된다 — 아무 오류 문자열이나 liveness 로 통과한다.
# 실측 2026-07-20: requirepass 컨테이너가 정확히 위 문자열을 반환.
probe_redis() {
  local port="$1" reply
  reply=$( { printf 'PING\r\n'; sleep 1; } \
    | timeout "$DATASTORE_PROBE_TIMEOUT" nc 127.0.0.1 "$port" 2>/dev/null \
    | head -c 40 | tr -d '\r\n' )
  [ "$reply" = "+PONG" ] || [ "$reply" = "-NOAUTH Authentication required." ]
}

# "kind|target|port" 목록 → JSON 배열 요소들. port 빈 값 = 미노출.
build_datastore_json() {
  local spec kind target port out="" reachable
  for spec in $DATASTORE_SPECS; do
    IFS='|' read -r kind target port <<<"$spec"
    [ -n "$kind" ] && [ -n "$target" ] || continue
    if [ "$kind" != "pg" ] && [ "$kind" != "redis" ]; then
      echo "[agent] DATASTORE_SPECS: 알 수 없는 kind '$kind' — 건너뜀" >&2
      continue
    fi
    # ⚠️ 정규화 **후** 재검증한다. 서버 Zod 가 payload 전체를 검사하므로 잘못된
    # 항목 하나가 400 을 내면 checks push 가 통째로 죽어 heartbeat 까지 끊긴다
    # (관측 공백이 아니라 관측 정지 — 보드에 직전 상태가 남는다).
    target="${target//[^A-Za-z0-9._-]/}"
    if [ -z "$target" ] || [ "${#target}" -gt 60 ]; then
      echo "[agent] DATASTORE_SPECS: 잘못된 target '$spec' — 건너뜀" >&2
      continue
    fi

    if [ -z "$port" ]; then
      out="${out:+$out,}{\"kind\":\"$kind\",\"target\":\"$target\",\"observed\":false,\"reason\":\"not-exposed\"}"
      continue
    fi
    # 1..65535 밖이면 Zod 가 거부한다 — 0·65536 은 숫자 검사만으로는 통과한다.
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
      echo "[agent] DATASTORE_SPECS: 잘못된 포트 '$spec' — 건너뜀" >&2
      continue
    fi

    # nc 부재는 오탐 대신 관측 불가 — 없는 도구로 죽었다고 단정하지 않는다.
    if ! command -v nc >/dev/null 2>&1; then
      out="${out:+$out,}{\"kind\":\"$kind\",\"target\":\"$target\",\"port\":$port,\"observed\":false,\"reason\":\"nc-missing\"}"
      continue
    fi

    if [ "$kind" = "pg" ]; then
      probe_pg "$port" && reachable=true || reachable=false
    else
      probe_redis "$port" && reachable=true || reachable=false
    fi
    out="${out:+$out,}{\"kind\":\"$kind\",\"target\":\"$target\",\"port\":$port,\"observed\":true,\"reachable\":$reachable}"
  done
  printf '%s' "$out"
}

build_checks_payload() {
  local svc_json="" timer_json="" cron_json="" sec_json="" ds_json=""
  local unit state nrestarts
  sec_json=$(read_security_json) || sec_json=""
  ds_json=$(build_datastore_json)

  for unit in $WATCH_SERVICES; do
    state=$(systemctl is-active "$unit" 2>/dev/null)
    [ -n "$state" ] || state="unknown"
    nrestarts=$(systemctl show "$unit" -p NRestarts --value 2>/dev/null)
    svc_json="${svc_json:+$svc_json,}{\"unit\":\"${unit//[^A-Za-z0-9@._-]/}\",\"active\":\"${state//[^a-z-]/}\""
    [ -n "$nrestarts" ] && [[ "$nrestarts" =~ ^[0-9]+$ ]] && svc_json="$svc_json,\"nRestarts\":$nrestarts"
    svc_json="$svc_json}"
  done

  local last next result last_e next_e
  for unit in $WATCH_TIMERS; do
    last=$(systemctl show "$unit" -p LastTriggerUSec --value 2>/dev/null)
    next=$(systemctl show "$unit" -p NextElapseUSecRealtime --value 2>/dev/null)
    result=$(systemctl show "${unit%.timer}.service" -p Result --value 2>/dev/null)
    last_e=$(ts_to_epoch "$last")
    next_e=$(ts_to_epoch "$next")
    timer_json="${timer_json:+$timer_json,}{\"unit\":\"${unit//[^A-Za-z0-9@._-]/}\""
    [ -n "$last_e" ] && timer_json="$timer_json,\"lastTriggerEpoch\":$last_e"
    [ -n "$next_e" ] && timer_json="$timer_json,\"nextElapseEpoch\":$next_e"
    [ -n "$result" ] && timer_json="$timer_json,\"result\":\"${result//[^a-z-]/}\""
    timer_json="$timer_json}"
  done

  local spec name path maxage mtime size
  for spec in $HOSTCRON_SPECS; do
    IFS='|' read -r name path maxage <<<"$spec"
    [ -n "$name" ] && [ -n "$path" ] && [[ "$maxage" =~ ^[0-9]+$ ]] || continue
    name="${name//[^A-Za-z0-9._-]/}"
    if [ -r "$path" ]; then
      mtime=$(stat -c %Y "$path" 2>/dev/null)
      size=$(stat -c %s "$path" 2>/dev/null)
      cron_json="${cron_json:+$cron_json,}{\"name\":\"$name\",\"readable\":true,\"maxAgeMin\":$maxage"
      [ -n "$mtime" ] && cron_json="$cron_json,\"mtimeEpoch\":$mtime"
      [ -n "$size" ] && cron_json="$cron_json,\"sizeBytes\":$size"
      cron_json="$cron_json}"
    else
      cron_json="${cron_json:+$cron_json,}{\"name\":\"$name\",\"readable\":false,\"maxAgeMin\":$maxage}"
    fi
  done

  # ⚠️ 관측치가 하나도 없어도 push 를 생략하지 않는다. 서버는 checks 를 받을 때마다
  # 보안 5종 판정을 갱신하는데(관측 없으면 unknown), push 자체가 없으면 갱신이 멈춰
  # check_results 에 직전 상태(ok/critical)가 그대로 남는다 — collector 가 죽어도
  # 보드는 "정상"으로 보이는 미탐. 빈 payload 라도 heartbeat 로 보낸다.
  printf '{'
  printf '"host":"%s"' "$HOST_NAME"
  [ -n "$svc_json" ] && printf ',"services":[%s]' "$svc_json"
  [ -n "$timer_json" ] && printf ',"timers":[%s]' "$timer_json"
  [ -n "$cron_json" ] && printf ',"hostCron":[%s]' "$cron_json"
  [ -n "$sec_json" ] && printf ',"security":%s' "$sec_json"
  [ -n "$ds_json" ] && printf ',"datastores":[%s]' "$ds_json"
  printf '}'
}

build_payload() {
  printf '{'
  printf '"host":"%s",' "$HOST_NAME"
  printf '"cpuPct":%s,' "$CPU_PCT"
  printf '"load1":%s,"load5":%s,"load15":%s,' "$L1" "$L5" "$L15"
  printf '"memUsedPct":%s,"swapUsedMb":%s,' "$MEM_PCT" "$SWAP_MB"
  printf '"disks":[%s],' "$DISKS_JSON"
  [ -n "$TEMP_C" ] && printf '"cpuTempC":%s,' "$TEMP_C"
  [ -n "$GPU_JSON" ] && printf '"gpu":%s,' "$GPU_JSON"
  [ -n "$NET_JSON" ] && printf '"net":[%s],' "$NET_JSON"
  printf '"uptimeSec":%s,' "$UPTIME"
  printf '"rebootRequired":%s' "$REBOOT"
  printf '}'
}

push() { # $1=API 경로, $2=payload
  local http_code
  http_code=$(curl -sS -m 10 -o "$RESP_FILE" -w '%{http_code}' \
    -X POST \
    -H @"$HDR_FILE" \
    -H "Content-Type: application/json" \
    -d "$2" \
    "$DASHBOARD_URL$1" 2>&1) || {
    echo "[agent] push 실패 (네트워크, $1): $http_code" >&2
    return 1
  }
  if [ "$http_code" != "200" ]; then
    echo "[agent] push 실패 HTTP $http_code ($1): $(head -c 300 "$RESP_FILE")" >&2
    return 1
  fi
  return 0
}

push_vitals() { push "/api/agent/metrics-ingest" "$(build_payload)"; }

push_checks() {
  local payload
  payload=$(build_checks_payload) # 관측치가 없어도 heartbeat 로 push 한다
  push "/api/agent/checks-ingest" "$payload"
}

# ---------- 실행 ----------
take_snapshots

case "$MODE" in
  dry-run)
    sleep 1
    collect
    build_payload
    echo
    build_checks_payload
    echo
    ;;
  once)
    sleep 1
    collect
    if push_vitals && push_checks; then
      echo "[agent] OK ($HOST_NAME → $DASHBOARD_URL)"
    else
      exit 1
    fi
    ;;
  loop)
    echo "[agent] 시작 — host=$HOST_NAME url=$DASHBOARD_URL interval=${INTERVAL_SEC}s checks=매${CHECKS_EVERY_N}사이클"
    CYCLE=0
    while :; do
      sleep "$INTERVAL_SEC"
      collect
      push_vitals || true # 일시 실패는 다음 주기에 회복 — 프로세스는 유지
      CYCLE=$((CYCLE + 1))
      if [ $((CYCLE % CHECKS_EVERY_N)) -eq 0 ]; then
        push_checks || true
      fi
    done
    ;;
esac
