import { NavLink } from 'react-router-dom';

export default function AdminNav() {
  return (
    <nav className="subnav" aria-label="Admin sections">
      <NavLink to="/admin" end>
        Overview
      </NavLink>
      <NavLink to="/admin/appointments">All appointments</NavLink>
    </nav>
  );
}
