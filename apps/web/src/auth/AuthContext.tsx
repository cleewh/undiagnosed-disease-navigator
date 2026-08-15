// Demo authentication context for the MDT board.
//
// IMPORTANT: this is a DEMONSTRATION identity picker, not real authentication.
// It does not verify credentials, contact Cognito, or issue tokens. A real
// deployment would wire the existing Amazon Cognito user pool and exchange a
// verified ID token for the signed-in role. The selected role is persisted to
// localStorage purely so the personalised workspace survives a page reload.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { roleById, type RoleDefinition, type RoleId } from "./roles.js";

const SESSION_STORAGE_KEY = "udn.session";

/** Persisted demo session: the chosen role and the display name. */
export interface Session {
  readonly roleId: RoleId;
  readonly name: string;
}

export interface AuthContextValue {
  /** The current demo session, or null when signed out. */
  readonly session: Session | null;
  /** The resolved role definition for the current session, or null. */
  readonly role: RoleDefinition | null;
  /** Sign in as a role, using an optional display name (defaults to sampleName). */
  signIn: (roleId: RoleId, name?: string) => void;
  /** Clear the current session. */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Read and validate the persisted session from localStorage. */
function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { roleId?: unknown; name?: unknown };
    if (typeof parsed.roleId !== "string" || typeof parsed.name !== "string") return null;
    // Only accept a session whose role is one of the known role definitions.
    const role = roleById(parsed.roleId);
    if (!role) return null;
    return { roleId: role.id, name: parsed.name };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());

  // Persist (or clear) the session whenever it changes.
  useEffect(() => {
    try {
      if (session) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Storage may be unavailable (private mode); the session still works in-memory.
    }
  }, [session]);

  const signIn = useCallback((roleId: RoleId, name?: string) => {
    const role = roleById(roleId);
    if (!role) return;
    setSession({ roleId: role.id, name: name?.trim() || role.sampleName });
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = session ? roleById(session.roleId) ?? null : null;
    return { session, role, signIn, signOut };
  }, [session, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the demo auth context. Throws if used outside an AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return ctx;
}
