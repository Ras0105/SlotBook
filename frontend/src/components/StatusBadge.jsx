const LABELS = { booked: 'Booked', cancelled: 'Cancelled', completed: 'Completed' };

export default function StatusBadge({ status }) {
  return <span className={`badge badge--${status}`}>{LABELS[status] ?? status}</span>;
}
