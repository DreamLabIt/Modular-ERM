import { Prisma } from '@prisma/client';

export type MoneyLike = Prisma.Decimal | number | string;

export function toDecimal(value: MoneyLike): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  const d = new Prisma.Decimal(value);
  if (!d.isFinite()) {
    throw new Error('Monetary value must be finite.');
  }
  return d;
}

export function roundMoney(value: MoneyLike, places = 2): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);
}

export function sumDecimals(values: MoneyLike[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, val) => acc.plus(toDecimal(val)),
    new Prisma.Decimal(0),
  );
}

export function formatMoney(
  value: MoneyLike,
  currency = 'BDT',
  places = 2,
): string {
  const num = Number(roundMoney(value, places));
  return `${currency} ${num.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}
