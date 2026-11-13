import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import RequireAuth from './RequireAuth';
import { useAuth } from './AuthContext';

// Wrap a page in <RequireRole roles={['admin']}> to keep everyone else out. Logged-out visitors are
// sent to log in first; logged-in people with the wrong role see a short explanation, not a blank page.
// (This is only a courtesy: the backend refuses these requests with 403 whatever the screen does.)
function RoleGate({ roles, children }) {
  const { user } = useAuth();
  if (user && roles.includes(user.role)) return children;
  return (
    <div className="page">
      <EmptyState
        title="This page is not for your account"
        action={
          <Link className="btn btn--secondary" to="/providers">
            Back to providers
          </Link>
        }
      >
        {roles.includes('admin') && roles.length === 1 ? 'It is only for administrators.' : 'It is only for providers.'}
      </EmptyState>
    </div>
  );
}

export default function RequireRole({ roles, children }) {
  return (
    <RequireAuth>
      <RoleGate roles={roles}>{children}</RoleGate>
    </RequireAuth>
  );
}
