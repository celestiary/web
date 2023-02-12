import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import cMeasure from '@pablo-mayrgundter/measure.js';
import { elt, newElt } from '../utils.js';
export default function Measure() {
    React.useEffect(() => {
        setup();
    }, []);
    return (_jsxs("div", Object.assign({ style: { maxWidth: '800px' } }, { children: [_jsx("h1", { children: "Measure" }), _jsxs("p", { children: ["Working with astronomical data will quickly break ur brain if you don't have an easy way to work with units and mangitudes. I wrote the ", _jsx("a", Object.assign({ href: "https://github.com/pablo-mayrgundter/measure.js" }, { children: "measure.js" })), " library to help with this."] }), _jsx("table", Object.assign({ cellPadding: "5em", cellSpacing: "5" }, { children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("th", { children: "Data string" }), _jsx("th", { children: "Parsed Measure toString" }), _jsx("th", { children: "toKilo" })] }), _jsx("tr", { children: _jsx("td", Object.assign({ id: "mass1" }, { children: "1.9891E33 g" })) }), _jsx("tr", { children: _jsx("td", Object.assign({ id: "mass2" }, { children: "1.9891E33 kg" })) }), _jsx("tr", { children: _jsx("td", Object.assign({ id: "radius" }, { children: "6.9424895E8 m" })) })] }) }))] })));
}
function setup() {
    const parse = (elt) => {
        const origText = elt.innerHTML;
        const measure = cMeasure.parse(elt.innerHTML);
        const asKilo = measure.convertTo(cMeasure.Magnitude.KILO);
        const p = elt.parentNode;
        p.appendChild(newElt('td', measure));
        p.appendChild(newElt('td', asKilo));
    };
    parse(elt('mass1'));
    parse(elt('mass2'));
    parse(elt('radius'));
}
