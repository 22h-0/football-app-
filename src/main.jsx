import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './tournament.css';
import './goalscorers.css';
import './sharing.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);

if (import.meta.env.PROD && import.meta.env.VITE_SHARED_MODE === 'true' && window.location.protocol !== 'file:' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
