# Insighta Labs+ — Backend

Secure Profile Intelligence API with GitHub OAuth PKCE, RBAC, rate limiting, and advanced querying.

## Repositories

| Repo | URL |
|---|---|
| Backend | https://github.com/bigoluwagentle/insighta-backend |
| CLI | https://github.com/bigoluwagentle/insighta-cli |
| Web Portal | https://github.com/bigoluwagentle/insighta-portal |

## Live URLs

| Service | URL |
|---|---|
| Backend API | https://insighta-backend-production.up.railway.app |
| Web Portal | https://insighta-portal-production.up.railway.app |

---

## System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  CLI Tool    │     │  Web Portal  │     │  API Client  │
│ Bearer token │     │ HTTP cookies │     │ Bearer token │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       └────────────────────┼────────────────────┘
                            ▼
               ┌────────────────────────┐
               │   Insighta Backend     │
               │   Express + SQLite     │
               │   Railway deployment   │
               └────────────────────────┘
```

---

## Authentication Flow

### PKCE Flow (CLI)
1. CLI generates `state`, `code_verifier`, `code_challenge` (SHA256 of verifier)
2. CLI starts local server on port 9876
3. CLI opens: `GET /auth/github?code_challenge=...&code_challenge_method=S256&redirect_uri=http://localhost:9876/callback`
4. Backend stores state + code_challenge, redirects to GitHub
5. User authorizes on GitHub
6. GitHub redirects to `GET /auth/github/callback?code=...&state=...`
7. Backend validates state exists, validates code_verifier against stored code_challenge
8. Backend exchanges code with GitHub, gets user info, upserts user
9. Backend redirects to CLI local server with `access_token` + `refresh_token`
10. CLI saves tokens to `~/.insighta/credentials.json`

### Web Portal Flow
1. Portal sends user to `GET /auth/github?redirect_uri=https://portal/auth/callback`
2. After GitHub auth, backend redirects to portal `/auth/callback?access_token=...&refresh_token=...`
3. Portal sets HTTP-only cookies for both tokens
4. User is redirected to `/dashboard`

---

## Token Handling

| Token | Expiry | Storage |
|---|---|---|
| Access token | 3 minutes | Bearer header (CLI) / HTTP-only cookie (web) |
| Refresh token | 5 minutes | `~/.insighta/credentials.json` (CLI) / HTTP-only cookie (web) |

- Refresh tokens are **single-use** — rotated on every refresh call
- Expired tokens deleted immediately
- Logout revokes refresh token server-side

---

## Role Enforcement

| Role | Permissions |
|---|---|
| `admin` | Full access: create, delete, read, search, export |
| `analyst` | Read-only: list, get, search, export |

- Default role for new users: `analyst`
- First user to register becomes `admin` automatically
- All `/api/*` endpoints require `Authorization: Bearer <token>` header
- All `/api/*` endpoints require `X-API-Version: 1` header
- `POST /api/profiles` and `DELETE /api/profiles/:id` → admin only
- Disabled users (`is_active = false`) → 403 on all requests

---

## API Endpoints

### Auth (rate limited: 10 req/min)
| Method | Path | Description |
|---|---|---|
| GET | `/auth/github` | Start GitHub OAuth (accepts code_challenge, redirect_uri) |
| GET | `/auth/github/callback` | Handle OAuth callback, validate PKCE |
| POST | `/auth/refresh` | Rotate token pair |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/auth/me` | Get current user |
| GET | `/api/users/me` | Get current user (alias) |

### Profiles (require auth + X-API-Version: 1, rate limited: 60 req/min)
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/profiles` | any | List with filters, sort, pagination |
| GET | `/api/profiles/search?q=` | any | Natural language search |
| GET | `/api/profiles/export?format=csv` | any | CSV export |
| GET | `/api/profiles/:id` | any | Single profile |
| POST | `/api/profiles` | admin | Create profile |
| DELETE | `/api/profiles/:id` | admin | Delete profile |

---

## Natural Language Parsing

Rule-based only — no AI.

| Query | Parsed filters |
|---|---|
| `young males from nigeria` | `gender=male, min_age=16, max_age=24, country_id=NG` |
| `female seniors` | `gender=female, age_group=senior` |
| `adults from kenya` | `age_group=adult, country_id=KE` |
| `males above 30` | `gender=male, min_age=30` |
| `females between 20 and 40` | `gender=female, min_age=20, max_age=40` |

**Supported keywords:** male/female, child/teenager/adult/senior, young (16-24), above/over/below/under/between + number, from/in + country name

**Limitations:** No negation, no OR logic, one country per query, digits only (not number words)

---

## Rate Limiting

| Scope | Limit |
|---|---|
| `/auth/*` | 10 req/min per IP |
| `/api/*` | 60 req/min per user |

Returns `429 Too Many Requests` when exceeded.

---

## CLI Usage

Install:
```bash
# From GitHub
npm install -g github:bigoluwagentle/insighta-cli

# Or clone
git clone https://github.com/bigoluwagentle/insighta-cli.git
cd insighta-cli && npm install && npm link
```

Commands:
```bash
insighta login
insighta logout
insighta whoami

insighta profiles list
insighta profiles list --gender male --country NG
insighta profiles list --min-age 25 --max-age 40
insighta profiles list --sort-by age --order desc --page 2 --limit 20
insighta profiles get <id>
insighta profiles search "young males from nigeria"
insighta profiles create --name "Harriet Tubman"
insighta profiles export --format csv
insighta profiles export --format csv --gender male --country NG
```

---

## Setup

```bash
npm install
cp .env.example .env
# fill in values
npm start
```

### Environment Variables
```
PORT=3000
NODE_ENV=production
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_long_random_secret
FRONTEND_URL=https://insighta-portal-production.up.railway.app
DB_PATH=./insighta.db
```

Place `profiles.json` in root — seeds automatically on startup.