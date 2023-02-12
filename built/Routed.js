import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { Suspense, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
const App = React.lazy(() => import('./App'));
const Guide = React.lazy(() => import('./guide/Guide'));
export default function Routed() {
    const navigate = useNavigate();
    useEffect(() => {
        const referrer = document.referrer;
        if (referrer) {
            const path = new URL(document.referrer).pathname;
            if (path.length > 1) {
                navigate(path);
            }
        }
    }, [navigate]);
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/*", element: _jsx(Suspense, Object.assign({ fallback: _jsx("div", { children: "Loading..." }) }, { children: _jsx(App, {}) })) }), _jsx(Route, { path: "/guide/*", element: _jsx(Suspense, Object.assign({ fallback: _jsx("div", { children: "Loading..." }) }, { children: _jsx(Guide, {}) })) })] }));
}
