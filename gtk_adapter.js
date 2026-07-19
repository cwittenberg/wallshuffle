/**
 * GTKAdapter
 * Adapts varying GTK3 / GTK4 APIs to a unified interface to insulate
 * the core preferences logic from underlying UI framework changes.
 */
import Gtk from 'gi://Gtk';

export class GtkScaleAdapter {
    constructor(gtkScale) {
        this._scale = gtkScale;
    }

    setWidth(width) {
        if (typeof this._scale.set_size_request === 'function') {
            this._scale.set_size_request(width, -1);
        } else if (typeof this._scale.set_width_request === 'function') {
            this._scale.set_width_request(width);
        }
    }

    setFormatValueFunc(callback) {
        if (typeof this._scale.set_format_value_func === 'function') {
            this._scale.set_format_value_func(callback);
        } else {
            this._scale.connect('format-value', callback);
        }
    }
}

export class GdkDisplayAdapter {
    constructor(gdkDisplay) {
        this._display = gdkDisplay;
    }

    /**
     * @returns {Array<Object>} Array of Gdk.Monitor objects
     */
    getMonitors() {
        const result = [];
        
        // GTK4 / GDK4 implementation
        if (typeof this._display.get_monitors === 'function') {
            const listModel = this._display.get_monitors();
            const n = listModel.get_n_items();
            for (let i = 0; i < n; i++) {
                result.push(listModel.get_item(i));
            }
        } 
        // GTK3 / GDK3 fallback
        else if (typeof this._display.get_n_monitors === 'function') {
            const n = this._display.get_n_monitors();
            for (let i = 0; i < n; i++) {
                result.push(this._display.get_monitor(i));
            }
        }
        
        return result;
    }
}

export class GtkFileDialogAdapter {
    constructor(title) {
        this._title = title;
    }

    selectFolder(window, onComplete) {
        // GTK 4.10+ native dialog
        if (typeof Gtk.FileDialog !== 'undefined') {
            const dialog = new Gtk.FileDialog({ title: this._title });
            dialog.select_folder(window, null, (dlg, res) => {
                try {
                    const file = dlg.select_folder_finish(res);
                    if (file) onComplete(file.get_path());
                } catch (e) {
                    // User dismissed intentionally
                }
            });
        } 
        // GTK3 / Older GTK4 fallback
        else if (typeof Gtk.FileChooserNative !== 'undefined') {
            const dialog = new Gtk.FileChooserNative({
                title: this._title,
                transient_for: window,
                action: Gtk.FileChooserAction.SELECT_FOLDER
            });
            dialog.connect('response', (dlg, responseId) => {
                if (responseId === Gtk.ResponseType.ACCEPT) {
                    onComplete(dlg.get_file().get_path());
                }
                dlg.destroy();
            });
            dialog.show();
        }
    }

    openFile(window, onComplete) {
        // GTK 4.10+ native dialog
        if (typeof Gtk.FileDialog !== 'undefined') {
            const dialog = new Gtk.FileDialog({ title: this._title });
            dialog.open(window, null, (dlg, res) => {
                try {
                    const file = dlg.open_finish(res);
                    if (file) onComplete(file.get_path());
                } catch (e) {
                    // User dismissed intentionally
                }
            });
        } 
        // GTK3 / Older GTK4 fallback
        else if (typeof Gtk.FileChooserNative !== 'undefined') {
            const dialog = new Gtk.FileChooserNative({
                title: this._title,
                transient_for: window,
                action: Gtk.FileChooserAction.OPEN
            });
            dialog.connect('response', (dlg, responseId) => {
                if (responseId === Gtk.ResponseType.ACCEPT) {
                    onComplete(dlg.get_file().get_path());
                }
                dlg.destroy();
            });
            dialog.show();
        }
    }
}