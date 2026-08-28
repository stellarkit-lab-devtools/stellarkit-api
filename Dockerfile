# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S stellarkit -u 1001

COPY package*.json ./
RUN npm ci --production && \
    npm cache clean --force

COPY --from=builder --chown=stellarkit:nodejs /app/src ./src
COPY --from=builder --chown=stellarkit:nodejs /app/types ./types

USER stellarkit

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
