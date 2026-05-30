/*
 * Car loan calculator — core financial logic.
 *
 * STRATEGY MODELLED
 * -----------------
 * The loan is interest-free for the first years, but NOT instalment-free: you
 * still pay a monthly instalment, so during the interest-free period the whole
 * instalment goes to principal (no interest accrues). At 0% that instalment is
 * the loan amortised linearly over the full term (= car price / total months) —
 * this matches how real campaign-rate car loans behave. When the product rate
 * kicks in, the remaining balance is re-amortised as an annuity over the rest
 * of the term.
 *
 * Meanwhile the equity is NOT used as a down payment. It sits in a risk-free
 * bank account earning interest, and when the interest-free period ends the
 * whole balance (incl. accrued interest) is injected as a lump sum against the
 * loan. Any remaining balance is then repaid as an annuity over the rest of the
 * term. If the equity over-covers the (already amortised) loan, the surplus is
 * simply returned to you.
 *
 * THE HEADLINE FORMULA (kept deliberately simple and visible):
 *
 *     totalPrice = carPrice
 *                + loanInterest          (interest paid during amortisation)
 *                - interestTaxDeduction   (22% of loanInterest, Norwegian rule)
 *                - netBankGain            (after-tax growth of the equity)
 *
 * Why equity is not its own cost term: the equity (and any surplus returned to
 * you) is part of the car price you pay anyway, so it nets out. The surplus is
 * therefore NOT a separate formula term — subtracting both it and netBankGain
 * would double-count the bank gain, since the gain is already inside the
 * returned surplus. What changes the real cost of owning the car is only (a) the
 * interest you pay, (b) the tax you get back on it, and (c) the gain the equity
 * earned while parked in the bank. (Note: surplus > 0 only when the loan is
 * fully covered, in which case loanInterest is 0 — the terms never overlap.)
 *
 * ASSUMPTIONS
 * -----------
 * - Bank interest is taxed at 22%, modelled as an after-tax effective rate
 *   (bankRate * (1 - taxRate)) compounded monthly.
 * - The 22% interest tax deduction is subtracted directly from the total price.
 *   In kroner this is identical to using the refund for extra repayment; the
 *   only difference is a negligible timing / second-order effect.
 * - All rates are nominal annual rates, compounded monthly.
 * - Fees: a one-time establishment fee is financed into the loan (so it is
 *   amortised and bears interest), and a flat term fee is charged on every
 *   monthly instalment while the loan is active. Fees are NOT tax-deductible —
 *   only interest gets the 22% deduction.
 */

const DEFAULTS = {
  carPrice: 600000,        // kr
  repaymentYears: 5,       // total years until the loan is paid off
  interestFreeYears: 3,    // years of the loan that are interest-free
  loanRate: 0.06,          // nominal annual interest rate on the car loan
  equity: 200000,          // kr — own capital available up front
  bankRate: 0.04,          // risk-free annual bank rate for parked equity
  taxRate: 0.22,           // Norwegian tax on bank interest AND interest deduction
  establishmentFee: 1959,  // kr — one-time set-up fee, financed into the loan
  termFee: 95,             // kr — fee charged on every monthly instalment
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
  const totalMonths = Math.round(p.repaymentYears * 12);
  const amortisationMonths = totalMonths - interestFreeMonths;
  const monthlyRate = p.loanRate / 12;

  // The establishment fee is financed into the loan (so it is amortised and
  // bears interest just like the real product).
  const financedAmount = p.carPrice + p.establishmentFee;

  // --- Phase 1: interest-free instalments pay down principal; equity grows ---
  // At 0% the instalment is the loan amortised linearly over the FULL term
  // (an annuity at 0% = principal / total months), matching how real
  // campaign-rate car loans behave. The whole instalment is principal.
  const principalInstalment = totalMonths > 0 ? financedAmount / totalMonths : 0;
  const principalPaidInterestFree = Math.min(financedAmount, principalInstalment * interestFreeMonths);
  const balanceBeforeInjection = financedAmount - principalPaidInterestFree;

  const netBankRate = p.bankRate * (1 - p.taxRate);
  const equityAtPeriodEnd = compound(p.equity, netBankRate, interestFreeMonths);
  const netBankGain = equityAtPeriodEnd - p.equity;

  // --- Transition: lump-sum injection of the equity against the loan ---
  const remainingLoan = Math.max(0, balanceBeforeInjection - equityAtPeriodEnd);
  const excessEquity = Math.max(0, equityAtPeriodEnd - balanceBeforeInjection); // returned to you

  // --- Phase 2: annuity amortisation of whatever loan remains (with interest) ---
  const principalInstalment2 = annuityPayment(remainingLoan, monthlyRate, amortisationMonths);
  const totalPaidDuringAmortisation = principalInstalment2 * amortisationMonths;
  const loanInterest = Math.max(0, totalPaidDuringAmortisation - remainingLoan);

  // --- Fees: a per-instalment term fee is charged for every month the loan is
  // active. If the equity clears the loan at injection, phase 2 has no
  // instalments and thus no further term fees. ---
  const payingMonths = interestFreeMonths + (remainingLoan > 0.5 ? amortisationMonths : 0);
  const termFeesTotal = p.termFee * payingMonths;
  const totalFees = p.establishmentFee + termFeesTotal;

  // Displayed instalments include the term fee (matches a real loan's "kostnad").
  const monthlyPayment = principalInstalment + p.termFee;
  const postInjectionPayment = remainingLoan > 0.5 ? principalInstalment2 + p.termFee : 0;

  // --- Norwegian tax deduction on loan interest (22%) — fees are NOT deductible ---
  const interestTaxDeduction = p.taxRate * loanInterest;

  // =====================  THE HEADLINE FORMULA  =====================
  // No excessEquity term: see the file header — it would double-count the
  // bank gain, and surplus > 0 only when loanInterest is 0 anyway.
  const totalPrice =
      p.carPrice
    + loanInterest
    + totalFees
    - interestTaxDeduction
    - netBankGain;
  // ==================================================================

  return {
    inputs: { ...p, interestFreeYears, interestFreeMonths, amortisationMonths },
    // Formula terms
    carPrice: p.carPrice,
    loanInterest,
    totalFees,
    interestTaxDeduction,
    netBankGain,
    totalPrice,
    // Supplementary figures for the UI
    establishmentFee: p.establishmentFee,
    termFeesTotal,
    excessEquity,                 // cash returned to you (informational, not a formula term)
    equityAtPeriodEnd,
    balanceBeforeInjection,
    remainingLoan,
    monthlyPayment,               // instalment during the interest-free period (incl. term fee)
    postInjectionPayment,         // instalment after the lump sum (incl. term fee; 0 if loan cleared)
    totalPaidOnLoan: principalPaidInterestFree + totalPaidDuringAmortisation + termFeesTotal,
  };
}

