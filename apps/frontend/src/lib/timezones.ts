export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria del navegador; si no se puede detectar, la de Argentina. Llamar sólo en el cliente. */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Desfasaje actual respecto de UTC, p. ej. "UTC-03:00". Considera horario de verano. */
export function utcOffset(tz: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part || part === 'GMT') return 'UTC+00:00';
    return part.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

function offsetMinutes(offset: string): number {
  const m = /UTC([+-])(\d{2}):(\d{2})/.exec(offset);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function timezoneCity(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

/** "Buenos Aires (UTC-03:00)" */
export function timezoneLabel(tz: string): string {
  const offset = utcOffset(tz);
  return offset ? `${timezoneCity(tz)} (${offset})` : timezoneCity(tz);
}

export interface TimezoneOption {
  id: string;
  city: string;
  offset: string;
}

/** Zonas IANA soportadas por el navegador, ordenadas por desfasaje y ciudad. Incluye `ensure` aunque no esté en la lista. */
export function listTimezones(ensure?: string): TimezoneOption[] {
  let ids: string[];
  try {
    ids = Intl.supportedValuesOf('timeZone');
  } catch {
    ids = [DEFAULT_TIMEZONE];
  }
  const all = new Set(ids);
  if (ensure && isValidTimezone(ensure)) all.add(ensure);
  const now = new Date();
  return [...all]
    .map((id) => ({ id, city: timezoneCity(id), offset: utcOffset(id, now) }))
    .sort(
      (a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.city.localeCompare(b.city),
    );
}
