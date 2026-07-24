# Wallshuffle

GNOME today does not support setting a specific background per monitor, let alone shuffle it on a timer, or have different rendering methods for it.

With this extension you can set  dynamic, per-monitor backgrounds using advanced rendering strategies. Shuffle them or map them statically with this multi-monitor wallpaper changer for GNOME Shell.

## Features
* **Per-Monitor Configurations:** Assign individual scaling strategies and specific images to each of your connected displays.
* **Advanced Rendering Strategies:** Choose from Zoom, Fit, Centre, Fill, Tile, and Span to perfectly position your backgrounds.
* **Multiple Sources:** Fetch wallpapers from a local folder or stream online random images via Picsum or LoremFlickr.
* **Shuffle Mode:** Randomize wallpapers and cycle through them on a customizable timer interval.
* **Static Mode:** Turn off randomization to assign static wallpapers manually per monitor.
* **Unified Display:** Optionally apply the same background to all displays in a multi-monitor setup.
* **Localization Support:** Translated into multiple languages including Spanish, French, German, Japanese, and more.

## Demo
<img width="320" height="568" alt="output_iphone_1 875x" src="https://github.com/user-attachments/assets/f64dc0ab-e48f-4b22-b4e1-bccb765d53ab" />

## Compatibility
Supported GNOME Shell versions: 46, 47, 48, 49, 50

## Installation

### Manual Installation (From Source)
To build and install the extension locally:

```bash
# Clone the repository
git clone https://github.com/cwittenberg/wallshuffle.git
cd wallshuffle

# Build and install the extension using Make
make install

# Enable the extension (Note: If you are on Wayland, you may need to log out and log back in first)
gnome-extensions enable wallshuffle@cwittenberg
```

Alternatively, you can use the provided build script:
```bash
./build.sh
```
