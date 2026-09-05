import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LOG_PREFIX = '[MacOS-launchpad]';
const ICON_SIZE = 64;
const CELL_WIDTH = ICON_SIZE + 20;
const CELL_HEIGHT = ICON_SIZE + 40;
const CELL_SPACING = 16;
const MIN_COLUMNS = 5;
const MAX_COLUMNS = 9;
const ANIMATION_TIME = 300;

// Optional background blur. Disabled by default.
// const BLUR_RADIUS = 40;
// const BLUR_BRIGHTNESS = 0.65;

// Launchpad panel size and animation settings.
const PANEL_WIDTH_FRACTION = 0.60;
const PANEL_HEIGHT_FRACTION = 0.80;
const PANEL_MAX_WIDTH = 820;
const PANEL_MAX_HEIGHT = 750;

export const LaunchpadView = GObject.registerClass(
    { Signals: { 'closed': {} } },
    class LaunchpadView extends St.Widget {
        _init() {
            super._init({
                name: 'macos-launchpad',
                style_class: 'launchpad-panel',
                // The panel itself is reactive so its chrome region receives input.
                
                // Its allocation matches the visible panel, not the whole monitor.
                
                
                
                reactive: true,
                clip_to_allocation: true,
                visible: false,
                opacity: 20,
            });

            // If enabled, blur affects the background behind the panel.
            
            
            // clip_to_allocation keeps the effect inside the panel allocation.
            //this._blurEffect = new Shell.BlurEffect({
            //    brightness: BLUR_BRIGHTNESS,
            //    radius: BLUR_RADIUS,
            //   mode: Shell.BlurMode.BACKGROUND,
            //});
            //this.add_effect(this._blurEffect);

            this.isOpen = false;
            this._appButtons = [];
            this._chromeAdded = false;

            // Register the panel in top chrome only while it is open.
            // Keeping it registered while hidden could interfere with input.
            
            
            
            
            
            this._resize();
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this._resize());

            // Never leave Launchpad open underneath GNOME Overview.
            
            
            
            
            this._overviewShowingId = Main.overview.connect('showing', () => {
                if (this.isOpen) {
                    console.log(`${LOG_PREFIX} Overview is showing — force-closing Launchpad`);
                    this.close();
                }
            });

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
                hint_text: 'Type to find apps...',
                can_focus: true,
            });
            this._searchEntry.clutter_text.connect(
                'text-changed', this._onSearchChanged.bind(this));
            this._searchEntry.clutter_text.connect('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._topBar.add_child(this._searchEntry);

            const rightSpacer = new St.Widget({ x_expand: true });
            this._topBar.add_child(rightSpacer);

            this._scrollView = new St.ScrollView({
                style_class: 'launchpad-scroll',
                x_expand: true,
                y_expand: false,
                overlay_scrollbars: true,
                clip_to_allocation: true,
            });
            this._content.add_child(this._scrollView);

            // Viewport clips the visible area of the scrollable content.
            // Content may be taller than the viewport and is scrolled inside it.
            this._viewport = new St.Viewport({
                clip_to_view: true,
                x_expand: true,
                y_expand: true,
            });

            this._rowsBox = new St.BoxLayout({
                style_class: 'launchpad-rows',
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: false,
            });

            this._viewport.add_child(this._rowsBox);
            this._scrollView.set_child(this._viewport);
            this._updateScrollViewHeight();

            this.connect('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    console.log(`${LOG_PREFIX} CLOSE PATH: Escape (key-press-event on panel)`);
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _updateScrollViewHeight() {
            if (!this._scrollView || !this.height)
                return;

            // Match the panel CSS so the scroll area fills the remaining height.
            // The top bar is 36px tall, so the ScrollView gets the remaining
            // area instead of expanding to the height requested by its content.
            const scrollHeight = Math.max(1, this.height - 24 - 32 - 20 - 36);
            this._scrollView.set_height(scrollHeight);
        }

        _resize() {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor)
                return;

            const width = Math.min(PANEL_MAX_WIDTH, monitor.width * PANEL_WIDTH_FRACTION);
            const height = Math.min(PANEL_MAX_HEIGHT, monitor.height * PANEL_HEIGHT_FRACTION);

            this.set_size(width, height);
            this._updateScrollViewHeight();
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
        
            const rowCount = Math.ceil(apps.length / columns);
            const rowSpacing = 24;
            const verticalPadding = 16;
            const contentHeight = rowCount > 0
                ? rowCount * CELL_HEIGHT + (rowCount - 1) * rowSpacing + verticalPadding
                : verticalPadding;

            // Give the rows container its real content height so the viewport can scroll it.
            
            
            this._rowsBox.set_height(contentHeight);
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

        open() {
            if (this.isOpen)
                return;
            console.log(`${LOG_PREFIX} view.open()`);

            this.isOpen = true;

            if (!this._chromeAdded) {
                Main.layoutManager.addTopChrome(this, {
                    trackFullscreen: true,
                });
                this._chromeAdded = true;
                console.log(`${LOG_PREFIX} addTopChrome — chrome registered`);
            }

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

            // Do not use Main.pushModal: it would block input outside the panel.
            
            
            // Listen at stage level so Escape can close the panel without a modal grab.
            
            
            
            this._stageCaptureId = global.stage.connect('captured-event',
                (actor, event) => {
                    if (event.type() === Clutter.EventType.KEY_PRESS &&
                        event.get_key_symbol() === Clutter.KEY_Escape) {
                        this.close();
                        return Clutter.EVENT_STOP;
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
            if (!this.isOpen)
                return;

            try {
                this.isOpen = false;

                if (this._stageCaptureId) {
                    global.stage.disconnect(this._stageCaptureId);
                    this._stageCaptureId = null;
                }

                if (Main.overview.visible)
                    Main.overview.hide();

                this.ease({
                    opacity: 0,
                    scale_x: 0.9,
                    scale_y: 0.9,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        this.visible = false;
                        if (this._chromeAdded) {
                            Main.layoutManager.removeChrome(this);
                            this._chromeAdded = false;
                            }
                        this.emit('closed');
                    },
                });
            } catch (e) {
                console.error(`${LOG_PREFIX} FAILED inside close(): ${e}\n${e.stack}`);
            }
        }

        destroy() {
            if (this._chromeAdded) {
                Main.layoutManager.removeChrome(this);
                this._chromeAdded = false;
            }
            if (this._monitorsChangedId) {
                Main.layoutManager.disconnect(this._monitorsChangedId);
                this._monitorsChangedId = null;
            }
            if (this._overviewShowingId) {
                Main.overview.disconnect(this._overviewShowingId);
                this._overviewShowingId = null;
            }
            if (this._stageCaptureId) {
                global.stage.disconnect(this._stageCaptureId);
                this._stageCaptureId = null;
            }
            super.destroy();
        }
    }
);
