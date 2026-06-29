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
let paymentsLoading = false;

const state = {
  dateFrom: '',
  dateTo: '',
  year: 'all',
  group: 'all',
  search: '',
  usd: true,
  page: 1,
  pageSize: 50,
  activePage: 'overview',
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

async function loadData() {
  const res = await fetch('data/kehale.json');
  DATA = await res.json();
  document.getElementById('meta-subtitle').textContent =
    `${DATA.meta.municipality} · ${DATA.meta.receipt_count?.toLocaleString()} receipts`;
  initFilters();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  renderAll();
  resizeVisibleCharts();
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
  ['chart-yearly', 'chart-collection', 'chart-daily', 'chart-treemap', 'chart-group-bar', 'chart-recv-bar', 'chart-gap', 'chart-rates'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) {
      try { Plotly.Plots.resize(el); } catch (_) { /* not rendered yet */ }
    }
  });
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
      renderAll();
      if (page === 'categories') {
        setTimeout(() => {
          const cats = filterCategories(DATA.categories_by_year);
          const agg = {};
          cats.forEach((c) => {
            const k = c.FEE_TYPE_ID;
            if (!agg[k]) agg[k] = { ...c, amount: 0, lines: 0 };
            agg[k].amount += state.usd ? c.amount_usd : c.amount_lbp;
            agg[k].lines += c.line_count || 0;
          });
          const items = Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
          renderCategoryMap(items);
        }, 120);
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

function filterCategories(rows) {
  let r = rows;
  if (state.year !== 'all') r = r.filter((x) => x.year === Number(state.year));
  if (state.group !== 'all') r = r.filter((x) => x.category_group === state.group);
  return r;
}

function updateFilterSummary(count, total) {
  const el = document.getElementById('filter-summary');
  const parts = [];
  if (state.dateFrom || state.dateTo) parts.push(`<strong>${state.dateFrom || '…'}</strong> → <strong>${state.dateTo || '…'}</strong>`);
  if (state.year !== 'all') parts.push(`year <strong>${state.year}</strong>`);
  if (state.group !== 'all') parts.push(`group <strong>${esc(state.group)}</strong>`);
  if (state.search) parts.push(`search "<strong>${esc(state.search)}</strong>"`);
  const filt = count != null ? ` · showing <strong>${count.toLocaleString()}</strong> of ${total.toLocaleString()} payments` : '';
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
  Plotly.react(id, traces, { ...PLOT, ...layout }, { responsive: true, displayModeBar: false });
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
  const rates = ys.map((r) => Number(r.collection_rate) || 0);
  const ymax = Math.max(110, Math.ceil(Math.max(...rates, 100) / 10) * 10 + 10);
  const colors = rates.map((r) => (r >= 100 ? '#0d9f6e' : r >= 90 ? '#d97706' : '#dc2626'));

  plotly('chart-collection', [{
    x: ys.map((r) => String(r.year)),
    y: rates,
    type: 'bar',
    text: rates.map((r) => r.toFixed(1) + '%'),
    textposition: 'outside',
    textfont: { size: 11, color: '#1a2b4a' },
    marker: { color: colors, line: { width: 0 } },
    hovertemplate: '<b>%{x}</b><br>Collected: %{y:.1f}%<br><i>payments ÷ receivables</i><extra></extra>',
  }], {
    yaxis: {
      title: '% collected',
      range: [0, ymax],
      ticksuffix: '%',
      gridcolor: '#e8efff',
    },
    shapes: [{
      type: 'line',
      x0: -0.5,
      x1: ys.length - 0.5,
      y0: 100,
      y1: 100,
      xref: 'x',
      yref: 'y',
      line: { color: '#94a3b8', width: 2, dash: 'dash' },
    }],
    annotations: [{
      x: ys.length - 1,
      y: 100,
      text: '100% = fully collected',
      showarrow: false,
      yshift: 14,
      font: { size: 10, color: '#5c6f8a' },
    }],
    margin: { t: 30, r: 16, b: 48, l: 56 },
  });
}

function renderDailyChart() {
  if (!PAYMENTS) {
    plotly('chart-daily', [], {});
    return;
  }
  const list = filterPaymentsList(PAYMENTS);
  const byDay = {};
  const u = state.usd;
  list.forEach((p) => {
    if (!p.date) return;
    byDay[p.date] = (byDay[p.date] || 0) + (u ? p.amount_usd : p.amount_lbp);
  });
  const days = Object.keys(byDay).sort();
  plotly('chart-daily', [{
    x: days, y: days.map((d) => byDay[d]),
    type: 'bar', marker: { color: BLUE, opacity: 0.85 },
  }], { xaxis: { title: 'Date' }, yaxis: { title: u ? 'USD' : 'LBP' } });
}

function badge(g) {
  const cls = { 'Annual Fees': 'g1', 'Licenses & Permits': 'g2', 'Miscellaneous Revenue': 'g3', 'Taxes & Surcharges': 'g4' }[g] || 'g1';
  return `<span class="badge ${cls}">${esc(g)}</span>`;
}

function renderTracker() {
  const filtered = filterPaymentsList(PAYMENTS);
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
      <td><button class="btn-link" type="button">Details →</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No payments match filters</td></tr>';

  tbody.querySelectorAll('tr[data-idx]').forEach((tr) => {
    tr.addEventListener('click', () => openPaymentDetail(filtered[Number(tr.dataset.idx)]));
  });

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

function openPaymentDetail(p) {
  if (!p) return;
  const u = state.usd;
  const credits = (p.lines || []).filter((l) => l.account_type === 'CREDIT');
  const debits = (p.lines || []).filter((l) => l.account_type === 'DEBIT');
  const totalDebit = debits.reduce((s, l) => s + (u ? l.amount_usd : l.amount_lbp), 0);

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

  document.getElementById('drawer-backdrop').classList.remove('hidden');
  document.getElementById('drawer').classList.remove('hidden');
}

function closeDrawer() {
  document.getElementById('drawer-backdrop').classList.add('hidden');
  document.getElementById('drawer').classList.add('hidden');
}

function buildCategoryMapTrace(items) {
  const labels = [];
  const parents = [];
  const values = [];
  const ids = [];
  const colors = [];

  const groups = [...new Set(items.map((i) => i.category_group || 'Other'))];
  const groupTotals = {};
  items.forEach((i) => {
    const g = i.category_group || 'Other';
    groupTotals[g] = (groupTotals[g] || 0) + i.amount;
  });

  groups.forEach((g) => {
    const gid = `grp-${g.replace(/[^a-z0-9]/gi, '-')}`;
    labels.push(g);
    parents.push('');
    values.push(0);
    ids.push(gid);
    colors.push(GROUP_COLORS[g] || GROUP_COLORS.Other);
  });

  items.slice(0, 80).forEach((i) => {
    const g = i.category_group || 'Other';
    const gid = `grp-${g.replace(/[^a-z0-9]/gi, '-')}`;
    const name = (i.FEE_TYPE_SHORTNAME || i.FEE_TYPE_NAME || `Fee ${i.FEE_TYPE_ID}`).slice(0, 40);
    labels.push(name);
    parents.push(gid);
    values.push(i.amount);
    ids.push(`fee-${i.FEE_TYPE_ID}`);
    colors.push(GROUP_COLORS[g] || GROUP_COLORS.Other);
  });

  return {
    type: 'sunburst',
    ids,
    labels,
    parents,
    values,
    branchvalues: 'total',
    marker: { colors, line: { width: 1, color: '#fff' } },
    textfont: { size: 11 },
    insidetextorientation: 'horizontal',
    hovertemplate: '<b>%{label}</b><br>%{value:,.0f}<br>%{percentRoot:.1%} of total<extra></extra>',
  };
}

function renderCategoryMap(items) {
  const el = document.getElementById('chart-treemap');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<p class="chart-empty">No category data for current filters</p>';
    return;
  }

  if (state.activePage !== 'categories') return;

  el.innerHTML = '';
  const MAP_HEIGHT = 460;
  Plotly.react('chart-treemap', [buildCategoryMapTrace(items)], {
    ...PLOT,
    margin: { t: 10, b: 10, l: 10, r: 10 },
    height: MAP_HEIGHT,
    sunburstcolorway: Object.values(GROUP_COLORS),
  }, { responsive: true, displayModeBar: false });

  requestAnimationFrame(() => {
    try { Plotly.Plots.resize('chart-treemap'); } catch (_) { /* noop */ }
  });
}

function renderCategories() {
  const cats = filterCategories(DATA.categories_by_year);
  const agg = {};
  cats.forEach((c) => {
    const k = c.FEE_TYPE_ID;
    if (!agg[k]) agg[k] = { ...c, amount: 0, lines: 0 };
    agg[k].amount += state.usd ? c.amount_usd : c.amount_lbp;
    agg[k].lines += c.line_count || 0;
  });
  const items = Object.values(agg).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);

  renderCategoryMap(items);

  document.querySelector('#table-categories tbody').innerHTML = items.slice(0, 50).map((r) => `
    <tr><td>${r.FEE_TYPE_ID}</td><td>${esc(r.FEE_TYPE_NAME)}</td><td>${badge(r.category_group)}</td>
    <td class="num">${fmtMoney(r.amount, state.usd)}</td><td class="num">${r.lines.toLocaleString()}</td></tr>`).join('');

  const groups = {};
  (DATA.payments_by_year || []).forEach((c) => {
    if (state.year !== 'all' && c.year !== Number(state.year)) return;
    if (state.group !== 'all' && c.category_group !== state.group) return;
    const g = c.category_group || 'Other';
    groups[g] = (groups[g] || 0) + (state.usd ? c.amount_usd : c.amount_lbp);
  });
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  plotly('chart-group-bar', [{
    x: entries.map((e) => e[0]), y: entries.map((e) => e[1]), type: 'bar',
    marker: { color: entries.map((e) => GROUP_COLORS[e[0]] || GROUP_COLORS.Other) },
  }], { yaxis: { title: state.usd ? 'USD' : 'LBP' } });
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
