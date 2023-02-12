import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { AxesHelper } from 'three';
import { Pane } from 'tweakpane';
import cGalaxy from '../Galaxy';
import Keys from '../Keys';
import SpriteSheet from '../SpriteSheet';
import ThreeUi from '../ThreeUI';
import HelpButton from '../Help';
import { elt } from '../utils';
export default function Galaxy() {
    const [keys, setKeys] = React.useState(null);
    React.useEffect(() => {
        setup({ setKeys: setKeys });
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { id: "ui" }), _jsx("div", { id: "info" }), _jsx("h1", { children: "Galaxy" }), "Gravity particle system.  Work in progress.", _jsxs("div", Object.assign({ style: { width: '50%', margin: '1em auto', align: 'center' } }, { children: [_jsx("button", Object.assign({ id: "step" }, { children: "Step" })), _jsx("button", Object.assign({ id: "play" }, { children: "Play" }))] })), keys && _jsx(HelpButton, { keys: keys })] }));
}
function setup({ setKeys }) {
    const uiContainer = elt('ui');
    const ui = new ThreeUi(uiContainer);
    ui.camera.position.z = 10;
    ui.camera.position.y = 3;
    const galaxy = new cGalaxy({ numStars: 500 });
    ui.scene.add(galaxy);
    ui.scene.add(new AxesHelper);
    let labels;
    if (true) {
        const labelSheet = new SpriteSheet(galaxy.numStars, galaxy.numStars + '', '13px arial', [0, 0.1]);
        for (let i = 0; i < labelSheet.maxLabels; i++) {
            labelSheet.add(0, 0, 0, i + '');
        }
        labels = labelSheet.compile(galaxy.geometry.getAttribute('position'));
        labels.visible = false;
        ui.scene.add(labels);
    }
    // ui.fs.makeFullscreen();
    const pane = new Pane({ container: uiContainer, expanded: true, title: 'Performance' });
    const perf = { time: 0, fps: 0 };
    pane.addMonitor(perf, 'time', { label: 'render (ms)', min: 0, max: 100 });
    pane.addMonitor(perf, 'fps', { label: 'fps', min: 0, max: 100 });
    pane.addMonitor(perf, 'fps', { label: '', view: 'graph', min: 0, max: 1000 });
    let debug = false;
    const anim = () => {
        perf.time = new Date().getTime();
        galaxy.animate(debug);
        perf.time = new Date().getTime() - perf.time;
        perf.fps = 1000 / perf.time;
    };
    const playButton = elt('play');
    function togglePlay() {
        if (ui.animationCb) { // Is playing
            ui.animationCb = null;
            playButton.innerText = 'Play';
            debug = true;
        }
        else { // Is paused
            ui.animationCb = anim;
            playButton.innerText = 'Pause';
            debug = false;
        }
    }
    elt('step').onclick = anim;
    playButton.onclick = togglePlay;
    const keys = new Keys();
    keys.map(' ', () => {
        togglePlay();
    }, 'Toggle play/pause');
    if (labels) {
        keys.map('l', () => {
            labels.visible = !labels.visible;
        }, 'Toggle label display');
    }
    setKeys(keys);
}
