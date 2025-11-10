import { Navigate, Route, Routes } from 'react-router-dom';
import { TopNav } from './components/layout/TopNav';
import { ConfigurationPage } from './routes/ConfigurationPage';
import { DialoguePage } from './routes/DialoguePage';
import { ResultsPage } from './routes/ResultsPage';
import './App.css';

function App() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<ConfigurationPage />} />
          <Route path="/dialogue" element={<DialoguePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
