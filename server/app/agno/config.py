import os
from pathlib import Path

from agno.models.openai import OpenAILike
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgnoSettings(BaseSettings):
    mimo_base_url: str | None = None
    mimo_api_key: str | None = None
    mimo_model: str = "ppio/pa/gpt-5.5"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        case_sensitive=False,
        extra="ignore",
    )


settings = AgnoSettings()


def get_data_dir() -> Path:
    configured = os.getenv("MIPET_DATA_DIR")
    data_dir = Path(configured) if configured else Path(__file__).resolve().parents[2] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_model() -> OpenAILike | None:
    if not settings.mimo_base_url or not settings.mimo_api_key:
        return None
    return OpenAILike(
        id=settings.mimo_model,
        api_key=settings.mimo_api_key,
        base_url=settings.mimo_base_url,
    )
