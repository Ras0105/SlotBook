// A simple, honest strength hint (length first, then variety). It guides people; the server enforces the real rule (8+ characters).

export const MIN_PASSWORD_LENGTH = 8;

/** @returns {{ score: 0|1|2|3, label: string }} score 0 = nothing typed */
export function passwordStrength(password) {
  if (!password) return { score: 0, label: '' };
  let points = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) points += 1;
  if (password.length >= 12) points += 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (kinds >= 3) points += 1;
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: 'Too short' };
  if (points <= 1) return { score: 1, label: 'Weak' };
  if (points === 2) return { score: 2, label: 'Good' };
  return { score: 3, label: 'Strong' };
}
