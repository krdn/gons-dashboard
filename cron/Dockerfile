# gons-dashboard-cron — node-cron 컨테이너.
# 매시간 /api/cron/poll-gmail, KST 매일 8시 /api/cron/morning-digest 호출.
#
# CRITICAL §3 #10: TZ=Asia/Seoul 강제. UTC 발송으로 17시 알림 가는 흔한 버그 방지.

FROM node:24-alpine

# 타임존 강제.
ENV TZ=Asia/Seoul
RUN apk add --no-cache tzdata curl && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

WORKDIR /app

# package.json + node-cron만 설치 — 가벼운 이미지.
COPY package.json ./
RUN npm install --omit=dev

COPY scheduler.js ./

USER node
CMD ["node", "scheduler.js"]
