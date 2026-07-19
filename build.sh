#!/usr/bin/env bash
# ==============================================================================
# Wallshuffle Extension Build & Packaging Script
# ==============================================================================

set -euo pipefail

UUID="wallshuffle@cwittenberg"
BUILD_DIR="build"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
PROJECT_DIR="$(pwd)"
PACKAGE_PATH="$PROJECT_DIR/$BUILD_DIR/$UUID.shell-extension.zip"

echo "Cleaning up previous builds..."
rm -rf "$BUILD_DIR"
rm -f "$UUID.zip"
rm -f "$UUID.shell-extension.zip"

echo "Creating build directory structure..."
mkdir -p "$BUILD_DIR/schemas"

echo "Validating extension files..."
for file in metadata.json extension.js prefs.js sources.js rendering.js display_adapter.js randomization.js prefs_about.js schemas/org.gnome.shell.extensions.wallshuffle.gschema.xml; do
    if [ ! -f "$file" ]; then
        echo "Error: $file not found in the current directory. Please make sure all files exist."
        exit 1
    fi
done

echo "Compiling GSettings schema locally..."
glib-compile-schemas --strict schemas/

echo "Copying files to build directory..."
cp metadata.json extension.js prefs.js sources.js rendering.js display_adapter.js randomization.js prefs_about.js "$BUILD_DIR/"
cp -r schemas "$BUILD_DIR/"
rm -f "$BUILD_DIR/schemas/gschemas.compiled"

echo "Packaging extension..."
if command -v gnome-extensions &> /dev/null; then
    PACK_ARGS=(
        "--extra-source=sources.js"
        "--extra-source=rendering.js"
        "--extra-source=display_adapter.js"
        "--extra-source=randomization.js"
        "--extra-source=prefs_about.js"
        "--extra-source=schemas"
    )
    gnome-extensions pack "$BUILD_DIR" "${PACK_ARGS[@]}" --force
    mv "$UUID.shell-extension.zip" "$PACKAGE_PATH"
else
    echo "gnome-extensions CLI not found, falling back to zip..."
    if ! command -v zip &> /dev/null; then
        echo "Error: zip not found."
        exit 1
    fi
    (cd "$BUILD_DIR" && zip -r "../$UUID.shell-extension.zip" .)
    mv "$UUID.shell-extension.zip" "$PACKAGE_PATH"
fi

echo "Installing extension locally..."
rm -rf "$EXTENSION_DIR"
mkdir -p "$EXTENSION_DIR"
cp "$BUILD_DIR/metadata.json" "$EXTENSION_DIR/"
cp "$BUILD_DIR/extension.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/prefs.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/sources.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/rendering.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/display_adapter.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/randomization.js" "$EXTENSION_DIR/"
cp "$BUILD_DIR/prefs_about.js" "$EXTENSION_DIR/"
cp -r "$BUILD_DIR/schemas" "$EXTENSION_DIR/"

echo "Compiling schemas for local installation..."
glib-compile-schemas "$EXTENSION_DIR/schemas/"

echo "========================================="
echo "Upload package created at: $PACKAGE_PATH"
echo "Extension installed locally to: $EXTENSION_DIR"
echo "========================================="
echo "To enable locally, run:"
echo "  gnome-extensions enable $UUID"
echo "Note: If you are on Wayland, you may need to log out and log back in."