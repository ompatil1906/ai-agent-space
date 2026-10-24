from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "AI Agent Space"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days
    DATABASE_URL: str = "sqlite:///./sql_app.db"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = ""  # Optional: for Ollama, LM Studio, vLLM, etc. (e.g. http://localhost:11434/v1)
    ANTHROPIC_API_KEY: str = ""
    # Platform default LLM provider: Gemini. Configured via GEMINI_API_KEY env var or .env.
    # Users can override per provider with their own keys (Settings → API Keys).
    GEMINI_API_KEY: str = ""
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    DEFAULT_MODEL_NAME: str = "gemini-3.5-flash-lite"
    CORS_ORIGINS: str = "*"

    # --- Sandbox execution (Docker-based secure code execution) ---
    # SANDBOX_MODE: "docker" | "local" | "auto"
    #   docker: always use Docker containers (recommended/production)
    #   local: direct subprocess execution (dev convenience, NOT isolated)
    #   auto: use Docker when the daemon is reachable, else fall back to local
    SANDBOX_MODE: str = "auto"
    SANDBOX_IMAGE: str = "python:3.11-slim"
    SANDBOX_TIMEOUT_SECONDS: int = 120
    SANDBOX_MEMORY_LIMIT: str = "512m"
    SANDBOX_NANO_CPUS: int = 1_000_000_000  # 1.0 CPU
    SANDBOX_NETWORK_ENABLED: bool = False
    SANDBOX_MAX_OUTPUT_CHARS: int = 8000
    SANDBOX_KEEP_WORKSPACES: bool = False
    SANDBOX_WORKSPACE_ROOT: str = ""  # empty -> system temp dir

    # --- Real-money marketplace payments (Razorpay) ---
    # PAYMENT_PROVIDER: "razorpay" (default) | "none" (payments disabled)
    PAYMENT_PROVIDER: str = "razorpay"
    # razorpay mode: "test" (sandbox) | "live" (production). Never fake data: keys decide.
    RAZORPAY_MODE: str = "test"
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    # Webhook signing secret from the Razorpay dashboard (required for webhooks).
    RAZORPAY_WEBHOOK_SECRET: str = ""
    # RazorpayX (payouts to creators). Payouts stay "requested" until configured.
    RAZORPAYX_KEY_ID: str = ""
    RAZORPAYX_KEY_SECRET: str = ""
    RAZORPAYX_ACCOUNT_NUMBER: str = ""
    # Platform marketplace settings
    PLATFORM_CURRENCY: str = "INR"          # default currency for new pricing plans
    PLATFORM_COMMISSION_BPS: int = 1000     # platform fee, basis points (1000 = 10%)
    PLATFORM_MIN_PAYOUT_MINOR: int = 50000  # minimum payout amount (minor units, 50000 = ₹500)
    MARKETPLACE_MODERATION: str = "off"     # "off" = publish immediately, "manual" = pending_review queue

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
