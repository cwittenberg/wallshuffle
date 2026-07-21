import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function wrap(row) {
    row.set_subtitle_lines(0);
    return row;
}

function createLinkButton(title, uri, styleClass = null) {
    const button = new Gtk.Button({
        label: title,
        valign: Gtk.Align.CENTER
    });
    
    if (styleClass) {
        button.add_css_class(styleClass);
    }
    
    button.connect('clicked', () => {
        Gio.app_info_launch_default_for_uri(uri, null);
    });
    
    return button;
}

export function buildAboutPage(metadata, dir) {
    const pageAbout = new Adw.PreferencesPage({
        title: _('About'),
        icon_name: 'dialog-information-symbolic'
    });

    const groupAboutInfo = new Adw.PreferencesGroup({ title: _('Extension Information') });

    const logoRow = new Adw.ActionRow({
        title: _('Wallshuffle'),
        subtitle: _('Set dynamic, per-monitor backgrounds using advanced rendering strategies.')
    });

    const imagePath = dir.get_child('wallshuffle.svg').get_path();
    const gfile = Gio.File.new_for_path(imagePath);

    const logoImg = new Gtk.Picture({
        file: gfile,
        can_shrink: true,
        width_request: 48,
        height_request: 48,
        content_fit: Gtk.ContentFit.CONTAIN,
        margin_end: 16
    });
    
    logoImg.add_css_class('circular');
    logoImg.add_css_class('icon-dropshadow');
    
    logoRow.add_prefix(logoImg);
    
    const versionStr = metadata.version ? metadata.version.toString() : _('Local / Development');
    const rowVersion = new Adw.ActionRow({ title: _('Version'), subtitle: versionStr });
    const rowAuthor = new Adw.ActionRow({ title: _('Author'), subtitle: 'Christian Wittenberg' });
    
    groupAboutInfo.add(wrap(logoRow));
    groupAboutInfo.add(wrap(rowVersion));
    groupAboutInfo.add(wrap(rowAuthor));

    const groupLinks = new Adw.PreferencesGroup();

    const linkBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        margin_top: 24,
        margin_bottom: 24
    });

    linkBox.append(createLinkButton(
        _('Buy me a coffee 💙☕'),
        'https://ko-fi.com/cwittenberg',
        'suggested-action' 
    ));

    linkBox.append(createLinkButton(
        _('Report a Bug 🪲'),
        'https://github.com/cwittenberg/wallshuffle/issues/new'
    ));

    linkBox.append(createLinkButton(
        _('Request a Feature'),
        'https://github.com/cwittenberg/wallshuffle/issues/new'
    ));

    groupLinks.add(linkBox);

    pageAbout.add(groupLinks);
    pageAbout.add(groupAboutInfo);

    return pageAbout;
}