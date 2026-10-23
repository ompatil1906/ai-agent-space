"""User profile and dashboard statistics endpoints."""
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, AgentRun, AgentEvaluation, CreditTransaction, User
from app.schemas import UserPublic, UserStats

router = APIRouter()


@router.get("/me", response_model=UserPublic)
def read_current_user(
    current_user: User = Depends(get_current_active_user),
) -> Any:
    return current_user


@router.get("/me/stats", response_model=UserStats)
def get_user_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Aggregated dashboard statistics: agents, runs, success rate, latency, ledger."""
    agents = (
        db.query(Agent)
        .filter(Agent.owner_id == current_user.id)
        .order_by(Agent.updated_at.desc())
        .all()
    )
    run_count_by_agent = dict(
        db.query(AgentRun.agent_id, func.count(AgentRun.id))
        .filter(AgentRun.user_id == current_user.id)
        .group_by(AgentRun.agent_id)
        .all()
    )

    run_stats = (
        db.query(
            func.count(AgentRun.id),
            func.sum(case((AgentRun.status == "completed", 1), else_=0)),
            func.avg(AgentRun.latency_ms),
            func.avg(AgentRun.steps_count),
            func.coalesce(func.sum(AgentRun.input_tokens), 0),
            func.coalesce(func.sum(AgentRun.output_tokens), 0),
            func.coalesce(func.sum(AgentRun.total_tokens), 0),
            func.coalesce(func.sum(AgentRun.estimated_cost_usd), 0.0),
        )
        .filter(AgentRun.user_id == current_user.id)
        .first()
    )
    total_runs = int(run_stats[0] or 0)
    completed_runs = int(run_stats[1] or 0)
    avg_latency = float(run_stats[2]) if run_stats[2] is not None else None
    avg_steps = float(run_stats[3]) if run_stats[3] is not None else None
    total_input_tokens = int(run_stats[4] or 0)
    total_output_tokens = int(run_stats[5] or 0)
    total_tokens = int(run_stats[6] or 0)
    total_estimated_cost_usd = float(run_stats[7] or 0.0)
    avg_cost_per_run = round(total_estimated_cost_usd / total_runs, 6) if total_runs else None

    eval_stats = (
        db.query(func.count(AgentEvaluation.id), func.avg(AgentEvaluation.score))
        .filter(AgentEvaluation.user_id == current_user.id)
        .first()
    )

    ledger = (
        db.query(
            func.coalesce(func.sum(CreditTransaction.amount), 0),
        )
        .filter(CreditTransaction.user_id == current_user.id, CreditTransaction.amount > 0)
        .scalar()
    )
    spend = (
        db.query(
            func.coalesce(func.sum(CreditTransaction.amount), 0),
        )
        .filter(CreditTransaction.user_id == current_user.id, CreditTransaction.amount < 0)
        .scalar()
    )

    recent_runs = (
        db.query(AgentRun)
        .filter(AgentRun.user_id == current_user.id)
        .order_by(AgentRun.created_at.desc())
        .limit(10)
        .all()
    )

    return UserStats(
        agents_count=len(agents),
        published_count=sum(1 for a in agents if a.is_published),
        runs_count=total_runs,
        completed_runs=completed_runs,
        success_rate=round(completed_runs / total_runs, 2) if total_runs else 0.0,
        avg_latency_ms=round(avg_latency, 1) if avg_latency is not None else None,
        avg_steps=round(avg_steps, 2) if avg_steps is not None else None,
        evaluations_count=int(eval_stats[0] or 0),
        avg_evaluation_score=round(float(eval_stats[1]), 2) if eval_stats[1] is not None else None,
        credits=current_user.credits,
        earnings=int(ledger or 0),
        spend=int(spend or 0),
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_tokens=total_tokens,
        total_estimated_cost_usd=round(total_estimated_cost_usd, 6),
        avg_cost_per_run=avg_cost_per_run,
        agents=[
            {
                "id": a.id,
                "name": a.name,
                "is_published": bool(a.is_published),
                "price": a.price,
                "run_count": int(run_count_by_agent.get(a.id, 0)),
            }
            for a in agents[:20]
        ],
        recent_runs=[
            {
                "id": r.id,
                "agent_id": r.agent_id,
                "input": r.input,
                "status": r.status,
                "latency_ms": r.latency_ms,
                "steps_count": r.steps_count,
                "total_tokens": r.total_tokens,
                "estimated_cost_usd": r.estimated_cost_usd,
                "created_at": r.created_at,
            }
            for r in recent_runs
        ],
    )
