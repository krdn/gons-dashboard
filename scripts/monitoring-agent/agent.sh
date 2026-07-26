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
#   GPU_TIMEOUT_SEC       기본 5 — nvidia-smi 1회 호출 제한시간
#   GPU_FAIL_LIMIT        기본 3 — 연속 실패 N회면 GPU 수집을 영구 포기(서킷 브레이커)
set -u
LC_ALL=C # awk printf 소수점이 로케일에 따라 콤마가 되는 것 방지

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3020}"
HOST_NAME="${HOST_NAME:-$(hostname)}"
HOST_NAME="${HOST_NAME//[^A-Za-z0-9._-]/}" # JSON 안전 문자만
INTERVAL_SEC="${INTERVAL_SEC:-15}"
CHECKS_EVERY_N="${CHECKS_EVERY_N:-4}"
# 양의 정수가 아니면 기본값 — 0 은 나머지 연산 오류, 비정수는 산술 오류로
# 에이전트가 재시작 루프에 빠진다 (Codex P2).
# ⚠️ 자릿수를 제한한다 — DATASTORE_SPECS 포트 검증과 같은 이유다. 20자리 입력은
# `^[1-9][0-9]*$` 를 통과하지만 bash 산술은 64비트라 wrap 되어 **음수**가 된다
# (실측: 99999999999999999999999 → -8446744073709551617, `[ -gt 0 ]` 가 false).
# 그러면 sleep_tick 의 while 이 한 바퀴도 안 돌아 대기 없는 busy loop 가 된다.
[[ "$CHECKS_EVERY_N" =~ ^[1-9][0-9]{0,3}$ ]] || CHECKS_EVERY_N=4
# INTERVAL_SEC 도 같은 등급이다. sleep 에 직접 넘기던 때는 "0.5" 도 동작했지만, 이제
# sleep_tick() 이 `[ -gt ]` 비교와 `$(( ))` 확장에 쓴다 — 비정수면 비교가 에러로 끝나
# while 이 즉시 빠져나가고 **대기 없는 busy loop** 가 된다(CPU 잠식 + ingest 폭주).
[[ "$INTERVAL_SEC" =~ ^[1-9][0-9]{0,3}$ ]] || INTERVAL_SEC=15
WATCH_SERVICES="${WATCH_SERVICES:-}"
WATCH_TIMERS="${WATCH_TIMERS:-}"
HOSTCRON_SPECS="${HOSTCRON_SPECS:-}"
GPU_TIMEOUT_SEC="${GPU_TIMEOUT_SEC:-5}"
GPU_FAIL_LIMIT="${GPU_FAIL_LIMIT:-3}"
# 2자리 제한(최대 99). GPU_TIMEOUT_SEC 이 거대하면 timeout 이 사실상 무한이 되어
# 2026-07-24 사고가 그대로 재현되고, GPU_FAIL_LIMIT 이 거대하면 브레이커가 임계에
# 영영 닿지 못해 무력화된다 — 둘 다 wrap 이 아니라 "통과하는 큰 값" 자체가 위험하다.
[[ "$GPU_TIMEOUT_SEC" =~ ^[1-9][0-9]{0,1}$ ]] || GPU_TIMEOUT_SEC=5
[[ "$GPU_FAIL_LIMIT" =~ ^[1-9][0-9]{0,1}$ ]] || GPU_FAIL_LIMIT=3

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

# GPU 서킷 브레이커 상태 — 루프 전체에서 유지되어야 하므로 전역이다
# (collect() 안에서 초기화하면 매 사이클 리셋되어 임계에 영원히 못 닿는다).
GPU_FAILS=0
GPU_DISABLED=0

