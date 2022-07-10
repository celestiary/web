import React from 'react';
export default function HelpButton({ keys }) {
    const [open, setOpen] = React.useState(false);
    const toggleOpen = () => {
        setOpen(!open);
    };
    keys.map('?', toggleOpen, 'Show/hide keyboard shortcuts');
    return (<>
      <button onClick={toggleOpen} className="textButton">Help</button>
      {open && <Help keys={keys} openToggle={toggleOpen}/>}
    </>);
}
function Help({ keys, openToggle }) {
    const item = (ndx, keyStr, msg) => {
        return (<li key={ndx}><span>{keyStr}</span>{msg}</li>);
    };
    const items = [];
    for (const i in keys.keymap) {
        items.push(item(i, i == ' ' ? 'space' : i, keys.msgs[i]));
    }
    return (<div id="help" className="dialog">
      <button onClick={openToggle}>X</button>
      <h1>Keyboard Shortcuts</h1>
      Controls:
      <ul>{items}</ul>
    </div>);
}
