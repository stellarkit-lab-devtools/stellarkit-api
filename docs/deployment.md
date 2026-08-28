# Production Deployment Guide

This guide covers recommended deployment options for running StellarKit API in production.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Production Environment Variables](#production-environment-variables)
3. [Health Check Endpoint](#health-check-endpoint)
4. [Mainnet vs Testnet Configuration](#mainnet-vs-testnet-configuration)
5. [Deployment Option 1: Direct Node.js](#deployment-option-1-direct-nodejs)
6. [Deployment Option 2: Docker](#deployment-option-2-docker)
7. [Deployment Option 3: Platform-as-a-Service (Railway, Render, Fly.io)](#deployment-option-3-platform-as-a-service-railway-render-flyio)
8. [Production Checklist](#production-checklist)

---

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Access to a Stellar Horizon endpoint (public or private)
- For mainnet: Secure key management solution (never store keys in `.env` files)

---

## Production Environment Variables

Create a `.env.production` file (or set these in your platform's environment configuration):

```env
# ============================================================================
# REQUIRED FOR PRODUCTION
# ============================================================================
STELLAR_NETWORK=mainnet
NODE_ENV=production

# ============================================================================
# SERVER CONFIGURATION
# ============================================================================
PORT=3000

# ============================================================================
# LOGGING
# ============================================================================
LOG_LEVEL=info

# ============================================================================
# CACHING (tune based on your traffic patterns)
# ============================================================================
CACHE_TTL_MS=30000
CACHE_TTL_NETWORK_STATUS_MS=30000
CACHE_TTL_FEE_ESTIMATE_MS=15000
CACHE_TTL_BASE_FEE_MS=15000
CACHE_TTL_VALIDATORS_MS=300000
CACHE_TTL_ASSET_MS=60000
CACHE_TTL_ASSET_PRICE_MS=30000
CACHE_TTL_TRUSTLINES_MS=30000
CACHE_TTL_ARBITRAGE_MS=15000
CACHE_TTL_TX_COUNT_MS=30000
CACHE_TTL_CONTRACT_STORAGE_MS=30000
CACHE_TTL_ASSET_BALANCE_MS=15000

# ============================================================================
# RATE LIMITING (adjust based on expected traffic)
# ============================================================================
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW_MS=60000

# ============================================================================
# API KEY AUTHENTICATION (recommended for production)
# ============================================================================
REQUIRE_API_KEY=true
API_KEYS=your-secure-api-key-1,your-secure-api-key-2

# ============================================================================
# OPTIONAL: CUSTOM HORIZON ENDPOINT
# ============================================================================
# Only set if using a private/custom Horizon instance
# HORIZON_URL=https://your-horizon-instance.example.com

# ============================================================================
# OPTIONAL: SOROBAN RPC (required for /soroban/* endpoints)
# ============================================================================
# Mainnet has no free SDF-hosted RPC — provide your own provider URL
# SOROBAN_RPC_URL=https://your-soroban-rpc.example.com
```

### Key Production Settings Explained

| Variable | Recommended Value | Reason |
|----------|-------------------|--------|
| `STELLAR_NETWORK` | `mainnet` | **Critical** — Must be set explicitly for production |
| `NODE_ENV` | `production` | Enables Express optimizations, affects logging and error handling |
| `LOG_LEVEL` | `info` | Balanced verbosity for production monitoring |
| `REQUIRE_API_KEY` | `true` | Protects your endpoints from unauthorized access |
| `RATE_LIMIT_MAX` | `1000` | Adjust based on expected concurrent users |
| `CACHE_TTL_MS` | `30000` | Longer TTLs reduce Horizon load in production |

---

## Health Check Endpoint

The API exposes a health check endpoint at `GET /health`:

```bash
curl https://your-api.example.com/health
```

### Response Format

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "StellarKit API",
    "version": "1.0.0",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "network": "mainnet"
  }
}
```

### Load Balancer Integration

Use this endpoint for:

- **Kubernetes liveness/readiness probes**
- **AWS ALB / GCP Load Balancer health checks**
- **Docker HEALTHCHECK instruction**
- **Platform health checks (Railway, Render, Fly.io)**

#### Example: Kubernetes Probe

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

#### Example: Docker HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

#### Example: Railway/Render Health Check

Configure the health check path in your platform dashboard:
- **Path:** `/health`
- **Port:** `3000`
- **Interval:** 30 seconds
- **Timeout:** 5 seconds

---

## Mainnet vs Testnet Configuration

### Critical: Set `STELLAR_NETWORK=mainnet` for Production

```env
# .env.production
STELLAR_NETWORK=mainnet
```

### What Changes When You Switch Networks

| Aspect | Testnet | Mainnet |
|--------|---------|---------|
| **Horizon Endpoint** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Data Persistence** | Resets periodically | Permanent |
| **Real Value** | No (test XLM only) | Yes (real XLM) |
| **Friendbot** | Available | Not available |
| **Account Creation** | Free via Friendbot | Requires XLM payment |
| **Transaction Fees** | Negligible | Real costs apply |

### Verification After Switching

After deploying with `STELLAR_NETWORK=mainnet`, verify:

```bash
# 1. Check health endpoint
curl https://your-api.example.com/health
# Should return: "network": "mainnet"

# 2. Check network status
curl https://your-api.example.com/network-status
# Should show mainnet ledger data

# 3. Verify account queries
curl https://your-api.example.com/account/GBXXXX...
# Should return mainnet account data (not testnet)
```

### Common Mistake: Leaving Testnet in Production

```env
# ❌ WRONG — Will use testnet data in production!
STELLAR_NETWORK=testnet

# ✅ CORRECT — Explicitly set mainnet
STELLAR_NETWORK=mainnet
```

---

## Deployment Option 1: Direct Node.js

### Prerequisites

- Linux/Unix server (Ubuntu 20.04+, Debian 11+, RHEL 8+)
- Node.js 18+ installed
- Process manager (PM2 recommended)

### Step-by-Step

#### 1. Install Node.js (Ubuntu/Debian)

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should be >= 18.0.0
npm --version   # Should be >= 9.0.0
```

#### 2. Clone and Install

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm ci --production
```

#### 3. Configure Environment

```bash
cp .env.example .env.production
# Edit .env.production with production values (see above)
nano .env.production
```

#### 4. Install PM2

```bash
npm install -g pm2
```

#### 5. Create PM2 Ecosystem File

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'stellarkit-api',
    script: 'src/index.js',
    instances: 'max',           // Use all CPU cores
    exec_mode: 'cluster',       // Cluster mode for multi-core
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Logging
    log_file: '/var/log/stellarkit-api/combined.log',
    out_file: '/var/log/stellarkit-api/out.log',
    error_file: '/var/log/stellarkit-api/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // Memory management
    max_memory_restart: '1G',
    // Graceful shutdown
    kill_timeout: 5000,
    // Restart policy
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '30s'
  }]
};
EOF

# Create log directory
sudo mkdir -p /var/log/stellarkit-api
sudo chown $USER:$USER /var/log/stellarkit-api
```

#### 6. Start with PM2

```bash
# Start in production mode
pm2 start ecosystem.config.js --env production

# Save PM2 process list for auto-restart on reboot
pm2 save
pm2 startup
# Follow the printed command to enable startup script
```

#### 7. Verify Deployment

```bash
# Check status
pm2 status

# View logs
pm2 logs stellarkit-api

# Test health endpoint
curl http://localhost:3000/health
```

#### 8. Set Up Reverse Proxy (Nginx)

```bash
sudo apt-get install -y nginx
```

```nginx
# /etc/nginx/sites-available/stellarkit-api
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint (optional, for load balancer)
    location /health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/stellarkit-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 9. Enable HTTPS (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## Deployment Option 2: Docker

### Dockerfile

A production-ready `Dockerfile` is included in the repository root. Build and run locally:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build if needed)
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S stellarkit -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=stellarkit:nodejs /app/src ./src
COPY --from=builder --chown=stellarkit:nodejs /app/types ./types

# Switch to non-root user
USER stellarkit

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/index.js"]
```

### .dockerignore

```dockerignore
node_modules
npm-debug.log
.git
.github
.gitignore
.env
.env.*
!.env.example
*.log
.DS_Store
coverage
.vscode
.idea
*.md
!README.md
tests
scripts
examples
sdk
manual-verification.sh
run-test.js
verify-*.js
test-*.txt
CHANGELOG.md
IMPLEMENTATION_*.md
PARALLEL_*.md
PR_*.md
NETWORK_*.md
REFATORING_*.md
ROADMAP.md
TODO.md
SECURITY_*.md
X_POWERED_*.md
```

### Build and Run Locally

```bash
# Build image
docker build -t stellarkit-api:latest .

# Run container
docker run -d \
  --name stellarkit-api \
  -p 3000:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  stellarkit-api:latest

# Verify
curl http://localhost:3000/health
```

### Docker Compose (Production)

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  stellarkit-api:
    build:
      context: .
      dockerfile: Dockerfile
    image: stellarkit-api:latest
    container_name: stellarkit-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env.production
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M
```

```bash
# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Scale (if using Docker Swarm)
docker-compose -f docker-compose.prod.yml up -d --scale stellarkit-api=3
```

---

## Deployment Option 3: Platform-as-a-Service (Railway, Render, Fly.io)

### Option 3a: Railway

Railway offers simple Git-based deployments with automatic HTTPS.

#### 1. Connect Repository

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `stellarkit-lab-devtools/stellarkit-api`

#### 2. Configure Environment Variables

In Railway dashboard → Variables, add:

```env
STELLAR_NETWORK=mainnet
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
CACHE_TTL_MS=30000
RATE_LIMIT_MAX=1000
REQUIRE_API_KEY=true
API_KEYS=your-secure-api-key-1,your-secure-api-key-2
# Add SOROBAN_RPC_URL if using Soroban endpoints
```

#### 3. Configure Health Check

In Railway dashboard → Settings → Health Checks:
- **Path:** `/health`
- **Port:** `3000`

#### 4. Deploy

Railway automatically detects Node.js and runs:
- Build: `npm ci --production`
- Start: `npm start`

Your API will be available at `https://your-project.up.railway.app`

#### 5. Custom Domain (Optional)

In Railway dashboard → Settings → Domains → Add your custom domain.

---

### Option 3b: Render

Render provides free tier with automatic HTTPS and custom domains.

#### 1. Create Web Service

1. Go to [render.com](https://render.com)
2. Click "New" → "Web Service"
3. Connect GitHub repository: `stellarkit-lab-devtools/stellarkit-api`

#### 2. Configure Service

| Setting | Value |
|---------|-------|
| **Name** | `stellarkit-api` |
| **Environment** | `Node` |
| **Region** | Choose closest to users |
| **Branch** | `main` |
| **Build Command** | `npm ci --production` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (or paid for production) |

#### 3. Environment Variables

In Render dashboard → Environment, add:

```env
STELLAR_NETWORK=mainnet
NODE_ENV=production
PORT=10000
LOG_LEVEL=info
CACHE_TTL_MS=30000
RATE_LIMIT_MAX=1000
REQUIRE_API_KEY=true
API_KEYS=your-secure-api-key-1,your-secure-api-key-2
```

**Note:** Render sets `PORT` automatically. The app reads `process.env.PORT` so no code changes needed.

#### 4. Health Check

In Render dashboard → Settings → Health Check Path:
- **Path:** `/health`

#### 5. Deploy

Click "Create Web Service". Render builds and deploys automatically.

Your API will be available at `https://stellarkit-api.onrender.com`

---

### Option 3c: Fly.io

Fly.io runs containers globally on their edge network.

#### 1. Install flyctl

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh
```

#### 2. Authenticate and Launch

```bash
flyctl auth login
flyctl launch
```

#### 3. Configure fly.toml

```toml
# fly.toml
app = "stellarkit-api"
primary_region = "iad"  # Choose region closest to users

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  
  [http_service.checks]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  LOG_LEVEL = "info"
  CACHE_TTL_MS = "30000"
  RATE_LIMIT_MAX = "1000"
  REQUIRE_API_KEY = "true"

# Secrets (set via CLI, not in fly.toml)
# flyctl secrets set STELLAR_NETWORK=mainnet
# flyctl secrets set API_KEYS="your-key-1,your-key-2"
# flyctl secrets set SOROBAN_RPC_URL="https://..."
```

#### 4. Set Secrets

```bash
flyctl secrets set STELLAR_NETWORK=mainnet
flyctl secrets set API_KEYS="your-secure-api-key-1,your-secure-api-key-2"
# Optional
flyctl secrets set SOROBAN_RPC_URL="https://your-soroban-rpc.example.com"
```

#### 5. Deploy

```bash
flyctl deploy
```

Your API will be available at `https://stellarkit-api.fly.dev`

---

## Production Checklist

Before going live, verify all items:

### Configuration
- [ ] `STELLAR_NETWORK=mainnet` set explicitly
- [ ] `NODE_ENV=production` set
- [ ] `REQUIRE_API_KEY=true` with secure `API_KEYS`
- [ ] `LOG_LEVEL=info` (or `warn` for less verbosity)
- [ ] Cache TTLs tuned for production traffic
- [ ] Rate limits configured for expected load
- [ ] `SOROBAN_RPC_URL` set if using Soroban endpoints
- [ ] Custom `HORIZON_URL` only if using private Horizon

### Security
- [ ] No secrets in `.env` files committed to git
- [ ] API keys generated with sufficient entropy
- [ ] HTTPS enabled (TLS 1.2+)
- [ ] Helmet headers active (enabled by default)
- [ ] Rate limiting enabled
- [ ] CORS configured appropriately

### Monitoring
- [ ] Health check endpoint accessible at `/health`
- [ ] Logging configured (stdout/stderr or file)
- [ ] Error tracking (Sentry, Datadog, etc.)
- [ ] Uptime monitoring (Pingdom, UptimeRobot, etc.)
- [ ] Horizon connectivity alerts

### Performance
- [ ] Running in cluster mode (PM2) or multiple replicas
- [ ] Memory limits configured (Docker/K8s)
- [ ] Cache TTLs optimized
- [ ] Connection pooling (if using custom Horizon)
- [ ] CDN for static assets (if applicable)

### Reliability
- [ ] Auto-restart on crash (PM2, Docker restart policy, platform default)
- [ ] Graceful shutdown handling (SIGTERM)
- [ ] Health checks configured for load balancer
- [ ] Rolling deployments (zero-downtime)
- [ ] Backup/deployment rollback plan

### Stellar-Specific
- [ ] Verified mainnet connectivity via `/health` and `/network-status`
- [ ] Tested all endpoints against mainnet
- [ ] Friendbot endpoint disabled/removed from documentation (testnet only)
- [ ] Transaction fee estimates reflect mainnet conditions
- [ ] Monitor Horizon status at https://stellar.statuspage.io

---

## Troubleshooting

### Application Won't Start

```bash
# Check logs
pm2 logs stellarkit-api
# or
docker logs stellarkit-api
```

Common issues:
- **Port already in use:** Change `PORT` or stop conflicting service
- **Missing env vars:** Ensure all required variables are set
- **Node version:** Verify `node >= 18.0.0`

### Health Check Failing

```bash
# Test locally
curl -v http://localhost:3000/health

# Check if process is running
ps aux | grep node
# or
docker ps
```

### High Latency / Timeouts

- Check Horizon status: https://stellar.statuspage.io
- Increase cache TTLs
- Verify network connectivity to Horizon
- Consider private Horizon instance for production

### Memory Issues

```bash
# Monitor memory
pm2 monit
# or
docker stats stellarkit-api
```

Solutions:
- Increase memory limits
- Reduce cache sizes
- Enable cluster mode for horizontal scaling

---

## Additional Resources

- [Environment Configuration Guide](environment-configuration.md)
- [Stellar Networks Documentation](https://developers.stellar.org/docs/learn/networks)
- [Horizon API Reference](https://developers.stellar.org/docs/data/apis/horizon)
- [Stellar Status Page](https://stellar.statuspage.io)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Docker Documentation](https://docs.docker.com/)
- [Railway Documentation](https://docs.railway.app/)
- [Render Documentation](https://render.com/docs)
- [Fly.io Documentation](https://fly.io/docs/)

---

## Support

For deployment issues:
1. Check the [FAQ](FAQ.md)
2. Review [Error Reference](error-reference.md)
3. Open an issue on [GitHub](https://github.com/stellarkit-lab-devtools/stellarkit-api/issues)