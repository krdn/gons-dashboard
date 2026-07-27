#!/usr/bin/env bash
# agent.sh 회귀 테스트 — 외부 명령 hang 방어 로직을 고정한다.
#
# 2026-07-24 사고(드라이버 잠김 → 관제 2일 정지) 이후 브레이커·watchdog·마커가
# 여러 차례 개정됐고, 그때마다 "수정이 새 결함을 만드는" 패턴이 반복됐다:
#   - $? 를 파이프에서 캡처해 타임아웃 124 가 head 의 0 에 가려짐
#   - 스텁이 SIGTERM 에 순순히 죽어 실장애(rc=137) 경로를 한 번도 실행하지 않음
#   - sleep_tick 이 INTERVAL_SEC 을 산술 연산으로 승격시켜 비정수 입력에 busy loop
#   - 마커를 실패 감지 후에 세워, 정작 감지 코드가 실행되지 않는 hang 경로를 못 막음
# 전부 문법 오류가 아니라 **조용히 기능만 죽는** 종류라 정적 검사로 잡히지 않는다.
#
# 실행: bash scripts/monitoring-agent/agent.test.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="$SCRIPT_DIR/agent.sh"
WORK="$(mktemp -d)"
# ⚠️ mktemp 실패 시 WORK 는 **빈 문자열**이 된다(set -u 는 할당된 빈 값을 잡지 못한다).
# 그 상태로 "$WORK/pci" 를 rm -rf 하면 /pci 를 재귀 삭제한다 — 하위 경로를 붙이는
# 순간 빈 값이 유효한 절대 경로가 되기 때문이다. 여기서 확실히 끊는다.
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  echo "임시 작업 디렉토리를 만들지 못했습니다" >&2
  exit 1
fi
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

# agent.sh 의 실행 분기(맨 아래 case)를 잘라내 함수만 source 할 수 있게 한다.
sed '/^# ---------- 실행 ----------$/,$d' "$AGENT" >"$WORK/lib.sh"
mkdir -p "$WORK/stub" "$WORK/run"

stub() { printf '%s\n' "$1" >"$WORK/stub/nvidia-smi"; chmod +x "$WORK/stub/nvidia-smi"; }

check() { # $1=설명 $2=기대 $3=실제
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s — 기대 "%s", 실제 "%s"\n' "$1" "$2" "$3"
  fi
}

# 새 인스턴스에서 N 사이클 돌린 뒤 "DISABLED|마커유무" 를 돌려준다.
run_cycles() { # $1=사이클수
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 GPU_PRESENT=1 RUNTIME_DIRECTORY="$WORK/run"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    take_snapshots
    for _ in $(seq "$1"); do collect; done
    printf '%s|%s' "$GPU_DISABLED" "$([ -f "$WORK/run/gpu-disabled" ] && echo 있음 || echo 없음)"
  ) 2>/dev/null
}

echo "== GPU 브레이커 =="
# 마커 불변식: rc 를 받지 못했거나 hang 증거(124·137)일 때만 남는다.
# 회복 가능한 오류에 마커를 남기면 재시작 한 번으로 영구 차단이 된다.
rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
echo "15, 2048, 6144, 45"'
check "정상 응답 → 차단 없음·마커 없음" "0|없음" "$(run_cycles 1)"

rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
exit 1'
check "일시 오류 1회 → 차단 없음·마커 없음" "0|없음" "$(run_cycles 1)"

rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
exit 6'
check "일반 오류 3회 → 차단·마커 없음(재시작 시 재시도)" "1|없음" "$(run_cycles 3)"

# SIGTERM 에 죽는 스텁은 rc=124, 무시하는 스텁은 rc=137 — 실장애는 후자다.
rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
sleep 30'
check "타임아웃(rc=124) → 첫 회 즉시 차단·마커 유지" "1|있음" "$(run_cycles 1)"

rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
trap "" TERM
sleep 30'
check "TERM 무시→KILL(rc=137) → 첫 회 즉시 차단·마커 유지" "1|있음" "$(run_cycles 1)"

