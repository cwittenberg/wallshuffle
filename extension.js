import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import GdkPixbuf from 'gi://GdkPixbuf';
import { SourceFactory } from './sources.js';
import { RenderStrategyFactory } from './rendering.js';
import { Randomizer } from './randomization.js';
import { WorkspaceStrategyFactory } from './workspace.js';

export default class WallshuffleExtension extends Extension {
    enable() {
        this._timeoutId = null;
        this._isUpdating = false;
        this._queuedUpdate = false;
        this._queuedReloadImages = false;
        this._updateCancellable = null;
        this._currentImages = new Map();
        this._randomizers = new Map();
        
        // Tie state explicitly to the extension lifecycle
        this._cancellable = new Gio.Cancellable();
        this._httpSession = new Soup.Session();
        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
        this._settings = this.getSettings();

        this._settings.connectObject('changed', (settings, key) => {
            if (key === 'randomize' || key === 'interval') {
                this._reschedule();
            }

            if (key === 'workspace-count') return;

            const reloadImages = !['interval', 'monitor-settings', 'workspace-monitor-settings'].includes(key);
            const invalidateImages = ['randomize', 'same-image-all-monitors', 'source-type', 'folder', 'monitor-images', 'workspace-specific', 'workspace-monitor-images'].includes(key);

            this._requestBackgroundUpdate(reloadImages, invalidateImages);
        }, this);

        // GSettings only emits "changed" for keys read after the handler was connected.
        for (const key of ['randomize', 'same-image-all-monitors', 'interval', 'source-type', 'folder', 'monitor-settings', 'monitor-images', 'workspace-specific', 'workspace-count', 'workspace-monitor-settings', 'workspace-monitor-images']) {
            this._settings.get_value(key);
        }

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._currentImages.clear();
            this._requestBackgroundUpdate();
        }, this);
        global.workspace_manager.connectObject('active-workspace-changed', () => {
            if (this._settings.get_boolean('workspace-specific')) {
                this._requestBackgroundUpdate(false);
            }
        }, this);

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
        if (this._randomizers) {
            for (const randomizer of this._randomizers.values()) {
                randomizer.clear();
            }
            this._randomizers.clear();
        }

        if (this._currentImages) {
            this._currentImages.clear();
        }

        // 5. Clean up settings hooks using disconnectObject
        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }
        
        Main.layoutManager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        
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
                    if (this._settings.get_boolean('workspace-specific')) {
                        this._currentImages.clear();
                    }
                    this._requestBackgroundUpdate();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    _requestBackgroundUpdate(reloadImages = true, invalidateImages = false) {
        if (!this._settings || !this._cancellable || this._cancellable.is_cancelled()) return;

        if (invalidateImages) {
            this._currentImages.clear();
            for (const randomizer of this._randomizers.values()) {
                randomizer.clear();
            }
            this._randomizers.clear();
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

            const workspaceIndex = global.workspace_manager.get_active_workspace_index();
            const workspaceStrategy = WorkspaceStrategyFactory.getStrategy(this._settings, workspaceIndex);
            const effectiveSettings = workspaceStrategy.getSettings();
            const cacheKey = workspaceStrategy.cacheKey;
            const cachedImages = this._currentImages.get(cacheKey) || [];
            let randomizer = this._randomizers.get(cacheKey);
            if (!randomizer) {
                randomizer = new Randomizer();
                this._randomizers.set(cacheKey, randomizer);
            }

            const useSameImage = effectiveSettings.get_boolean('same-image-all-monitors');
            const requiredCount = (useSameImage && nMonitors > 1) ? 1 : nMonitors;
            let images = [];
            
            if (!reloadImages && cachedImages.length > 0) {
                images = useSameImage ? [cachedImages[0]] : [...cachedImages];
            } else {
                const sourceStrategy = SourceFactory.getStrategy(
                    effectiveSettings, 
                    randomizer, 
                    this._httpSession, 
                    updateCancellable
                );
                
                // If the extension is disabled or updated during fetching, the Cancellable 
                // intercepts it, throws an IOErrorEnum.CANCELLED, and jumps straight to the catch block
                images = await sourceStrategy.getImages(requiredCount, monitors, useSameImage, globalBox);
                
                if (images.length > 0) {
                    this._currentImages.set(cacheKey, [...images]);
                }
            }

            if (images.length === 0) return;

            const dest = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, globalBox.w, globalBox.h);
            dest.fill(0x000000FF);

            let perMonitorSettings = {};
            try {
                perMonitorSettings = JSON.parse(effectiveSettings.get_string('monitor-settings'));
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

            // Only update GSettings if we still confidently exist 
            if (this._bgSettings) {
                this._bgSettings.set_string('picture-options', 'spanned');
                this._bgSettings.set_string('picture-uri', `file://${outPath}`);
                this._bgSettings.set_string('picture-uri-dark', `file://${outPath}`);
            }

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
            // Silently swallow expected cancellations instead of throwing stacktraces to journalctl
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