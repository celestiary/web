import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
function updateTimeMsg(time) {
    let msg = '';
    if (time.timeScale == 1) {
        msg = 'real-time';
    }
    else {
        msg = time.timeScale.toLocaleString() + ' secs/s';
    }
    if (time.pause) {
        msg += ' (paused)';
    }
    return msg;
}
export default function TimePanel({ time, timeStr }) {
    const [timeScale, setTimeScale] = React.useState('');
    React.useEffect(() => {
        setTimeScale(updateTimeMsg(time));
    }, [timeStr]); // TODO: shouldn't depend on this to set time-scale.
    return (_jsxs("div", Object.assign({ id: "time-id" }, { children: [_jsx("div", Object.assign({ id: "date-id" }, { children: timeStr })), _jsx("div", Object.assign({ id: "time-scale-id" }, { children: timeScale })), _jsxs("div", Object.assign({ id: "time-controls-id" }, { children: [_jsx("button", Object.assign({ onClick: () => {
                            time.changeTimeScale(1);
                        } }, { children: "+" })), _jsx("button", Object.assign({ onClick: () => {
                            time.changeTimeScale(-1);
                        } }, { children: "-" })), _jsx("button", Object.assign({ onClick: () => {
                            time.changeTimeScale(0);
                        } }, { children: "=" })), _jsx("button", Object.assign({ onClick: () => {
                            time.invertTimeScale();
                        } }, { children: "/" }))] }))] })));
}
