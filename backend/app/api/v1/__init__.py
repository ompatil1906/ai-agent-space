from fastapi import APIRouter

from app.api.v1 import agents, auth, runs, marketplace, users, api_keys, mcp_servers, provider_keys
from app.api.v1 import checkout, creator, purchases, admin

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(runs.router, prefix="/agents", tags=["runs"])
api_router.include_router(marketplace.router, prefix="/marketplace", tags=["marketplace"])
api_router.include_router(checkout.router, prefix="/checkouts", tags=["checkout"])
api_router.include_router(purchases.router, prefix="/purchases", tags=["purchases"])
api_router.include_router(creator.router, prefix="/creator", tags=["creator"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(api_keys.router, prefix="/api-keys", tags=["api-keys"])
api_router.include_router(mcp_servers.router, prefix="/mcp-servers", tags=["mcp-servers"])
api_router.include_router(provider_keys.router, prefix="/provider-keys", tags=["provider-keys"])
