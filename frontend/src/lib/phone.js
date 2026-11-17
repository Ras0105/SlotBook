// Phone numbers for WhatsApp reminders. The server wants international format: + country code + number.

/**
 * "+91 98765-43210" -> "+919876543210". An empty box -> "" (meaning "no number").
 * Returns null when the text is not a usable international number.
 */
export function normalizePhone(text) {
  const cleaned = String(text ?? '').trim().replace(/[\s\-().]/g, '');
  if (cleaned === '') return '';
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}
