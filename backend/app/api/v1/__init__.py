from fastapi import APIRouter

from app.api.v1 import agents, auth, runs, marketplace, users, api_keys

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(runs.router, prefix="/agents", tags=["runs"])
api_router.include_router(marketplace.router, prefix="/marketplace", tags=["marketplace"])
api_router.include_router(api_keys.router, prefix="/api-keys", tags=["api-keys"])
