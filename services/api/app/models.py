from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Text, Integer, Float, Boolean, JSON, ForeignKey, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid4())


def now():
    return int(datetime.now(timezone.utc).timestamp())


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    institution: Mapped[str] = mapped_column(String(30), default="utar")
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(400))
    campus: Mapped[str] = mapped_column(String(80), index=True)
    faculty: Mapped[str] = mapped_column(String(80), default="")
    credits: Mapped[float | None] = mapped_column(Float, nullable=True)
    years: Mapped[list] = mapped_column(JSON, default=list)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("institution", "code", "campus"),)


class Offering(Base):
    __tablename__ = "offerings"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    campus: Mapped[str] = mapped_column(String(80))
    faculty: Mapped[str] = mapped_column(String(80), default="")
    term: Mapped[str] = mapped_column(String(80), index=True)
    source: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("course_id", "campus", "term"),)


class Section(Base):
    __tablename__ = "sections"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    offering_id: Mapped[str] = mapped_column(ForeignKey("offerings.id"), index=True)
    type: Mapped[str] = mapped_column(String(1))
    group: Mapped[str] = mapped_column(String(80), default="")
    meetings: Mapped[list] = mapped_column(JSON, default=list)
    __table_args__ = (CheckConstraint("type IN ('L','T','P')"),)


class SourceDocument(Base):
    __tablename__ = "source_documents"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    url: Mapped[str] = mapped_column(Text, unique=True)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)


class SourceObservation(Base):
    __tablename__ = "source_observations"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(40))
    legacy_id: Mapped[str] = mapped_column(String(100), index=True)
    course_id: Mapped[str | None] = mapped_column(ForeignKey("courses.id"), nullable=True)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)


class ImportRun(Base):
    __tablename__ = "import_runs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="published")
    manifest: Mapped[dict] = mapped_column(JSON, default=dict)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)


class LegacyMapping(Base):
    __tablename__ = "legacy_id_mappings"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(40))
    legacy_id: Mapped[str] = mapped_column(String(100), unique=True)
    canonical_id: Mapped[str] = mapped_column(String(80))


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default="member")
    suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (CheckConstraint("role IN ('member','moderator','admin')"),)


class Membership(Base):
    __tablename__ = "memberships"
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    institution: Mapped[str] = mapped_column(String(30), default="utar")
    email_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    verified_at: Mapped[int] = mapped_column(Integer, default=now)
    expires_at: Mapped[int] = mapped_column(Integer)


class VerificationChallenge(Base):
    __tablename__ = "verification_challenges"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    email_hash: Mapped[str] = mapped_column(String(64))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class Content(Base):
    __tablename__ = "content"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    course_id: Mapped[str | None] = mapped_column(ForeignKey("courses.id"), nullable=True, index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("content.id"), nullable=True, index=True)
    campus: Mapped[str] = mapped_column(String(80), default="")
    term: Mapped[str] = mapped_column(String(80), default="")
    body: Mapped[str] = mapped_column(Text)
    advice: Mapped[str] = mapped_column(Text, default="")
    overall: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    workload: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assessment_type: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (
        CheckConstraint("kind IN ('review','tip','comment')"),
        CheckConstraint("status IN ('pending','published','hidden','removed')"),
        CheckConstraint("overall IS NULL OR (overall >= 1 AND overall <= 5)"),
        CheckConstraint("difficulty IS NULL OR (difficulty >= 1 AND difficulty <= 5)"),
        CheckConstraint("workload IS NULL OR (workload >= 1 AND workload <= 5)"),
    )


class ContentOwner(Base):
    __tablename__ = "content_owners"
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    review_context: Mapped[str | None] = mapped_column(String(200), nullable=True)
    __table_args__ = (UniqueConstraint("user_id", "review_context"),)


class Revision(Base):
    __tablename__ = "content_revisions"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id"), index=True)
    previous: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class Vote(Base):
    __tablename__ = "helpful_votes"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    __table_args__ = (UniqueConstraint("content_id", "user_id"),)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    reason: Mapped[str] = mapped_column(String(80))
    detail: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (UniqueConstraint("content_id", "user_id", "reason"),)


class Block(Base):
    __tablename__ = "blocks"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    __table_args__ = (UniqueConstraint("user_id", "target_id"), CheckConstraint("user_id != target_id"))


class ModerationAction(Base):
    __tablename__ = "moderation_actions"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id"))
    moderator_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    action: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class Appeal(Base):
    __tablename__ = "appeals"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    content_id: Mapped[str] = mapped_column(ForeignKey("content.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_at: Mapped[int] = mapped_column(Integer, default=now)
    __table_args__ = (UniqueConstraint("content_id", "user_id"),)


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    campus: Mapped[str] = mapped_column(String(80))
    term: Mapped[str] = mapped_column(String(80))
    entries: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[int] = mapped_column(Integer, default=now)


class ImportReceipt(Base):
    __tablename__ = "plan_import_receipts"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    key: Mapped[str] = mapped_column(String(100))
    result: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("user_id", "key"),)


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[int] = mapped_column(Integer, default=now)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    content_id: Mapped[str | None] = mapped_column(ForeignKey("content.id"), nullable=True)
    message: Mapped[str] = mapped_column(String(300))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)
