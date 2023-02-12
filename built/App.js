import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { useLocation } from 'react-router-dom';
import AboutButton from './About';
import Celestiary from './Celestiary';
import HelpButton from './Help';
import TimePanel from './TimePanel';
import { elt, setTitleFromLocation } from './utils';
import './index.css';
export default function App() {
    const location = useLocation();
    React.useEffect(() => {
        setTitleFromLocation(location);
    }, [location]);
    const [celestiary, setCelestiary] = React.useState(null);
    const [timeStr, setTimeStr] = React.useState('');
    const [showAbout, setShowAbout] = React.useState(false);
    React.useEffect(() => {
        setCelestiary(new Celestiary(elt('scene-id'), elt('nav-id'), setTimeStr));
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "scene-id" }), _jsx("div", Object.assign({ id: "nav-id", className: "panel" }, { children: "Welcome to Celestiary!  Loading..." })), _jsxs("div", Object.assign({ id: "top-right", className: "panel" }, { children: [celestiary && _jsx(TimePanel, { time: celestiary.time, timeStr: timeStr }), _jsxs("div", Object.assign({ id: "text-buttons" }, { children: [celestiary && _jsx(HelpButton, { keys: celestiary.keys }), _jsx(AboutButton, {})] }))] })), _jsx("h1", { id: "target-id" })] }));
}
