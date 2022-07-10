import React from 'react';
import { useLocation } from 'react-router-dom';
import cLoader from '../Loader.js';
import * as Collapsor from '../collapsor.js';
import { elt } from '../utils.js';
export default function Loader() {
    const location = useLocation();
    React.useEffect(() => {
        setup(location.hash.substr(1) || 'sun/earth/moon');
    }, [location]);
    return (<>
      <h1>Loader</h1>

      <p>The loader fetches a json object at a path, e.g. 'sun/earth/moon'.
        Each path part is passed to an onLoad callback, and an onDone callback
        is called after the final object is loaded.</p>

      <p>Here is the loaded Moon object, displayed with the collapsor.js utility:</p>

      <div id="done-id"></div>
    </>);
}
function setup(path) {
    const onLoadCb = (name, obj) => { };
    const onDoneCb = (name, obj) => {
        const doneElt = elt('done-id');
        doneElt.innerHTML = JSON.stringify(obj)
            .replace(/{/g, '<ul><li>')
            .replace(/}/g, '</li></ul>')
            .replace(/\[/g, '<ol><li>')
            .replace(/\]/g, '</li></ol>')
            .replace(/,/g, '</li><li>')
            .replace(/<li><\/li>/g, '');
        window.collapse = Collapsor.collapse;
        Collapsor.makeCollapsable(doneElt);
    };
    new cLoader().loadPath(path, onLoadCb, onDoneCb);
}
