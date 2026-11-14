import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// What Tab can reach inside the dialog. In a group of radio buttons only ONE is a Tab stop (the checked one,
// or the first when none is checked); the arrow keys move within the group. Counting every radio would make
// the "wrap around at the ends" logic below miss the real first and last stop.
function tabStops(node) {
  return [...node.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.type !== 'radio' || !el.name) return true;
    const group = [...node.querySelectorAll('input[type="radio"]')].filter((r) => r.name === el.name);
    return el === (group.find((r) => r.checked) ?? group[0]);
  });
}

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
        const items = tabStops(node);
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
