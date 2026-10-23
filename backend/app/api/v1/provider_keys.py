"""User provider keys (BYOK): per-user API keys for LLM providers.

Platform default: every agent runs on Gemini with the platform key. A user's
saved key for a provider overrides that default for their agents.
"""
import re
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, ProviderKey
from app.schemas import ProviderKeyCreate, ProviderKeyPublic

router = APIRouter()


def _mask(key: str) -> str:
    if len(key) <= 10:
        return f"{key[:3]}***"
    return f"{key[:6]}...{key[-4:]}"


@router.get("/", response_model=List[ProviderKeyPublic])
def list_provider_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    keys = (
        db.query(ProviderKey)
        .filter(ProviderKey.user_id == current_user.id)
        .order_by(ProviderKey.created_at.desc())
        .all()
    )
    return [
        ProviderKeyPublic(
            id=k.id,
            provider=k.provider,
            label=k.label,
            base_url=k.base_url,
            api_key_masked=_mask(k.api_key),
            created_at=k.created_at,
        )
        for k in keys
    ]


@router.post("/", response_model=ProviderKeyPublic, status_code=status.HTTP_201_CREATED)
def create_provider_key(
    payload: ProviderKeyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    if payload.provider == "custom" and not (payload.base_url or "").startswith("http"):
        raise HTTPException(status_code=400, detail="Custom providers need a base_url starting with http(s)://")

    # One key per provider: replace any existing entry for this provider
    (
        db.query(ProviderKey)
        .filter(ProviderKey.user_id == current_user.id, ProviderKey.provider == payload.provider)
        .delete()
    )

    key = ProviderKey(
        user_id=current_user.id,
        provider=payload.provider,
        label=payload.label or f"My {payload.provider} key",
        api_key=payload.api_key.strip(),
        base_url=(payload.base_url or None) if payload.provider == "custom" else None,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return ProviderKeyPublic(
        id=key.id,
        provider=key.provider,
        label=key.label,
        base_url=key.base_url,
        api_key_masked=_mask(key.api_key),
        created_at=key.created_at,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    deleted = (
        db.query(ProviderKey)
        .filter(ProviderKey.id == key_id, ProviderKey.user_id == current_user.id)
        .delete()
    )
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider key not found")
