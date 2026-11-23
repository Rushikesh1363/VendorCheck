import React from 'react'
import {
  ShieldCheck,
  Cpu,
  Scale,
  GitBranch,
  Layers,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react'
import { formatEngineLabel } from '../utils/formatters'

const COMPLIANCE_RULES = [
  // Category 1: Documents & Submission
  {
    key: 'form-completeness',
    name: 'Required Onboarding Details',
    category: 'Documents & Submission',
    checks:
      'Verifies all 10 required onboarding fields (legal name, entity constitution, country, billing state, tax ID, account holder, account number, account type, routing code, and contact email) are completed.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'tax-doc-type',
    name: 'Tax Registration Document',
    category: 'Documents & Submission',
    checks:
      'Confirms a readable PDF is uploaded in the Tax Registration slot and verified as an official tax certificate (flagging blank, unreadable, or unrelated files).',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'bank-doc-type',
    name: 'Bank Verification Document',
    category: 'Documents & Submission',
    checks:
      'Confirms a readable PDF is uploaded in the Bank Proof slot and verified as a bank verification letter or cancelled cheque (catching commercial invoices or unrelated files).',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'compliance-doc-type',
    name: 'Optional Compliance Certificate',
    category: 'Documents & Submission',
    checks:
      'When provided, confirms the attachment is readable and verified as a CA Turnover, MSME Udyam, or Good Standing certificate.',
    severity: 'Moderate',
    outcome: 'Pending',
  },

  // Category 2: Tax & Jurisdiction
  {
    key: 'in-pan-format',
    name: 'India PAN Format Validation',
    category: 'Tax & Jurisdiction',
    checks: 'Validates the 10-character alphanumeric PAN structure.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'in-pan-entity',
    name: 'India PAN Entity-Type Match',
    category: 'Tax & Jurisdiction',
    checks:
      'Matches the 4th character of the PAN against entity constitution (C for Company, P for Proprietorship, F for LLP). Submitting a Personal (P) PAN for a Private Limited company triggers a critical block.',
    severity: 'Critical',
    outcome: 'Rejected',
  },
  {
    key: 'in-gstin-format',
    name: 'India GSTIN Format Validation',
    category: 'Tax & Jurisdiction',
    checks: 'Validates the 15-character alphanumeric GSTIN structure.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'in-gstin-pan',
    name: 'India GSTIN Embedded PAN Match',
    category: 'Tax & Jurisdiction',
    checks:
      'Verifies characters 3 through 12 of the GSTIN match the submitted 10-character PAN. A mismatch triggers a critical block.',
    severity: 'Critical',
    outcome: 'Rejected',
  },
  {
    key: 'in-gstin-state',
    name: 'India GSTIN State Prefix Routing',
    category: 'Tax & Jurisdiction',
    checks:
      'Cross-checks the 2-digit GSTIN state prefix (such as 27 for Maharashtra, 07 for Delhi, or 23 for Madhya Pradesh) against the selected Billing State across all 36 Indian states and union territories.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'in-ifsc',
    name: 'India IFSC Routing Code',
    category: 'Tax & Jurisdiction',
    checks:
      'Validates the standard 11-character RBI NEFT/RTGS IFSC bank routing format (4 letters, zero, and 6 alphanumeric characters).',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'us-tax-routing',
    name: 'US Federal EIN & ABA Routing',
    category: 'Tax & Jurisdiction',
    checks:
      'Validates the 9-digit US Employer Identification Number (XX-XXXXXXX) and 9-digit US ABA bank routing number.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'uk-tax-routing',
    name: 'UK HMRC VAT & Bank Sort Code',
    category: 'Tax & Jurisdiction',
    checks:
      'Validates the UK HMRC VAT number (GB followed by 9 digits) and 6-digit UK bank sort code (XX-XX-XX).',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'ae-au-tax',
    name: 'UAE TRN & Australian ABN',
    category: 'Tax & Jurisdiction',
    checks:
      'Validates the 15-digit UAE Tax Registration Number (starting with 100) and the 11-digit Australian Business Number.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'cross-border',
    name: 'Cross-Border Tax ID Policy',
    category: 'Tax & Jurisdiction',
    checks:
      'Evaluates manually entered international jurisdictions (such as Germany VAT ID DE + 9 digits, France, Singapore, Netherlands, and Canada) and flags cross-country ID mix-ups like entering a US EIN for Germany.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'tax-doc-crossmatch',
    name: 'Form vs. Tax Certificate Cross-Match',
    category: 'Tax & Jurisdiction',
    checks:
      'Confirms the primary tax ID and GSTIN / state tax ID entered on the form match the identifiers extracted from the uploaded Tax Registration Certificate.',
    severity: 'Moderate',
    outcome: 'Pending',
  },

  // Category 3: Banking & Anti-Fraud
  {
    key: 'beneficiary-match',
    name: 'Bank Beneficiary & Trade Name Verification',
    category: 'Banking & Anti-Fraud',
    checks:
      'Matches the bank letter account holder against the Legal Entity Name (normalizing suffixes like Pvt Ltd and Private Limited) or an officially linked Trading As / DBA name on the Tax Certificate. Blocks unrelated third-party payout accounts.',
    severity: 'Critical',
    outcome: 'Rejected',
  },
  {
    key: 'bank-coords',
    name: 'Bank Account & Routing Cross-Match',
    category: 'Banking & Anti-Fraud',
    checks:
      'Confirms the account number / IBAN and routing code entered on the form match the coordinates printed on the Bank Verification Proof.',
    severity: 'Moderate',
    outcome: 'Pending',
  },
  {
    key: 'corp-account-type',
    name: 'Corporate Account Type Policy',
    category: 'Banking & Anti-Fraud',
    checks:
      'Requires Private Limited and LLP / Partnership vendors to provide a Current / Commercial bank account rather than a Savings / Personal account.',
    severity: 'Moderate',
    outcome: 'Pending',
  },

  // Category 4: Document Validity
  {
    key: 'doc-validity',
    name: 'Registration & Certificate Expiry Check',
    category: 'Document Validity',
    checks:
      'Verifies that Tax Registration and Compliance Certificates are active (not expired, suspended, cancelled, or revoked) and valid on or after the Nov 20, 2026 review date.',
    severity: 'Moderate',
    outcome: 'Pending',
  },

  // Category 5: Duplicate Screening
  {
    key: 'duplicate-bank',
    name: 'Duplicate Bank Account Screening',
    category: 'Duplicate Screening',
    checks:
      'Screens historical vendor records (excluding previously rejected attempts) to block reuse of the same bank account number across unrelated legal entities.',
    severity: 'Critical',
    outcome: 'Rejected',
  },
]

function SeverityBadge({ severity }) {
  if (severity === 'Critical') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800">
        Critical
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
      Moderate
    </span>
  )
}