# ⚠️ 차단 상태는 **프로세스 밖에도** 남겨야 한다. 브레이커만으로는 프로세스 생애까지만
# 유효한데, watchdog 이 재시작을 자동화했기 때문이다: 드라이버가 진짜 hang 이면
# collect() 가 멈춰 heartbeat 가 끊기고 → 90초 후 watchdog 재시작 → 브레이커 리셋 →
# GPU 재시도 → 또 hang. 회수 불가 프로세스가 **90초마다 하나씩** 쌓인다.
# systemd 가 만들어 주는 RuntimeDirectory(서비스 유저 소유)에 플래그를 남기고,
# RuntimeDirectoryPreserve=restart 로 재시작 사이에만 보존한다 —
# 정지·재부팅하면 사라지므로 드라이버 복구 후 자동으로 재무장된다.
# RUNTIME_DIRECTORY 미주입(수동 실행)이면 플래그 없이 기존 동작 그대로.
# ⚠️ 마커는 **호출 실패 후가 아니라 호출 직전에** 세운다.
# 실패 후에 세우면 정작 가장 위험한 경로를 못 막는다: timeout 이 회수 불가 자식을
# wait 하며 스스로 블록되면 collect() 가 반환하지 않아 차단 코드가 **실행되지 않는다**.
# 그 상태로 heartbeat 가 끊기면 watchdog 이 재시작하고, 새 인스턴스는 아무 흔적도 없으니
# 다시 nvidia-smi 를 띄운다 — 90초마다 회수 불가 프로세스가 하나씩 쌓인다.
#
# 마커가 남아 있다는 것은 "이전 인스턴스가 nvidia-smi 를 호출한 뒤 정상 반환하지
# 못했다"는 직접 증거다(정상 반환 시엔 지우므로). 브레이커가 차단한 경우에도 그대로
# 남으므로 두 경로를 한 플래그로 덮는다.
# RuntimeDirectoryPreserve=restart 라 stop·재부팅 시엔 삭제 → 드라이버 복구 후 자동 재무장.
GPU_FLAG=""
if [ -n "${RUNTIME_DIRECTORY:-}" ]; then
  GPU_FLAG="${RUNTIME_DIRECTORY%%:*}/gpu-disabled"
  if [ -f "$GPU_FLAG" ]; then
    if [ "$(head -c 7 "$GPU_FLAG" 2>/dev/null)" = "attempt" ]; then
      GPU_DISABLED=1
      echo "[agent] GPU 수집 비활성으로 시작 — 이전 인스턴스가 nvidia-smi 에서 반환하지" \
        "못했거나 드라이버 무응답을 확인했다. 복구 후 재무장하려면 서비스를 stop/start" \
        "하거나 $GPU_FLAG 를 지운다." >&2
    else
      # 빈 마커는 구버전(rc 종류를 가리지 않고 남기던 시절)이 만든 것이다. 그 시절
      # 마커는 회복 가능한 오류에도 생겼으므로 hang 의 증거가 아니다 — 근거 없이
      # 영구 차단하지 않고 폐기 후 재무장한다(구→신 업그레이드 경로).
      rm -f "$GPU_FLAG" 2>/dev/null
      echo "[agent] 형식을 알 수 없는 GPU 마커를 폐기하고 재무장한다 ($GPU_FLAG)." >&2
    fi
  fi
fi

# /run 은 tmpfs 라 사실상 메모리 연산이다. 차단된 뒤에는 호출 자체가 없어 I/O 도 멈춘다.
gpu_mark_attempt() {
  [ -n "$GPU_FLAG" ] || return 0
  # ⚠️ 반드시 **원자적으로** 쓴다. `printf > file` 은 truncate 후 write 라 두 단계이고,
  # 그 사이에 죽거나 write 가 실패하면 빈 파일이 남는다. 빈 마커는 구버전이 남긴 것과
  # 구분되지 않아 시작 로직이 폐기해 버리고, 결국 **진짜 hang 증거가 사라진다**.
  # rename(2) 은 원자적이라 마커는 항상 완전한 내용을 갖는다 → "빈 마커 = 구버전" 이 보장된다.
  # security collector 가 /run 산출물에 쓰는 것과 같은 패턴이다.
  {
    printf 'attempt\n' >"$GPU_FLAG.tmp" && mv -f "$GPU_FLAG.tmp" "$GPU_FLAG"
  } 2>/dev/null
  return 0
}
gpu_clear_flag() {
  [ -n "$GPU_FLAG" ] && rm -f "$GPU_FLAG" 2>/dev/null
  return 0
}

