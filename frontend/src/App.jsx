import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import DonorDashboard from './pages/DonorDashboard.jsx';

// Request creation and admin panel get added as those features land.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/donor/dashboard" element={<DonorDashboard />} />
    </Routes>
  );
}