/**
 * Month-by-month balances for the modelled (park-in-bank) strategy.
 *
 * Phase 1 (interest-free): the loan sits unchanged at carPrice (no payments,
 * no interest) while the equity grows in the bank at the net rate. The bank
 * balance is split into the original deposit (constant) and the interest
 * accrued on top of it (growing).
 * Transition: at the end of the interest-free period the whole bank balance is
 * injected as a lump sum, reducing the loan; any surplus is returned.
 * Phase 2 (amortisation): the remaining loan is repaid as an annuity; the bank
 * balance stays at 0 (surplus already returned).
 *
 * @returns {object} { months:number[], equityPrincipal:number[],
 *                     equityInterest:number[], loanBalance:number[],
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

  // The establishment fee is financed into the loan.
  const financedAmount = p.carPrice + p.establishmentFee;

  // Interest-free instalment: loan amortised linearly over the full term
  // (annuity at 0% = principal / total months).
  const payment = totalMonths > 0 ? financedAmount / totalMonths : 0;

  const months = [];
  const equityPrincipal = []; // original deposit — constant during phase 1
  const equityInterest = [];  // interest accrued on top of the deposit
  const loanBalance = [];

  // --- Phase 1: instalments pay down principal (0% interest); equity grows ---
  let bank = p.equity;
  let loan = financedAmount;
  for (let m = 0; m <= interestFreeMonths; m++) {
    months.push(m);
    equityPrincipal.push(p.equity);
    equityInterest.push(bank - p.equity);
    loanBalance.push(loan);
    bank *= 1 + monthlyBankRate;
    loan = Math.max(0, loan - payment); // interest-free → whole instalment is principal
  }

  // --- Transition: lump-sum injection at end of interest-free period ---
  const equityAtPeriodEnd = equityPrincipal[interestFreeMonths] + equityInterest[interestFreeMonths];
  loan = Math.max(0, loanBalance[interestFreeMonths] - equityAtPeriodEnd);

  // --- Phase 2: annuity amortisation; equity is spent, so its bars are 0 ---
  const postInjectionPayment = annuityPayment(loan, monthlyLoanRate, amortisationMonths);
  for (let m = 1; m <= amortisationMonths; m++) {
    loan = loan * (1 + monthlyLoanRate) - postInjectionPayment;
    loan = Math.max(0, loan);
    months.push(interestFreeMonths + m);
    equityPrincipal.push(0);
    equityInterest.push(0);
    loanBalance.push(loan);
  }

  return { months, equityPrincipal, equityInterest, loanBalance, interestFreeMonths };
}

// Expose for both browser (global) and Node (tests).
if (typeof window !== 'undefined') {
  window.beregnTotalpris = beregnTotalpris;
  window.beregnTidsserie = beregnTidsserie;
  window.CALC_DEFAULTS = DEFAULTS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { beregnTotalpris, beregnTidsserie, DEFAULTS };
}
