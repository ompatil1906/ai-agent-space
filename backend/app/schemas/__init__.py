from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


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
    role: str = "customer"
    credits: int = 1000  # legacy, no longer used by marketplace flows
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
PRICING_MODELS = ("free", "one_time", "subscription", "pay_per_execution")
AGENT_STATUSES = ("draft", "pending_review", "published", "rejected", "suspended")


class ExamplePrompt(BaseModel):
    title: Optional[str] = None
    prompt: str
    sample_output: Optional[str] = None


class FAQItem(BaseModel):
    question: str
    answer: str


class PricingPlanIn(BaseModel):
    model: str = Field(default="free")
    currency: str = Field(default="INR", max_length=3)
    amount_minor: int = Field(default=0, ge=0)
    billing_interval: Optional[str] = Field(default=None, pattern="^(month|year)$")
    runs_per_pack: Optional[int] = Field(default=None, ge=1)
    limits: Dict[str, Any] = Field(default_factory=dict)


class PricingPlanPublic(PricingPlanIn):
    id: int
    agent_id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


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
    # Marketplace visibility (legacy flags kept in sync with status)
    is_public: bool = False
    is_published: bool = False
    price: int = Field(default=0, ge=0)  # legacy credit price (deprecated)
    # --- Public listing ---
    slug: Optional[str] = None
    tagline: Optional[str] = Field(default=None, max_length=200)
    avatar_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    category_id: Optional[int] = None
    tags: List[str] = Field(default_factory=list)
    problem_statement: Optional[str] = None
    features: List[str] = Field(default_factory=list)
    use_cases: List[str] = Field(default_factory=list)
    target_audience: Optional[str] = None
    example_prompts: List[ExamplePrompt] = Field(default_factory=list)
    faqs: List[FAQItem] = Field(default_factory=list)
    usage_instructions: Optional[str] = None
    refund_window_days: Optional[int] = Field(default=None, ge=0, le=365)

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

    # Legacy/seeded rows may store NULL in JSON columns — coerce to the declared
    # empty default instead of failing response validation.
    @field_validator(
        "tools_config",
        "tags",
        "features",
        "use_cases",
        "example_prompts",
        "faqs",
        mode="before",
    )
    @classmethod
    def _empty_list_not_null(cls, v: Any) -> Any:
        return v or []

    @field_validator("memory_config", "workflow_config", mode="before")
    @classmethod
    def _empty_dict_not_null(cls, v: Any) -> Any:
        return v or {}


class AgentListingIn(BaseModel):
    """Listing/profile fields settable by the creator (excludes runtime config)."""
    name: Optional[str] = Field(default=None, max_length=200)
    tagline: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    problem_statement: Optional[str] = None
    features: Optional[List[str]] = None
    use_cases: Optional[List[str]] = None
    target_audience: Optional[str] = None
    example_prompts: Optional[List[ExamplePrompt]] = None
    faqs: Optional[List[FAQItem]] = None
    usage_instructions: Optional[str] = None
    refund_window_days: Optional[int] = Field(default=None, ge=0, le=365)
    avatar_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    category_id: Optional[int] = None
    tags: Optional[List[str]] = None


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
    # Listing fields
    slug: Optional[str] = None
    tagline: Optional[str] = None
    avatar_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    category_id: Optional[int] = None
    tags: Optional[List[str]] = None
    problem_statement: Optional[str] = None
    features: Optional[List[str]] = None
    use_cases: Optional[List[str]] = None
    target_audience: Optional[str] = None
    example_prompts: Optional[List[ExamplePrompt]] = None
    faqs: Optional[List[FAQItem]] = None
    usage_instructions: Optional[str] = None
    refund_window_days: Optional[int] = None


