from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="CAMPUSMY_")
    environment: str = "development"
    database_url: str = "sqlite:///./.runtime/campusmy.db"
    database_schema: str | None = None
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    supabase_url: str = ""
    jwt_audience: str = "authenticated"
    jwt_issuer: str = ""
    otp_secret: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    max_body_bytes: int = 2_000_000
    create_tables: bool = False
    auth_jwks_json: str = ""  # Only accepted in test; production fetches configured issuer keys.

    @model_validator(mode="after")
    def secure_configuration(self):
        import re
        if self.database_schema and not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", self.database_schema):
            raise ValueError("Invalid database schema")
        if self.environment not in {"development", "test", "production"}:
            raise ValueError("Unknown environment")
        if self.environment != "test" and self.auth_jwks_json:
            raise ValueError("Inline signing keys are only supported in tests")
        if self.environment == "production":
            if not self.database_url.startswith("postgresql") or not self.database_schema:
                raise ValueError("Production requires PostgreSQL and a non-public schema")
            if self.database_schema in {"public", "auth", "storage"}:
                raise ValueError("Use a dedicated non-exposed application schema")
            if not self.smtp_starttls:
                raise ValueError("Production SMTP must use TLS")
            if "sslmode=verify-full" not in self.database_url:
                raise ValueError("Production PostgreSQL must use sslmode=verify-full")
            if self.create_tables:
                raise ValueError("Use migrations in production")
            if len(self.otp_secret) < 32 or not self.supabase_url.startswith("https://"):
                raise ValueError("Production requires HTTPS Supabase and a strong OTP secret")
            if any(not origin.strip().startswith("https://") for origin in self.cors_origins.split(",")):
                raise ValueError("Production origins must use HTTPS")
        return self

    @property
    def issuer(self):
        return self.jwt_issuer or f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache
def get_settings():
    return Settings()
