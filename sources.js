import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

class SourceStrategy {
    async getImages(requiredCount) {
        throw new Error("SourceStrategy.getImages() must be implemented by subclasses");
    }
}

class FolderSourceStrategy extends SourceStrategy {
    constructor(settings, randomizer) {
        super();
        this._settings = settings;
        this._randomizer = randomizer;
    }

    async getImages(requiredCount) {
        let folderPath = this._settings.get_string('folder');
        
        // Default to ~/Pictures if empty
        if (!folderPath) {
            folderPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
        }
        
        if (!folderPath) return []; // Abort safely if user has no Pictures directory
        
        // Handle explicit tilde expansion if the user typed it manually
        if (folderPath.startsWith('~/')) {
            folderPath = GLib.build_filenamev([GLib.get_home_dir(), folderPath.slice(2)]);
        }

        const folder = Gio.File.new_for_path(folderPath);
        if (!folder.query_exists(null)) return [];

        let images = [];
        try {
            const enumerator = folder.enumerate_children('standard::name,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const type = info.get_content_type();
                if (type && ['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
                    images.push(folder.get_child(info.get_name()).get_path());
                }
            }
            enumerator.close(null); // Prevents File IO leaks
        } catch (e) {
            console.error(`Wallshuffle: IO Error reading folder - ${e.message}`);
        }

        if (this._settings.get_boolean('randomize')) {
            return this._randomizer.select(images, requiredCount);
        } else {
            // Static Mode handling
            const sortedImages = images.sort((a, b) => a.localeCompare(b));
            let explicitImages = {};
            
            try {
                explicitImages = JSON.parse(this._settings.get_string('monitor-images'));
            } catch (e) {
                explicitImages = {};
            }

            let finalImages = [];
            for (let i = 0; i < requiredCount; i++) {
                // Check if the user explicitly defined a static image for this monitor index
                const explicitPath = explicitImages[i];
                if (explicitPath && Gio.File.new_for_path(explicitPath).query_exists(null)) {
                    finalImages.push(explicitPath);
                } else {
                    // Fallback to the alphabetical list 
                    finalImages.push(sortedImages[i % sortedImages.length]);
                }
            }
            
            return finalImages;
        }
    }
}

class OnlineSourceStrategy extends SourceStrategy {
    constructor(settings, provider, randomizer, session, cancellable) {
        super();
        this._settings = settings;
        this._provider = provider;
        this._randomizer = randomizer;
        this._session = session;
        this._cancellable = cancellable;
    }

    async getImages(requiredCount) {
        let paths = [];
        const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wallshuffle', this._provider]);
        GLib.mkdir_with_parents(cacheDir, 0o755);

        const randomize = this._settings.get_boolean('randomize');

        for (let i = 0; i < requiredCount; i++) {
            let url = '';
            
            // Branch endpoint construction based on chosen provider
            if (this._provider === 'loremflickr') {
                url = randomize
                    ? `https://loremflickr.com/1920/1080/landscape,nature?random=${Math.random()}`
                    : `https://loremflickr.com/1920/1080/landscape,nature?lock=${i}`;
            } else { 
                url = randomize 
                    ? `https://picsum.photos/1920/1080?random=${Math.random()}`
                    : `https://picsum.photos/seed/wallshuffle_monitor_${i}/1920/1080`;
            }
            
            const msg = Soup.Message.new('GET', url);
            
            try {
                const bytes = await new Promise((resolve, reject) => {
                    // Injecting cancellable handles unexpected extension disablement
                    this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                        try {
                            const resultBytes = session.send_and_read_finish(res);
                            if (msg.get_status() === Soup.Status.OK || msg.get_status() === Soup.Status.FOUND) {
                                resolve(resultBytes);
                            } else {
                                reject(new Error(`HTTP ${msg.get_status()}`));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                const outPath = GLib.build_filenamev([cacheDir, `download_${i}.jpg`]);
                const file = Gio.File.new_for_path(outPath);
                
                await new Promise((resolve, reject) => {
                    // Injecting cancellable prevents hanging file writes 
                    file.replace_contents_bytes_async(
                        bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable, 
                        (f, res) => {
                            try {
                                f.replace_contents_finish(res);
                                resolve();
                            } catch(e) {
                                reject(e);
                            }
                        }
                    );
                });

                paths.push(outPath);
            } catch (e) {
                // If it was cancelled by lifecycle cleanup, let the error propagate up silently
                if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    throw e;
                }
                console.error(`Wallshuffle: Failed to fetch online image from ${this._provider} - ${e.message}`);
            }
        }

        return paths;
    }
}

export class SourceFactory {
    static getStrategy(settings, randomizer, session, cancellable) {
        const type = settings.get_string('source-type');
        
        if (type === 'online' || type === 'online-picsum') {
            return new OnlineSourceStrategy(settings, 'picsum', randomizer, session, cancellable);
        } else if (type === 'online-loremflickr') {
            return new OnlineSourceStrategy(settings, 'loremflickr', randomizer, session, cancellable);
        }
        
        return new FolderSourceStrategy(settings, randomizer);
    }
}