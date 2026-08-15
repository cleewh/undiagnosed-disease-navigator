import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { PrimaryNavigation } from "./PrimaryNavigation.js";
import { ResponsibleUseNotice } from "./ResponsibleUseNotice.js";
import { Icon, navIconName } from "./icons.js";
import { GUIDED_DEMO_NAV } from "../constants.js";
import { useAuth } from "../auth/AuthContext.js";

// Shell layout: a full-width Responsible_Use_Notice is pinned at the top of the
// viewport (Req 24.6/25.1); below it a dark navigation rail carries the brand,
// the persistent primary navigation (Req 24.1) and the signed-in identity,
// while the main column has a topbar with environment context, a demonstration
// search field, and the user chip. The shell is tinted with the current role's
// accent via the --role-accent custom property.
export function AppLayout() {
  const { role, session, signOut } = useAuth();
  const navigate = useNavigate();
  const accent = role?.accent ?? "#2563eb";

  const handleSignOut = () => {
    signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell" style={{ ["--role-accent" as string]: accent }}>
      <ResponsibleUseNotice />
      <div className="app-body">
        <aside className="sidebar">
          <div className="app-branding">
            <span className="brand-mark" aria-hidden="true">UD</span>
            <span className="brand-lockup">
              <span className="app-title">UDN Navigator</span>
              <span className="app-subtitle">Case intelligence console</span>
            </span>
          </div>

          <PrimaryNavigation />

          <nav aria-label="Demo" data-testid="secondary-navigation" className="secondary-nav">
            <p className="sidebar__section-label">Presentation</p>
            <NavLink
              to={GUIDED_DEMO_NAV.path}
              data-testid={`nav-${GUIDED_DEMO_NAV.id}`}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              <Icon name={navIconName(GUIDED_DEMO_NAV.id)} className="nav-link__icon" size={18} />
              <span className="nav-link__label">{GUIDED_DEMO_NAV.label}</span>
            </NavLink>
          </nav>

          <div className="sidebar__footer">
            <span className="sidebar__id-avatar" aria-hidden="true">{role?.initials ?? "??"}</span>
            <span className="sidebar__id-meta">
              <span className="sidebar__id-name">{session?.name ?? "Guest"}</span>
              <span className="sidebar__id-role">{role ? role.label : "No role"}</span>
            </span>
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="topbar__left">
              <span className="topbar__context">{role ? role.label : "Workspace"}</span>
              <span className="env-badge" title="Prototype environment">
                <span className="env-badge__dot" aria-hidden="true" />
                Demo environment · Synthetic data
              </span>
            </div>

            <div className="topbar__right">
              <div className="topbar__search">
                <Icon name="search" className="topbar__search-icon" size={16} />
                <input
                  type="search"
                  className="topbar__search-input"
                  placeholder="Search cases, genes, HPO terms…"
                  aria-label="Search cases, genes, or HPO terms (demonstration)"
                />
              </div>

              <div className="user-chip">
                <span className="user-chip__avatar" aria-hidden="true">
                  {role?.initials ?? "??"}
                </span>
                <span className="user-chip__meta">
                  <span className="user-chip__name">{session?.name ?? "Guest"}</span>
                  {role && <span className="user-chip__role">{role.label}</span>}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost user-chip__signout"
                  onClick={handleSignOut}
                >
                  <Icon name="log-out" size={16} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </header>

          <main id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
