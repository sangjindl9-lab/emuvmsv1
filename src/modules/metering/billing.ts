/**
 * 전기요금 추정 및 에너지 분석.
 * 요금표는 tariff_versions.config(JSON)로 버전 관리된다.
 * 실제 고지서와 일치함을 보장하지 않으며, 계약종별·부가항목을 관리자가 설정해야 한다.
 * 탄소배출량은 계수 기반 추정치다(기본 0.4781 kgCO2e/kWh, 국가 전력배출계수 변동 가능).
 */
export type TariffConfig = {
  customerType?: string;
  baseRatePerKw?: number;
  demandRatePerKw?: number;
  energyTiers?: { limit: number | null; rate: number }[];
  tou?: { start: number; end: number; rate: number }[];
  vatRate?: number;
  climateRate?: number;
  fuelAdjustmentRate?: number;
  powerFactorThreshold?: number;
  powerFactorPenaltyRate?: number;
  carbonFactor?: number;
};

export type BillInput = {
  usageKwh: number;
  peakKw?: number;
  contractPowerKw?: number;
  powerFactor?: number;
  usageByHour?: number[];
  config: TariffConfig;
};

export type BillResult = {
  baseCharge: number;
  demandCharge: number;
  energyCharge: number;
  powerFactorCharge: number;
  subtotal: number;
  vat: number;
  climateCharge: number;
  fuelAdjustment: number;
  total: number;
  effectiveUnitPrice: number;
  carbonKg: number;
  breakdown: { label: string; kwh?: number; rate?: number; amount: number }[];
  assumptions: string[];
};

const round = (n: number) => Math.round(n);

