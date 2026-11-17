// Read-only stars. The words carry the meaning ("4.5 out of 5"); the stars themselves are decorative.
const PATH = 'M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8L12 3.2z';

function Svg({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={PATH} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// fill: 0, 0.5 or 1. A half star is the outline with the left half of a filled star laid over it.
function Star({ fill }) {
  return (
    <span className="star">
      <Svg filled={fill === 1} />
      {fill === 0.5 && (
        <span className="star__half">
          <Svg filled />
        </span>
      )}
    </span>
  );
}

const roundToHalf = (value) => Math.round(value * 2) / 2;

/** "★★★★☆ 4.2 (12 reviews)"; with no reviews yet: "No reviews yet". */
export default function StarRating({ average, count, compact = false }) {
  if (!count) return <span className="rating rating--none">No reviews yet</span>;
  const rounded = roundToHalf(average);
  const label = `${average.toFixed(1)} out of 5, ${count} ${count === 1 ? 'review' : 'reviews'}`;
  return (
    <span className="rating" role="img" aria-label={label}>
      <span className="rating__stars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} fill={rounded >= n ? 1 : rounded >= n - 0.5 ? 0.5 : 0} />
        ))}
      </span>
      <span className="rating__text" aria-hidden="true">
        <strong>{average.toFixed(1)}</strong> ({count}
        {compact ? '' : count === 1 ? ' review' : ' reviews'})
      </span>
    </span>
  );
}

/** Stars for one review: a whole number of 1 to 5. */
export function StarsOnly({ rating }) {
  return (
    <span className="rating" role="img" aria-label={`${rating} out of 5`}>
      <span className="rating__stars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} fill={rating >= n ? 1 : 0} />
        ))}
      </span>
    </span>
  );
}
