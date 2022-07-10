"use strict";
exports.__esModule = true;
var react_1 = require("react");
var react_dom_1 = require("react-dom");
var react_router_dom_1 = require("react-router-dom");
var Routed_1 = require("./Routed");
(0, react_dom_1.render)(<react_router_dom_1.BrowserRouter>
      <Routed_1["default"] />
    </react_router_dom_1.BrowserRouter>, document.getElementById('root'));