function OutcomeBadge({ outcome }) {
  if (outcome === 'Rejected') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
      Pending
    </span>
  )
}

export default function PolicyView({ health }) {
  return (
    <div className="space-y-6">
      {/* Header & Runtime Engine Strip */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Verification Policy &amp; Assumptions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete guide to every compliance check, decision threshold, and operational safeguard
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl bg-indigo-50/80 px-4 py-2.5 text-xs">
            <Cpu className="h-4 w-4 text-indigo-600 shrink-0" />
            <div>
              <span className="font-semibold text-indigo-950">Document Extraction: </span>
              <span className="text-indigo-800">
                {formatEngineLabel(health?.extraction_mode)} (with automatic fallback)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Exhaustive Compliance Rules Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Compliance Rule Matrix ({COMPLIANCE_RULES.length} Checks · 5 Categories)
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            Enforced automatically on every vendor submission
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Rule Name</th>
                <th className="px-4 py-3 whitespace-nowrap">Category</th>
                <th className="px-4 py-3">What It Checks</th>
                <th className="px-4 py-3 whitespace-nowrap">Severity</th>
                <th className="px-5 py-3 whitespace-nowrap">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {COMPLIANCE_RULES.map((rule) => (
                <tr key={rule.key} className="hover:bg-slate-50/70 transition">
                  <td className="px-5 py-3.5 align-top min-w-[210px] font-semibold text-slate-900">
                    {rule.name}
                  </td>
                  <td className="px-4 py-3.5 align-top whitespace-nowrap">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                      {rule.category}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top text-slate-600 leading-relaxed max-w-xl">
                    {rule.checks}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <SeverityBadge severity={rule.severity} />
                  </td>
                  <td className="px-5 py-3.5 align-top">
                    <OutcomeBadge outcome={rule.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Three Concise Architectural Sections Below the Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Decisioning & Routing Logic */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3.5">
            <GitBranch className="h-4 w-4 text-indigo-600" />
            Decisioning &amp; Routing Logic
          </div>
          <div className="space-y-3 text-xs text-slate-600 leading-relaxed flex-1">
            <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50/70 px-3.5 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-emerald-900">Approved: </span>
                All compliance checks pass with zero issues. Corporate suffix differences (such as Pvt Ltd and Private Limited) are normalized automatically, and verified Trade Name / DBA links are documented with an Audit Note.
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50/70 px-3.5 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-amber-900">Pending: </span>
                One or more <strong>Moderate</strong> issues are found with zero Critical risks (for example, a wrong GSTIN state prefix, an expired certificate, or an incorrect attachment). A plain-English follow-up email is drafted automatically.
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-rose-50/70 px-3.5 py-2.5">
              <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-rose-900">Rejected: </span>
                Any single <strong>Critical</strong> risk is detected — including third-party bank beneficiary diversion, a Personal PAN submitted for a corporation, an embedded PAN mismatch, or a duplicate bank account across unrelated vendors. Onboarding is blocked and escalated to Risk &amp; Treasury.
              </div>
            </div>
          </div>
        </div>

        {/* 2. Hybrid Architecture Boundary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3.5">
            <Layers className="h-4 w-4 text-indigo-600" />
            Hybrid Architecture Boundary
          </div>
          <div className="space-y-3 text-xs text-slate-600 leading-relaxed flex-1">
            <div className="rounded-xl bg-indigo-50/60 px-3.5 py-3">
              <div className="font-bold text-indigo-950 mb-1">
                AI Document Extraction (Gemini 3.5 Flash-Lite)
              </div>
              <p>
                Strictly scoped to reading unstructured vendor PDFs — classifying uploaded documents and extracting structured tax, banking, and expiry fields. If the AI service is unavailable or rate-limited, extraction falls back seamlessly to the standard PDF parser.
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3.5 py-3">
              <div className="font-bold text-slate-900 mb-1">
                Deterministic Compliance Engine (Pure Python)
              </div>
              <p>
                Handles 100% of compliance checks, jurisdiction rules, duplicate bank account screening, approval thresholds, and follow-up email templates. Keeping compliance decisions out of the AI model ensures zero hallucinations and fully auditable outcomes.
              </p>
            </div>
          </div>
        </div>

        {/* 3. Production Assumptions & Next Steps */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3.5">
            <Rocket className="h-4 w-4 text-indigo-600" />
            Production Assumptions &amp; Next Steps
          </div>
          <ul className="space-y-3 text-xs text-slate-600 leading-relaxed flex-1">
            <li className="rounded-xl bg-indigo-50/60 border border-indigo-100 px-3.5 py-2.5">
              <span className="font-bold text-indigo-950 block mb-0.5">
                Production Separation
              </span>
              In a live deployment, the Vendor Portal (left) is served as an external link/form to vendors, while the Verification Engine &amp; Audit Dashboard (right) are restricted to internal Procurement/AP teams. Both are shown side-by-side here as an end-to-end testing sandbox.
            </li>
            <li className="rounded-xl bg-slate-50 px-3.5 py-2.5">
              <span className="font-bold text-slate-900 block mb-0.5">
                Live External Registry &amp; Penny-Drop APIs
              </span>
              Connect to live GSTN / NSDL (India), EU VIES VAT lookup, IRS TIN matching, and real-time Bank Penny-Drop verification to confirm active registrations and live account ownership directly with official registries.
            </li>
            <li className="rounded-xl bg-slate-50 px-3.5 py-2.5">
              <span className="font-bold text-slate-900 block mb-0.5">
                Human-in-the-Loop Review for Low-Legibility Scans
              </span>
              Route blurry, skewed, or low-confidence PDF scans (below 85% extraction confidence) to an operations analyst queue instead of hard-rejecting legitimate vendors.
            </li>
            <li className="rounded-xl bg-slate-50 px-3.5 py-2.5">
              <span className="font-bold text-slate-900 block mb-0.5">
                Live System-Date Expiry Evaluation
              </span>
              Replace the pinned reference review date (Nov 20, 2026) with live daily system dates and configurable 30-day advance certificate renewal alerts.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
