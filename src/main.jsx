import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'

// The boundary inside App.jsx only wraps the page area, so a failure thrown by App's own
// useState initializers (e.g. reading corrupted localStorage) escaped it and left a blank
// screen. Wrapping the root makes every render error recoverable.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
