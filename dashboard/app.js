/* Kehale Revenue Monitor — light theme, date filters, payment drill-down */

const BLUE = '#1e5eff';
const GROUP_COLORS = {
  'Annual Fees': '#1e5eff',
  'Licenses & Permits': '#7c3aed',
  'Miscellaneous Revenue': '#d97706',
  'Taxes & Surcharges': '#dc2626',
  Other: '#64748b',
};

const PLOT = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { family: 'Inter, sans-serif', color: '#5c6f8a', size: 12 },
  margin: { t: 20, r: 16, b: 48, l: 56 },
  xaxis: { gridcolor: '#e8efff', zerolinecolor: '#dce4f0' },
  yaxis: { gridcolor: '#e8efff', zerolinecolor: '#dce4f0' },
  legend: { orientation: 'h', y: 1.1 },
  hoverlabel: { bgcolor: '#fff', bordercolor: BLUE, font: { color: '#1a2b4a' } },
};

let DATA = null;
/** Receipt/collections ledger (money in) — UI: Receivables. File: payments.json */
let PAYMENTS = null;
/** Fee-split CREDIT ledger — UI: Fee Split. File: receivables.json */
let RECEIVABLES = null;
/** Municipal outflows — UI: Payments. File: muni_payments.json */
let MUNI_PAYMENTS = null;
let paymentsLoading = false;
let receivablesLoading = false;
let muniPayLoading = false;

const state = {
  dateFrom: '',
  dateTo: '',
  year: 'all',
  group: 'all',
  search: '',
  usd: true,
  page: 1,
  pageSize: 50,
  recvPage: 1,
  recvPageSize: 50,
  muniPage: 1,
  muniPageSize: 50,
  activePage: 'overview',
  categoriesTab: 'receivables', // 'payments' | 'receivables'
  sortBy: 'date',
  sortDir: 'desc',
  recvSortBy: 'date',
  recvSortDir: 'desc',
  muniSortBy: 'date',
  muniSortDir: 'desc',
  yearCompareSortBy: 'year',
  yearCompareSortDir: 'desc',
};

const AUTH_KEY = 'kehale_auth';
const AUTH_PASSWORD = 'Welcome@123!';

const fmtMoney = (v, usd = true) => {
  if (v == null || isNaN(v)) return '—';
  if (usd) return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' LBP';
};
const fmtPct = (v) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(1) + '%');
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function wireDetailButtons(container, handler) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  if (!root) return;
  root.querySelectorAll('.btn-link[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler(btn);
    });
  });
}

async function loadData() {
  const loadingText = document.querySelector('#loading div:last-child');
  const paymentsPromise = ensurePayments();
  const receivablesPromise = ensureReceivables();
  const muniPromise = ensureMuniPayments();

  const res = await fetch('data/kehale.json');
  DATA = await res.json();
  if (loadingText) loadingText.textContent = 'Loading receivables & municipal payments…';
  await Promise.all([paymentsPromise, receivablesPromise, muniPromise]);

  initFilters();
  initPaymentTableSort();
  initReceivableTableSort();
  initMuniPayTableSort();
  initYearCompareSort();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  renderAll();
  requestAnimationFrame(() => {
    resizeVisibleCharts();
    setTimeout(resizeVisibleCharts, 120);
  });
}

function initAuth() {
  const gate = document.getElementById('auth-gate');
  const form = document.getElementById('auth-form');
  const err = document.getElementById('auth-error');

  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    gate.classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    loadData().catch(showLoadError);
    return;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = document.getElementById('auth-password').value;
    if (val === AUTH_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1');
      err.classList.add('hidden');
      gate.classList.add('hidden');
      document.getElementById('loading').classList.remove('hidden');
      loadData().catch(showLoadError);
    } else {
      err.classList.remove('hidden');
      document.getElementById('auth-password').value = '';
      document.getElementById('auth-password').focus();
    }
  });
}

function showLoadError(err) {
  document.getElementById('loading').innerHTML =
    `<div style="color:var(--rose)">Failed to load: ${esc(err.message)}<br><small>Run: python scripts/build_dashboard_json.py</small></div>`;
}

function resizeVisibleCharts() {
  ['chart-yearly', 'chart-collection', 'chart-daily', 'chart-group-bar', 'chart-recv-bar', 'chart-gap', 'chart-rates', 'chart-year-compare', 'chart-analysis-group', 'chart-analysis-rate'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) {
      try { Plotly.Plots.resize(el); } catch (_) { /* not rendered yet */ }
    }
  });
}

async function ensureReceivables() {
  if (RECEIVABLES) return RECEIVABLES;
  if (receivablesLoading) return new Promise((r) => {
    const iv = setInterval(() => { if (RECEIVABLES) { clearInterval(iv); r(RECEIVABLES); } }, 200);
  });
  receivablesLoading = true;
  const recvCount = document.getElementById('recv-count');
  if (recvCount) recvCount.textContent = '(loading…)';
  const res = await fetch('data/receivables.json');
  RECEIVABLES = await res.json();
  receivablesLoading = false;
  return RECEIVABLES;
}

async function ensurePayments() {
  if (PAYMENTS) return PAYMENTS;
  if (paymentsLoading) return new Promise((r) => {
    const iv = setInterval(() => { if (PAYMENTS) { clearInterval(iv); r(PAYMENTS); } }, 200);
  });
  paymentsLoading = true;
  const trackerCount = document.getElementById('tracker-count');
  if (trackerCount) trackerCount.textContent = '(loading…)';
  const res = await fetch('data/payments.json');
  PAYMENTS = await res.json();
  paymentsLoading = false;
  return PAYMENTS;
}

async function ensureMuniPayments() {
  if (MUNI_PAYMENTS) return MUNI_PAYMENTS;
  if (muniPayLoading) return new Promise((r) => {
    const iv = setInterval(() => { if (MUNI_PAYMENTS) { clearInterval(iv); r(MUNI_PAYMENTS); } }, 200);
  });
  muniPayLoading = true;
  const el = document.getElementById('muni-pay-count');
  if (el) el.textContent = '(loading…)';
  try {
    const res = await fetch('data/muni_payments.json');
    MUNI_PAYMENTS = res.ok ? await res.json() : [];
  } catch (_) {
    MUNI_PAYMENTS = [];
  }
  muniPayLoading = false;
  return MUNI_PAYMENTS;
}

function initFilters() {
  const from = document.getElementById('filter-date-from');
  const to = document.getElementById('filter-date-to');
  from.value = DATA.meta.date_min || '';
  to.value = DATA.meta.date_max || '';
  state.dateFrom = from.value;
  state.dateTo = to.value;

  const yearSel = document.getElementById('filter-year');
  const categoriesYearSel = document.getElementById('categories-year');
  const fillYearOptions = (sel) => {
    if (!sel || sel.dataset.yearsFilled) return;
    DATA.meta.years.forEach((y) => {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      sel.appendChild(o);
    });
    sel.dataset.yearsFilled = '1';
  };
  fillYearOptions(yearSel);
  fillYearOptions(categoriesYearSel);

  const grpSel = document.getElementById('filter-group');
  if (grpSel && !grpSel.dataset.groupsFilled) {
    DATA.category_groups.forEach((g) => {
      const o = document.createElement('option');
      o.value = g.category_group; o.textContent = g.category_group;
      grpSel.appendChild(o);
    });
    grpSel.dataset.groupsFilled = '1';
  }

  const syncYearSelects = (value) => {
    const v = value == null || value === '' ? 'all' : String(value);
    state.year = v;
    if (yearSel) yearSel.value = v;
    if (categoriesYearSel) categoriesYearSel.value = v;
  };

  const onChange = () => {
    state.dateFrom = from.value;
    state.dateTo = to.value;
    state.year = yearSel?.value || state.year || 'all';
    state.group = grpSel?.value || 'all';
    state.search = document.getElementById('filter-search').value.trim().toLowerCase();
    state.page = 1;
    state.recvPage = 1;
    syncYearSelects(state.year);
    renderFilterChips();
    renderAll();
  };

  if (!yearSel?.dataset.bound) {
    from.addEventListener('change', onChange);
    to.addEventListener('change', onChange);
    yearSel?.addEventListener('change', () => {
      syncYearSelects(yearSel.value);
      onChange();
    });
    grpSel?.addEventListener('change', onChange);
    document.getElementById('filter-search').addEventListener('input', debounce(onChange, 250));
    categoriesYearSel?.addEventListener('change', () => {
      syncYearSelects(categoriesYearSel.value);
      onChange();
    });
    if (yearSel) yearSel.dataset.bound = '1';
  }

  function syncCurrencyButtons() {
    document.getElementById('btn-usd')?.classList.toggle('active', state.usd);
    document.getElementById('btn-lbp')?.classList.toggle('active', !state.usd);
  }
  function setCurrency(usd) {
    if (state.usd === usd) return;
    state.usd = usd;
    syncCurrencyButtons();
    renderFilterChips();
    renderAll();
  }
  document.getElementById('btn-usd')?.addEventListener('click', () => setCurrency(true));
  document.getElementById('btn-lbp')?.addEventListener('click', () => setCurrency(false));
  syncCurrencyButtons();

  document.getElementById('btn-reset').addEventListener('click', () => {
    from.value = DATA.meta.date_min || '';
    to.value = DATA.meta.date_max || '';
    syncYearSelects('all');
    grpSel.value = 'all';
    document.getElementById('filter-search').value = '';
    onChange();
  });

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);

  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    const links = document.getElementById('nav-links');
    const toggle = document.getElementById('nav-toggle');
    const open = links?.classList.toggle('open');
    toggle?.setAttribute('aria-expanded', String(!!open));
  });

  document.querySelectorAll('.nav-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.nav-btn[data-page]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('nav-links')?.classList.remove('open');
      const page = btn.dataset.page;
      state.activePage = page;
      document.getElementById('page-' + page).classList.add('active');
      if (page === 'tracker') await ensurePayments();
      if (page === 'recv-tracker' || page === 'categories') await ensureReceivables();
      if (page === 'muni-pay' || page === 'categories') await ensureMuniPayments();
      renderAll();
      if (page === 'categories') {
        setTimeout(() => renderCategoryCharts(), 150);
      } else {
        setTimeout(resizeVisibleCharts, 80);
      }
    });
  });

  document.querySelectorAll('#categories-tabs .panel-tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tab = btn.dataset.catTab;
      if (!tab || tab === state.categoriesTab) return;
      state.categoriesTab = tab;
      document.querySelectorAll('#categories-tabs .panel-tab').forEach((b) => {
        const on = b.dataset.catTab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (tab === 'payments') await ensureMuniPayments();
      if (tab === 'receivables') await ensureReceivables();
      await renderCategories();
      setTimeout(() => renderCategoryCharts(), 80);
    });
  });

  window.addEventListener('resize', debounce(resizeVisibleCharts, 150));
  renderFilterChips();
}

