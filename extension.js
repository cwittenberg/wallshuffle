import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import { SourceFactory } from './sources.js';
import { RenderStrategyFactory } from './rendering.js';

export default class WallshuffleExtension extends Extension {
    enable() {
        this._timeoutId = null;
        this._isUpdating = false;
        this._settings = this.getSettings();

        this._settings.connectObject(
            'changed::randomize', () => {
                this._reschedule();
                this._updateBackground();
            },
            'changed::same-image-all-monitors', () => this._updateBackground(),
            'changed::interval', () => this._reschedule(),
            'changed::source-type', () => this._updateBackground(),
            'changed::folder', () => {
                if (this._settings.get_string('source-type') === 'folder') {
                    this._updateBackground();
                }
            },
            'changed::monitor-settings', () => this._updateBackground(),
            'changed::monitor-images', () => this._updateBackground(),
            this
        );

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._updateBackground(),
            this
        );

        this._updateBackground();
        this._reschedule();
    }

    disable() {
        this._clearTimer();
        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }
        Main.layoutManager.disconnectObject(this);
    }

    _clearTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _reschedule() {
        this._clearTimer();
        
        // If randomization is off, we are in static mode. Do not waste CPU cycling on a timer.
        const isRandom = this._settings.get_boolean('randomize');
        const intervalMins = this._settings.get_int('interval');
        
        if (isRandom && intervalMins > 0) {
            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                intervalMins * 60,
                () => {
                    this._updateBackground();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    async _updateBackground() {
        if (this._isUpdating) return;
        this._isUpdating = true;

        try {
            const nMonitors = global.display.get_n_monitors();
            if (nMonitors === 0) return;

            const sourceStrategy = SourceFactory.getStrategy(this._settings);
            
            // If the user wants the same image on all monitors, we only request 1 image.
            const useSameImage = this._settings.get_boolean('same-image-all-monitors');
            const requiredCount = (useSameImage && nMonitors > 1) ? 1 : nMonitors;

            const images = await sourceStrategy.getImages(requiredCount);
            if (images.length === 0) return;

            let globalBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
            let monitors = [];

            for (let i = 0; i < nMonitors; i++) {
                const geom = global.display.get_monitor_geometry(i);
                monitors.push({ index: i, geom: geom });
                if (geom.x < globalBox.minX) globalBox.minX = geom.x;
                if (geom.y < globalBox.minY) globalBox.minY = geom.y;
                if (geom.x + geom.width > globalBox.maxX) globalBox.maxX = geom.x + geom.width;
                if (geom.y + geom.height > globalBox.maxY) globalBox.maxY = geom.y + geom.height;
            }

            globalBox.w = globalBox.maxX - globalBox.minX;
            globalBox.h = globalBox.maxY - globalBox.minY;

            if (globalBox.w <= 0 || globalBox.h <= 0) return;

            const dest = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, globalBox.w, globalBox.h);
            dest.fill(0x000000FF);

            let perMonitorSettings = {};
            try {
                perMonitorSettings = JSON.parse(this._settings.get_string('monitor-settings'));
            } catch (e) {
                perMonitorSettings = {};
            }

            for (let i = 0; i < monitors.length; i++) {
                const mon = monitors[i];
                // Loop around the returned images array. If requiredCount was 1, all monitors get index 0.
                const imgPath = images[i % images.length];

                let src;
                try {
                    src = GdkPixbuf.Pixbuf.new_from_file(imgPath);
                } catch (e) {
                    console.error(`Wallshuffle: Failed to load ${imgPath}`);
                    continue;
                }

                const mode = perMonitorSettings[mon.index] || 'zoom';
                const renderStrategy = RenderStrategyFactory.getStrategy(mode);
                const monBox = {
                    w: mon.geom.width,
                    h: mon.geom.height,
                    targetX: mon.geom.x - globalBox.minX,
                    targetY: mon.geom.y - globalBox.minY
                };

                try {
                    renderStrategy.render(dest, src, monBox, globalBox);
                } catch (e) {
                    console.error(`Wallshuffle: Render error for monitor ${mon.index} - ${e.message}`);
                }
            }

            const outDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wallshuffle']);
            GLib.mkdir_with_parents(outDir, 0o755);
            const outPath = GLib.build_filenamev([outDir, 'spanned-bg.jpg']);

            dest.savev(outPath, 'jpeg', ['quality'], ['100']);

            const bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
            bgSettings.set_string('picture-options', 'spanned');
            bgSettings.set_string('picture-uri', `file://${outPath}`);
            bgSettings.set_string('picture-uri-dark', `file://${outPath}`);

        } catch (e) {
            console.error(`Wallshuffle: Fatal error during update - ${e.message}`);
        } finally {
            this._isUpdating = false;
        }
    }
}