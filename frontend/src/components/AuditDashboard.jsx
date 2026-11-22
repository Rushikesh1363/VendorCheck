import React, { useState } from 'react'
import {
  Search,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Layers,
  MailCheck,
  Mail,
  ChevronRight,
  X,
  Clock,
} from 'lucide-react'
import PipelineStepper from './PipelineStepper'
import ResultView from './ResultView'
import {
  formatDecisionLabel,
  formatDuration,
  formatTimestamp,
  pluralize,
} from '../utils/formatters'

const STATUS_PILLS = [
  { key: 'ALL', label: 'All' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'REJECTED', label: 'Rejected' },
]

const BADGE_CLASSES = {
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-200',
}

export default function AuditDashboard({
  submissions,
  kpis,
  statusFilter,
  searchQuery,
  onStatusFilterChange,
  onSearchChange,
  onRefresh,
  onClearAll,
  onSendEmail,
  onPreviewDoc,
  loading,
}) {
  const [selectedRun, setSelectedRun] = useState(null)

  // Keep drawer synced if email was dispatched
  const activeRun = selectedRun
    ? submissions.find((s) => s.submission_id === selectedRun.submission_id) || selectedRun
    : null

  return (
    <div className="space-y-6">
      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Submissions</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{kpis.total}</span>
            <span className="text-xs text-slate-400">All reviews</span>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200/80 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700">Auto-Approved</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-700">{kpis.approved}</span>
            <span className="text-xs text-slate-400">
              {kpis.total ? `${Math.round((kpis.approved / kpis.total) * 100)}% approval rate` : '0%'}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700">Pending Vendor Action</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-600">{kpis.pending}</span>
            <span className="text-xs text-slate-400">Follow-up ready</span>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200/80 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-700">Rejected / Risk Blocked</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-rose-600">{kpis.rejected}</span>
            <span className="text-xs text-slate-400">Escalated to Risk</span>
          </div>
        </div>
      </div>

      {/* Filterable Audit History Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_PILLS.map((st) => {
              const active = statusFilter === st.key
              return (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => onStatusFilterChange(st.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search vendor, Tax ID, Run ID..."
                className="w-60 rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {kpis.total > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Reset Log
              </button>
            )}
          </div>
        </div>

        {submissions.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
              <Layers className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">No Audit Records Found</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Run any vendor onboarding scenario from the Live Onboarding Run tab to persist full
              compliance telemetry and inspect historical runs here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Case &amp; Date</th>
                  <th className="px-5 py-3">Vendor Entity</th>
                  <th className="px-5 py-3">Jurisdiction &amp; Tax ID</th>
                  <th className="px-5 py-3">Decision</th>
                  <th className="px-5 py-3">Compliance Checks</th>
                  <th className="px-5 py-3">Follow-Up Email</th>
                  <th className="px-5 py-3 text-right">Duration</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submissions.map((run) => {
                  const fails = run.rule_checks.filter((r) => r.status === 'FAIL').length
                  const passes = run.rule_checks.filter((r) => r.status === 'PASS').length
                  return (
                    <tr
                      key={run.submission_id}
                      onClick={() => setSelectedRun(run)}
                      className="cursor-pointer hover:bg-indigo-50/40 transition"
                    >
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {formatTimestamp(run.created_at)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {run.submission_id}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">
                          {run.form_data.legal_entity_name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {run.form_data.entity_constitution}
                          {run.audit_notes?.length > 0 && (
                            <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                              Audit Note
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                            {run.form_data.country_code}
                          </span>
                          <span className="text-slate-800">{run.form_data.tax_id}</span>
                        </div>
                        {run.form_data.secondary_tax_id && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {run.form_data.secondary_tax_id}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${
                            BADGE_CLASSES[run.decision] || ''
                          }`}
                        >
                          {formatDecisionLabel(run.decision)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="text-emerald-700 font-medium">{passes} passed</span>
                        {fails > 0 && (
                          <span className="text-rose-600 font-semibold ml-1.5">
                            · {pluralize(fails, 'issue')}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {!run.outbound_email ? (
                          <span className="text-slate-400">—</span>
                        ) : run.outbound_email.dispatched ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <MailCheck className="h-3.5 w-3.5" />
                            Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <Mail className="h-3.5 w-3.5" />
                            Ready to send
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-right text-slate-600">
                        {formatDuration(run.total_latency_ms)}
                      </td>
                      <td className="px-3 py-3.5 text-slate-400">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-over Audit Trail Drawer */}
      {activeRun && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 backdrop-blur-xs"
          onClick={() => setSelectedRun(null)}
        >
          <div
            className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 shadow-2xl border-l border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-indigo-700">
                    Case {activeRun.submission_id}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(activeRun.created_at)}
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">
                  Audit Trail — {activeRun.form_data.legal_entity_name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRun(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label="Close drawer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <PipelineStepper result={activeRun} isRunning={false} />
              <ResultView
                result={activeRun}
                onSendEmail={onSendEmail}
                onPreviewDoc={onPreviewDoc}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
