from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from sqlalchemy import (
    Column,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    create_engine,
    delete,
    func,
    insert,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.engine import Engine

load_dotenv(override=True)

DB_PATH = Path(__file__).resolve().parent / "vendorguard.db"

metadata = MetaData()

submissions_table = Table(
    "submissions",
    metadata,
    Column("submission_id", Text, primary_key=True),
    Column("created_at", Text, nullable=False),
    Column("legal_entity_name", Text, nullable=False),
    Column("dba_trade_name", Text, nullable=False, server_default=""),
    Column("normalized_entity_name", Text, nullable=False),
    Column("normalized_dba_name", Text, nullable=False, server_default=""),
    Column("country_code", Text, nullable=False),
    Column("tax_id", Text, nullable=False, server_default=""),
    Column("account_number_norm", Text, nullable=False, server_default=""),
    Column("decision", Text, nullable=False),
    Column("executive_summary", Text, nullable=False),
    Column("email_dispatched", Integer, nullable=False, server_default="0"),
    Column("email_dispatched_at", Text, nullable=True),
    Column("total_latency_ms", Integer, nullable=False, server_default="0"),
    Column("payload_json", Text, nullable=False),
)

Index("idx_submissions_account", submissions_table.c.account_number_norm)
Index("idx_submissions_decision", submissions_table.c.decision)

_engine: Optional[Engine] = None
_engine_key: Optional[str] = None


def _resolve_database_url() -> tuple[str, bool]:
    """
    Returns (sqlalchemy_url, is_postgres).
    Reads DATABASE_URL from env (normalizing postgres:// and postgresql:// -> postgresql+psycopg2://).
    Falls back to local SQLite at DB_PATH if DATABASE_URL is unset.
    """
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if raw:
        if raw.startswith("postgres://"):
            raw = "postgresql+psycopg2://" + raw[len("postgres://") :]
        elif raw.startswith("postgresql://"):
            raw = "postgresql+psycopg2://" + raw[len("postgresql://") :]
        return raw, True
    return f"sqlite:///{DB_PATH}", False


def get_engine() -> Engine:
    global _engine, _engine_key
    url, is_postgres = _resolve_database_url()
    if _engine is not None and _engine_key == url:
        return _engine

    if _engine is not None:
        _engine.dispose()

    if is_postgres:
        _engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=300,
        )
    else:
        _engine = create_engine(
            url,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )
    _engine_key = url
    return _engine


def is_postgres_backend() -> bool:
    _, is_pg = _resolve_database_url()
    return is_pg


def init_db() -> None:
    engine = get_engine()
    metadata.create_all(engine)


def ping_db() -> bool:
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True


def normalize_account_number(account_number: str) -> str:
    return "".join(ch for ch in (account_number or "").upper() if ch.isalnum())


def save_submission(
    payload: dict[str, Any],
    normalized_entity_name: str,
    normalized_dba_name: str = "",
) -> None:
    form = payload.get("form_data", {})
    email = payload.get("outbound_email") or {}
    acct_norm = normalize_account_number(form.get("account_number", ""))

    row_values = {
        "submission_id": payload["submission_id"],
        "created_at": payload["created_at"],
        "legal_entity_name": form.get("legal_entity_name", ""),
        "dba_trade_name": form.get("dba_trade_name", "") or "",
        "normalized_entity_name": normalized_entity_name,
        "normalized_dba_name": normalized_dba_name or "",
        "country_code": form.get("country_code", ""),
        "tax_id": form.get("tax_id", "") or "",
        "account_number_norm": acct_norm,
        "decision": payload["decision"],
        "executive_summary": payload["executive_summary"],
        "email_dispatched": 1 if email.get("dispatched") else 0,
        "email_dispatched_at": email.get("dispatched_at"),
        "total_latency_ms": int(payload.get("total_latency_ms", 0) or 0),
        "payload_json": json.dumps(payload),
    }

    engine = get_engine()
    with engine.begin() as conn:
        existing = conn.execute(
            select(submissions_table.c.submission_id).where(
                submissions_table.c.submission_id == payload["submission_id"]
            )
        ).first()
        if existing:
            conn.execute(
                update(submissions_table)
                .where(submissions_table.c.submission_id == payload["submission_id"])
                .values(**row_values)
            )
        else:
            conn.execute(insert(submissions_table).values(**row_values))


def find_duplicate_bank_account(
    account_number: str,
    current_entity_names_norm: set[str],
) -> Optional[dict[str, Any]]:
    acct_norm = normalize_account_number(account_number)
    if not acct_norm:
        return None

    clean_current = {n for n in current_entity_names_norm if n}

    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            select(
                submissions_table.c.submission_id,
                submissions_table.c.legal_entity_name,
                submissions_table.c.dba_trade_name,
                submissions_table.c.normalized_entity_name,
                submissions_table.c.normalized_dba_name,
                submissions_table.c.decision,
                submissions_table.c.created_at,
            )
            .where(
                submissions_table.c.account_number_norm == acct_norm,
                submissions_table.c.decision != "REJECTED",
            )
            .order_by(submissions_table.c.created_at.desc())
        ).mappings().all()

    for row in rows:
        existing_names = {
            n
            for n in [row["normalized_entity_name"], row["normalized_dba_name"]]
            if n
        }
        if existing_names and clean_current and existing_names.isdisjoint(clean_current):
            return dict(row)

    return None


