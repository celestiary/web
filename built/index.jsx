"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const react_dom_1 = require("react-dom");
const react_router_dom_1 = require("react-router-dom");
const Routed_1 = __importDefault(require("./Routed"));
(0, react_dom_1.render)(<react_router_dom_1.BrowserRouter>
      <Routed_1.default />
    </react_router_dom_1.BrowserRouter>, document.getElementById('root'));
