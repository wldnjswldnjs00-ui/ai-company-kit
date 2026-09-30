// The free Gemini tier may use prompts to improve Google's products, so
// anything that identifies a real person is replaced before it leaves the
// Worker. Applied centrally in think(), never left to each department.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[이메일]"],
  // Korean mobile/landline and generic international numbers.
  [/\+?\d{1,3}[-\s]?\(?\d{2,4}\)?[-\s]?\d{3,4}[-\s]?\d{4}/g, "[전화번호]"],
  // Korean resident registration number shape (YYMMDD-NNNNNNN).
  [/\b\d{6}-?[1-4]\d{6}\b/g, "[주민번호]"],
  // Card-number-like digit runs.
  [/\b(?:\d[ -]?){13,19}\b/g, "[카드번호]"],
];

// Bank account numbers written with hyphens (110-123-456789,
// 123456-01-123456). Only 10+ digits, so dates like 2026-09-30 stay.
const ACCOUNT = /\b\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?\b/g;

const PHONE_SHAPE = /^0\d{1,2}-\d{3,4}-\d{4}$/;

// Hyphenated numbers go first: otherwise the phone rule eats the front of
// an account number and leaves its last digits in the text.
export function maskPersonalData(text: string): string {
  const hyphenated = text.replace(ACCOUNT, (m) => (PHONE_SHAPE.test(m) ? "[전화번호]" : m.replace(/\D/g, "").length >= 10 ? "[계좌번호]" : m));
  return PATTERNS.reduce((acc, [pattern, label]) => acc.replace(pattern, label), hyphenated);
}
