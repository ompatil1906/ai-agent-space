from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, User, AgentRating
from app.schemas import AgentPublic, AgentRatingCreate, AgentRatingPublic, AgentWithRating

router = APIRouter()


@router.get("/agents", response_model=List[AgentWithRating])
def list_published_agents(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
    min_rating: Optional[float] = Query(None, ge=0, le=5),
    price_filter: Optional[str] = Query(None, regex="^(free|paid|all)$"),
    sort_by: Optional[str] = Query("created", regex="^(rating|price|name|created)$"),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Browse published agents in the marketplace with ratings, filters, and sorting."""
    # Subquery for rating aggregates
    rating_subq = (
        db.query(
            AgentRating.agent_id,
            func.avg(AgentRating.rating).label("avg_rating"),
            func.count(AgentRating.id).label("rating_count"),
        )
        .group_by(AgentRating.agent_id)
        .subquery()
    )

    query = (
        db.query(
            Agent,
            rating_subq.c.avg_rating,
            rating_subq.c.rating_count,
        )
        .outerjoin(rating_subq, Agent.id == rating_subq.c.agent_id)
        .filter(Agent.is_published == True, Agent.is_public == True)
    )

    if search:
        query = query.filter(
            Agent.name.ilike(f"%{search}%") | Agent.description.ilike(f"%{search}%")
        )

    if price_filter == "free":
        query = query.filter(Agent.price == 0)
    elif price_filter == "paid":
        query = query.filter(Agent.price > 0)

    if min_rating is not None:
        query = query.filter(
            (rating_subq.c.avg_rating >= min_rating) | (rating_subq.c.avg_rating.is_(None))
        )

    # Sorting
    if sort_by == "rating":
        query = query.order_by(rating_subq.c.avg_rating.desc().nullslast(), Agent.created_at.desc())
    elif sort_by == "price":
        query = query.order_by(Agent.price.asc())
    elif sort_by == "name":
        query = query.order_by(Agent.name.asc())
    else:  # created
        query = query.order_by(Agent.created_at.desc())

    results = query.offset(skip).limit(limit).all()

    result = []
    for agent, avg_rating, rating_count in results:
        data = AgentWithRating.model_validate(agent)
        if agent.owner:
            data.owner_email = agent.owner.email
        data.average_rating = float(avg_rating) if avg_rating is not None else None
        data.rating_count = rating_count or 0
        result.append(data)
    return result


@router.post("/agents/{agent_id}/publish", response_model=AgentPublic)
def publish_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found or not owned")
    agent.is_published = True
    agent.is_public = True
    db.commit()
    db.refresh(agent)
    return agent


@router.post("/agents/{agent_id}/unpublish", response_model=AgentPublic)
def unpublish_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found or not owned")
    agent.is_published = False
    db.commit()
    db.refresh(agent)
    return agent


@router.post("/agents/{agent_id}/clone", response_model=AgentPublic)
def clone_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Clone a public or owned agent into the current user's agents."""
    source = db.query(Agent).filter(Agent.id == agent_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Agent not found")
    if source.owner_id != current_user.id and not source.is_public:
        raise HTTPException(status_code=403, detail="Cannot clone private agent")

    # If priced and not free, require purchase first (simple check: allow clone of free or owned)
    if source.price > 0 and source.owner_id != current_user.id:
        # For simplicity, clone is free; purchase is separate for "ownership transfer" or premium
        pass

    cloned = Agent(
        name=f"{source.name} (Clone)",
        description=source.description,
        system_prompt=source.system_prompt,
        model_name=source.model_name,
        temperature=source.temperature,
        tools_config=source.tools_config or [],
        memory_config=source.memory_config or {},
        workflow_config=source.workflow_config or {},
        is_public=False,
        is_published=False,
        price=0,
        owner_id=current_user.id,
    )
    db.add(cloned)
    db.commit()
    db.refresh(cloned)
    return cloned


@router.post("/agents/{agent_id}/purchase", response_model=dict)
def purchase_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Simple credit-based purchase. Grants clone rights or marks as purchased."""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.is_published == True).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Published agent not found")
    if agent.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot purchase your own agent")
    if agent.price == 0:
        return {"message": "Agent is free", "credits_remaining": current_user.credits}

    if current_user.credits < agent.price:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    # Transfer credits
    seller = agent.owner
    current_user.credits -= agent.price
    seller.credits += agent.price

    # Auto-clone after purchase for convenience
    cloned = Agent(
        name=f"{agent.name} (Purchased)",
        description=agent.description,
        system_prompt=agent.system_prompt,
        model_name=agent.model_name,
        temperature=agent.temperature,
        tools_config=agent.tools_config or [],
        memory_config=agent.memory_config or {},
        workflow_config=agent.workflow_config or {},
        is_public=False,
        is_published=False,
        price=0,
        owner_id=current_user.id,
    )
    db.add(cloned)
    db.commit()
    db.refresh(current_user)
    return {
        "message": "Purchase successful. Agent cloned to your workspace.",
        "cloned_agent_id": cloned.id,
        "credits_remaining": current_user.credits,
        "price_paid": agent.price,
    }


@router.get("/me/credits")
def get_my_credits(
    current_user: User = Depends(get_current_active_user),
) -> Any:
    return {"credits": current_user.credits, "email": current_user.email}


@router.post("/agents/{agent_id}/rate", response_model=AgentRatingPublic)
def rate_agent(
    agent_id: int,
    rating_in: AgentRatingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Rate a published agent (1-5 stars + optional review). One rating per user per agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.is_published == True).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Published agent not found")

    existing = (
        db.query(AgentRating)
        .filter(AgentRating.agent_id == agent_id, AgentRating.user_id == current_user.id)
        .first()
    )
    if existing:
        existing.rating = rating_in.rating
        existing.review = rating_in.review
        db.commit()
        db.refresh(existing)
        result = AgentRatingPublic.model_validate(existing)
        result.user_email = current_user.email
        return result

    rating = AgentRating(
        agent_id=agent_id,
        user_id=current_user.id,
        rating=rating_in.rating,
        review=rating_in.review,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    result = AgentRatingPublic.model_validate(rating)
    result.user_email = current_user.email
    return result


@router.get("/agents/{agent_id}/ratings", response_model=List[AgentRatingPublic])
def list_agent_ratings(
    agent_id: int,
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
) -> Any:
    """List ratings for a published agent."""
    ratings = (
        db.query(AgentRating)
        .filter(AgentRating.agent_id == agent_id)
        .order_by(AgentRating.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    result = []
    for r in ratings:
        data = AgentRatingPublic.model_validate(r)
        if r.user:
            data.user_email = r.user.email
        result.append(data)
    return result


@router.get("/agents/{agent_id}/rating-summary")
def get_rating_summary(
    agent_id: int,
    db: Session = Depends(get_db),
) -> Any:
    """Get average rating and count for an agent."""
    from sqlalchemy import func
    stats = (
        db.query(
            func.avg(AgentRating.rating).label("avg"),
            func.count(AgentRating.id).label("count"),
        )
        .filter(AgentRating.agent_id == agent_id)
        .first()
    )
    return {
        "average_rating": float(stats.avg) if stats.avg else None,
        "rating_count": stats.count or 0,
    }