echo "== 마커 (watchdog 재시작 루프 차단) =="
# 마커가 남은 채 새 인스턴스가 뜨면 nvidia-smi 를 아예 호출하지 않아야 한다.
# 호출하면 회수 불가 프로세스가 재시작마다 하나씩 쌓인다.
printf 'attempt\n' >"$WORK/run/gpu-disabled"; stub '#!/bin/sh
sleep 30'
check "마커 있으면 시작부터 차단(GPU 미호출)" "1|있음" "$(run_cycles 1)"

# 구버전은 rc 종류를 가리지 않고 빈 마커를 남겼다 → hang 의 증거가 아니므로 폐기·재무장.
: >"$WORK/run/gpu-disabled"; stub '#!/bin/sh
echo "15, 2048, 6144, 45"'
check "레거시 빈 마커 → 폐기하고 재무장" "0|없음" "$(run_cycles 1)"

rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
echo "15, 2048, 6144, 45"'
check "마커 없으면 정상 수집" "0|없음" "$(run_cycles 1)"

# 마커는 원자적으로(임시 파일 + mv) 써야 한다. truncate 후 write 라면 그 사이에 죽었을 때
# 빈 파일이 남고, 레거시 판정이 그것을 폐기해 **진짜 hang 증거가 사라진다**.
rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
sleep 30'
run_cycles 1 >/dev/null
check "hang 후 마커 내용이 완전(빈 파일 아님)" "attempt" "$(cat "$WORK/run/gpu-disabled" 2>/dev/null)"
check "임시 파일이 남지 않음" "0" "$(find "$WORK/run" -name '*.tmp' 2>/dev/null | wc -l)"

# 마커를 못 남기면 hang 이 나도 다음 인스턴스가 알 수 없다. 보호 없이 위험한 호출을
# 계속하는 fail-open 이 되므로, GPU 수집을 건너뛰고 나머지 지표만 보낸다.
echo "== 마커 기록 실패 시 fail-safe =="
failsafe() { # 쓰기 불가 RUNTIME_DIRECTORY → "GPU_JSON|스텁호출여부|CPU수집여부"
  rm -f "$WORK/called"
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 GPU_PRESENT=1 RUNTIME_DIRECTORY="$WORK/nonexistent-dir"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    take_snapshots
    collect
    printf '%s|%s|%s' "${GPU_JSON:-빈값}" \
      "$([ -f "$WORK/called" ] && echo 호출됨 || echo 미호출)" \
      "$([ -n "${CPU_PCT:-}" ] && echo 수집됨 || echo 없음)"
  ) 2>/dev/null
}
stub "#!/bin/sh
touch $WORK/called
echo \"15, 2048, 6144, 45\""
check "마커 기록 불가 → GPU 건너뛰되 나머지는 수집" "빈값|미호출|수집됨" "$(failsafe)"

# GPU 를 수집하지 못한 사실이 payload 에 실려야 보드가 "GPU 없는 호스트" 와 구분한다.
# 판정을 GPU_DISABLED 로 하면 마커 실패 경로가 새어나간다.
echo "== gpuUnavailable 신호 =="
unavail() { # $1=RUNTIME_DIRECTORY $2=사이클수 → payload 에 gpuUnavailable 포함 여부
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 GPU_PRESENT=1 RUNTIME_DIRECTORY="$1"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    take_snapshots
    for _ in $(seq "$2"); do collect; done
    build_payload | grep -q gpuUnavailable && echo 있음 || echo 없음
  ) 2>/dev/null
}
rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
echo "15, 2048, 6144, 45"'
check "정상 수집 → 신호 없음" "없음" "$(unavail "$WORK/run" 1)"

rm -f "$WORK/run/gpu-disabled"; stub '#!/bin/sh
exit 6'
check "브레이커 차단 → 신호 있음" "있음" "$(unavail "$WORK/run" 3)"

stub '#!/bin/sh
echo "15, 2048, 6144, 45"'
check "마커 기록 실패 → 신호 있음" "있음" "$(unavail "$WORK/nonexistent-dir" 1)"

