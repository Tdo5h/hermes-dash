import {
  MAX_TTS_CHUNK_CHARS,
  MAX_TTS_TEXT_CHARS,
} from "@/lib/deepgram-tts-voices";
import { stripMarkdownForSpeech } from "@/lib/strip-markdown-speech";

const FIRST_CHUNK_MAX_CHARS = 320;
const REST_CHUNK_MAX_CHARS = Math.min(1400, MAX_TTS_CHUNK_CHARS);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_ALIASES: Record<string, string> = {
  jan: "January",
  january: "January",
  feb: "February",
  february: "February",
  mar: "March",
  march: "March",
  apr: "April",
  april: "April",
  may: "May",
  jun: "June",
  june: "June",
  jul: "July",
  july: "July",
  aug: "August",
  august: "August",
  sep: "September",
  sept: "September",
  september: "September",
  oct: "October",
  october: "October",
  nov: "November",
  november: "November",
  dec: "December",
  december: "December",
};

const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

const ACRONYMS: Record<string, string> = {
  AI: "A I",
  API: "A P I",
  CSS: "C S S",
  GST: "G S T",
  HTML: "H T M L",
  ID: "I D",
  JS: "J S",
  NZ: "N Z",
  NZD: "N Z D",
  PDF: "P D F",
  QA: "Q A",
  TBC: "T B C",
  UI: "U I",
  URL: "U R L",
};

function wordsUnderThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) {
    parts.push(`${SMALL[hundreds]} hundred`);
    if (rest) parts.push("and");
  }
  if (rest >= 20) {
    const ten = Math.floor(rest / 10);
    const one = rest % 10;
    parts.push(one ? `${TENS[ten]} ${SMALL[one]}` : TENS[ten]);
  } else if (rest > 0 || parts.length === 0) {
    parts.push(SMALL[rest]);
  }
  return parts.join(" ");
}

function intToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.trunc(Math.abs(n));
  if (rounded === 0) return "zero";
  const groups: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  const parts: string[] = [];
  let rest = rounded;
  for (const [value, label] of groups) {
    const count = Math.floor(rest / value);
    if (!count) continue;
    parts.push(`${intToWords(count)} ${label}`);
    rest %= value;
  }
  if (rest) {
    if (parts.length && rest < 100) parts.push("and");
    parts.push(wordsUnderThousand(rest));
  }
  const out = parts.join(" ");
  return n < 0 ? `minus ${out}` : out;
}

function decimalToWords(raw: string): string {
  const [left, right = ""] = raw.split(".");
  const leftWords = intToWords(Number(left || 0));
  const digits = right
    .split("")
    .filter((ch) => /\d/.test(ch))
    .map((ch) => SMALL[Number(ch)])
    .join(" ");
  return digits ? `${leftWords} point ${digits}` : leftWords;
}

function yearToSpeech(raw: string): string {
  const n = Number(raw.length === 2 ? `20${raw}` : raw);
  if (!Number.isFinite(n)) return raw;
  if (n >= 2000 && n <= 2099) {
    const rest = n - 2000;
    if (rest === 0) return "two thousand";
    if (rest < 10) return `two thousand and ${SMALL[rest]}`;
    return `twenty ${wordsUnderThousand(rest)}`;
  }
  return intToWords(n);
}

function currencyName(prefix: string): string {
  const p = prefix.toUpperCase().replace(/\s+/g, "");
  if (p.startsWith("NZ")) return "New Zealand dollar";
  if (p.startsWith("AUD")) return "Australian dollar";
  if (p.startsWith("USD")) return "U S dollar";
  return "dollar";
}

function pluralizeCurrency(name: string, value: number): string {
  return value === 1 ? name : `${name}s`;
}

