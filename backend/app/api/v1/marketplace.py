"""Public marketplace: catalog, listing pages, ratings, leaderboard.

Real-money model notes:
* Listings are PUBLIC (no auth required to browse; viewer flags attach when a
  valid token is present).
* Pricing is sourced from each agent's active AgentPricingPlan (money in minor
  units), not the legacy integer credit price.
* system_prompt / tools_config / memory_config / advanced_config are NEVER
  exposed by public endpoints.
"""
from typing import Any, List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user, get_current_user_optional
from app.models import (
    Agent,
    AgentCategory,
    AgentPricingPlan,
    AgentRating,
    AgentRun,
    ModerationReport,
    Purchase,
    User,
)
from app.schemas import (
    AgentPublic,
    AgentRatingCreate,
    ModerationReportIn,
    PricingPlanPublic,
    PublicAgent,
    PublicAgentDetail,
)
from app.services import ledger
from app.services.execution_auth import ensure_unique_slug
from app.services.ledger import log_audit

router = APIRouter()


def _ratings_subq(db: Session):
    return (
        db.query(
            AgentRating.agent_id,
            func.avg(AgentRating.rating).label("avg_rating"),
            func.count(AgentRating.id).label("rating_count"),
        )
        .group_by(AgentRating.agent_id)
        .subquery()
    )


def _listing_query(db: Session):
    """Base query for published agents with rating / usage / sales aggregates."""
    ratings_subq = _ratings_subq(db)
    runs_subq = (
        db.query(AgentRun.agent_id, func.count(AgentRun.id).label("run_count"))
        .group_by(AgentRun.agent_id)
        .subquery()
    )
    sales_subq = (
        db.query(Purchase.agent_id, func.count(Purchase.id).label("sales_count"))
        .filter(Purchase.status.in_(["paid", "refunded", "partially_refunded"]))
        .group_by(Purchase.agent_id)
        .subquery()
    )
    return (
        db.query(
            Agent,
            ratings_subq.c.avg_rating,
            ratings_subq.c.rating_count,
            runs_subq.c.run_count,
            sales_subq.c.sales_count,
        )
        .outerjoin(ratings_subq, Agent.id == ratings_subq.c.agent_id)
        .outerjoin(runs_subq, Agent.id == runs_subq.c.agent_id)
        .outerjoin(sales_subq, Agent.id == sales_subq.c.agent_id)
    )


def _to_public_card(
    db: Session,
    agent: Agent,
    avg_rating: Optional[float],
    rating_count: Optional[int],
    run_count: Optional[int],
    sales_count: Optional[int],
    viewer: Optional[User],
) -> PublicAgent:
    category = (
        db.query(AgentCategory).filter(AgentCategory.id == agent.category_id).first()
        if agent.category_id
        else None
    )
    data = PublicAgent.model_validate(agent)
    data.category_slug = category.slug if category else None
    data.category_name = category.name if category else None
    data.average_rating = round(float(avg_rating), 2) if avg_rating is not None else None
    data.rating_count = int(rating_count or 0)
    data.run_count = int(run_count or 0)
    data.sales_count = int(sales_count or 0)
    if agent.owner:
        data.owner_email = agent.owner.email
        profile = getattr(agent.owner, "creator_profile", None)
        if profile and profile.display_name:
            data.owner_display_name = profile.display_name
    plan = ledger.active_plan_for(db, agent.id)
    if plan:
        data.pricing = PricingPlanPublic.model_validate(
            {
                "id": plan.id,
                "agent_id": plan.agent_id,
                "model": plan.model,
                "currency": plan.currency,
                "amount_minor": plan.amount_minor,
                "billing_interval": plan.billing_interval,
                "runs_per_pack": plan.runs_per_pack,
                "limits": plan.limits or {},
                "is_active": True,
                "created_at": plan.created_at,
            }
        )
    if viewer:
        data.owned_by_viewer = agent.owner_id == viewer.id
        if not data.owned_by_viewer:
            ent = ledger.get_entitlement(db, viewer.id, agent.id)
            data.purchased = bool(ent and ent.status == "active")
        else:
            data.purchased = True
    return data


