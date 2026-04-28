# Insighta Labs+ — Backend

Secure Profile Intelligence API with GitHub OAuth, RBAC, and advanced querying.

---

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CLI Tool      │     │   Web Portal    │     │  Direct API     │
│  (Bearer token) │     │ (HTTP-only cookie│     │   consumers     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │   Insighta Backend     │
                    │   Express + SQLite     │
                    │   Railway deployment   │
                    └────────────────────────┘
```

---

## Authentication Flow

### CLI (PKCE Flow)
1. `insighta login` generates `state`, `code_verifier`, and `code_challenge`
2. CLI starts a local server on port 9876 and opens GitHub in the browser
3. User authenticates with GitHub
4. GitHub redirects to `https://your-backend.railway.app/auth/github/callback`
5. Backend exchanges the code for a GitHub token, fetches user info, upserts the user
6. Backend redirects to `http://localhost:9876/callback?access_token=...&refresh_token=...`
7. CLI captures the tokens and saves them to `~/.insighta/credentials.json`

### Web Portal
1. User clicks "Continue with GitHub" → redirected to `/auth/github`
2. GitHub redirects back to `/auth/github/callback`
3. Backend creates session, sets **HTTP-only cookies** (`access_token`, `refresh_token`)
4. A non-HttpOnly `csrf_token` cookie is set for CSRF protection
5. User is redirected to `/dashboard` on the portal

---

## Token Handling

| Token | Storage | Expiry |
|---|---|---|
| Access token | Bearer header (CLI) / HTTP-only cookie (web) | 3 minutes |
| Refresh token | `~/.insighta/credentials.json` (CLI) / HTTP-only cookie (web) | 5 minutes |

- Refresh tokens are **single-use** — each refresh issues a new pair and invalidates the old one
- Expired refresh tokens are deleted immediately
- Logout revokes the refresh token server-side

---

## Role Enforcement

| Role | Permissions |
|---|---|
| `admin` | Full access — create, delete, read, export |
| `analyst` | Read-only — list, get, search, export |

- Default role for new users: `analyst`
- All `/api/*` endpoints require authentication
- All `/api/*` endpoints require `X-API-Version: 1` header
- `POST /api/profiles` and `DELETE /api/profiles/:id` are admin-only
- Disabled users (`is_active = false`) receive 403 on every request

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| GET | `/auth/github` | Redirect to GitHub OAuth |
| GET | `/auth/github/callback` | Handle OAuth callback |
| POST | `/auth/refresh` | Refresh token pair |
| POST | `/auth/logout` | Invalidate refresh token |
| GET | `/auth/me` | Get current user |

### Profiles (require auth + X-API-Version: 1)
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/profiles` | any | List with filters, sort, pagination |
| GET | `/api/profiles/search?q=` | any | Natural language search |
| GET | `/api/profiles/export?format=csv` | any | Export as CSV |
| GET | `/api/profiles/:id` | any | Get single profile |
| POST | `/api/profiles` | admin | Create profile |
| DELETE | `/api/profiles/:id` | admin | Delete profile |

---

## Natural Language Parsing

Rule-based only — no AI or LLMs.

| Query Example | Parsed Filters |
|---|---|
| `young males from nigeria` | `gender=male, min_age=16, max_age=24, country_id=NG` |
| `female seniors` | `gender=female, age_group=senior` |
| `adults from kenya` | `age_group=adult, country_id=KE` |
| `males above 30` | `gender=male, min_age=30` |

**Keywords supported:** male/female, child/teenager/adult/senior, young (→16-24), above/over/below/under/between + numbers, from/in + country name.

**Limitations:** No negation, no OR logic, one country per query, no spelling tolerance.

---

## Rate Limiting

| Scope | Limit |
|---|---|
| `/auth/*` | 10 req/min |
| `/api/*` | 60 req/min per user |

---

## Setup

```bash
npm install
cp .env.example .env   # fill in your values
npm start
```

### Environment Variables
```
PORT=3000
NODE_ENV=production
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_long_random_secret
FRONTEND_URL=https://your-portal-url.app
DB_PATH=./insighta.db
```

### Seed database
Place `profiles.json` in the project root. It seeds automatically on startup.

## Repositories
- Backend: https://github.com/bigoluwagentle/insighta-backend
- CLI: https://github.com/bigoluwagentle/insighta-cli  
- Portal: https://github.com/bigoluwagentle/insighta-portal

## Live URLs
- Backend API: https://insighta-backend-production.up.railway.app
- Web Portal: https://insighta-portal-production.up.railway.app
