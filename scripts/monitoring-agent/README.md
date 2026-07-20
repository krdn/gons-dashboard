# gons-monitoring-agent

호스트 vitals(CPU/MEM/DISK/온도/GPU/네트워크)를 15초 주기로 수집해
대시보드 `/api/agent/metrics-ingest` 로 push 하는 경량 에이전트 (이슈 #323 Phase 1).

Phase 2: 60초(기본 4사이클)마다 systemd 서비스/타이머 상태·호스트 cron 로그
관찰치를 `/api/agent/checks-ingest` 로 추가 push 한다 — 판정은 서버가 한다.

컨테이너(app/cron)는 호스트 `/proc`·hwmon·`nvidia-smi` 를 읽을 수 없으므로
호스트에 systemd 서비스로 설치한다.

## 설치 (운영 서버 192.168.0.5)

```bash
# 1. 스크립트 배치
sudo mkdir -p /opt/gons/monitoring-agent
sudo cp agent.sh /opt/gons/monitoring-agent/agent.sh
sudo chmod 755 /opt/gons/monitoring-agent/agent.sh

# 2. env 파일 (mode 600) — 토큰은 운영 .env 의 METRICS_INGEST_TOKEN 과 동일 값
sudo tee /etc/default/gons-monitoring-agent >/dev/null <<'EOF'
METRICS_INGEST_TOKEN=<운영 .env 의 METRICS_INGEST_TOKEN 값>
DASHBOARD_URL=http://localhost:3020
HOST_NAME=home-server
INTERVAL_SEC=15
# --- Phase 2 checks (미설정 시 해당 관측 배열만 생략 — heartbeat 는 계속 전송) ---
# ⚠️ 공백·파이프 포함 값은 반드시 따옴표 — 검증 절차가 이 파일을 셸에서
# source 하므로 따옴표 없으면 두 번째 단어부터 명령으로 해석된다.
# (systemd EnvironmentFile 도 따옴표를 벗겨 읽으므로 양쪽 다 안전.)
# systemd 서비스 화이트리스트 (이슈 #323 §D)
WATCH_SERVICES="nginx docker fail2ban ufw ollama telegram-bot smbd nmbd"
# systemd 타이머 (§C-3)
WATCH_TIMERS="n8n-backup.timer n8n-update.timer certbot.timer"
# 데이터스토어 liveness 스펙 "kind|이름|포트" (Phase 3 §G).
# 포트 빈 값 = 미노출 → 항상 "관찰 불가"(설계상 정상).
# ⚠️ 판정의 단일 소스는 서버측 features/monitoring-datastore/config/instances.ts —
# 이 env 와 갈리면 보드에 not-reported / spec-mismatch 로 뜬다. 둘을 함께 갱신할 것.
DATASTORE_SPECS="pg|gons-dashboard|5440 pg|ais-prod|5438 pg|krdn-timescaledb|5435 pg|voice|5437 pg|n8n|5434 pg|ais|5436 pg|sms-insights| redis|gons-dashboard|6390 redis|ais-prod|6385 redis|news-prod|6380 redis|voice|6382 redis|n8n|"
# Phase 4 §J — 심층지표(연결 수·크기) 수집 대상 "kind|이름|컨테이너".
# ⚠️ liveness(DATASTORE_SPECS)와 달리 docker exec 채널이라 **포트 미노출도 관측된다**.
# collector(root)가 실행하므로 이 값은 /etc/default 가 아니라 collector 유닛에 준다.
DATASTORE_CONTAINERS="pg|gons-dashboard|gons-dashboard-postgres pg|ais-prod|ais-prod-postgres pg|krdn-timescaledb|krdn-timescaledb pg|voice|voice-postgres pg|n8n|n8n-postgres pg|ais|ais-postgres pg|sms-insights|sms-insights-postgres redis|gons-dashboard|gons-dashboard-redis redis|ais-prod|ais-prod-redis redis|news-prod|news-prod-redis redis|voice|voice-redis redis|n8n|n8n-redis"
# 호스트 cron 판정 스펙 "이름|로그경로|maxAge분" (§C-2)
# maxAge분 = 주기 + 여유 (매시 잡=75, 매일 잡=1500). 로그가 이 시간 넘게
# 갱신 안 되면 서버가 "실행 흔적 없음" 판정 (warning, 2배 초과 시 critical).
HOSTCRON_SPECS="self-healing|/var/log/self-healing.log|75"
EOF
sudo chmod 600 /etc/default/gons-monitoring-agent

# 3. 전용 시스템 유저 (최초 1회 — systemctl 조회에 D-Bus 가 필요해
#    DynamicUser 불가, 서비스 파일 주석 참조)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gons-agent || true

# 4. 서비스 등록
sudo cp gons-monitoring-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gons-monitoring-agent

# 5. 보안 수집기 (Phase 3 §H — 선택. 미설치 시 보안 보드가 "관찰 불가")
sudo cp gons-security-collect.sh /opt/gons/monitoring-agent/
sudo chmod 755 /opt/gons/monitoring-agent/gons-security-collect.sh
sudo cp gons-security-collect.service gons-security-collect.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gons-security-collect.timer
```

### 보안 baseline 갱신 (Phase 3 §H)

`features/monitoring-security/config/baseline.ts` 의 `EXPECTED_IPTABLES` 와
`ALLOWED_PORTS` 는 **2026-07-20 운영 실측값이 이미 들어있다** — 설치 시 별도 작업 불필요.

갱신이 필요한 때는 **방화벽 규칙이나 노출 포트를 의도적으로 바꿨을 때뿐**이다.
그 경우 관제가 critical/warning 을 띄우는 것이 정상 동작이므로, **변경이 의도된
것인지 감사한 뒤에** baseline 을 새 실측값으로 올린다. 경고를 없애려고 무조건
baseline 을 덮어쓰면 관제가 무력화된다.

```bash
sudo /opt/gons/monitoring-agent/gons-security-collect.sh --stdout
# → iptables.ruleCount / iptables.specHash / ports.entries 를 확인 후 반영
```

## 검증

```bash
# 설치 스모크 — 1회 수집·전송
# ⚠️ `set -a` 로 env 파일 전체를 export 한다. 변수를 손으로 나열하면 거기 없는
# WATCH_*·HOSTCRON_SPECS·DATASTORE_SPECS 가 에이전트에 전달되지 않아, 스모크가
# "통과"해도 해당 관측을 **전혀 검증하지 못한다**.
sudo sh -c 'set -a; . /etc/default/gons-monitoring-agent; set +a; \
  /opt/gons/monitoring-agent/agent.sh --once'
# → "[agent] OK (home-server → http://localhost:3020)"

# payload 만 확인 (전송 없음, 토큰 불필요) — 관측 섹션이 실제로 실리는지 확인
sudo sh -c 'set -a; . /etc/default/gons-monitoring-agent; set +a; \
  /opt/gons/monitoring-agent/agent.sh --dry-run' | tr ',' '\n' | grep -c datastores
# → 1 (0 이면 DATASTORE_SPECS 가 전달되지 않은 것)

# 서비스 로그
journalctl -u gons-monitoring-agent -n 20 --no-pager
```

## 주의

- `HOST_NAME` 은 대시보드 `hosts.name` 과 정확히 일치해야 한다 (불일치 시 404).
- 토큰 회전 시 두 곳 동시 교체: 운영 `.env` `METRICS_INGEST_TOKEN` +
  `/etc/default/gons-monitoring-agent` → `systemctl restart gons-monitoring-agent`.
- 대시보드가 내려가 있어도 에이전트는 종료하지 않는다 — push 실패는 stderr 1줄,
  다음 주기에 자동 회복.
- checks 관련 (Phase 2):
  - `WATCH_SERVICES`/`WATCH_TIMERS`/`HOSTCRON_SPECS` 셋 다 비어도 **checks push 는
    계속된다** (`{"host":"..."}` heartbeat). 개별 관측 배열만 생략된다 — push 를
    멈추면 서버가 보안 판정을 갱신하지 못해 보드에 직전 상태가 남기 때문
    (Phase 3: security 미보고 시 서버가 5종을 unknown 으로 기록).
  - `HOSTCRON_SPECS` 의 로그 파일은 gons-agent 유저가 읽을 수 있어야 한다
    (world-readable 권장) — 읽기 불가면 대시보드에 "unknown" 으로 표시
    (오탐 대신 관찰 불가 표기). 필요 시 `chmod o+r <로그>`.
  - **성공 시 아무 출력도 없는 스크립트는 HOSTCRON_SPECS 에 넣지 말 것** —
    `>>` 리다이렉트는 출력이 있을 때만 mtime 을 갱신하므로 0바이트 로그가
    "실행 흔적 없음" critical 오탐이 된다 (이슈 #323 §C 판정 규칙의 한계 케이스,
    2026-07-19 운영 가동에서 telegram-* 3건으로 실증).
  - oneshot 유닛(docker-user-rules 등)은 `WATCH_SERVICES` 에 넣지 말 것 —
    inactive 가 정상이라 상시 warning 오탐이 된다 (Phase 3 에서 별도 판정).
- 보안 수집 관련 (Phase 3 §H):
  - **에이전트는 특권 명령을 직접 실행하지 않는다.** 유닛의 `NoNewPrivileges=yes` 가
    setuid 를 차단해 `sudo` 자체가 동작하지 않기 때문 (실측: `systemd-run -p
    NoNewPrivileges=yes` → "sudo: The 'no new privileges' flag is set"). 대신 root
    oneshot collector 가 `/run/gons-monitoring/security.json` 에 쓰고 에이전트는 읽기만 한다.
  - collector 유닛에 **`PrivateNetwork=yes` 를 넣지 말 것** — 네트워크 네임스페이스가
    netfilter 규칙까지 격리해 DOCKER-USER 가 안 보인다 (실측: 격리 시 1줄 / 미격리 6줄).
    외부 통신 차단은 `IPAddressDeny=any` 로 (호스트 netns 보존).
  - `RuntimeDirectory=` 는 **`RuntimeDirectoryPreserve=yes` 와 함께** 써야 한다 —
    `Type=oneshot` 은 종료가 곧 중지라 파일을 쓰자마자 디렉토리가 삭제된다 (실측 확인).
  - 스냅샷이 15분 넘게 낡으면 에이전트가 중계하지 않는다 — 낡은 값을 현재값으로
    재사용하지 않기 위함. 보드에는 "관찰 불가" 로 뜬다.
- 데이터스토어 프로브 관련 (Phase 3 §G):
  - 운영 호스트에 `pg_isready`·`redis-cli` 가 **없어** `nc` 단독으로 구현했다
    (설계 스펙은 전자를 1순위로 뒀으나 실측 부재 → 편차).
  - **`nc -z`(TCP 핸드셰이크만) 를 쓰지 않는다.** 도커 포트포워딩은 살아있는데
    뒤의 프로세스가 죽은 경우에도 성공해 "죽었는데 초록" 이 된다. 대신 프로토콜
    최소 요청을 보내고 응답 시그니처를 **화이트리스트**로 확인한다
    (PG=SSLRequest→`S`/`N`, Redis=`PING`→`+PONG`).
  - ⚠️ 이 판정 로직은 셸 안에 있어 **TS 테스트가 닿지 않는다.** 프로브를 고칠 때는
    아래 4케이스를 호스트에서 직접 재확인할 것 (2026-07-20 실측 기준):

    | 대상 | 기대 |
    |---|---|
    | 살아있는 PG (5440) | `reachable:true` |
    | 살아있는 Redis (6390) | `reachable:true` |
    | 닫힌 포트 (5999) | `reachable:false` |
    | **다른 프로토콜 (nginx 80)** | `reachable:false` ← 화이트리스트가 없으면 여기서 오탐 |
    | **비밀번호 걸린 Redis** | `reachable:true` ← `-NOAUTH ...` 도 살아있다는 증거 |

    ```bash
    HOST_NAME=home-server \
      DATASTORE_SPECS='pg|live|5440 redis|live|6390 pg|closed|5999 pg|wrongproto|80' \
      /opt/gons/monitoring-agent/agent.sh --dry-run | tr ',' '\n' | grep -A99 datastores
    ```
  - 프로브는 대상당 약 1초(응답 대기) 순차 실행 — 12개면 정상 시 ~10초.
    checks 주기(60초) 안이라 문제없지만 목록을 크게 늘릴 땐 감안할 것.
