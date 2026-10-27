import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { connectSidePanelPort } from './utils/sidePanelToggle'

// Lets the "toggle-side-panel" keyboard command know this panel is open and close it (see sidePanelToggle.ts)
connectSidePanelPort()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
