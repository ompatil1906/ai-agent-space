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
    memory_config = Column(JSON, default=dict)  # memory settings e.g. {"enabled": true, "max_messages": 20, ...}
    workflow_config = Column(JSON, default=dict)  # multi-agent: {"type": "single|sequential|supervisor", ...}

    # --- Execution / autonomy (Devin-inspired runtime controls) ---
    max_steps = Column(Integer, default=25)  # hard cap on runtime iterations (maps to LangGraph recursion_limit)
    autonomy_level = Column(String, default="supervised")  # supervised | semi_autonomous | autonomous
    sandbox_enabled = Column(Boolean, default=False)  # expose sandboxed code/terminal/file tools to the agent
    advanced_config = Column(JSON, default=dict)  # {"planning_enabled": bool, "reflection_enabled": bool, "max_reflections": int}

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
    # --- Observability metrics ---
    latency_ms = Column(Integer, nullable=True)  # wall-clock duration of the run
    steps_count = Column(Integer, nullable=True)  # tool calls + agent steps observed in the trace
    input_tokens = Column(Integer, nullable=True, default=0)
    output_tokens = Column(Integer, nullable=True, default=0)
    total_tokens = Column(Integer, nullable=True, default=0)
    estimated_cost_usd = Column(Float, nullable=True, default=0.0)  # rough estimate based on model pricing
    thread_id = Column(String, index=True, nullable=True)  # LangGraph checkpointer thread for multi-turn memory
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


class AgentEvaluation(Base):
    """Persisted evaluation results (LLM-as-judge) for agents."""
    __tablename__ = "agent_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    input = Column(Text, nullable=False)
    agent_output = Column(Text, nullable=True)
    score = Column(Float, nullable=False)  # 1-10
    explanation = Column(Text, nullable=True)
    criteria = Column(String, nullable=True)
    criteria_scores = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    agent = relationship("Agent", back_populates="evaluations")
    user = relationship("User", back_populates="evaluations")


class ToolApproval(Base):
    """Persistent human-in-the-loop tool approval requests.
    
    Enables multi-process / restart-safe approvals. The runtime polls this table
    while waiting; the API updates the status when the user decides.
    """
    __tablename__ = "tool_approvals"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    thread_id = Column(String, nullable=True, index=True)
    tool_name = Column(String, nullable=False)
    tool_args = Column(JSON, nullable=True)
    status = Column(String, default="pending", nullable=False)  # pending | approved | denied | expired
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    user = relationship("User")
    agent = relationship("Agent")


    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)  # positive = credit received, negative = credit spent
    balance_after = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # agent_sale | agent_purchase | run_meter | admin_grant
    counterparty_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    reference_id = Column(String, nullable=True)  # run id / purchase group id
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id], remote_side=[User.id])


# Relationships registered after class definitions (keeps import order safe)
User.ratings = relationship("AgentRating", back_populates="user", cascade="all, delete-orphan")
User.evaluations = relationship("AgentEvaluation", back_populates="user", cascade="all, delete-orphan")
User.transactions = relationship(
    "CreditTransaction", foreign_keys="CreditTransaction.user_id", back_populates="user"
)
Agent.ratings = relationship("AgentRating", back_populates="agent", cascade="all, delete-orphan")
Agent.evaluations = relationship("AgentEvaluation", back_populates="agent", cascade="all, delete-orphan")
Agent.transactions = relationship(
    "CreditTransaction", foreign_keys="CreditTransaction.agent_id", back_populates="agent", viewonly=True
)
CreditTransaction.user = relationship(
    "User", foreign_keys="CreditTransaction.user_id", back_populates="transactions"
)
CreditTransaction.agent = relationship(
    "Agent", foreign_keys="CreditTransaction.agent_id", back_populates="transactions", viewonly=True
)


class ApiKey(Base):
    """API keys for programmatic / external access to agents."""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # human-readable label
    key_prefix = Column(String, nullable=False, index=True)  # first 8 chars for display
    key_hash = Column(String, nullable=False, unique=True, index=True)  # bcrypt or sha256 of full key
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True, index=True)  # optional restriction to one agent
    scopes = Column(JSON, default=list)  # e.g. ["run", "read"]
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="api_keys")
    agent = relationship("Agent")


# Register relationship
User.api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")
