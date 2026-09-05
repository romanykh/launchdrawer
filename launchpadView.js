import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LOG_PREFIX = '[macos-launchpad]';
const ICON_SIZE = 80;
const CELL_WIDTH = ICON_SIZE + 20;
const CELL_HEIGHT = ICON_SIZE + 40;
const CELL_SPACING = 16;
const MIN_COLUMNS = 5;
const MAX_COLUMNS = 9;
const ANIMATION_TIME = 300;

// Панель, а не весь екран: скільки місця на монітори вона займає.
const PANEL_WIDTH_FRACTION = 1;
const PANEL_HEIGHT_FRACTION = 0.80;
const PANEL_MAX_WIDTH = 1100;
const PANEL_MAX_HEIGHT = 750;

export const LaunchpadView = GObject.registerClass(
    { Signals: { 'closed': {} } },
    class LaunchpadView extends St.Widget {
        _init() {
            super._init({
                name: 'macos-launchpad',
                style_class: 'launchpad-panel',
                // Сам віджет НЕ реактивний як контейнер — реактивні лише
                // конкретні елементи всередині (кнопки, поле пошуку).
                // Важливо: розмір цього віджета = розмір видимої панелі,
                // а не всього екрана, тож і "вхідна зона" (input region),
                // яку GNOME виділяє під addChrome, теж дорівнює лише цій
                // панелі — решта екрана лишається прохідною для кліків.
                reactive: true,
                visible: false,
                opacity: 20,
            });

            this.isOpen = false;
            this._appButtons = [];

            Main.layoutManager.addChrome(this, {
                trackFullscreen: true,
            });
            this._resize();
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this._resize());

            this._content = new St.BoxLayout({
                style_class: 'launchpad-content',
                vertical: true,
                x_expand: true,
                y_expand: true,
            });
            this._content.set_pivot_point(0.5, 0.5);
            this.add_child(this._content);

            this._topBar = new St.BoxLayout({
                style_class: 'launchpad-topbar',
                x_expand: true,
            });
            this._content.add_child(this._topBar);

            const leftSpacer = new St.Widget({ x_expand: true });
            this._topBar.add_child(leftSpacer);

            this._searchEntry = new St.Entry({
                style_class: 'launchpad-search',
                hint_text: 'Пошук застосунків…',
                can_focus: true,
            });
            this._searchEntry.clutter_text.connect(
                'text-changed', this._onSearchChanged.bind(this));
            this._searchEntry.clutter_text.connect('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    console.log(`${LOG_PREFIX} CLOSE PATH: Escape in search entry`);
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._topBar.add_child(this._searchEntry);

            const rightSpacer = new St.Widget({ x_expand: true });
            this._topBar.add_child(rightSpacer);

            this._closeButton = new St.Button({
                style_class: 'launchpad-close-button',
                label: '✕',
                can_focus: true,
                reactive: true,
            });
            this._closeButton.connect('clicked', () => {
                console.log(`${LOG_PREFIX} CLOSE PATH: closeButton clicked`);
                this.close();
            });
            this._topBar.add_child(this._closeButton);

            this._scrollView = new St.ScrollView({
                style_class: 'launchpad-scroll',
                x_expand: true,
                y_expand: true,
                overlay_scrollbars: true,
            });
            this._content.add_child(this._scrollView);

            // Повертаємо _gridBin, але без y_expand: true, щоб скрол працював
            this._gridBin = new St.Bin({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                x_expand: false,
                y_expand: true, 
            });
            
            this._rowsBox = new St.BoxLayout({
                style_class: 'launchpad-rows',
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            
            // Передаємо rowsBox напряму в скрол
            this._scrollView.set_child(this._rowsBox);

            this.connect('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    console.log(`${LOG_PREFIX} CLOSE PATH: Escape (key-press-event on panel)`);
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _resize() {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor)
                return;

            const width = Math.min(PANEL_MAX_WIDTH, monitor.width * PANEL_WIDTH_FRACTION);
            const height = Math.min(PANEL_MAX_HEIGHT, monitor.height * PANEL_HEIGHT_FRACTION);

            this.set_size(width, height);
            this.set_position(
                monitor.x + (monitor.width - width) / 2,
                monitor.y + (monitor.height - height) / 2
            );
        }

        _computeColumns() {
            const availableWidth = this.width - 100;
            const cellFullWidth = CELL_WIDTH + CELL_SPACING;
            const fit = Math.floor(availableWidth / cellFullWidth);
            return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit));
        }

        _onSearchChanged() {
            const query = this._searchEntry.get_text().toLowerCase();
            for (const button of this._appButtons)
                button.visible = button._appName.toLowerCase().includes(query);
        }

        _populateGrid() {
            for (const row of this._rowsBox.get_children())
                row.destroy();
            this._appButtons = [];

            const appSystem = Shell.AppSystem.get_default();
            const apps = appSystem
                .get_installed()
                .filter(appInfo => {
                    try {
                        return appInfo.should_show() && appInfo.get_display_name();
                    } catch (e) {
                        return false;
                    }
                })
                .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

            const columns = this._computeColumns();
            console.log(`${LOG_PREFIX} found ${apps.length} apps, ${columns} columns`);

            let row = null;
            apps.forEach((appInfo, index) => {
                if (index % columns === 0) {
                    row = new St.BoxLayout({ style_class: 'launchpad-row' });
                    this._rowsBox.add_child(row);
                }
                const button = this._createAppButton(appInfo);
                this._appButtons.push(button);
                row.add_child(button);
            });
        
        // ДОДАЙТЕ ЦЕЙ РЯДОК: змушує скрол перерахувати висоту контенту
            this._rowsBox.queue_relayout();
        
        }
        
        

        _createAppButton(appInfo) {
            const icon = new St.Icon({
                gicon: appInfo.get_icon(),
                icon_size: ICON_SIZE,
            });

            const label = new St.Label({
                text: appInfo.get_display_name(),
                style_class: 'launchpad-app-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            label.set_width(CELL_WIDTH);

            const box = new St.BoxLayout({
                vertical: true,
                style_class: 'launchpad-app-box',
            });
            box.add_child(icon);
            box.add_child(label);

            const button = new St.Button({
                style_class: 'launchpad-app-button',
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
                child: box,
            });
            button._appName = appInfo.get_display_name();

            button.connect('clicked', () => {
                console.log(`${LOG_PREFIX} CLOSE PATH: app icon clicked ` +
                    `(${appInfo.get_display_name()})`);
                this.close();
                this._launchApp(appInfo);
            });

            return button;
        }

        _launchApp(appInfo) {
            try {
                const appSystem = Shell.AppSystem.get_default();
                const app = appSystem.lookup_app(appInfo.get_id());
                if (app)
                    app.activate();
                else
                    appInfo.launch([], null);
            } catch (e) {
                console.error(`${LOG_PREFIX} FAILED to launch app ` +
                    `${appInfo.get_id()}: ${e}\n${e.stack}`);
            }
        }

        _isPointInsidePanel(x, y) {
            const [px, py] = this.get_transformed_position();
            const [pw, ph] = this.get_transformed_size();
            return x >= px && x <= px + pw && y >= py && y <= py + ph;
        }

        open() {
            if (this.isOpen)
                return;
            console.log(`${LOG_PREFIX} view.open()`);

            this.isOpen = true;
            this._resize();

            if (Main.overview.visible) {
                console.log(`${LOG_PREFIX} Main.overview was visible — hiding it`);
                Main.overview.hide();
            }

            this._populateGrid();
            this._searchEntry.set_text('');

            this.visible = true;
            this.opacity = 0;
            this.scale_x = 0.9;
            this.scale_y = 0.9;
            this.set_pivot_point(0.5, 0.5);

            this._searchEntry.grab_key_focus();

            // Без Main.pushModal — свідомо. Модальний граб блокував би
            // ввід по всьому екрану, а нам, навпаки, треба, щоб клік поза
            // панеллю проходив далі, до застосунку/стільниці під ним.
            // Замість модального грабу — спостерігаємо на рівні сцени
            // (captured-event бачить усі події незалежно від грабу) і самі
            // вирішуємо, коли закритись, не заважаючи звичайній доставці
            // події тому, кому вона насправді призначена.
            this._stageCaptureId = global.stage.connect('captured-event',
                (actor, event) => {
                    if (event.type() === Clutter.EventType.KEY_PRESS &&
                        event.get_key_symbol() === Clutter.KEY_Escape) {
                        console.log(`${LOG_PREFIX} CLOSE PATH: Escape (stage captured-event)`);
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                    if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                        const [x, y] = event.get_coords();
                        if (!this._isPointInsidePanel(x, y)) {
                            console.log(`${LOG_PREFIX} CLOSE PATH: click outside panel ` +
                                `(${x.toFixed(0)}, ${y.toFixed(0)}) -> close(), ` +
                                'letting click pass through');
                            this.close();
                        }
                        // Пропускаємо подію далі в будь-якому разі — саме
                        // так клік реально "проходить" до застосунку/
                        // стільниці під панеллю.
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

            this.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        close() {
            console.log(`${LOG_PREFIX} close() called, isOpen=${this.isOpen}`);
            if (!this.isOpen) {
                console.log(`${LOG_PREFIX} close() early-return, already closed`);
                return;
            }

            try {
                this.isOpen = false;

                if (this._stageCaptureId) {
                    global.stage.disconnect(this._stageCaptureId);
                    this._stageCaptureId = null;
                }

                if (Main.overview.visible) {
                    console.log(`${LOG_PREFIX} Main.overview still visible on close — hiding it`);
                    Main.overview.hide();
                }

                this.ease({
                    opacity: 0,
                    scale_x: 0.9,
                    scale_y: 0.9,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        this.visible = false;
                        this.emit('closed');
                        console.log(`${LOG_PREFIX} close() animation complete, visible=false`);
                    },
                });
                console.log(`${LOG_PREFIX} close() finished setting up animation`);
            } catch (e) {
                console.error(`${LOG_PREFIX} FAILED inside close(): ${e}\n${e.stack}`);
            }
        }

        destroy() {
            if (this._monitorsChangedId) {
                Main.layoutManager.disconnect(this._monitorsChangedId);
                this._monitorsChangedId = null;
            }
            if (this._stageCaptureId) {
                global.stage.disconnect(this._stageCaptureId);
                this._stageCaptureId = null;
            }
            super.destroy();
        }
    }
);
