from __future__ import annotations

from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

FIXTURES_DIR = Path(__file__).resolve().parent / "test_fixtures"


PRESET_SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "scenario_1",
        "short_label": "1. Happy Path (IN)",
        "title": "Scenario 1 — Happy Path (India Corporate)",
        "expected_decision": "APPROVED",
        "description": "Valid IN Corporate PAN ('C'), Maharashtra GSTIN (27), HDFC Bank suffix normalization (Pvt Ltd vs Private Limited), and active CA certificate.",
        "form_data": {
            "legal_entity_name": "Kiran Precision Components Pvt Ltd",
            "dba_trade_name": "",
            "entity_constitution": "Private Limited / Corp",
            "country_code": "IN",
            "billing_state": "Maharashtra",
            "tax_id": "AABCK1234F",
            "secondary_tax_id": "27AABCK1234F1Z5",
            "bank_account_holder": "Kiran Precision Components Private Limited",
            "account_number": "50200048192031",
            "account_type": "Current / Commercial",
            "routing_code": "HDFC0000240",
            "contact_email": "onboarding@kiranprecision.in",
            "scenario_key": "scenario_1",
        },
        "files": {
            "tax_document": "s1_gst_reg06.pdf",
            "bank_document": "s1_hdfc_bank_letter.pdf",
            "compliance_document": "s1_ca_turnover_cert.pdf",
        },
    },
    {
        "id": "scenario_2",
        "short_label": "2. State GSTIN + Expired CA",
        "title": "Scenario 2 — State GSTIN Mismatch + Expired CA Cert",
        "expected_decision": "PENDING",
        "description": "Vendor bids from Delhi (07) but submits Madhya Pradesh (23) GSTIN, alongside an expired FY 2024-25 CA turnover certificate.",
        "form_data": {
            "legal_entity_name": "Apex Infra Solutions Pvt Ltd",
            "dba_trade_name": "",
            "entity_constitution": "Private Limited / Corp",
            "country_code": "IN",
            "billing_state": "Delhi",
            "tax_id": "AABCA5678M",
            "secondary_tax_id": "23AABCA5678M1Z2",
            "bank_account_holder": "Apex Infra Solutions Pvt Ltd",
            "account_number": "50200077218944",
            "account_type": "Current / Commercial",
            "routing_code": "HDFC0000003",
            "contact_email": "finance@apexinfra.in",
            "scenario_key": "scenario_2",
        },
        "files": {
            "tax_document": "s2_mp_gst_reg06.pdf",
            "bank_document": "s2_hdfc_bank_letter.pdf",
            "compliance_document": "s2_expired_ca_cert.pdf",
        },
    },
    {
        "id": "scenario_3",
        "short_label": "3. PAN Fraud + Bank Diversion",
        "title": "Scenario 3 — PAN Constitution Mismatch + Bank Diversion",
        "expected_decision": "REJECTED",
        "description": "Private Limited company submits an Individual ('P') PAN and a bank verification letter belonging to an unrelated third-party beneficiary.",
        "form_data": {
            "legal_entity_name": "Mehta Industrial Engineering Pvt Ltd",
            "dba_trade_name": "",
            "entity_constitution": "Private Limited / Corp",
            "country_code": "IN",
            "billing_state": "Maharashtra",
            "tax_id": "ABCPM9102K",
            "secondary_tax_id": "27ABCPM9102K1Z9",
            "bank_account_holder": "Mehta Industrial Engineering Pvt Ltd",
            "account_number": "000405118823",
            "account_type": "Current / Commercial",
            "routing_code": "ICIC0000004",
            "contact_email": "accounts@mehtaindustrial.in",
            "scenario_key": "scenario_3",
        },
        "files": {
            "tax_document": "s3_tax_pan_gst.pdf",
            "bank_document": "s3_icici_bank_diversion.pdf",
            "compliance_document": None,
        },
    },
    {
        "id": "scenario_4a",
        "short_label": "4A. DE Tax + Wrong Doc",
        "title": "Scenario 4A — Cross-Border DE Tax Error + Wrong Attachment",
        "expected_decision": "PENDING",
        "description": "German vendor enters a US EIN (92-4810293) instead of a German USt-IdNr (DE + 9 digits) and uploads a hosting invoice instead of bank proof.",
        "form_data": {
            "legal_entity_name": "Nordic Cloud Systems GmbH",
            "dba_trade_name": "",
            "entity_constitution": "Private Limited / Corp",
            "country_code": "DE",
            "billing_state": "Berlin",
            "tax_id": "92-4810293",
            "secondary_tax_id": "",
            "bank_account_holder": "Nordic Cloud Systems GmbH",
            "account_number": "DE89370400440532013000",
            "account_type": "Current / Commercial",
            "routing_code": "COBADEFFXXX",
            "contact_email": "billing@nordiccloud.de",
            "scenario_key": "scenario_4a",
        },
        "files": {
            "tax_document": "s4a_de_tax_doc.pdf",
            "bank_document": "s4a_hosting_invoice.pdf",
            "compliance_document": None,
        },
    },
    {
        "id": "scenario_4b",
        "short_label": "4B. UK DBA Resolution",
        "title": "Scenario 4B — UK DBA Entity Resolution (Approved w/ Note)",
        "expected_decision": "APPROVED",
        "description": "Vendor applies as 'NovaPay Logistics' (UK), HMRC VAT lists 'Meridian Freight Holdings Ltd (Trading As: NovaPay Logistics)' matching Barclays bank letter.",
        "form_data": {
            "legal_entity_name": "NovaPay Logistics",
            "dba_trade_name": "NovaPay Logistics",
            "entity_constitution": "Private Limited / Corp",
            "country_code": "UK",
            "billing_state": "England",
            "tax_id": "GB987654321",
            "secondary_tax_id": "",
            "bank_account_holder": "Meridian Freight Holdings Ltd",
            "account_number": "20491822",
            "account_type": "Current / Commercial",
            "routing_code": "20-45-12",
            "contact_email": "treasury@novapaylogistics.co.uk",
            "scenario_key": "scenario_4b",
        },
        "files": {
            "tax_document": "s4b_hmrc_vat_cert.pdf",
            "bank_document": "s4b_barclays_bank_letter.pdf",
            "compliance_document": None,
        },
    },
]


