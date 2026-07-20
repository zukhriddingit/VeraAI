export type BillingPeriod = "month" | "week" | "day" | "year" | "unknown";

export interface MoneyObservation {
  readonly cents: number;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
}

export interface NormalizedHousingCosts {
  readonly baseRentCents: number | null;
  readonly requiredRecurringFeeCents: number | null;
  readonly knownMonthlyTotalCents: number | null;
  readonly currency: string | null;
  readonly billingPeriod: BillingPeriod;
  readonly status: "complete" | "partial" | "unknown";
}

interface NormalizeHousingCostsInput {
  readonly baseRent: MoneyObservation | null;
  readonly requiredRecurringFees: readonly MoneyObservation[];
  readonly requiredRecurringFeesKnown: boolean;
}

export function parseUsdMajorUnitsToCents(input: string): number | null {
  const normalized = input
    .normalize("NFKC")
    .trim()
    .replace(/^\$/u, "")
    .replace(/\s*USD$/iu, "")
    .replace(/,/gu, "")
    .trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

function validObservation(observation: MoneyObservation): boolean {
  return (
    Number.isSafeInteger(observation.cents) &&
    observation.cents >= 0 &&
    /^[A-Z]{3}$/u.test(observation.currency)
  );
}

export function normalizeHousingCosts(input: NormalizeHousingCostsInput): NormalizedHousingCosts {
  const base = input.baseRent;
  if (base === null || !validObservation(base)) {
    return {
      baseRentCents: null,
      requiredRecurringFeeCents: null,
      knownMonthlyTotalCents: null,
      currency: null,
      billingPeriod: "unknown",
      status: "unknown"
    };
  }

  const compatibleFees = input.requiredRecurringFees.every(
    (fee) =>
      validObservation(fee) &&
      fee.currency === base.currency &&
      fee.billingPeriod === base.billingPeriod
  );
  const feesKnown = input.requiredRecurringFeesKnown && compatibleFees;
  const requiredRecurringFeeCents = feesKnown
    ? input.requiredRecurringFees.reduce((sum, fee) => sum + fee.cents, 0)
    : null;
  const isMonthlyUsd = base.currency === "USD" && base.billingPeriod === "month";
  const knownMonthlyTotalCents =
    isMonthlyUsd && requiredRecurringFeeCents !== null
      ? base.cents + requiredRecurringFeeCents
      : null;
  const complete =
    feesKnown &&
    isMonthlyUsd &&
    Number.isSafeInteger(requiredRecurringFeeCents) &&
    Number.isSafeInteger(knownMonthlyTotalCents);

  return {
    baseRentCents: base.cents,
    requiredRecurringFeeCents,
    knownMonthlyTotalCents: complete ? knownMonthlyTotalCents : null,
    currency: base.currency,
    billingPeriod: base.billingPeriod,
    status: complete ? "complete" : "partial"
  };
}
