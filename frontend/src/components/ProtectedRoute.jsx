import { Navigate, useLocation } from 'react-router-dom';
import { getUser, dashboardPathFor } from '../auth/session.js';

// Route guard: not logged in -> /login; wrong role -> that person's own
// dashboard. (The server enforces permissions too; this just stops people
// landing on pages that can only show them errors.)
export default function ProtectedRoute({ roles, children }) {
  const user = getUser();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={dashboardPathFor(user.role)} replace />;
  }
  return children;
}