function renderFilterChips() {
  const el = document.getElementById('filter-chips');
  if (!el) return;
  const chips = [];
  const min = DATA?.meta?.date_min;
  const max = DATA?.meta?.date_max;
  if (state.dateFrom && state.dateFrom !== min) chips.push(`<span class="filter-chip">From ${esc(state.dateFrom)}</span>`);
  if (state.dateTo && state.dateTo !== max) chips.push(`<span class="filter-chip">To ${esc(state.dateTo)}</span>`);
  if (state.year !== 'all') chips.push(`<span class="filter-chip">FY ${esc(state.year)}</span>`);
  if (state.group !== 'all') chips.push(`<span class="filter-chip">${esc(state.group)}</span>`);
  if (state.search) chips.push(`<span class="filter-chip">"${esc(state.search)}"</span>`);
  chips.push(`<span class="filter-chip chip-currency">${state.usd ? 'USD' : 'LBP'}</span>`);
  el.innerHTML = chips.length > 1 ? chips.join('') : chips.join('');
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function inDateRange(dateStr) {
  if (!dateStr) return false;
  if (state.dateFrom && dateStr < state.dateFrom) return false;
  if (state.dateTo && dateStr > state.dateTo) return false;
  return true;
}

function isVoidReceipt(p) {
  const amt = Number(p?.amount_lbp) || 0;
  const num = Number(p?.receipt_number) || 0;
  const taxpayer = String(p?.taxpayer || '').trim().toLowerCase();
  return amt <= 0 && num <= 0 && (!taxpayer || taxpayer === 'nan');
}

function filterPaymentsList(list) {
  return list.filter((p) => {
    if (isVoidReceipt(p)) return false;
    if (!inDateRange(p.date)) return false;
    if (state.year !== 'all' && p.budget_year !== Number(state.year)) return false;
    if (state.group !== 'all' && !(p.category_groups || []).includes(state.group)) return false;
    if (state.search) {
      const hay = `${p.receipt_number} ${p.taxpayer} ${p.primary_category} ${p.receipt_id}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

const PAYMENT_SORT_COLS = [
  { key: 'date', label: 'Date', numeric: false, defaultDir: 'desc' },
  { key: 'receipt_number', label: 'Receipt #', numeric: true, defaultDir: 'desc' },
  { key: 'taxpayer', label: 'Taxpayer', numeric: false, defaultDir: 'asc' },
  { key: 'category', label: 'Category', numeric: false, defaultDir: 'asc' },
  { key: 'group', label: 'Group', numeric: false, defaultDir: 'asc' },
  { key: 'amount', label: 'Amount', numeric: true, defaultDir: 'desc' },
  { key: 'budget_year', label: 'Year', numeric: true, defaultDir: 'desc' },
];

function paymentSortValue(p, key) {
  const u = state.usd;
  switch (key) {
    case 'date': return p.date || '';
    case 'receipt_number': return Number(p.receipt_number) || 0;
    case 'taxpayer': return (p.taxpayer || '').toLowerCase();
    case 'category': return (p.primary_category || '').toLowerCase();
    case 'group': return ((p.category_groups || [])[0] || '').toLowerCase();
    case 'amount': return u ? (p.amount_usd || 0) : (p.amount_lbp || 0);
    case 'budget_year': return Number(p.budget_year) || 0;
    default: return '';
  }
}

function sortPaymentsList(list) {
  const col = PAYMENT_SORT_COLS.find((c) => c.key === state.sortBy);
  if (!col) return list;
  const mul = state.sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = paymentSortValue(a, col.key);
    const vb = paymentSortValue(b, col.key);
    if (col.numeric) return (va - vb) * mul;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * mul;
  });
}

function initPaymentTableSort() {
  const thead = document.querySelector('#payments-table thead');
  if (!thead || thead.dataset.sortInit) return;
  thead.dataset.sortInit = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sortBy === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = key;
      const col = PAYMENT_SORT_COLS.find((c) => c.key === key);
      state.sortDir = col?.defaultDir || 'asc';
    }
    state.page = 1;
    renderTracker();
  });
}

function renderPaymentTableHeaders() {
  const row = document.querySelector('#payments-table thead tr');
  if (!row) return;
  row.innerHTML = PAYMENT_SORT_COLS.map((c) => {
    const active = state.sortBy === c.key;
    const arrow = active ? (state.sortDir === 'asc' ? '▲' : '▼') : '⇅';
    const cls = `sortable${c.numeric ? ' num' : ''}${active ? ' active' : ''}`;
    return `<th class="${cls}" data-sort="${c.key}" title="Sort by ${c.label}"><span>${c.label}</span><span class="sort-icon">${arrow}</span></th>`;
  }).join('') + '<th class="col-actions"></th>';
}

/** True when From/To is narrower than the full dataset range. */
function dateRangeIsNarrowed() {
  if (!DATA?.meta) return !!(state.dateFrom || state.dateTo);
  const min = DATA.meta.date_min || '';
  const max = DATA.meta.date_max || '';
  if (state.dateFrom && state.dateFrom !== min) return true;
  if (state.dateTo && state.dateTo !== max) return true;
  return false;
}

/** Prefer ledger-based exact date filters whenever payments/receivables are loaded. */
function useExactDateLedgers() {
  return !!(PAYMENTS && RECEIVABLES);
}

function rowInActiveYears(row) {
  // Explicit Year dropdown only — do NOT expand date range into full budget years
  // (that over-counts, e.g. all of FY2025 when From is June 2025).
  if (state.year === 'all') return true;
  return Number(row.year) === Number(state.year);
}

function filterCategories(rows) {
  let r = rows || [];
  r = r.filter(rowInActiveYears);
  if (state.group !== 'all') r = r.filter((x) => x.category_group === state.group);
  return r;
}

function forEachFilteredReceivableLine(fn) {
  if (!RECEIVABLES) return;
  RECEIVABLES.forEach((rec) => {
    if (!inDateRange(rec.date)) return;
    if (state.year !== 'all' && Number(rec.budget_year) !== Number(state.year)) return;
    (rec.lines || []).forEach((l) => {
      if (l.fee_type_id == null) return;
      if (state.group !== 'all' && l.category_group !== state.group) return;
      fn(rec, l);
    });
  });
}

function forEachFilteredPaymentCreditLine(fn) {
  if (!PAYMENTS) return;
  PAYMENTS.forEach((p) => {
    if (!inDateRange(p.date)) return;
    if (state.year !== 'all' && Number(p.budget_year) !== Number(state.year)) return;
    if (state.group !== 'all' && !(p.category_groups || []).includes(state.group)) return;
    (p.lines || []).forEach((l) => {
      if (l.account_type !== 'CREDIT') return;
      if (state.group !== 'all' && l.category_group !== state.group) return;
      fn(p, l);
    });
  });
}

/** Year rows built from exact From/To ledger dates (not full budget-year dumps). */
function buildDateAwareYearlyRows() {
  const u = state.usd;
  const byYear = {};
  const ensure = (y) => {
    if (!byYear[y]) {
      byYear[y] = {
        year: y,
        receivables: 0,
        payments: 0,
        payments_count: 0,
        receivable_lines: 0,
        lbp_per_usd: null,
      };
    }
    return byYear[y];
  };

  if (PAYMENTS) {
    filterPaymentsList(PAYMENTS).forEach((p) => {
      const y = Number(p.budget_year);
      if (!Number.isFinite(y)) return;
      const row = ensure(y);
      row.payments += u ? (p.amount_usd || 0) : (p.amount_lbp || 0);
      row.payments_count += 1;
    });
  }

  if (RECEIVABLES) {
    if (state.group === 'all') {
      filterReceivablesList(RECEIVABLES).forEach((r) => {
        const y = Number(r.budget_year);
        if (!Number.isFinite(y)) return;
        const row = ensure(y);
        row.receivables += u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
        row.receivable_lines += r.line_count || (r.lines || []).length;
      });
    } else {
      forEachFilteredReceivableLine((rec, l) => {
        const y = Number(rec.budget_year);
        if (!Number.isFinite(y)) return;
        const row = ensure(y);
        row.receivables += u ? (l.amount_usd || 0) : (l.amount_lbp || 0);
        row.receivable_lines += 1;
      });
    }
  }

  if (MUNI_PAYMENTS) {
    filterMuniPaymentsList(MUNI_PAYMENTS).forEach((p) => {
      const y = Number(p.budget_year);
      if (!Number.isFinite(y)) return;
      const row = ensure(y);
      row.paid_out = (row.paid_out || 0) + (u ? (p.amount_usd || 0) : (p.amount_lbp || 0));
      row.paid_out_count = (row.paid_out_count || 0) + 1;
    });
  }

  return Object.values(byYear).map((r) => {
    const rateRow = (DATA.yearly_summary || []).find((x) => Number(x.year) === Number(r.year));
    const coverage = r.payments ? (r.receivables / r.payments) * 100 : 0;
    return {
      ...r,
      received: r.payments,
      paid_out: r.paid_out || 0,
      paid_out_count: r.paid_out_count || 0,
      gap: null,
      collection_rate: null,
      allocation_coverage: coverage,
      lbp_per_usd: rateRow?.lbp_per_usd ?? null,
    };
  }).sort((a, b) => a.year - b.year);
}

function getFilteredReceivablesTotal() {
  const u = state.usd;
  let total = 0;
  let lines = 0;
  if (!RECEIVABLES) return { total: 0, lines: 0 };
  if (state.group === 'all') {
    filterReceivablesList(RECEIVABLES).forEach((r) => {
      total += u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
      lines += r.line_count || (r.lines || []).length;
    });
  } else {
    forEachFilteredReceivableLine((_, l) => {
      total += u ? (l.amount_usd || 0) : (l.amount_lbp || 0);
      lines += 1;
    });
  }
  return { total, lines };
}

function lineCategoryKey(line) {
  if (line?.category_key) return String(line.category_key);
  const fid = line?.fee_type_id;
  const det = line?.fee_type_det;
  if (fid == null) return '';
  if (Number(fid) === 1 && (Number(det) === 1 || Number(det) === 2)) return `${fid}:${det}`;
  return String(fid);
}

function feeMetaById(feeTypeId) {
  return (DATA.fee_types || []).find((f) => Number(f.FEE_TYPE_ID) === Number(feeTypeId)) || {};
}

/** Aggregate category amounts from fee-allocation (CREDIT) ledger lines in active filters. */
function aggregateCategoriesFromReceivables() {
  if (!RECEIVABLES) return null;
  const u = state.usd;
  const agg = {};
  RECEIVABLES.forEach((rec) => {
    if (!inDateRange(rec.date)) return;
    if (state.year !== 'all' && Number(rec.budget_year) !== Number(state.year)) return;
    (rec.lines || []).forEach((l) => {
      if (l.fee_type_id == null) return;
      if (state.group !== 'all' && l.category_group !== state.group) return;
      const key = lineCategoryKey(l);
      if (!key) return;
      if (!agg[key]) {
        const { feeTypeId, feeTypeDet } = parseCategoryKey(key);
        const meta = feeMetaById(feeTypeId);
        const baseName = l.fee_name || meta.FEE_TYPE_NAME || `Fee ${feeTypeId}`;
        agg[key] = {
          category_key: key,
          FEE_TYPE_ID: feeTypeId,
          FEE_TYPE_DET: feeTypeDet,
          FEE_TYPE_NAME: baseName,
          FEE_TYPE_SHORTNAME: l.fee_short || meta.FEE_TYPE_SHORTNAME || baseName,
          category_group: l.category_group || 'Other',
          budget_code: l.budget_code || null,
          amount: 0,
          lines: 0,
        };
      } else if (!agg[key].budget_code && l.budget_code) {
        agg[key].budget_code = l.budget_code;
      }
      agg[key].amount += u ? (l.amount_usd || 0) : (l.amount_lbp || 0);
      agg[key].lines += 1;
    });
  });
  return Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

function aggregateCategoryYearlyFromReceivables(feeTypeId, feeTypeDet = null) {
  if (!RECEIVABLES) return [];
  const u = state.usd;
  const byYear = {};
  RECEIVABLES.forEach((rec) => {
    if (!inDateRange(rec.date)) return;
    if (state.year !== 'all' && Number(rec.budget_year) !== Number(state.year)) return;
    (rec.lines || []).forEach((l) => {
      if (!lineMatchesCategory(l, feeTypeId, feeTypeDet)) return;
      if (state.group !== 'all' && l.category_group !== state.group) return;
      const y = Number(rec.budget_year);
      if (!Number.isFinite(y)) return;
      if (!byYear[y]) {
        byYear[y] = {
          year: y,
          FEE_TYPE_ID: feeTypeId,
          FEE_TYPE_DET: feeTypeDet,
          FEE_TYPE_NAME: l.fee_name,
          FEE_TYPE_SHORTNAME: l.fee_short,
          category_group: l.category_group,
          category_key: lineCategoryKey(l),
          amount_usd: 0,
          amount_lbp: 0,
          line_count: 0,
        };
      }
      byYear[y].amount_usd += l.amount_usd || 0;
      byYear[y].amount_lbp += l.amount_lbp || 0;
      byYear[y].line_count += 1;
    });
  });
  return Object.values(byYear).sort((a, b) => a.year - b.year);
}

function updateFilterSummary(count, total, label = 'payments') {
  const el = document.getElementById('filter-summary');
  const parts = [];
  if (state.dateFrom || state.dateTo) parts.push(`<strong>${state.dateFrom || '…'}</strong> → <strong>${state.dateTo || '…'}</strong>`);
  if (state.year !== 'all') parts.push(`year <strong>${state.year}</strong>`);
  if (state.group !== 'all') parts.push(`group <strong>${esc(state.group)}</strong>`);
  if (state.search) parts.push(`search "<strong>${esc(state.search)}</strong>"`);
  const filt = count != null ? ` · showing <strong>${count.toLocaleString()}</strong> of ${total.toLocaleString()} ${label}` : '';
  el.innerHTML = (parts.length ? parts.join(' · ') : 'All data') + filt;
  renderFilterChips();
}

function renderAll() {
  const steps = [
    renderKPIs,
    renderYearlyChart,
    renderCollectionChart,
    renderDailyChart,
    () => { void renderCategories().catch((err) => console.error('renderCategories', err)); },
    renderReceivables,
    renderRates,
    renderYearCompare,
    () => { if (PAYMENTS) renderTracker(); },
    () => { if (RECEIVABLES) renderRecvTracker(); },
    () => { if (MUNI_PAYMENTS != null) renderMuniPayTracker(); },
  ];
  steps.forEach((fn) => {
    try { fn(); } catch (err) { console.error(fn.name || 'render', err); }
  });
}

function countUnlinkedReceipts(list) {
  return (list || []).filter((p) => !p.pay_trans_id).length;
}

function renderKPIs() {
  const list = PAYMENTS ? filterPaymentsList(PAYMENTS) : [];
  const u = state.usd;
  let pay, count, feeAlloc, unlinked;

  if (useExactDateLedgers()) {
    pay = list.reduce((s, p) => s + (u ? p.amount_usd : p.amount_lbp), 0);
    count = list.length;
    feeAlloc = getFilteredReceivablesTotal().total;
    unlinked = countUnlinkedReceipts(list);
    updateFilterSummary(count, PAYMENTS.length);
  } else if (list.length) {
    pay = list.reduce((s, p) => s + (u ? p.amount_usd : p.amount_lbp), 0);
    count = list.length;
    const yrs = new Set(list.map((p) => p.budget_year));
    const ys = DATA.yearly_summary.filter((r) => yrs.has(r.year));
    feeAlloc = ys.reduce((s, r) => s + (u ? (r.fee_allocated_usd ?? r.receivables_usd) : (r.fee_allocated_lbp ?? r.receivables_lbp)), 0);
    unlinked = countUnlinkedReceipts(list);
    updateFilterSummary(count, PAYMENTS.length);
  } else {
    const yr = state.year === 'all' ? null : Number(state.year);
    const rows = yr ? DATA.yearly_summary.filter((r) => r.year === yr) : DATA.yearly_summary;
    pay = rows.reduce((s, r) => s + (u ? r.payments_usd : r.payments_lbp), 0);
    feeAlloc = rows.reduce((s, r) => s + (u ? (r.fee_allocated_usd ?? r.receivables_usd) : (r.fee_allocated_lbp ?? r.receivables_lbp)), 0);
    count = rows.reduce((s, r) => s + (r.payments_count || 0), 0);
    unlinked = DATA.meta?.unlinked_receipts ?? 0;
    updateFilterSummary(null, DATA.meta.receipt_count);
  }

  const muniList = MUNI_PAYMENTS ? filterMuniPaymentsList(MUNI_PAYMENTS) : [];
  const paidOut = muniList.reduce((s, p) => s + (u ? (p.amount_usd || 0) : (p.amount_lbp || 0)), 0);
  const paidCount = muniList.length;
  const muniAvailable = DATA.meta?.muni_payments_available || paidCount > 0;

  document.getElementById('kpis').innerHTML = `
    <div class="kpi green"><div class="kpi-label">Received</div><div class="kpi-value">${fmtMoney(pay, u)}</div><div class="kpi-sub">${count.toLocaleString()} receipts · receivables</div></div>
    <div class="kpi"><div class="kpi-label">Paid Out</div><div class="kpi-value">${muniAvailable ? fmtMoney(paidOut, u) : '—'}</div><div class="kpi-sub">${muniAvailable ? `${paidCount.toLocaleString()} municipal payments` : 'export MBS_PAYMENTS'}</div></div>
    <div class="kpi amber"><div class="kpi-label">Fee Split of Received</div><div class="kpi-value">${fmtMoney(feeAlloc, u)}</div><div class="kpi-sub">CREDIT by fee type</div></div>
    <div class="kpi rose"><div class="kpi-label">Unlinked Receipts</div><div class="kpi-value">${Number(unlinked).toLocaleString()}</div><div class="kpi-sub">no pay-trans link</div></div>`;
}

function plotly(id, traces, layout = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  Plotly.react(id, traces, { ...PLOT, ...layout }, { responsive: true, displayModeBar: false });
}

function plotlyFresh(id, traces, layout = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  try { Plotly.purge(el); } catch (_) { /* noop */ }
  Plotly.newPlot(el, traces, { ...PLOT, ...layout }, { responsive: true, displayModeBar: false });
}

function renderYearlyChart() {
  const u = state.usd;
  const ys = useExactDateLedgers()
    ? buildDateAwareYearlyRows()
    : DATA.yearly_summary.slice().sort((a, b) => a.year - b.year).map((r) => ({
      year: r.year,
      received: u ? r.payments_usd : r.payments_lbp,
      paid_out: u ? (r.paid_out_usd || 0) : (r.paid_out_lbp || 0),
    }));
  if (state.year !== 'all') {
    const y = Number(state.year);
    ys.splice(0, ys.length, ...ys.filter((r) => Number(r.year) === y));
  }
  plotly('chart-yearly', [
    { x: ys.map((r) => r.year), y: ys.map((r) => r.received ?? r.payments), name: 'Received', type: 'bar', marker: { color: '#0d9f6e' } },
    { x: ys.map((r) => r.year), y: ys.map((r) => r.paid_out || 0), name: 'Paid Out', type: 'bar', marker: { color: BLUE } },
  ], { barmode: 'group', yaxis: { title: u ? 'USD' : 'LBP' } });
}

function renderCollectionChart() {
  const ys = useExactDateLedgers()
    ? buildDateAwareYearlyRows()
    : DATA.yearly_summary.slice().sort((a, b) => a.year - b.year).map((r) => ({
      year: r.year,
      allocation_coverage: r.allocation_coverage != null
        ? r.allocation_coverage
        : (r.payments_lbp ? ((r.fee_allocated_lbp ?? r.receivables_lbp) / r.payments_lbp) * 100 : 0),
    }));
  if (state.year !== 'all') {
    const y = Number(state.year);
    ys.splice(0, ys.length, ...ys.filter((r) => Number(r.year) === y));
  }
  const years = ys.map((r) => String(r.year));
  const rates = ys.map((r) => Number(r.allocation_coverage) || 0);
  const ymax = Math.max(120, Math.ceil(Math.max(...rates, 100) / 20) * 20 + 20);
  const colors = rates.map((r) => (r >= 99.95 ? '#0d9f6e' : r >= 90 ? '#d97706' : '#dc2626'));

  plotlyFresh('chart-collection', [{
    x: years,
    y: rates,
    type: 'bar',
    text: rates.map((r) => r.toFixed(1) + '%'),
    textposition: 'outside',
    cliponaxis: false,
    textfont: { size: 11, color: '#1a2b4a' },
    marker: { color: colors, line: { width: 0 } },
    hovertemplate: '<b>%{x}</b><br>Coverage: %{y:.1f}%<br><i>fees allocated ÷ payments</i><extra></extra>',
  }], {
    xaxis: {
      type: 'category',
      categoryorder: 'array',
      categoryarray: years,
      title: 'Year',
      gridcolor: '#e8efff',
    },
    yaxis: {
      type: 'linear',
      title: '% coverage',
      range: [0, ymax],
      ticksuffix: '%',
      dtick: ymax > 150 ? 50 : 25,
      gridcolor: '#e8efff',
    },
    shapes: [{
      type: 'line',
      xref: 'paper',
      yref: 'y',
      x0: 0,
      x1: 1,
      y0: 100,
      y1: 100,
      line: { color: '#94a3b8', width: 2, dash: 'dash' },
    }],
    annotations: [{
      xref: 'paper',
      yref: 'y',
      x: 1,
      y: 100,
      xanchor: 'right',
      text: '100% target',
      showarrow: false,
      yshift: 14,
      font: { size: 10, color: '#5c6f8a' },
    }],
    margin: { t: 30, r: 16, b: 48, l: 56 },
    showlegend: false,
  });
}

function renderDailyChart() {
  const el = document.getElementById('chart-daily');
  if (!el) return;

  if (!PAYMENTS) {
    if (paymentsLoading) {
      try { Plotly.purge(el); } catch (_) { /* noop */ }
      el.innerHTML = '<p class="chart-empty">Loading daily collections…</p>';
      return;
    }
    plotlyFresh('chart-daily', [], {});
    return;
  }

  if (el.querySelector('.chart-empty')) el.textContent = '';

  const list = filterPaymentsList(PAYMENTS);
  const byDay = {};
  const u = state.usd;
  list.forEach((p) => {
    if (!p.date) return;
    byDay[p.date] = (byDay[p.date] || 0) + (u ? p.amount_usd : p.amount_lbp);
  });
  const days = Object.keys(byDay).sort();
  plotlyFresh('chart-daily', [{
    x: days,
    y: days.map((d) => byDay[d]),
    type: 'bar',
    marker: { color: BLUE, opacity: 0.85 },
  }], { xaxis: { title: 'Date' }, yaxis: { title: u ? 'USD' : 'LBP' } });
}

function badge(g) {
  const cls = { 'Annual Fees': 'g1', 'Licenses & Permits': 'g2', 'Miscellaneous Revenue': 'g3', 'Taxes & Surcharges': 'g4' }[g] || 'g1';
  return `<span class="badge ${cls}">${esc(g)}</span>`;
}

function renderTracker() {
  if (!PAYMENTS) return;
  renderPaymentTableHeaders();
  const filtered = sortPaymentsList(filterPaymentsList(PAYMENTS));
  const u = state.usd;
  const total = filtered.reduce((s, p) => s + (u ? p.amount_usd : p.amount_lbp), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = filtered.slice(start, start + state.pageSize);

  document.getElementById('tracker-kpis').innerHTML = `
    <div class="kpi green"><div class="kpi-label">Filtered Received</div><div class="kpi-value">${fmtMoney(total, u)}</div></div>
    <div class="kpi"><div class="kpi-label">Receipts</div><div class="kpi-value">${filtered.length.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-label">Avg Receipt</div><div class="kpi-value">${fmtMoney(filtered.length ? total / filtered.length : 0, u)}</div></div>`;

  document.getElementById('tracker-count').textContent = `(${filtered.length.toLocaleString()} records)`;
  if (state.activePage === 'tracker') {
    updateFilterSummary(filtered.length, PAYMENTS.length, 'receivables');
  }

  const tbody = document.querySelector('#payments-table tbody');
  tbody.innerHTML = pageRows.map((p, i) => {
    const grp = (p.category_groups || [])[0] || '—';
    return `<tr data-idx="${start + i}">
      <td>${esc(p.date)}</td>
      <td class="num"><strong>${p.receipt_number ?? '—'}</strong></td>
      <td>${esc(p.taxpayer) || '—'}</td>
      <td>${esc(p.primary_category) || '—'}</td>
      <td>${grp !== '—' ? badge(grp) : '—'}</td>
      <td class="num">${fmtMoney(u ? p.amount_usd : p.amount_lbp, u)}</td>
      <td class="num">${p.budget_year ?? '—'}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-idx="${start + i}">Details →</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No payments match filters</td></tr>';

  wireDetailButtons(tbody, (btn) => openPaymentDetail(filtered[Number(btn.dataset.idx)]));

  renderPager('pager-top', pages, filtered.length);
  renderPager('pager-bottom', pages, filtered.length);
}

function renderPager(id, pages, total) {
  const el = document.getElementById(id);
  el.innerHTML = `
    <button type="button" id="${id}-prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${state.page} / ${pages} (${total.toLocaleString()} total)</span>
    <button type="button" id="${id}-next" ${state.page >= pages ? 'disabled' : ''}>Next →</button>
    <select id="${id}-size" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
      ${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}/page</option>`).join('')}
    </select>`;
  document.getElementById(`${id}-prev`)?.addEventListener('click', () => { state.page--; renderTracker(); });
  document.getElementById(`${id}-next`)?.addEventListener('click', () => { state.page++; renderTracker(); });
  document.getElementById(`${id}-size`)?.addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1;
    renderTracker();
  });
}

function filterReceivablesList(list) {
  return list.filter((r) => {
    if (!inDateRange(r.date)) return false;
    if (state.year !== 'all' && r.budget_year !== Number(state.year)) return false;
    if (state.group !== 'all' && !(r.category_groups || []).includes(state.group)) return false;
    if (state.search) {
      const hay = `${r.pay_trans_id} ${r.taxpayer} ${r.primary_category} ${r.document_num || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

const RECEIVABLE_SORT_COLS = [
  { key: 'date', label: 'Date', numeric: false, defaultDir: 'desc' },
  { key: 'pay_trans_id', label: 'Trans #', numeric: true, defaultDir: 'desc' },
  { key: 'taxpayer', label: 'Taxpayer', numeric: false, defaultDir: 'asc' },
  { key: 'category', label: 'Category', numeric: false, defaultDir: 'asc' },
  { key: 'group', label: 'Group', numeric: false, defaultDir: 'asc' },
  { key: 'amount', label: 'Allocated', numeric: true, defaultDir: 'desc' },
  { key: 'budget_year', label: 'Year', numeric: true, defaultDir: 'desc' },
];

function receivableSortValue(r, key) {
  const u = state.usd;
  switch (key) {
    case 'date': return r.date || '';
    case 'pay_trans_id': return Number(r.pay_trans_id) || 0;
    case 'taxpayer': return (r.taxpayer || '').toLowerCase();
    case 'category': return (r.primary_category || '').toLowerCase();
    case 'group': return ((r.category_groups || [])[0] || '').toLowerCase();
    case 'amount': return u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
    case 'budget_year': return Number(r.budget_year) || 0;
    default: return '';
  }
}

function sortReceivablesList(list) {
  const col = RECEIVABLE_SORT_COLS.find((c) => c.key === state.recvSortBy);
  if (!col) return list;
  const mul = state.recvSortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = receivableSortValue(a, col.key);
    const vb = receivableSortValue(b, col.key);
    if (col.numeric) return (va - vb) * mul;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * mul;
  });
}

function initReceivableTableSort() {
  const thead = document.querySelector('#receivables-table thead');
  if (!thead || thead.dataset.sortInit) return;
  thead.dataset.sortInit = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.recvSortBy === key) {
      state.recvSortDir = state.recvSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.recvSortBy = key;
      const col = RECEIVABLE_SORT_COLS.find((c) => c.key === key);
      state.recvSortDir = col?.defaultDir || 'asc';
    }
    state.recvPage = 1;
    renderRecvTracker();
  });
}

function renderReceivableTableHeaders() {
  const row = document.querySelector('#receivables-table thead tr');
  if (!row) return;
  row.innerHTML = RECEIVABLE_SORT_COLS.map((c) => {
    const active = state.recvSortBy === c.key;
    const arrow = active ? (state.recvSortDir === 'asc' ? '▲' : '▼') : '⇅';
    const cls = `sortable${c.numeric ? ' num' : ''}${active ? ' active' : ''}`;
    return `<th class="${cls}" data-sort="${c.key}" title="Sort by ${c.label}"><span>${c.label}</span><span class="sort-icon">${arrow}</span></th>`;
  }).join('') + '<th class="col-actions"></th>';
}

function renderRecvTracker() {
  if (!RECEIVABLES) return;
  renderReceivableTableHeaders();
  const filtered = sortReceivablesList(filterReceivablesList(RECEIVABLES));
  const u = state.usd;
  const total = filtered.reduce((s, r) => s + (u ? r.amount_usd : r.amount_lbp), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / state.recvPageSize));
  if (state.recvPage > pages) state.recvPage = pages;
  const start = (state.recvPage - 1) * state.recvPageSize;
  const pageRows = filtered.slice(start, start + state.recvPageSize);

  document.getElementById('recv-kpis').innerHTML = `
    <div class="kpi green"><div class="kpi-label">Filtered Fees Allocated</div><div class="kpi-value">${fmtMoney(total, u)}</div></div>
    <div class="kpi"><div class="kpi-label">Allocation Records</div><div class="kpi-value">${filtered.length.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-label">Avg Allocation</div><div class="kpi-value">${fmtMoney(filtered.length ? total / filtered.length : 0, u)}</div></div>`;

  document.getElementById('recv-count').textContent = `(${filtered.length.toLocaleString()} records)`;
  if (state.activePage === 'recv-tracker') {
    updateFilterSummary(filtered.length, RECEIVABLES.length, 'fee allocations');
  }

  const tbody = document.querySelector('#receivables-table tbody');
  tbody.innerHTML = pageRows.map((r, i) => {
    const grp = (r.category_groups || [])[0] || '—';
    return `<tr data-idx="${start + i}">
      <td>${esc(r.date) || '—'}</td>
      <td class="num"><strong>${r.pay_trans_id ?? '—'}</strong></td>
      <td>${esc(r.taxpayer) || '—'}</td>
      <td>${esc(r.primary_category) || '—'}</td>
      <td>${grp !== '—' ? badge(grp) : '—'}</td>
      <td class="num">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</td>
      <td class="num">${r.budget_year ?? '—'}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-idx="${start + i}">Details →</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No fee allocations match filters</td></tr>';

  wireDetailButtons(tbody, (btn) => openReceivableDetail(filtered[Number(btn.dataset.idx)]));

  renderRecvPager('recv-pager-top', pages, filtered.length);
  renderRecvPager('recv-pager-bottom', pages, filtered.length);
}

function renderRecvPager(id, pages, total) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <button type="button" id="${id}-prev" ${state.recvPage <= 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${state.recvPage} / ${pages} (${total.toLocaleString()} total)</span>
    <button type="button" id="${id}-next" ${state.recvPage >= pages ? 'disabled' : ''}>Next →</button>
    <select id="${id}-size" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
      ${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === state.recvPageSize ? 'selected' : ''}>${n}/page</option>`).join('')}
    </select>`;
  document.getElementById(`${id}-prev`)?.addEventListener('click', () => { state.recvPage--; renderRecvTracker(); });
  document.getElementById(`${id}-next`)?.addEventListener('click', () => { state.recvPage++; renderRecvTracker(); });
  document.getElementById(`${id}-size`)?.addEventListener('change', (e) => {
    state.recvPageSize = Number(e.target.value);
    state.recvPage = 1;
    renderRecvTracker();
  });
}

function openReceivableDetail(r) {
  if (!r) return;
  const u = state.usd;
  setDrawerBack(false);
  drawerContext = null;
  document.getElementById('drawer-title').textContent = 'Fee Allocation Detail';
  document.getElementById('drawer-body').innerHTML = `
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(r.date) || '—'} · Trans #${r.pay_trans_id}</div>
      <div style="color:var(--muted);font-size:.8rem;margin-top:2px">Payment fee split (not an assessment)</div>
    </div>
    <div class="detail-section">
      <h4>Transaction</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Pay Trans ID</label><span>${r.pay_trans_id}</span></div>
        <div class="detail-item"><label>Budget Year</label><span>${r.budget_year ?? '—'}</span></div>
        <div class="detail-item"><label>Document #</label><span>${r.document_num ?? '—'}</span></div>
        <div class="detail-item"><label>Amount (LBP)</label><span>${Number(r.amount_lbp).toLocaleString()}</span></div>
        <div class="detail-item"><label>User</label><span>${esc(r.user_id) || '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Taxpayer</h4>
      <div class="detail-grid">
        <div class="detail-item wide"><label>Name</label><span>${esc(r.taxpayer) || '—'}</span></div>
        <div class="detail-item"><label>Mukallaf ID</label><span>${r.mukallaf_id ?? '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Category Groups</h4>
      <div>${(r.category_groups || []).map(badge).join(' ') || '—'}</div>
    </div>
    <div class="detail-section">
      <h4>Fee Lines <span style="font-weight:400;color:var(--muted)">(${r.line_count} CREDIT lines)</span></h4>
      <table class="lines-table">
        <thead><tr><th>#</th><th>Category</th><th>Group</th><th class="num">Allocated</th></tr></thead>
        <tbody>
          ${(r.lines || []).map((l) => `
            <tr>
              <td>${l.seq ?? '—'}</td>
              <td>${esc(l.fee_short || l.fee_name) || '—'}</td>
              <td>${l.category_group ? badge(l.category_group) : '—'}</td>
              <td class="num">${fmtMoney(u ? l.amount_usd : l.amount_lbp, u)}</td>
            </tr>`).join('') || '<tr><td colspan="4">No fee lines</td></tr>'}
        </tbody>
      </table>
    </div>`;

  showDrawer();
}

function openPaymentDetail(p) {
  if (!p) return;
  const u = state.usd;
  const credits = (p.lines || []).filter((l) => l.account_type === 'CREDIT');
  const debits = (p.lines || []).filter((l) => l.account_type === 'DEBIT');
  const totalDebit = debits.reduce((s, l) => s + (u ? l.amount_usd : l.amount_lbp), 0);

  if (drawerContext?.type === 'category-year') {
    const { feeTypeId, year } = drawerContext;
    setDrawerBack(true, () => openCategoryYearDetail(feeTypeId, year));
  } else {
    setDrawerBack(false);
  }

  document.getElementById('drawer-title').textContent = 'Receivable Detail';
  document.getElementById('drawer-body').innerHTML = `
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(u ? p.amount_usd : p.amount_lbp, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(p.date)} · Receipt #${p.receipt_number}</div>
    </div>
    <div class="detail-section">
      <h4>Receipt</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Receipt ID</label><span>${p.receipt_id}</span></div>
        <div class="detail-item"><label>Budget Year</label><span>${p.budget_year ?? '—'}</span></div>
        <div class="detail-item"><label>Amount (LBP)</label><span>${Number(p.amount_lbp).toLocaleString()}</span></div>
        <div class="detail-item"><label>Fine (LBP)</label><span>${Number(p.fine_lbp || 0).toLocaleString()}</span></div>
        <div class="detail-item"><label>Collector</label><span>${esc(p.collector) || '—'}</span></div>
        <div class="detail-item"><label>User</label><span>${esc(p.user_id) || '—'}</span></div>
        ${p.remarks ? `<div class="detail-item wide"><label>Remarks</label><span>${esc(p.remarks)}</span></div>` : ''}
      </div>
    </div>
    <div class="detail-section">
      <h4>Taxpayer</h4>
      <div class="detail-grid">
        <div class="detail-item wide"><label>Name</label><span>${esc(p.taxpayer) || '—'}</span></div>
        <div class="detail-item"><label>Mukallaf ID</label><span>${p.mukallaf_id ?? '—'}</span></div>
        <div class="detail-item"><label>Pay Trans ID</label><span>${p.pay_trans_id ?? '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Category Groups</h4>
      <div>${(p.category_groups || []).map(badge).join(' ') || '—'}</div>
    </div>
    <div class="detail-section">
      <h4>Ledger Lines <span style="font-weight:400;color:var(--muted)">(${p.line_count} lines · debit ${fmtMoney(totalDebit, u)})</span></h4>
      <table class="lines-table">
        <thead><tr><th>#</th><th>Type</th><th>Category</th><th>Group</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${(p.lines || []).map((l) => `
            <tr>
              <td>${l.seq ?? '—'}</td>
              <td class="${l.account_type === 'CREDIT' ? 'line-credit' : 'line-debit'}">${l.account_type}</td>
              <td>${esc(l.fee_short || l.fee_name) || '—'}</td>
              <td>${l.category_group ? badge(l.category_group) : '—'}</td>
              <td class="num">${fmtMoney(u ? l.amount_usd : l.amount_lbp, u)}</td>
            </tr>`).join('') || '<tr><td colspan="5">No ledger lines linked</td></tr>'}
        </tbody>
      </table>
    </div>
    ${credits.length ? `<div class="detail-section"><h4>Fee Allocation (CREDIT)</h4>
      <table class="lines-table"><thead><tr><th>Fee</th><th>Group</th><th class="num">Allocated</th></tr></thead><tbody>
      ${credits.map((l) => `<tr><td>${esc(l.fee_name)}</td><td>${badge(l.category_group)}</td><td class="num">${fmtMoney(u ? l.amount_usd : l.amount_lbp, u)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;

  showDrawer();
}

function setDrawerBack(show, handler) {
  const btn = document.getElementById('drawer-back');
  if (!btn) return;
  btn.classList.toggle('hidden', !show);
  btn.onclick = show && handler ? handler : null;
}

function showDrawer() {
  document.getElementById('drawer-backdrop').classList.remove('hidden');
  document.getElementById('drawer').classList.remove('hidden');
}

function closeDrawer() {
  setDrawerBack(false);
  drawerContext = null;
  resetDrawerLocal();
  document.getElementById('drawer-backdrop').classList.add('hidden');
  document.getElementById('drawer').classList.add('hidden');
}

let drawerContext = null;
let drawerLocal = { search: '', filterYear: 'all' };

function resetDrawerLocal() {
  drawerLocal = { search: '', filterYear: 'all' };
}

function drawerFiltersHtml(years, mode) {
  const yearOpts = ['<option value="all">All years</option>']
    .concat(years.map((y) => `<option value="${y}"${String(drawerLocal.filterYear) === String(y) ? ' selected' : ''}>${y}</option>`))
    .join('');
  const placeholder = mode === 'payments' ? 'Search receipt # or taxpayer…' : 'Search year or amount…';
  return `<div class="drawer-filters" id="drawer-filters">
    <input type="search" class="drawer-search" placeholder="${placeholder}" value="${esc(drawerLocal.search)}" />
    ${mode === 'years' ? `<select class="drawer-year">${yearOpts}</select>` : ''}
  </div>`;
}

function categoryKey(c) {
  if (c?.category_key) return String(c.category_key);
  const fid = c?.FEE_TYPE_ID;
  const det = c?.FEE_TYPE_DET;
  if (fid == null) return '';
  return det == null || det === '' ? String(fid) : `${fid}:${det}`;
}

function parseCategoryKey(key) {
  const s = String(key ?? '');
  if (s.includes(':')) {
    const [fid, det] = s.split(':');
    return { feeTypeId: Number(fid), feeTypeDet: Number(det) };
  }
  return { feeTypeId: Number(s), feeTypeDet: null };
}

function lineMatchesCategory(line, feeTypeId, feeTypeDet) {
  if (Number(line.fee_type_id) !== Number(feeTypeId)) return false;
  if (feeTypeDet == null || Number.isNaN(Number(feeTypeDet))) {
    // Unsplit category: exclude rental lines that belong to (س)/(غ) buckets.
    if (Number(feeTypeId) === 1) {
      const d = line.fee_type_det;
      return d == null || d === '' || Number(d) === 0 || Number.isNaN(Number(d));
    }
    return true;
  }
  return Number(line.fee_type_det) === Number(feeTypeDet);
}

function rowMatchesCategory(c, feeTypeId, feeTypeDet) {
  if (Number(c.FEE_TYPE_ID) !== Number(feeTypeId)) return false;
  if (feeTypeDet == null || Number.isNaN(Number(feeTypeDet))) {
    return c.FEE_TYPE_DET == null || c.FEE_TYPE_DET === '' || Number.isNaN(Number(c.FEE_TYPE_DET));
  }
  return Number(c.FEE_TYPE_DET) === Number(feeTypeDet);
}

function wireDrawerFilters({ mode, feeTypeId, feeTypeDet, year, years }) {
  const bar = document.getElementById('drawer-filters');
  if (!bar) return;
  bar.querySelector('.drawer-search')?.addEventListener('input', debounce((e) => {
    drawerLocal.search = e.target.value.trim().toLowerCase();
    if (mode === 'years') openCategoryDetail(feeTypeId, true, feeTypeDet);
    else renderCategoryYearPayments(feeTypeId, year, feeTypeDet);
  }, 200));
  bar.querySelector('.drawer-year')?.addEventListener('change', (e) => {
    drawerLocal.filterYear = e.target.value;
    openCategoryDetail(feeTypeId, true, feeTypeDet);
  });
}

function getCategoryYearlyRows(feeTypeId, feeTypeDet = null) {
  if ((useExactDateLedgers() || dateRangeIsNarrowed()) && RECEIVABLES) {
    return aggregateCategoryYearlyFromReceivables(feeTypeId, feeTypeDet);
  }
  return filterCategories(DATA.categories_by_year)
    .filter((c) => rowMatchesCategory(c, feeTypeId, feeTypeDet))
    .sort((a, b) => a.year - b.year);
}

function getCategoryPaymentRows(feeTypeId, feeTypeDet = null) {
  // Exact date filter: allocate collected amount from payment ledger lines.
  if ((useExactDateLedgers() || dateRangeIsNarrowed()) && PAYMENTS) {
    const u = state.usd;
    const byYear = {};
    PAYMENTS.forEach((p) => {
      if (!inDateRange(p.date)) return;
      if (state.year !== 'all' && Number(p.budget_year) !== Number(state.year)) return;
      (p.lines || []).forEach((l) => {
        if (l.account_type !== 'CREDIT') return;
        if (!lineMatchesCategory(l, feeTypeId, feeTypeDet)) return;
        if (state.group !== 'all' && l.category_group !== state.group) return;
        const y = Number(p.budget_year);
        if (!Number.isFinite(y)) return;
        if (!byYear[y]) {
          byYear[y] = {
            year: y,
            FEE_TYPE_ID: feeTypeId,
            FEE_TYPE_DET: feeTypeDet,
            amount_usd: 0,
            amount_lbp: 0,
            line_count: 0,
            category_group: l.category_group,
            FEE_TYPE_NAME: l.fee_name,
          };
        }
        byYear[y].amount_usd += l.amount_usd || 0;
        byYear[y].amount_lbp += l.amount_lbp || 0;
        byYear[y].line_count += 1;
      });
    });
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }
  return (DATA.payments_by_year || [])
    .filter((c) => rowMatchesCategory(c, feeTypeId, feeTypeDet))
    .filter(rowInActiveYears)
    .filter((c) => state.group === 'all' || c.category_group === state.group)
    .sort((a, b) => a.year - b.year);
}

function getPaymentsForCategoryYear(feeTypeId, year, feeTypeDet = null) {
  if (!PAYMENTS) return [];
  const u = state.usd;
  return PAYMENTS.filter((p) => {
    if (p.budget_year !== year) return false;
    if (!inDateRange(p.date)) return false;
    if (state.search) {
      const hay = `${p.receipt_number} ${p.taxpayer} ${p.primary_category}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return (p.lines || []).some((l) => l.account_type === 'CREDIT' && lineMatchesCategory(l, feeTypeId, feeTypeDet));
  }).map((p) => {
    const credits = (p.lines || []).filter((l) => l.account_type === 'CREDIT' && lineMatchesCategory(l, feeTypeId, feeTypeDet));
    const categoryAmount = credits.reduce((s, l) => s + (u ? l.amount_usd : l.amount_lbp), 0);
    return { ...p, category_amount: categoryAmount };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function openCategoryDetail(feeTypeId, keepFilters = false, feeTypeDet = null) {
  const u = state.usd;
  const recvRows = getCategoryYearlyRows(feeTypeId, feeTypeDet);
  if (!recvRows.length) return;

  if (!keepFilters) resetDrawerLocal();

  const meta = recvRows[0];
  const feeMeta = (DATA.fee_types || []).find((f) => Number(f.FEE_TYPE_ID) === feeTypeId) || {};
  const payRows = getCategoryPaymentRows(feeTypeId, feeTypeDet);

  const yearMap = {};
  recvRows.forEach((r) => {
    yearMap[r.year] = { year: r.year, recv: u ? r.amount_usd : r.amount_lbp, lines: r.line_count || 0, pay: 0 };
  });
  payRows.forEach((r) => {
    if (!yearMap[r.year]) yearMap[r.year] = { year: r.year, recv: 0, lines: 0, pay: 0 };
    yearMap[r.year].pay = u ? r.amount_usd : r.amount_lbp;
  });
  let yearRows = Object.values(yearMap).sort((a, b) => a.year - b.year);

  if (drawerLocal.filterYear !== 'all') {
    yearRows = yearRows.filter((r) => String(r.year) === String(drawerLocal.filterYear));
  }
  if (drawerLocal.search) {
    const q = drawerLocal.search;
    yearRows = yearRows.filter((r) =>
      String(r.year).includes(q) ||
      String(r.recv).includes(q) ||
      String(r.pay).includes(q) ||
      fmtMoney(r.recv, u).toLowerCase().includes(q) ||
      fmtMoney(r.pay, u).toLowerCase().includes(q));
  }

  const totalRecv = recvRows.reduce((s, r) => s + (u ? r.amount_usd : r.amount_lbp), 0);
  const totalPay = payRows.reduce((s, r) => s + (u ? r.amount_usd : r.amount_lbp), 0);
  const rate = totalRecv ? (totalPay / totalRecv) * 100 : 0;
  const allYears = Object.keys(yearMap).map(Number).sort((a, b) => a - b);

  drawerContext = { type: 'category', feeTypeId, feeTypeDet };
  setDrawerBack(false);
  document.getElementById('drawer-title').textContent = 'Category · By Year';
  document.getElementById('drawer-body').innerHTML = `
    ${drawerFiltersHtml(allYears, 'years')}
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(totalRecv, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(meta.FEE_TYPE_NAME || feeMeta.FEE_TYPE_NAME)} · Fee #${feeTypeId}</div>
    </div>
    <div class="detail-section">
      <h4>Summary</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Group</label><span>${badge(meta.category_group)}</span></div>
        <div class="detail-item"><label>Attributed payments</label><span>${fmtMoney(totalPay, u)}</span></div>
        <div class="detail-item"><label>Match rate</label><span>${fmtPct(rate)}</span></div>
        <div class="detail-item"><label>Years shown</label><span>${yearRows.length.toLocaleString()} / ${allYears.length}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Per year <span style="font-weight:400;color:var(--muted)">— use Payments → for detail</span></h4>
      <table class="lines-table">
        <thead><tr><th>Year</th><th class="num">Fees Allocated</th><th class="num">Payments</th><th class="num">Match</th><th class="num">Lines</th><th></th></tr></thead>
        <tbody>
          ${yearRows.length ? yearRows.map((r) => {
            const yrRate = r.recv ? (r.pay / r.recv) * 100 : 0;
            return `<tr data-cat-year="${r.year}">
              <td><strong>${r.year}</strong></td>
              <td class="num">${fmtMoney(r.recv, u)}</td>
              <td class="num">${fmtMoney(r.pay, u)}</td>
              <td class="num">${fmtPct(yrRate)}</td>
              <td class="num">${(r.lines || 0).toLocaleString()}</td>
              <td><button class="btn-link" type="button" data-action="year" data-year="${r.year}">Payments →</button></td>
            </tr>`;
          }).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">No years match filters</td></tr>`}
        </tbody>
      </table>
    </div>`;

  wireDrawerFilters({ mode: 'years', feeTypeId, feeTypeDet, years: allYears });
  wireDetailButtons(document.getElementById('drawer-body'), (btn) => {
    if (btn.dataset.action === 'year') openCategoryYearDetail(feeTypeId, Number(btn.dataset.year), feeTypeDet);
  });

  showDrawer();
}

let categoryYearPayments = [];

async function openCategoryYearDetail(feeTypeId, year, feeTypeDet = null) {
  drawerLocal.search = '';
  drawerContext = { type: 'category-year', feeTypeId, feeTypeDet, year };
  setDrawerBack(true, () => openCategoryDetail(feeTypeId, true, feeTypeDet));
  document.getElementById('drawer-title').textContent = `${year} · loading…`;
  document.getElementById('drawer-body').innerHTML = '<p style="color:var(--muted);padding:20px 0">Loading payments…</p>';
  showDrawer();

  await ensurePayments();
  categoryYearPayments = getPaymentsForCategoryYear(feeTypeId, year, feeTypeDet);
  const meta = getCategoryYearlyRows(feeTypeId, feeTypeDet).find((r) => r.year === year)
    || getCategoryYearlyRows(feeTypeId, feeTypeDet)[0]
    || {};
  document.getElementById('drawer-title').textContent = `${year} · ${esc(meta.FEE_TYPE_SHORTNAME || meta.FEE_TYPE_NAME || `Fee ${feeTypeId}`)}`;
  renderCategoryYearPayments(feeTypeId, year, feeTypeDet);
}

function renderCategoryYearPayments(feeTypeId, year, feeTypeDet = null) {
  const u = state.usd;
  const recvRow = getCategoryYearlyRows(feeTypeId, feeTypeDet).find((r) => r.year === year);
  const payRow = getCategoryPaymentRows(feeTypeId, feeTypeDet).find((r) => r.year === year);

  let payments = categoryYearPayments;
  if (drawerLocal.search) {
    const q = drawerLocal.search;
    payments = payments.filter((p) => {
      const hay = `${p.receipt_number} ${p.taxpayer} ${p.primary_category} ${p.date}`.toLowerCase();
      return hay.includes(q);
    });
  }

  const totalCat = payments.reduce((s, p) => s + p.category_amount, 0);
  const recv = recvRow ? (u ? recvRow.amount_usd : recvRow.amount_lbp) : 0;
  const collected = payRow ? (u ? payRow.amount_usd : payRow.amount_lbp) : totalCat;

  document.getElementById('drawer-body').innerHTML = `
    ${drawerFiltersHtml([], 'payments')}
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(collected, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">Allocated in ${year} · ${payments.length.toLocaleString()} payment(s)</div>
    </div>
    <div class="detail-section">
      <h4>${year} totals</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Fees Allocated</label><span>${fmtMoney(recv, u)}</span></div>
        <div class="detail-item"><label>Attributed payments</label><span>${fmtMoney(collected, u)}</span></div>
        <div class="detail-item"><label>Match</label><span>${fmtPct(recv ? (collected / recv) * 100 : 0)}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Payments <span style="font-weight:400;color:var(--muted)">— use Receipt → for detail</span></h4>
      <table class="lines-table">
        <thead><tr><th>Date</th><th>Receipt #</th><th>Taxpayer</th><th class="num">Category share</th><th></th></tr></thead>
        <tbody>
          ${payments.length ? payments.map((p) => `
            <tr>
              <td>${esc(p.date)}</td>
              <td><strong>${p.receipt_number ?? '—'}</strong></td>
              <td>${esc(p.taxpayer) || '—'}</td>
              <td class="num">${fmtMoney(p.category_amount, u)}</td>
              <td><button class="btn-link" type="button" data-action="receipt" data-receipt-id="${p.receipt_id}">Receipt →</button></td>
            </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--muted)">No payments match search</td></tr>`}
        </tbody>
      </table>
    </div>`;

  wireDrawerFilters({ mode: 'payments', feeTypeId, feeTypeDet, year });
  wireDetailButtons(document.getElementById('drawer-body'), (btn) => {
    if (btn.dataset.action === 'receipt') {
      const p = categoryYearPayments.find((x) => String(x.receipt_id) === btn.dataset.receiptId);
      if (p) openPaymentDetail(p);
    }
  });
}

function getCategoryItems() {
  if (useExactDateLedgers() || dateRangeIsNarrowed()) {
    const fromLedger = aggregateCategoriesFromReceivables();
    if (fromLedger) return fromLedger;
  }
  const cats = filterCategories(DATA.categories_by_year);
  const agg = {};
  cats.forEach((c) => {
    const k = categoryKey(c);
    if (!agg[k]) agg[k] = { ...c, category_key: k, amount: 0, lines: 0 };
    agg[k].amount += state.usd ? c.amount_usd : c.amount_lbp;
    agg[k].lines += c.line_count || 0;
  });
  return Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

function muniCategoryKey(r) {
  if (r.budget_code) return String(r.budget_code);
  if (r.chapter != null && r.section != null) return `${r.chapter}.${r.section}`;
  return r.budget_category || r.section_desc || 'other';
}

function getPaymentCategoryItems() {
  if (!MUNI_PAYMENTS) return null;
  const u = state.usd;
  const agg = {};
  filterMuniPaymentsList(MUNI_PAYMENTS).forEach((r) => {
    const cat = r.budget_category || r.section_desc || '—';
    const group = r.chapter_desc || 'Other';
    if (state.group !== 'all' && group !== state.group) return;
    if (state.search) {
      const hay = `${cat} ${group} ${r.budget_code || ''} ${r.beneficiary || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return;
    }
    const key = muniCategoryKey(r);
    if (!agg[key]) {
      agg[key] = {
        category_key: key,
        budget_code: r.budget_code || key,
        budget_category: cat,
        category_group: group,
        chapter: r.chapter,
        section: r.section,
        chapter_desc: r.chapter_desc,
        section_desc: r.section_desc,
        amount: 0,
        lines: 0,
      };
    }
    agg[key].amount += u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
    agg[key].lines += 1;
  });
  return Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

function getMuniPaymentsForCategory(categoryKey) {
  if (!MUNI_PAYMENTS) return [];
  return filterMuniPaymentsList(MUNI_PAYMENTS)
    .filter((r) => muniCategoryKey(r) === categoryKey)
    .filter((r) => state.group === 'all' || (r.chapter_desc || 'Other') === state.group)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function openMuniCategoryDetail(categoryKey) {
  const rows = getMuniPaymentsForCategory(categoryKey);
  if (!rows.length) return;
  const u = state.usd;
  const meta = rows[0];
  const total = rows.reduce((s, r) => s + (u ? r.amount_usd : r.amount_lbp), 0);
  const byYear = {};
  rows.forEach((r) => {
    const y = r.budget_year;
    if (y == null) return;
    if (!byYear[y]) byYear[y] = { year: y, amount: 0, lines: 0 };
    byYear[y].amount += u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
    byYear[y].lines += 1;
  });
  const yearRows = Object.values(byYear).sort((a, b) => a.year - b.year);
  const sample = rows.slice(0, 40);

  setDrawerBack(false);
  drawerContext = { type: 'muni-category', categoryKey };
  document.getElementById('drawer-title').textContent = 'Payment Category Detail';
  document.getElementById('drawer-body').innerHTML = `
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(total, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(meta.budget_category) || '—'} · ${rows.length.toLocaleString()} payments</div>
    </div>
    <div class="detail-section">
      <h4>Budget line</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Code</label><span>${esc(meta.budget_code) || '—'}</span></div>
        <div class="detail-item"><label>Chapter</label><span>${esc(meta.chapter_desc) || '—'}</span></div>
        <div class="detail-item wide"><label>Section</label><span>${esc(meta.section_desc || meta.budget_category) || '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>By year</h4>
      <table class="data-table">
        <thead><tr><th>Year</th><th class="num">Amount</th><th class="num">Payments</th></tr></thead>
        <tbody>
          ${yearRows.map((r) => `
            <tr>
              <td>${r.year}</td>
              <td class="num">${fmtMoney(r.amount, u)}</td>
              <td class="num">${r.lines.toLocaleString()}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="detail-section">
      <h4>Recent payments${rows.length > sample.length ? ` (showing ${sample.length})` : ''}</h4>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Seq</th><th>Beneficiary</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${sample.map((r, i) => `
            <tr>
              <td>${esc(r.date) || '—'}</td>
              <td class="num">${r.payment_seq_yr ?? '—'}</td>
              <td>${esc(r.beneficiary) || '—'}</td>
              <td class="num">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</td>
              <td><button class="btn-link" type="button" data-action="muni-pay" data-idx="${i}">Details →</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  wireDetailButtons(document.getElementById('drawer-body'), (btn) => {
    if (btn.dataset.action === 'muni-pay') {
      openMuniPayDetail(sample[Number(btn.dataset.idx)]);
      setDrawerBack(true, () => openMuniCategoryDetail(categoryKey));
    }
  });
  showDrawer();
}

function renderCategoryCharts() {
  if (state.activePage !== 'categories') return;
  renderGroupBarChart();
}

function renderGroupBarChart() {
  const el = document.getElementById('chart-group-bar');
  if (!el) return;

  const groups = {};
  if (state.categoriesTab === 'payments') {
    (getPaymentCategoryItems() || []).forEach((c) => {
      const g = c.category_group || 'Other';
      groups[g] = (groups[g] || 0) + (c.amount || 0);
    });
  } else if ((useExactDateLedgers() || dateRangeIsNarrowed()) && PAYMENTS) {
    forEachFilteredPaymentCreditLine((_, l) => {
      const g = l.category_group || 'Other';
      groups[g] = (groups[g] || 0) + (state.usd ? (l.amount_usd || 0) : (l.amount_lbp || 0));
    });
  } else {
    (DATA.payments_by_year || []).forEach((c) => {
      if (!rowInActiveYears(c)) return;
      if (state.group !== 'all' && c.category_group !== state.group) return;
      const g = c.category_group || 'Other';
      groups[g] = (groups[g] || 0) + (state.usd ? c.amount_usd : c.amount_lbp);
    });
  }
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const names = entries.map((e) => e[0]);
  const emptyMsg = state.categoriesTab === 'payments'
    ? 'No payment categories for current filters'
    : 'No collection data for current filters';
  const yTitle = state.categoriesTab === 'payments'
    ? (state.usd ? 'USD paid out' : 'LBP paid out')
    : (state.usd ? 'USD collected' : 'LBP collected');

  if (!names.length) {
    try { Plotly.purge(el); } catch (_) { /* noop */ }
    el.innerHTML = `<p class="chart-empty">${emptyMsg}</p>`;
    return;
  }

  if (el.querySelector('.chart-empty')) el.textContent = '';

  plotlyFresh('chart-group-bar', [{
    x: names,
    y: entries.map((e) => e[1]),
    type: 'bar',
    marker: { color: names.map((n) => GROUP_COLORS[n] || GROUP_COLORS.Other) },
    hovertemplate: '<b>%{x}</b><br>%{y:,.0f}<extra></extra>',
  }], {
    xaxis: { type: 'category', title: 'Budget chapter', tickangle: -12 },
    yaxis: { title: yTitle },
    margin: { t: 20, r: 16, b: 72, l: 56 },
  });

  setTimeout(() => {
    try { Plotly.Plots.resize(el); } catch (_) { /* noop */ }
  }, 80);
}

function categoryPeriodLabel() {
  const from = state.dateFrom || DATA?.meta?.date_min || '…';
  const to = state.dateTo || DATA?.meta?.date_max || '…';
  const yr = state.year !== 'all' ? ` · FY ${state.year}` : '';
  return `${from} → ${to}${yr}`;
}

async function renderCategories() {
  const titleEl = document.getElementById('categories-title');
  const chartTitle = document.getElementById('categories-chart-title');
  const hint = document.getElementById('categories-hint');
  const tbody = document.querySelector('#table-categories tbody');
  if (!tbody) return;

  const isPay = state.categoriesTab === 'payments';
  if (titleEl) titleEl.textContent = isPay ? 'Payment Categories' : 'Receivable Categories';
  if (chartTitle) chartTitle.textContent = isPay ? 'Paid out by budget chapter' : 'Received by budget chapter';

  if (isPay) {
    if (!MUNI_PAYMENTS) {
      if (hint) hint.innerHTML = 'Loading municipal payment categories…';
      await ensureMuniPayments();
    }
    const items = getPaymentCategoryItems() || [];
    const totalAmt = items.reduce((s, r) => s + r.amount, 0);
    if (hint) {
      hint.innerHTML = `Official <strong>expense</strong> budget sections · <strong>${esc(categoryPeriodLabel())}</strong> · <strong>${items.length}</strong> categories · <strong>${fmtMoney(totalAmt, state.usd)}</strong> paid out.`;
    }
    tbody.innerHTML = items.slice(0, 80).map((r) => `
      <tr>
        <td class="num">${esc(r.budget_code) || '—'}</td>
        <td>${esc(r.budget_category) || '—'}</td>
        <td>${badge(r.category_group)}</td>
        <td class="num">${fmtMoney(r.amount, state.usd)}</td>
        <td class="num">${r.lines.toLocaleString()}</td>
        <td><button class="btn-link" type="button" data-action="muni-cat" data-cat-key="${encodeURIComponent(r.category_key)}">Details →</button></td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">No payment categories match filters</td></tr>';

    wireDetailButtons(tbody, (btn) => {
      if (btn.dataset.action === 'muni-cat') {
        openMuniCategoryDetail(decodeURIComponent(btn.dataset.catKey || ''));
      }
    });
    renderCategoryCharts();
    return;
  }

  if (!RECEIVABLES) {
    if (hint) hint.innerHTML = 'Loading category lines for date filter…';
    await ensureReceivables();
  }
  const items = getCategoryItems();
  const totalAmt = items.reduce((s, r) => s + r.amount, 0);
  if (hint) {
    hint.innerHTML = `Official <strong>income</strong> budget sections · <strong>${esc(categoryPeriodLabel())}</strong> · <strong>${items.length}</strong> categories · <strong>${fmtMoney(totalAmt, state.usd)}</strong> fee allocation. Use Details → for per-year split.`;
  }

  tbody.innerHTML = items.slice(0, 50).map((r) => {
    const key = categoryKey(r);
    const { feeTypeId, feeTypeDet } = parseCategoryKey(key);
    const detAttr = feeTypeDet == null ? '' : ` data-fee-det="${feeTypeDet}"`;
    const code = r.budget_code || feeTypeId;
    return `
    <tr data-fee-id="${feeTypeId}"${detAttr}>
      <td>${esc(code)}</td>
      <td>${esc(r.FEE_TYPE_NAME)}</td>
      <td>${badge(r.category_group)}</td>
      <td class="num">${fmtMoney(r.amount, state.usd)}</td>
      <td class="num">${r.lines.toLocaleString()}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-fee-id="${feeTypeId}"${detAttr}>Details →</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">No categories match filters</td></tr>';

  wireDetailButtons(tbody, (btn) => {
    const det = btn.dataset.feeDet;
    openCategoryDetail(Number(btn.dataset.feeId), false, det == null || det === '' ? null : Number(det));
  });

  renderCategoryCharts();
}

function getAnalysisGroupRows() {
  const u = state.usd;
  const recv = {};
  const pay = {};

  if (useExactDateLedgers()) {
    forEachFilteredReceivableLine((_, l) => {
      const g = l.category_group || 'Other';
      recv[g] = (recv[g] || 0) + (u ? (l.amount_usd || 0) : (l.amount_lbp || 0));
    });
    forEachFilteredPaymentCreditLine((_, l) => {
      const g = l.category_group || 'Other';
      pay[g] = (pay[g] || 0) + (u ? (l.amount_usd || 0) : (l.amount_lbp || 0));
    });
  } else {
    filterCategories(DATA.categories_by_year).forEach((c) => {
      const g = c.category_group || 'Other';
      recv[g] = (recv[g] || 0) + (u ? c.amount_usd : c.amount_lbp);
    });
    (DATA.payments_by_year || []).forEach((c) => {
      if (!rowInActiveYears(c)) return;
      if (state.group !== 'all' && c.category_group !== state.group) return;
      const g = c.category_group || 'Other';
      pay[g] = (pay[g] || 0) + (u ? c.amount_usd : c.amount_lbp);
    });
  }

  return [...new Set([...Object.keys(recv), ...Object.keys(pay)])].map((g) => {
    const r = recv[g] || 0;
    const p = pay[g] || 0;
    return { group: g, receivables: r, payments: p, gap: r - p, rate: r ? (p / r) * 100 : 0 };
  }).sort((a, b) => b.receivables - a.receivables);
}

function getFilteredYearlyRows() {
  if (useExactDateLedgers()) {
    let rows = buildDateAwareYearlyRows();
    if (state.year !== 'all') rows = rows.filter((r) => Number(r.year) === Number(state.year));
    return rows;
  }
  const u = state.usd;
  let rows = DATA.yearly_summary.map((r) => {
    const payments = u ? r.payments_usd : r.payments_lbp;
    const fees = u ? (r.fee_allocated_usd ?? r.receivables_usd) : (r.fee_allocated_lbp ?? r.receivables_lbp);
    return {
      year: r.year,
      receivables: fees,
      payments,
      gap: null,
      collection_rate: null,
      allocation_coverage: r.allocation_coverage != null
        ? r.allocation_coverage
        : (payments ? (fees / payments) * 100 : 0),
    };
  });
  if (state.year !== 'all') rows = rows.filter((r) => r.year === Number(state.year));
  return rows;
}

function renderReceivables() {
  const u = state.usd;
  const groupRows = getAnalysisGroupRows();
  const totalRecv = groupRows.reduce((s, r) => s + r.receivables, 0);
  const totalPay = groupRows.reduce((s, r) => s + r.payments, 0);
  const totalDiff = totalRecv - totalPay;
  const totalRate = totalRecv ? (totalPay / totalRecv) * 100 : 0;
  const unlinked = PAYMENTS
    ? countUnlinkedReceipts(filterPaymentsList(PAYMENTS))
    : (DATA.meta?.unlinked_receipts ?? 0);

  const kpiEl = document.getElementById('analysis-kpis');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="kpi green"><div class="kpi-label">Fees Allocated</div><div class="kpi-value">${fmtMoney(totalRecv, u)}</div><div class="kpi-sub">${groupRows.length} groups</div></div>
      <div class="kpi"><div class="kpi-label">Payments Attributed</div><div class="kpi-value">${fmtMoney(totalPay, u)}</div><div class="kpi-sub">by fee group</div></div>
      <div class="kpi amber"><div class="kpi-label">Overall Match</div><div class="kpi-value">${fmtPct(totalRate)}</div><div class="kpi-sub">payments ÷ fees allocated</div></div>
      <div class="kpi rose"><div class="kpi-label">Unlinked Receipts</div><div class="kpi-value">${Number(unlinked).toLocaleString()}</div><div class="kpi-sub">diff ${fmtMoney(totalDiff, u)}</div></div>`;
  }

  const groups = groupRows.map((r) => r.group);
  plotly('chart-analysis-group', [
    { x: groups, y: groupRows.map((r) => r.receivables), name: 'Fees Allocated', type: 'bar', marker: { color: '#93b4ff' } },
    { x: groups, y: groupRows.map((r) => r.payments), name: 'Payments', type: 'bar', marker: { color: BLUE } },
  ], {
    barmode: 'group',
    xaxis: { type: 'category', tickangle: -12 },
    yaxis: { title: u ? 'USD' : 'LBP' },
    margin: { t: 20, r: 16, b: 72, l: 56 },
  });

  const rates = groupRows.map((r) => r.rate);
  plotly('chart-analysis-rate', [{
    y: groups.slice().reverse(),
    x: rates.slice().reverse(),
    type: 'bar',
    orientation: 'h',
    marker: { color: rates.slice().reverse().map((r) => (r >= 99.95 ? '#0d9f6e' : r >= 90 ? '#d97706' : '#dc2626')) },
    hovertemplate: '<b>%{y}</b><br>Match: %{x:.1f}%<extra></extra>',
  }], {
    xaxis: { title: '% match', range: [0, Math.max(120, Math.ceil(Math.max(...rates, 100) / 20) * 20)] },
    margin: { t: 20, r: 16, b: 48, l: 140 },
    shapes: [{
      type: 'line', xref: 'x', yref: 'paper', x0: 100, x1: 100, y0: 0, y1: 1,
      line: { color: '#94a3b8', width: 2, dash: 'dash' },
    }],
    showlegend: false,
  });

  const topItems = getCategoryItems().slice(0, 15);
  const top = topItems.map((c) => ({
    name: (c.FEE_TYPE_NAME || c.FEE_TYPE_SHORTNAME || '').slice(0, 40),
    val: c.amount,
  }));
  plotly('chart-recv-bar', [{
    y: top.map((t) => t.name).reverse(), x: top.map((t) => t.val).reverse(),
    type: 'bar', orientation: 'h', marker: { color: BLUE, opacity: 0.85 },
    hovertemplate: '<b>%{y}</b><br>%{x:,.0f}<extra></extra>',
  }], { margin: { l: 160, t: 20, r: 16, b: 48 }, xaxis: { title: u ? 'USD' : 'LBP' } });

  const ys = getFilteredYearlyRows().sort((a, b) => a.year - b.year);
  const coverages = ys.map((r) => Number(r.allocation_coverage) || 0);
  plotly('chart-gap', [{
    x: ys.map((r) => r.year), y: coverages,
    type: 'bar',
    marker: { color: coverages.map((c) => (c >= 99.95 ? '#0d9f6e' : c >= 90 ? '#d97706' : '#dc2626')) },
    hovertemplate: '<b>%{x}</b><br>Coverage: %{y:.1f}%<extra></extra>',
  }], { yaxis: { title: '% coverage', ticksuffix: '%' }, xaxis: { type: 'category' } });

  const tbody = document.querySelector('#table-analysis-groups tbody');
  const tfoot = document.getElementById('analysis-groups-totals');
  if (tbody) {
    tbody.innerHTML = groupRows.map((r) => {
      const share = totalRecv ? (r.receivables / totalRecv) * 100 : 0;
      const gapCls = r.gap >= 0 ? 'gap-pos' : 'gap-neg';
      return `<tr>
        <td>${badge(r.group)}</td>
        <td class="num">${fmtMoney(r.receivables, u)}</td>
        <td class="num">${fmtMoney(r.payments, u)}</td>
        <td class="num">${ratePill(r.rate)}</td>
        <td class="num ${gapCls}">${fmtMoney(r.gap, u)}</td>
        <td class="num">${fmtPct(share)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">No data for current filters</td></tr>';
  }
  if (tfoot) {
    const gapCls = totalDiff >= 0 ? 'gap-pos' : 'gap-neg';
    tfoot.innerHTML = `<td><strong>Total</strong></td>
      <td class="num"><strong>${fmtMoney(totalRecv, u)}</strong></td>
      <td class="num"><strong>${fmtMoney(totalPay, u)}</strong></td>
      <td class="num">${ratePill(totalRate)}</td>
      <td class="num ${gapCls}"><strong>${fmtMoney(totalDiff, u)}</strong></td>
      <td class="num"><strong>100%</strong></td>`;
  }

  if (state.activePage === 'receivables') {
    const groupNote = state.group !== 'all' ? ` · group <strong>${esc(state.group)}</strong>` : '';
    const yearNote = state.year !== 'all' ? ` · year <strong>${state.year}</strong>` : '';
    const dateNote = (state.dateFrom || state.dateTo)
      ? ` · <strong>${state.dateFrom || '…'}</strong> → <strong>${state.dateTo || '…'}</strong>`
      : '';
    document.getElementById('filter-summary').innerHTML =
      `Analysis: <strong>${groupRows.length}</strong> groups${dateNote}${yearNote}${groupNote} · ${u ? 'USD' : 'LBP'}`;
  }
}

function renderRates() {
  const rates = DATA.exchange_rates.sort((a, b) => a.year - b.year);
  plotly('chart-rates', [{
    x: rates.map((r) => r.year), y: rates.map((r) => r.lbp_per_usd),
    type: 'scatter', mode: 'lines+markers', line: { color: BLUE, width: 2.5 },
    marker: { size: 8, color: BLUE },
  }], { yaxis: { title: 'LBP per 1 USD', type: 'log' } });

  document.querySelector('#table-rates tbody').innerHTML = rates.map((r) => `
    <tr><td>${r.year}</td><td class="num">${Number(r.lbp_per_usd).toLocaleString()}</td>
    <td class="num">${r.usd_per_lbp?.toExponential(3) || '—'}</td><td>${r.source}</td></tr>`).join('');
}

const YEAR_COMPARE_COLS = [
  { key: 'year', label: 'Year', numeric: true, defaultDir: 'desc' },
  { key: 'payments', label: 'Received', numeric: true, defaultDir: 'desc' },
  { key: 'paid_out', label: 'Paid Out', numeric: true, defaultDir: 'desc' },
  { key: 'receivables', label: 'Fee Split', numeric: true, defaultDir: 'desc' },
  { key: 'allocation_coverage', label: 'Split %', numeric: true, defaultDir: 'desc' },
  { key: 'payments_count', label: 'Receipts', numeric: true, defaultDir: 'desc' },
  { key: 'paid_out_count', label: 'Pay outs', numeric: true, defaultDir: 'desc' },
  { key: 'lbp_per_usd', label: 'LBP / USD', numeric: true, defaultDir: 'desc' },
];

function ratePill(pct) {
  const n = Number(pct) || 0;
  const cls = n >= 99.95 ? 'good' : n >= 90 ? 'warn' : 'bad';
  return `<span class="rate-pill ${cls}">${fmtPct(n)}</span>`;
}

function getYearCompareRows() {
  if (useExactDateLedgers()) {
    let rows = buildDateAwareYearlyRows();
    if (state.year !== 'all') rows = rows.filter((r) => Number(r.year) === Number(state.year));
    return rows;
  }

  const u = state.usd;
  let rows;

  if (state.group === 'all') {
    rows = DATA.yearly_summary.map((r) => {
      const payments = u ? r.payments_usd : r.payments_lbp;
      const fees = u ? (r.fee_allocated_usd ?? r.receivables_usd) : (r.fee_allocated_lbp ?? r.receivables_lbp);
      return {
        year: r.year,
        receivables: fees,
        payments,
        paid_out: u ? (r.paid_out_usd || 0) : (r.paid_out_lbp || 0),
        paid_out_count: r.paid_out_count || 0,
        allocation_coverage: r.allocation_coverage != null
          ? r.allocation_coverage
          : (payments ? (fees / payments) * 100 : 0),
        payments_count: r.payments_count || 0,
        receivable_lines: r.fee_alloc_lines || r.receivable_lines || 0,
        lbp_per_usd: r.lbp_per_usd,
      };
    });
  } else {
    const recvByYear = {};
    filterCategories(DATA.categories_by_year).forEach((c) => {
      if (!recvByYear[c.year]) {
        recvByYear[c.year] = { year: c.year, receivables: 0, receivable_lines: 0, lbp_per_usd: c.lbp_per_usd };
      }
      recvByYear[c.year].receivables += u ? c.amount_usd : c.amount_lbp;
      recvByYear[c.year].receivable_lines += c.line_count || 0;
    });
    const payByYear = {};
    (DATA.payments_by_year || []).forEach((c) => {
      if (c.category_group !== state.group) return;
      if (!payByYear[c.year]) payByYear[c.year] = { payments: 0, line_count: 0 };
      payByYear[c.year].payments += u ? c.amount_usd : c.amount_lbp;
      payByYear[c.year].line_count += c.line_count || 0;
    });
    const years = new Set([...Object.keys(recvByYear), ...Object.keys(payByYear)].map(Number));
    rows = [...years].map((year) => {
      const recv = recvByYear[year]?.receivables || 0;
      const pay = payByYear[year]?.payments || 0;
      const rateRow = DATA.yearly_summary.find((r) => r.year === year);
      return {
        year,
        receivables: recv,
        payments: pay,
        allocation_coverage: pay ? (recv / pay) * 100 : 0,
        payments_count: payByYear[year]?.line_count || 0,
        receivable_lines: recvByYear[year]?.receivable_lines || 0,
        lbp_per_usd: rateRow?.lbp_per_usd || recvByYear[year]?.lbp_per_usd,
      };
    });
  }

  if (state.year !== 'all') rows = rows.filter((r) => r.year === Number(state.year));
  return rows;
}

function yearCompareSortValue(row, key) {
  return row[key] ?? 0;
}

function sortYearCompareRows(rows) {
  const col = YEAR_COMPARE_COLS.find((c) => c.key === state.yearCompareSortBy);
  if (!col) return rows;
  const mul = state.yearCompareSortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => (yearCompareSortValue(a, col.key) - yearCompareSortValue(b, col.key)) * mul);
}

function initYearCompareSort() {
  const thead = document.querySelector('#table-year-compare thead');
  if (!thead || thead.dataset.sortInit) return;
  thead.dataset.sortInit = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.yearCompareSortBy === key) {
      state.yearCompareSortDir = state.yearCompareSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.yearCompareSortBy = key;
      const col = YEAR_COMPARE_COLS.find((c) => c.key === key);
      state.yearCompareSortDir = col?.defaultDir || 'desc';
    }
    renderYearCompare();
  });
}

function renderYearCompareTableHeaders() {
  const row = document.querySelector('#table-year-compare thead tr');
  if (!row) return;
  row.innerHTML = YEAR_COMPARE_COLS.map((c) => {
    const active = state.yearCompareSortBy === c.key;
    const arrow = active ? (state.yearCompareSortDir === 'asc' ? '▲' : '▼') : '⇅';
    const cls = `sortable${c.key !== 'year' ? ' num' : ''}${active ? ' active' : ''}`;
    return `<th class="${cls}" data-sort="${c.key}" title="Sort by ${c.label}"><span>${c.label}</span><span class="sort-icon">${arrow}</span></th>`;
  }).join('');
}

function renderYearCompare() {
  if (!DATA) return;
  renderYearCompareTableHeaders();
  const u = state.usd;
  const rows = sortYearCompareRows(getYearCompareRows());

  const totalRecv = rows.reduce((s, r) => s + r.receivables, 0);
  const totalPay = rows.reduce((s, r) => s + r.payments, 0);
  const totalCoverage = totalPay ? (totalRecv / totalPay) * 100 : 0;

  const totalPaid = rows.reduce((s, r) => s + (r.paid_out || 0), 0);
  document.getElementById('year-compare-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Years</div><div class="kpi-value">${rows.length}</div></div>
    <div class="kpi green"><div class="kpi-label">Total Received</div><div class="kpi-value">${fmtMoney(totalPay, u)}</div></div>
    <div class="kpi"><div class="kpi-label">Total Paid Out</div><div class="kpi-value">${fmtMoney(totalPaid, u)}</div></div>
    <div class="kpi amber"><div class="kpi-label">Fee Split</div><div class="kpi-value">${fmtMoney(totalRecv, u)}</div></div>`;

  const tbody = document.querySelector('#table-year-compare tbody');
  tbody.innerHTML = rows.map((r) => {
    const cov = r.allocation_coverage != null
      ? r.allocation_coverage
      : (r.payments ? (r.receivables / r.payments) * 100 : 0);
    return `<tr>
      <td><strong>${r.year}</strong></td>
      <td class="num">${fmtMoney(r.payments, u)}</td>
      <td class="num">${fmtMoney(r.paid_out || 0, u)}</td>
      <td class="num">${fmtMoney(r.receivables, u)}</td>
      <td class="num">${ratePill(cov)}</td>
      <td class="num">${(r.payments_count || 0).toLocaleString()}</td>
      <td class="num">${(r.paid_out_count || 0).toLocaleString()}</td>
      <td class="num">${r.lbp_per_usd ? Number(r.lbp_per_usd).toLocaleString() : '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No years match filters</td></tr>';

  const tfoot = document.getElementById('year-compare-totals');
  if (tfoot) {
    tfoot.innerHTML = `
      <td><strong>Total</strong></td>
      <td class="num">${fmtMoney(totalPay, u)}</td>
      <td class="num">${fmtMoney(totalPaid, u)}</td>
      <td class="num">${fmtMoney(totalRecv, u)}</td>
      <td class="num">${ratePill(totalCoverage)}</td>
      <td class="num">${rows.reduce((s, r) => s + (r.payments_count || 0), 0).toLocaleString()}</td>
      <td class="num">${rows.reduce((s, r) => s + (r.paid_out_count || 0), 0).toLocaleString()}</td>
      <td class="num">—</td>`;
  }

  if (state.activePage === 'year-compare') {
    const groupNote = state.group !== 'all' ? ` · group <strong>${esc(state.group)}</strong>` : '';
    const yearNote = state.year !== 'all' ? ` · year <strong>${state.year}</strong>` : '';
    const dateNote = (state.dateFrom || state.dateTo)
      ? ` · <strong>${state.dateFrom || '…'}</strong> → <strong>${state.dateTo || '…'}</strong>`
      : '';
    document.getElementById('filter-summary').innerHTML =
      `Showing <strong>${rows.length}</strong> year(s)${dateNote}${yearNote}${groupNote} · ${u ? 'USD' : 'LBP'}`;
  }

  const chartRows = [...rows].sort((a, b) => a.year - b.year);
  const rates = chartRows.map((r) => Number(
    r.allocation_coverage != null
      ? r.allocation_coverage
      : (r.payments ? (r.receivables / r.payments) * 100 : 0)
  ) || 0);
  const ymax = Math.max(120, Math.ceil(Math.max(...rates, 100) / 20) * 20 + 20);
  const years = chartRows.map((r) => String(r.year));
  plotlyFresh('chart-year-compare', [{
    x: years,
    y: rates,
    type: 'bar',
    marker: { color: rates.map((r) => (r >= 99.95 ? '#0d9f6e' : r >= 90 ? '#d97706' : '#dc2626')) },
    hovertemplate: '<b>%{x}</b><br>Coverage: %{y:.1f}%<extra></extra>',
  }], {
    xaxis: { type: 'category', categoryorder: 'array', categoryarray: years, title: 'Year' },
    yaxis: { title: '% coverage', range: [0, ymax], ticksuffix: '%' },
    shapes: [{
      type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 100, y1: 100,
      line: { color: '#94a3b8', width: 2, dash: 'dash' },
    }],
    showlegend: false,
    margin: { t: 20, r: 16, b: 48, l: 56 },
  });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

initAuth();


/* —— Municipal payments (money out / MBS_PAYMENTS) —— */

function filterMuniPaymentsList(list) {
  return (list || []).filter((r) => {
    if (!inDateRange(r.date)) return false;
    if (state.year !== 'all' && r.budget_year !== Number(state.year)) return false;
    if (state.search) {
      const hay = [
        r.payment_seq_yr, r.beneficiary, r.notes, r.check_num, r.cashier, r.user_id,
        r.budget_category, r.chapter_desc, r.section_desc, r.purpose, r.budget_code,
      ].join(' ').toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

const MUNI_SORT_COLS = [
  { key: 'date', label: 'Date', numeric: false, defaultDir: 'desc' },
  { key: 'payment_seq_yr', label: 'Seq #', numeric: true, defaultDir: 'desc' },
  { key: 'beneficiary', label: 'Beneficiary', numeric: false, defaultDir: 'asc' },
  { key: 'budget_category', label: 'Budget category', numeric: false, defaultDir: 'asc' },
  { key: 'purpose', label: 'Purpose', numeric: false, defaultDir: 'asc' },
  { key: 'pay_type', label: 'Type', numeric: false, defaultDir: 'asc' },
  { key: 'amount', label: 'Amount', numeric: true, defaultDir: 'desc' },
  { key: 'budget_year', label: 'Year', numeric: true, defaultDir: 'desc' },
];

function muniSortValue(r, key) {
  const u = state.usd;
  switch (key) {
    case 'date': return r.date || '';
    case 'payment_seq_yr': return Number(r.payment_seq_yr) || 0;
    case 'beneficiary': return (r.beneficiary || '').toLowerCase();
    case 'budget_category': return (r.budget_category || '').toLowerCase();
    case 'purpose': return (r.purpose || '').toLowerCase();
    case 'pay_type': return (r.pay_type || '').toLowerCase();
    case 'check_num': return (r.check_num || '').toLowerCase();
    case 'amount': return u ? (r.amount_usd || 0) : (r.amount_lbp || 0);
    case 'budget_year': return Number(r.budget_year) || 0;
    default: return '';
  }
}

function sortMuniPaymentsList(list) {
  const col = MUNI_SORT_COLS.find((c) => c.key === state.muniSortBy);
  if (!col) return list;
  const mul = state.muniSortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = muniSortValue(a, col.key);
    const vb = muniSortValue(b, col.key);
    if (col.numeric) return (va - vb) * mul;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * mul;
  });
}

function initMuniPayTableSort() {
  const thead = document.querySelector('#muni-payments-table thead');
  if (!thead || thead.dataset.sortInit) return;
  thead.dataset.sortInit = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.muniSortBy === key) {
      state.muniSortDir = state.muniSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.muniSortBy = key;
      const col = MUNI_SORT_COLS.find((c) => c.key === key);
      state.muniSortDir = col?.defaultDir || 'asc';
    }
    state.muniPage = 1;
    renderMuniPayTracker();
  });
}

function renderMuniPayTableHeaders() {
  const row = document.querySelector('#muni-payments-table thead tr');
  if (!row) return;
  row.innerHTML = MUNI_SORT_COLS.map((c) => {
    const active = state.muniSortBy === c.key;
    const arrow = active ? (state.muniSortDir === 'asc' ? '▲' : '▼') : '⇅';
    const cls = `sortable${c.numeric ? ' num' : ''}${active ? ' active' : ''}`;
    return `<th class="${cls}" data-sort="${c.key}" title="Sort by ${c.label}"><span>${c.label}</span><span class="sort-icon">${arrow}</span></th>`;
  }).join('') + '<th class="col-actions"></th>';
}

function renderMuniPayTracker() {
  const banner = document.getElementById('muni-pay-banner');
  const available = (MUNI_PAYMENTS && MUNI_PAYMENTS.length) || DATA?.meta?.muni_payments_available;
  if (banner) {
    if (!available) {
      banner.innerHTML = `<p class="chart-hint" style="margin:0;padding:8px 0">No municipal outflow data loaded. Export <strong>MBS_PAYMENTS.csv</strong> (and optionally <strong>MBS_PAY_ORDER.csv</strong>) into <code>municipal_analysis/</code>, then run <code>python scripts/build_dashboard_json.py</code>.</p>`;
      banner.classList.remove('hidden');
    } else {
      banner.innerHTML = '';
      banner.classList.add('hidden');
    }
  }

  if (!MUNI_PAYMENTS) return;
  renderMuniPayTableHeaders();
  const filtered = sortMuniPaymentsList(filterMuniPaymentsList(MUNI_PAYMENTS));
  const u = state.usd;
  const total = filtered.reduce((s, r) => s + (u ? r.amount_usd : r.amount_lbp), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / state.muniPageSize) || 1);
  if (state.muniPage > pages) state.muniPage = pages;
  const start = (state.muniPage - 1) * state.muniPageSize;
  const pageRows = filtered.slice(start, start + state.muniPageSize);

  const kpis = document.getElementById('muni-pay-kpis');
  if (kpis) {
    kpis.innerHTML = `
      <div class="kpi"><div class="kpi-label">Filtered Paid Out</div><div class="kpi-value">${filtered.length ? fmtMoney(total, u) : '—'}</div></div>
      <div class="kpi"><div class="kpi-label">Payment Records</div><div class="kpi-value">${filtered.length.toLocaleString()}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Payment</div><div class="kpi-value">${filtered.length ? fmtMoney(total / filtered.length, u) : '—'}</div></div>`;
  }

  const countEl = document.getElementById('muni-pay-count');
  if (countEl) countEl.textContent = `(${filtered.length.toLocaleString()} records)`;
  if (state.activePage === 'muni-pay') {
    updateFilterSummary(filtered.length, MUNI_PAYMENTS.length, 'municipal payments');
  }

  const tbody = document.querySelector('#muni-payments-table tbody');
  if (!tbody) return;
  tbody.innerHTML = pageRows.map((r, i) => `
    <tr>
      <td>${esc(r.date) || '—'}</td>
      <td class="num"><strong>${r.payment_seq_yr ?? '—'}</strong></td>
      <td>${esc(r.beneficiary) || '—'}</td>
      <td title="${esc(r.chapter_desc || '')}${r.budget_code ? ` (${esc(r.budget_code)})` : ''}">${esc(r.budget_category) || '—'}</td>
      <td class="cell-clip" title="${esc(r.purpose) || ''}">${esc(r.purpose) || '—'}</td>
      <td>${esc(r.pay_type_label || r.pay_type) || '—'}</td>
      <td class="num">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</td>
      <td class="num">${r.budget_year ?? '—'}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-idx="${start + i}">Details →</button></td>
    </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">${available ? 'No municipal payments match filters' : 'Export MBS_PAYMENTS to load outflows'}</td></tr>`;

  wireDetailButtons(tbody, (btn) => openMuniPayDetail(filtered[Number(btn.dataset.idx)]));
  renderMuniPager('muni-pager-top', pages, filtered.length);
  renderMuniPager('muni-pager-bottom', pages, filtered.length);
}

function renderMuniPager(id, pages, total) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <button type="button" id="${id}-prev" ${state.muniPage <= 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${state.muniPage} / ${pages} (${total.toLocaleString()} total)</span>
    <button type="button" id="${id}-next" ${state.muniPage >= pages ? 'disabled' : ''}>Next →</button>
    <select id="${id}-size" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
      ${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === state.muniPageSize ? 'selected' : ''}>${n}/page</option>`).join('')}
    </select>`;
  document.getElementById(`${id}-prev`)?.addEventListener('click', () => { state.muniPage--; renderMuniPayTracker(); });
  document.getElementById(`${id}-next`)?.addEventListener('click', () => { state.muniPage++; renderMuniPayTracker(); });
  document.getElementById(`${id}-size`)?.addEventListener('change', (e) => {
    state.muniPageSize = Number(e.target.value);
    state.muniPage = 1;
    renderMuniPayTracker();
  });
}

function openMuniPayDetail(r) {
  if (!r) return;
  const u = state.usd;
  setDrawerBack(false);
  drawerContext = null;
  const purposeLines = Array.isArray(r.purpose_lines) ? r.purpose_lines : [];
  const rate = (r.amount_lbp && r.amount_usd) ? (r.amount_lbp / r.amount_usd) : 89500;
  const purposeRows = purposeLines.length
    ? purposeLines.map((l) => {
        const lineAmt = l.amount_lbp != null
          ? fmtMoney(u ? l.amount_lbp / rate : l.amount_lbp, u)
          : '—';
        return `
        <tr>
          <td class="num">${l.seq ?? '—'}</td>
          <td>${esc(l.description) || '—'}</td>
          <td class="num">${lineAmt}</td>
        </tr>`;
      }).join('')
    : '';
  document.getElementById('drawer-title').textContent = 'Municipal Payment Detail';
  document.getElementById('drawer-body').innerHTML = `
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(r.date) || '—'} · Seq #${r.payment_seq_yr ?? '—'}</div>
      <div style="color:var(--muted);font-size:.8rem;margin-top:2px">Money paid out by the municipality</div>
    </div>
    <div class="detail-section">
      <h4>Budget category</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Code</label><span>${esc(r.budget_code) || '—'}</span></div>
        <div class="detail-item"><label>Chapter</label><span>${esc(r.chapter_desc) || (r.chapter != null ? r.chapter : '—')}</span></div>
        <div class="detail-item"><label>Section</label><span>${esc(r.section_desc) || (r.section != null ? r.section : '—')}</span></div>
        <div class="detail-item"><label>Paragraph</label><span>${esc(r.paragraph_desc) || (r.paragraph != null ? r.paragraph : '—')}</span></div>
        <div class="detail-item wide"><label>Category</label><span>${esc(r.budget_category) || '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Purpose</h4>
      <div class="detail-grid">
        <div class="detail-item wide"><label>Reserve / acceptance</label><span>${esc(r.purpose) || '—'}</span></div>
      </div>
      ${purposeRows ? `
      <table class="data-table" style="margin-top:12px">
        <thead><tr><th>#</th><th>Detail line</th><th class="num">Amount</th></tr></thead>
        <tbody>${purposeRows}</tbody>
      </table>` : ''}
    </div>
    <div class="detail-section">
      <h4>Payment</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Seq / Year</label><span>${r.payment_seq_yr ?? '—'} / ${r.budget_year ?? '—'}</span></div>
        <div class="detail-item"><label>Pay Type</label><span>${esc(r.pay_type_label || r.pay_type) || '—'}</span></div>
        <div class="detail-item"><label>Check #</label><span>${esc(r.check_num) || '—'}</span></div>
        <div class="detail-item"><label>Accept #</label><span>${r.accept_seq_yr ?? '—'}</span></div>
        <div class="detail-item"><label>Cashier</label><span>${esc(r.cashier) || '—'}</span></div>
        <div class="detail-item"><label>Expense auth</label><span>${esc(r.expense_auth_by) || '—'}</span></div>
        <div class="detail-item"><label>Pay auth</label><span>${esc(r.pay_auth_by) || '—'}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Beneficiary</h4>
      <div class="detail-grid">
        <div class="detail-item wide"><label>Name</label><span>${esc(r.beneficiary) || '—'}</span></div>
        ${r.notes ? `<div class="detail-item wide"><label>Notes</label><span>${esc(r.notes)}</span></div>` : ''}
      </div>
    </div>`;
  showDrawer();
}