def find_duplicate_tax_id(
    tax_id: str,
    secondary_tax_id: str,
    current_entity_names_norm: set[str],
) -> Optional[dict[str, Any]]:
    norm_primary = normalize_account_number(tax_id)
    norm_secondary = normalize_account_number(secondary_tax_id)
    candidate_ids = {t for t in [norm_primary, norm_secondary] if t}
    if not candidate_ids:
        return None

    clean_current = {n for n in current_entity_names_norm if n}

    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            select(
                submissions_table.c.submission_id,
                submissions_table.c.legal_entity_name,
                submissions_table.c.dba_trade_name,
                submissions_table.c.normalized_entity_name,
                submissions_table.c.normalized_dba_name,
                submissions_table.c.tax_id,
                submissions_table.c.payload_json,
                submissions_table.c.decision,
                submissions_table.c.created_at,
            )
            .where(submissions_table.c.decision != "REJECTED")
            .order_by(submissions_table.c.created_at.desc())
        ).mappings().all()

    for row in rows:
        existing_ids: set[str] = set()
        if row["tax_id"]:
            t_norm = normalize_account_number(row["tax_id"])
            if t_norm:
                existing_ids.add(t_norm)
        try:
            payload = json.loads(row["payload_json"])
            sec_raw = (payload.get("form_data") or {}).get("secondary_tax_id") or ""
            s_norm = normalize_account_number(sec_raw)
            if s_norm:
                existing_ids.add(s_norm)
        except Exception:
            pass

        if not (existing_ids & candidate_ids):
            continue

        existing_names = {
            n
            for n in [row["normalized_entity_name"], row["normalized_dba_name"]]
            if n
        }
        if existing_names and clean_current and existing_names.isdisjoint(clean_current):
            return {
                "submission_id": row["submission_id"],
                "legal_entity_name": row["legal_entity_name"],
                "tax_id": row["tax_id"],
                "decision": row["decision"],
            }

    return None


def list_submissions(
    status: Optional[str] = None, search: Optional[str] = None
) -> list[dict[str, Any]]:
    stmt = select(
        submissions_table.c.payload_json,
        submissions_table.c.email_dispatched,
        submissions_table.c.email_dispatched_at,
    )

    if status and status.upper() in {"APPROVED", "PENDING", "REJECTED"}:
        stmt = stmt.where(submissions_table.c.decision == status.upper())

    if search and search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                submissions_table.c.legal_entity_name.ilike(like),
                submissions_table.c.dba_trade_name.ilike(like),
                submissions_table.c.tax_id.ilike(like),
                submissions_table.c.country_code.ilike(like),
                submissions_table.c.submission_id.ilike(like),
            )
        )

    stmt = stmt.order_by(submissions_table.c.created_at.desc())

    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()

    results: list[dict[str, Any]] = []
    for row in rows:
        data = json.loads(row["payload_json"])
        if data.get("outbound_email"):
            data["outbound_email"]["dispatched"] = bool(row["email_dispatched"])
            data["outbound_email"]["dispatched_at"] = row["email_dispatched_at"]
        results.append(data)
    return results


def get_submission(submission_id: str) -> Optional[dict[str, Any]]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            select(
                submissions_table.c.payload_json,
                submissions_table.c.email_dispatched,
                submissions_table.c.email_dispatched_at,
            ).where(submissions_table.c.submission_id == submission_id)
        ).mappings().first()
    if not row:
        return None
    data = json.loads(row["payload_json"])
    if data.get("outbound_email"):
        data["outbound_email"]["dispatched"] = bool(row["email_dispatched"])
        data["outbound_email"]["dispatched_at"] = row["email_dispatched_at"]
    return data


def mark_email_dispatched(submission_id: str) -> Optional[dict[str, Any]]:
    record = get_submission(submission_id)
    if not record or not record.get("outbound_email"):
        return None

    dispatched_at = datetime.now(timezone.utc).isoformat()
    record["outbound_email"]["dispatched"] = True
    record["outbound_email"]["dispatched_at"] = dispatched_at

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            update(submissions_table)
            .where(submissions_table.c.submission_id == submission_id)
            .values(
                email_dispatched=1,
                email_dispatched_at=dispatched_at,
                payload_json=json.dumps(record),
            )
        )
    return record


def get_kpis() -> dict[str, int]:
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            select(
                submissions_table.c.decision,
                func.count().label("cnt"),
            ).group_by(submissions_table.c.decision)
        ).mappings().all()
    counts = {"APPROVED": 0, "PENDING": 0, "REJECTED": 0}
    for r in rows:
        if r["decision"] in counts:
            counts[r["decision"]] = int(r["cnt"])
    total = sum(counts.values())
    return {
        "total": total,
        "approved": counts["APPROVED"],
        "pending": counts["PENDING"],
        "rejected": counts["REJECTED"],
    }


def clear_all_submissions() -> int:
    engine = get_engine()
    with engine.begin() as conn:
        res = conn.execute(delete(submissions_table))
        return int(res.rowcount or 0)
