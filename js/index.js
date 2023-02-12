"use strict";
exports.__esModule = true;
var react_1 = require("react");
var client_1 = require("react-dom/client");
var react_router_dom_1 = require("react-router-dom");
var Routed_1 = require("./Routed");
var root = (0, client_1.createRoot)(document.getElementById('root'));
root.render(<react_router_dom_1.BrowserRouter>
      <Routed_1["default"] />
    </react_router_dom_1.BrowserRouter>);
