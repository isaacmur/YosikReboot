// iCalendar text (RFC 5545) for the calendar feed (F5): one VEVENT per session.
// Lines end in CRLF and fold at 75 bytes (without splitting a character), and
// text values are escaped, so any calendar app reads names with commas or emoji.

export interface IcsEvent {
  /** Stable across fetches, so a calendar updates the event instead of adding another. */
  uid: string;
  start: string;
  end: string;
  summary: string;
  description?: string;
  url?: string;
  /** Times not confirmed yet. */
  tentative?: boolean;
}

/** `20261021T010000Z` */
export const icsTime = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const enc = new TextEncoder();

/** Splits a content line into 75-byte pieces; continuation lines start with a space. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // The first piece holds 75 bytes; later ones 74, after their leading space.
    if (bytes + n > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = '';
      bytes = 0;
    }
    part += ch;
    bytes += n;
  }
  parts.push(part);
  return parts.join('\r\n ');
}

export function calendar(o: { name: string; description: string; now: string; events: IcsEvent[] }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YosikReboot//Fortnite competitive schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(o.name)}`,
    `X-WR-CALDESC:${icsText(o.description)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of o.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(e.uid)}`,
      `DTSTAMP:${icsTime(o.now)}`,
      `DTSTART:${icsTime(e.start)}`,
      `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      `STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
      // Sessions don't mark you busy.
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
