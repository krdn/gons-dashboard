# gons-dashboard-cron — node-cron 컨테이너.
# 매시간 /api/cron/poll-gmail, KST 매일 8시 /api/cron/morning-digest 호출.
#
# CRITICAL §3 #10: TZ=Asia/Seoul 강제. UTC 발송으로 17시 알림 가는 흔한 버그 방지.

FROM node:24-alpine

# 타임존 강제.
ENV TZ=Asia/Seoul
RUN apk add --no-cache tzdata curl docker-cli docker-cli-compose && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

WORKDIR /app

# package.json + node-cron만 설치 — 가벼운 이미지.
COPY package.json ./
RUN npm install --omit=dev

COPY scheduler.js ./
COPY autopilot ./autopilot

# 주의: docker.sock 접근 + /signal 디렉토리 쓰기 권한은 운영 통합 검증(Task 11)에서 확인.
# node 유저가 host docker 그룹에 없으면 permission denied 가능 — 그때 USER node 제거 검토.
USER node
CMD ["node", "scheduler.js"]
