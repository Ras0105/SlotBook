// kind: 'error' | 'success' | 'info'. Errors are announced right away by screen readers.
export default function Alert({ kind = 'error', children, onDismiss, action }) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {(action || onDismiss) && (
        <div className="alert__actions">
          {action}
          {onDismiss && (
            <button type="button" className="btn-link" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
