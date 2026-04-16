import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { initPostHog } from './lib/telemetry.ts';
import { LanguageProvider } from './lib/i18n.tsx';
import { registerView } from './lib/extensions.ts';

initPostHog();

(window as any).__granclaw = {
  React,
  useState,
  useEffect,
  useCallback,
  useRef,
  registerView,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LanguageProvider>
  </React.StrictMode>
);

fetch('/ext/index.js')
  .then(r => {
    if (!r.ok) return;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('javascript')) return;
    return r.text();
  })
  .then(code => {
    if (!code) return;
    const s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  })
  .catch(() => {});
