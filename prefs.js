import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildAboutPage } from './prefs_about.js';

export default class WallshufflePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();
        const monitors = display.get_monitors();
        const nMonitors = monitors.get_n_items();

        // ==============================================================
        // MAIN CONFIGURATION PAGE
        // ==============================================================
        const pageMain = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic'
        });

        // -------------------------------------------------------------
        // Group 1: Global Configuration
        // -------------------------------------------------------------
        const globalGroup = new Adw.PreferencesGroup({
            title: 'Global Preferences',
            description: 'Configure behavior, timing, and sources.'
        });
        pageMain.add(globalGroup);

        // Randomize Switch Row
        const randomizeRow = new Adw.SwitchRow({
            title: 'Randomize / Shuffle',
            subtitle: 'Turn off to assign static wallpapers sequentially per monitor.',
        });
        settings.bind('randomize', randomizeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(randomizeRow);

        // Same Image on All Monitors Switch Row
        const sameImageRow = new Adw.SwitchRow({
            title: 'Same Image on All Monitors',
            subtitle: 'Apply one background to all displays. Requires a multi-monitor setup.',
            sensitive: nMonitors > 1,
        });
        settings.bind('same-image-all-monitors', sameImageRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        globalGroup.add(sameImageRow);

        // Interval Scale/Slider Row
        const intervalRow = new Adw.ActionRow({
            title: 'Change Interval (Minutes)',
            subtitle: 'Frequency of background cycling.'
        });

        const intervalScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 1, 1440, 1);
        intervalScale.set_draw_value(true);
        intervalScale.set_value_pos(Gtk.PositionType.BOTTOM);
        intervalScale.set_valign(Gtk.Align.CENTER);
        intervalScale.set_hexpand(true);
        intervalScale.set_width_request(220); // Provides a nice, wide slider on the right side

        settings.bind('interval', intervalScale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        intervalRow.add_suffix(intervalScale);

        // Dynamically disable the interval row if Randomize is turned off
        intervalRow.set_sensitive(settings.get_boolean('randomize'));
        randomizeRow.connect('notify::active', () => {
            intervalRow.set_sensitive(randomizeRow.get_active());
        });
        globalGroup.add(intervalRow);

        // Source Type Selection
        const sourceModel = Gtk.StringList.new(['Local Folder', 'Online Random (Picsum)', 'Online Random (LoremFlickr)']);
        const sourceRow = new Adw.ComboRow({
            title: 'Wallpaper Source',
            subtitle: 'Where to fetch backgrounds from.',
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
            title: 'Wallpaper Folder',
            subtitle: settings.get_string('folder') || defaultPictures || 'Select a directory...',
            sensitive: selectedIndex === 0
        });

        const folderButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
        });

        folderButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Select Wallpaper Source Folder'
            });
            dialog.select_folder(window, null, (dlg, res) => {
                try {
                    const file = dlg.select_folder_finish(res);
                    if (file) {
                        const newPath = file.get_path();
                        settings.set_string('folder', newPath);
                        folderRow.set_subtitle(newPath);
                    }
                } catch (e) {
                    // Ignored (User dismissed dialog intentionally)
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
        // Group 2: Per-Monitor Settings (Using ExpanderRows for clean UX)
        // -------------------------------------------------------------
        const monitorGroup = new Adw.PreferencesGroup({
            title: 'Per-Monitor Configuration',
            description: 'Assign individual scaling strategies and static images to connected displays.'
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

        const modes = ['Zoom', 'Fit', 'Centre', 'Fill', 'Tile', 'Span'];
        
        for (let i = 0; i < nMonitors; i++) {
            const monitor = monitors.get_item(i);
            const modelName = monitor.get_model() || 'Unknown Display';
            const connector = monitor.get_connector() || `Display ${i + 1}`;
            
            const expanderRow = new Adw.ExpanderRow({
                title: `${modelName}`,
                subtitle: connector
            });

            // 1. Scaling Strategy Combo
            const strategyCombo = new Adw.ComboRow({
                title: `Scaling Strategy`,
                model: Gtk.StringList.new(modes),
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

            // 2. Specific Static Image ActionRow (Only visible when randomize is OFF and source is Folder)
            const staticImageRow = new Adw.ActionRow({
                title: 'Specific Static Image',
                subtitle: currentImageConfig[i] || 'Default (Alphabetical from folder)'
            });

            const fileButton = new Gtk.Button({
                icon_name: 'document-open-symbolic',
                valign: Gtk.Align.CENTER,
                has_frame: false,
            });

            fileButton.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({ title: `Select Static Image for ${modelName}` });
                dialog.open(window, null, (dlg, res) => {
                    try {
                        const file = dlg.open_finish(res);
                        if (file) {
                            const newPath = file.get_path();
                            
                            let updatedImages = {};
                            try { updatedImages = JSON.parse(settings.get_string('monitor-images')); } catch (e) { }
                            updatedImages[i] = newPath;
                            
                            settings.set_string('monitor-images', JSON.stringify(updatedImages));
                            staticImageRow.set_subtitle(newPath);
                        }
                    } catch (e) {
                        // Ignored
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
                staticImageRow.set_subtitle('Default (Alphabetical from folder)');
            });

            const buttonBox = new Gtk.Box({ spacing: 6 });
            buttonBox.append(fileButton);
            buttonBox.append(clearButton);
            staticImageRow.add_suffix(buttonBox);

            expanderRow.add_row(staticImageRow);
            monitorGroup.add(expanderRow);

            // Dynamic visibility logic to keep the UI pristine
            const updateVisibility = () => {
                const isFolder = settings.get_string('source-type') === 'folder';
                const isStatic = !settings.get_boolean('randomize');
                staticImageRow.set_visible(isFolder && isStatic);
            };

            settings.connect('changed::source-type', updateVisibility);
            settings.connect('changed::randomize', updateVisibility);
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