# GPU 미보유 호스트에 신호를 보내면 정상 상태를 장애로 보고하는 오탐이 된다.
# ⚠️ nvidia-smi 실행 파일의 존재로 판단하면 안 된다 — 드라이버 패키지에 딸려오는
# 도구라 GPU 를 뽑았거나 nvidia-utils 만 설치된 호스트에도 남아 있고, 그런 곳에서
# "No devices were found" 로 실패해 브레이커가 차단하면 오탐이 발생한다.
# 하드웨어 존재(PCI 벤더 ID)로 판정해야 한다.
rm -f "$WORK/run/gpu-disabled"
stub '#!/bin/sh
echo "No devices were found" >&2
exit 6'
nogpu() { # GPU_PRESENT=0 → "신호여부|스텁호출여부"
  rm -f "$WORK/called"
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 GPU_PRESENT=0 RUNTIME_DIRECTORY="$WORK/run"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    take_snapshots
    for _ in 1 2 3; do collect; done
    printf '%s|%s' "$(build_payload | grep -q gpuUnavailable && echo 있음 || echo 없음)" \
      "$([ -f "$WORK/called" ] && echo 호출됨 || echo 미호출)"
  ) 2>/dev/null
}
stub "#!/bin/sh
touch $WORK/called
echo \"No devices were found\" >&2
exit 6"
check "GPU 미보유(nvidia-smi 는 존재) → 신호 없음·미호출" "없음|미호출" "$(nogpu)"

# 벤더 ID(0x10de)만으로는 GPU 를 증명하지 못한다 — 같은 벤더의 HDMI 오디오·USB
# 컨트롤러, 구형 nForce 칩셋의 이더넷/SATA 가 모두 0x10de 다. GPU 가 없는데 있다고
# 보면 nvidia-smi 가 실패해 브레이커가 차단하고, 정상 호스트를 장애로 보고한다.
echo "== GPU 하드웨어 판정 (PCI class) =="
stub '#!/bin/sh
echo "15, 2048, 6144, 45"' # nvidia-smi 는 존재하는 것으로 둔다
mkpci() { # $1=슬롯 $2=vendor $3=class
  mkdir -p "$WORK/pci/$1"
  printf '%s\n' "$2" >"$WORK/pci/$1/vendor"
  printf '%s\n' "$3" >"$WORK/pci/$1/class"
}
detect() { # PCI 트리를 보고 판정한 GPU_PRESENT
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy PCI_DEVICES_DIR="$WORK/pci"
    unset GPU_PRESENT
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    printf '%s' "$GPU_PRESENT"
  ) 2>/dev/null
}
rm -rf "$WORK/pci"; mkpci 0000:01:00.0 0x10de 0x030000
check "NVIDIA VGA(0x030000) → GPU 있음" "1" "$(detect)"

rm -rf "$WORK/pci"; mkpci 0000:01:00.0 0x10de 0x030200
check "NVIDIA 3D controller(0x030200) → GPU 있음" "1" "$(detect)"

# 실측: RTX 3060 Laptop 은 01:00.0=GPU, 01:00.1=HDMI 오디오다. 오디오만 있으면 GPU 가 아니다.
rm -rf "$WORK/pci"; mkpci 0000:01:00.1 0x10de 0x040300
check "NVIDIA 오디오만(0x040300) → GPU 없음" "0" "$(detect)"

rm -rf "$WORK/pci"; mkpci 0000:00:02.0 0x8086 0x030000
check "타 벤더 VGA(Intel) → GPU 없음" "0" "$(detect)"

rm -rf "$WORK/pci"; mkpci 0000:01:00.0 0x10de 0x030000; mkpci 0000:01:00.1 0x10de 0x040300
check "GPU + 오디오 동시 존재 → GPU 있음" "1" "$(detect)"

echo "== df hang 방어 (죽은 sshfs 마운트) =="
# df 는 nvidia-smi 와 같은 등급의 hang 경로다 — 응답 없는 네트워크 마운트를 statfs 하면
# D 상태로 박혀 SIGKILL 로도 안 죽는다. 여기서 고정하는 것은 두 가지:
#   (1) 알려진 위험 타입(fuse.sshfs)이 df 인자에서 실제로 제외되는가
#   (2) 그래도 df 가 멈추면 collect 가 **반환하는가** — 안 그러면 2026-07-24 재현이다
stub_df() { printf '%s\n' "$1" >"$WORK/stub/df"; chmod +x "$WORK/stub/df"; }

