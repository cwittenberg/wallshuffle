import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function parseConfig(settings, key) {
    try {
        return JSON.parse(settings.get_string(key));
    } catch (e) {
        return {};
    }
}

function removeEmptyWorkspace(config, workspaceIndex) {
    if (config[workspaceIndex] && Object.keys(config[workspaceIndex]).length === 0) {
        delete config[workspaceIndex];
    }
}

export function buildWorkspacesPage(settings, window, monitors) {
    const pageWorkspaces = new Adw.PreferencesPage({
        title: _('Workspaces'),
        icon_name: 'view-grid-symbolic'
    });

    const introGroup = new Adw.PreferencesGroup({
        title: _('A Visual Identity for Every Workspace'),
        description: _('Use wallpapers to make workspaces instantly recognizable and easier to navigate.')
    });

    const setupRow = new Adw.ActionRow({
        title: _('Works with Any Monitor Setup'),
        subtitle: _('Give every workspace its own wallpaper and scaling strategy, whether you use one monitor or several.')
    });

    const setupIcon = new Gtk.Image({
        icon_name: 'video-display-symbolic',
        pixel_size: 32,
        valign: Gtk.Align.CENTER
    });

    setupRow.add_prefix(setupIcon);
    introGroup.add(setupRow);

    const inheritanceRow = new Adw.ActionRow({
        title: _('Override Only What Should Be Different'),
        subtitle: _('Every workspace starts with the settings from the main tab. Choose a different image or rendering mode only where needed.')
    });

    const inheritanceIcon = new Gtk.Image({
        icon_name: 'emblem-default-symbolic',
        pixel_size: 32,
        valign: Gtk.Align.CENTER
    });

    inheritanceRow.add_prefix(inheritanceIcon);
    introGroup.add(inheritanceRow);
    pageWorkspaces.add(introGroup);

    const enableGroup = new Adw.PreferencesGroup({
        title: _('Workspace Specificity'),
        description: _('Turn on workspace-aware backgrounds, then choose how many workspace configurations to show.')
    });

    const workspaceSpecificRow = new Adw.SwitchRow({
        title: _('Enable Workspace Specificity'),
        subtitle: _('When disabled, Wallshuffle continues using the main per-monitor configuration.')
    });
    settings.bind('workspace-specific', workspaceSpecificRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    enableGroup.add(workspaceSpecificRow);

    const transitionRow = new Adw.ActionRow({
        title: _('Brief Dark Transition When Switching'),
        subtitle: _('Due to how GNOME applies workspace backgrounds, the desktop may appear dark very briefly while the next background loads. This only occurs when Workspace Specificity is enabled.')
    });

    const transitionIcon = new Gtk.Image({
        icon_name: 'dialog-warning-symbolic',
        pixel_size: 24,
        valign: Gtk.Align.CENTER
    });

    transitionIcon.add_css_class('warning');
    transitionRow.add_prefix(transitionIcon);
    enableGroup.add(transitionRow);

    const workspaceCountRow = new Adw.SpinRow({
        title: _('Workspace Configuration Slots'),
        subtitle: _('Match the number of workspaces you normally use. Add extra slots when using dynamic workspaces.'),
        adjustment: new Gtk.Adjustment({ lower: 1, upper: 36, step_increment: 1 })
    });
    settings.bind('workspace-count', workspaceCountRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    enableGroup.add(workspaceCountRow);
    pageWorkspaces.add(enableGroup);

    const workspaceGroup = new Adw.PreferencesGroup({
        title: _('Per-Workspace Overrides'),
        description: _('Open a workspace below to override its inherited scaling strategy or static image for each monitor.')
    });
    pageWorkspaces.add(workspaceGroup);

    const modes = ['Zoom', 'Fit', 'Centre', 'Fill', 'Tile', 'Span', 'Stretch'];
    const translatedModes = [_('Use Monitor Default'), ...modes.map(m => _(m))];
    let workspaceRows = [];
    let staticImageRows = [];

    const updateSensitivity = () => {
        const enabled = workspaceSpecificRow.get_active();
        workspaceCountRow.set_sensitive(enabled);
        workspaceGroup.set_sensitive(enabled);
    };

    const updateStaticImageVisibility = () => {
        const visible = settings.get_string('source-type') === 'folder' && !settings.get_boolean('randomize');
        for (const row of staticImageRows) {
            row.set_visible(visible);
        }
    };

    const rebuildWorkspaceRows = () => {
        for (const row of workspaceRows) {
            workspaceGroup.remove(row);
        }
        workspaceRows = [];
        staticImageRows = [];

        const workspaceStrategyConfig = parseConfig(settings, 'workspace-monitor-settings');
        const workspaceImageConfig = parseConfig(settings, 'workspace-monitor-images');
        const monitorStrategyConfig = parseConfig(settings, 'monitor-settings');
        const monitorImageConfig = parseConfig(settings, 'monitor-images');
        const workspaceCount = settings.get_int('workspace-count');

        for (let workspaceIndex = 0; workspaceIndex < workspaceCount; workspaceIndex++) {
            const workspaceRow = new Adw.ExpanderRow({
                title: _('Workspace %d').replace('%d', workspaceIndex + 1),
                subtitle: monitors.length === 1
                    ? _('1 connected display')
                    : _('%d connected displays').replace('%d', monitors.length)
            });

            for (let monitorIndex = 0; monitorIndex < monitors.length; monitorIndex++) {
                const monitor = monitors[monitorIndex];
                const modelName = monitor.get_model() || _('Unknown Display');
                const connector = monitor.get_connector() || _('Display %d').replace('%d', monitorIndex + 1);
                const inheritedStrategy = monitorStrategyConfig[monitorIndex] || 'zoom';

                const strategyCombo = new Adw.ComboRow({
                    title: _('%s Scaling Strategy').replace('%s', connector),
                    subtitle: _('%s · Monitor default: %s').replace('%s', modelName).replace('%s', _(inheritedStrategy.charAt(0).toUpperCase() + inheritedStrategy.slice(1))),
                    model: Gtk.StringList.new(translatedModes)
                });

                const currentStrategy = workspaceStrategyConfig[workspaceIndex]?.[monitorIndex];
                const selectedStrategyIndex = currentStrategy
                    ? modes.findIndex(m => m.toLowerCase() === currentStrategy) + 1
                    : 0;
                strategyCombo.set_selected(selectedStrategyIndex > 0 ? selectedStrategyIndex : 0);

                strategyCombo.connect('notify::selected', () => {
                    const updatedConfig = parseConfig(settings, 'workspace-monitor-settings');
                    updatedConfig[workspaceIndex] ||= {};

                    if (strategyCombo.get_selected() === 0) {
                        delete updatedConfig[workspaceIndex][monitorIndex];
                    } else {
                        updatedConfig[workspaceIndex][monitorIndex] = modes[strategyCombo.get_selected() - 1].toLowerCase();
                    }

                    removeEmptyWorkspace(updatedConfig, workspaceIndex);
                    settings.set_string('workspace-monitor-settings', JSON.stringify(updatedConfig));
                });

                workspaceRow.add_row(strategyCombo);

                const inheritedImage = monitorImageConfig[monitorIndex];
                const staticImageRow = new Adw.ActionRow({
                    title: _('%s Specific Static Image').replace('%s', connector),
                    subtitle: workspaceImageConfig[workspaceIndex]?.[monitorIndex]
                        || (inheritedImage ? _('Monitor Default: %s').replace('%s', inheritedImage) : _('Use Monitor Default'))
                });

                const fileButton = new Gtk.Button({
                    icon_name: 'document-open-symbolic',
                    valign: Gtk.Align.CENTER,
                    has_frame: false
                });

                fileButton.connect('clicked', () => {
                    const dialog = new Gtk.FileDialog({
                        title: _('Select Static Image for Workspace %d, %s').replace('%d', workspaceIndex + 1).replace('%s', modelName)
                    });
                    dialog.open(window, null, (dlg, res) => {
                        try {
                            const file = dlg.open_finish(res);
                            if (file) {
                                const path = file.get_path();
                                const updatedImages = parseConfig(settings, 'workspace-monitor-images');
                                updatedImages[workspaceIndex] ||= {};
                                updatedImages[workspaceIndex][monitorIndex] = path;
                                settings.set_string('workspace-monitor-images', JSON.stringify(updatedImages));
                                staticImageRow.set_subtitle(path);
                            }
                        } catch (e) {
                            // User dismissed intentionally
                        }
                    });
                });

                const clearButton = new Gtk.Button({
                    icon_name: 'edit-clear-symbolic',
                    valign: Gtk.Align.CENTER,
                    has_frame: false
                });

                clearButton.connect('clicked', () => {
                    const updatedImages = parseConfig(settings, 'workspace-monitor-images');
                    if (updatedImages[workspaceIndex]) {
                        delete updatedImages[workspaceIndex][monitorIndex];
                        removeEmptyWorkspace(updatedImages, workspaceIndex);
                    }
                    settings.set_string('workspace-monitor-images', JSON.stringify(updatedImages));
                    staticImageRow.set_subtitle(inheritedImage
                        ? _('Monitor Default: %s').replace('%s', inheritedImage)
                        : _('Use Monitor Default'));
                });

                const buttonBox = new Gtk.Box({ spacing: 6 });
                buttonBox.append(fileButton);
                buttonBox.append(clearButton);
                staticImageRow.add_suffix(buttonBox);
                workspaceRow.add_row(staticImageRow);
                staticImageRows.push(staticImageRow);
            }

            workspaceGroup.add(workspaceRow);
            workspaceRows.push(workspaceRow);
        }

        updateStaticImageVisibility();
    };

    workspaceSpecificRow.connect('notify::active', updateSensitivity);
    settings.connect('changed::workspace-count', rebuildWorkspaceRows);
    settings.connect('changed::source-type', updateStaticImageVisibility);
    settings.connect('changed::randomize', updateStaticImageVisibility);

    rebuildWorkspaceRows();
    updateSensitivity();

    return pageWorkspaces;
}
