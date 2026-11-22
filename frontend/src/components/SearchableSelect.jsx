import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'

/**
 * Bounded searchable combobox that enforces selecting strictly from suggestions
 * (plus an optional footer action like "Other — Enter manually").
 */
export default function SearchableSelect({
  options,
  value,
  displayValue,
  onSelect,
  placeholder = 'Type to search...',
  disabled = false,
  required = false,
  footerOption = null, // { label: string, sublabel?: string, onSelect: () => void, isSelected?: boolean }
  emptyMessage = 'No close matches found',
  ariaLabel,
}) {
  const containerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIdx, setHighlightedIdx] = useState(0)

  // Keep input text synced when closed or when external value changes
  useEffect(() => {
    if (!open) {
      setQuery(displayValue || '')
    }
  }, [displayValue, open])

  // Close when clicking outside and revert any unsaved typed text
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery(displayValue || '')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [displayValue])

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || (displayValue && q === displayValue.toLowerCase())) {
      return options
    }
    const scored = []
    for (const opt of options) {
      const labelLow = opt.label.toLowerCase()
      const searchFields = [
        labelLow,
        (opt.value || '').toLowerCase(),
        ...(opt.aliases || []).map((a) => a.toLowerCase()),
      ]

      let score = -1
      if (searchFields.some((f) => f === q)) {
        score = 0
      } else if (searchFields.some((f) => f.startsWith(q))) {
        score = 1
      } else if (
        searchFields.some((f) =>
          f.split(/[\s\-()]+/).some((word) => word.startsWith(q))
        )
      ) {
        score = 2
      } else if (searchFields.some((f) => f.includes(q))) {
        score = 3
      }

      if (score >= 0) {
        scored.push({ opt, score })
      }
    }
    scored.sort((a, b) => a.score - b.score || a.opt.label.localeCompare(b.opt.label))
    return scored.map((s) => s.opt)
  }, [options, query, displayValue])

  const totalItems = filteredOptions.length + (footerOption ? 1 : 0)

  useEffect(() => {
    setHighlightedIdx(0)
  }, [query, open])

  const commitOption = (opt) => {
    onSelect(opt.value)
    setQuery(opt.label)
    setOpen(false)
  }

  const commitFooter = () => {
    if (footerOption?.onSelect) {
      footerOption.onSelect()
    }
    setOpen(false)
  }

  const handleKeyDown = (e) => {
    if (disabled) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (totalItems > 0) {
        setHighlightedIdx((prev) => (prev + 1) % totalItems)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (totalItems > 0) {
        setHighlightedIdx((prev) => (prev - 1 + totalItems) % totalItems)
      }
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (highlightedIdx < filteredOptions.length) {
        commitOption(filteredOptions[highlightedIdx])
      } else if (footerOption && highlightedIdx === filteredOptions.length) {
        commitFooter()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery(displayValue || '')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
          required={required}
          value={open ? query : displayValue || ''}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled) {
              setOpen(true)
              setQuery('')
            }
          }}
          onBlur={(e) => {
            if (!containerRef.current?.contains(e.relatedTarget)) {
              setOpen(false)
              setQuery(displayValue || '')
            }
          }}
          onChange={(e) => {
            if (!disabled) {
              setQuery(e.target.value)
              if (!open) setOpen(true)
            }
          }}
          onKeyDown={handleKeyDown}
          className={`w-full rounded-lg border px-3 py-2 pr-8 text-xs transition focus:outline-none ${
            disabled
              ? 'border-slate-200 bg-slate-100 text-slate-400 placeholder:text-slate-400 cursor-not-allowed'
              : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15'
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            if (open) {
              setOpen(false)
              setQuery(displayValue || '')
            } else {
              setOpen(true)
              setQuery('')
            }
          }}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 ${
            disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-label="Toggle options"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {filteredOptions.length > 0 ? (
            <ul className="max-h-48 overflow-y-auto py-1 divide-y divide-slate-50">
              {filteredOptions.map((opt, idx) => {
                const isSelected = value === opt.value
                const isHighlighted = idx === highlightedIdx
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        commitOption(opt)
                      }}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                        isHighlighted
                          ? 'bg-indigo-50 text-indigo-900'
                          : isSelected
                          ? 'bg-slate-50 text-slate-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">
                        {opt.badge && (
                          <span className="mr-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
                            {opt.badge}
                          </span>
                        )}
                        {opt.label}
                      </span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-slate-400">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span>{emptyMessage}</span>
            </div>
          )}

          {footerOption && (
            <div className="border-t border-slate-200 bg-slate-50/80 p-1">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitFooter()
                }}
                onMouseEnter={() => setHighlightedIdx(filteredOptions.length)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition ${
                  highlightedIdx === filteredOptions.length || footerOption.isSelected
                    ? 'bg-indigo-600 text-white'
                    : 'text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                <div>
                  <div>{footerOption.label}</div>
                  {footerOption.sublabel && (
                    <div
                      className={`text-[10px] font-normal ${
                        highlightedIdx === filteredOptions.length || footerOption.isSelected
                          ? 'text-indigo-100'
                          : 'text-slate-500'
                      }`}
                    >
                      {footerOption.sublabel}
                    </div>
                  )}
                </div>
                {footerOption.isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
