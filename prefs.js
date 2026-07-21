import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildAboutPage } from './prefs_about.js';

export default class WallshufflePrefs extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        const display = Gdk.Display.get_default();
        const monitors = [];
        const listModel = display.get_monitors();

        for (let i = 0; i < listModel.get_n_items(); i++) {
            monitors.push(listModel.get_item(i));
        }
        
        const nMonitors = monitors.length;

        // ==============================================================
        // MAIN CONFIGURATION PAGE
        // ==============================================================
        const pageMain = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic'
        });

        // -------------------------------------------------------------
        // Group 1: Global Configuration
        // -------------------------------------------------------------
        const globalGroup = new Adw.PreferencesGroup({
            title: _('Global Preferences'),
            description: _('Configure behavior, timing, and sources.')
        });
        pageMain.add(globalGroup);

        // Randomize Switch Row
        const randomizeRow = new Adw.SwitchRow({
            title: _('Randomize / Shuffle'),
            subtitle: _('Turn off to assign static wallpapers sequentially per monitor.'),
        });
        settings.bind('randomize', randomizeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(randomizeRow);

        // Same Image on All Monitors Switch Row
        const sameImageRow = new Adw.SwitchRow({
            title: _('Same Image on All Monitors'),
            subtitle: _('Apply one background to all displays. Requires a multi-monitor setup.'),
            sensitive: nMonitors > 1,
        });
        settings.bind('same-image-all-monitors', sameImageRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(sameImageRow);

        // Interval Exact Input (SpinRow)
        const intervalSpinRow = new Adw.SpinRow({
            title: _('Change Interval (Minutes)'),
            subtitle: _('Type exact minutes or use the quick slider below.'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 1440, step_increment: 1 })
        });
        settings.bind('interval', intervalSpinRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(intervalSpinRow);

        // Interval Quick Slider
        const intervalScaleRow = new Adw.ActionRow({
            title: _('Quick Select Interval'),
            subtitle: _('Slide to select common presets.')
        });

        // Non-linear scale mapping
        const steps = [1, 5, 15, 30, 60, 120, 240, 480, 1440];
        
        const rawIntervalScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, steps.length - 1, 0.01);
        rawIntervalScale.set_draw_value(true);
        rawIntervalScale.set_value_pos(Gtk.PositionType.BOTTOM);
        rawIntervalScale.set_valign(Gtk.Align.CENTER);
        rawIntervalScale.set_hexpand(true);
        
        // Add visual tick marks at each defined step
        for (let i = 0; i < steps.length; i++) {
            rawIntervalScale.add_mark(i, Gtk.PositionType.BOTTOM, null);
        }

        const minutesToIndex = (mins) => {
            if (mins <= steps[0]) return 0;
            if (mins >= steps[steps.length - 1]) return steps.length - 1;
            for (let i = 0; i < steps.length - 1; i++) {
                if (mins >= steps[i] && mins <= steps[i + 1]) {
                    const range = steps[i + 1] - steps[i];
                    const progress = mins - steps[i];
                    return i + (progress / range);
                }
            }
            return 0;
        };

        const indexToMinutes = (idx) => {
            if (idx <= 0) return steps[0];
            if (idx >= steps.length - 1) return steps[steps.length - 1];
            const lower = Math.floor(idx);
            const upper = Math.ceil(idx);

            if (lower === upper) return steps[lower];
            const fraction = idx - lower;
            return Math.round(steps[lower] + fraction * (steps[upper] - steps[lower]));
        };

        rawIntervalScale.set_size_request(220, -1);
        rawIntervalScale.set_format_value_func((scale, value) => {
            const mins = indexToMinutes(value);
            
            if (mins === 1) return _('1 minute');
            if (mins < 60) return _('%d minutes').replace('%d', mins);
            if (mins === 60) return _('1 hour');
            if (mins === 1440) return _('1 day');

            const hours = Math.floor(mins / 60);
            const remainder = mins % 60;
            
            if (remainder === 0) return _('%d hours').replace('%d', hours);
            return _('%dh %dm').replace('%d', hours).replace('%d', remainder);
        });

        // Bi-directional sync between the underlying minutes setting and the index-based scale
        let isSyncing = false;
        
        settings.connect('changed::interval', () => {
            if (isSyncing) return;
            isSyncing = true;
            rawIntervalScale.set_value(minutesToIndex(settings.get_int('interval')));
            isSyncing = false;
        });

        rawIntervalScale.connect('value-changed', () => {
            if (isSyncing) return;
            isSyncing = true;
            settings.set_int('interval', indexToMinutes(rawIntervalScale.get_value()));
            isSyncing = false;
        });

        // Initialize scale to current setting
        rawIntervalScale.set_value(minutesToIndex(settings.get_int('interval')));
        
        intervalScaleRow.add_suffix(rawIntervalScale);
        globalGroup.add(intervalScaleRow);

        // Dynamically disable both interval rows if Randomize is turned off
        const updateIntervalSensitivity = () => {
            const isActive = randomizeRow.get_active();
            intervalSpinRow.set_sensitive(isActive);
            intervalScaleRow.set_sensitive(isActive);
        };
        randomizeRow.connect('notify::active', updateIntervalSensitivity);
        updateIntervalSensitivity(); // Setup initial state

        // Source Type Selection
        const sourceModel = Gtk.StringList.new([
            _('Local Folder'), 
            _('Online Random (Picsum)'), 
            _('Online Random (LoremFlickr)')
        ]);

        const sourceRow = new Adw.ComboRow({
            title: _('Wallpaper Source'),
            subtitle: _('Where to fetch backgrounds from.'),
            model: sourceModel,
        });

        const currentSource = settings.get_string('source-type');
        let selectedIndex = 0;
        if (currentSource === 'online' || currentSource === 'online-picsum') selectedIndex = 1;
        if (currentSource === 'online-loremflickr') selectedIndex = 2;
        sourceRow.set_selected(selectedIndex);
        globalGroup.add(sourceRow);

        // Folder Path Selection
        const defaultPictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
        const folderRow = new Adw.ActionRow({
            title: _('Wallpaper Folder'),
            subtitle: settings.get_string('folder') || defaultPictures || _('Select a directory...'),
            sensitive: selectedIndex === 0
        });

        const folderButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
        });

        folderButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: _('Select Wallpaper Source Folder') });
            dialog.select_folder(window, null, (dlg, res) => {
                try {
                    const file = dlg.select_folder_finish(res);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('folder', path);
                        folderRow.set_subtitle(path);
                    }
                } catch (e) {
                    // User dismissed intentionally
                }
            });
        });
        folderRow.add_suffix(folderButton);
        globalGroup.add(folderRow);

        sourceRow.connect('notify::selected', () => {
            const selected = sourceRow.get_selected();
            let newType = 'folder';
            if (selected === 1) newType = 'online-picsum';
            if (selected === 2) newType = 'online-loremflickr';
            
            settings.set_string('source-type', newType);
            folderRow.set_sensitive(selected === 0);
        });

        // -------------------------------------------------------------
        // Group 2: Per-Monitor Settings
        // -------------------------------------------------------------
        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Per-Monitor Configuration'),
            description: _('Assign individual scaling strategies and static images to connected displays.')
        });
        pageMain.add(monitorGroup);

        let currentStrategyConfig = {};
        let currentImageConfig = {};

        try {
            currentStrategyConfig = JSON.parse(settings.get_string('monitor-settings'));
        } catch (e) { currentStrategyConfig = {}; }
        
        try {
            currentImageConfig = JSON.parse(settings.get_string('monitor-images'));
        } catch (e) { currentImageConfig = {}; }

        // Keep raw modes for logic, translate for UI display
        const modes = ['Zoom', 'Fit', 'Centre', 'Fill', 'Tile', 'Span', 'Stretch'];
        const translatedModes = modes.map(m => _(m));
        
        for (let i = 0; i < nMonitors; i++) {
            const monitor = monitors[i];
            const modelName = monitor.get_model() || _('Unknown Display');
            const connector = monitor.get_connector() || _('Display %d').replace('%d', i + 1);
            
            const expanderRow = new Adw.ExpanderRow({
                title: `${modelName}`,
                subtitle: connector
            });

            // 1. Scaling Strategy Combo
            const strategyCombo = new Adw.ComboRow({
                title: _('Scaling Strategy'),
                model: Gtk.StringList.new(translatedModes),
            });

            const currentStrategy = currentStrategyConfig[i] || 'zoom';
            const selectedStrategyIndex = modes.findIndex(m => m.toLowerCase() === currentStrategy);
            strategyCombo.set_selected(selectedStrategyIndex >= 0 ? selectedStrategyIndex : 0);

            strategyCombo.connect('notify::selected', () => {
                const selectedMode = modes[strategyCombo.get_selected()].toLowerCase();
                let updatedConfig = {};
                try { updatedConfig = JSON.parse(settings.get_string('monitor-settings')); } catch (e) { }
                updatedConfig[i] = selectedMode;
                settings.set_string('monitor-settings', JSON.stringify(updatedConfig));
            });
            expanderRow.add_row(strategyCombo);

            // 2. Specific Static Image ActionRow
            const staticImageRow = new Adw.ActionRow({
                title: _('Specific Static Image'),
                subtitle: currentImageConfig[i] || _('Default (Alphabetical from folder)')
            });

            const fileButton = new Gtk.Button({
                icon_name: 'document-open-symbolic',
                valign: Gtk.Align.CENTER,
                has_frame: false,
            });

            fileButton.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({ title: _('Select Static Image for %s').replace('%s', modelName) });
                dialog.open(window, null, (dlg, res) => {
                    try {
                        const file = dlg.open_finish(res);
                        if (file) {
                            const path = file.get_path();
                            let updatedImages = {};
                            try { updatedImages = JSON.parse(settings.get_string('monitor-images')); } catch (e) { }
                            updatedImages[i] = path;
                            
                            settings.set_string('monitor-images', JSON.stringify(updatedImages));
                            staticImageRow.set_subtitle(path);
                        }
                    } catch (e) {
                        // User dismissed intentionally
                    }
                });
            });

            // Add clear button to quickly revert to default folder behavior
            const clearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                valign: Gtk.Align.CENTER,
                has_frame: false,
            });

            clearButton.connect('clicked', () => {
                let updatedImages = {};
                try { updatedImages = JSON.parse(settings.get_string('monitor-images')); } catch (e) { }
                delete updatedImages[i];
                settings.set_string('monitor-images', JSON.stringify(updatedImages));
                staticImageRow.set_subtitle(_('Default (Alphabetical from folder)'));
            });

            const buttonBox = new Gtk.Box({ spacing: 6 });
            buttonBox.append(fileButton);
            buttonBox.append(clearButton);
            staticImageRow.add_suffix(buttonBox);

            expanderRow.add_row(staticImageRow);
            monitorGroup.add(expanderRow);

            // Dynamic visibility logic to keep the UI pristine
            const updateVisibility = () => {
                const isFolder = sourceRow.get_selected() === 0;
                const isStatic = !randomizeRow.get_active();
                staticImageRow.set_visible(isFolder && isStatic);
            };

            sourceRow.connect('notify::selected', updateVisibility);
            randomizeRow.connect('notify::active', updateVisibility);

            updateVisibility(); // Set initial state
        }

        window.add(pageMain);

        // ==============================================================
        // ABOUT PAGE
        // ==============================================================
        const pageAbout = buildAboutPage(this.metadata, this.dir);
        window.add(pageAbout);
    }
}