function currencyToSpeech(prefix: string, amount: string): string {
  const clean = amount.replace(/,/g, "");
  const [wholeRaw, centsRaw = ""] = clean.split(".");
  const whole = Number(wholeRaw || 0);
  if (!Number.isFinite(whole)) return amount;
  const cents = Number((centsRaw + "00").slice(0, 2));
  const name = currencyName(prefix);
  const dollars = `${intToWords(whole)} ${pluralizeCurrency(name, whole)}`;
  if (!cents) return dollars;
  return `${dollars} and ${intToWords(cents)} cents`;
}

function speakDigitGroups(raw: string): string {
  return raw
    .split(/([.\-\s])/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) {
        return part
          .split("")
          .map((digit) => SMALL[Number(digit)])
          .join(" ");
      }
      if (/[.\-]/.test(part)) return ".";
      return " ";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDates(s: string): string {
  let out = s.replace(
    /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
    (_m, year: string, month: string, day: string) => {
      const monthName = MONTHS[Number(month) - 1];
      if (!monthName) return _m;
      return `${intToWords(Number(day))} ${monthName} ${yearToSpeech(year)}`;
    }
  );
  out = out.replace(
    /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g,
    (_m, day: string, month: string, year: string) => {
      const monthName = MONTHS[Number(month) - 1];
      if (!monthName) return _m;
      return `${intToWords(Number(day))} ${monthName} ${yearToSpeech(year)}`;
    }
  );
  out = out.replace(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?|September|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*[–—-]\s*(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?|September|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(\d{1,2}),?\s*(\d{2,4})?\b/gi,
    (
      match,
      monthA: string,
      dayA: string,
      monthB: string | undefined,
      dayB: string,
      year: string | undefined
    ) => {
      const startMonth = MONTH_ALIASES[monthA.toLowerCase()];
      const endMonth = MONTH_ALIASES[(monthB || monthA).toLowerCase()];
      if (!startMonth || !endMonth) return match;
      const suffix = year ? `, ${yearToSpeech(year)}` : "";
      return `${startMonth} ${intToWords(Number(dayA))} to ${endMonth} ${intToWords(
        Number(dayB)
      )}${suffix}`;
    }
  );
  out = out.replace(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?|September|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s*(\d{2,4})?\b/gi,
    (match, month: string, day: string, year: string | undefined) => {
      const monthName = MONTH_ALIASES[month.toLowerCase()];
      if (!monthName) return match;
      const suffix = year ? `, ${yearToSpeech(year)}` : "";
      return `${monthName} ${intToWords(Number(day))}${suffix}`;
    }
  );
  return out;
}

function normalizeTimes(s: string): string {
  return s.replace(
    /\b(\d{1,2}):(\d{2})\s*([AP])\.?M\.?\b/gi,
    (_m, hourRaw: string, minuteRaw: string, meridiemRaw: string) => {
      const hour = Number(hourRaw);
      const minute = Number(minuteRaw);
      const meridiem = meridiemRaw.toUpperCase() === "A" ? "A M" : "P M";
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return _m;
      if (minute === 0) return `${intToWords(hour)} o'clock ${meridiem}`;
      const minuteWords =
        minute < 10 ? `oh ${SMALL[minute]}` : wordsUnderThousand(minute);
      return `${intToWords(hour)} ${minuteWords} ${meridiem}`;
    }
  );
}

function normalizeNumbers(s: string): string {
  let out = s.replace(
    /\b(NZ\$|NZD\s*\$?|AUD\s*\$?|USD\s*\$?|\$)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/gi,
    (_m, prefix: string, amount: string) => currencyToSpeech(prefix, amount)
  );
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*%/g, (_m, n: string) => {
    const words = n.includes(".") ? decimalToWords(n) : intToWords(Number(n));
    return `${words} percent`;
  });
  out = out.replace(/\b\d{2,4}(?:[.\-\s]\d{2,4}){1,4}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 6) return match;
    return speakDigitGroups(match);
  });
  out = out.replace(/\b\d+\.\d+\b/g, (match) => decimalToWords(match));
  out = out.replace(/\b\d{1,6}\b/g, (match) => intToWords(Number(match)));
  return out;
}

