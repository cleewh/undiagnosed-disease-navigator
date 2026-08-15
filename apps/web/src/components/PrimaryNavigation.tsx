import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../constants.js";
import { Icon, navIconName } from "./icons.js";

// Persistent primary navigation control visible on every page, linking to all
// seven pages (Requirement 24.1). Each link pairs a line icon with its label
// for a clinical-console feel; the icon is decorative (the text label is the
// accessible name).
export function PrimaryNavigation() {
  return (
    <nav aria-label="Primary" data-testid="primary-navigation" className="primary-nav">
      <p className="sidebar__section-label">Workspace</p>
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.path}
              end={item.path === "/"}
              data-testid={`nav-${item.id}`}
              className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}
            >
              <Icon name={navIconName(item.id)} className="nav-link__icon" size={18} />
              <span className="nav-link__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
