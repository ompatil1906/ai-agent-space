"""Persistent Human-in-the-Loop approval service.

Stores approval requests in the database so they survive process restarts
and work correctly in multi-worker deployments. The runtime polls for resolution.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import ToolApproval

logger = logging.getLogger(__name__)


def create_approval_request(
    request_id: str,
    user_id: int,
    agent_id: int,
    thread_id: Optional[str],
    tool_name: str,
    tool_args: Optional[dict] = None,
) -> None:
    """Insert a new pending approval record."""
    db: Session = SessionLocal()
    try:
        existing = db.query(ToolApproval).filter(ToolApproval.request_id == request_id).first()
        if existing:
            return
        approval = ToolApproval(
            request_id=request_id,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            tool_name=tool_name,
            tool_args=tool_args or {},
            status="pending",
        )
        db.add(approval)
        db.commit()
        logger.info(f"Created persistent approval request: {request_id}")
    except Exception as e:
        logger.exception(f"Failed to create approval record: {e}")
        db.rollback()
    finally:
        db.close()


def get_approval_status(request_id: str) -> Optional[str]:
    """Return the current status of an approval, or None if not found."""
    db: Session = SessionLocal()
    try:
        approval = db.query(ToolApproval).filter(ToolApproval.request_id == request_id).first()
        return approval.status if approval else None
    finally:
        db.close()


def resolve_approval_in_db(request_id: str, approved: bool) -> bool:
    """Update the approval status in the database. Returns True if a pending record was updated."""
    db: Session = SessionLocal()
    try:
        approval = db.query(ToolApproval).filter(
            ToolApproval.request_id == request_id,
            ToolApproval.status == "pending",
        ).first()
        if not approval:
            return False
        approval.status = "approved" if approved else "denied"
        approval.resolved_at = datetime.utcnow()
        db.commit()
        logger.info(f"Resolved approval {request_id} -> {approval.status}")
        return True
    except Exception as e:
        logger.exception(f"Failed to resolve approval: {e}")
        db.rollback()
        return False
    finally:
        db.close()


async def wait_for_approval_db(request_id: str, timeout: float = 300.0) -> bool:
    """Poll the database until the approval is resolved or times out.
    
    Returns True if approved, False if denied or timed out.
    """
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        status = get_approval_status(request_id)
        if status == "approved":
            return True
        if status in ("denied", "expired"):
            return False
        # Still pending or not yet written
        await asyncio.sleep(0.4)
    # Timeout — mark as expired
    db: Session = SessionLocal()
    try:
        approval = db.query(ToolApproval).filter(
            ToolApproval.request_id == request_id,
            ToolApproval.status == "pending",
        ).first()
        if approval:
            approval.status = "expired"
            approval.resolved_at = datetime.utcnow()
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    logger.warning(f"Approval timed out: {request_id}")
    return False
