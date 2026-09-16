# Medikalija API

Backend REST API for **Medikalija** — a resident and staff management system for elder-care facilities (starački dom). It handles authentication, patient records, medicine and article inventory, diagnoses, analyses, billing/specification periods, calendar events and notifications for the [Medikalija frontend](../medikalija-frontend).

## Tech stack

- **Node.js** + **Express 5**
- **MongoDB** with **Mongoose**
- **JWT** access/refresh tokens (httpOnly refresh cookie, rotation + reuse detection) with **bcrypt** password hashing
- Deployed on **Vercel**

## Features

- **Authentication** — login by name/lastname/password, short-lived access tokens, rotating httpOnly refresh-token cookies, role-gated registration (admin only)
- **Roles** — active (login-capable) roles: `admin`, `main-nurse`, `nurse`, `doctor`; passive (record-only) roles: Caregiver, Physiotherapist, Cleaner, Kitchen, Social Worker, Janitor, Occupational Therapist, Administration
- **Patients** — admission/discharge, per-patient profile data
- **Medicine & articles** — home stock and family-brought stock, usage tracking, reserve lists
- **Diagnoses, analyses & combinations** — templates and per-patient records
- **Specifications (billing periods)** — 30-day billing cycles computed from admission date, with support for manually activating/backfilling a missed period, extra costs, debt/lodging billing and EUR/RSD exchange-rate conversion
- **Calendar & notifications**
- **Dashboard stats endpoint** — role-shaped KPIs (patient counts, staff by role, low-stock medicines, upcoming events, recent activity) for the frontend dashboard

## Project structure

```
controllers/   route handlers, one file per resource
models/        Mongoose schemas
routes/        Express routers, mounted under /api/<resource>
middleware/     authMiddleware (JWT verification)
services/      shared business logic (e.g. specification period resolution)
db/            MongoDB connection setup
```

## Getting started

### Prerequisites

- Node.js 18+
- A MongoDB database (e.g. MongoDB Atlas)

### Setup

```bash
npm install
cp .env.example .env   # then fill in real values
npm start
```

### Environment variables

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (defaults to 5000) |
| `MONGODB_URL` | MongoDB connection string |
| `JWT_KEY` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (must differ from `JWT_KEY`) |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins (e.g. `http://localhost:5173,https://medikalija-frontend.vercel.app`) |

> `NODE_ENV=production` (set automatically by Vercel) switches the refresh cookie to `secure`/`SameSite=None` for cross-site HTTPS; locally it falls back to a dev-friendly `SameSite=Lax`.

## API overview

All routes are mounted under `/api`, and (except `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`) require a `Bearer` access token.

| Base path | Resource |
|---|---|
| `/api/auth` | login, refresh, logout, register, list/delete users |
| `/api/patient` | patient CRUD, discharge |
| `/api/medicine`, `/api/medicine-reserve`, `/api/familyMedicine` | medicine inventory and reserves |
| `/api/diagnosis`, `/api/diagnosisTemplate` | diagnoses |
| `/api/analysis`, `/api/analysis/combination`, `/api/combinationGroup` | analyses and combinations |
| `/api/articles` | articles |
| `/api/specification` | billing periods, activation, billing, PDF-ready data |
| `/api/calendar` | calendar events |
| `/api/notifications` | per-user notifications |
| `/api/dashboard` | role-shaped dashboard stats |
| `/api/exchange-rates` | global EUR/RSD rates used for billing |
| `/api/search` | cross-entity search |

## Security notes

- Refresh tokens are stored server-side (`Token` model, TTL-indexed) and rotated on every use; a token that's already been rotated away is rejected.
- Never commit `.env` — it holds the MongoDB credentials and both JWT secrets.
