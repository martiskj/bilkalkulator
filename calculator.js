/*
 * Car loan calculator — core financial logic.
 *
 * STRATEGY MODELLED
 * -----------------
 * While the loan is interest-free, the equity is NOT used to pay down the car.
 * Instead it sits in a risk-free bank account earning interest. When the
 * interest-free period ends, the whole equity balance (incl. accrued interest)
 * is injected as a lump sum to reduce the loan. The remaining balance is then
 * repaid as an annuity loan over the remaining years.
 *
 * THE HEADLINE FORMULA (kept deliberately simple and visible):
 *
 *     totalPrice = carPrice
 *                + loanInterest          (interest paid during amortisation)
 *                - interestTaxDeduction   (22% of loanInterest, Norwegian rule)
 *                - netBankGain            (after-tax growth of the equity)
 *
 * Why equity is not its own cost term: the equity is part of the car price you
 * pay anyway, so it nets out. What changes the real cost of owning the car is
 * only (a) the interest you pay, (b) the tax you get back on that interest, and
 * (c) the gain the equity earned while parked in the bank.
 *
 * ASSUMPTIONS
 * -----------
 * - Bank interest is taxed at 22%, modelled as an after-tax effective rate
 *   (bankRate * (1 - taxRate)) compounded monthly.
 * - The 22% interest tax deduction is subtracted directly from the total price.
 *   In kroner this is identical to using the refund for extra repayment; the
 *   only difference is a negligible timing / second-order effect.
 * - All rates are nominal annual rates, compounded monthly.
 */

const DEFAULTS = {
  carPrice: 600000,        // kr
  repaymentYears: 5,       // total years until the loan is paid off
  interestFreeYears: 3,    // years of the loan that are interest-free
  loanRate: 0.06,          // nominal annual interest rate on the car loan
  equity: 200000,          // kr — own capital available up front
  bankRate: 0.04,          // risk-free annual bank rate for parked equity
  taxRate: 0.22,           // Norwegian tax on bank interest AND interest deduction
};

/**
 * Future value of a present amount after `months` of monthly compounding.
 */
function compound(principal, annualRate, months) {
  const monthlyRate = annualRate / 12;
  return principal * Math.pow(1 + monthlyRate, months);
}

/**
 * Monthly payment for an annuity loan.
 * A = L * i / (1 - (1 + i)^(-M))
 */
