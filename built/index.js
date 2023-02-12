import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Routed from './Routed';
const root = createRoot(document.getElementById('root'));
root.render(_jsx(BrowserRouter, { children: _jsx(Routed, {}) }));
