import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

// Route guard: renders its children only when a demo session exists, otherwise
// redirects to the role picker at /login. (Demo-only gate; see AuthContext.)
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const { session } = useAuth();
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
