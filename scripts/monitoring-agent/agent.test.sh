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
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 RUNTIME_DIRECTORY="$WORK/run"
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
    export GPU_TIMEOUT_SEC=1 GPU_FAIL_LIMIT=3 RUNTIME_DIRECTORY="$WORK/nonexistent-dir"
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
