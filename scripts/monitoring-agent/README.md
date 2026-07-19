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
# --- Phase 2 checks (미설정 시 checks push 생략 — vitals 만 동작) ---
# ⚠️ 공백·파이프 포함 값은 반드시 따옴표 — 검증 절차가 이 파일을 셸에서
# source 하므로 따옴표 없으면 두 번째 단어부터 명령으로 해석된다.
# (systemd EnvironmentFile 도 따옴표를 벗겨 읽으므로 양쪽 다 안전.)
# systemd 서비스 화이트리스트 (이슈 #323 §D)
WATCH_SERVICES="nginx docker fail2ban ufw ollama telegram-bot smbd nmbd"
# systemd 타이머 (§C-3)
WATCH_TIMERS="n8n-backup.timer n8n-update.timer certbot.timer"
# 호스트 cron 판정 스펙 "이름|로그경로|maxAge분" (§C-2)
# maxAge분 = 주기 + 여유 (매시 잡=75, 매일 잡=1500). 로그가 이 시간 넘게
# 갱신 안 되면 서버가 "실행 흔적 없음" 판정 (warning, 2배 초과 시 critical).
HOSTCRON_SPECS="self-healing|/var/log/self-healing.log|75"
EOF
sudo chmod 600 /etc/default/gons-monitoring-agent

# 3. 서비스 등록
sudo cp gons-monitoring-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gons-monitoring-agent
```

## 검증

```bash
# 설치 스모크 — 1회 수집·전송
sudo sh -c '. /etc/default/gons-monitoring-agent; \
  METRICS_INGEST_TOKEN=$METRICS_INGEST_TOKEN DASHBOARD_URL=$DASHBOARD_URL \
  HOST_NAME=$HOST_NAME /opt/gons/monitoring-agent/agent.sh --once'
# → "[agent] OK (home-server → http://localhost:3020)"

# payload 만 확인 (전송 없음, 토큰 불필요)
/opt/gons/monitoring-agent/agent.sh --dry-run | head -c 500

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
  - `WATCH_SERVICES`/`WATCH_TIMERS`/`HOSTCRON_SPECS` 셋 다 비면 checks push 자체를 생략.
  - 서비스는 `DynamicUser=yes` 로 돌므로 `HOSTCRON_SPECS` 의 로그 파일은
    world-readable 이어야 한다 — 읽기 불가면 대시보드에 "unknown" 으로 표시
    (오탐 대신 관찰 불가 표기). 필요 시 `chmod o+r <로그>`.
  - oneshot 유닛(docker-user-rules 등)은 `WATCH_SERVICES` 에 넣지 말 것 —
    inactive 가 정상이라 상시 warning 오탐이 된다 (Phase 3 에서 별도 판정).
