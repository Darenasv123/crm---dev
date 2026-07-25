const MOJIBAKE_PATTERN = new RegExp("(?:\\u00c3.|\\u00c2.|\\u00e2[\\u0080-\\u017f]|\\ufffd)");

const WINDOWS_1252_BYTES: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

export function stripUtf8Bom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

export function hasMojibake(value: string): boolean {
  return MOJIBAKE_PATTERN.test(value);
}

function mojibakeScore(value: string): number {
  return (value.match(/[\u00c3\u00c2\u00e2\ufffd]/g) ?? []).length;
}

function encodeWindows1252(value: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      bytes.push(code);
    } else if (char in WINDOWS_1252_BYTES) {
      bytes.push(WINDOWS_1252_BYTES[char]);
    } else {
      return null;
    }
  }
  return Uint8Array.from(bytes);
}

export function repairMojibake(value: string): string {
  if (!hasMojibake(value)) return value;

  let current = value;
  let currentScore = mojibakeScore(current);
  for (let i = 0; i < 3; i++) {
    const bytes = encodeWindows1252(current);
    if (!bytes) break;

    const next = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const nextScore = mojibakeScore(next);
    if (next === current || nextScore > currentScore) break;

    current = next;
    currentScore = nextScore;
    if (!hasMojibake(current)) break;
  }

  return current;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  if (plural) return plural;
  if (singular.endsWith("z")) return `${singular.slice(0, -1)}ces`;
  if (/[aeiouáéíóú]$/i.test(singular)) return `${singular}s`;
  return `${singular}es`;
}

export function formatCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
