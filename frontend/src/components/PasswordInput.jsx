import { useState } from 'react';

// A password box with a show/hide button. Spread the props that <Field> hands you onto it:
//   <Field id="pw" label="Password">{(props) => <PasswordInput {...props} value={v} onChange={...} />}</Field>
export default function PasswordInput({ id, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-wrap">
      <input id={id} type={shown ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className="password-wrap__toggle"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
