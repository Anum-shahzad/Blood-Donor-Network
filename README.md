# Blood Donor & Emergency Request Network

CSC-206 Software Engineering team project — Aror University, Sukkur.

## What this is

A coordination platform connecting blood donors with people who need blood
in an emergency. It does **not** perform medical screening, guarantee
compatibility, or replace a hospital/blood bank — final medical decisions
always sit with an authorized facility. The app surfaces likely-compatible,
available, nearby donors and tracks a request's status; a human still
verifies and confirms everything that matters medically.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MySQL
- Auth: JWT + bcrypt
- Deploy: Vercel (frontend) + Railway (backend + MySQL)

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
cp .env.example .env    # fill in DB credentials + a JWT secret
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

## Deployment

- **Backend + DB**: push this repo to GitHub, create a Railway project,
  point it at `backend/`, add a MySQL plugin, copy its connection details
  into the backend service's environment variables, run `schema.sql`
  against the Railway MySQL instance (Railway's "Query" tab or any MySQL
  client), then deploy.
- **Frontend**: create a Vercel project from the same GitHub repo, set the
  root directory to `frontend/`, and set `VITE_API_URL` to the deployed
  Railway backend URL in Vercel's environment variables.
- Both platforms redeploy automatically on `git push` to the connected
  branch.

## Matching engine

Blood-type compatibility lives in
`backend/src/services/matching/compatibility.js` as a pure, isolated
function — no compatibility logic is scattered in routes or the frontend.
It's verified against all 8 blood groups in
`compatibility.selfcheck.js`. Candidates are then filtered by
availability and city, and ranked by compatibility, availability, same
city, last-donation recency, and blood-group verification status.

## Known limitations (update as the week progresses)

- No geolocation/distance calculation — matching uses city-string
  matching only.
- No hospital role — verification is a single admin-controlled flag on
  users/requests, not a separate facility workflow.
- No email/SMS/WhatsApp notifications in this version — in-app only.

## AI usage disclosure

(Fill in before submission: which parts were AI-assisted, which parts the
team wrote/reviewed themselves.)