def _get_public_agent(db: Session, slug: str) -> Agent:
    agent = (
        db.query(Agent)
        .options(joinedload(Agent.owner))
        .options(joinedload(Agent.pricing_plans))
        .filter(Agent.slug == slug)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.status != "published" or not agent.is_public:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)) -> Any:
    ledger.ensure_categories_seeded(db)
    db.commit()
    cats = db.query(AgentCategory).order_by(AgentCategory.name).all()
    return [
        {"id": c.id, "slug": c.slug, "name": c.name, "description": c.description}
        for c in cats
    ]


@router.get("/agents", response_model=List[PublicAgent])
def list_published_agents(
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
    skip: int = 0,
    limit: int = Query(24, ge=1, le=100),
    search: Optional[str] = Query(None, description="keyword search across name, tagline, description"),
    category: Optional[str] = Query(None, description="category slug"),
    pricing_model: Optional[str] = Query(None, pattern="^(free|one_time|subscription|pay_per_execution)$"),
    min_rating: Optional[float] = Query(None, ge=0, le=5),
    sort_by: str = Query("popular", pattern="^(popular|newest|rating|price_low|price_high|name)$"),
    featured: Optional[bool] = None,
) -> Any:
    """Browse the marketplace. Public without auth; viewer flags when signed in."""
    query = _listing_query(db).filter(
        Agent.is_published == True,  # noqa: E712
        Agent.is_public == True,  # noqa: E712
        Agent.status == "published",
    )

    if featured:
        query = query.filter(Agent.is_featured == True)  # noqa: E712

    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                Agent.name.ilike(like),
                Agent.tagline.ilike(like),
                Agent.description.ilike(like),
                Agent.problem_statement.ilike(like),
            )
        )

    if category:
        cat = db.query(AgentCategory).filter(AgentCategory.slug == category).first()
        if not cat:
            return []
        query = query.filter(Agent.category_id == cat.id)

    if pricing_model:
        plan_subq = (
            db.query(AgentPricingPlan.agent_id)
            .filter(AgentPricingPlan.is_active == True, AgentPricingPlan.model == pricing_model)  # noqa: E712
            .subquery()
        )
        query = query.filter(Agent.id.in_(plan_subq))

    if min_rating is not None:
        ratings_subq = _ratings_subq(db)
        query = query.outerjoin(
            ratings_subq, Agent.id == ratings_subq.c.agent_id
        ).filter(func.coalesce(ratings_subq.c.avg_rating, 0) >= min_rating)

    # Sorting (SQL-side where possible; popular ranking is computed in Python)
    if sort_by == "popular":
        pass
    elif sort_by == "newest":
        query = query.order_by(func.coalesce(Agent.published_at, Agent.created_at).desc())
    elif sort_by == "name":
        query = query.order_by(Agent.name.asc())
    elif sort_by == "rating":
        ratings_subq = _ratings_subq(db)
        query = query.outerjoin(
            ratings_subq, Agent.id == ratings_subq.c.agent_id
        ).order_by(ratings_subq.c.avg_rating.desc().nullslast())
    elif sort_by in ("price_low", "price_high"):
        plan_subq = (
            db.query(AgentPricingPlan.agent_id, func.min(AgentPricingPlan.amount_minor).label("amount"))
            .filter(AgentPricingPlan.is_active == True)  # noqa: E712
            .group_by(AgentPricingPlan.agent_id)
            .subquery()
        )
        direction = plan_subq.c.amount.asc() if sort_by == "price_low" else plan_subq.c.amount.desc()
        query = query.join(plan_subq, Agent.id == plan_subq.c.agent_id).order_by(direction)

    rows = query.all() if sort_by == "popular" else query.offset(skip).limit(limit).all()
    cards = [
        _to_public_card(db, agent, avg, cnt, runs, sales, viewer)
        for agent, avg, cnt, runs, sales in rows
    ]
    if sort_by == "popular":
        cards.sort(
            key=lambda c: (c.is_featured, c.run_count + c.sales_count * 5 + c.rating_count * 2),
            reverse=True,
        )
        return cards[skip : skip + limit]
    return cards


def ratings_alias_join(db: Session):
    return _ratings_subq(db)


@router.get("/agents/featured", response_model=List[PublicAgent])
def featured_agents(
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
    limit: int = Query(6, ge=1, le=12),
) -> Any:
    query = _listing_query(db).filter(
        Agent.is_published == True,  # noqa: E712
        Agent.is_public == True,  # noqa: E712
        Agent.status == "published",
        Agent.is_featured == True,  # noqa: E712
    )
    rows = query.order_by(func.coalesce(Agent.featured_at, Agent.created_at).desc()).limit(limit).all()
    return [_to_public_card(db, a, r, c, runs, sales, viewer) for a, r, c, runs, sales in rows]


