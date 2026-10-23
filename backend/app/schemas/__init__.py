from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field


# User schemas
class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None


class UserInDB(UserBase):
    id: int
    is_active: bool
    is_superuser: bool
    credits: int = 1000
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserPublic(UserInDB):
    pass


# Auth schemas
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: Optional[int] = None


# Execution / autonomy constants
AUTONOMY_LEVELS = ("supervised", "semi_autonomous", "autonomous")


class AdvancedConfig(BaseModel):
    """Runtime behavior toggles for the agent loop."""
    planning_enabled: bool = False  # inject long-horizon plan-then-act directive
    reflection_enabled: bool = False  # Reflexion-style self-check before finishing
    max_reflections: int = Field(default=2, ge=0, le=3)
    # Structured outputs (JSON Schema enforced final answer)
    structured_output_enabled: bool = False
    output_schema: Optional[Dict[str, Any]] = None
    # Function calling reliability
    tool_choice: str = Field(default="auto")  # auto | required | none
    max_tool_retries: int = Field(default=1, ge=0, le=3)


# Agent schemas
class AgentBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    system_prompt: str = "You are a helpful AI assistant."
    model_name: str = "gemini-2.5-flash"
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    tools_config: List[Dict[str, Any]] = Field(default_factory=list)
    memory_config: Dict[str, Any] = Field(default_factory=dict)
    workflow_config: Dict[str, Any] = Field(default_factory=dict)
    # Execution / autonomy
    max_steps: int = Field(default=25, ge=3, le=200)
    autonomy_level: str = Field(default="supervised")
    sandbox_enabled: bool = False
    advanced_config: Dict[str, Any] = Field(default_factory=dict)
    # Marketplace
    is_public: bool = False
    is_published: bool = False
    price: int = Field(default=0, ge=0)

    from pydantic import field_validator

    @field_validator("autonomy_level")
    @classmethod
    def _validate_autonomy(cls, v: str) -> str:
        if v not in AUTONOMY_LEVELS:
            raise ValueError(f"autonomy_level must be one of {AUTONOMY_LEVELS}")
        return v

    @field_validator("advanced_config", mode="before")
    @classmethod
    def _coerce_advanced(cls, v: Any) -> Dict[str, Any]:
        return AdvancedConfig(**(v or {})).model_dump()


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    tools_config: Optional[List[Dict[str, Any]]] = None
    memory_config: Optional[Dict[str, Any]] = None
    workflow_config: Optional[Dict[str, Any]] = None
    max_steps: Optional[int] = Field(default=None, ge=3, le=200)
    autonomy_level: Optional[str] = None
    sandbox_enabled: Optional[bool] = None
    advanced_config: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None
    is_published: Optional[bool] = None
    price: Optional[int] = None