df_run() { # → "경과초|DISKS_JSON|UPTIME유무"
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_PRESENT=0 DF_TIMEOUT_SEC=1 RUNTIME_DIRECTORY="$WORK/run"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    t0=$SECONDS
    collect
    # UPTIME 은 collect 안에서 디스크 **이후**에 세팅된다 — df 가 멈춘 뒤에도 수집이
    # 끝까지 진행됐다는 증거로 이 변수를 쓴다. df 이전 변수(CPU 등)는 같은 것을 증명하지 못한다.
    printf '%s|%s|%s' "$((SECONDS - t0))" "$DISKS_JSON" \
      "$([ -n "${UPTIME:-}" ] && echo 있음 || echo 없음)"
  ) 2>/dev/null
}

# (1) 인자 검사 — df 를 인자 에코 스텁으로 바꿔 제외 목록을 들여다본다.
stub_df '#!/bin/sh
echo "$@" >>"'"$WORK"'/df-args"
exit 0'
rm -f "$WORK/df-args"; df_run >/dev/null
check "df 인자에 -x fuse.sshfs 포함" "있음" \
  "$(grep -q -- '-x fuse.sshfs' "$WORK/df-args" && echo 있음 || echo 없음)"
check "df 를 두 번(-Pi, -P) 호출" "2" "$(wc -l <"$WORK/df-args" | tr -d ' ')"

# (2) ★ 회수 불가 df 재현 — 여기가 실제 위험이다.
#
# 협조적으로 죽는 스텁(exec sleep)은 이 결함을 **한 번도 실행하지 않는다.** timeout 의
# SIGTERM 에 순순히 죽으면 fd 가 닫혀 awk 가 EOF 를 받고 다 잘 되는 것처럼 보인다.
# 실장애는 D 상태 df 라 SIGKILL 도 안 먹고, 그러면 (a) timeout 이 자식을 reap 하려고
# 같이 멈추고 (b) 죽지 않은 df 가 쓰기 fd 를 붙들어 awk 가 EOF 를 영영 못 받는다.
#
# 사용자 공간에서 D 상태는 못 만들지만, 문제의 성질인 "죽여도 fd 를 붙든 프로세스가
# 남는다" 는 자식을 남기고 종료하는 것으로 정확히 재현된다 — 손자 sleep 이 stdout 을
# 상속해 계속 붙들고 있다. 이 스텁으로 돌리면 수정 전 코드는 영구 정지한다.
stub_df '#!/bin/sh
sleep 30 &
exit 0'
# timeout 으로 감싼다 — 수정 전 코드는 여기서 영구 정지하므로, 감싸지 않으면 테스트가
# "실패" 가 아니라 "영원히 안 끝남" 이 되어 CI 에서 원인이 드러나지 않는다.
DF_RESULT="$(timeout 25 bash -c "WORK='$WORK'; $(declare -f df_run); df_run" 2>/dev/null)"
check "회수 불가 df 에서도 collect 가 반환한다" "yes" \
  "$([ -n "$DF_RESULT" ] && echo yes || echo no)"
check "회수 불가 df 면 디스크 지표만 빈다" "" "$(printf '%s' "$DF_RESULT" | cut -d'|' -f2)"
check "회수 불가 df 에서도 나머지 지표는 수집된다" "있음" "$(printf '%s' "$DF_RESULT" | cut -d'|' -f3)"

# (3) in-flight 가드 — 실장애에서 회수 불가한 것은 df 자신이고, 그러면 그 자식을 reap 하려는
#     timeout 도 함께 남는다. 그 상태로 사이클마다 새 df 를 띄우면 2개씩 무한히 쌓인다
#     (nvidia-smi 좀비와 같은 패턴). 직전 PID 가 살아 있으면 건너뛰어야 한다.
#     D 상태는 사용자 공간에서 못 만들므로, 가드가 보는 조건(살아 있는 PID)을 직접 준다.
df_guard_run() { # $1=DF_INFLIGHT_PIDS 로 넣을 PID → "새 df 호출 수|DISKS_JSON"
  (
    export PATH="$WORK/stub:$PATH" METRICS_INGEST_TOKEN=dummy
    export GPU_PRESENT=0 DF_TIMEOUT_SEC=1 RUNTIME_DIRECTORY="$WORK/run"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    : >"$WORK/df-spawns"
    DF_INFLIGHT_PIDS="$1"
    collect_disks
    printf '%s|%s' "$(wc -l <"$WORK/df-spawns" | tr -d ' ')" "$DISKS_JSON"
  ) 2>/dev/null
}
stub_df '#!/bin/sh
echo spawn >>"'"$WORK"'/df-spawns"
echo "/dev/sda1 100 50 50 50% /"
exit 0'