export function calculateBill(input: BillInput): BillResult {
  const cfg = input.config ?? {};
  const assumptions: string[] = [];
  const breakdown: BillResult["breakdown"] = [];
  const baseRate = cfg.baseRatePerKw ?? 0;
  const contractPower = input.contractPowerKw ?? 0;
  const baseCharge = round(baseRate * contractPower);
  if (baseRate > 0) {
    breakdown.push({ label: "기본요금(계약전력)", kwh: contractPower, rate: baseRate, amount: baseCharge });
    assumptions.push(`계약전력 ${contractPower}kW × 기본요금단가 ${baseRate}원/kW`);
  }

  const demandRate = cfg.demandRatePerKw ?? 0;
  const peak = input.peakKw ?? 0;
  const demandCharge = round(demandRate * peak);
  if (demandRate > 0) {
    breakdown.push({ label: "최대수요전력 요금", kwh: peak, rate: demandRate, amount: demandCharge });
    assumptions.push(`최대수요 ${peak}kW × 수요단가 ${demandRate}원/kW`);
  }

  let energyCharge = 0;
  const tiers = (cfg.energyTiers ?? []).filter((t) => t && Number.isFinite(Number(t.rate)));
  if (tiers.length === 0) {
    assumptions.push("에너지 단가가 설정되지 않아 전력량 요금을 계산하지 못했습니다.");
  } else if (cfg.tou && cfg.tou.length > 0 && input.usageByHour && input.usageByHour.length === 24) {
    for (let hour = 0; hour < 24; hour++) {
      const kwh = input.usageByHour[hour] ?? 0;
      if (kwh <= 0) continue;
      const slot = cfg.tou.find((t) => (t.start <= t.end ? hour >= t.start && hour < t.end : hour >= t.start || hour < t.end));
      const rate = slot?.rate ?? tiers[0].rate;
      const amount = kwh * rate;
      energyCharge += amount;
      breakdown.push({ label: `시간대 ${String(hour).padStart(2, "0")}시`, kwh, rate, amount: round(amount) });
    }
    assumptions.push("시간대별(TOU) 단가를 적용했습니다.");
  } else {
    let remaining = Math.max(0, input.usageKwh);
    let previousLimit = 0;
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const limit = tier.limit ?? Infinity;
      const usage = Math.min(remaining, limit - previousLimit);
      if (usage > 0) {
        const amount = usage * Number(tier.rate);
        energyCharge += amount;
        breakdown.push({ label: `구간 ${i + 1} (${previousLimit}~${limit === Infinity ? "∞" : limit}kWh)`, kwh: usage, rate: Number(tier.rate), amount: round(amount) });
        remaining -= usage;
      }
      previousLimit = limit;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      const last = tiers[tiers.length - 1];
      const amount = remaining * Number(last.rate);
      energyCharge += amount;
      breakdown.push({ label: "구간 초과", kwh: remaining, rate: Number(last.rate), amount: round(amount) });
    }
    assumptions.push("누진 구간별 단가를 적용했습니다.");
  }
  energyCharge = round(energyCharge);

  let powerFactorCharge = 0;
  const pfThreshold = cfg.powerFactorThreshold ?? 90;
  if (cfg.powerFactorPenaltyRate && input.powerFactor !== undefined && input.powerFactor < pfThreshold) {
    const penaltyBase = baseCharge + energyCharge;
    const gap = pfThreshold - input.powerFactor;
    powerFactorCharge = round(penaltyBase * (cfg.powerFactorPenaltyRate / 100) * (gap / 10));
    breakdown.push({ label: "역률 저하 페널티", rate: cfg.powerFactorPenaltyRate, amount: powerFactorCharge });
  }

  const subtotal = baseCharge + demandCharge + energyCharge + powerFactorCharge;
  const climateRate = cfg.climateRate ?? 0;
  const climateCharge = round(input.usageKwh * climateRate);
  if (climateRate > 0) breakdown.push({ label: "기후환경요금", kwh: input.usageKwh, rate: climateRate, amount: climateCharge });
  const fuelRate = cfg.fuelAdjustmentRate ?? 0;
  const fuelAdjustment = round(input.usageKwh * fuelRate);
  if (fuelRate !== 0) breakdown.push({ label: "연료비조정액", kwh: input.usageKwh, rate: fuelRate, amount: fuelAdjustment });
  const vat = round((subtotal + climateCharge + fuelAdjustment) * (cfg.vatRate ?? 0.1));
  const total = subtotal + climateCharge + fuelAdjustment + vat;
  const carbonKg = Number((input.usageKwh * (cfg.carbonFactor ?? 0.4781)).toFixed(2));

  return {
    baseCharge,
    demandCharge,
    energyCharge,
    powerFactorCharge,
    subtotal,
    vat,
    climateCharge,
    fuelAdjustment,
    total,
    effectiveUnitPrice: input.usageKwh > 0 ? Number((total / input.usageKwh).toFixed(2)) : 0,
    carbonKg,
    breakdown,
    assumptions,
  };
}

export function monthlyUsageSeries(readings: { readingAt: Date | string; value: number }[]): { month: string; usage: number }[] {
  const sorted = [...readings].sort((a, b) => new Date(a.readingAt).getTime() - new Date(b.readingAt).getTime());
  const result: { month: string; usage: number }[] = [];
  let previous: number | null = null;
  for (const reading of sorted) {
    const month = new Date(reading.readingAt).toISOString().slice(0, 7);
    const usage = previous === null ? 0 : Math.max(0, reading.value - previous);
    previous = reading.value;
    const existing = result.find((r) => r.month === month);
    if (existing) existing.usage += usage;
    else result.push({ month, usage });
  }
  return result;
}

export function detectAnomalies(
  series: { month: string; usage: number }[],
  thresholdRatio = 0.5,
): { month: string; usage: number; average: number; ratio: number }[] {
  if (series.length < 3) return [];
  const values = series.map((s) => s.usage).filter((v) => v > 0);
  if (values.length === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return series
    .map((s) => ({ ...s, average: Number(mean.toFixed(1)), ratio: mean > 0 ? Number((s.usage / mean).toFixed(2)) : 0 }))
    .filter((s) => s.ratio > 1 + thresholdRatio || (s.ratio < 1 - thresholdRatio && s.usage >= 0));
}
