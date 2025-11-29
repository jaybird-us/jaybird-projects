# jayBird Projects - MS Project for GitHub

> Automatic date calculations, dependency tracking, baseline comparisons, and variance analysis for GitHub Projects.

**By [jayBird](https://jaybird.us) | Created by Jeremy Paxton ([@jeremy-paxton](https://github.com/jeremy-paxton))**

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)

## Features

- **🔗 Automatic Dependencies** - Uses GitHub's native "blocked by" relationships
- **📅 Working Day Calculations** - Excludes weekends and custom holidays
- **📊 T-Shirt Sizing** - Estimate field (XS-XXL) converts to working days
- **📈 Baseline Tracking** - Save original plan, compare current vs baseline
- **🔄 Milestone Roll-ups** - Dates calculated from child issues
- **⚡ Real-time Updates** - Dates cascade when issues close early/late

## How It Works

```
Issue Closed → Webhook → Calculate Dependencies → Update Dates → Cascade to Dependents
```

### Date Calculation Rules

1. **Blocked issues** start the day after their blocker's target date
2. **Duration** comes from the Estimate field (XS=2d, S=5d, M=10d, L=15d, XL=25d, XXL=40d)
3. **Buffer** comes from the Confidence field (High=0d, Medium=2d, Low=5d)
4. **Parent issues** roll up from their children (min start, max target)
5. **Milestones** roll up from their assigned issues

## Quick Start

### 1. Install the GitHub App

Visit [github.com/apps/jaybird-projects](https://github.com/apps/jaybird-projects) and install on your organization.

### 2. Configure Your Project

The app automatically detects these fields in your GitHub Project:

| Field | Type | Description |
|-------|------|-------------|
| Start Date | Date | When work begins |
| Target Date | Date | When work should complete |
| Estimate | Single Select | XS, S, M, L, XL, XXL |
| Confidence | Single Select | High, Medium, Low |
| Baseline Start | Date | Original start date |
| Baseline Target | Date | Original target date |
| Actual End Date | Date | When issue actually closed |
| % Complete | Single Select | 0%, 25%, 50%, 75%, 100% |

### 3. Add Blocking Relationships

Use GitHub's native issue linking:

1. Open an issue
2. In the sidebar, click "Blocked by"
3. Select the blocking issue

The app will automatically calculate start dates based on blockers.

## Self-Hosting

### Prerequisites

- Node.js 20+
- A GitHub App (see below)

### Create a GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**

2. Configure:
   - **Name**: jayBird Projects (or your name)
   - **Homepage URL**: Your app URL
   - **Webhook URL**: `https://your-domain.com/api/webhook`
   - **Webhook secret**: Generate a random string

3. Permissions:
   - **Repository permissions**:
     - Issues: Read & Write
     - Metadata: Read-only
   - **Organization permissions**:
     - Projects: Read & Write

4. Subscribe to events:
   - Issues
   - Projects v2 item
   - Marketplace purchase (if using billing)

5. Generate and download the **private key**

### Environment Variables

```bash
# Required
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Optional
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
DATABASE_PATH=./data/jaybird-projects.db

# Billing (optional)
ENABLE_BILLING=false
FREE_TIER_MAX_ISSUES=50
```

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/jaybird-projects)

1. Click the button above
2. Add environment variables
3. Deploy

### Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

### Deploy with Docker

```bash
docker build -t jaybird-projects .
docker run -p 3000:3000 \
  -e GITHUB_APP_ID=123456 \
  -e GITHUB_APP_PRIVATE_KEY="..." \
  -e GITHUB_WEBHOOK_SECRET="..." \
  -v jaybird-projects-data:/app/data \
  jaybird-projects
```

### Local Development

```bash
# Clone and install
git clone https://github.com/jaybird-us/jaybird-projects.git
cd jaybird-projects
npm install

# Configure
cp .env.example .env
# Edit .env with your GitHub App credentials

# Run
npm run dev
```

Use [smee.io](https://smee.io) to receive webhooks locally:

```bash
npx smee -u https://smee.io/your-channel -t http://localhost:3000/api/webhook
```

## API Endpoints

### Health Check
```
GET /health
```

### Trigger Recalculation
```
POST /api/installations/:id/recalculate
```

### Save Baseline
```
POST /api/installations/:id/save-baseline
```

### Variance Report
```
GET /api/installations/:id/variance-report
```

### Get/Update Settings
```
GET /api/installations/:id/settings
PUT /api/installations/:id/settings
```

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0/mo | 50 issues, basic features |
| **Pro** | $9/mo | Unlimited, baselines, reports |
| **Enterprise** | $49/mo | Multiple projects, API, SSO |

## Compared to MS Project

| Feature | MS Project | jayBird Projects |
|---------|------------|------------------|
| Dependencies | Yes | Yes (GitHub blocking) |
| Working days | Yes | Yes |
| Baselines | Yes | Yes |
| % Complete | Yes | Yes |
| Critical Path | Yes | Coming soon |
| Gantt Chart | Yes | Coming soon (via Mermaid) |
| Resource Leveling | Yes | Not planned |
| Cost Tracking | Yes | Not planned |

## Support

- [GitHub Issues](https://github.com/jaybird-us/jaybird-projects/issues)
- [Email](mailto:support@jaybird.us)

## License

MIT - jayBird

---

Built by jayBird for project managers who love GitHub.
