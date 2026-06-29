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
let PAYMENTS = null;
let RECEIVABLES = null;
let paymentsLoading = false;
let receivablesLoading = false;

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
  activePage: 'overview',
  sortBy: 'date',
  sortDir: 'desc',
  recvSortBy: 'date',
  recvSortDir: 'desc',
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

  const res = await fetch('data/kehale.json');
  DATA = await res.json();
  if (loadingText) loadingText.textContent = 'Loading payments…';
  await paymentsPromise;

  document.getElementById('meta-subtitle').textContent =
    `${DATA.meta.municipality} · ${DATA.meta.receipt_count?.toLocaleString()} receipts`;
  initFilters();
  initPaymentTableSort();
  initReceivableTableSort();
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
  ['chart-yearly', 'chart-collection', 'chart-daily', 'chart-group-bar', 'chart-recv-bar', 'chart-gap', 'chart-rates'].forEach((id) => {
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
  document.getElementById('recv-count').textContent = '(loading…)';
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
  document.getElementById('tracker-count').textContent = '(loading…)';
  const res = await fetch('data/payments.json');
  PAYMENTS = await res.json();
  paymentsLoading = false;
  return PAYMENTS;
}

function initFilters() {
  const from = document.getElementById('filter-date-from');
  const to = document.getElementById('filter-date-to');
  from.value = DATA.meta.date_min || '';
  to.value = DATA.meta.date_max || '';
  state.dateFrom = from.value;
  state.dateTo = to.value;

  const yearSel = document.getElementById('filter-year');
  DATA.meta.years.forEach((y) => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    yearSel.appendChild(o);
  });

  const grpSel = document.getElementById('filter-group');
  DATA.category_groups.forEach((g) => {
    const o = document.createElement('option');
    o.value = g.category_group; o.textContent = g.category_group;
    grpSel.appendChild(o);
  });

  const onChange = () => {
    state.dateFrom = from.value;
    state.dateTo = to.value;
    state.year = yearSel.value;
    state.group = grpSel.value;
    state.search = document.getElementById('filter-search').value.trim().toLowerCase();
    state.page = 1;
    state.recvPage = 1;
    renderAll();
  };

  from.addEventListener('change', onChange);
  to.addEventListener('change', onChange);
  yearSel.addEventListener('change', onChange);
  grpSel.addEventListener('change', onChange);
  document.getElementById('filter-search').addEventListener('input', debounce(onChange, 250));

  document.getElementById('btn-usd').addEventListener('click', () => {
    state.usd = !state.usd;
    document.getElementById('btn-usd').classList.toggle('active', state.usd);
    document.getElementById('btn-usd').textContent = state.usd ? 'USD' : 'LBP';
    renderAll();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    from.value = DATA.meta.date_min || '';
    to.value = DATA.meta.date_max || '';
    yearSel.value = 'all';
    grpSel.value = 'all';
    document.getElementById('filter-search').value = '';
    onChange();
  });

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);

  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    document.getElementById('nav-links')?.classList.toggle('open');
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
      if (page === 'recv-tracker') await ensureReceivables();
      renderAll();
      if (page === 'categories') {
        setTimeout(() => renderCategoryCharts(), 150);
      } else {
        setTimeout(resizeVisibleCharts, 80);
      }
    });
  });

  window.addEventListener('resize', debounce(resizeVisibleCharts, 150));
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

function filterPaymentsList(list) {
  return list.filter((p) => {
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
    const cls = `sortable${c.key === 'amount' ? ' num' : ''}${active ? ' active' : ''}`;
    return `<th class="${cls}" data-sort="${c.key}" title="Sort by ${c.label}"><span>${c.label}</span><span class="sort-icon">${arrow}</span></th>`;
  }).join('') + '<th class="col-actions"></th>';
}

function filterCategories(rows) {
  let r = rows;
  if (state.year !== 'all') r = r.filter((x) => x.year === Number(state.year));
  if (state.group !== 'all') r = r.filter((x) => x.category_group === state.group);
  return r;
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
}

function renderAll() {
  renderKPIs();
  renderYearlyChart();
  renderCollectionChart();
  renderDailyChart();
  renderCategories();
  renderReceivables();
  renderRates();
  if (PAYMENTS) renderTracker();
  if (RECEIVABLES) renderRecvTracker();
}