def _render_structured_pdf(
    output_path: Path,
    header_bg: colors.Color,
    authority: str,
    doc_title: str,
    doc_subtitle: str,
    doc_ref: str,
    fields: list[tuple[str, str]],
    footer_notes: list[str],
    stamp_text: str,
    stamp_color: colors.Color = colors.HexColor("#0F766E"),
) -> None:
    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4

    # Header banner
    c.setFillColor(header_bg)
    c.rect(0, height - 36 * mm, width, 36 * mm, stroke=0, fill=1)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(18 * mm, height - 13 * mm, authority.upper())

    c.setFont("Helvetica-Bold", 16)
    c.drawString(18 * mm, height - 22 * mm, doc_title)

    c.setFont("Helvetica", 9.5)
    c.setFillColor(colors.HexColor("#E2E8F0"))
    c.drawString(18 * mm, height - 29 * mm, doc_subtitle)

    # Document reference ribbon
    c.setFillColor(colors.HexColor("#F1F5F9"))
    c.rect(18 * mm, height - 47 * mm, width - 36 * mm, 8 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(21 * mm, height - 44.3 * mm, f"DOCUMENT REFERENCE: {doc_ref}")

    # Structured fields table
    y = height - 58 * mm
    row_height = 10.5 * mm
    for idx, (label, value) in enumerate(fields):
        if idx % 2 == 0:
            c.setFillColor(colors.HexColor("#F8FAFC"))
            c.rect(18 * mm, y - 3 * mm, width - 36 * mm, row_height, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor("#E2E8F0"))
        c.line(18 * mm, y - 3 * mm, width - 18 * mm, y - 3 * mm)

        c.setFillColor(colors.HexColor("#475569"))
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(21 * mm, y + 1.2 * mm, f"{label}:")

        c.setFillColor(colors.HexColor("#0F172A"))
        c.setFont("Helvetica", 10)
        c.drawString(82 * mm, y + 1.2 * mm, value)
        y -= row_height

    # Verification / official stamp box
    y -= 10 * mm
    c.setStrokeColor(stamp_color)
    c.setLineWidth(1.5)
    c.roundRect(18 * mm, y - 16 * mm, width - 36 * mm, 22 * mm, 3 * mm, stroke=1, fill=0)

    c.setFillColor(stamp_color)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(23 * mm, y - 2 * mm, stamp_text)

    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 8.5)
    note_y = y - 8 * mm
    for note in footer_notes[:2]:
        c.drawString(23 * mm, note_y, note)
        note_y -= 4.5 * mm

    # Bottom footer
    c.setStrokeColor(colors.HexColor("#CBD5E1"))
    c.setLineWidth(0.5)
    c.line(18 * mm, 18 * mm, width - 18 * mm, 18 * mm)
    c.setFillColor(colors.HexColor("#64748B"))
    c.setFont("Helvetica", 8)
    c.drawString(
        18 * mm,
        13 * mm,
        "Synthetic Compliance Fixture generated for Vendorcheck Verification Suite.",
    )

    c.showPage()
    c.save()


