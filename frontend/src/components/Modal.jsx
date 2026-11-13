import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A confirmation dialog.
 *  - Escape or clicking the dark area closes it (unless `busy`)
 *  - Tab stays inside the dialog
 *  - focus starts on the element with data-autofocus (put it on the SAFE choice) and returns afterwards
 */
export default function Modal({ title, children, actions, onClose, busy = false }) {
  const ref = useRef(null);
  // Keep the latest props in refs so the effect below runs ONCE when the dialog opens. If it re-ran
  // on every parent render it would steal focus back and lose track of where focus should return to.
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    (node.querySelector('[data-autofocus]') ?? node.querySelector(FOCUSABLE))?.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape' && !busyRef.current) {
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = [...node.querySelectorAll(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title">{title}</h2>
        <div>{children}</div>
        <div className="modal__actions">{actions}</div>
      </div>
    </div>
  );
}