class AgentInDB(AgentBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AgentPublic(AgentInDB):
    owner_email: Optional[str] = None


# Agent Run schemas
class AgentRunCreate(BaseModel):
    input: str


class AgentRunPublic(BaseModel):
    id: int
    agent_id: int
    user_id: int
    input: str
    output: Optional[str] = None
    messages: Optional[List[Dict[str, Any]]] = None  # serialized events / message history for visualization
    status: str
    error: Optional[str] = None
    latency_ms: Optional[int] = None
    steps_count: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
    thread_id: Optional[str] = None  # multi-turn conversation thread
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RunRequest(BaseModel):
    input: str
    thread_id: Optional[str] = None  # for memory/conversation continuity


class RunResponse(BaseModel):
    output: str
    agent_id: int
    run_id: Optional[int] = None
    thread_id: Optional[str] = None  # returned so client can continue the conversation
    confidence: Optional[float] = None  # self-estimated completion confidence (0-1)
    latency_ms: Optional[int] = None
    steps_count: Optional[int] = None
    usage: Optional[Dict[str, Any]] = None  # input_tokens, output_tokens, total_tokens, estimated_cost_usd


class EvaluateRequest(BaseModel):
    input: str
    criteria: Optional[str] = "helpfulness, accuracy, and clarity"
    expected_output: Optional[str] = None


class EvaluateResponse(BaseModel):
    score: float
    explanation: str
    agent_output: str
    criteria_scores: Optional[Dict[str, Any]] = None


class BatchEvaluateRequest(BaseModel):
    inputs: List[str]
    criteria: Optional[str] = "helpfulness, accuracy, and clarity"


class BatchEvaluateItem(BaseModel):
    input: str
    score: float
    explanation: str
    agent_output: str


class BatchEvaluateResponse(BaseModel):
    results: List[BatchEvaluateItem]
    average_score: float
    count: int


class AgentEvaluationPublic(BaseModel):
    id: int
    agent_id: int
    user_id: int
    input: str
    agent_output: Optional[str] = None
    score: float
    explanation: Optional[str] = None
    criteria: Optional[str] = None
    criteria_scores: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class EvaluationSummary(BaseModel):
    count: int
    average_score: float
    recent: List[AgentEvaluationPublic]


# Versioning schemas
class AgentVersionBase(BaseModel):
    version_number: int
    name: str
    description: Optional[str] = None
    system_prompt: str
    model_name: str
    temperature: float
    tools_config: List[Dict[str, Any]]
    memory_config: Dict[str, Any]
    workflow_config: Dict[str, Any]
    max_steps: Optional[int] = None
    autonomy_level: Optional[str] = None
    sandbox_enabled: Optional[bool] = None
    advanced_config: Dict[str, Any] = Field(default_factory=dict)
    change_note: Optional[str] = None


class AgentVersionPublic(AgentVersionBase):
    id: int
    agent_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class AgentVersionCreate(BaseModel):
    change_note: Optional[str] = "Manual snapshot"


# Marketplace Rating schemas
class AgentRatingCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    review: Optional[str] = None


class AgentRatingPublic(BaseModel):
    id: int
    agent_id: int
    user_id: int
    rating: int
    review: Optional[str] = None
    created_at: datetime
    user_email: Optional[str] = None

    class Config:
        from_attributes = True


class AgentWithRating(AgentPublic):
    average_rating: Optional[float] = None
    rating_count: int = 0
    # Marketplace entitlements: paid agents must be purchased before cloning
    purchased: bool = False
    clonable: bool = False


# Credit ledger schemas
class CreditTransactionPublic(BaseModel):
    id: int
    user_id: int
    amount: int
    balance_after: int
    reason: str
    counterparty_user_id: Optional[int] = None
    agent_id: Optional[int] = None
    reference_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Dashboard / user stats schemas
class RecentRunItem(BaseModel):
    id: int
    agent_id: int
    input: str
    status: str
    latency_ms: Optional[int] = None
    steps_count: Optional[int] = None
    total_tokens: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
    created_at: datetime


class AgentStatsItem(BaseModel):
    id: int
    name: str
    is_published: bool
    price: int
    run_count: int = 0


class UserStats(BaseModel):
    agents_count: int = 0
    published_count: int = 0
    runs_count: int = 0
    completed_runs: int = 0
    success_rate: float = 0.0
    avg_latency_ms: Optional[float] = None
    avg_steps: Optional[float] = None
    evaluations_count: int = 0
    avg_evaluation_score: Optional[float] = None
    credits: int = 0
    earnings: int = 0  # credits received from agent sales
    spend: int = 0  # credits spent on purchases + run metering
    # Token usage & cost observability
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    total_estimated_cost_usd: float = 0.0
    avg_cost_per_run: Optional[float] = None
    agents: List[AgentStatsItem] = Field(default_factory=list)
    recent_runs: List[RecentRunItem] = Field(default_factory=list)


# Leaderboard (marketplace ranking)
class LeaderboardEntry(BaseModel):
    rank: int
    agent_id: int
    agent_name: str
    description: Optional[str] = None
    owner_email: str
    model_name: str
    price: int = 0
    sandbox_enabled: bool = False
    autonomy_level: str = "supervised"
    avg_rating: Optional[float] = None
    rating_count: int = 0
    run_count: int = 0
    sales_count: int = 0
    score: float = 0.0


# API Key schemas
class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    agent_id: Optional[int] = None  # restrict to specific agent if set
    scopes: List[str] = Field(default_factory=lambda: ["run"])
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=365)


class ApiKeyPublic(BaseModel):
    id: int
    name: str
    key_prefix: str
    agent_id: Optional[int] = None
    scopes: List[str] = Field(default_factory=list)
    is_active: bool
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ApiKeyCreateResponse(ApiKeyPublic):
    """Returned only on creation — includes the raw key once."""
    raw_key: str


# MCP Server Registry schemas
class MCPServerBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    config: Dict[str, Any]  # transport, command/args or url, headers, etc.
    logo_slug: Optional[str] = None  # catalog icon key (e.g. "github")
    category: Optional[str] = None
    is_public: bool = False


class MCPServerCreate(MCPServerBase):
    pass


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    logo_slug: Optional[str] = None
    category: Optional[str] = None
    is_public: Optional[bool] = None


class MCPTestResult(BaseModel):
    server_id: int = 0
    healthy: bool
    tool_count: int = 0
    tools: List[str] = Field(default_factory=list)
    error: Optional[str] = None
    checked_at: datetime


class MCPTestRequest(BaseModel):
    """Ad-hoc connection test for an unsaved config (Test → Connect flow)."""
    config: Dict[str, Any]


class MCPServerPublic(MCPServerBase):
    id: int
    owner_id: int
    last_status: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# BYOK provider keys
class ProviderKeyCreate(BaseModel):
    provider: str = Field(pattern="^(gemini|openai|anthropic|custom)$")
    api_key: str = Field(min_length=8)
    label: Optional[str] = None
    base_url: Optional[str] = None  # for custom / Ollama-compatible endpoints


class ProviderKeyPublic(BaseModel):
    id: int
    provider: str
    label: Optional[str] = None
    base_url: Optional[str] = None
    api_key_masked: str
    created_at: datetime
