import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LaunchpadView } from './launchpadView.js';

const LOG_PREFIX = '[macos-launchpad]';

export default class LaunchpadExtension extends Extension {
    enable() {
        console.log(`${LOG_PREFIX} enable() called`);

        this._settings = this.getSettings();
        this._view = null;
        this._gestureActive = false;
        this._gestureFingers = 0;

        this._capturedEventId = global.stage.connect(
            'captured-event',
            this._onCapturedEvent.bind(this)
        );

        try {
            Main.wm.addKeybinding(
                'toggle-keybinding',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => {
                    console.log(`${LOG_PREFIX} keybinding triggered`);
                    this._toggle();
                }
            );
            console.log(`${LOG_PREFIX} keybinding registered: ` +
                this._settings.get_strv('toggle-keybinding'));
        } catch (e) {
            console.error(`${LOG_PREFIX} FAILED to register keybinding: ${e}\n${e.stack}`);
        }

        console.log(`${LOG_PREFIX} enable() finished`);
    }

    disable() {
        console.log(`${LOG_PREFIX} disable() called`);

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }

        try {
            Main.wm.removeKeybinding('toggle-keybinding');
        } catch (e) {
            console.error(`${LOG_PREFIX} error removing keybinding: ${e}`);
        }

        if (this._view) {
            this._view.destroy();
            this._view = null;
        }

        this._settings = null;
    }

    _ensureView() {
        if (!this._view) {
            console.log(`${LOG_PREFIX} creating LaunchpadView`);
            try {
                this._view = new LaunchpadView();
            } catch (e) {
                console.error(`${LOG_PREFIX} FAILED to create LaunchpadView: ${e}\n${e.stack}`);
                throw e;
            }
        }
        return this._view;
    }

    _toggle() {
        try {
            const view = this._ensureView();
            console.log(`${LOG_PREFIX} _toggle(), isOpen=${view.isOpen}`);
            if (view.isOpen)
                view.close();
            else
                view.open();
        } catch (e) {
            console.error(`${LOG_PREFIX} FAILED in _toggle(): ${e}\n${e.stack}`);
        }
    }

    _onCapturedEvent(actor, event) {
        try {
            if (event.type() !== Clutter.EventType.TOUCHPAD_PINCH)
                return Clutter.EVENT_PROPAGATE;

            if (typeof event.get_gesture_phase !== 'function') {
                console.error(`${LOG_PREFIX} event.get_gesture_phase is not available ` +
                    'on this GNOME/Clutter version — pinch detection cannot work here.');
                return Clutter.EVENT_PROPAGATE;
            }

            const phase = event.get_gesture_phase();
            const scale = typeof event.get_gesture_pinch_scale === 'function'
                ? event.get_gesture_pinch_scale() : 1.0;
            const fingers = typeof event.get_touchpad_gesture_finger_count === 'function'
                ? event.get_touchpad_gesture_finger_count() : -1;

            if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
                console.log(`${LOG_PREFIX} pinch BEGIN fingers=${fingers}`);

                // Launchpad: 3 or 4 fingers only. Two-finger pinches are
                // deliberately ignored and left to GNOME's normal gestures.
                this._gestureFingers = fingers;
                this._gestureActive = fingers === 3 || fingers === 4;

                if (Main.overview.visible) {
                    this._gestureActive = false;
                    this._gestureFingers = 0;
                    console.log(`${LOG_PREFIX} pinch ignored while Overview is visible`);
                }
            }

            if (!this._gestureActive)
                return Clutter.EVENT_PROPAGATE;

            if (phase === Clutter.TouchpadGesturePhase.UPDATE) {
            
                if (Main.overview.visible || Main.overview.visibleTarget) {
                    console.log(`${LOG_PREFIX} pinch aborted mid-gesture — ` +
                        'Overview became visible');
                    this._gestureActive = false;
                    return Clutter.EVENT_PROPAGATE;
                }

                console.log(`${LOG_PREFIX} pinch UPDATE scale=${scale.toFixed(2)}`);
                const view = this._ensureView();

                if (!view.isOpen && scale <= this._settings.get_double('pinch-in-threshold')) {
                    console.log(`${LOG_PREFIX} threshold crossed -> open()`);
                    view.open();
                    this._gestureActive = false;
                } else if (view.isOpen && scale >= this._settings.get_double('pinch-out-threshold')) {
                    console.log(`${LOG_PREFIX} threshold crossed -> close()`);
                    view.close();
                    this._gestureActive = false;
                }
                return Clutter.EVENT_STOP;
            }

            if (phase === Clutter.TouchpadGesturePhase.END ||
                phase === Clutter.TouchpadGesturePhase.CANCEL) {
                console.log(`${LOG_PREFIX} pinch END/CANCEL fingers=${this._gestureFingers}`);
                this._gestureActive = false;
                this._gestureFingers = 0;
            }
        } catch (e) {
            console.error(`${LOG_PREFIX} FAILED in _onCapturedEvent(): ${e}\n${e.stack}`);
        }

        return Clutter.EVENT_PROPAGATE;
    }
}
