/*
 * UI wiring: binds the input controls to beregnTotalpris() and renders the
 * result live. All number formatting is Norwegian (kr, space thousands).
 */

const state = { ...window.CALC_DEFAULTS };

const kr = (n) => Math.round(n).toLocaleString('nb-NO') + ' kr';
const pct = (n) => (n * 100).toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' %';

// --- Bind every .control element to a state key -----------------------------
const controls = [...document.querySelectorAll('.control')];

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

  const onInput = (source) => {
    let display = parseFloat(source.value);
    if (Number.isNaN(display)) return;
    display = Math.min(max, Math.max(min, display));
    state[key] = fromDisplay(display);
    // keep both inputs in sync
    range.value = display;
    num.value = display;
    render();
  };

  range.addEventListener('input', () => onInput(range));
  num.addEventListener('input', () => onInput(num));
});

// --- Shared chart styling ---------------------------------------------------
const COLOR = {
  car: '#3b82f6',      // blue — the car price itself
  cost: '#f87171',     // red — drives the price up
  saving: '#34d399',   // teal-green — pulls the price down
  total: '#4ade80',    // accent green — the headline total
  alt: '#64748b',      // grey — the alternative strategy
  bank: '#fbbf24',     // amber — bank balance
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
//  2. COMPARISON — modelled strategy vs. paying equity straight down.
// ===========================================================================
const compareChart = new Chart(document.getElementById('compareChart'), {
  type: 'bar',
  data: {
    labels: ['Med strategi', 'Betal med en gang'],
    datasets: [{
      data: [0, 0],
      backgroundColor: [COLOR.total, COLOR.alt],
      borderRadius: 6,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => kr(c.parsed.y) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: TICKS },
      y: { grid: GRID, ticks: { ...TICKS, callback: moneyTick }, beginAtZero: false },
    },
  },
});

// ===========================================================================
//  3. BALANCE OVER TIME — bank balance and loan balance, month by month.
//  A dashed vertical line marks the end of the interest-free period.
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
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'Banksaldo', data: [], borderColor: COLOR.bank, backgroundColor: 'transparent', tension: 0.15, pointRadius: 0, borderWidth: 2 },
      { label: 'Lånesaldo', data: [], borderColor: COLOR.loan, backgroundColor: 'transparent', tension: 0.15, pointRadius: 0, borderWidth: 2 },
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
        callbacks: {
          title: (items) => `Måned ${items[0].label}`,
          label: (c) => `${c.dataset.label}: ${kr(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { ...TICKS, callback: (v, i, ticks) => (ticks[i].value % 12 === 0 ? ticks[i].value / 12 + ' år' : '') },
      },
      y: { grid: GRID, ticks: { ...TICKS, callback: moneyTick }, beginAtZero: true },
    },
  },
  plugins: [transitionLinePlugin],
});

// --- Render -----------------------------------------------------------------
function render() {
  const r = beregnTotalpris(state);

  document.getElementById('total').textContent = kr(r.totalPrice);

  document.getElementById('r-carPrice').textContent = kr(r.carPrice);
  document.getElementById('r-loanInterest').textContent = '+ ' + kr(r.loanInterest);
  document.getElementById('r-taxDeduction').textContent = '− ' + kr(r.interestTaxDeduction);
  document.getElementById('r-bankGain').textContent = '− ' + kr(r.netBankGain);
  document.getElementById('r-total').textContent = kr(r.totalPrice);

  // Surplus row only shown when equity over-covers the car.
  const excessRow = document.getElementById('row-excess');
  if (r.excessEquity > 0.5) {
    excessRow.hidden = false;
    document.getElementById('r-excess').textContent = '− ' + kr(r.excessEquity);
  } else {
    excessRow.hidden = true;
  }

  document.getElementById('f-monthly').textContent = kr(r.monthlyPayment);
  document.getElementById('f-equityEnd').textContent = kr(r.equityAtPeriodEnd);
  document.getElementById('f-remaining').textContent = kr(r.remainingLoan);
  document.getElementById('f-totalPaid').textContent = kr(r.totalPaidDuringAmortisation);

  updateWaterfall(r);
  updateComparison(r);
  updateBalance();
}

// --- 1. Waterfall: build steps, offsetting each bar by the running total ----
function updateWaterfall(r) {
  // step = { label, amount, sign } where sign -1 pulls the price down, +1 up.
  const steps = [
    { label: 'Bilpris', amount: r.carPrice, sign: 0, color: COLOR.car },
    { label: 'Lånerenter', amount: r.loanInterest, sign: 1, color: COLOR.cost },
    { label: 'Skattefradrag', amount: r.interestTaxDeduction, sign: -1, color: COLOR.saving },
    { label: 'Bankgevinst', amount: r.netBankGain, sign: -1, color: COLOR.saving },
  ];
  if (r.excessEquity > 0.5) {
    steps.push({ label: 'Overskytende EK', amount: r.excessEquity, sign: -1, color: COLOR.saving });
  }

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

// --- 2. Comparison: modelled strategy vs. pay-down-immediately --------------
function updateComparison(r) {
  const alt = beregnAlternativ(state);
  compareChart.data.datasets[0].data = [r.totalPrice, alt.totalPrice];
  compareChart.update();

  const gain = alt.totalPrice - r.totalPrice;
  document.getElementById('c-strategyGain').textContent =
    (gain >= 0 ? '' : '− ') + kr(Math.abs(gain));
}

// --- 3. Balance over time ---------------------------------------------------
function updateBalance() {
  const ts = beregnTidsserie(state);
  balanceChart.data.labels = ts.months;
  balanceChart.data.datasets[0].data = ts.bankBalance;
  balanceChart.data.datasets[1].data = ts.loanBalance;
  balanceChart.options.plugins.transitionLine.month = ts.interestFreeMonths;
  balanceChart.update();
}

render();
