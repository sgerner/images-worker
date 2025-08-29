FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
# BASE_URL and AUTH_TOKEN must be set at runtime

EXPOSE 3000
CMD ["node", "server.js"]
