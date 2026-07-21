import GdkPixbuf from 'gi://GdkPixbuf';

class RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        throw new Error("RenderStrategy.render() must be implemented by subclasses");
    }

    _safeCopyArea(src, dest, destX, destY) {
        const copyW = Math.min(src.get_width(), dest.get_width() - destX);
        const copyH = Math.min(src.get_height(), dest.get_height() - destY);
        if (copyW > 0 && copyH > 0) {
            src.copy_area(0, 0, copyW, copyH, dest, destX, destY);
        }
    }
}

class ZoomStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const srcW = srcPixbuf.get_width();
        const srcH = srcPixbuf.get_height();
        const scale = Math.max(monBox.w / srcW, monBox.h / srcH);
        
        const newW = Math.max(1, Math.round(srcW * scale));
        const newH = Math.max(1, Math.round(srcH * scale));
        const scaled = srcPixbuf.scale_simple(newW, newH, GdkPixbuf.InterpType.BILINEAR);

        const cropX = Math.max(0, Math.round((newW - monBox.w) / 2));
        const cropY = Math.max(0, Math.round((newH - monBox.h) / 2));
        const cropped = scaled.new_subpixbuf(cropX, cropY, monBox.w, monBox.h);

        this._safeCopyArea(cropped, destPixbuf, monBox.targetX, monBox.targetY);
    }
}

class FitStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const srcW = srcPixbuf.get_width();
        const srcH = srcPixbuf.get_height();
        const scale = Math.min(monBox.w / srcW, monBox.h / srcH);
        
        const newW = Math.max(1, Math.round(srcW * scale));
        const newH = Math.max(1, Math.round(srcH * scale));
        const scaled = srcPixbuf.scale_simple(newW, newH, GdkPixbuf.InterpType.BILINEAR);

        const offsetX = Math.max(0, Math.round((monBox.w - newW) / 2));
        const offsetY = Math.max(0, Math.round((monBox.h - newH) / 2));

        this._safeCopyArea(scaled, destPixbuf, monBox.targetX + offsetX, monBox.targetY + offsetY);
    }
}

class FillStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const scaled = srcPixbuf.scale_simple(monBox.w, monBox.h, GdkPixbuf.InterpType.BILINEAR);
        this._safeCopyArea(scaled, destPixbuf, monBox.targetX, monBox.targetY);
    }
}

class CentreStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const srcW = srcPixbuf.get_width();
        const srcH = srcPixbuf.get_height();

        let processPixbuf = srcPixbuf;
        let destX = monBox.targetX;
        let destY = monBox.targetY;

        if (srcW > monBox.w || srcH > monBox.h) {
            const cropX = Math.max(0, Math.round((srcW - monBox.w) / 2));
            const cropY = Math.max(0, Math.round((srcH - monBox.h) / 2));
            const cropW = Math.min(monBox.w, srcW - cropX);
            const cropH = Math.min(monBox.h, srcH - cropY);
            processPixbuf = srcPixbuf.new_subpixbuf(cropX, cropY, cropW, cropH);
        } else {
            destX += Math.round((monBox.w - srcW) / 2);
            destY += Math.round((monBox.h - srcH) / 2);
        }

        this._safeCopyArea(processPixbuf, destPixbuf, destX, destY);
    }
}

class TileStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const srcW = srcPixbuf.get_width();
        const srcH = srcPixbuf.get_height();

        for (let x = 0; x < monBox.w; x += srcW) {
            for (let y = 0; y < monBox.h; y += srcH) {
                const tileW = Math.min(srcW, monBox.w - x);
                const tileH = Math.min(srcH, monBox.h - y);
                const tile = srcPixbuf.new_subpixbuf(0, 0, tileW, tileH);      
                this._safeCopyArea(tile, destPixbuf, monBox.targetX + x, monBox.targetY + y);
            }
        }
    }
}

class SpanStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        const srcW = srcPixbuf.get_width();
        const srcH = srcPixbuf.get_height();
        
        const scale = Math.max(globalBox.w / srcW, globalBox.h / srcH);
        const newW = Math.max(1, Math.round(srcW * scale));
        const newH = Math.max(1, Math.round(srcH * scale));
        const scaled = srcPixbuf.scale_simple(newW, newH, GdkPixbuf.InterpType.BILINEAR);

        const globalCropX = Math.max(0, Math.round((newW - globalBox.w) / 2));
        const globalCropY = Math.max(0, Math.round((newH - globalBox.h) / 2));

        const monExtX = globalCropX + monBox.targetX;
        const monExtY = globalCropY + monBox.targetY;
        
        const extracted = scaled.new_subpixbuf(monExtX, monExtY, monBox.w, monBox.h);
        this._safeCopyArea(extracted, destPixbuf, monBox.targetX, monBox.targetY);
    }
}

class StretchStrategy extends RenderStrategy {
    render(destPixbuf, srcPixbuf, monBox, globalBox) {
        // Scale ignoring aspect ratio to stretch and fit the entire multi-monitor globalBox perfectly
        const scaled = srcPixbuf.scale_simple(globalBox.w, globalBox.h, GdkPixbuf.InterpType.BILINEAR);
        
        // Extract the specific monitor's portion from the global stretched image
        const extracted = scaled.new_subpixbuf(monBox.targetX, monBox.targetY, monBox.w, monBox.h);
        this._safeCopyArea(extracted, destPixbuf, monBox.targetX, monBox.targetY);
    }
}

export class RenderStrategyFactory {
    static getStrategy(mode) {
        switch (mode) {
            case 'fit': return new FitStrategy();
            case 'fill': return new FillStrategy();
            case 'centre': return new CentreStrategy();
            case 'tile': return new TileStrategy();
            case 'span': return new SpanStrategy();
            case 'stretch': return new StretchStrategy();
            case 'zoom':
            default: return new ZoomStrategy();
        }
    }
}