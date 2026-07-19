import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import { SourceFactory } from './sources.js';
import { RenderStrategyFactory } from './rendering.js';
import { GNOMEDisplayAdapter } from './display_adapter.js';
import { Randomizer } from './randomization.js';

export default class WallshuffleExtension extends Extension {
    enable() {
        this._timeoutId = null;
        this._isUpdating = false;
        
        // Tie state explicitly to the extension lifecycle
        this._cancellable = new Gio.Cancellable();
        this._randomizer = new Randomizer();
        this._httpSession = new Soup.Session();
        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
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
        // 1. Immediately kill any looping timers
        this._clearTimer();
        
        // 2. Abort any in-flight asynchronous operations (HTTP downloads, File writes)
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        
        // 3. Gracefully kill the networking session
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }

        // 4. Destroy the randomizer state
        if (this._randomizer) {
            this._randomizer.clear();
            this._randomizer = null;
        }

        // 5. Clean up settings hooks
        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }
        
        this._bgSettings = null;
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
            const displayAdapter = new GNOMEDisplayAdapter(global.display);
            const monitors = displayAdapter.getMonitors();
            const nMonitors = monitors.length;
            
            if (nMonitors === 0) return;

            const sourceStrategy = SourceFactory.getStrategy(
                this._settings, 
                this._randomizer, 
                this._httpSession, 
                this._cancellable
            );
            
            const useSameImage = this._settings.get_boolean('same-image-all-monitors');
            const requiredCount = (useSameImage && nMonitors > 1) ? 1 : nMonitors;

            const images = await sourceStrategy.getImages(requiredCount);
            
            // Safety check: Avoid writing to destroyed memory if extension disabled mid-download
            if (!this._settings || this._cancellable.is_cancelled()) return;
            if (images.length === 0) return;

            let globalBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };

            for (const mon of monitors) {
                const geom = mon.geom;
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

            this._bgSettings.set_string('picture-options', 'spanned');
            this._bgSettings.set_string('picture-uri', `file://${outPath}`);
            this._bgSettings.set_string('picture-uri-dark', `file://${outPath}`);

        } catch (e) {
            // Do not log errors if the crash was simply caused by the user disabling the extension
            if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                return;
            }
            console.error(`Wallshuffle: Fatal error during update - ${e.message}`);
        } finally {
            this._isUpdating = false;
        }
    }
}