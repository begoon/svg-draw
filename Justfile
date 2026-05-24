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

# Build the static site into ./docs for GitHub Pages.
# Commit and push the result; GitHub Pages serves from main:/docs.
build: clean
    bun build ./index.html --outdir docs --minify
    @echo ""
    @echo "Bundled into ./docs"
    @echo "  git add docs"
    @echo "  git commit -m 'build: refresh GitHub Pages bundle'"
    @echo "  git push"

# Remove the static build.
clean:
    rm -rf docs

# Preview the built site locally on http://localhost:8080.
serve-built: build
    bunx serve docs -l 8080
