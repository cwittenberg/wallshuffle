import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import GdkPixbuf from 'gi://GdkPixbuf';
import { SourceFactory } from './sources.js';
import { RenderStrategyFactory } from './rendering.js';
import { Randomizer } from './randomization.js';

export default class WallshuffleExtension extends Extension {
    enable() {
        this._timeoutId = null;
        this._isUpdating = false;
        this._queuedUpdate = false;
        this._queuedReloadImages = false;
        this._updateGeneration = 0;
        this._updateCancellable = null;
        this._currentImages = [];
        this._settingsChangedId = null;
        this._monitorsChangedId = null;
        
        // Tie state explicitly to the extension lifecycle
        this._cancellable = new Gio.Cancellable();
        this._randomizer = new Randomizer();
        this._httpSession = new Soup.Session();
        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
        this._settings = this.getSettings();

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'randomize' || key === 'interval') {
                this._reschedule();
            }

            const reloadImages = !['interval', 'same-image-all-monitors', 'monitor-settings'].includes(key);
            const invalidateImages = ['randomize', 'source-type', 'folder', 'monitor-images'].includes(key);

            this._requestBackgroundUpdate(reloadImages, invalidateImages);
        });

        // GSettings only emits "changed" for keys read after the handler was connected.
        for (const key of ['randomize', 'same-image-all-monitors', 'interval', 'source-type', 'folder', 'monitor-settings', 'monitor-images']) {
            this._settings.get_value(key);
        }

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => this._requestBackgroundUpdate());

        this._requestBackgroundUpdate();
        this._reschedule();
    }

    disable() {
        // 1. Immediately kill any looping timers
        this._clearTimer();
        
        // 2. Abort any in-flight asynchronous operations (HTTP downloads, File writes)
        if (this._updateCancellable) {
            this._updateCancellable.cancel();
            this._updateCancellable = null;
        }

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

        this._currentImages = [];

        // 5. Clean up settings hooks
        if (this._settings) {
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = null;
            }
            if (this._monitorsChangedId) {
                Main.layoutManager.disconnect(this._monitorsChangedId);
                this._monitorsChangedId = null;
            }
            this._settings = null;
        }
        
        this._bgSettings = null;
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
                    this._requestBackgroundUpdate();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    _requestBackgroundUpdate(reloadImages = true, invalidateImages = false) {
        if (!this._settings || !this._cancellable || this._cancellable.is_cancelled()) return;

        this._updateGeneration++;

        if (invalidateImages) {
            this._currentImages = [];
            this._randomizer.clear();
        }

        if (this._updateCancellable) {
            this._updateCancellable.cancel();
        }

        if (this._isUpdating) {
            this._queuedUpdate = true;
            this._queuedReloadImages ||= reloadImages;
            return;
        }

        this._updateBackground(reloadImages);
    }

    async _updateBackground(reloadImages = true) {
        if (this._isUpdating) {
            this._queuedUpdate = true;
            this._queuedReloadImages ||= reloadImages;
            return;
        }

        this._isUpdating = true;
        this._queuedUpdate = false;
        this._queuedReloadImages = false;

        const generation = this._updateGeneration;
        const updateCancellable = new Gio.Cancellable();
        this._updateCancellable = updateCancellable;

        try {
            const metaMonitors = Main.layoutManager.monitors;
            const monitors = [];
            for (let i = 0; i < metaMonitors.length; i++) {
                const geom = metaMonitors[i];
                monitors.push({
                    index: geom.index !== undefined ? geom.index : i,
                    geom: { x: geom.x, y: geom.y, width: geom.width, height: geom.height }
                });
            }
            
            const nMonitors = monitors.length;
            if (nMonitors === 0) return;

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

            const useSameImage = this._settings.get_boolean('same-image-all-monitors');
            const requiredCount = (useSameImage && nMonitors > 1) ? 1 : nMonitors;
            let images = [];
            
            if (!reloadImages && this._currentImages.length > 0) {
                images = useSameImage ? [this._currentImages[0]] : [...this._currentImages];
            } else {
                const sourceStrategy = SourceFactory.getStrategy(
                    this._settings, 
                    this._randomizer, 
                    this._httpSession, 
                    updateCancellable
                );
                
                images = await sourceStrategy.getImages(requiredCount, monitors, useSameImage, globalBox);
                
                // Safety check: Avoid writing to destroyed memory if extension disabled mid-download
                if (!this._settings || !this._cancellable || this._cancellable.is_cancelled() || updateCancellable.is_cancelled() || generation !== this._updateGeneration) return;

                if (images.length > 0) {
                    this._currentImages = [...images];
                }
            }

            if (!this._settings || !this._cancellable || this._cancellable.is_cancelled() || updateCancellable.is_cancelled() || generation !== this._updateGeneration) return;

            if (images.length === 0) return;

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
            
            const timestamp = Date.now();
            const outFilename = `spanned-bg-${timestamp}.jpg`;
            const outPath = GLib.build_filenamev([outDir, outFilename]);
            
            dest.savev(outPath, 'jpeg', ['quality'], ['100']);

            if (!this._bgSettings || updateCancellable.is_cancelled() || generation !== this._updateGeneration) return;

            this._bgSettings.set_string('picture-options', 'spanned');
            this._bgSettings.set_string('picture-uri', `file://${outPath}`);
            this._bgSettings.set_string('picture-uri-dark', `file://${outPath}`);

            // Clean up old cached backgrounds to prevent disk bloat
            try {
                const dir = Gio.File.new_for_path(outDir);
                const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (name.startsWith('spanned-bg-') && name !== outFilename) {
                        dir.get_child(name).delete(null);
                    }
                }
            } catch (e) {
                // Ignore cleanup errors
            }

        } catch (e) {
            // Do not log errors if the crash was simply caused by the user disabling the extension
            if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                return;
            }
            console.error(`Wallshuffle: Fatal error during update - ${e.message}`);
        } finally {
            if (this._updateCancellable === updateCancellable) {
                this._updateCancellable = null;
            }
            this._isUpdating = false;

            if (this._queuedUpdate && this._settings && this._cancellable && !this._cancellable.is_cancelled()) {
                const queuedReloadImages = this._queuedReloadImages;
                this._queuedUpdate = false;
                this._queuedReloadImages = false;
                this._updateBackground(queuedReloadImages);
            }
        }
    }
}