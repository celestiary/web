System.register("index", ["react", "react-dom/client", "react-router-dom", "./Routed"], function (exports_1, context_1) {
    "use strict";
    var react_1, client_1, react_router_dom_1, Routed_1, root;
    var __moduleName = context_1 && context_1.id;
    return {
        setters: [
            function (react_1_1) {
                react_1 = react_1_1;
            },
            function (client_1_1) {
                client_1 = client_1_1;
            },
            function (react_router_dom_1_1) {
                react_router_dom_1 = react_router_dom_1_1;
            },
            function (Routed_1_1) {
                Routed_1 = Routed_1_1;
            }
        ],
        execute: function () {
            root = client_1.createRoot(document.getElementById('root'));
            root.render(<react_router_dom_1.BrowserRouter>
      <Routed_1["default"] />
    </react_router_dom_1.BrowserRouter>);
        }
    };
});
