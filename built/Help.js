import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
export default function HelpButton({ keys }) {
    const [open, setOpen] = React.useState(false);
    const toggleOpen = () => {
        setOpen(!open);
    };
    keys.map('?', toggleOpen, 'Show/hide keyboard shortcuts');
    return (_jsxs(_Fragment, { children: [_jsx("button", Object.assign({ onClick: toggleOpen, className: "textButton" }, { children: "Help" })), open && _jsx(Help, { keys: keys, openToggle: toggleOpen })] }));
}
function Help({ keys, openToggle }) {
    const item = (ndx, keyStr, msg) => {
        return (_jsxs("li", { children: [_jsx("span", { children: keyStr }), msg] }, ndx));
    };
    const items = [];
    for (const i in keys.keymap) {
        items.push(item(i, i == ' ' ? 'space' : i, keys.msgs[i]));
    }
    return (_jsxs("div", Object.assign({ id: "help", className: "dialog" }, { children: [_jsx("button", Object.assign({ onClick: openToggle }, { children: "X" })), _jsx("h1", { children: "Keyboard Shortcuts" }), "Controls:", _jsx("ul", { children: items })] })));
}