class AgentInDB(AgentBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AgentPublic(AgentInDB):
    """Full agent payload — owner/entitled views only (includes private prompts)."""
    owner_email: Optional[str] = None
    status: str = "draft"
    published_at: Optional[datetime] = None
    pricing: Optional[PricingPlanPublic] = None


class PublicAgent(BaseModel):
    """Public listing card — safe to expose to unauthenticated visitors.
    Deliberately EXCLUDES system_prompt/tools/memory/advanced config."""
    id: int
    slug: str
    name: str
    tagline: Optional[str] = None
    description: Optional[str] = None
    model_name: str
    temperature: float = 0.7
    price: int = 0  # legacy credit price (deprecated) — use pricing
    avatar_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    category_id: Optional[int] = None
    category_slug: Optional[str] = None
    category_name: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    features: List[str] = Field(default_factory=list)
    status: str = "published"
    is_featured: bool = False
    view_count: int = 0
    sandbox_enabled: bool = False
    autonomy_level: str = "supervised"
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None
    # creator info
    owner_id: int
    owner_email: Optional[str] = None
    owner_display_name: Optional[str] = None
    # pricing
    pricing: Optional[PricingPlanPublic] = None
    # social proof
    average_rating: Optional[float] = None
    rating_count: int = 0
    run_count: int = 0
    sales_count: int = 0
    # viewer-specific entitlement flags (only when authenticated)
    purchased: bool = False
    owned_by_viewer: bool = False

    @field_validator("tags", "features", mode="before")
    @classmethod
    def _empty_list_not_null(cls, v):  # legacy rows may store NULL in JSON columns
        return v or []

    class Config:
        from_attributes = True


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
    mode: str = "chat"  # chat | automation (Devin-style direct task)
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RunRequest(BaseModel):
    input: str
    thread_id: Optional[str] = None  # for memory/conversation continuity
    client_request_id: Optional[str] = None  # idempotency key for run retries (no double charge)


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

    @field_validator("tools_config", mode="before")
    @classmethod
    def _empty_list_not_null(cls, v: Any) -> Any:
        return v or []

    @field_validator(
        "memory_config", "workflow_config", "advanced_config", mode="before"
    )
    @classmethod
    def _empty_dict_not_null(cls, v: Any) -> Any:
        return v or {}


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
    """Legacy internal listing view (owner-gated data, not for anonymous use)."""
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
    # --- money stats (minor units + currency) ---
    currency: str = "INR"
    spent_minor: int = 0              # total money spent on purchases (paid)
    purchases_count: int = 0
    entitlements_count: int = 0
    active_subscriptions: int = 0
    # legacy credit-accounting fields (no longer written by marketplace flows)
    credits: int = 0
    earnings: int = 0
    spend: int = 0
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


class AgentTaskCreate(BaseModel):
    """Devin-style direct automation: one unattended task for an agent."""
    title: str = Field(min_length=1, max_length=200)
    input: str
    client_request_id: Optional[str] = None  # idempotency key (no double charge on retries)


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

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Real-money marketplace schemas
# ---------------------------------------------------------------------------

class PublicAgentDetail(PublicAgent):
    """Full public landing-page payload for a published agent."""
    problem_statement: Optional[str] = None
    use_cases: List[str] = Field(default_factory=list)
    target_audience: Optional[str] = None
    example_prompts: List[ExamplePrompt] = Field(default_factory=list)
    faqs: List[FAQItem] = Field(default_factory=list)
    usage_instructions: Optional[str] = None
    refund_window_days: Optional[int] = None
    version_count: int = 0
    latest_version: Optional[str] = None
    tools_count: int = 0
    workflow_type: str = "single"

    @field_validator("use_cases", "example_prompts", "faqs", mode="before")
    @classmethod
    def _empty_lists_not_null(cls, v):  # legacy rows may store NULL in JSON columns
        return v or []


class CategoryPublic(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str] = None


class AgentRatingPublic(BaseModel):
    id: int
    agent_id: int
    user_id: int
    rating: int
    review: Optional[str] = None
    verified_purchase: bool = False
    created_at: datetime
    user_email: Optional[str] = None
    user_display_name: Optional[str] = None

    class Config:
        from_attributes = True


# --- Checkout ----------------------------------------------------------------

class CheckoutIntentRequest(BaseModel):
    agent_id: int
    plan_id: Optional[int] = None  # when the agent has multiple plans; default: active plan


class CheckoutIntentResponse(BaseModel):
    mode: str                       # free | paid | unconfigured
    payment_approved: Optional[bool] = None  # True when message is meaningful
    provider: Optional[str] = None
    provider_mode: Optional[str] = None  # test | live
    order_id: Optional[str] = None       # provider order id (paid)
    razorpay_key_id: Optional[str] = None  # public key id only, safe for frontend
    purchase_reference: Optional[str] = None
    agent_slug: Optional[str] = None
    name: Optional[str] = None
    pricing: Optional[dict] = None
    message: Optional[str] = None


class VerifyCheckoutRequest(BaseModel):
    purchase_reference: str
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


class VerifyCheckoutResponse(BaseModel):
    status: str  # paid | failed | already_paid | pending
    message: Optional[str] = None
    purchase_reference: Optional[str] = None
    agent_slug: Optional[str] = None
    redirect_to: Optional[str] = None


class CheckoutStatusResponse(VerifyCheckoutResponse):
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    provider_mode: Optional[str] = None
    pricing: Optional[dict] = None


# --- Purchases / entitlements / subscriptions ---------------------------------

class PurchasePublic(BaseModel):
    id: int
    reference: str
    agent_id: int
    pricing_model: str
    currency: str
    amount_minor: int
    platform_fee_minor: int = 0
    creator_earnings_minor: int = 0
    runs_included: Optional[int] = None
    status: str
    created_at: datetime
    paid_at: Optional[datetime] = None
    refunded_minor: int = 0
    receipt_number: Optional[str] = None
    # optional denormalized details
    agent_name: Optional[str] = None
    agent_slug: Optional[str] = None
    provider_mode: Optional[str] = None

    class Config:
        from_attributes = True


class EntitlementPublic(BaseModel):
    id: int
    agent_id: int
    source: str
    status: str
    runs_remaining: Optional[int] = None
    valid_until: Optional[datetime] = None
    created_at: datetime
    # join data
    agent_name: Optional[str] = None
    agent_slug: Optional[str] = None
    agent_status: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class SubscriptionPublic(BaseModel):
    id: int
    agent_id: int
    plan_id: Optional[int] = None
    provider: Optional[str] = None
    provider_subscription_id: Optional[str] = None
    status: str
    interval: Optional[str] = None
    currency: str
    amount_minor: int
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    agent_name: Optional[str] = None
    agent_slug: Optional[str] = None

    class Config:
        from_attributes = True


# --- Creator ------------------------------------------------------------------

class CreatorProfileIn(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    website_url: Optional[str] = None
    payout_currency: Optional[str] = None
    payout_account_name: Optional[str] = None
    payout_account_number: Optional[str] = None
    payout_ifsc: Optional[str] = None
    payout_vpa: Optional[str] = None


class CreatorProfilePublic(CreatorProfileIn):
    id: int
    user_id: int
    user_email: Optional[str] = None
    onboarding_status: str
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CreatorOverviewResponse(BaseModel):
    gross_sales_minor: int = 0
    platform_fees_minor: int = 0
    net_earnings_minor: int = 0
    refund_reversals_total_minor: int = 0
    ledger_balance_minor: int = 0
    pending_payout_minor: int = 0
    available_to_payout_minor: int = 0
    total_paid_out_minor: int = 0
    currency: str
    total_sales: int = 0
    active_subscriptions: int = 0
    published_agents: int = 0
    customers: int = 0
    monthly_series: List[dict] = Field(default_factory=list)
    per_agent: List[dict] = Field(default_factory=list)


class LedgerEntryPublic(BaseModel):
    id: int
    entry_type: str
    amount_minor: int
    currency: str
    balance_after_minor: int
    purchase_id: Optional[int] = None
    agent_id: Optional[int] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PayoutRequestIn(BaseModel):
    amount_minor: int = Field(ge=1)
    currency: Optional[str] = None


class PayoutPublic(BaseModel):
    id: int
    reference: str
    amount_minor: int
    currency: str
    status: str
    provider: Optional[str] = None
    provider_payout_id: Optional[str] = None
    failure_reason: Optional[str] = None
    requested_at: datetime
    processed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Admin --------------------------------------------------------------------

class AdminAgentStatusIn(BaseModel):
    status: str = Field(pattern="^(approved|rejected|published|pending_review|suspended|draft|featured|unfeatured)$")
    note: Optional[str] = None


class AdminPayoutActionIn(BaseModel):
    action: str = Field(pattern="^(mark_processing|mark_paid|mark_failed|cancel)$")
    provider_payout_id: Optional[str] = None
    note: Optional[str] = None


class AdminRefundIn(BaseModel):
    purchase_reference: Optional[str] = None
    amount_minor: Optional[int] = None
    reason: Optional[str] = None
    type: str = Field(default="refund", pattern="^(refund|chargeback)$")


class PlatformSettingsPublic(BaseModel):
    commission_bps: int
    currency: str
    min_payout_minor: int
    moderation: str
    payment_mode: Optional[str] = None
    payments_enabled: bool = False


class PlatformSettingsUpdate(BaseModel):
    commission_bps: Optional[int] = Field(default=None, ge=0, le=5000)
    min_payout_minor: Optional[int] = Field(default=None, ge=0)
    moderation: Optional[str] = Field(default=None, pattern="^(off|manual)$")


class ModerationReportIn(BaseModel):
    """Buyer-submitted report against a published listing."""
    reason: str = Field(min_length=1, max_length=100)
    details: Optional[str] = Field(default=None, max_length=2000)


class ModerationReportPublic(BaseModel):
    id: int
    agent_id: int
    reporter_id: Optional[int] = None
    reason: str
    details: Optional[str] = None
    status: str
    created_at: datetime
    resolution_note: Optional[str] = None

    class Config:
        from_attributes = True


class AuditLogPublic(BaseModel):
    id: int
    actor_id: Optional[int] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    details: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True
