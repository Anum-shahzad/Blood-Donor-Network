import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';

// Placeholder routing foundation — real pages (donor dashboard, request
// creation, admin panel) get added as those features land.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
