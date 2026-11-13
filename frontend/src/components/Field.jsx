// One labelled form control with its hint and error wired up for screen readers.
//   <Field id="name" label="Name" error={err} hint="...">{(props) => <input {...props} value=... />}</Field>
// `props` carries id, aria-invalid and aria-describedby; spread it on the control.
export default function Field({ id, label, error, hint, children }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
