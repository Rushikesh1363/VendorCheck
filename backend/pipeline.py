from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Optional

from backend import database
from backend.extractor import (
    classify_document,
    extract_bank_document,
    extract_compliance_document,
    extract_tax_document,
    inspect_and_read_pdf,
)
from backend.rules_engine import (
    normalize_entity_name,
    route_decision_and_draft_email,
    run_deterministic_rules,
)
from backend.schemas import (
    ExtractedBundle,
    OnboardingResult,
    StageResult,
    UploadedDocInfo,
    VendorFormInput,
)


def execute_pipeline_events(
    form: VendorFormInput,
    files: dict[str, Optional[tuple[str, bytes]]],
) -> list[dict[str, Any]]:
    """
    Synchronous execution of the 4-stage verification pipeline, returning the ordered
    list of stage telemetry events plus the final OnboardingResult.
    """
    events: list[dict[str, Any]] = []
    stages: list[StageResult] = []
    pipeline_start = time.perf_counter()

    submission_id = f"VG-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    created_at = datetime.now(timezone.utc).isoformat()

    # =========================================================================
    # STAGE 1: INTAKE & DOCUMENT CLASSIFICATION
    # =========================================================================
    events.append(
        {
            "event": "stage_start",
            "stage_number": 1,
            "stage_key": "intake_classification",
            "stage_name": "Intake & Document Classification",
        }
    )
    t1 = time.perf_counter()

    raw_texts: dict[str, str] = {}
    raw_bytes: dict[str, bytes] = {}
    doc_infos: list[UploadedDocInfo] = []
    s1_engines: set[str] = set()

    for slot in ("tax_document", "bank_document", "compliance_document"):
        item = files.get(slot)
        if not item:
            continue
        filename, content = item
        readable, page_count, text = inspect_and_read_pdf(content)
        raw_texts[slot] = text
        raw_bytes[slot] = content

        if not readable:
            doc_infos.append(
                UploadedDocInfo(
                    slot=slot,  # type: ignore[arg-type]
                    filename=filename,
                    readable=False,
                    page_count=0,
                    classification="WRONG_DOCUMENT",
                    confidence=1.0,
                    detected_title="Unreadable / Corrupt File",
                    summary=f"Could not parse '{filename}' as a valid PDF document.",
                    engine="pdfplumber-deterministic",
                )
            )
            s1_engines.add("pdfplumber-deterministic")
            continue

        cls_res, eng = classify_document(content, text, filename)
        s1_engines.add(eng)
        doc_infos.append(
            UploadedDocInfo(
                slot=slot,  # type: ignore[arg-type]
                filename=filename,
                readable=True,
                page_count=page_count,
                classification=cls_res.document_type,
                confidence=cls_res.confidence,
                detected_title=cls_res.detected_title,
                summary=cls_res.summary,
                engine=eng,
            )
        )

    s1_ms = max(1, int((time.perf_counter() - t1) * 1000))
    wrong_docs = [d for d in doc_infos if d.classification == "WRONG_DOCUMENT" or not d.readable]
    s1_status = "warning" if wrong_docs else "completed"
    s1_engine_str = " + ".join(sorted(s1_engines)) if s1_engines else "pdfplumber-deterministic"
    s1_summary = (
        f"Processed {len(doc_infos)} PDF(s): "
        + ", ".join(f"{d.slot.replace('_document', '')}={d.classification}" for d in doc_infos)
        if doc_infos
        else "No supporting PDF attachments provided."
    )
    stage1 = StageResult(
        stage_number=1,
        stage_key="intake_classification",
        stage_name="Intake & Document Classification",
        status=s1_status,  # type: ignore[arg-type]
        latency_ms=s1_ms,
        engine=s1_engine_str,
        summary=s1_summary,
        details={"documents": [d.model_dump() for d in doc_infos]},
    )
    stages.append(stage1)
    events.append({"event": "stage_complete", "stage": stage1.model_dump()})

    # =========================================================================
    # STAGE 2: STRUCTURED ENTITY & FIELD EXTRACTION
    # =========================================================================
    events.append(
        {
            "event": "stage_start",
            "stage_number": 2,
            "stage_key": "structured_extraction",
            "stage_name": "Multimodal Field Extraction",
        }
    )
    t2 = time.perf_counter()

    docs_by_slot = {d.slot: d for d in doc_infos}
    tax_ext = None
    bank_ext = None
    comp_ext = None
    s2_engines: set[str] = set()

    if "tax_document" in docs_by_slot and docs_by_slot["tax_document"].classification == "TAX_REGISTRATION":
        tax_ext, eng = extract_tax_document(
            raw_bytes["tax_document"], raw_texts["tax_document"]
        )
        s2_engines.add(eng)

    if "bank_document" in docs_by_slot and docs_by_slot["bank_document"].classification == "BANK_PROOF":
        bank_ext, eng = extract_bank_document(
            raw_bytes["bank_document"], raw_texts["bank_document"]
        )
        s2_engines.add(eng)

    if "compliance_document" in docs_by_slot and docs_by_slot["compliance_document"].classification == "COMPLIANCE_CERT":
        comp_ext, eng = extract_compliance_document(
            raw_bytes["compliance_document"], raw_texts["compliance_document"]
        )
        s2_engines.add(eng)

    s2_engine_str = " + ".join(sorted(s2_engines)) if s2_engines else "pdfplumber-deterministic"
    extracted = ExtractedBundle(
        tax_doc=tax_ext,
        bank_doc=bank_ext,
        compliance_doc=comp_ext,
        engine_used=s2_engine_str,
    )
    s2_ms = max(1, int((time.perf_counter() - t2) * 1000))
    extracted_parts = []
    if tax_ext:
        extracted_parts.append("Tax Registration")
    if bank_ext:
        extracted_parts.append("Bank Proof")
    if comp_ext:
        extracted_parts.append("Compliance Cert")

    stage2 = StageResult(
        stage_number=2,
        stage_key="structured_extraction",
        stage_name="Multimodal Field Extraction",
        status="completed" if extracted_parts else "warning",
        latency_ms=s2_ms,
        engine=s2_engine_str,
        summary=(
            f"Extracted structured JSON schemas from: {', '.join(extracted_parts)}."
            if extracted_parts
            else "No valid documents available for structured schema extraction."
        ),
        details=extracted.model_dump(),
    )
    stages.append(stage2)
    events.append({"event": "stage_complete", "stage": stage2.model_dump()})

    # =========================================================================
    # STAGE 3: DETERMINISTIC CROSS-FIELD & JURISDICTION RULE ENGINE
    # =========================================================================
    events.append(
        {
            "event": "stage_start",
            "stage_number": 3,
            "stage_key": "rule_engine",
            "stage_name": "Cross-Field & Jurisdiction Rules",
        }
    )
    t3 = time.perf_counter()

    rule_checks, audit_notes, s3_engine = run_deterministic_rules(
        form=form,
        documents=doc_infos,
        extracted=extracted,
    )
    s3_ms = max(1, int((time.perf_counter() - t3) * 1000))

    pass_cnt = sum(1 for c in rule_checks if c.status == "PASS")
    warn_cnt = sum(1 for c in rule_checks if c.status == "WARN")
    fail_cnt = sum(1 for c in rule_checks if c.status == "FAIL")
    crit_cnt = sum(1 for c in rule_checks if c.status == "FAIL" and c.severity == "CRITICAL")

    s3_status = "failed" if crit_cnt else ("warning" if fail_cnt or warn_cnt else "completed")
    stage3 = StageResult(
        stage_number=3,
        stage_key="rule_engine",
        stage_name="Cross-Field & Jurisdiction Rules",
        status=s3_status,  # type: ignore[arg-type]
        latency_ms=s3_ms,
        engine=s3_engine,
        summary=f"Evaluated {len(rule_checks)} rules: {pass_cnt} PASS, {warn_cnt} WARN, {fail_cnt} FAIL ({crit_cnt} CRITICAL).",
        details={
            "pass_count": pass_cnt,
            "warn_count": warn_cnt,
            "fail_count": fail_cnt,
            "critical_count": crit_cnt,
        },
    )
    stages.append(stage3)
    events.append({"event": "stage_complete", "stage": stage3.model_dump()})

    # =========================================================================
    # STAGE 4: DECISION ROUTING & OUTBOUND REMEDIATION
    # =========================================================================
    events.append(
        {
            "event": "stage_start",
            "stage_number": 4,
            "stage_key": "decision_remediation",
            "stage_name": "Decision & Remediation",
        }
    )
    t4 = time.perf_counter()

    decision, executive_summary, outbound_email = route_decision_and_draft_email(
        submission_id=submission_id,
        form=form,
        checks=rule_checks,
        audit_notes=audit_notes,
    )
    s4_ms = max(1, int((time.perf_counter() - t4) * 1000))

    s4_status = (
        "completed"
        if decision == "APPROVED"
        else ("failed" if decision == "REJECTED" else "warning")
    )
    stage4 = StageResult(
        stage_number=4,
        stage_key="decision_remediation",
        stage_name="Decision & Remediation",
        status=s4_status,  # type: ignore[arg-type]
        latency_ms=s4_ms,
        engine="deterministic-routing-engine",
        summary=(
            f"Final Decision: {decision}"
            + (" · Itemized vendor notice drafted." if outbound_email else " · Ready for ERP activation.")
        ),
        details={"decision": decision, "email_drafted": outbound_email is not None},
    )
    stages.append(stage4)
    events.append({"event": "stage_complete", "stage": stage4.model_dump()})

    total_ms = max(1, int((time.perf_counter() - pipeline_start) * 1000))

    result = OnboardingResult(
        submission_id=submission_id,
        created_at=created_at,
        decision=decision,  # type: ignore[arg-type]
        executive_summary=executive_summary,
        audit_notes=audit_notes,
        form_data=form,
        documents=doc_infos,
        extracted=extracted,
        rule_checks=rule_checks,
        stages=stages,
        outbound_email=outbound_email,
        total_latency_ms=total_ms,
    )

    # Persist to SQLite audit trail
    norm_legal = normalize_entity_name(
        (tax_ext.extracted_legal_name if tax_ext and tax_ext.extracted_legal_name else None)
        or form.legal_entity_name
    )
    norm_dba = normalize_entity_name(
        (tax_ext.extracted_dba_name if tax_ext and tax_ext.extracted_dba_name else None)
        or form.dba_trade_name
        or form.legal_entity_name
    )
    database.save_submission(
        result.model_dump(),
        normalized_entity_name=norm_legal,
        normalized_dba_name=norm_dba,
    )

    events.append({"event": "complete", "result": result.model_dump()})
    return events


async def stream_pipeline_events(
    form: VendorFormInput,
    files: dict[str, Optional[tuple[str, bytes]]],
) -> AsyncGenerator[dict[str, Any], None]:
    """Async SSE generator emitting each pipeline stage sequentially for live UI updates."""
    events = await asyncio.to_thread(execute_pipeline_events, form, files)
    for ev in events:
        yield ev
        # Gentle visual pacing for SSE animation without distorting authentic compute latency
        if ev.get("event") == "stage_start":
            await asyncio.sleep(0.14)
        elif ev.get("event") == "stage_complete":
            await asyncio.sleep(0.10)
