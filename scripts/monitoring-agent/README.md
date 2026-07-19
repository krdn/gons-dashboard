# gons-monitoring-agent

호스트 vitals(CPU/MEM/DISK/온도/GPU/네트워크)를 15초 주기로 수집해
대시보드 `/api/agent/metrics-ingest` 로 push 하는 경량 에이전트 (이슈 #323 Phase 1).

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
