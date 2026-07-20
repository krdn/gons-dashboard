#!/usr/bin/env bash
# gons-security-collect — 보안 관측치 root 수집기 (이슈 #323 Phase 3 §H).
#
# 왜 별도 유닛인가:
#   에이전트 유닛은 NoNewPrivileges=yes 라 sudo 자체가 동작하지 않는다(setuid 차단).
#   운영 실측: systemd-run -p NoNewPrivileges=yes → "sudo: The 'no new privileges'
#   flag is set, which prevents sudo from running as root".
#   그래서 특권 수집만 단명 root 프로세스로 분리하고, 상시 실행되는 에이전트는
#   비특권을 유지한 채 이 스크립트의 산출물을 **읽기만** 한다.
#   (외부 통신도 토큰도 없는 프로세스만 특권을 가지므로 sudoers 안보다 표면이 작다.)
#
# 사용:
#   gons-security-collect.sh            # /run/gons-monitoring/security.json 에 원자적 기록
#   gons-security-collect.sh --stdout   # 파일 대신 표준출력 (baseline 실측용)
#
# 설계 원칙 — 명령 실패를 정상 관측으로 위장시키지 않는다:
#   각 명령의 exit status 를 변환 **전에** 확인하고, 실패는 observed:false + reason 으로
#   기록한다. 빈 출력의 해시나 빈 포트 목록이 정상값으로 저장되면 Phase 2 의
#   0바이트 로그 오탐과 같은 사고가 난다.
set -u
# ⚠️ 로케일 고정 필수. 이 서버는 ko_KR 이라 `ufw status` 가 "상태: 활성" 으로 나오고,
#    영어를 전제한 grep '^Status: active' 가 조용히 false 를 반환해 critical 오탐이 된다
#    (2026-07-20 실측으로 발견 — agent.sh 의 LC_ALL=C 와 같은 이유).
export LC_ALL=C
export LANG=C

OUT_DIR=/run/gons-monitoring
OUT_FILE="$OUT_DIR/security.json"
MODE="file"
[ "${1:-}" = "--stdout" ] && MODE="stdout"

# 모든 외부 명령의 상한 — 한 곳의 hang 이 수집 전체를 멈추지 않도록.
CMD_TIMEOUT=5

# JSON 문자열 이스케이프 (제어문자·역슬래시·따옴표).
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }

obs_fail() { printf '{"observed":false,"reason":"%s"}' "$(json_escape "$1")"; }

# ---------- iptables ----------
# DOCKER-USER 는 2026-07-12 보안 감사의 유일한 인터넷 방어선.
#
# ⚠️ `iptables -S DOCKER-USER` 를 직접 쓰지 않는다. 이 명령은 ①권한 없음 과
#    ②체인 삭제 양쪽으로 실패하는데, 둘을 exit code 로 구분할 수 없다
#    (실측: 없는 체인의 오류가 "Incompatible with this kernel" 로 나옴 — 메시지
#    파싱은 취약). ②를 ①로 뭉개면 방어선 소멸에 관제가 침묵한다.
# → 전체 -S 의 성공 여부로 observed 를, ^-N DOCKER-USER 매칭으로 present 를 판정.
collect_iptables() {
  local all rc
  all=$(timeout "$CMD_TIMEOUT" iptables -S 2>/dev/null)
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$all" ]; then
    obs_fail "iptables-failed-rc$rc"
    return
  fi

  if ! printf '%s\n' "$all" | grep -q '^-N DOCKER-USER$'; then
    printf '{"observed":true,"present":false}'
    return
  fi

  # DOCKER-USER 관련 줄만 추출 → 공백 정규화 → 해시.
  # 패킷 카운터가 없는 -S 라서 조회마다 값이 안 변한다 (-L -v 였다면 매번 드리프트).
  local rules count hash
  rules=$(printf '%s\n' "$all" | grep -E '^-(N|A) DOCKER-USER' | sed 's/[[:space:]]\+/ /g')
  count=$(printf '%s\n' "$rules" | grep -c .)
  hash=$(printf '%s\n' "$rules" | sha256sum | cut -c1-16)
  printf '{"observed":true,"present":true,"ruleCount":%s,"specHash":"%s"}' \
    "$count" "$hash"
}

