# ==============================================================================
# Wallshuffle Extension Makefile
# ==============================================================================

UUID = wallshuffle@cwittenberg
BUILD_DIR = build
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
PROJECT_DIR = $(shell pwd)
PACKAGE_PATH = $(PROJECT_DIR)/$(BUILD_DIR)/$(UUID).shell-extension.zip

# Custom ESM modules that must be explicitly packed
EXTRA_SOURCES = sources.js rendering.js display_adapter.js randomization.js prefs_about.js

# Schema variables
SCHEMAS_DIR = schemas
SCHEMA_FILE = $(SCHEMAS_DIR)/org.gnome.shell.extensions.wallshuffle.gschema.xml
COMPILED_SCHEMA = $(SCHEMAS_DIR)/gschemas.compiled

.PHONY: all build pack install clean

all: build

build: $(COMPILED_SCHEMA) pack

# Compile the XML schema into a binary glib schema
$(COMPILED_SCHEMA): $(SCHEMA_FILE)
	@echo "  Compiling schemas..."
	glib-compile-schemas --strict $(SCHEMAS_DIR)/

# Pack the extension
pack: $(COMPILED_SCHEMA)
	@echo "  Preparing build directory..."
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)/schemas
	cp metadata.json extension.js prefs.js sources.js rendering.js display_adapter.js randomization.js prefs_about.js $(BUILD_DIR)/
	cp -r schemas/* $(BUILD_DIR)/schemas/
	rm -f $(BUILD_DIR)/schemas/gschemas.compiled
	@echo "  Packing extension for EGO submission..."
	gnome-extensions pack $(BUILD_DIR) \
		$(foreach src, $(EXTRA_SOURCES), --extra-source=$(src)) \
		--extra-source=schemas \
		--force
	mv $(UUID).shell-extension.zip $(PACKAGE_PATH)
	@echo "  Created $(PACKAGE_PATH)"

# Install locally for testing by bypassing gnome-extensions install
install: pack
	@echo "  Installing locally to $(EXTENSION_DIR)..."
	rm -rf $(EXTENSION_DIR)
	mkdir -p $(EXTENSION_DIR)
	cp $(BUILD_DIR)/metadata.json $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/extension.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/prefs.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/sources.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/rendering.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/display_adapter.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/randomization.js $(EXTENSION_DIR)/
	cp $(BUILD_DIR)/prefs_about.js $(EXTENSION_DIR)/
	cp -r $(BUILD_DIR)/schemas $(EXTENSION_DIR)/
	glib-compile-schemas $(EXTENSION_DIR)/schemas/
	@echo "  Attempting to enable $(UUID)... (Ignoring GNOME's validation error)"
	-gnome-extensions enable $(UUID).shell-extension.zip
	@echo "  Install script finished."

# Clean up built artifacts
clean:
	@echo "  Cleaning up..."
	rm -rf $(BUILD_DIR)
	rm -f *.shell-extension.zip
	rm -f $(COMPILED_SCHEMA)
	@echo "  Workspace clean."