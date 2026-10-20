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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