# ---------- fail2ban ----------
collect_fail2ban() {
  local out rc jails
  out=$(timeout "$CMD_TIMEOUT" fail2ban-client status 2>/dev/null)
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$out" ]; then
    obs_fail "fail2ban-failed-rc$rc"
    return
  fi
  # "Jail list:\tsshd, nginx-limit" → JSON 배열
  # jail 이름은 json_escape 를 거친다 — 특수문자가 있으면 checks 요청 전체가
  # 깨진 JSON 이 되어 이 호스트의 모든 판정이 사라진다.
  local jails="" name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    jails="${jails:+$jails,}\"$(json_escape "$name")\""
  done <<EOF
$(printf '%s\n' "$out" | awk -F: '/Jail list/ { print $2 }' |
    tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
EOF
  printf '{"observed":true,"jails":[%s]}' "$jails"
}

# ---------- ufw ----------
collect_ufw() {
  local out rc
  out=$(timeout "$CMD_TIMEOUT" ufw status 2>/dev/null)
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$out" ]; then
    obs_fail "ufw-failed-rc$rc"
    return
  fi
  if printf '%s\n' "$out" | grep -qi '^Status: active'; then
    printf '{"observed":true,"active":true}'
  else
    printf '{"observed":true,"active":false}'
  fi
}

# ---------- 리스닝 포트 ----------
# "protocol:bindAddr:port" 튜플로 수집한다. 포트 번호만 비교하면
# 127.0.0.1:5434 → 0.0.0.0:5434 처럼 **노출 범위만 넓어진** 변경을 놓친다.
# UDP 는 범위 외 (-t = TCP listen 만).
collect_ports() {
  local out rc entries
  out=$(timeout "$CMD_TIMEOUT" ss -tlnH 2>/dev/null)
  rc=$?
  # 빈 출력을 observed:true, entries:[] 로 싣지 않는다 — portdrift 가 ok 로 판정돼
  # "리스닝 소켓 관측 실패"가 "정상"으로 보인다 (0바이트 로그 오탐과 같은 구조).
  # 실제로 리스너가 0개인 호스트는 이 서버에 존재하지 않는다.
  if [ $rc -ne 0 ] || [ -z "$out" ]; then
    obs_fail "ss-failed-rc$rc"
    return
  fi
  # ss -tlnH 4번째 컬럼이 Local Address:Port. IPv6 는 [::]:80 형태.
  entries=$(printf '%s\n' "$out" | awk '{ print $4 }' |
    awk 'NF { printf "tcp:%s\n", $0 }' | sort -u |
    awk 'NF && n<300 { printf "%s\"%s\"", (n++?",":""), $0 }')
  # 파싱 결과가 비어도 관측 실패로 — 출력 형식이 바뀐 경우다.
  if [ -z "$entries" ]; then
    obs_fail "ss-parse-empty"
    return
  fi
  printf '{"observed":true,"entries":[%s]}' "$entries"
}

# ---------- SSH 인증 실패 ----------
# 시간창을 명시하지 않으면 부팅 이후 전체가 잡혀 "1시간 지표"가 성립하지 않는다.
collect_sshfail() {
  local out rc n
  out=$(timeout "$CMD_TIMEOUT" journalctl -u ssh.service --since "1 hour ago" \
    --no-pager 2>/dev/null)
  rc=$?
  if [ $rc -ne 0 ]; then
    obs_fail "journalctl-failed-rc$rc"
    return
  fi
  n=$(printf '%s\n' "$out" | grep -c -E 'Failed password|Invalid user|authentication failure')
  printf '{"observed":true,"failCount1h":%s}' "$n"
}

# ---------- 데이터스토어 심층지표 (Phase 4 §J) ----------
# ⚠️ 이 채널은 **네트워크 노출과 무관**하다. 컨테이너 내부 로컬 소켓 trust 인증을
# 쓰므로 포트 미노출 인스턴스(sms-insights·n8n)도 동일하게 관측된다.
# 자격증명을 새로 만들지 않는다 — 필요한 것은 계정이 아니라 컨테이너 진입 권한이고,
# 그것은 이 collector 가 root 라서 이미 있다.
#
# 대상은 "kind|target|container" 목록. 서버 instances.ts 가 단일 소스이며
# 여기 목록이 낡으면 서버가 not-reported unknown 으로 드러낸다.
DATASTORE_CONTAINERS="${DATASTORE_CONTAINERS:-}"

# 컨테이너 env 에서 값 추출 — POSTGRES_USER/DB 는 인스턴스마다 다르다(실측).
# ⚠️ timeout 필수 — docker daemon 이 멈추면 이 호출이 무기한 대기해 collector 전체가
# 정지하고, 보안 5종 관측까지 갱신이 끊긴다(지표 하나 때문에 방화벽 감시가 멎는다).
# exit status 를 파싱 전에 확인하고 실패 시 빈 값 → 호출부가 기본값으로 폴백한다.
container_env() {
  local out rc
  out=$(timeout "$CMD_TIMEOUT" docker inspect "$1" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)
  rc=$?
  [ $rc -eq 0 ] || return 0
  printf '%s' "$out" | grep "^$2=" | head -1 | cut -d= -f2-
}

collect_datastore_stats() {
  local spec kind target cont out rc user db conns maxc size mem entry acc=""
  for spec in $DATASTORE_CONTAINERS; do
    IFS='|' read -r kind target cont <<<"$spec"
    [ -n "$kind" ] && [ -n "$target" ] && [ -n "$cont" ] || continue
    [ "$kind" = "pg" ] || [ "$kind" = "redis" ] || continue
    target="${target//[^A-Za-z0-9._-]/}"
    cont="${cont//[^A-Za-z0-9._-]/}"
    [ -n "$target" ] && [ -n "$cont" ] || continue

    entry=""
    if [ "$kind" = "pg" ]; then
      # -U 만 주면 user 와 같은 이름의 DB 에 붙으려다 실패한다 — -d 필수(실측).
      user=$(container_env "$cont" POSTGRES_USER); user="${user:-postgres}"
      db=$(container_env "$cont" POSTGRES_DB);     db="${db:-postgres}"
      out=$(timeout "$CMD_TIMEOUT" docker exec "$cont" psql -U "$user" -d "$db" \
        -tAF, -c "SELECT (SELECT count(*) FROM pg_stat_activity),(SELECT setting FROM pg_settings WHERE name='max_connections'),pg_database_size(current_database())" 2>/dev/null)
      rc=$?
      IFS=, read -r conns maxc size <<<"$(printf '%s' "$out" | tr -d ' \r' | head -1)"
      # 빈 출력·비수치는 관측 실패로 — 0 으로 실으면 "연결 0개"라는 거짓 정상이 된다.
      if [ $rc -eq 0 ] && [[ "$conns" =~ ^[0-9]+$ ]] && [[ "$maxc" =~ ^[0-9]+$ ]]; then
        entry="{\"kind\":\"pg\",\"target\":\"$target\",\"observed\":true,\"conns\":$conns,\"maxConns\":$maxc"
        [[ "$size" =~ ^[0-9]+$ ]] && entry="$entry,\"sizeBytes\":$size"
        entry="$entry}"
      else
        entry="{\"kind\":\"pg\",\"target\":\"$target\",\"observed\":false,\"reason\":\"exec-failed-rc$rc\"}"
      fi
    else
      out=$(timeout "$CMD_TIMEOUT" docker exec "$cont" redis-cli INFO 2>/dev/null)
      rc=$?
      mem=$(printf '%s' "$out" | grep -E '^used_memory:' | head -1 | tr -d ' \r' | cut -d: -f2)
      conns=$(printf '%s' "$out" | grep -E '^connected_clients:' | head -1 | tr -d ' \r' | cut -d: -f2)
      # maxmemory·정책은 INFO 에 없다 — CONFIG GET 으로 따로 조회한다.
      # 이 둘이 있어야 "상한 대비 몇 %"와 "가득 차면 축출인가 쓰기 실패인가"를
      # 판정할 수 있다. 절대 크기만으로는 위험도를 알 수 없다.
      # ⚠️ 각 CONFIG GET 의 종료 상태를 따로 확인한다. 실패를 무시하면 필드만 빠진
      # observed:true 가 나가고, 서버는 그것을 "상한 없음"·"축출 정책"으로 읽어
      # **상한이 있는 인스턴스가 ok 로 강등**된다(위험을 숨기는 오판).
      maxmem=$(timeout "$CMD_TIMEOUT" docker exec "$cont" redis-cli CONFIG GET maxmemory 2>/dev/null | tail -1 | tr -d ' \r')
      rc_max=$?
      policy=$(timeout "$CMD_TIMEOUT" docker exec "$cont" redis-cli CONFIG GET maxmemory-policy 2>/dev/null | tail -1 | tr -d ' \r')
      rc_pol=$?
      if [ $rc -eq 0 ] && [[ "$mem" =~ ^[0-9]+$ ]] \
         && { [ $rc_max -ne 0 ] || [ $rc_pol -ne 0 ] \
              || ! [[ "$maxmem" =~ ^[0-9]+$ ]] || ! [[ "$policy" =~ ^[a-z-]+$ ]]; }; then
        # INFO 는 됐지만 CONFIG 조회가 실패 — 판정 근거가 불완전하므로 관측 실패로 낸다.
        entry="{\"kind\":\"redis\",\"target\":\"$target\",\"observed\":false,\"reason\":\"config-get-failed\"}"
        acc="${acc:+$acc,}$entry"
        continue
      fi
      if [ $rc -eq 0 ] && [[ "$mem" =~ ^[0-9]+$ ]]; then
        entry="{\"kind\":\"redis\",\"target\":\"$target\",\"observed\":true,\"memBytes\":$mem"
        [[ "$conns" =~ ^[0-9]+$ ]] && entry="$entry,\"conns\":$conns"
        [[ "$maxmem" =~ ^[0-9]+$ ]] && entry="$entry,\"maxMemBytes\":$maxmem"
        [[ "$policy" =~ ^[a-z-]+$ ]] && entry="$entry,\"evictionPolicy\":\"$policy\""
        entry="$entry}"
      else
        entry="{\"kind\":\"redis\",\"target\":\"$target\",\"observed\":false,\"reason\":\"exec-failed-rc$rc\"}"
      fi
    fi
    acc="${acc:+$acc,}$entry"
  done
  printf '[%s]' "$acc"
}

build_json() {
  printf '{'
  printf '"iptables":%s,' "$(collect_iptables)"
  printf '"fail2ban":%s,' "$(collect_fail2ban)"
  printf '"ufw":%s,' "$(collect_ufw)"
  printf '"ports":%s,' "$(collect_ports)"
  printf '"sshFail":%s' "$(collect_sshfail)"
  printf ',"datastoreStats":%s' "$(collect_datastore_stats)"
  printf '}\n'
}

if [ "$MODE" = "stdout" ]; then
  build_json
  exit 0
fi

mkdir -p "$OUT_DIR"
# 원자적 교체 — 임시파일을 **같은 디렉토리 안에** 만들어야 mv 가 원자적이다
# (다른 파일시스템 간 mv 는 복사+삭제로 분해되어 부분 읽기가 가능해진다).
TMP=$(mktemp "$OUT_DIR/.security.XXXXXX") || exit 1
trap 'rm -f "$TMP"' EXIT
build_json >"$TMP" || exit 1
chmod 0640 "$TMP"
# 그룹 부여 실패는 치명 — 에이전트가 읽지 못하는 파일을 남기면 "수집은 되는데
# 보드는 관찰 불가" 라는 진단 어려운 상태가 된다. 차라리 실패를 드러낸다.
if ! chgrp gons-agent "$TMP"; then
  echo "[security-collect] chgrp gons-agent 실패 — 유저가 없거나 권한 부족" >&2
  exit 1
fi
mv -f "$TMP" "$OUT_FILE"
trap - EXIT