function renderKPIs() {
  const list = PAYMENTS ? filterPaymentsList(PAYMENTS) : [];
  const u = state.usd;
  let pay, count, recv, rate;

  if (list.length) {
    pay = list.reduce((s, p) => s + (u ? p.amount_usd : p.amount_lbp), 0);
    count = list.length;
    const yrs = new Set(list.map((p) => p.budget_year));
    const ys = DATA.yearly_summary.filter((r) => yrs.has(r.year));
    recv = ys.reduce((s, r) => s + (u ? r.receivables_usd : r.receivables_lbp), 0);
    rate = recv ? (pay / recv) * 100 : 0;
    updateFilterSummary(count, PAYMENTS.length);
  } else {
    const yr = state.year === 'all' ? null : Number(state.year);
    const rows = yr ? DATA.yearly_summary.filter((r) => r.year === yr) : DATA.yearly_summary;
    pay = rows.reduce((s, r) => s + (u ? r.payments_usd : r.payments_lbp), 0);
    recv = rows.reduce((s, r) => s + (u ? r.receivables_usd : r.receivables_lbp), 0);
    count = rows.reduce((s, r) => s + (r.payments_count || 0), 0);
    rate = recv ? (pay / recv) * 100 : 0;
    updateFilterSummary(null, DATA.meta.receipt_count);
  }

  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Payments Collected</div><div class="kpi-value">${fmtMoney(pay, u)}</div><div class="kpi-sub">${count.toLocaleString()} receipts</div></div>
    <div class="kpi green"><div class="kpi-label">Receivables Charged</div><div class="kpi-value">${fmtMoney(recv, u)}</div><div class="kpi-sub">ledger credits</div></div>
    <div class="kpi amber"><div class="kpi-label">Collection Rate</div><div class="kpi-value">${fmtPct(rate)}</div><div class="kpi-sub">payments ÷ receivables</div></div>
    <div class="kpi rose"><div class="kpi-label">Outstanding Gap</div><div class="kpi-value">${fmtMoney(recv - pay, u)}</div><div class="kpi-sub">receivables − payments</div></div>`;
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
  const ys = DATA.yearly_summary.sort((a, b) => a.year - b.year);
  const u = state.usd;
  plotly('chart-yearly', [
    { x: ys.map((r) => r.year), y: ys.map((r) => u ? r.receivables_usd : r.receivables_lbp), name: 'Receivables', type: 'bar', marker: { color: '#93b4ff' } },
    { x: ys.map((r) => r.year), y: ys.map((r) => u ? r.payments_usd : r.payments_lbp), name: 'Payments', type: 'bar', marker: { color: BLUE } },
  ], { barmode: 'group', yaxis: { title: u ? 'USD' : 'LBP' } });
}

function renderCollectionChart() {
  const ys = DATA.yearly_summary.sort((a, b) => a.year - b.year);
  const years = ys.map((r) => String(r.year));
  const rates = ys.map((r) => Number(r.collection_rate) || 0);
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
    hovertemplate: '<b>%{x}</b><br>Collected: %{y:.1f}%<br><i>payments ÷ receivables</i><extra></extra>',
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
      title: '% collected',
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
    <div class="kpi"><div class="kpi-label">Filtered Total</div><div class="kpi-value">${fmtMoney(total, u)}</div></div>
    <div class="kpi"><div class="kpi-label">Payments</div><div class="kpi-value">${filtered.length.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-label">Avg Payment</div><div class="kpi-value">${fmtMoney(filtered.length ? total / filtered.length : 0, u)}</div></div>`;

  document.getElementById('tracker-count').textContent = `(${filtered.length.toLocaleString()} records)`;
  if (state.activePage === 'tracker') {
    updateFilterSummary(filtered.length, PAYMENTS.length, 'payments');
  }

  const tbody = document.querySelector('#payments-table tbody');
  tbody.innerHTML = pageRows.map((p, i) => {
    const grp = (p.category_groups || [])[0] || '—';
    return `<tr data-idx="${start + i}">
      <td>${esc(p.date)}</td>
      <td><strong>${p.receipt_number ?? '—'}</strong></td>
      <td>${esc(p.taxpayer) || '—'}</td>
      <td>${esc(p.primary_category) || '—'}</td>
      <td>${grp !== '—' ? badge(grp) : '—'}</td>
      <td class="num">${fmtMoney(u ? p.amount_usd : p.amount_lbp, u)}</td>
      <td>${p.budget_year ?? '—'}</td>
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
  { key: 'amount', label: 'Charged', numeric: true, defaultDir: 'desc' },
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
    const cls = `sortable${c.key === 'amount' ? ' num' : ''}${active ? ' active' : ''}`;
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
    <div class="kpi green"><div class="kpi-label">Filtered Total Charged</div><div class="kpi-value">${fmtMoney(total, u)}</div></div>
    <div class="kpi"><div class="kpi-label">Charge Records</div><div class="kpi-value">${filtered.length.toLocaleString()}</div></div>
    <div class="kpi"><div class="kpi-label">Avg Charge</div><div class="kpi-value">${fmtMoney(filtered.length ? total / filtered.length : 0, u)}</div></div>`;

  document.getElementById('recv-count').textContent = `(${filtered.length.toLocaleString()} records)`;
  if (state.activePage === 'recv-tracker') {
    updateFilterSummary(filtered.length, RECEIVABLES.length, 'charges');
  }

  const tbody = document.querySelector('#receivables-table tbody');
  tbody.innerHTML = pageRows.map((r, i) => {
    const grp = (r.category_groups || [])[0] || '—';
    return `<tr data-idx="${start + i}">
      <td>${esc(r.date) || '—'}</td>
      <td><strong>${r.pay_trans_id ?? '—'}</strong></td>
      <td>${esc(r.taxpayer) || '—'}</td>
      <td>${esc(r.primary_category) || '—'}</td>
      <td>${grp !== '—' ? badge(grp) : '—'}</td>
      <td class="num">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</td>
      <td>${r.budget_year ?? '—'}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-idx="${start + i}">Details →</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No receivable charges match filters</td></tr>';

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
  document.getElementById('drawer-title').textContent = 'Receivable Charge Detail';
  document.getElementById('drawer-body').innerHTML = `
    <div class="detail-section">
      <div class="detail-amount">${fmtMoney(u ? r.amount_usd : r.amount_lbp, u)}</div>
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">${esc(r.date) || '—'} · Trans #${r.pay_trans_id}</div>
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
      <h4>Charge Lines <span style="font-weight:400;color:var(--muted)">(${r.line_count} CREDIT lines)</span></h4>
      <table class="lines-table">
        <thead><tr><th>#</th><th>Category</th><th>Group</th><th class="num">Charged</th></tr></thead>
        <tbody>
          ${(r.lines || []).map((l) => `
            <tr>
              <td>${l.seq ?? '—'}</td>
              <td>${esc(l.fee_short || l.fee_name) || '—'}</td>
              <td>${l.category_group ? badge(l.category_group) : '—'}</td>
              <td class="num">${fmtMoney(u ? l.amount_usd : l.amount_lbp, u)}</td>
            </tr>`).join('') || '<tr><td colspan="4">No charge lines</td></tr>'}
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

  document.getElementById('drawer-title').textContent = 'Payment Detail';
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
    ${credits.length ? `<div class="detail-section"><h4>Charge Breakdown (CREDIT)</h4>
      <table class="lines-table"><thead><tr><th>Fee</th><th>Group</th><th class="num">Charged</th></tr></thead><tbody>
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

function wireDrawerFilters({ mode, feeTypeId, year, years }) {
  const bar = document.getElementById('drawer-filters');
  if (!bar) return;
  bar.querySelector('.drawer-search')?.addEventListener('input', debounce((e) => {
    drawerLocal.search = e.target.value.trim().toLowerCase();
    if (mode === 'years') openCategoryDetail(feeTypeId, true);
    else renderCategoryYearPayments(feeTypeId, year);
  }, 200));
  bar.querySelector('.drawer-year')?.addEventListener('change', (e) => {
    drawerLocal.filterYear = e.target.value;
    openCategoryDetail(feeTypeId, true);
  });
}

function getCategoryYearlyRows(feeTypeId) {
  return filterCategories(DATA.categories_by_year)
    .filter((c) => c.FEE_TYPE_ID === feeTypeId)
    .sort((a, b) => a.year - b.year);
}

function getCategoryPaymentRows(feeTypeId) {
  return (DATA.payments_by_year || [])
    .filter((c) => c.FEE_TYPE_ID === feeTypeId)
    .filter((c) => state.year === 'all' || c.year === Number(state.year))
    .filter((c) => state.group === 'all' || c.category_group === state.group)
    .sort((a, b) => a.year - b.year);
}

function getPaymentsForCategoryYear(feeTypeId, year) {
  if (!PAYMENTS) return [];
  const u = state.usd;
  return PAYMENTS.filter((p) => {
    if (p.budget_year !== year) return false;
    if (!inDateRange(p.date)) return false;
    if (state.search) {
      const hay = `${p.receipt_number} ${p.taxpayer} ${p.primary_category}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return (p.lines || []).some((l) => l.fee_type_id === feeTypeId && l.account_type === 'CREDIT');
  }).map((p) => {
    const credits = (p.lines || []).filter((l) => l.fee_type_id === feeTypeId && l.account_type === 'CREDIT');
    const categoryAmount = credits.reduce((s, l) => s + (u ? l.amount_usd : l.amount_lbp), 0);
    return { ...p, category_amount: categoryAmount };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function openCategoryDetail(feeTypeId, keepFilters = false) {
  const u = state.usd;
  const recvRows = getCategoryYearlyRows(feeTypeId);
  if (!recvRows.length) return;

  if (!keepFilters) resetDrawerLocal();

  const meta = recvRows[0];
  const feeMeta = (DATA.fee_types || []).find((f) => Number(f.FEE_TYPE_ID) === feeTypeId) || {};
  const payRows = getCategoryPaymentRows(feeTypeId);

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

  drawerContext = { type: 'category', feeTypeId };
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
        <div class="detail-item"><label>Collected</label><span>${fmtMoney(totalPay, u)}</span></div>
        <div class="detail-item"><label>Collection rate</label><span>${fmtPct(rate)}</span></div>
        <div class="detail-item"><label>Years shown</label><span>${yearRows.length.toLocaleString()} / ${allYears.length}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Per year <span style="font-weight:400;color:var(--muted)">— use Payments → for detail</span></h4>
      <table class="lines-table">
        <thead><tr><th>Year</th><th class="num">Receivables</th><th class="num">Collected</th><th class="num">Rate</th><th class="num">Lines</th><th></th></tr></thead>
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

  wireDrawerFilters({ mode: 'years', feeTypeId, years: allYears });
  wireDetailButtons(document.getElementById('drawer-body'), (btn) => {
    if (btn.dataset.action === 'year') openCategoryYearDetail(feeTypeId, Number(btn.dataset.year));
  });

  showDrawer();
}

let categoryYearPayments = [];

async function openCategoryYearDetail(feeTypeId, year) {
  drawerLocal.search = '';
  drawerContext = { type: 'category-year', feeTypeId, year };
  setDrawerBack(true, () => openCategoryDetail(feeTypeId, true));
  document.getElementById('drawer-title').textContent = `${year} · loading…`;
  document.getElementById('drawer-body').innerHTML = '<p style="color:var(--muted);padding:20px 0">Loading payments…</p>';
  showDrawer();

  await ensurePayments();
  categoryYearPayments = getPaymentsForCategoryYear(feeTypeId, year);
  const meta = getCategoryYearlyRows(feeTypeId).find((r) => r.year === year) || getCategoryYearlyRows(feeTypeId)[0] || {};
  document.getElementById('drawer-title').textContent = `${year} · ${esc(meta.FEE_TYPE_SHORTNAME || meta.FEE_TYPE_NAME || `Fee ${feeTypeId}`)}`;
  renderCategoryYearPayments(feeTypeId, year);
}

function renderCategoryYearPayments(feeTypeId, year) {
  const u = state.usd;
  const recvRow = getCategoryYearlyRows(feeTypeId).find((r) => r.year === year);
  const payRow = getCategoryPaymentRows(feeTypeId).find((r) => r.year === year);

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
      <div style="color:var(--muted);font-size:.85rem;margin-top:4px">Collected in ${year} · ${payments.length.toLocaleString()} payment(s)</div>
    </div>
    <div class="detail-section">
      <h4>${year} totals</h4>
      <div class="detail-grid">
        <div class="detail-item"><label>Receivables</label><span>${fmtMoney(recv, u)}</span></div>
        <div class="detail-item"><label>Collected (category)</label><span>${fmtMoney(collected, u)}</span></div>
        <div class="detail-item"><label>Rate</label><span>${fmtPct(recv ? (collected / recv) * 100 : 0)}</span></div>
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

  wireDrawerFilters({ mode: 'payments', feeTypeId, year });
  wireDetailButtons(document.getElementById('drawer-body'), (btn) => {
    if (btn.dataset.action === 'receipt') {
      const p = categoryYearPayments.find((x) => String(x.receipt_id) === btn.dataset.receiptId);
      if (p) openPaymentDetail(p);
    }
  });
}

function getCategoryItems() {
  const cats = filterCategories(DATA.categories_by_year);
  const agg = {};
  cats.forEach((c) => {
    const k = c.FEE_TYPE_ID;
    if (!agg[k]) agg[k] = { ...c, amount: 0, lines: 0 };
    agg[k].amount += state.usd ? c.amount_usd : c.amount_lbp;
    agg[k].lines += c.line_count || 0;
  });
  return Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

function renderCategoryCharts() {
  if (state.activePage !== 'categories') return;
  renderGroupBarChart();
}

function renderGroupBarChart() {
  const el = document.getElementById('chart-group-bar');
  if (!el) return;

  const groups = {};
  (DATA.payments_by_year || []).forEach((c) => {
    if (state.year !== 'all' && c.year !== Number(state.year)) return;
    if (state.group !== 'all' && c.category_group !== state.group) return;
    const g = c.category_group || 'Other';
    groups[g] = (groups[g] || 0) + (state.usd ? c.amount_usd : c.amount_lbp);
  });
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const names = entries.map((e) => e[0]);

  if (!names.length) {
    try { Plotly.purge(el); } catch (_) { /* noop */ }
    el.innerHTML = '<p class="chart-empty">No collection data for current filters</p>';
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
    xaxis: { type: 'category', title: 'Category group', tickangle: -12 },
    yaxis: { title: state.usd ? 'USD collected' : 'LBP collected' },
    margin: { t: 20, r: 16, b: 72, l: 56 },
  });

  setTimeout(() => {
    try { Plotly.Plots.resize(el); } catch (_) { /* noop */ }
  }, 80);
}

function renderCategories() {
  const items = getCategoryItems();

  const tbody = document.querySelector('#table-categories tbody');
  tbody.innerHTML = items.slice(0, 50).map((r) => `
    <tr data-fee-id="${r.FEE_TYPE_ID}">
      <td>${r.FEE_TYPE_ID}</td>
      <td>${esc(r.FEE_TYPE_NAME)}</td>
      <td>${badge(r.category_group)}</td>
      <td class="num">${fmtMoney(r.amount, state.usd)}</td>
      <td class="num">${r.lines.toLocaleString()}</td>
      <td><button class="btn-link" type="button" data-action="detail" data-fee-id="${r.FEE_TYPE_ID}">Details →</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">No categories match filters</td></tr>';

  wireDetailButtons(tbody, (btn) => openCategoryDetail(Number(btn.dataset.feeId)));

  renderCategoryCharts();
}

function renderReceivables() {
  const cats = filterCategories(DATA.categories_by_year);
  const agg = {};
  cats.forEach((c) => {
    const k = c.FEE_TYPE_ID;
    if (!agg[k]) agg[k] = { name: (c.FEE_TYPE_SHORTNAME || c.FEE_TYPE_NAME || '').slice(0, 45), val: 0 };
    agg[k].val += state.usd ? c.amount_usd : c.amount_lbp;
  });
  const top = Object.values(agg).sort((a, b) => b.val - a.val).slice(0, 20);
  plotly('chart-recv-bar', [{
    y: top.map((t) => t.name).reverse(), x: top.map((t) => t.val).reverse(),
    type: 'bar', orientation: 'h', marker: { color: BLUE, opacity: 0.85 },
  }], { margin: { l: 180 }, xaxis: { title: state.usd ? 'USD' : 'LBP' } });

  const ys = DATA.yearly_summary.sort((a, b) => a.year - b.year);
  const u = state.usd;
  plotly('chart-gap', [{
    x: ys.map((r) => r.year), y: ys.map((r) => u ? r.gap_usd : r.gap_lbp),
    type: 'bar', marker: { color: ys.map((r) => (r.gap_usd || 0) >= 0 ? '#fca5a5' : '#86efac') },
  }], { yaxis: { title: u ? 'USD gap' : 'LBP gap' } });
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

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

initAuth();
