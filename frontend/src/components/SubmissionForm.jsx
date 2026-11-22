import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  UploadCloud,
  FileText,
  Eye,
  X,
  Play,
  RotateCcw,
  Building2,
  Landmark,
  Receipt,
  Loader2,
} from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import {
  FALLBACK_COUNTRY_CONFIG,
  SUPPORTED_COUNTRIES,
  findSupportedCountry,
} from '../data/jurisdictions'

const CONSTITUTIONS = [
  'Private Limited / Corp',
  'Proprietorship',
  'LLP / Partnership',
]

const ACCOUNT_TYPES = ['Current / Commercial', 'Savings / Personal']

const DOC_SLOTS = [
  {
    key: 'tax_document',
    label: '1. Tax Registration',
    hint: 'GST REG-06 / PAN / W-9 / HMRC VAT Certificate',
    required: true,
  },
  {
    key: 'bank_document',
    label: '2. Bank Verification Proof',
    hint: 'Bank Verification Letter / Cancelled Cheque',
    required: true,
  },
  {
    key: 'compliance_document',
    label: '3. Compliance Certificate',
    hint: 'Optional: CA Turnover / MSME Udyam / Good Standing',
    required: false,
  },
]

const PRESET_DOT = {
  APPROVED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  REJECTED: 'bg-rose-500',
}

const PRESET_DISPLAY = {
  scenario_1: {
    label: '1. Happy Path',
    subtitle:
      'Standard vendor submission with valid tax, banking, and compliance documents.',
  },
  scenario_2: {
    label: '2. State GSTIN + Expired CA',
    subtitle:
      'Billing state conflicts with GSTIN prefix and the CA turnover certificate is expired.',
  },
  scenario_3: {
    label: '3. PAN Fraud + Bank Diversion',
    subtitle:
      'Individual PAN submitted for a corporate entity with a mismatched bank beneficiary.',
  },
  scenario_4a: {
    label: '4. Tax ID Issue + Wrong Doc',
    subtitle:
      'Incorrect tax ID format for the selected country and a commercial invoice uploaded instead of bank proof.',
  },
  scenario_4b: {
    label: '5. Trade Name vs. Legal Name',
    subtitle:
      'Vendor submits under a trading name (DBA) while tax and bank documents carry the registered legal entity name.',
  },
}