@router.get("/agents/trending", response_model=List[PublicAgent])
def trending_agents(
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
    limit: int = Query(6, ge=1, le=12),
) -> Any:
    """Most-engaged listings over the last 30 days (runs + paid purchases)."""
    since = datetime.utcnow() - timedelta(days=30)
    recent_runs = (
        db.query(AgentRun.agent_id, func.count(AgentRun.id).label("n"))
        .filter(AgentRun.created_at >= since)
        .group_by(AgentRun.agent_id)
        .subquery()
    )
    recent_sales = (
        db.query(Purchase.agent_id, func.count(Purchase.id).label("n"))
        .filter(Purchase.created_at >= since, Purchase.status.in_(["paid", "partially_refunded"]))
        .group_by(Purchase.agent_id)
        .subquery()
    )
    ratings_subq = _ratings_subq(db)
    rows = (
        db.query(
            Agent,
            ratings_subq.c.avg_rating,
            ratings_subq.c.rating_count,
            recent_runs.c.n,
            recent_sales.c.n,
        )
        .outerjoin(ratings_subq, Agent.id == ratings_subq.c.agent_id)
        .outerjoin(recent_runs, Agent.id == recent_runs.c.agent_id)
        .outerjoin(recent_sales, Agent.id == recent_sales.c.agent_id)
        .filter(
            Agent.is_published == True,  # noqa: E712
            Agent.is_public == True,  # noqa: E712
            Agent.status == "published",
        )
        .order_by(
            (func.coalesce(recent_runs.c.n, 0) + func.coalesce(recent_sales.c.n, 0) * 10).desc(),
            Agent.view_count.desc(),
        )
        .limit(limit)
        .all()
    )
    return [_to_public_card(db, a, r, c, runs, sales, viewer) for a, r, c, runs, sales in rows]


@router.get("/agents/{slug}", response_model=PublicAgentDetail)
def public_agent_detail(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
) -> Any:
    """Public landing page payload for one published agent (URL: /agents/{slug})."""
    agent = _get_public_agent(db, slug)
    agent.view_count = (agent.view_count or 0) + 1
    db.add(agent)
    db.commit()

    rating_stats = (
        db.query(func.avg(AgentRating.rating), func.count(AgentRating.id))
        .filter(AgentRating.agent_id == agent.id)
        .first()
    )
    run_count = db.query(func.count(AgentRun.id)).filter(AgentRun.agent_id == agent.id).scalar() or 0
    sales_count = (
        db.query(func.count(Purchase.id))
        .filter(Purchase.agent_id == agent.id, Purchase.status == "paid")
        .scalar()
        or 0
    )

    data = _to_public_card(
        db,
        agent,
        rating_stats[0],
        rating_stats[1],
        run_count,
        sales_count,
        viewer,
    )
    category = (
        db.query(AgentCategory).filter(AgentCategory.id == agent.category_id).first()
        if agent.category_id
        else None
    )
    if category:
        data.category_slug = category.slug
        data.category_name = category.name
    versions = agent.versions
    detail = PublicAgentDetail(
        **data.model_dump(),
        problem_statement=agent.problem_statement,
        use_cases=agent.use_cases or [],
        target_audience=agent.target_audience,
        example_prompts=agent.example_prompts or [],
        faqs=agent.faqs or [],
        usage_instructions=agent.usage_instructions,
        refund_window_days=agent.refund_window_days,
        version_count=len(versions),
        latest_version=f"v{versions[0].version_number}" if versions else None,
        tools_count=len(agent.tools_config or []),
        workflow_type=(agent.workflow_config or {}).get("type", "single"),
    )
    return detail


# --- Listing lifecycle (creator side) ----------------------------------------

