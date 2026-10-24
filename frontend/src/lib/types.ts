/**
 * Frontend mirrors of the backend response schemas (backend/app/schemas/__init__.py).
 * Keep field names identical to the wire format. Money is always integer minor units.
 */

export interface PricingPlanPublic {
  id: number;
  agent_id: number;
  is_active: boolean;
  created_at: string;
  model: "free" | "one_time" | "subscription" | "pay_per_execution";
  currency: string;
  amount_minor: number;
  billing_interval?: "month" | "year" | null;
  runs_per_pack?: number | null;
  limits?: Record<string, unknown> | null;
}

export interface PublicAgent {
  id: number;
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  model_name: string;
  temperature: number;
  price: number; // legacy credits, deprecated
  avatar_url?: string | null;
  cover_image_url?: string | null;
  category_id?: number | null;
  category_slug?: string | null;
  category_name?: string | null;
  tags: string[];
  features: string[];
  status: string;
  is_featured: boolean;
  view_count: number;
  sandbox_enabled: boolean;
  autonomy_level: string;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  owner_id: number;
  owner_email?: string | null;
  owner_display_name?: string | null;
  pricing?: PricingPlanPublic | null;
  average_rating?: number | null;
  rating_count: number;
  run_count: number;
  sales_count: number;
  purchased?: boolean;
  owned_by_viewer?: boolean;
}

export interface ExamplePrompt {
  title?: string | null;
  prompt: string;
  sample_output?: string | null;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface RatingPublic {
  id: number;
  rating: number;
  review?: string | null;
  verified_purchase: boolean;
  created_at: string;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface RatingSummary {
  /** Backend returns `average_rating` / `rating_count` (marketplace.py). */
  average_rating: number | null;
  rating_count: number;
}

export interface PublicAgentDetail extends PublicAgent {
  problem_statement?: string | null;
  use_cases: string[];
  target_audience?: string | null;
  example_prompts: ExamplePrompt[];
  faqs: FAQItem[];
  usage_instructions?: string | null;
  refund_window_days?: number | null;
  version_count: number;
  latest_version?: string | null;
  tools_count: number;
  workflow_type: string;
}

export interface CategoryPublic {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
}

export interface UserPublic {
  id: number;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  is_superuser?: boolean;
  role: "customer" | "creator" | "admin";
  credits: number;
  created_at: string;
  updated_at?: string | null;
}

/* ------------------------------------------------------------- purchases */

export interface EntitlementPublic {
  id: number;
  agent_id: number;
  agent_name?: string | null;
  agent_slug?: string | null;
  agent_status?: string | null;
  avatar_url?: string | null;
  source: string; // one_time | subscription | pay_per_pack | pay_per_execution | free | admin_grant
  status: string; // active | expired | cancelled | revoked
  runs_remaining?: number | null;
  valid_until?: string | null;
  created_at?: string | null;
}

export interface PurchasePublic {
  id: number;
  reference: string;
  agent_id?: number | null;
  agent_name?: string | null;
  agent_slug?: string | null;
  pricing_model: string;
  currency: string;
  amount_minor: number;
  platform_fee_minor?: number;
  creator_earnings_minor?: number;
  runs_included?: number | null;
  status: string; // paid | pending | failed | partially_refunded | refunded | ...
  payment_provider?: string | null;
  provider_mode?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  refunded_minor?: number;
  receipt_number?: string | null;
}

export interface SubscriptionPublic {
  id: number;
  agent_id: number;
  plan_id?: number | null;
  agent_name?: string | null;
  agent_slug?: string | null;
  provider?: string | null;
  provider_subscription_id?: string | null;
  status: string; // active | cancelled | expired | past_due
  interval?: string | null;
  currency: string;
  amount_minor: number;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancelled_at?: string | null;
}

/* --------------------------------------------------------------- creator */

export interface CreatorProfilePublic {
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  website_url?: string | null;
  payout_currency?: string | null;
  payout_account_name?: string | null;
  payout_account_number?: string | null;
  payout_ifsc?: string | null;
  payout_vpa?: string | null;
  onboarding_status: "unverified" | "pending" | "verified";
  is_verified: boolean;
}

export interface LedgerEntryPublic {
  id: number;
  entry_type: "sale" | "refund_reversal" | "payout" | "fee_correction";
  amount_minor: number;
  balance_after_minor: number;
  currency?: string;
  purchase_id?: number | null;
  refund_id?: number | null;
  payout_id?: number | null;
  agent_id?: number | null;
  agent_name?: string | null;
  reference?: string | null;
  created_at: string;
}

export interface PayoutHistoryPublic {
  id: number;
  reference: string;
  amount_minor: number;
  currency: string;
  status: "requested" | "processing" | "paid" | "failed" | "cancelled";
  provider?: string | null;
  destination?: string | null;
  failure_reason?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface PayoutSummaryPublic {
  available_balance_minor: number;
  pending_payouts_minor: number;
  lifetime_earnings_minor: number;
  lifetime_payouts_minor: number;
  min_payout_minor: number;
  currency: string;
}

/* ----------------------------------------------------------------- admin */

export interface AdminAgentRow extends PublicAgent {
  moderation_note?: string | null;
  owner_email?: string | null;
}

export interface AuditLogPublic {
  id: number;
  actor_id?: number | null;
  actor_email?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: number | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

/* ----------------------------------------------------------------- account */

/** One row of `recent_runs` from GET /users/me/stats (subset of AgentRunPublic). */
export interface RecentRunItem {
  id: number;
  agent_id: number;
  input: string;
  status: string;
  latency_ms?: number | null;
  steps_count?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd?: number | null;
  created_at: string;
}

/** One row of `agents` from GET /users/me/stats. */
export interface AgentStatsItem {
  id: number;
  name: string;
  is_published: boolean;
  price: number; // legacy credits, deprecated
  run_count: number;
}

/** Aggregates behind GET /users/me/stats — dashboard overview. */
export interface UserStats {
  agents_count: number;
  published_count: number;
  runs_count: number;
  completed_runs: number;
  success_rate: number;
  avg_latency_ms?: number | null;
  avg_steps?: number | null;
  evaluations_count: number;
  avg_evaluation_score?: number | null;
  // money stats (minor units + currency)
  currency: string;
  spent_minor: number;
  purchases_count: number;
  entitlements_count: number;
  active_subscriptions: number;
  // legacy credit-accounting fields (no longer written by marketplace flows)
  credits?: number;
  earnings?: number;
  spend?: number;
  // token usage & cost observability
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_estimated_cost_usd: number;
  avg_cost_per_run?: number | null;
  agents: AgentStatsItem[];
  recent_runs: RecentRunItem[];
}

/* ---------------------------------------------------------------- api keys */

export interface ApiKeyPublic {
  id: number;
  name: string;
  key_prefix: string;
  agent_id?: number | null;
  scopes: string[];
  is_active: boolean;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
}

/** Returned only by POST /api-keys/ — includes the raw key exactly once. */
export interface ApiKeyCreateResponse extends ApiKeyPublic {
  raw_key: string;
}

/* -------------------------------------------------------------- run data */

export interface AgentRunPublic {
  id: number;
  agent_id: number;
  user_id: number;
  input: string;
  output?: string | null;
  messages?: Array<Record<string, unknown>> | null;
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  error?: string | null;
  latency_ms?: number | null;
  steps_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd?: number | null;
  thread_id?: string | null;
  mode?: string | null;
  title?: string | null;
  created_at?: string;
}
