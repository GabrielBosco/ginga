import { z } from "zod";

export const MINIMUM_ACCOUNT_AGE = 16;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseBirthDate(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

export function isAtLeastMinimumAge(value: string, now = new Date()) {
  const birthDate = parseBirthDate(value);
  if (!birthDate) return false;
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - MINIMUM_ACCOUNT_AGE,
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  return birthDate.getTime() <= cutoff.getTime();
}

export const birthDateInputSchema = z.string()
  .trim()
  .regex(ISO_DATE, "Informe uma data de nascimento valida.")
  .refine((value) => Boolean(parseBirthDate(value)), "Informe uma data de nascimento valida.")
  .refine((value) => isAtLeastMinimumAge(value), `Voce precisa ter pelo menos ${MINIMUM_ACCOUNT_AGE} anos para criar uma conta.`);

export function birthDateToDate(value: string) {
  const parsed = parseBirthDate(value);
  if (!parsed) throw new Error("Data de nascimento invalida");
  return parsed;
}
