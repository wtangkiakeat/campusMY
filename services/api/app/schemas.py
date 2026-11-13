from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, EmailStr, field_validator

TextBody = Annotated[str, Field(min_length=3, max_length=10000)]
Campus = Literal['Kampar', 'Sungai Long']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ReviewInput(StrictModel):
    campus: Campus
    term: str = Field(min_length=3, max_length=80)
    body: TextBody
    advice: str = Field(default='', max_length=5000)
    overall: int = Field(ge=1, le=5, strict=True)
    difficulty: int | None = Field(default=None, ge=1, le=5, strict=True)
    workload: int | None = Field(default=None, ge=1, le=5, strict=True)


class TipInput(StrictModel):
    campus: Campus
    term: str = Field(min_length=3, max_length=80)
    body: TextBody
    advice: str = Field(default='', max_length=5000)
    assessment_type: str = Field(min_length=2, max_length=80)


class ContentEdit(StrictModel):
    version: int = Field(ge=1)
    body: TextBody
    advice: str = Field(default='', max_length=5000)
    overall: int | None = Field(default=None, ge=1, le=5, strict=True)
    difficulty: int | None = Field(default=None, ge=1, le=5, strict=True)
    workload: int | None = Field(default=None, ge=1, le=5, strict=True)
    assessment_type: str | None = Field(default=None, min_length=2, max_length=80)


class CommentInput(StrictModel):
    body: str = Field(min_length=2, max_length=4000)


class ChallengeInput(StrictModel):
    email: EmailStr


class ConfirmInput(StrictModel):
    challenge_id: str = Field(min_length=1, max_length=80)
    code: str = Field(pattern=r'^\d{6}$')


class PlanInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    campus: Campus
    term: str = Field(min_length=3, max_length=80)
    entries: list[dict] = Field(default_factory=list, max_length=100)


class PlanEdit(PlanInput):
    version: int = Field(ge=1)


class PlanImport(StrictModel):
    key: str = Field(min_length=8, max_length=100)
    plans: list[PlanInput] = Field(min_length=1, max_length=30)


class ReportInput(StrictModel):
    content_id: str = Field(max_length=80)
    reason: Literal['spam','personal_information','harassment','impersonation','wrong_context','unauthorized_material','exam_leak','other']
    detail: str = Field(default='', max_length=2000)


class BlockInput(StrictModel):
    content_id: str = Field(max_length=80)


class AppealInput(StrictModel):
    content_id: str = Field(max_length=80)
    reason: str = Field(min_length=10, max_length=2000)


class ModerationInput(StrictModel):
    version: int = Field(ge=1)
    content_id: str = Field(max_length=80)
    action: Literal['publish','hide','remove']
    reason: str = Field(min_length=5, max_length=2000)


class RestrictionInput(StrictModel):
    content_id: str = Field(max_length=80)
    suspended: bool
    reason: str = Field(min_length=5, max_length=2000)


class ReadInput(StrictModel):
    read: bool = True