export default function SubmissionForm({
  presets,
  activePresetId,
  onSelectPreset,
  form,
  onFormChange,
  attachments,
  onAttachFile,
  onRemoveAttachment,
  onPreviewDoc,
  onReset,
  onRunPipeline,
  isRunning,
}) {
  const inputRefs = {
    tax_document: useRef(null),
    bank_document: useRef(null),
    compliance_document: useRef(null),
  }
  const manualCountryInputRef = useRef(null)

  const [isManualCountry, setIsManualCountry] = useState(() => {
    const code = (form.country_code || '').trim()
    return Boolean(code && !findSupportedCountry(code))
  })

  // Keep manual mode synced when a preset loads or external country_code changes
  useEffect(() => {
    const code = (form.country_code || '').trim()
    if (!code) return
    if (findSupportedCountry(code)) {
      setIsManualCountry(false)
    } else {
      setIsManualCountry(true)
    }
  }, [form.country_code, activePresetId])

  const selectedSupportedCountry = useMemo(
    () => (isManualCountry ? null : findSupportedCountry(form.country_code)),
    [form.country_code, isManualCountry]
  )

  const countryOptions = useMemo(
    () =>
      SUPPORTED_COUNTRIES.map((c) => ({
        value: c.code,
        label: c.name,
        badge: c.code,
        aliases: c.aliases,
      })),
    []
  )

  const stateOptions = useMemo(() => {
    if (!selectedSupportedCountry) return []
    return selectedSupportedCountry.states.map((st) => ({
      value: st,
      label: st,
    }))
  }, [selectedSupportedCountry])

  const hasCountry = Boolean((form.country_code || '').trim())

  const handleField = (key) => (e) => {
    onFormChange(key, e.target.value)
  }

  const handleSelectSupportedCountry = (code) => {
    const prevCode = form.country_code
    setIsManualCountry(false)
    onFormChange('country_code', code)
    if (prevCode !== code) {
      onFormChange('billing_state', '')
      if (code !== 'IN') {
        onFormChange('secondary_tax_id', '')
      }
    }
  }

  const handleSelectManualCountry = () => {
    setIsManualCountry(true)
    onFormChange('country_code', '')
    onFormChange('billing_state', '')
    onFormChange('secondary_tax_id', '')
    setTimeout(() => {
      manualCountryInputRef.current?.focus()
    }, 0)
  }

  const handleClearForm = () => {
    setIsManualCountry(false)
    onReset()
  }

  const handleDrop = (slot) => (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      onAttachFile(slot, file)
    }
  }

  const handleFileInput = (slot) => (e) => {
    const file = e.target?.files?.[0]
    if (file) {
      onAttachFile(slot, file)
    }
    e.target.value = ''
  }

  const activeCountryCfg = selectedSupportedCountry || FALLBACK_COUNTRY_CONFIG

  const countryDisplayValue = isManualCountry
    ? 'Other (Manual Entry)'
    : selectedSupportedCountry
    ? `${selectedSupportedCountry.name} (${selectedSupportedCountry.code})`
    : ''

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-soft overflow-hidden">
      {/* Compact Sample Scenarios Bar */}
      <div className="border-b border-slate-100 bg-slate-50/70 px-4 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center flex-wrap gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              Sample Scenarios
              <span className="text-xs font-normal normal-case tracking-normal text-slate-400 ml-2">
                Click a case to pre-fill
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClearForm}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const isActive = p.id === activePresetId
            const display = PRESET_DISPLAY[p.id]
            const pillLabel = display?.label || p.short_label
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPreset(p)}
                className={`cursor-pointer inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  isActive
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                    : 'bg-white border-slate-300 text-slate-700 shadow-xs hover:border-indigo-400 hover:bg-indigo-50/40'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? 'bg-white' : PRESET_DOT[p.expected_decision] || 'bg-slate-400'
                  }`}
                />
                {pillLabel}
              </button>
            )
          })}
        </div>
      </div>

      {/* Editable Vendor Form (Chronological Flow) */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onRunPipeline()
        }}
        className="p-5 space-y-5"
      >
        {/* Section A: Entity & Jurisdiction (Country first, adapting all downstream labels) */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            <Building2 className="h-3.5 w-3.5 text-indigo-600" />
            Entity &amp; Jurisdiction Profile
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Step 1: Country / Jurisdiction (Very First Field) */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Country / Jurisdiction <span className="text-rose-500">*</span>
              </label>
              <SearchableSelect
                ariaLabel="Country / Jurisdiction"
                options={countryOptions}
                value={isManualCountry ? '' : form.country_code}
                displayValue={countryDisplayValue}
                onSelect={handleSelectSupportedCountry}
                placeholder="Type country (India, US, UK, Germany...)"
                required={!isManualCountry}
                emptyMessage="Not in supported list — select Other below"
                footerOption={{
                  label: 'Other — Enter country manually',
                  sublabel: 'For countries outside the 6 primary jurisdictions',
                  isSelected: isManualCountry,
                  onSelect: handleSelectManualCountry,
                }}
              />
              {isManualCountry && (
                <div className="mt-2">
                  <input
                    ref={manualCountryInputRef}
                    type="text"
                    required
                    value={form.country_code}
                    onChange={(e) => {
                      const nextVal = e.target.value
                      onFormChange('country_code', nextVal)
                      if (!nextVal.trim()) {
                        onFormChange('billing_state', '')
                      }
                    }}
                    placeholder="Type country name or ISO code (e.g., France / FR)"
                    className="w-full rounded-lg border border-indigo-300 bg-indigo-50/30 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>
              )}
            </div>

            {/* Step 2: Billing State / Region (Compulsory; greyed out until Country is selected/filled) */}
            <div>
              <label
                className={`block text-[11px] font-semibold mb-1 ${
                  hasCountry ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                Billing State / Region <span className="text-rose-500">*</span>
              </label>

              {!hasCountry ? (
                <input
                  type="text"
                  disabled
                  required
                  value=""
                  readOnly
                  placeholder={
                    isManualCountry
                      ? 'Enter country name first...'
                      : 'Select country first...'
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-400 placeholder:text-slate-400 cursor-not-allowed"
                />
              ) : isManualCountry ? (
                <input
                  type="text"
                  required
                  value={form.billing_state}
                  onChange={handleField('billing_state')}
                  placeholder="Type billing state / region manually"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                />
              ) : (
                <SearchableSelect
                  ariaLabel="Billing State / Region"
                  options={stateOptions}
                  value={form.billing_state}
                  displayValue={form.billing_state}
                  onSelect={(st) => onFormChange('billing_state', st)}
                  placeholder="Type 2–3 letters to select state..."
                  required
                  emptyMessage="No matching state found — check spelling"
                />
              )}
            </div>

            {/* Step 3: Legal Entity Name */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Legal Entity Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.legal_entity_name}
                onChange={handleField('legal_entity_name')}
                placeholder="e.g., Kiran Precision Components Pvt Ltd"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            {/* Step 4: Entity Constitution */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Entity Constitution <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.entity_constitution}
                onChange={handleField('entity_constitution')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                {CONSTITUTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 5: Optional DBA / Trade Name */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                DBA / Trade Name <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={form.dba_trade_name}
                onChange={handleField('dba_trade_name')}
                placeholder="e.g., NovaPay Logistics"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            {/* Step 6: Vendor Contact Email */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Vendor Contact Email <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                value={form.contact_email}
                onChange={handleField('contact_email')}
                placeholder="finance@vendor.com"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>
        </div>

        {/* Section B: Tax Identifiers (Dynamically adapted by selected Country) */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            <Receipt className="h-3.5 w-3.5 text-indigo-600" />
            Tax Identifiers
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                {activeCountryCfg.primaryTaxLabel}{' '}
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.tax_id}
                onChange={handleField('tax_id')}
                placeholder={activeCountryCfg.primaryTaxPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
            {activeCountryCfg.showSecondaryTax && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {activeCountryCfg.secondaryTaxLabel}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.secondary_tax_id}
                  onChange={handleField('secondary_tax_id')}
                  placeholder={activeCountryCfg.secondaryTaxPlaceholder}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                />
              </div>
            )}
          </div>
        </div>

        {/* Section C: Banking Details */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            <Landmark className="h-3.5 w-3.5 text-indigo-600" />
            Banking Details
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Account Holder Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.bank_account_holder}
                onChange={handleField('bank_account_holder')}
                placeholder="Beneficiary name on bank record"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Account Number / IBAN <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.account_number}
                onChange={handleField('account_number')}
                placeholder="Account number"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Account Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.account_type}
                onChange={handleField('account_type')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                {activeCountryCfg.routingLabel} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.routing_code}
                onChange={handleField('routing_code')}
                placeholder={activeCountryCfg.routingPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>
          </div>
        </div>

        {/* Section D: Attach Compliance Documents */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            <UploadCloud className="h-3.5 w-3.5 text-indigo-600" />
            Attach Compliance Documents
          </div>
          <div className="space-y-2.5">
            {DOC_SLOTS.map((slot) => {
              const item = attachments[slot.key]
              return (
                <div
                  key={slot.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop(slot.key)}
                  className={`rounded-xl border border-dashed p-3 transition ${
                    item
                      ? 'border-indigo-200 bg-indigo-50/30'
                      : 'border-slate-300 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">
                        {slot.label}{' '}
                        {slot.required ? (
                          <span className="text-rose-500">*</span>
                        ) : (
                          <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {activeCountryCfg.docHints?.[slot.key] || slot.hint}
                      </div>
                    </div>

                    <input
                      ref={inputRefs[slot.key]}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={handleFileInput(slot.key)}
                    />
                    <button
                      type="button"
                      onClick={() => inputRefs[slot.key].current?.click()}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      {item ? 'Replace PDF' : 'Upload PDF'}
                    </button>
                  </div>

                  {item && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-indigo-200/80 bg-white px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-indigo-600 shrink-0" />
                        <span className="font-mono text-xs font-medium text-slate-800 truncate">
                          {item.filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.previewUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              onPreviewDoc?.({
                                title:
                                  slot.key === 'tax_document'
                                    ? 'Tax Proof'
                                    : slot.key === 'bank_document'
                                    ? 'Bank Proof'
                                    : 'Compliance Proof',
                                url: item.previewUrl,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                          >
                            <Eye className="h-3 w-3" />
                            Preview
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(slot.key)}
                          className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          aria-label={`Remove ${slot.label}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Submit CTA */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isRunning}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 px-5 py-3.5 text-sm font-bold text-white shadow-md shadow-indigo-600/20 transition"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running 4-Stage Verification Pipeline...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                Run Verification
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