def generate_all_fixtures(force: bool = False) -> list[str]:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    generated: list[str] = []

    specs = [
        # --- SCENARIO 1: HAPPY PATH (IN) ---
        (
            "s1_gst_reg06.pdf",
            dict(
                header_bg=colors.HexColor("#1E3A5F"),
                authority="Government of India · Goods and Services Tax Network",
                doc_title="FORM GST REG-06 — Certificate of Registration",
                doc_subtitle="Tax Registration Certificate issued under Section 25 of CGST Act, 2017",
                doc_ref="GST-REG06-MH-2026-00912",
                fields=[
                    ("Document Category", "TAX_REGISTRATION"),
                    ("Legal Name", "Kiran Precision Components Pvt Ltd"),
                    ("Trade Name / DBA", "Kiran Precision Components"),
                    ("Constitution of Business", "Private Limited Company"),
                    ("Permanent Account Number (PAN)", "AABCK1234F"),
                    ("GSTIN / Secondary Tax ID", "27AABCK1234F1Z5"),
                    ("State Jurisdiction", "Maharashtra"),
                    ("Registration Status", "ACTIVE"),
                    ("Date of Liability", "2019-07-01"),
                    ("Expiry Date", "2029-06-30"),
                ],
                footer_notes=[
                    "This is a digitally signed GST registration certificate verified via GSTN Portal.",
                    "Principal Place of Business: MIDC Chakan Industrial Area, Pune, Maharashtra 410501.",
                ],
                stamp_text="VERIFIED DIGITAL REGISTRATION · STATUS: ACTIVE",
            ),
        ),
        (
            "s1_hdfc_bank_letter.pdf",
            dict(
                header_bg=colors.HexColor("#004C8F"),
                authority="HDFC Bank Limited · Corporate Banking Services",
                doc_title="Bank Account Verification Letter",
                doc_subtitle="Official Confirmation of Commercial Bank Account & NEFT/RTGS Coordinates",
                doc_ref="HDFC/CORP/VER/2026/88412",
                fields=[
                    ("Document Category", "BANK_PROOF"),
                    ("Bank Name", "HDFC Bank"),
                    ("Branch", "Pune MIDC Commercial Branch, Maharashtra"),
                    ("Account Holder Name", "Kiran Precision Components Private Limited"),
                    ("Account Number", "50200048192031"),
                    ("Account Type", "Current / Commercial"),
                    ("IFSC / Routing Code", "HDFC0000240"),
                    ("Account Status", "ACTIVE & OPERATIONAL"),
                    ("Name Printed on Cheque/Proof", "Yes"),
                    ("Issue Date", "2026-10-15"),
                ],
                footer_notes=[
                    "We hereby confirm that the above corporate current account is maintained in good standing.",
                    "Authorized Signatory: R. Deshmukh, Vice President — Corporate Banking, HDFC Bank.",
                ],
                stamp_text="HDFC BANK CORPORATE SEAL · AUTHORIZED VERIFICATION",
            ),
        ),
        (
            "s1_ca_turnover_cert.pdf",
            dict(
                header_bg=colors.HexColor("#14532D"),
                authority="S. Kulkarni & Associates · Chartered Accountants (ICAI FRN 114209W)",
                doc_title="Chartered Accountant Turnover & Good Standing Certificate",
                doc_subtitle="Statutory Vendor Financial Compliance & Annual Turnover Attestation",
                doc_ref="UDIN-26114209BKLM8821",
                fields=[
                    ("Document Category", "COMPLIANCE_CERT"),
                    ("Certificate Type", "CA Turnover & Good Standing Certificate"),
                    ("Entity Name", "Kiran Precision Components Pvt Ltd"),
                    ("PAN Reference", "AABCK1234F"),
                    ("Audited FY 2025-26 Turnover", "INR 48.60 Crores"),
                    ("Compliance Status", "ACTIVE"),
                    ("Issue Date", "2026-04-12"),
                    ("Expiry Date", "2028-03-31"),
                ],
                footer_notes=[
                    "Certified based on audited financial statements and GST annual returns GSTR-9.",
                    "UDIN verified on ICAI portal. No statutory dues pending as of certificate issue date.",
                ],
                stamp_text="ICAI CERTIFIED · VALID THROUGH 2028-03-31",
            ),
        ),
        # --- SCENARIO 2: STATE GSTIN MISMATCH + EXPIRED CA CERT (PENDING) ---
        (
            "s2_mp_gst_reg06.pdf",
            dict(
                header_bg=colors.HexColor("#1E3A5F"),
                authority="Government of India · Goods and Services Tax Network",
                doc_title="FORM GST REG-06 — Certificate of Registration",
                doc_subtitle="Tax Registration Certificate issued under Section 25 of CGST Act, 2017",
                doc_ref="GST-REG06-MP-2025-44108",
                fields=[
                    ("Document Category", "TAX_REGISTRATION"),
                    ("Legal Name", "Apex Infra Solutions Pvt Ltd"),
                    ("Trade Name / DBA", "Apex Infra Solutions"),
                    ("Constitution of Business", "Private Limited Company"),
                    ("Permanent Account Number (PAN)", "AABCA5678M"),
                    ("GSTIN / Secondary Tax ID", "23AABCA5678M1Z2"),
                    ("State Jurisdiction", "Madhya Pradesh"),
                    ("Registration Status", "ACTIVE"),
                    ("Date of Liability", "2021-04-01"),
                    ("Expiry Date", "2029-03-31"),
                ],
                footer_notes=[
                    "Principal Place of Business: MP Nagar Zone II, Bhopal, Madhya Pradesh 462011.",
                    "Note: Registration covers Madhya Pradesh (State Code 23) jurisdiction only.",
                ],
                stamp_text="GSTN DIGITAL CERTIFICATE · STATE CODE 23 (MADHYA PRADESH)",
            ),
        ),
        (
            "s2_hdfc_bank_letter.pdf",
            dict(
                header_bg=colors.HexColor("#004C8F"),
                authority="HDFC Bank Limited · Corporate Banking Services",
                doc_title="Bank Account Verification Letter",
                doc_subtitle="Official Confirmation of Corporate Bank Account Coordinates",
                doc_ref="HDFC/DEL/VER/2026/55210",
                fields=[
                    ("Document Category", "BANK_PROOF"),
                    ("Bank Name", "HDFC Bank"),
                    ("Branch", "Connaught Place Corporate Branch, New Delhi"),
                    ("Account Holder Name", "Apex Infra Solutions Pvt Ltd"),
                    ("Account Number", "50200077218944"),
                    ("Account Type", "Current / Commercial"),
                    ("IFSC / Routing Code", "HDFC0000003"),
                    ("Account Status", "ACTIVE"),
                    ("Name Printed on Cheque/Proof", "Yes"),
                    ("Issue Date", "2026-10-20"),
                ],
                footer_notes=[
                    "Account verified and maintained in active operational standing with HDFC Bank.",
                    "Authorized Signatory: N. Verma, Branch Manager, HDFC Bank New Delhi.",
                ],
                stamp_text="HDFC BANK CORPORATE SEAL · AUTHORIZED VERIFICATION",
            ),
        ),
        (
            "s2_expired_ca_cert.pdf",
            dict(
                header_bg=colors.HexColor("#92400E"),
                authority="V. Sharma & Co. · Chartered Accountants (ICAI FRN 009812N)",
                doc_title="Chartered Accountant Turnover Certificate",
                doc_subtitle="Annual Financial Turnover & Statutory Compliance Attestation (FY 2023-24)",
                doc_ref="UDIN-24009812ABCV1904",
                fields=[
                    ("Document Category", "COMPLIANCE_CERT"),
                    ("Certificate Type", "CA Turnover Certificate"),
                    ("Entity Name", "Apex Infra Solutions Pvt Ltd"),
                    ("PAN Reference", "AABCA5678M"),
                    ("Audited FY 2023-24 Turnover", "INR 19.20 Crores"),
                    ("Compliance Status", "EXPIRED"),
                    ("Issue Date", "2024-04-05"),
                    ("Expiry Date", "2025-03-31"),
                ],
                footer_notes=[
                    "Valid for FY 2024-25 procurement cycles only; renewal required post 2025-03-31.",
                    "UDIN verified on ICAI portal at time of original issuance.",
                ],
                stamp_text="CERTIFICATE VALIDITY ENDED ON 2025-03-31",
                stamp_color=colors.HexColor("#B45309"),
            ),
        ),
        # --- SCENARIO 3: PAN CONSTITUTION MISMATCH + BANK DIVERSION (REJECTED) ---
        (
            "s3_tax_pan_gst.pdf",
            dict(
                header_bg=colors.HexColor("#1E3A5F"),
                authority="Income Tax Department & GSTN · Composite Tax Extract",
                doc_title="Tax Registration & PAN Verification Record",
                doc_subtitle="Submitted Tax Registration Summary for Vendor Onboarding",
                doc_ref="TAX-IN-MH-2026-71892",
                fields=[
                    ("Document Category", "TAX_REGISTRATION"),
                    ("Legal Name", "Mehta Industrial Engineering Pvt Ltd"),
                    ("Trade Name / DBA", "Mehta Industrial Engineering"),
                    ("Permanent Account Number (PAN)", "ABCPM9102K"),
                    ("PAN Holder Category (4th Char)", "P — Individual / Proprietor"),
                    ("GSTIN / Secondary Tax ID", "27ABCPM9102K1Z9"),
                    ("State Jurisdiction", "Maharashtra"),
                    ("Registration Status", "ACTIVE"),
                    ("Expiry Date", "2028-12-31"),
                ],
                footer_notes=[
                    "Warning: Submitted PAN 4th character denotes Individual ('P') taxpayer category.",
                    "Issued from uploaded vendor tax registration filing.",
                ],
                stamp_text="TAX RECORD EXTRACT · PAN: ABCPM9102K",
                stamp_color=colors.HexColor("#991B1B"),
            ),
        ),
        (
            "s3_icici_bank_diversion.pdf",
            dict(
                header_bg=colors.HexColor("#7C2D12"),
                authority="ICICI Bank Limited · Business Banking Division",
                doc_title="Bank Account Verification Letter",
                doc_subtitle="Confirmation of Account Holder Details & Electronic Transfer Routing",
                doc_ref="ICICI/MUM/VER/2026/60911",
                fields=[
                    ("Document Category", "BANK_PROOF"),
                    ("Bank Name", "ICICI Bank"),
                    ("Branch", "Nariman Point Branch, Mumbai"),
                    ("Account Holder Name", "Mehta Global Trading Co."),
                    ("Account Number", "000405118823"),
                    ("Account Type", "Current / Commercial"),
                    ("IFSC / Routing Code", "ICIC0000004"),
                    ("Account Status", "ACTIVE"),
                    ("Name Printed on Cheque/Proof", "Yes"),
                    ("Issue Date", "2026-11-01"),
                ],
                footer_notes=[
                    "This confirms that account 000405118823 is solely held by Mehta Global Trading Co.",
                    "Authorized Signatory: S. Nair, Relationship Manager, ICICI Bank Mumbai.",
                ],
                stamp_text="ICICI BANK VERIFICATION · BENEFICIARY: MEHTA GLOBAL TRADING CO.",
                stamp_color=colors.HexColor("#991B1B"),
            ),
        ),
        # --- SCENARIO 4A: CROSS-BORDER DE TAX ERROR + WRONG ATTACHMENT (PENDING) ---
        (
            "s4a_de_tax_doc.pdf",
            dict(
                header_bg=colors.HexColor("#1E293B"),
                authority="Bundeszentralamt für Steuern · Cross-Border Tax Profile",
                doc_title="Tax Registration & VAT Identification Filing (Germany)",
                doc_subtitle="Vendor Self-Declared Foreign Tax Registration Document",
                doc_ref="DE-TAX-FILING-2026-3041",
                fields=[
                    ("Document Category", "TAX_REGISTRATION"),
                    ("Legal Name", "Nordic Cloud Systems GmbH"),
                    ("Trade Name / DBA", "Nordic Cloud Systems"),
                    ("Country of Incorporation", "DE (Germany)"),
                    ("State / Region", "Berlin"),
                    ("Tax Identification Number", "92-4810293"),
                    ("Registration Status", "ACTIVE"),
                    ("Expiry Date", "2028-12-31"),
                ],
                footer_notes=[
                    "Submitted tax identifier 92-4810293 appears formatted as a US EIN rather than DE USt-IdNr.",
                    "Registered Office: Friedrichstrasse 114A, 10117 Berlin, Germany.",
                ],
                stamp_text="CROSS-BORDER TAX FILING · JURISDICTION: DE",
                stamp_color=colors.HexColor("#B45309"),
            ),
        ),
        (
            "s4a_hosting_invoice.pdf",
            dict(
                header_bg=colors.HexColor("#475569"),
                authority="Hetzner Cloud Infrastructure GmbH",
                doc_title="COMMERCIAL INVOICE #INV-2026-8841",
                doc_subtitle="Monthly Dedicated Server & Cloud Bandwidth Billing Statement",
                doc_ref="INV-2026-8841-EU",
                fields=[
                    ("Document Category", "COMMERCIAL_INVOICE"),
                    ("Invoice Number", "INV-2026-8841"),
                    ("Billed To", "Nordic Cloud Systems GmbH"),
                    ("Billing Period", "2026-10-01 to 2026-10-31"),
                    ("Line Item 1", "4x Dedicated Bare-Metal GPU Nodes — EUR 2,400.00"),
                    ("Line Item 2", "10TB Outbound EU Cloud Egress — EUR 320.00"),
                    ("Total Amount Due", "EUR 2,720.00"),
                    ("Payment Terms", "Net 15 Days"),
                ],
                footer_notes=[
                    "THIS DOCUMENT IS A COMMERCIAL BILLING INVOICE — NOT A BANK VERIFICATION LETTER.",
                    "Please remit payment referencing invoice number INV-2026-8841.",
                ],
                stamp_text="COMMERCIAL INVOICE · NOT VALID AS BANK PROOF",
                stamp_color=colors.HexColor("#DC2626"),
            ),
        ),
        # --- SCENARIO 4B: UK DBA ENTITY RESOLUTION (APPROVED WITH AUDIT NOTE) ---
        (
            "s4b_hmrc_vat_cert.pdf",
            dict(
                header_bg=colors.HexColor("#064E3B"),
                authority="HM Revenue & Customs · United Kingdom",
                doc_title="Value Added Tax (VAT) Registration Certificate",
                doc_subtitle="Official HMRC Confirmation of UK VAT Registration & Trading Style",
                doc_ref="HMRC-VAT-2026-987654321",
                fields=[
                    ("Document Category", "TAX_REGISTRATION"),
                    ("Legal Name", "Meridian Freight Holdings Ltd"),
                    ("Trading As / DBA", "NovaPay Logistics"),
                    ("VAT Registration Number", "GB987654321"),
                    ("Country", "UK (United Kingdom)"),
                    ("Region / State", "England"),
                    ("Registration Status", "ACTIVE"),
                    ("Effective Date", "2020-02-01"),
                    ("Expiry Date", "2030-01-31"),
                ],
                footer_notes=[
                    "HMRC confirms Meridian Freight Holdings Ltd is registered for VAT trading as NovaPay Logistics.",
                    "Registered Address: 42 Bishopsgate, London EC2N 4AH, England, United Kingdom.",
                ],
                stamp_text="HM REVENUE & CUSTOMS · ACTIVE UK VAT REGISTRATION",
            ),
        ),
        (
            "s4b_barclays_bank_letter.pdf",
            dict(
                header_bg=colors.HexColor("#0369A1"),
                authority="Barclays Bank UK PLC · Corporate Treasury Services",
                doc_title="Business Bank Account Confirmation Letter",
                doc_subtitle="Official Confirmation of Sterling Commercial Account Details",
                doc_ref="BARC/UK/CORP/2026/49182",
                fields=[
                    ("Document Category", "BANK_PROOF"),
                    ("Bank Name", "Barclays Bank UK"),
                    ("Branch", "Canary Wharf Corporate Banking Centre, London"),
                    ("Account Holder Name", "Meridian Freight Holdings Ltd"),
                    ("Account Number", "20491822"),
                    ("Account Type", "Current / Commercial"),
                    ("Sort Code / Routing Code", "20-45-12"),
                    ("Account Status", "ACTIVE & VERIFIED"),
                    ("Name Printed on Cheque/Proof", "Yes"),
                    ("Issue Date", "2026-11-05"),
                ],
                footer_notes=[
                    "Barclays confirms that the commercial current account above is held by Meridian Freight Holdings Ltd.",
                    "Authorized Signatory: E. Thornton, Corporate Banking Director, Barclays Bank UK PLC.",
                ],
                stamp_text="BARCLAYS BANK UK PLC · VERIFIED CORPORATE ACCOUNT",
            ),
        ),
    ]

    for filename, kwargs in specs:
        out_path = FIXTURES_DIR / filename
        if force or not out_path.exists():
            _render_structured_pdf(out_path, **kwargs)
            generated.append(filename)

    return generated


if __name__ == "__main__":
    created = generate_all_fixtures(force=True)
    print(f"Generated {len(created)} synthetic PDF fixtures in {FIXTURES_DIR}:")
    for name in created:
        print(f"  - {name}")
