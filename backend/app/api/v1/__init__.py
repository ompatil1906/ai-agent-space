from fastapi import APIRouter

from app.api.v1 import agents, auth, runs

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(runs.router, prefix="/agents", tags=["runs"])
