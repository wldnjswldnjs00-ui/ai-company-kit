// The free Gemini tier may use prompts to improve Google's products, so
// anything that identifies a real person is replaced before it leaves the
// Worker. Applied centrally in think(), never left to each department.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[이메일]"],
  // Korean mobile/landline and generic international numbers.
  [/\+?\d{1,3}[-\s]?\(?\d{2,4}\)?[-\s]?\d{3,4}[-\s]?\d{4}/g, "[전화번호]"],
  // Korean resident registration number shape (YYMMDD-NNNNNNN).
  [/\b\d{6}-?[1-4]\d{6}\b/g, "[주민번호]"],
  // Crypto wallet public keys (G...) and secret seeds (S...), 56 chars.
  [/\b[GS][A-Z2-7]{55}\b/g, "[지갑주소]"],
  // Card-number-like digit runs.
  [/\b(?:\d[ -]?){13,19}\b/g, "[카드번호]"],
];

export function maskPersonalData(text: string): string {
  return PATTERNS.reduce((acc, [pattern, label]) => acc.replace(pattern, label), text);
}
