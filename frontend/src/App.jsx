import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import DonorDashboard from './pages/DonorDashboard.jsx';
import RequesterDashboard from './pages/RequesterDashboard.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Emergency from './pages/Emergency.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ScrollToHash from './components/ScrollToHash.jsx';
import ConfirmDialogHost from './components/ConfirmDialog.jsx';

export default function App() {
  return (
    <>
      <ScrollToHash />
      <ConfirmDialogHost />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/emergency" element={<Emergency />} />
        <Route
          path="/donor/dashboard"
          element={
            <ProtectedRoute roles={['donor']}>
              <DonorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requester/dashboard"
          element={
            <ProtectedRoute roles={['requester']}>
              <RequesterDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
