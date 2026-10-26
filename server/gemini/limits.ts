/**
 * Per-instance request budget (FR-20 spend control). Serverless platforms run several short-lived
 * instances, so this is a backstop, not a global limit: the provider-side project quota/budget alerts
 * must also be set before live use (docs/gemini-integration.md). Rejections are final; nothing retries.
 */
export type BudgetRejection = 'RATE_LIMITED' | 'BUDGET_EXHAUSTED';

export class InstanceBudget {
  private readonly windows = new Map<string, number[]>();
  private total = 0;
  constructor(private readonly maxTotal: number, private readonly now: () => number = () => Date.now()) {}

  /** Reserves one provider call for `bucket`, allowing at most `perHour` in a sliding hour. */
  reserve(bucket: string, perHour: number): BudgetRejection | null {
    if (this.total >= this.maxTotal) return 'BUDGET_EXHAUSTED';
    const now = this.now();
    const recent = (this.windows.get(bucket) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour) { this.windows.set(bucket, recent); return 'RATE_LIMITED'; }
    recent.push(now);
    this.windows.set(bucket, recent);
    this.total++;
    return null;
  }
}
