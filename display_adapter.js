/**
 * GNOMEDisplayAdapter (Adapter Pattern - GoF)
 * Adapts GNOME's global.display (MetaDisplay) to a unified interface
 * to insulate the core extension logic from underlying Mutter API changes.
 */
export class GNOMEDisplayAdapter {
    constructor(metaDisplay) {
        this._display = metaDisplay;
    }

    /**
     * @returns {Array<{index: number, geom: {x: number, y: number, width: number, height: number}}>}
     */
    getMonitors() {
        const monitors = [];
        
        // GTK4 / GNOME 44+ Mutter API
        if (typeof this._display.get_monitors === 'function') {
            const metaMonitors = this._display.get_monitors();
            for (let i = 0; i < metaMonitors.length; i++) {
                const geom = metaMonitors[i].get_geometry();
                monitors.push({
                    index: i,
                    geom: { x: geom.x, y: geom.y, width: geom.width, height: geom.height }
                });
            }
        } 
        // Legacy GNOME < 44 Mutter API
        else if (typeof this._display.get_n_monitors === 'function') {
            const nMonitors = this._display.get_n_monitors();
            for (let i = 0; i < nMonitors; i++) {
                const geom = this._display.get_monitor_geometry(i);
                monitors.push({
                    index: i,
                    geom: { x: geom.x, y: geom.y, width: geom.width, height: geom.height }
                });
            }
        }
        
        return monitors;
    }
}