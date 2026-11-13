import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';

export default function NotFoundPage({ what = 'page' }) {
  return (
    <div className="page">
      <EmptyState
        title={`We can’t find that ${what}`}
        action={
          <Link className="btn btn--primary" to="/providers">
            See all providers
          </Link>
        }
      >
        It may have been removed, or the link is wrong.
      </EmptyState>
    </div>
  );
}
