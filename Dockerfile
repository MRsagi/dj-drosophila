# DJ Drosophila — always-on shared live radio (Node + Liquidsoap + ffmpeg)
# Trixie ships Liquidsoap 2.3.x (cue metadata, crossfade override_duration,
# output.file.hls). Bookworm only has 2.1.3, which cannot run server/radio.liq.
FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends liquidsoap ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /app/server/hls /app/server/cache \
  && printf '#EXTM3U\n' > /app/server/cache/radio.m3u \
  && liquidsoap -c /app/server/radio.liq

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    SERVE_DIST=1 \
    SHOW_SEED=dj-drosophila

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/live/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
