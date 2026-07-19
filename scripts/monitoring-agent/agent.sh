#!/usr/bin/env bash
# gons-monitoring-agent — 호스트 vitals 수집 → dashboard /api/agent/metrics-ingest push.
# 이슈 #323 Phase 1. 컨테이너 격리로 앱이 직접 못 읽는 /proc·hwmon·GPU 지표를
# 호스트에서 수집해 Bearer 인증으로 push 한다 (memo-ingest 패턴의 에이전트 push).
#
# 사용:
#   agent.sh            # 루프 모드 (systemd 서비스용, INTERVAL_SEC 주기)
#   agent.sh --once     # 1회 수집·전송 후 종료 (설치 스모크)
#   agent.sh --dry-run  # 1회 수집·payload 출력만 (전송 없음)
#
# env:
#   METRICS_INGEST_TOKEN  (필수, --dry-run 제외) 대시보드 .env 와 동일 값
#   DASHBOARD_URL         기본 http://localhost:3020
#   HOST_NAME             기본 hostname — 대시보드 hosts.name 과 일치해야 함
#   INTERVAL_SEC          기본 15
set -u
LC_ALL=C # awk printf 소수점이 로케일에 따라 콤마가 되는 것 방지

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3020}"
HOST_NAME="${HOST_NAME:-$(hostname)}"
HOST_NAME="${HOST_NAME//[^A-Za-z0-9._-]/}" # JSON 안전 문자만
INTERVAL_SEC="${INTERVAL_SEC:-15}"

MODE="loop"
case "${1:-}" in
  --once) MODE="once" ;;
  --dry-run) MODE="dry-run" ;;
esac
if [ "$MODE" != "dry-run" ]; then
  : "${METRICS_INGEST_TOKEN:?METRICS_INGEST_TOKEN 환경변수가 필요합니다}"
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

  # 디스크 (used% + inode%) — 실 파일시스템만, mount 는 JSON 안전 문자만, 최대 20개
  DISKS_JSON=$(awk '
    FNR==NR { p=$5; gsub(/%/,"",p); if (p ~ /^[0-9]+$/) inode[$6]=p; next }
    FNR>1 {
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

push() {
  local payload http_code
  payload=$(build_payload)
  http_code=$(curl -sS -m 10 -o /tmp/gons-monitoring-agent.last -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $METRICS_INGEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$DASHBOARD_URL/api/agent/metrics-ingest" 2>&1) || {
    echo "[agent] push 실패 (네트워크): $http_code" >&2
    return 1
  }
  if [ "$http_code" != "200" ]; then
    echo "[agent] push 실패 HTTP $http_code: $(head -c 300 /tmp/gons-monitoring-agent.last)" >&2
    return 1
  fi
  return 0
}

# ---------- 실행 ----------
take_snapshots

case "$MODE" in
  dry-run)
    sleep 1
    collect
    build_payload
    echo
    ;;
  once)
    sleep 1
    collect
    if push; then echo "[agent] OK ($HOST_NAME → $DASHBOARD_URL)"; else exit 1; fi
    ;;
  loop)
    echo "[agent] 시작 — host=$HOST_NAME url=$DASHBOARD_URL interval=${INTERVAL_SEC}s"
    while :; do
      sleep "$INTERVAL_SEC"
      collect
      push || true # 일시 실패는 다음 주기에 회복 — 프로세스는 유지
    done
    ;;
esac
