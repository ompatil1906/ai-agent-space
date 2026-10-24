# AI Agent Space - Development Makefile
# Makes the foundation solid and professional for local setup and common tasks

.PHONY: help install-backend install-frontend install dev-backend dev-frontend dev test clean docker-up docker-down migrate

help:
	@echo "AI Agent Space - Available commands:"
	@echo "  make install          - Install all dependencies (backend + frontend)"
	@echo "  make install-backend  - Set up Python venv and install backend deps"
	@echo "  make install-frontend - Install frontend Node deps"
	@echo "  make dev              - Run both backend and frontend (in parallel)"
	@echo "  make dev-backend      - Run FastAPI with reload (SQLite by default)"
	@echo "  make dev-frontend     - Run Next.js dev server"
	@echo "  make test             - Run backend tests"
	@echo "  make migrate          - Run Alembic migrations (if using Postgres)"
	@echo "  make docker-up        - Start full stack with Docker Compose"
	@echo "  make docker-down      - Stop Docker Compose services"
	@echo "  make clean            - Clean caches and venvs"

install: install-backend install-frontend

install-backend:
	cd backend && python -m venv venv && . venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

dev-backend:
	cd backend && . venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

dev:
	@echo "Starting backend and frontend..."
	@make -j2 dev-backend dev-frontend

test:
	cd backend && . venv/bin/activate && pytest -v

migrate:
	cd backend && . venv/bin/activate && alembic upgrade head

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	rm -rf backend/venv frontend/node_modules frontend/.next
	@echo "Cleaned."
