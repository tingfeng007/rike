import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/ios.css'
import './styles/refinements.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { initializeLearningStorage } from './services/storage'

// The boundary inside App.jsx only wraps the page area, so a failure thrown by App's own
// useState initializers (e.g. reading corrupted localStorage) escaped it and left a blank
// screen. Wrapping the root makes every render error recoverable.
const root = createRoot(document.getElementById('root'));
root.render(<output className="app-startup">正在恢复你的学习空间…</output>);
const renderApp = () => root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
initializeLearningStorage().then(renderApp, renderApp);
