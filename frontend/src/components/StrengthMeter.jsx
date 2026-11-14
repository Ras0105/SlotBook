import { passwordStrength } from '../lib/password';

// Three bars and a word under a "new password" box. Hidden until something is typed.
export default function StrengthMeter({ password }) {
  const { score, label } = passwordStrength(password);
  if (!score) return null;
  return (
    <div className="strength" data-score={score}>
      <span className="strength__bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="strength__label">Strength: {label}</span>
    </div>
  );
}
