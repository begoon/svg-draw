# svg-draw task runner.
#
# Run `just` (or `just --list`) to see available recipes.

# Show available recipes.
default:
    @just --list

# Install dependencies.
install:
    bun install

# Run the local dev server with hot reload.
dev:
    bun --hot ./index.ts

# Build a single self-contained docs/index.html for GitHub Pages.
# Inlines CSS and JS so the entire app is one file.
# Commit and push the result; GitHub Pages serves from main:/docs.
build: clean
    bun build ./index.html --outdir docs --minify
    bun run scripts/inline-html.ts
    @echo ""
    @echo "Bundled into docs/index.html (single file)"
    @echo "  git add docs"
    @echo "  git commit -m 'build: refresh GitHub Pages bundle'"
    @echo "  git push"

# Remove the static build.
clean:
    rm -rf docs

# Preview the built site locally on http://localhost:8080.
serve-built: build
    bunx serve docs -l 8080
