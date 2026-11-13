import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0e6b74" />
      <rect x="7" y="8" width="18" height="4" rx="2" fill="#fff" />
      <rect x="7" y="14" width="11" height="4" rx="2" fill="#f0b429" />
      <rect x="7" y="20" width="14" height="4" rx="2" fill="#fff" opacity=".6" />
    </svg>
  );
}

export default function Layout() {
  const { user, status, signOut } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    signOut();
    navigate('/providers');
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/providers" className="brand">
            <Logo />
            SlotBook
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/providers">Providers</NavLink>
            {user && user.role !== 'admin' && <NavLink to="/appointments">My appointments</NavLink>}
            {user?.role === 'provider' && <NavLink to="/dashboard">Dashboard</NavLink>}
            {user?.role === 'customer' && <NavLink to="/become-provider">Become a provider</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="account">
            {status === 'authed' && user ? (
              <>
                <span className="account__name">{user.name}</span>
                <button type="button" className="btn btn--secondary btn--small" onClick={handleLogout}>
                  Log out
                </button>
              </>
            ) : status === 'anon' ? (
              <>
                <Link to="/login" className="btn btn--secondary btn--small">
                  Log in
                </Link>
                <Link to="/register" className="btn btn--primary btn--small">
                  Sign up
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
