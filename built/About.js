import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Link } from 'react-router-dom';
export default function AboutButton() {
    const [open, setOpen] = React.useState(false);
    const toggleOpen = () => {
        setOpen(!open);
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", Object.assign({ onClick: toggleOpen, className: "textButton" }, { children: "About" })), open && _jsx(About, { openToggle: toggleOpen })] }));
}
function About({ openToggle }) {
    return (_jsxs("div", Object.assign({ className: "dialog" }, { children: [_jsx("button", Object.assign({ onClick: openToggle }, { children: "X" })), _jsx("h1", { children: "About" }), "Celestiary is a cosmological simulator.", _jsx("h2", { children: "News" }), _jsxs("ul", { children: [_jsx("li", { children: "2021 Dec 30 - Introduce esbuild with code splitting.  Use react and react-router to improve code structure and prepare for better permalinks." }), _jsx("li", { children: "2021 Jan 25 - Works in Safari 13.1.2+ on OSX, maybe earlier. Now all major browsers tested except IE." })] }), _jsx("h2", { children: "Features" }), _jsxs("ul", { children: [_jsx("li", { children: "Keplerian orbits (6 orbital elements)" }), _jsx("li", { children: "Time controls, to alter rate and direction of time" }), _jsx("li", { children: "Star colors based on surface temperatures" }), _jsx("li", { children: "Star surface dynamics simulation (Perlin noise in black-body spectra)" }), _jsx("li", { children: "9 planets, 20 moons" }), _jsx("li", { children: "Permanent links for scene locations" }), _jsx("li", { children: "Even kinda works on mobile! :)" })] }), _jsx("h2", { children: "Datasets" }), _jsxs("ul", { children: [_jsx("li", { children: "~100,000 stars" }), _jsx("li", { children: "~3k star names" }), _jsx("li", { children: "~80 Asterisms/constellations" })] }), _jsx("h2", { children: "Learn more" }), _jsxs("ul", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "/guide" }, { children: "Software development guide" })) }), _jsx("li", { children: _jsx("a", Object.assign({ href: "https://github.com/pablo-mayrgundter/celestiary", target: "_blank", rel: "noreferrer" }, { children: "Source code (GitHub)" })) })] })] })));
}