function normalizeAcronyms(s: string): string {
  return s.replace(/\b[A-Z]{2,5}\b/g, (match) => ACRONYMS[match] ?? match);
}

function normalizeTechnicalNoise(s: string): string {
  let out = s.replace(/\bhttps?:\/\/[^\s)]+/gi, " there is a link in the message. ");
  out = out.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, " an email address is in the message. ");
  out = out.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    " I D omitted "
  );
  out = out.replace(/\b((?:job|build|run)\s+id)\s*:\s*[A-Za-z0-9_-]{8,}\b/gi, "$1 omitted");
  out = out.replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/g, " file path omitted ");
  out = out.replace(/\b[A-Za-z0-9_-]{10,}\b/g, (match) => {
    if (/[A-Za-z]/.test(match) && /\d/.test(match)) return "I D omitted";
    return match;
  });
  return out;
}

function tidySpeechText(s: string): string {
  return s
    .replace(/[·•]/g, ", ")
    .replace(/[<>]/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/(?:\.\s*){4,}/g, "... ")
    .trim();
}

export function prepareSpeechText(raw: string): string {
  let s = stripMarkdownForSpeech(raw);
  s = normalizeTechnicalNoise(s);
  s = normalizeDates(s);
  s = normalizeTimes(s);
  s = normalizeNumbers(s);
  s = normalizeAcronyms(s);
  s = tidySpeechText(s);
  return s.length > MAX_TTS_TEXT_CHARS ? s.slice(0, MAX_TTS_TEXT_CHARS) : s;
}

function findCutPoint(text: string, maxChars: number): number {
  if (text.length <= maxChars) return text.length;
  const window = text.slice(0, maxChars + 1);
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! ")
  );
  if (sentence >= 80) return sentence + 1;
  const clause = Math.max(
    window.lastIndexOf("; "),
    window.lastIndexOf(": "),
    window.lastIndexOf(", "),
    window.lastIndexOf(" - ")
  );
  if (clause >= 120) return clause + 1;
  const space = window.lastIndexOf(" ");
  return space >= 80 ? space : maxChars;
}

function findFirstCutPoint(text: string, maxChars: number): number {
  if (text.length <= maxChars) return text.length;
  const window = text.slice(0, maxChars + 1);
  const sentenceMatches = [...window.matchAll(/[.!?]\s/g)];
  const sentence = sentenceMatches.find((match) => (match.index ?? 0) >= 80);
  if (sentence?.index !== undefined) return sentence.index + 1;
  const clauseMatches = [...window.matchAll(/[,;:]\s| - /g)];
  const clause = clauseMatches.find((match) => (match.index ?? 0) >= 120);
  if (clause?.index !== undefined) return clause.index + 1;
  const space = window.lastIndexOf(" ");
  return space >= 80 ? space : maxChars;
}

function sentenceEnd(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (/[.!?]$/.test(t)) return t;
  if (/[,;:]$/.test(t)) return `${t.slice(0, -1)}.`;
  return `${t}.`;
}

function splitFirstChunk(text: string): [string, string] {
  const cut = findFirstCutPoint(text, FIRST_CHUNK_MAX_CHARS);
  const first = sentenceEnd(text.slice(0, cut));
  const rest = text.slice(cut).trim();
  return [first, rest];
}

function splitRestChunks(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest) {
    const cut = findCutPoint(rest, REST_CHUNK_MAX_CHARS);
    chunks.push(sentenceEnd(rest.slice(0, cut)));
    rest = rest.slice(cut).trim();
  }
  return chunks;
}

export function prepareSpeechChunks(raw: string): string[] {
  const text = prepareSpeechText(raw);
  if (!text) return [];
  const [first, rest] = splitFirstChunk(text);
  return [first, ...splitRestChunks(rest)].filter(Boolean);
}