sleep 30 & LIVE_PID=$!
check "직전 df 가 살아 있으면 새로 띄우지 않는다" "0|" "$(df_guard_run "$LIVE_PID")"
kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null || true

# 죽은 PID 는 가드를 막지 않아야 한다 — 안 그러면 한 번 걸린 뒤 영영 수집이 안 된다.
check "죽은 PID 는 수집을 막지 않는다 (자동 재개)" "2" "$(df_guard_run "$LIVE_PID" | cut -d'|' -f1)"

pkill -f "sleep 30" 2>/dev/null || true
rm -f "$WORK/stub/df" "$WORK/df-spawns"

echo "== 입력 가드 (산술 연산에 쓰이므로 자릿수 제한 필수) =="
guard() { # $1=INTERVAL_SEC 입력 → 폴백 결과
  (
    export METRICS_INGEST_TOKEN=dummy INTERVAL_SEC="$1"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    printf '%s' "$INTERVAL_SEC"
  ) 2>/dev/null
}
# 20자리는 정규식을 통과해도 64비트 산술이 음수로 wrap 되어 sleep_tick 이
# 한 바퀴도 안 돌고 빠져나간다 = 대기 없는 busy loop.
check "23자리 → 기본값 폴백" "15" "$(guard 99999999999999999999999)"
check "비정수(0.5) → 기본값 폴백" "15" "$(guard 0.5)"
check "0 → 기본값 폴백" "15" "$(guard 0)"
check "경계 초과(10000) → 기본값 폴백" "15" "$(guard 10000)"
check "경계 내 최대(9999) → 통과" "9999" "$(guard 9999)"
check "정상(30) → 통과" "30" "$(guard 30)"

# DF_TIMEOUT_SEC 도 같은 등급 — 거대하면 timeout 이 사실상 무한이 되어 방어가 무력화된다.
df_guard() { # $1=DF_TIMEOUT_SEC 입력 → 폴백 결과
  (
    export METRICS_INGEST_TOKEN=dummy DF_TIMEOUT_SEC="$1"
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    printf '%s' "$DF_TIMEOUT_SEC"
  ) 2>/dev/null
}
check "DF_TIMEOUT_SEC 3자리(100) → 기본값 폴백" "5" "$(df_guard 100)"
check "DF_TIMEOUT_SEC 비정수 → 기본값 폴백" "5" "$(df_guard 2.5)"
check "DF_TIMEOUT_SEC 0 → 기본값 폴백" "5" "$(df_guard 0)"
check "DF_TIMEOUT_SEC 정상(10) → 통과" "10" "$(df_guard 10)"

echo "== watchdog heartbeat 분할 =="
# WatchdogSec 은 유닛 파일, INTERVAL_SEC 은 환경변수라 서로 모른다. 고정 간격으로
# heartbeat 를 보내면 INTERVAL_SEC > WatchdogSec 인 순간 정상 에이전트가 재시작 루프에 빠진다.
ticks() { # $1=INTERVAL_SEC $2=WATCHDOG_USEC → "STEP|heartbeat횟수"
  (
    export METRICS_INGEST_TOKEN=dummy INTERVAL_SEC="$1"
    if [ -n "$2" ]; then export WATCHDOG_USEC="$2"; else unset WATCHDOG_USEC; fi
    # shellcheck disable=SC1091
    . "$WORK/lib.sh"
    n=0
    notify_watchdog() { n=$((n + 1)); }
    sleep_tick "$INTERVAL_SEC"
    printf '%s|%s' "$WATCHDOG_STEP_SEC" "$n"
  ) 2>/dev/null
}
check "watchdog 없음 → 통째 sleep" "4|1" "$(ticks 4 '')"
check "watchdog 9초 / INTERVAL 8 → step 3, 3회" "3|3" "$(ticks 8 9000000)"
check "watchdog 9초 / INTERVAL 12(>WatchdogSec) → step 3, 4회" "3|4" "$(ticks 12 9000000)"

echo
if [ "$FAIL" -gt 0 ]; then
  echo "실패 $FAIL / 성공 $PASS"
  exit 1
fi
echo "전체 통과 ($PASS)"
