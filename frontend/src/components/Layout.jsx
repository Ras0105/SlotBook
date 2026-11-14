import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from './Avatar';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

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
          <Link to="/" className="brand">
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
            <ThemeToggle />
            {status === 'authed' && user ? (
              <>
                <NavLink to="/profile" className="account__me" title="View and edit your profile">
                  <Avatar name={user.name} size="sm" />
                  <span className="account__name">{user.name}</span>
                </NavLink>
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
      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <Link to="/" className="brand brand--small">
              <Logo size={24} />
              SlotBook
            </Link>
            <p className="muted">Appointments without the back-and-forth.</p>
          </div>
          <div className="site-footer__links">
            <Link to="/providers">Browse providers</Link>
            {user?.role !== 'admin' && <Link to={user ? '/appointments' : '/register'}>{user ? 'Your bookings' : 'Sign up free'}</Link>}
          </div>
          <p className="muted site-footer__copy">© {new Date().getFullYear()} SlotBook</p>
        </div>
      </footer>
    </>
  );
}
