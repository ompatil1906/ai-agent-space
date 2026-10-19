# Deployment Guide: AI Agent Space

This guide provides end-to-end instructions for deploying the **Frontend** to **Vercel** and the **Backend** to **Render** (or **Railway**), backed by GitHub CI/CD and managed PostgreSQL.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │          Vercel (Frontend)           │
                      │               Next.js                │
                      └──────────────────┬───────────────────┘
                                         │
                   HTTPS API Calls       │  NEXT_PUBLIC_API_URL
                                         ▼
                      ┌──────────────────────────────────────┐
                      │       Render / Railway (Backend)     │
                      │            FastAPI (Uvicorn)         │
                      └──────────────────┬───────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │     Managed PostgreSQL Database      │
                      └──────────────────────────────────────┘
```

---

## 1. Deploying Backend to Render (Recommended)

Render provides native Python web services and managed PostgreSQL databases.

### Option A: 1-Click Blueprint Deploy (Easiest)

The repository includes a ready-to-use [`render.yaml`](file:///Users/ompatil/Om/Projects/ai-agent-space/render.yaml) file:

1. Push your code to your GitHub repository:
   ```bash
   git push origin main
   ```
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** > **Blueprint**.
4. Connect your `ai-agent-space` GitHub repository.
5. Render will automatically detect `render.yaml` and configure:
   - **`ai-agent-space-backend`** (Web Service on Python 3.11 with FastAPI)
   - **`ai-agent-space-db`** (Managed PostgreSQL database)
   - Automatic database connection string binding (`DATABASE_URL`)
   - Secret key auto-generation
6. Under environment variables, supply your API keys:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `GEMINI_API_KEY`: (Optional) Your Google Gemini API key
7. Click **Apply**.
8. Once deployed, copy your backend URL (e.g., `https://ai-agent-space-backend.onrender.com`).
   - Test it: `https://ai-agent-space-backend.onrender.com/health` should return `{"status":"ok"}`.

### Option B: Manual Web Service on Render

If you prefer to configure manually:
1. In Render, click **New +** > **Web Service**.
2. Connect your repo and set:
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
3. Add Environment Variables:
   - `PROJECT_NAME`: `AI Agent Space`
   - `API_V1_STR`: `/api/v1`
   - `SECRET_KEY`: `<Generate a random 32-character string>`
   - `DATABASE_URL`: `sqlite:///./sql_app.db` (or connection string from a Render PostgreSQL instance)
   - `OPENAI_API_KEY`: `sk-...`
   - `CORS_ORIGINS`: `*` (or your Vercel URL once known)
4. Click **Create Web Service**.

---

## 2. Deploying Backend to Railway (Alternative)

1. Log in to [Railway](https://railway.com).
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select `ai-agent-space`.
4. In Project Settings:
   - **Root Directory**: Set to `/` (Railway will read [`railway.json`](file:///Users/ompatil/Om/Projects/ai-agent-space/railway.json) and [`backend/Dockerfile`](file:///Users/ompatil/Om/Projects/ai-agent-space/backend/Dockerfile)) or set Root Directory to `backend`.
5. Add a PostgreSQL database:
   - Click **+ New** > **Database** > **Add PostgreSQL**.
   - In the backend service, connect `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
6. Add remaining variables:
   - `OPENAI_API_KEY`: `sk-...`
   - `SECRET_KEY`: `<secure random string>`
   - `CORS_ORIGINS`: `*`
7. Click **Deploy**. Under **Networking**, generate a public domain (e.g., `https://ai-agent-space-production.up.railway.app`).

---

## 3. Deploying Frontend to Vercel

Vercel is the optimal hosting platform for Next.js applications.

1. Go to [Vercel](https://vercel.com) and log in.
2. Click **Add New...** > **Project**.
3. Import your `ai-agent-space` repository.
4. Configure Project Settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click **Edit** and select **`frontend`** (Crucial step!).
   - **Build Command**: `next build` (Default)
   - **Output Directory**: `.next` (Default)
   - **Install Command**: `npm install` (Default)
5. Expand **Environment Variables**:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NEXT_PUBLIC_API_URL` | `https://<YOUR_BACKEND_URL>/api/v1` | **Must include `/api/v1` suffix** |

   *Example*: `https://ai-agent-space-backend.onrender.com/api/v1`
6. Click **Deploy**.
7. Vercel will build and deploy your application. You will get a production URL like `https://ai-agent-space.vercel.app`.

---

## 4. Tightening Production CORS (Post-Deployment)

Once your frontend is live on Vercel:
1. Go to your Render or Railway backend settings.
2. Update `CORS_ORIGINS` from `*` to your production frontend domain:
   ```env
   CORS_ORIGINS=https://ai-agent-space.vercel.app,http://localhost:3000
   ```
3. Restart/redeploy the backend. This restricts browser requests strictly to your official frontend.

---

## 5. Automated CI/CD (GitHub Actions)

A GitHub Actions workflow is preconfigured in [`.github/workflows/ci.yml`](file:///Users/ompatil/Om/Projects/ai-agent-space/.github/workflows/ci.yml).

Every time you push or create a pull request to `main`:
1. **Frontend Check**: Installs dependencies and runs a full production `next build` to guarantee no TypeScript or routing errors.
2. **Backend Check**: Installs dependencies and imports the FastAPI application to verify schemas, models, and dependencies.
3. **Auto-Deploy**:
   - Vercel automatically deploys every push to `main` via its native GitHub integration.
   - Render / Railway automatically redeploys on new commits to `main`.

---

## 6. Self-Hosted & Docker Alternative

If you want to run the entire stack on any server or VPS (Docker & Docker Compose):

1. Copy `.env.example` in both folders:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. Start the full stack:
   ```bash
   docker compose up -d --build
   ```
   This spins up:
   - Frontend at `http://localhost:3000`
   - Backend at `http://localhost:8000`
   - PostgreSQL on port `5432`

---

## Quick Checklist Before Deploying

- [ ] All recent changes committed and pushed to `main` branch.
- [ ] Backend deployed and returns `{"status":"ok"}` on `/health`.
- [ ] Vercel root directory set to `frontend`.
- [ ] `NEXT_PUBLIC_API_URL` configured on Vercel with your live backend domain + `/api/v1`.
- [ ] `OPENAI_API_KEY` configured on backend service.
- [ ] Backend `CORS_ORIGINS` updated to allow Vercel domain.
