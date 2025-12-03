# jayBird Projects

Professional project management for GitHub Projects - automatic scheduling, dependencies, baselines, and variance tracking.

## Project Status (Dec 2024)

**Current State**: MVP deployed to production at https://projects.jybrd.io
- React client with full project management UI
- GitHub App integration for project syncing
- Stripe billing with free tier and Pro plan ($9/mo)
- Real-time activity tracking (commits, PRs, status updates)

## Commands

### Development
- `npm run dev` - Start both server (nodemon) and client (Vite) concurrently
- `npm run dev:server` - Server only with hot reload
- `npm run dev:client` - Client only with HMR

### Build & Production
- `npm run build` - Build React client for production
- `npm start` - Start production server (serves built client from ./public)

### Client-Specific
- `npm run lint --prefix client` - ESLint
- `npm run typecheck --prefix client` - TypeScript check

## Architecture

```
├── client/               # React + Vite + TypeScript frontend
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── contexts/     # React contexts (Auth, etc.)
│   │   ├── layouts/      # App layouts (AppLayout, PublicLayout)
│   │   └── pages/        # Route pages (Dashboard, Projects, etc.)
│   └── vite.config.ts
├── src/                  # Node.js + Express backend
│   ├── index.js          # Main server entry point
│   ├── lib/
│   │   ├── database.js   # SQLite with better-sqlite3
│   │   ├── engine.js     # Scheduling engine
│   │   └── risk.js       # Risk assessment
│   └── routes/           # API route handlers
├── Dockerfile            # Multi-stage build (client + server)
└── railway.json          # Railway deployment config
```

## Key Technologies
- **Frontend**: React 19, Vite 7, TypeScript, TailwindCSS 4, @jybrd/design-system
- **Backend**: Node.js 20+, Express, better-sqlite3, Stripe
- **Integrations**: GitHub App (Octokit), Stripe billing
- **Deployment**: Railway (Docker), SQLite with persistent volume

## Environment Variables

### Required for Production
| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | GitHub App ID from Developer Settings |
| `GITHUB_APP_PRIVATE_KEY` | RSA private key (multiline) |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature verification |
| `GITHUB_CLIENT_ID` | OAuth App Client ID for user login |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret |
| `SESSION_SECRET` | 64-char hex string for cookie sessions |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature |
| `STRIPE_PRICE_ID` | Pro plan price ID |
| `APP_URL` | Production URL (https://projects.jybrd.io) |
| `DATABASE_PATH` | SQLite path (default: /app/data/projectflow.db) |

### Development Defaults
```bash
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:5173
```

## Deployment (Railway)

### Configuration
- **Platform**: Railway with Dockerfile builder
- **Region**: us-east4
- **Volume**: Persistent SQLite at /app/data
- **Health Check**: GET /health

### Deploy Commands
```bash
# Check Railway status
railway status

# Deploy to production
railway up

# View logs
railway logs

# Set environment variables
railway variables set KEY=value
```

### Critical Deployment Checklist

**Before First Deploy:**
1. Set ALL environment variables in Railway (see table above)
2. Ensure `APP_URL` matches your custom domain
3. Update GitHub OAuth App callback URL to `https://your-domain/auth/github/callback`

**Common Issues & Fixes:**

| Issue | Cause | Fix |
|-------|-------|-----|
| `client_id=undefined` in OAuth | Missing `GITHUB_CLIENT_ID` env var | Add to Railway variables |
| `redirect_uri not associated` | OAuth callback URL mismatch | Update GitHub OAuth App settings |
| `X-Forwarded-For` error | Missing trust proxy | Already fixed: `app.set('trust proxy', 1)` |
| Old app showing | Client not built in Docker | Multi-stage Dockerfile builds client |
| `SESSION_SECRET required` | Missing env var in staging | Copy all vars to staging environment |

### Dockerfile Structure
```dockerfile
# Stage 1: Build React client
FROM node:20-alpine AS client-builder
# Runs: npm install && npm run build

# Stage 2: Build server with native modules
FROM node:20-alpine AS server-builder
# Installs: python3, make, g++ for better-sqlite3

# Stage 3: Production image
FROM node:20-alpine
# Copies: node_modules, built client (to ./public), server code
```

## Code Style
- 2-space indentation (JavaScript/TypeScript)
- ES modules (`import/export`)
- TypeScript strict mode in client
- Pino logger for server-side logging

## GitHub App Permissions
- **Repository**: Contents (read), Issues (read/write), Pull requests (read)
- **Organization**: Projects (read/write), Members (read)
- **User**: Email (read)

## Next Steps (Roadmap)

### Immediate
- [ ] Documents page: Replace cards with FileBrowser component
- [ ] Add document pinning and recent documents quick access

### Short-term
- [ ] Dependency visualization (Gantt chart)
- [ ] Baseline comparison views
- [ ] Email notifications for status changes

### Future
- [ ] Team collaboration features
- [ ] Custom field types
- [ ] API access for Pro users
