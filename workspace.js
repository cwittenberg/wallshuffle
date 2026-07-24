function parseConfig(settings, key) {
    try {
        return JSON.parse(settings.get_string(key));
    } catch (e) {
        return {};
    }
}

class WorkspaceSettingsDecorator {
    constructor(settings, workspaceIndex) {
        this._settings = settings;
        this.workspaceIndex = workspaceIndex;
    }

    get_boolean(key) {
        return this._settings.get_boolean(key);
    }

    get_int(key) {
        return this._settings.get_int(key);
    }

    get_string(key) {
        if (key !== 'monitor-settings' && key !== 'monitor-images') {
            return this._settings.get_string(key);
        }

        const workspaceKey = key === 'monitor-settings'
            ? 'workspace-monitor-settings'
            : 'workspace-monitor-images';
        const globalConfig = parseConfig(this._settings, key);
        const workspaceConfig = parseConfig(this._settings, workspaceKey);
        const overrides = workspaceConfig[this.workspaceIndex] || {};

        return JSON.stringify({ ...globalConfig, ...overrides });
    }
}

class GlobalWorkspaceStrategy {
    constructor(settings) {
        this._settings = settings;
        this.cacheKey = 'global';
    }

    getSettings() {
        return this._settings;
    }
}

class SpecificWorkspaceStrategy {
    constructor(settings, workspaceIndex) {
        this._settings = settings;
        this._workspaceIndex = workspaceIndex;
        this.cacheKey = `workspace-${workspaceIndex}`;
    }

    getSettings() {
        return new WorkspaceSettingsDecorator(this._settings, this._workspaceIndex);
    }
}

export class WorkspaceStrategyFactory {
    static getStrategy(settings, workspaceIndex) {
        if (settings.get_boolean('workspace-specific')) {
            return new SpecificWorkspaceStrategy(settings, workspaceIndex);
        }

        return new GlobalWorkspaceStrategy(settings);
    }
}
