import React from 'react'
import { X, ShieldCheck, Cpu, Scale, Globe2, AlertTriangle, CheckCircle2 } from 'lucide-react'

export default function PolicyModal({ isOpen, onClose, health }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Verification Policy &amp; Hybrid Architecture Assumptions
              </h2>
              <p className="text-xs text-slate-500">
                Separating Probabilistic AI Extraction from Deterministic Compliance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-sm text-slate-600 leading-relaxed">
          {/* Runtime Mode Banner */}
          <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Cpu className="h-4 w-4 text-indigo-600 shrink-0" />
              <div>
                <span className="font-semibold text-indigo-950">Active Extraction Engine: </span>
                <span className="font-mono text-xs text-indigo-800">
                  {health?.extraction_mode || 'gemini-3.5-flash-lite (with pdfplumber fallback)'}
                </span>
              </div>
            </div>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
              Zero-Crash Fallback Enabled
            </span>
          </div>

          {/* 4-Stage Pipeline */}
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900 mb-3">
              <Scale className="h-4 w-4 text-indigo-600" />
              4-Stage Hybrid Execution Pipeline
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="font-semibold text-slate-900 mb-1">1. Intake &amp; Classification (AI)</div>
                <p className="text-xs text-slate-600">
                  Verifies PDF readability and classifies attachments into <code className="font-mono">TAX_REGISTRATION</code>,{' '}
                  <code className="font-mono">BANK_PROOF</code>, <code className="font-mono">COMPLIANCE_CERT</code>, or{' '}
                  <code className="font-mono">WRONG_DOCUMENT</code> (e.g., commercial invoices or blank sheets).
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="font-semibold text-slate-900 mb-1">2. Structured Extraction (Schema + Fallback)</div>
                <p className="text-xs text-slate-600">
                  Uses Gemini 3.5 Flash-Lite with strict Pydantic <code className="font-mono">response_schema</code> JSON outputs.
                  If <code className="font-mono">GEMINI_API_KEY</code> is absent or rate-limited, seamlessly falls back to deterministic{' '}
                  <code className="font-mono">pdfplumber</code> regex extraction.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="font-semibold text-slate-900 mb-1">3. Deterministic Rule Engine (Pure Python)</div>
                <p className="text-xs text-slate-600">
                  Zero LLM guessing on compliance checks. Executes exact regex, PAN constitution, GSTIN embedded-PAN &amp; state prefix routing,
                  corporate suffix normalization, DBA linkage, expiry vs <code className="font-mono">2026-11-20</code>, and SQLite duplicate bank checks.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="font-semibold text-slate-900 mb-1">4. Decision Routing &amp; Remediation</div>
                <p className="text-xs text-slate-600">
                  Routes to <span className="font-semibold text-emerald-700">APPROVED</span>,{' '}
                  <span className="font-semibold text-amber-700">PENDING</span>, or{' '}
                  <span className="font-semibold text-rose-700">REJECTED</span>, persists full JSON telemetry to SQLite,
                  and drafts itemized plain-English vendor remediation notices.
                </p>
              </div>
            </div>
          </div>

          {/* Multi-Jurisdiction Rules */}
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900 mb-2.5">
              <Globe2 className="h-4 w-4 text-indigo-600" />
              Jurisdiction Tax &amp; Banking Rules
            </h3>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-2 font-semibold">Country</th>
                    <th className="px-3.5 py-2 font-semibold">Tax Identifier Rule</th>
                    <th className="px-3.5 py-2 font-semibold">Routing &amp; Cross-Checks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-3.5 py-2 font-mono font-semibold text-slate-900">IN</td>
                    <td className="px-3.5 py-2">
                      PAN <code className="font-mono">^[A-Z]&#123;5&#125;[0-9]&#123;4&#125;[A-Z]$</code> + 4th char (<code className="font-mono">C</code>=Corp, <code className="font-mono">P</code>=Prop, <code className="font-mono">F</code>=LLP)
                    </td>
                    <td className="px-3.5 py-2">
                      15-char GSTIN embedded PAN match + 2-digit State Prefix (<code className="font-mono">07</code>=Delhi, <code className="font-mono">27</code>=MH, <code className="font-mono">23</code>=MP) + IFSC
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-2 font-mono font-semibold text-slate-900">US</td>
                    <td className="px-3.5 py-2">EIN <code className="font-mono">^\d&#123;2&#125;-\d&#123;7&#125;$</code></td>
                    <td className="px-3.5 py-2">9-digit ABA Routing (<code className="font-mono">^\d&#123;9&#125;$</code>)</td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-2 font-mono font-semibold text-slate-900">UK</td>
                    <td className="px-3.5 py-2">HMRC VAT <code className="font-mono">^GB\d&#123;9&#125;$</code></td>
                    <td className="px-3.5 py-2">Sort Code (<code className="font-mono">^\d&#123;2&#125;-\d&#123;2&#125;-\d&#123;2&#125;$</code>) + Official Trading As / DBA linkage</td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-2 font-mono font-semibold text-slate-900">AE / AU</td>
                    <td className="px-3.5 py-2">UAE TRN <code className="font-mono">^100\d&#123;12&#125;$</code> · AU ABN <code className="font-mono">^\d&#123;11&#125;$</code></td>
                    <td className="px-3.5 py-2">Form vs. Tax Certificate exact match</td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-2 font-mono font-semibold text-slate-900">OTHER / DE</td>
                    <td className="px-3.5 py-2">Gemini LLM Policy Evaluator (with deterministic EU/global fallback)</td>
                    <td className="px-3.5 py-2">Flags cross-country tax ID confusion (e.g., US EIN entered for Germany DE)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Decision Thresholds */}
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900 mb-2.5">
              <AlertTriangle className="h-4 w-4 text-indigo-600" />
              Decision Routing &amp; Fraud Escalation Thresholds
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2.5 rounded-lg bg-emerald-50/80 border border-emerald-200 px-3.5 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-emerald-900">APPROVED:</span> All 5 rule groups pass. Corporate suffix normalization (<code className="font-mono">Pvt Ltd ↔ Private Limited</code>) is auto-resolved; verified DBA/Trade Name linkage appends an explicit Audit Note.
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-amber-50/80 border border-amber-200 px-3.5 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-900">PENDING:</span> Fixable operational discrepancies (wrong state GSTIN prefix, wrong attachment uploaded instead of bank proof, expired CA/tax certificate prior to <code className="font-mono">2026-11-20</code>, malformed country tax ID, or savings account for a corporate entity).
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-rose-50/80 border border-rose-200 px-3.5 py-2.5">
                <ShieldCheck className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-rose-900">REJECTED:</span> Critical integrity or fraud triggers — third-party bank beneficiary diversion (<code className="font-mono">CRITICAL_FRAUD_MISMATCH</code>), personal <code className="font-mono">P</code> PAN submitted for a Private Limited corporation, embedded PAN mismatch, or bank account reuse across unrelated vendors.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-3.5 rounded-b-2xl">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            Close Policy Overview
          </button>
        </div>
      </div>
    </div>
  )
}