function annuityPayment(loan, monthlyRate, months) {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return loan / months;
  return (loan * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * Run the full calculation.
 *
 * @param {object} params - any subset of DEFAULTS; missing keys use defaults.
 * @returns {object} a full breakdown of every term in the formula.
 */
function beregnTotalpris(params = {}) {
  const p = { ...DEFAULTS, ...params };

  // Clamp inputs to sane ranges.
  const interestFreeYears = Math.max(0, Math.min(p.interestFreeYears, p.repaymentYears));
  const interestFreeMonths = Math.round(interestFreeYears * 12);
  const amortisationMonths = Math.round((p.repaymentYears - interestFreeYears) * 12);

  // --- Phase 1: equity grows in the bank during the interest-free period ---
  // Bank interest is taxed at 22%, modelled as an after-tax effective rate.
  const netBankRate = p.bankRate * (1 - p.taxRate);
  const equityAtPeriodEnd = compound(p.equity, netBankRate, interestFreeMonths);
  const netBankGain = equityAtPeriodEnd - p.equity;

  // --- Phase 2: lump-sum injection reduces the loan ---
  // Equity (and its gain) is used to pay down the loan when interest kicks in.
  const remainingLoan = Math.max(0, p.carPrice - equityAtPeriodEnd);
  const excessEquity = Math.max(0, equityAtPeriodEnd - p.carPrice); // returned to you

  // --- Phase 3: annuity amortisation of the remaining loan ---
  const monthlyRate = p.loanRate / 12;
  const monthlyPayment = annuityPayment(remainingLoan, monthlyRate, amortisationMonths);
  const totalPaidDuringAmortisation = monthlyPayment * amortisationMonths;
  const loanInterest = Math.max(0, totalPaidDuringAmortisation - remainingLoan);

  // --- Phase 4: Norwegian tax deduction on loan interest (22%) ---
  const interestTaxDeduction = p.taxRate * loanInterest;

  // =====================  THE HEADLINE FORMULA  =====================
  const totalPrice =
      p.carPrice
    + loanInterest
    - interestTaxDeduction
    - netBankGain
    - excessEquity; // if equity over-covers the car, the surplus is yours
  // ==================================================================

  return {
    inputs: { ...p, interestFreeYears, interestFreeMonths, amortisationMonths },
    // Formula terms
    carPrice: p.carPrice,
    loanInterest,
    interestTaxDeduction,
    netBankGain,
    excessEquity,
    totalPrice,
    // Supplementary figures for the UI
    equityAtPeriodEnd,
    remainingLoan,
    monthlyPayment,
    totalPaidDuringAmortisation,
  };
}

/**
 * Alternative strategy: pay the equity straight into the car at purchase,
 * so the loan starts at (carPrice - equity). No money is parked in the bank,
 * hence no bank gain. Same interest-free period and annuity afterwards.
 *
 * Used by the comparison chart to quantify how much the "park in bank" strategy
 * is worth versus the naive "pay it down immediately" approach.
 *
 * @returns {object} the same shape as beregnTotalpris (minus bank-specific fields).
 */
function beregnAlternativ(params = {}) {
  const p = { ...DEFAULTS, ...params };

  const interestFreeYears = Math.max(0, Math.min(p.interestFreeYears, p.repaymentYears));
  const amortisationMonths = Math.round((p.repaymentYears - interestFreeYears) * 12);

  // Equity is spent at purchase; loan starts at the difference.
  const remainingLoan = Math.max(0, p.carPrice - p.equity);
  const excessEquity = Math.max(0, p.equity - p.carPrice); // returned to you

  const monthlyRate = p.loanRate / 12;
  const monthlyPayment = annuityPayment(remainingLoan, monthlyRate, amortisationMonths);
  const totalPaidDuringAmortisation = monthlyPayment * amortisationMonths;
  const loanInterest = Math.max(0, totalPaidDuringAmortisation - remainingLoan);
  const interestTaxDeduction = p.taxRate * loanInterest;

  const totalPrice =
      p.carPrice
    + loanInterest
    - interestTaxDeduction
    - excessEquity;

  return {
    carPrice: p.carPrice,
    loanInterest,
    interestTaxDeduction,
    netBankGain: 0,
    excessEquity,
    totalPrice,
    remainingLoan,
    monthlyPayment,
    totalPaidDuringAmortisation,
  };
}

/**
 * Month-by-month balances for the modelled (park-in-bank) strategy.
 *
 * Phase 1 (interest-free): the loan sits unchanged at carPrice (no payments,
 * no interest) while the equity grows in the bank at the net rate.
 * Transition: at the end of the interest-free period the whole bank balance is
 * injected as a lump sum, reducing the loan; any surplus is returned.
 * Phase 2 (amortisation): the remaining loan is repaid as an annuity; the bank
 * balance stays at 0 (surplus already returned).
 *
 * @returns {object} { months:number[], bankBalance:number[], loanBalance:number[],
 *                     interestFreeMonths:number }
 */
function beregnTidsserie(params = {}) {
  const p = { ...DEFAULTS, ...params };

  const interestFreeYears = Math.max(0, Math.min(p.interestFreeYears, p.repaymentYears));
  const interestFreeMonths = Math.round(interestFreeYears * 12);
  const totalMonths = Math.round(p.repaymentYears * 12);
  const amortisationMonths = totalMonths - interestFreeMonths;

  const netBankRate = p.bankRate * (1 - p.taxRate);
  const monthlyBankRate = netBankRate / 12;
  const monthlyLoanRate = p.loanRate / 12;

  const months = [];
  const bankBalance = [];
  const loanBalance = [];

  // --- Phase 1: equity grows in the bank, loan parked at full car price ---
  let bank = p.equity;
  let loan = p.carPrice;
  for (let m = 0; m <= interestFreeMonths; m++) {
    months.push(m);
    bankBalance.push(bank);
    loanBalance.push(loan);
    bank *= 1 + monthlyBankRate;
  }

  // --- Transition: lump-sum injection at end of interest-free period ---
  const equityAtPeriodEnd = bankBalance[interestFreeMonths];
  loan = Math.max(0, p.carPrice - equityAtPeriodEnd);
  bank = 0; // any surplus is returned to you

  // --- Phase 2: annuity amortisation of the remaining loan ---
  const payment = annuityPayment(loan, monthlyLoanRate, amortisationMonths);
  for (let m = 1; m <= amortisationMonths; m++) {
    loan = loan * (1 + monthlyLoanRate) - payment;
    loan = Math.max(0, loan);
    months.push(interestFreeMonths + m);
    bankBalance.push(0);
    loanBalance.push(loan);
  }

  return { months, bankBalance, loanBalance, interestFreeMonths };
}

// Expose for both browser (global) and Node (tests).
if (typeof window !== 'undefined') {
  window.beregnTotalpris = beregnTotalpris;
  window.beregnAlternativ = beregnAlternativ;
  window.beregnTidsserie = beregnTidsserie;
  window.CALC_DEFAULTS = DEFAULTS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { beregnTotalpris, beregnAlternativ, beregnTidsserie, DEFAULTS };
}
