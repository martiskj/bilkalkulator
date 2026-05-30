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

// --- Cost-distribution doughnut chart ---------------------------------------
// Shows GROSS outlay (what leaves your account): car price + loan interest.
// The centre label shows the NET total price; savings are listed below the chart.
const COLORS = {
  carPrice: '#3b82f6',   // blue — the car itself
  loanInterest: '#f87171', // red — a cost
};

// Plugin: render the net total price in the centre of the doughnut.
const centerTextPlugin = {
  id: 'centerText',
  beforeDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    const total = chart.options.plugins.centerText.total ?? 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8b98a9';
    ctx.font = '13px -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Totalpris', cx, cy - 14);
    ctx.fillStyle = '#4ade80';
    ctx.font = '700 22px -apple-system, Segoe UI, sans-serif';
    ctx.fillText(kr(total), cx, cy + 8);
    ctx.restore();
  },
};

const chart = new Chart(document.getElementById('costChart'), {
  type: 'doughnut',
  data: {
    labels: ['Bilpris', 'Lånerenter'],
    datasets: [{
      data: [0, 0],
      backgroundColor: [COLORS.carPrice, COLORS.loanInterest],
      borderColor: '#1a2230',
      borderWidth: 2,
    }],
  },
  options: {
    responsive: true,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#e6edf3', padding: 16 } },
      centerText: { total: 0 },
      tooltip: {
        callbacks: { label: (c) => `${c.label}: ${kr(c.parsed)}` },
      },
    },
  },
  plugins: [centerTextPlugin],
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

  // Update the cost-distribution chart.
  const savings = r.interestTaxDeduction + r.netBankGain + r.excessEquity;
  chart.data.datasets[0].data = [r.carPrice, r.loanInterest];
  chart.options.plugins.centerText.total = r.totalPrice;
  chart.update();
  document.getElementById('c-savings').textContent = '− ' + kr(savings);
}

render();
