import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import DonorDashboard from './pages/DonorDashboard.jsx';
import RequesterDashboard from './pages/RequesterDashboard.jsx';

// Admin panel gets added once that role's features land.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/donor/dashboard" element={<DonorDashboard />} />
      <Route path="/requester/dashboard" element={<RequesterDashboard />} />
    </Routes>
  );
}
