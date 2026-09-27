/**
 * 人情账 · 入口
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('找不到 #root 节点');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
