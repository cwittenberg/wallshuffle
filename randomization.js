export class Randomizer {
    constructor() {
        this._previousSelection = [];
    }

    /**
     * Selects unique random images and prevents repeating the previous cycle's images 
     * as much as mathematically possible based on the pool size.
     * 
     * @param {Array<string>} images - Array of available image paths/URLs
     * @param {number} requiredCount - Number of monitors to cover
     * @returns {Array<string>} Selected images
     */
    select(images, requiredCount) {
        if (!images || images.length === 0) return [];

        // Ensure we only deal with unique paths to prevent internal duplicates
        let uniqueImages = [...new Set(images)];

        // If we don't have enough images to meet the monitor count without repeats
        if (uniqueImages.length <= requiredCount) {
            let result = [];
            let shuffled = [...uniqueImages].sort(() => 0.5 - Math.random());
            for (let i = 0; i < requiredCount; i++) {
                result.push(shuffled[i % shuffled.length]);
            }
            this._previousSelection = result;
            return result;
        }

        // Find images that were NOT used in the immediately previous run
        let available = uniqueImages.filter(img => !this._previousSelection.includes(img));
        let result = [];

        if (available.length >= requiredCount) {
            // Best case scenario: we have enough fresh images to fully avoid the previous set
            available.sort(() => 0.5 - Math.random());
            result = available.slice(0, requiredCount);
        } else {
            // We don't have enough fresh images to strictly avoid the previous batch.
            // First, grab all available fresh ones.
            available.sort(() => 0.5 - Math.random());
            result.push(...available);

            // Fill the remainder with randomly selected images from the previous batch
            let remainingNeeded = requiredCount - result.length;
            let oldPool = uniqueImages.filter(img => this._previousSelection.includes(img));
            oldPool.sort(() => 0.5 - Math.random());
            
            result.push(...oldPool.slice(0, remainingNeeded));
        }

        this._previousSelection = result;
        return result;
    }

    clear() {
        this._previousSelection = [];
    }
}