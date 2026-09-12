# DJ Drosophila — always-on shared live radio (Node + ffmpeg)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Public production defaults: shared live only, no lab
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    SERVE_DIST=1 \
    ENABLE_LAB=false \
    SHOW_SEED=dj-drosophila

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/live/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
