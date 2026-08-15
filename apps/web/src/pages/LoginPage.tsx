import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ROLES, type RoleDefinition } from "../auth/roles.js";
import { ResponsibleUseNotice } from "../components/ResponsibleUseNotice.js";
import { Icon } from "../components/icons.js";

// Role picker used to enter the personalised workspace.
//
// This is a DEMONSTRATION identity chooser, not real authentication (the notice
// below states this in the UI). Selecting a specialist signs in as that role's
// sample identity and lands on the role's default view.
export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const choose = (role: RoleDefinition) => {
    signIn(role.id);
    navigate(role.landingPath, { replace: true });
  };

  return (
    <div className="login-shell">
      <ResponsibleUseNotice />
      <main id="main-content" className="login-main" tabIndex={-1}>
        <div className="login-intro">
          <span className="brand-mark brand-mark--lg" aria-hidden="true">UD</span>
          <h1 className="login-title">Undiagnosed Disease Case Navigator</h1>
          <p className="login-subtitle">
            Select your specialist role to open a workspace tailored to your part of the
            multidisciplinary team.
          </p>
          <p className="login-demo-note" role="note">
            <Icon name="lock" className="login-demo-note__icon" size={18} />
            <span>
              <strong>Demonstration sign-in.</strong> This role picker is for the prototype only and
              does not perform real authentication. A production deployment would authenticate
              through the Amazon Cognito user pool. All identities and case data shown are synthetic.
            </span>
          </p>
        </div>

        <p className="login-grid-label">Choose a specialist role</p>
        <ul className="login-grid" aria-label="Specialist roles">
          {ROLES.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                className="role-card"
                data-testid={`role-${role.id}`}
                style={{ ["--role-accent" as string]: role.accent }}
                onClick={() => choose(role)}
              >
                <span className="role-card__top">
                  <span className="role-card__avatar" aria-hidden="true">{role.initials}</span>
                  <span className="role-card__body">
                    <span className="role-card__label">{role.label}</span>
                    <span className="role-card__name">{role.sampleName}</span>
                  </span>
                </span>
                <span className="role-card__scope">{role.scope}</span>
                <span className="role-card__cta">
                  <span>Enter workspace</span>
                  <Icon name="arrow-right" size={16} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
