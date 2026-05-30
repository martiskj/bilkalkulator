/*
 * UI wiring: binds the input controls to beregnTotalpris() and renders the
 * result live. All number formatting is Norwegian (kr, space thousands).
 */

const state = { ...window.CALC_DEFAULTS };

const kr = (n) => Math.round(n).toLocaleString('nb-NO') + ' kr';
const pct = (n) => (n * 100).toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' %';

// --- Bind every .control element to a state key -----------------------------
const controls = [...document.querySelectorAll('.control')];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

controls.forEach((ctrl) => {
  const key = ctrl.dataset.key;
  const isPct = ctrl.hasAttribute('data-pct');
  const min = parseFloat(ctrl.dataset.min);
  const max = parseFloat(ctrl.dataset.max);
  const step = parseFloat(ctrl.dataset.step);
  const range = ctrl.querySelector('input[type="range"]');
  const num = ctrl.querySelector('input[type="number"]');

  // Percentages are stored as fractions (0.06) but shown as 6.
  const toDisplay = (v) => (isPct ? v * 100 : v);
  const fromDisplay = (v) => (isPct ? v / 100 : v);

  [range, num].forEach((el) => {
    el.min = min; el.max = max; el.step = step;
  });

  const initial = toDisplay(state[key]);
  range.value = initial;
  num.value = initial;

  // Range: always within bounds — immediately sync num and re-render.
  range.addEventListener('input', () => {
    const display = parseFloat(range.value);
    num.value = display;
    state[key] = fromDisplay(display);
    render();
  });

  // Number (live): only update state + range when the value is already valid.
  // This lets the user type freely without the field being overwritten mid-entry.
  num.addEventListener('input', () => {
    const display = parseFloat(num.value);
    if (Number.isNaN(display) || display < min || display > max) return;
    state[key] = fromDisplay(display);
    range.value = display;
    render();
  });

  // Number (blur): clamp + snap the field to the nearest valid value.
  num.addEventListener('blur', () => {
    const display = parseFloat(num.value);
    const clamped = Number.isNaN(display) ? toDisplay(state[key]) : clamp(display, min, max);
    num.value = clamped;
    state[key] = fromDisplay(clamped);
    range.value = clamped;
    render();
  });
});

// --- Shared chart styling ---------------------------------------------------
const COLOR = {
  car: '#3b82f6',      // blue — the car price itself
  cost: '#f87171',     // red — drives the price up
  saving: '#34d399',   // teal-green — pulls the price down
  total: '#4ade80',    // accent green — the headline total
  bank: '#fbbf24',     // amber — accrued interest on the equity
  loan: '#f87171',     // red — loan balance
  grid: '#2d3a4d',
  tick: '#8b98a9',
};
const GRID = { color: COLOR.grid };
const TICKS = { color: COLOR.tick };
const moneyTick = (v) => (v / 1000).toLocaleString('nb-NO') + 'k';

// ===========================================================================
//  1. WATERFALL — how the headline formula builds up the total price.
//  Implemented as a stacked bar: a transparent "base" dataset offsets each bar
//  to where the running total sits, and a coloured "value" dataset draws the
//  step itself. Greens pull the price down, red pushes it up.
// ===========================================================================
const waterfallChart = new Chart(document.getElementById('waterfallChart'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      { label: 'base', data: [], backgroundColor: 'transparent', stack: 'wf' },
      { label: 'verdi', data: [], backgroundColor: [], stack: 'wf', borderRadius: 4 },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (c) => c.datasetIndex === 1,
        callbacks: {
          label: (c) => {
            const sign = c.dataset.signs[c.dataIndex];
            return (sign < 0 ? '− ' : sign > 0 ? '+ ' : '') + kr(c.dataset.amounts[c.dataIndex]);
          },
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: TICKS },
      y: { stacked: true, grid: GRID, ticks: { ...TICKS, callback: moneyTick }, beginAtZero: true },
    },
  },
});

// ===========================================================================
//  2. BALANCE OVER TIME — equity build-up (stacked bars) and loan (line).
//  Stacked bars split the bank balance into the original deposit and the
//  interest accrued on top; the loan balance is drawn as a line. A dashed
//  vertical line marks the lump-sum injection at the interest-free period end.
// ===========================================================================
const transitionLinePlugin = {
  id: 'transitionLine',
  afterDraw(chart) {
    const month = chart.options.plugins.transitionLine?.month;
    if (!month) return;
    const x = chart.scales.x.getPixelForValue(month);
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = '#8b98a9';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#8b98a9';
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Innskudd', x, top + 12);
    ctx.restore();
  },
};