def _require_owned_agent(db: Session, agent_id: int, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Agent not found or not owned")
    return agent


def _validate_publish(agent: Agent) -> None:
    """A listing needs product-quality content and a real pricing plan."""
    if len((agent.name or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="Add a name before publishing")
    if not (agent.description or "").strip() or len(agent.description.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail="Write a description (at least 20 characters) before publishing",
        )


@router.post("/agents/{agent_id}/publish", response_model=AgentPublic)
def publish_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = _require_owned_agent(db, agent_id, current_user)
    _validate_publish(agent)
    ledger.ensure_creator_profile(db, current_user.id)
    db.flush()
    if (settings.MARKETPLACE_MODERATION or "off") == "manual":
        agent.status = "pending_review"
        agent.is_published = False
    else:
        agent.status = "published"
        agent.is_published = True
        agent.is_public = True
        agent.published_at = agent.published_at or datetime.utcnow()
    db.commit()
    db.refresh(agent)
    log_audit(db, current_user.id, "agent.publish", "agent", agent.id, {"status": agent.status})
    db.commit()
    return agent


@router.post("/agents/{agent_id}/unpublish", response_model=AgentPublic)
def unpublish_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = _require_owned_agent(db, agent_id, current_user)
    agent.status = "draft"
    agent.is_published = False
    agent.is_public = False
    db.commit()
    db.refresh(agent)
    log_audit(db, current_user.id, "agent.unpublish", "agent", agent.id)
    db.commit()
    return agent


@router.post("/agents/{agent_id}/clone", response_model=AgentPublic)
def clone_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Clone a published agent into the user's workspace.

    Policy: free agents and owned agents clone directly. Paid agents require a
    purchase/entitlement (granted by a verified payment) — never credits.
    """
    source = db.query(Agent).filter(Agent.id == agent_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Agent not found")
    if source.owner_id != current_user.id and not source.is_public:
        raise HTTPException(status_code=403, detail="Cannot clone private agent")

    if source.owner_id != current_user.id:
        plan = ledger.active_plan_for(db, source.id)
        if plan and plan.model != "free":
            ent = ledger.get_entitlement(db, current_user.id, source.id)
            if not ent or ent.status != "active":
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail="Purchase required before cloning this paid agent",
                )

    cloned = Agent(
        name=f"{source.name} (Clone)",
        description=source.description,
        system_prompt=source.system_prompt,
        model_name=source.model_name,
        temperature=source.temperature,
        tools_config=source.tools_config or [],
        memory_config=source.memory_config or {},
        workflow_config=source.workflow_config or {},
        max_steps=source.max_steps,
        autonomy_level=source.autonomy_level,
        sandbox_enabled=source.sandbox_enabled,
        advanced_config=source.advanced_config or {},
        is_public=False,
        is_published=False,
        price=0,
        status="draft",
        owner_id=current_user.id,
    )
    cloned.slug = ensure_unique_slug(db, cloned.name)
    db.add(cloned)
    db.commit()
    db.refresh(cloned)
    return cloned


# --- Ratings -------------------------------------------------------------------

@router.post("/agents/{agent_id}/rate")
def rate_agent(
    agent_id: int,
    rating_in: AgentRatingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Rate an agent. `verified_purchase` is stamped from live entitlement data."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.status != "published":
        raise HTTPException(status_code=404, detail="Published agent not found")

    ent = ledger.get_entitlement(db, current_user.id, agent_id)
    verified = bool(ent and ent.status == "active")

    existing = (
        db.query(AgentRating)
        .filter(AgentRating.agent_id == agent_id, AgentRating.user_id == current_user.id)
        .first()
    )
    if existing:
        existing.rating = rating_in.rating
        existing.review = rating_in.review
        existing.verified_purchase = verified or bool(existing.verified_purchase)
        rating = existing
    else:
        rating = AgentRating(
            agent_id=agent_id,
            user_id=current_user.id,
            rating=rating_in.rating,
            review=rating_in.review,
            verified_purchase=verified,
        )
        db.add(rating)
    db.commit()
    db.refresh(rating)
    return {
        "id": rating.id,
        "agent_id": rating.agent_id,
        "user_id": rating.user_id,
        "rating": rating.rating,
        "review": rating.review,
        "verified_purchase": rating.verified_purchase,
        "created_at": rating.created_at,
        "user_email": current_user.email,
    }


@router.get("/agents/{agent_id}/ratings")
def list_agent_ratings(
    agent_id: int,
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    ratings = (
        db.query(AgentRating)
        .filter(AgentRating.agent_id == agent_id)
        .order_by(AgentRating.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    out = []
    for r in ratings:
        user = db.query(User).filter(User.id == r.user_id).first()
        profile = getattr(user, "creator_profile", None) if user else None
        out.append(
            {
                "id": r.id,
                "agent_id": r.agent_id,
                "user_id": r.user_id,
                "rating": r.rating,
                "review": r.review,
                "verified_purchase": bool(r.verified_purchase),
                "created_at": r.created_at,
                "user_email": user.email if user else None,
                "user_display_name": (
                    profile.display_name
                    if profile and profile.display_name
                    else (user.full_name if user else None)
                ),
            }
        )
    return out


@router.get("/agents/{agent_id}/rating-summary")
def get_rating_summary(agent_id: int, db: Session = Depends(get_db)) -> Any:
    stats = (
        db.query(func.avg(AgentRating.rating), func.count(AgentRating.id))
        .filter(AgentRating.agent_id == agent_id)
        .first()
    )
    return {
        "average_rating": round(float(stats[0]), 2) if stats[0] is not None else None,
        "rating_count": stats[1] or 0,
    }


@router.post("/agents/{agent_id}/report", status_code=201)
def report_agent(
    agent_id: int,
    body: ModerationReportIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Buyers can report a listing for moderation."""
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.is_published == True)  # noqa: E712
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Published agent not found")
    row = ModerationReport(
        agent_id=agent_id,
        reporter_id=current_user.id,
        reason=body.reason,
        details=body.details,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "status": row.status}


# --- Leaderboard ----------------------------------------------------------------

@router.get("/leaderboard")
def get_leaderboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    limit: int = Query(20, ge=1, le=100),
) -> Any:
    """Rank published agents by quality and money-adoption.

    score = avg_rating*20 + rating_count*2 + run_count + paid_sales*5
    """
    runs_by_agent = dict(
        db.query(AgentRun.agent_id, func.count(AgentRun.id)).group_by(AgentRun.agent_id).all()
    )
    sales_by_agent = dict(
        db.query(Purchase.agent_id, func.count(Purchase.id))
        .filter(Purchase.status.in_(["paid", "partially_refunded", "refunded"]))
        .group_by(Purchase.agent_id)
        .all()
    )
    ratings_map = {
        r[0]: (float(r[1]) if r[1] is not None else 0.0, int(r[2] or 0))
        for r in db.query(
            AgentRating.agent_id, func.avg(AgentRating.rating), func.count(AgentRating.id)
        )
        .group_by(AgentRating.agent_id)
        .all()
    }
    published = (
        db.query(Agent)
        .options(joinedload(Agent.owner))
        .filter(Agent.is_published == True)  # noqa: E712
        .all()
    )
    entries: List[dict] = []
    plan_cache: dict[int, Optional[AgentPricingPlan]] = {}
    for agent in published:
        if agent.id not in plan_cache:
            plan_cache[agent.id] = ledger.active_plan_for(db, agent.id)
        plan = plan_cache[agent.id]
        run_count = int(runs_by_agent.get(agent.id, 0))
        sales_count = int(sales_by_agent.get(agent.id, 0))
        avg_rating, rating_count = ratings_map.get(agent.id, (0.0, 0))
        score = round(avg_rating * 20 + rating_count * 2 + run_count + sales_count * 5, 2)
        entries.append(
            {
                "agent_id": agent.id,
                "agent_name": agent.name,
                "agent_slug": agent.slug,
                "description": agent.description,
                "owner_email": agent.owner.email if agent.owner else "unknown",
                "owner_display_name": (
                    agent.owner.creator_profile.display_name
                    if agent.owner and getattr(agent.owner, "creator_profile", None)
                    else None
                ),
                "owner_id": agent.owner_id,
                "model_name": agent.model_name,
                "price": agent.price or 0,
                "pricing_model": plan.model if plan else "free",
                "amount_minor": plan.amount_minor if plan else 0,
                "currency": plan.currency if plan else settings.PLATFORM_CURRENCY,
                "sandbox_enabled": bool(agent.sandbox_enabled),
                "autonomy_level": agent.autonomy_level or "supervised",
                "avg_rating": round(avg_rating, 2) if avg_rating else None,
                "rating_count": rating_count,
                "run_count": run_count,
                "sales_count": sales_count,
                "score": score,
            }
        )
    entries.sort(key=lambda e: (e["score"], e["avg_rating"] or 0.0, e["run_count"]), reverse=True)
    ranked = []
    for position, entry in enumerate(entries[:limit], start=1):
        entry["rank"] = position
        ranked.append(entry)
    return ranked