# 차단 사유를 남긴다. 플래그는 이미 시도 마커로 세워져 있어 따로 쓰지 않는다.
disable_gpu_collection() {
  GPU_DISABLED=1
  echo "[agent] GPU 수집 중단 — $1 나머지 지표는 계속 수집한다." >&2
  return 0
}

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

  # GPU (nvidia-smi 있을 때만) — 서킷 브레이커로 감싼다.
  #
  # ⚠️ 2026-07-24 운영 사고: NVIDIA 드라이버가 suspend 중 잠기면 nvidia-smi 가 반환하지
  # 않고 100% CPU 로 무한 스핀한다(SIGKILL 도 안 먹는다). timeout 이 없던 탓에 collect()
  # 가 첫 사이클에서 멈춰 vitals·checks push 가 2일간 정지했다 — 그런데 systemd 는
  # active(running) 로 보고하고 에러 로그도 없어 아무도 알아채지 못했다.
  #
  # timeout 만으로는 부족하다. 죽지 않는 nvidia-smi 를 15초마다 새로 띄우면 분당 4개씩
  # 100% CPU 프로세스가 쌓인다. 연속 실패가 임계에 닿으면 이 프로세스 생애 동안 GPU
  # 수집을 포기하고 나머지 지표만 계속 보낸다 — GPU 타일 하나보다 관제 생존이 우선이다.
  GPU_JSON=""
  if [ "$GPU_DISABLED" -eq 0 ] && command -v nvidia-smi >/dev/null 2>&1; then
    local gpu_raw gpu_rc
    gpu_mark_attempt # ⚠️ 반드시 호출 **직전** — 이 줄이 watchdog 재시작 루프를 끊는다
    # ⚠️ timeout 을 파이프에 물리지 말 것 — $? 가 head 의 0 이 되어 타임아웃(124)이 가려진다.
    gpu_raw=$(timeout -k 2 "$GPU_TIMEOUT_SEC" nvidia-smi \
      --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu \
      --format=csv,noheader,nounits 2>/dev/null)
    gpu_rc=$?
    if [ "$gpu_rc" -ne 0 ]; then
      GPU_FAILS=$((GPU_FAILS + 1))
      # timeout 이 끊었다는 것은 드라이버가 응답하지 않는다는 **직접 증거**다.
      # 두 종료코드를 모두 봐야 한다 (GNU coreutils 9.4 실측):
      #   124 — SIGTERM 으로 끊김
      #   137 — SIGTERM 을 무시해 -k 의 SIGKILL 로 끊김 (128+9)
      # ⚠️ 잠긴 nvidia-smi 는 TERM 을 받지 못하는 상태라 **실제 장애에서는 137 이 나온다**.
      # 124 만 보면 실장애에서 이 분기를 빠져나가 재시도 경로로 떨어진다.
      # 잠긴 프로세스는 KILL 로도 회수되지 않고 100% CPU 로 남으므로(2026-07-24 실측)
      # 재시도할수록 좀비만 늘어난다 — 재시도 가치가 없으니 첫 회에 즉시 차단한다.
      # 그 외 실패(일시적 오류)는 회복 가능하므로 GPU_FAIL_LIMIT 까지 관용한다.
      case "$gpu_rc" in
        124 | 137)
          disable_gpu_collection "nvidia-smi 가 ${GPU_TIMEOUT_SEC}초 내 응답하지 않음(rc=$gpu_rc, 드라이버 잠김). 재시도는 고착 프로세스만 늘리므로 하지 않는다."
          ;;
        *)
          # 회복 가능한 오류다(드라이버는 반환은 했다). 마커를 지워 **재시작 후 다시
          # 시도**하게 한다 — 일시적 실패 하나가 재시작을 만나 영구 차단이 되면 안 된다.
          # 마커의 불변식: rc 를 받지 못했거나(호출 중 사망) hang 증거(124/137)일 때만 남는다.
          # 이 경로로 차단되더라도 좀비가 남지 않으므로(프로세스가 반환했다) 재시도는 안전하다.
          gpu_clear_flag
          if [ "$GPU_FAILS" -ge "$GPU_FAIL_LIMIT" ]; then
            disable_gpu_collection "nvidia-smi ${GPU_FAIL_LIMIT}회 연속 실패(마지막 rc=$gpu_rc). 재시작 시 다시 시도한다."
          fi
          ;;
      esac
    else
      GPU_FAILS=0
      gpu_clear_flag # 정상 반환을 확인한 뒤에만 지운다
      GPU_JSON=$(printf '%s\n' "$gpu_raw" | head -1 |
        awk -F', *' 'NF>=4 && $3+0>0 { printf "{\"utilPct\":%s,\"vramPct\":%.1f,\"tempC\":%s}", $1, $2/$3*100, $4 }')
    fi
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
    # 선행 0 도 막는다: "05440" 을 그대로 실으면 `"port":05440` 이 되어 **유효한
    # JSON 이 아니라** payload 전체가 400 으로 죽는다(heartbeat 까지 중단).
    # 자릿수를 먼저 제한해 산술 확장이 거대 입력을 만나지 않게 한다.
    if ! [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$port" -gt 65535 ]; then
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
  # collector 산출물은 보안 5종 + datastoreStats 가 한 파일에 들어있다.
  # 서버 스키마에서 security 와 datastoreStats 는 **형제 필드**라 분리해 싣는다.
  # jq 없이(호스트 의존 최소화) 문자열로 잘라내되, 실패하면 조용히 생략하지 않고
  # security 만 보내 서버가 datastoreStats 를 not-reported unknown 으로 드러내게 한다.
  if [ -n "$sec_json" ]; then
    local dsx_json sec_only
    dsx_json=$(printf '%s' "$sec_json" | sed -n 's/.*,"datastoreStats":\(\[.*\]\)}$/\1/p')
    sec_only=$(printf '%s' "$sec_json" | sed 's/,"datastoreStats":\[.*\]}$/}/')
    printf ',"security":%s' "$sec_only"
    [ -n "$dsx_json" ] && printf ',"datastoreStats":%s' "$dsx_json"
  fi
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
  # GPU 수집을 포기한 상태를 **명시적으로** 실어보낸다. 지표를 그냥 빼면 보드에서
  # "GPU 가 없는 호스트" 와 구분되지 않고, 조회 창(30분)을 벗어나는 순간 장애가 화면에서
  # 아예 사라진다 — 관측 불가를 관측 없음으로 오인하지 않는다(security 섹션과 같은 원칙).
  # 매 사이클 실리므로 창 안에서 계속 갱신된다.
  [ "$GPU_DISABLED" -eq 1 ] && printf '"gpuUnavailable":true,'
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

# systemd watchdog heartbeat — 루프가 **어떤 이유로든** 멈추면 systemd 가 재시작한다.
# 2026-07-24 사고의 본질은 "멈췄는데 systemd 는 active 로 보고" 였다. GPU 서킷 브레이커는
# 알려진 한 경로(nvidia-smi)만 막지만, 이 heartbeat 는 남은 모든 경로 — SIGKILL 로도
# 회수되지 않는 자식을 timeout 이 기다리는 경우, df 가 죽은 sshfs 마운트에 걸리는 경우,
# systemctl 이 D-Bus 에서 멈추는 경우 — 를 한꺼번에 덮는다.
# WATCHDOG_USEC 는 systemd 가 WatchdogSec 설정 시에만 주입한다 → 없으면 조용히 no-op
# (수동 실행·다른 init 환경에서도 그대로 동작).
notify_watchdog() {
  [ -n "${WATCHDOG_USEC:-}" ] || return 0
  command -v systemd-notify >/dev/null 2>&1 || return 0
  systemd-notify WATCHDOG=1 2>/dev/null || true
}

# heartbeat 간격 — systemd 가 준 WATCHDOG_USEC 의 1/3 (권장 상한은 1/2).
# ⚠️ 고정값으로 두면 안 된다. WatchdogSec 은 유닛 파일에 박혀 있는데 INTERVAL_SEC 은
# 운영자가 환경변수로 늘릴 수 있어(60·120 등), 그 순간 sleep 하나가 WatchdogSec 을
# 넘겨 **정상 에이전트가 영구 재시작 루프**에 빠진다. USEC 에서 유도하면 양쪽 어느 값을
# 바꿔도 자동으로 맞는다. watchdog 이 없으면 쪼갤 이유가 없으므로 INTERVAL_SEC 그대로.
if [ -n "${WATCHDOG_USEC:-}" ] && [[ "${WATCHDOG_USEC}" =~ ^[0-9]+$ ]]; then
  WATCHDOG_STEP_SEC=$((WATCHDOG_USEC / 1000000 / 3))
  [ "$WATCHDOG_STEP_SEC" -lt 1 ] && WATCHDOG_STEP_SEC=1
else
  WATCHDOG_STEP_SEC="$INTERVAL_SEC"
fi

# INTERVAL_SEC 을 WATCHDOG_STEP_SEC 단위로 쪼개 자면서 heartbeat 를 보낸다.
sleep_tick() {
  local remain="$1" step
  while [ "$remain" -gt 0 ]; do
    step="$remain"
    [ "$step" -gt "$WATCHDOG_STEP_SEC" ] && step="$WATCHDOG_STEP_SEC"
    sleep "$step"
    remain=$((remain - step))
    notify_watchdog
  done
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
    # watchdog 설정을 시작 로그에 남긴다 — 재시작 루프가 의심될 때 유닛의 WatchdogSec 과
    # 실제 heartbeat 간격을 대조할 수 있어야 한다(2026-07-24 사고는 로그가 없어 진단이 늦었다).
    WD_DESC="없음"
    [ -n "${WATCHDOG_USEC:-}" ] &&
      WD_DESC="$((WATCHDOG_USEC / 1000000))초(heartbeat ${WATCHDOG_STEP_SEC}초 주기)"
    echo "[agent] 시작 — host=$HOST_NAME url=$DASHBOARD_URL interval=${INTERVAL_SEC}s checks=매${CHECKS_EVERY_N}사이클 watchdog=$WD_DESC"
    CYCLE=0
    while :; do
      sleep_tick "$INTERVAL_SEC"
      collect
      # collect 가 반환했다 = 수집 경로가 살아있다. push 성공 여부는 heartbeat 조건이
      # 아니다 — 대시보드가 잠깐 죽었다고 에이전트를 재시작할 이유는 없다.
      notify_watchdog
      push_vitals || true # 일시 실패는 다음 주기에 회복 — 프로세스는 유지
      CYCLE=$((CYCLE + 1))
      if [ $((CYCLE % CHECKS_EVERY_N)) -eq 0 ]; then
        push_checks || true
        # checks 사이클은 루프에서 가장 긴 구간이다 — datastore 프로브(각
        # DATASTORE_PROBE_TIMEOUT 초) + systemctl 조회 + curl(-m 10). 여기서 heartbeat 를
        # 한 번 더 보내지 않으면 **정상인데도** WatchdogSec 을 넘겨 재시작될 수 있다.
        notify_watchdog
      fi
    done
    ;;
esac
