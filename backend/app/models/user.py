from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    credits = Column(Integer, default=1000)  # marketplace credits
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agents = relationship("Agent", back_populates="owner", cascade="all, delete-orphan")
    runs = relationship("AgentRun", back_populates="user", cascade="all, delete-orphan")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False, default="You are a helpful AI assistant.")
    model_name = Column(String, default="gpt-4o-mini")
    temperature = Column(Float, default=0.7)
    tools_config = Column(JSON, default=list)  # list of tool configs / MCP server URLs or configs
    memory_config = Column(JSON, default=dict)  # memory settings e.g. {"enabled": true, "thread_id": "..."}
    workflow_config = Column(JSON, default=dict)  # multi-agent: {"type": "single|sequential|supervisor", "sub_agents": [...]}
    is_public = Column(Boolean, default=False)
    is_published = Column(Boolean, default=False)
    price = Column(Integer, default=0)  # in cents or credits
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="agents")
    runs = relationship("AgentRun", back_populates="agent", cascade="all, delete-orphan")
    versions = relationship(
        "AgentVersion",
        back_populates="agent",
        cascade="all, delete-orphan",
        order_by="AgentVersion.version_number.desc()",
    )


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    input = Column(Text, nullable=False)
    output = Column(Text, nullable=True)
    messages = Column(JSON, default=list)  # serialized messages for history
    status = Column(String, default="completed")  # pending, running, completed, error
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agent = relationship("Agent", back_populates="runs")
    user = relationship("User", back_populates="runs")


class AgentVersion(Base):
    __tablename__ = "agent_versions"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False)
    model_name = Column(String)
    temperature = Column(Float)
    tools_config = Column(JSON, default=list)
    memory_config = Column(JSON, default=dict)
    workflow_config = Column(JSON, default=dict)
    snapshot = Column(JSON)  # full snapshot for easy restore
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    change_note = Column(String, nullable=True)

    agent = relationship("Agent", back_populates="versions")


class AgentRating(Base):
    """Marketplace ratings for published agents."""
    __tablename__ = "agent_ratings"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)  # 1-5
    review = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agent = relationship("Agent", back_populates="ratings")
    user = relationship("User", back_populates="ratings")


# Add relationships to existing models
User.ratings = relationship("AgentRating", back_populates="user", cascade="all, delete-orphan")
Agent.ratings = relationship("AgentRating", back_populates="agent", cascade="all, delete-orphan")
