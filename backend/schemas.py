from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# --- Gemini Strict Response Schemas ---


class DocumentClassificationResult(BaseModel):
    document_type: Literal[
        "TAX_REGISTRATION", "BANK_PROOF", "COMPLIANCE_CERT", "WRONG_DOCUMENT"
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    detected_title: Optional[str] = None
    summary: str


class TaxDocExtraction(BaseModel):
    extracted_legal_name: Optional[str] = None
    extracted_dba_name: Optional[str] = None
    extracted_tax_id: Optional[str] = None
    extracted_secondary_tax_id: Optional[str] = None
    extracted_state: Optional[str] = None
    registration_status: Optional[str] = None
    expiry_date: Optional[str] = None  # YYYY-MM-DD


class BankDocExtraction(BaseModel):
    extracted_account_holder: Optional[str] = None
    extracted_account_number: Optional[str] = None
    extracted_routing_code: Optional[str] = None
    extracted_account_type: Optional[str] = None
    name_printed_on_proof: bool = False


class ComplianceDocExtraction(BaseModel):
    cert_type: Optional[str] = None
    cert_expiry_date: Optional[str] = None  # YYYY-MM-DD
    cert_entity_name: Optional[str] = None
    cert_status: Optional[str] = None


class ForeignTaxPolicyResult(BaseModel):
    is_valid: bool
    expected_format_description: str
    expected_regex: Optional[str] = None
    reasoning: str


# --- Core Domain & API Models ---


class VendorFormInput(BaseModel):
    legal_entity_name: str = ""
    dba_trade_name: Optional[str] = ""
    entity_constitution: str = "Private Limited / Corp"
    country_code: str = "IN"
    billing_state: str = ""
    tax_id: str = ""
    secondary_tax_id: Optional[str] = ""
    bank_account_holder: str = ""
    account_number: str = ""
    account_type: str = "Current / Commercial"
    routing_code: str = ""
    bank_name: str = ""
    contact_email: str = ""
    scenario_key: Optional[str] = None


class UploadedDocInfo(BaseModel):
    slot: Literal["tax_document", "bank_document", "compliance_document"]
    filename: str
    readable: bool
    page_count: int = 0
    classification: Literal[
        "TAX_REGISTRATION", "BANK_PROOF", "COMPLIANCE_CERT", "WRONG_DOCUMENT", "MISSING"
    ]
    confidence: float = 0.0
    detected_title: Optional[str] = None
    summary: str = ""
    engine: str = "pdfplumber-deterministic"


class ExtractedBundle(BaseModel):
    tax_doc: Optional[TaxDocExtraction] = None
    bank_doc: Optional[BankDocExtraction] = None
    compliance_doc: Optional[ComplianceDocExtraction] = None
    engine_used: str = "pdfplumber-deterministic"


class RuleCheckResult(BaseModel):
    rule_id: str
    rule_group: str
    rule_name: str
    status: Literal["PASS", "WARN", "FAIL"]
    severity: Literal["INFO", "OPERATIONAL", "CRITICAL"] = "INFO"
    expected: str
    found: str
    message: str
    remediation_hint: Optional[str] = None


class StageResult(BaseModel):
    stage_number: int
    stage_key: str
    stage_name: str
    status: Literal["completed", "warning", "failed"]
    latency_ms: int
    engine: str
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)


class OutboundEmail(BaseModel):
    to_email: str
    subject: str
    body: str
    dispatched: bool = False
    dispatched_at: Optional[str] = None


class OnboardingResult(BaseModel):
    submission_id: str
    created_at: str
    decision: Literal["APPROVED", "PENDING", "REJECTED"]
    executive_summary: str
    audit_notes: list[str] = Field(default_factory=list)
    form_data: VendorFormInput
    documents: list[UploadedDocInfo] = Field(default_factory=list)
    extracted: ExtractedBundle
    rule_checks: list[RuleCheckResult] = Field(default_factory=list)
    stages: list[StageResult] = Field(default_factory=list)
    outbound_email: Optional[OutboundEmail] = None
    total_latency_ms: int = 0
