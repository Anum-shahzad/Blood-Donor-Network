# Blood Donor & Emergency Request Network

CSC-206 Software Engineering team project — Aror University, Sukkur.

## What this is

A coordination platform connecting blood donors with people who need blood
in an emergency. It does **not** perform medical screening, guarantee
compatibility, or replace a hospital/blood bank — final medical decisions
always sit with an authorized facility. The app surfaces likely-compatible,
available, nearby donors, ranks them, tracks a request's status through to
fulfillment, and gives an admin a way to verify genuine requests and
donor-declared blood groups.

## Live deployment

- Frontend: `https://blood-donor-network-gilt.vercel.app`
- Backend API: `https://blood-donor-network-production.up.railway.app`
- Database: MySQL on Railway

## Stack

- Frontend: React + Vite, React Router
- Backend: Node.js + Express
- Database: MySQL
- Auth: JWT + bcrypt
- Deploy: Vercel (frontend) + Railway (backend + MySQL)

## Roles

- **Donor** — registers, sets blood group and availability, views their
  profile, toggles availability.
- **Requester** — creates blood requests, views their own requests, views
  ranked donor matches for a request, marks a request fulfilled or
  cancelled.
- **Admin** — verifies requests and donor-declared blood groups. Admin
  accounts are never created through public signup (see "Creating the
  admin account" below).

## Repo layout

```
backend/     Express API, matching engine, DB schema
frontend/    React app
```

## Local setup

### Database
1. Create a MySQL database (locally, or a free Railway MySQL instance).
2. Run `backend/src/db/schema.sql` against it.

### Backend
```
cd backend
cp .env.example .env    # fill in DB credentials, a JWT secret, and (only if
                         # bootstrapping an admin) ADMIN_BOOTSTRAP_SECRET
npm install
npm run dev              # http://localhost:5000
```

### Frontend
```
cd frontend
cp .env.example .env    # set VITE_API_URL to your backend URL
npm install
npm run dev              # http://localhost:5173
```

## Running the tests

These are plain-Node self-check scripts, no test framework or database
required:
```
cd backend
npm run test:compatibility   # blood-type compatibility, all 8 groups
npm run test:auth            # password hashing + JWT sign/verify
npm run test:matching        # donor ranking engine
```

## API overview

All endpoints are under `/api`. Protected routes require
`Authorization: Bearer <token>` from `/api/auth/login` or
`/api/auth/signup`.

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | anyone | API + DB connectivity check |
| POST | `/auth/signup` | anyone | Create a donor or requester account |
| POST | `/auth/login` | anyone | Log in, get a JWT |
| POST | `/auth/bootstrap-admin` | secret-gated | Create the one admin account (see below) |
| GET | `/donors/me` | donor | View own profile |
| PUT | `/donors/me` | donor | Set/update blood group + last donation date |
| PATCH | `/donors/me/availability` | donor | Toggle availability |
| POST | `/requests` | requester | Create a blood request |
| GET | `/requests/mine` | requester | List own requests |
| PATCH | `/requests/:id/status` | requester | Mark own request fulfilled or cancelled |
| GET | `/requests/:id/matches` | requester | Ranked compatible donors for own request |
| GET | `/admin/requests` | admin | List all requests |
| PATCH | `/admin/requests/:id/verify` | admin | Verify/un-verify a request |
| GET | `/admin/donors` | admin | List all donor profiles |
| PATCH | `/admin/donors/:id/verify` | admin | Verify/un-verify a donor's blood group |

## Database schema

Four tables — `users`, `donor_profiles`, `requests`, `request_responses`
(the last one reserved for a future donor-accept/decline flow; not yet
wired into a route). Full definitions, foreign keys, and indexes are in
`backend/src/db/schema.sql`.

## Matching algorithm

Blood-type compatibility is isolated in
`backend/src/services/matching/compatibility.js` as a pure function —
standard ABO/Rh whole-blood rules (O– universal donor, AB+ universal
recipient), verified against all 8 blood groups in
`compatibility.selfcheck.js`.

Given a request, `GET /api/requests/:id/matches`:
1. Computes every donor blood group compatible with the request's blood
   group.
2. Queries donors who are `is_available = true` and have one of those
   compatible groups.
3. Excludes any donor still inside the 3-month post-donation cooldown
   (`backend/src/services/matching/donorMatching.js`).
4. Scores the remainder: +30 for same city as the request, +20 for a
   verified blood group, up to +50 scaled by months since last donation
   (capped at 12 months; no prior donation on record scores the full 50).
5. Returns donors sorted by score, each with the specific reasons behind
   its score.

This returns **potential matches**, never a medical guarantee — the
response and the UI both say so explicitly.

## Request lifecycle

`pending -> verified -> matched -> fulfilled`, with `expired` and
`cancelled` as side exits. `verified` is set only by an admin.
`fulfilled`/`cancelled` are set only by the requester who owns the
request, and only from a state that isn't already closed out. `matched`
is not yet auto-set by the system (would happen when a donor accepts,
which needs `request_responses` wired up — see Known limitations).

## Verification

- **Account verification**: signup requires a unique email + hashed
  password. No email/phone confirmation step yet.
- **Donor verification**: `is_blood_group_verified`, settable only by an
  admin (`PATCH /api/admin/donors/:id/verify`). Confirms the platform has
  *some* basis for trusting the self-declared blood group — not a lab
  crossmatch.
- **Request verification**: `is_verified`, settable only by an admin
  (`PATCH /api/admin/requests/:id/verify`). Confirms the request looks
  genuine — not a medical judgment on the patient's need.

## Creating the admin account

Admin accounts cannot be created through public signup. Instead:

1. Set `ADMIN_BOOTSTRAP_SECRET` (any long random string) on the backend's
   environment variables.
2. Call `POST /api/auth/bootstrap-admin` once with `{ name, email,
   password, secret }` matching that secret.
3. This endpoint refuses to run again once any admin account exists, so
   there's no ongoing attack surface. Remove the env var afterward if you
   like — not required, but tidy.

## Deployment

- **Backend + DB**: Railway project with a MySQL plugin and this repo's
  `backend/` as the service root. Environment variables reference the
  MySQL service directly (`${{MySQL.MYSQLHOST}}`, etc.) rather than
  copy-pasted values, so they stay correct if Railway rotates credentials.
- **Frontend**: Vercel project with `frontend/` as the root directory,
  `VITE_API_URL` pointing at the Railway backend's public domain.
  `frontend/vercel.json` rewrites all paths to `index.html` so React
  Router's client-side routes don't 404 on direct load or refresh.
- Both redeploy automatically on `git push` to the connected branch.

## Known limitations

- No geolocation/distance calculation — matching uses exact city-string
  matching only (case-insensitive), not proximity.
- No email/SMS/WhatsApp notifications — everything is pulled by the
  frontend (in-app only), nothing is pushed to donors yet.
- `request_responses` (donor accept/decline) exists in the schema but has
  no route yet — there's currently no "notify donor, donor accepts" step,
  so `status` never automatically reaches `matched`.
- No rate limiting, duplicate-request detection, or abuse reporting yet.
- No multi-language support yet (English only).
- No analytics dashboard yet.

## AI usage disclosure

See `AI_USAGE_DISCLOSURE.md`.
