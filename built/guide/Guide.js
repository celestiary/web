import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Routes, Route, Link, Outlet, useLocation } from 'react-router-dom';
import Angles from './Angles';
import Asterisms from './Asterisms';
import Atmosphere from './Atmosphere';
import Cube from './Cube';
import Galaxy from './Galaxy';
import Grid from './Grid';
import Labels from './Labels';
import Loader from './Loader';
import Measure from './Measure';
import Orbit from './Orbit';
import Picking from './Picking';
import Planet from './Planet';
import SaturnEarth from './SaturnEarth';
import Star from './Star';
import Stars from './Stars';
import Welcome from './Welcome';
import { setTitleFromLocation } from '../utils.js';
// import Map from './Map'
// import SphereMap from './SphereMap'
// import Wind from './Wind'
// import StarsPicking from './StarsPicking'
// import Asteroids from './Asteroids'
import './index.css';
export default function Guide() {
    const location = useLocation();
    React.useEffect(() => {
        setTitleFromLocation(location, 'Guide');
    }, [location]);
    return (_jsx(_Fragment, { children: _jsx("table", Object.assign({ id: "nav" }, { children: _jsx("tbody", { children: _jsxs("tr", { children: [_jsxs("td", Object.assign({ style: {
                                width: '15%',
                                overflowY: scroll,
                                verticalAlign: 'top',
                                padding: '0 1em',
                            } }, { children: [_jsx("h1", { children: "Guide" }), _jsx("p", { children: _jsx(Link, Object.assign({ to: "/" }, { children: "\u2190 Back" })) }), _jsxs("ol", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "" }, { children: "Welcome" })) }), _jsxs("li", { children: ["Data", _jsxs("ol", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "loader" }, { children: "Loader" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "measure" }, { children: "Measure" })) })] })] }), _jsxs("li", { children: ["Scene Objects", _jsx("ol", { children: _jsxs("li", { children: ["Basic Shapes", _jsxs("ul", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "cube" }, { children: "Cube" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "sphere" }, { children: "Sphere" })) })] })] }) })] }), _jsxs("li", { children: ["Decorators", _jsxs("ul", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "grid" }, { children: "Grid" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "labels" }, { children: "Labels" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "angles" }, { children: "Angles" })) })] })] }), _jsxs("li", { children: ["Interaction", _jsx("ul", { children: _jsx("li", { children: _jsx(Link, Object.assign({ to: "picking" }, { children: "Picking" })) }) })] }), _jsxs("li", { children: ["Celestial Bodies", _jsxs("ul", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "stars" }, { children: "Stars" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "star" }, { children: "Star" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "asterisms" }, { children: "Asterisms" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "planet" }, { children: "Planet" })) })] })] }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "atmosphere" }, { children: "Atmosphere" })) }), _jsxs("li", { children: ["Celestial Mechanics", _jsxs("ul", { children: [_jsx("li", { children: _jsx(Link, Object.assign({ to: "orbit" }, { children: "Orbit" })) }), _jsx("li", { children: _jsx(Link, Object.assign({ to: "galaxy" }, { children: "Gravity (galaxy)" })) })] })] }), _jsxs("li", { children: ["Fun", _jsx("ul", { children: _jsx("li", { children: _jsx(Link, Object.assign({ to: "saturn-earth" }, { children: "Earth, Saturn's moon" })) }) })] })] })] })), _jsxs("td", { children: [_jsx(Outlet, {}), _jsxs(Routes, { children: [_jsx(Route, { index: true, element: _jsx(Welcome, {}) }), _jsx(Route, { path: "angles", element: _jsx(Angles, {}) }), _jsx(Route, { path: "atmosphere", element: _jsx(Atmosphere, {}) }), _jsx(Route, { path: "cube", element: _jsx(Cube, {}) }), _jsx(Route, { path: "galaxy", element: _jsx(Galaxy, {}) }), _jsx(Route, { path: "grid", element: _jsx(Grid, {}) }), _jsx(Route, { path: "labels", element: _jsx(Labels, {}) }), _jsx(Route, { path: "loader", element: _jsx(Loader, {}) }), _jsx(Route, { path: "measure", element: _jsx(Measure, {}) }), _jsx(Route, { path: "orbit", element: _jsx(Orbit, {}) }), _jsx(Route, { path: "picking", element: _jsx(Picking, {}) }), _jsx(Route, { path: "saturn-earth", element: _jsx(SaturnEarth, {}) }), _jsx(Route, { path: "stars", element: _jsx(Stars, {}) }), _jsx(Route, { path: "star", element: _jsx(Star, {}) }), _jsx(Route, { path: "asterisms", element: _jsx(Asterisms, {}) }), _jsx(Route, { path: "planet", element: _jsx(Planet, {}) })] })] })] }) }) })) }));
}