const balanceChart = new Chart(document.getElementById('balanceChart'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      { type: 'bar', label: 'Egenkapital (innskudd)', data: [], backgroundColor: COLOR.car, stack: 'eq', categoryPercentage: 1.0, barPercentage: 1.0 },
      { type: 'bar', label: 'Opptjente renter', data: [], backgroundColor: COLOR.bank, stack: 'eq', categoryPercentage: 1.0, barPercentage: 1.0 },
      { type: 'line', label: 'Lånesaldo', data: [], borderColor: COLOR.loan, backgroundColor: 'transparent', tension: 0.15, pointRadius: 0, borderWidth: 2 },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: '#e6edf3', padding: 16 } },
      transitionLine: { month: 0 },
      tooltip: {
        filter: (c) => c.parsed.y > 0.5 || c.dataset.type === 'line',
        callbacks: {
          title: (items) => `Måned ${items[0].label}`,
          label: (c) => `${c.dataset.label}: ${kr(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { ...TICKS, callback: (v, i, ticks) => (ticks[i].value % 12 === 0 ? ticks[i].value / 12 + ' år' : '') },
      },
      y: { stacked: true, grid: GRID, ticks: { ...TICKS, callback: moneyTick }, beginAtZero: true },
    },
  },
  plugins: [transitionLinePlugin],
});

// --- Animated total price ---------------------------------------------------
let _animFrom = null;
let _animRaf = null;
const ANIM_MS = 900;

function animateTotal(to) {
  if (_animRaf) cancelAnimationFrame(_animRaf);
  const el = document.getElementById('total');
  const from = _animFrom ?? to;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / ANIM_MS, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = kr(from + (to - from) * eased);
    if (t < 1) { _animRaf = requestAnimationFrame(step); }
    else { _animFrom = to; _animRaf = null; }
  }
  _animRaf = requestAnimationFrame(step);
}

// --- Insight sentences ------------------------------------------------------
function renderInsight(r) {
  const extra = r.totalPrice - r.carPrice;
  const netLoanCost = r.loanInterest + r.totalFees - r.interestTaxDeduction;
  const parts = [];

  if (extra > 0.5) {
    parts.push(`Du betaler ${kr(extra)} mer enn listepris.`);
  } else if (extra < -0.5) {
    parts.push(`Du betaler ${kr(-extra)} <em>mindre</em> enn listepris.`);
  }

  if (netLoanCost > 0.5) {
    parts.push(`Nettokostnad for lånet er ${kr(netLoanCost)} (renter og gebyrer etter skattefradrag).`);
  }

  document.getElementById('insight').innerHTML = parts.join(' ');
}

// --- Render -----------------------------------------------------------------
function render() {
  const r = beregnTotalpris(state);

  animateTotal(r.totalPrice);
  renderInsight(r);

  document.getElementById('r-carPrice').textContent = kr(r.carPrice);
  document.getElementById('r-loanInterest').textContent = '+ ' + kr(r.loanInterest);
  document.getElementById('r-fees').textContent = '+ ' + kr(r.totalFees);
  document.getElementById('r-taxDeduction').textContent = '− ' + kr(r.interestTaxDeduction);
  document.getElementById('r-bankGain').textContent = '− ' + kr(r.netBankGain);

  // Terminbeløp: show phase 1 always; phase 2 only when there is a distinct
  // interest-bearing period with remaining loan after the lump-sum injection.
  const hasPhase1 = r.inputs.interestFreeMonths > 0;
  const hasPhase2 = r.inputs.amortisationMonths > 0 && r.remainingLoan > 0.5;

  const fig1 = document.getElementById('fig-monthly1');
  const fig2 = document.getElementById('fig-monthly2');

  if (hasPhase1 && hasPhase2) {
    document.getElementById('k-monthly1').textContent = 'Terminbeløp nå';
    document.getElementById('f-monthly1').textContent = kr(r.monthlyPayment);
    document.getElementById('k-monthly2').textContent =
      `Terminbeløp fra år ${r.inputs.interestFreeYears + 1}`;
    document.getElementById('f-monthly2').textContent = kr(r.postInjectionPayment);
    fig1.hidden = false;
    fig2.hidden = false;
  } else {
    const payment = hasPhase2 ? r.postInjectionPayment : r.monthlyPayment;
    document.getElementById('k-monthly1').textContent = 'Terminbeløp';
    document.getElementById('f-monthly1').textContent = kr(payment);
    fig1.hidden = false;
    fig2.hidden = true;
  }

  updateWaterfall(r);
  updateBalance();
}

// --- 1. Waterfall: build steps, offsetting each bar by the running total ----
function updateWaterfall(r) {
  // step = { label, amount, sign } where sign -1 pulls the price down, +1 up.
  const steps = [
    { label: 'Bilpris', amount: r.carPrice, sign: 0, color: COLOR.car },
    { label: 'Lånerenter', amount: r.loanInterest, sign: 1, color: COLOR.cost },
    { label: 'Gebyrer', amount: r.totalFees, sign: 1, color: COLOR.cost },
    { label: 'Skattefradrag', amount: r.interestTaxDeduction, sign: -1, color: COLOR.saving },
    { label: 'Bankgevinst', amount: r.netBankGain, sign: -1, color: COLOR.saving },
  ];

  const labels = [];
  const base = [];
  const value = [];
  const colors = [];
  const amounts = [];
  const signs = [];

  let running = 0;
  for (const s of steps) {
    const delta = s.sign < 0 ? -s.amount : s.amount; // sign 0 treated as +
    // For a downward step the visible bar sits below the running total.
    base.push(delta < 0 ? running + delta : running);
    value.push(s.amount);
    labels.push(s.label);
    colors.push(s.color);
    amounts.push(s.amount);
    signs.push(s.sign);
    running += delta;
  }
  // Final resting bar: the total, anchored at zero.
  labels.push('Totalpris');
  base.push(0);
  value.push(running);
  colors.push(COLOR.total);
  amounts.push(running);
  signs.push(0);

  waterfallChart.data.labels = labels;
  waterfallChart.data.datasets[0].data = base;
  const v = waterfallChart.data.datasets[1];
  v.data = value;
  v.backgroundColor = colors;
  v.amounts = amounts;
  v.signs = signs;
  waterfallChart.update();
}

// --- 2. Balance over time: equity build-up (bars) + loan (line) -------------
function updateBalance() {
  const ts = beregnTidsserie(state);
  balanceChart.data.labels = ts.months;
  balanceChart.data.datasets[0].data = ts.equityPrincipal;
  balanceChart.data.datasets[1].data = ts.equityInterest;
  balanceChart.data.datasets[2].data = ts.loanBalance;
  balanceChart.options.plugins.transitionLine.month = ts.interestFreeMonths;
  balanceChart.update();
}

render();
