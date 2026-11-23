import React, { useMemo, useState } from 'react'
import {
  ShieldCheck,
  Cpu,
  Scale,
  GitBranch,
  Lightbulb,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react'
import { formatEngineLabel } from '../utils/formatters'

const TRIAGE_THRESHOLDS = [
  {
    key: 'approved',
    title: 'Approved — Straight-Through Processing',
    description:
      '0 Critical and 0 Moderate flags. Auto-approved for ERP vendor master creation, with optional informational Audit Notes for borderline reconciliations.',
    icon: CheckCircle2,
    cardClass: 'border-emerald-200/90 border-t-4 border-t-emerald-500 bg-white',
    iconWrapClass: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/70',
    titleClass: 'text-emerald-950',
    badgeText: '0 Critical · 0 Moderate',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  },
  {
    key: 'pending',
    title: 'Pending — Recoverable Hold',
    description:
      '1+ Moderate flags (missing fields, unreadable/swapped PDF, format typo, expired certificate, or Savings account for a company). Routes back to the vendor with an itemized remediation email.',
    icon: AlertTriangle,
    cardClass: 'border-amber-200/90 border-t-4 border-t-amber-500 bg-white',
    iconWrapClass: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200/70',
    titleClass: 'text-amber-950',
    badgeText: '1+ Moderate · 0 Critical',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200/80',
  },
  {
    key: 'rejected',
    title: 'Rejected — Critical Compliance Block',
    description:
      '1+ Critical flags (entity PAN mismatch, GSTIN embedded PAN mismatch, unrelated third-party bank beneficiary, or duplicate bank account across entities). Blocks onboarding and escalates to Risk & Treasury.',
    icon: ShieldAlert,
    cardClass: 'border-rose-200/90 border-t-4 border-t-rose-500 bg-white',
    iconWrapClass: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/70',
    titleClass: 'text-rose-950',
    badgeText: '1+ Critical Flag',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200/80',
  },
]

const PRODUCT_ASSUMPTIONS = [
  {
    key: 'real-world-intake',
    title: 'Real-World Intake & PDF Ingestion (Over Raw JSON)',
    decision:
      'Built a realistic vendor submission form accepting multi-page compliance PDFs rather than pre-parsed JSON.',
    why: 'Real procurement bottlenecks happen in the gap between form inputs and printed PDFs, requiring true OCR and cross-document reconciliation.',
  },
  {
    key: 'india-global-corridors',
    title: 'India-First Jurisdictional Depth + Global Corridors',
    decision:
      'Modeled deep statutory rules for India (PAN 4th-char entity check, GSTIN embedded PAN & 36-state prefix routing, RBI IFSC) alongside US, UK, UAE, Australia, and EU/SG/CA corridors.',
    why: 'Indian IDs encode entity type and geography directly in the string, while global rules dynamically adapt fields and block cross-country ID mix-ups.',
  },
  {
    key: 'decoupled-ocr-engine',
    title: 'Decoupled Multimodal OCR & Deterministic Decisioning',
    decision:
      'Used Gemini 3.5 Flash-Lite (with pdfplumber fallback) strictly for PDF classification and field extraction, while a deterministic 20-rule Python engine computes every verdict.',
    why: 'Guarantees 100% explainable audit trails and prevents LLM hallucinations from approving fraudulent payouts.',
  },
  {
    key: 'pre-extraction-classification',
    title: 'Pre-Extraction Document Classification',
    decision:
      'Classifies whether each PDF is genuinely a Tax Certificate, Bank Proof, or Compliance Certificate before extracting numbers.',
    why: 'Catches swapped attachments (like commercial invoices in the bank slot) upfront instead of failing silently.',
  },
  {
    key: 'false-negative-hitl',
    title: 'False-Negative Prevention & HITL Audit Notes',
    decision:
      'Normalizes corporate suffixes (Pvt Ltd vs. Private Limited) and reconciles Trading As / DBA names on bank letters against official Tax Certificates.',
    why: 'Approves legitimate DBA vendors without friction while surfacing blue Audit Notes and side-by-side PDF previews for 1-click human verification.',
  },
  {
    key: 'risk-tiered-outreach',
    title: 'Risk-Tiered Triage & Automated Vendor Outreach',
    decision:
      'Separates fixable operational errors (Pending) from structural fraud blocks (Rejected) and drafts plain-English remediation or rejection emails automatically.',
    why: 'Eliminates manual follow-up drafting for procurement teams while giving vendors clear, actionable next steps.',
  },
  {
    key: 'unified-sandbox-kyb',
    title: 'Unified Sandbox & Offline KYB Simulation',
    decision:
      'Co-locates external vendor intake and the internal AP workbench side-by-side for evaluation, simulating live government/banking registries (NSDL, GSTN, penny-drop) via offline checksum and cross-match rules.',
    why: 'Enables end-to-end sandbox testing while mapping cleanly to separated external/internal portals and live production API hooks.',
  },
  {
    key: 'deterministic-date-duplicates',
    title: 'Deterministic Date Baseline & Duplicate Screening',
    decision:
      'Anchors certificate expiry checks to November 23, 2026, and screens historical non-rejected records to block duplicate bank accounts across different entities.',
    why: "Keeps expiry testing reproducible and excludes prior Rejected runs so legitimate vendors aren't permanently locked out.",
  },
]

const RULE_CATEGORIES = [
  'Documents & Submission',
  'Tax & Jurisdiction',
  'Banking & Anti-Fraud',
  'Document Validity',
  'Duplicate Screening',
]

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
      'Verifies that Tax Registration and Compliance Certificates are active (not expired, suspended, cancelled, or revoked) and valid on or after the Nov 23, 2026 review date.',
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
  const [selectedCategory, setSelectedCategory] = useState('ALL')

  const categoryCounts = useMemo(() => {
    const counts = {}
    for (const rule of COMPLIANCE_RULES) {
      counts[rule.category] = (counts[rule.category] || 0) + 1
    }
    return counts
  }, [])

  const filteredRules = useMemo(() => {
    if (selectedCategory === 'ALL') return COMPLIANCE_RULES
    return COMPLIANCE_RULES.filter((rule) => rule.category === selectedCategory)
  }, [selectedCategory])

  return (
    <div className="space-y-6">
      {/* 1. Header & Runtime Engine Strip */}
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

      {/* 2. Decision Triage Thresholds (3-Column Strip) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">Decision Triage Thresholds</h3>
          </div>
          <span className="text-xs text-slate-500">
            Deterministic routing based on check severity
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TRIAGE_THRESHOLDS.map((tier) => {
            const Icon = tier.icon
            return (
              <div
                key={tier.key}
                className={`rounded-2xl border p-5 shadow-soft flex flex-col gap-3 ${tier.cardClass}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tier.iconWrapClass}`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tier.badgeClass}`}
                  >
                    {tier.badgeText}
                  </span>
                </div>

                <div>
                  <h4 className={`text-sm font-bold leading-snug ${tier.titleClass}`}>
                    {tier.title}
                  </h4>
                  <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                    {tier.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 3. Product Thinking & Engineering Assumptions (2-Column Grid, 8 Cards) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Product Thinking &amp; Engineering Assumptions
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            Key architectural trade-offs and design rationale
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PRODUCT_ASSUMPTIONS.map((item, idx) => (
            <div
              key={item.key}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft flex flex-col gap-3"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200/70">
                  {idx + 1}
                </span>
                <h4 className="text-sm font-bold text-slate-900 leading-snug">{item.title}</h4>
              </div>

              <div className="space-y-2 text-xs leading-relaxed">
                <p className="text-slate-700">
                  <span className="font-semibold text-slate-900">Decision: </span>
                  {item.decision}
                </p>
                <p className="rounded-lg bg-slate-50 border border-slate-200/70 px-3 py-2 text-slate-600">
                  <span className="font-semibold text-indigo-900">Why: </span>
                  {item.why}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Compliance Rule Matrix (20 Checks · 5 Categories) with Interactive Category Filter Pills */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Compliance Rule Matrix ({COMPLIANCE_RULES.length} Checks · 5 Categories)
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              Showing {filteredRules.length} of {COMPLIANCE_RULES.length} automated checks
            </span>
          </div>

          {/* Interactive Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
              }`}
            >
              All ({COMPLIANCE_RULES.length})
            </button>

            {RULE_CATEGORIES.map((category) => {
              const isActive = selectedCategory === category
              const count = categoryCounts[category] || 0
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                  }`}
                >
                  <span>{category}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isActive
                        ? 'bg-indigo-500/80 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
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
              {filteredRules.map((rule) => (
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
    </div>
  )
}
