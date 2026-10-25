import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import Base, engine, get_db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

API_VERSION = "1.0.7"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting AI Agent Space API v%s", API_VERSION)
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured")
    yield
    # Shutdown
    logger.info("Shutting down AI Agent Space API")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=API_VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
    description="Open-source platform for creating, running, and sharing autonomous AI agents with MCP, sandboxed execution, and multi-agent workflows.",
)

# Set up CORS middleware
origins = (
    [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
    if settings.CORS_ORIGINS != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def read_root():
    return {
        "message": "Welcome to AI Agent Space API",
        "status": "running",
        "version": API_VERSION,
        "docs": "/docs",
    }


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check that also verifies database connectivity."""
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        logger.error("Database health check failed: %s", e)
        db_status = "error"
    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "version": API_VERSION,
        "database": db_status,
    }


@app.get("/ready")
def readiness_check(db: Session = Depends(get_db)):
    """Readiness probe for orchestration (Kubernetes, etc.)."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ready", "version": API_VERSION}
    except Exception as e:
        logger.error("Readiness check failed: %s", e)
        raise HTTPException(status_code=503, detail="Service not ready")
