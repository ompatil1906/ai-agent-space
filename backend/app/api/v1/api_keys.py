"""API key management for programmatic agent access."""
from datetime import datetime, timedelta
from typing import Any, List, Optional
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, ApiKey, Agent
from app.schemas import ApiKeyCreate, ApiKeyPublic, ApiKeyCreateResponse

router = APIRouter()


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _generate_raw_key() -> str:
    return "ask_" + secrets.token_urlsafe(32)


@router.get("/", response_model=List[ApiKeyPublic])
def list_api_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    keys = db.query(ApiKey).filter(ApiKey.user_id == current_user.id).order_by(ApiKey.created_at.desc()).all()
    return keys


@router.post("/", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    if payload.agent_id is not None:
        agent = db.query(Agent).filter(Agent.id == payload.agent_id, Agent.owner_id == current_user.id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found or not owned by you")

    raw_key = _generate_raw_key()
    key_hash = _hash_key(raw_key)
    prefix = raw_key[:12]  # ask_ + a few chars

    expires_at = None
    if payload.expires_in_days:
        expires_at = datetime.utcnow() + timedelta(days=payload.expires_in_days)

    db_key = ApiKey(
        user_id=current_user.id,
        name=payload.name,
        key_prefix=prefix,
        key_hash=key_hash,
        agent_id=payload.agent_id,
        scopes=payload.scopes or ["run"],
        expires_at=expires_at,
    )
    db.add(db_key)
    db.commit()
    db.refresh(db_key)

    # Return with raw_key only once
    return ApiKeyCreateResponse(
        id=db_key.id,
        name=db_key.name,
        key_prefix=db_key.key_prefix,
        agent_id=db_key.agent_id,
        scopes=db_key.scopes or [],
        is_active=db_key.is_active,
        expires_at=db_key.expires_at,
        last_used_at=db_key.last_used_at,
        created_at=db_key.created_at,
        raw_key=raw_key,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.user_id == current_user.id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    key.is_active = False
    db.commit()
