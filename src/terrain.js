import * as PIXI from 'pixi.js';
const { Graphics } = PIXI;

export class Terrain {
    constructor(app, opts = {}) {
        this.app = app;
        this.tileSize = opts.tileSize ?? 16;
        this.chunkTiles = opts.chunkTiles ?? 32; // columns per chunk
        this.seed = opts.seed ?? 12345;
        this.viewDistanceChunks = opts.viewDistanceChunks ?? 3; // how many chunks each side to keep
        this.chunks = new Map(); // chunkIndex -> Graphics
        this.container = new PIXI.Container();
        // NOTE: do not auto-add to app.stage here — caller may want to manage layering
        // this.app.stage.addChild(this.container);

        // height params
        this.baseHeightPct = opts.baseHeightPct ?? 0.6; // fraction of screen height
        this.noiseScale = opts.noiseScale ?? 0.05;
        this.ampTiles = opts.ampTiles ?? 6; // amplitude in tiles
    }

    // deterministic pseudo-random from integer x
    _hashNoise(i) {
        let n = i + (this.seed * 374761393);
        n = (n << 13) ^ n;
        return 1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0;
    }

    // smooth interpolated noise value in [-1,1]
    _smoothNoise(x) {
        const ix = Math.floor(x);
        const fx = x - ix;
        const v1 = this._hashNoise(ix);
        const v2 = this._hashNoise(ix + 1);
        // smoothstep/cosine interpolation
        const t = (1 - Math.cos(fx * Math.PI)) * 0.5;
        return v1 * (1 - t) + v2 * t;
    }

    // height in pixels for a given column index (integer column)
    heightForColumn(col) {
        const screenH = this.app.renderer.height;
        const baseY = screenH * this.baseHeightPct;
        const noise = this._smoothNoise(col * this.noiseScale);
        const ampPixels = this.ampTiles * this.tileSize;
        return baseY + noise * ampPixels;
    }

    // worldX in pixels -> ground Y in pixels
    groundY(worldX) {
        const col = Math.floor(worldX / this.tileSize);
        return this.heightForColumn(col);
    }

    // generate a chunk at chunkIndex (chunkIndex can be negative)
    generateChunk(chunkIndex) {
        if (this.chunks.has(chunkIndex)) return;
        const g = new Graphics();
        g.zIndex = 0;

        const startCol = chunkIndex * this.chunkTiles;
        const pts = [];
        for (let i = 0; i <= this.chunkTiles; i++) {
            const col = startCol + i;
            const x = col * this.tileSize;
            const y = this.heightForColumn(col);
            pts.push({ x, y, col });
        }

        // Build polygon for top surface -> fill below to bottom of screen
        const baseColor = 0x4e944f;
        g.beginFill(baseColor);
        g.moveTo(pts[0].x, pts[0].y);
        for (let p of pts) g.lineTo(p.x, p.y);
        // down to bottom-right then bottom-left
        g.lineTo(pts[pts.length - 1].x, this.app.renderer.height + 100);
        g.lineTo(pts[0].x, this.app.renderer.height + 100);
        g.closePath();
        g.endFill();

        // Add per-column variation (vertical strips with slightly different greens)
        for (let i = 0; i < this.chunkTiles; i++) {
            const col = startCol + i;
            const x = col * this.tileSize;
            const y = this.heightForColumn(col);
            const shade = this._smoothNoise(col * 0.35);
            const color = shade > 0 ? 0x5da75b : 0x3b6f3b; // light/dark variation
            g.beginFill(color);
            // draw a strip from the top down a few tiles to create visible texture
            g.drawRect(x, y, this.tileSize, this.tileSize * (2 + Math.floor((shade + 1) * 1.5)));
            g.endFill();

            // small lighter grass fringe along the very top to accent movement
            const fringeH = 3;
            const grassColor = 0xa6ff9a;
            g.beginFill(grassColor);
            g.drawRect(x + 1, y - fringeH, this.tileSize - 2, fringeH);
            g.endFill();
        }

        // Optional deeper fill for solidity (darker below)
        g.beginFill(0x355c35);
        g.drawRect(pts[0].x, pts[0].y + this.tileSize * 3, this.chunkTiles * this.tileSize, this.app.renderer.height);
        g.endFill();

        this.container.addChild(g);
        this.chunks.set(chunkIndex, g);
    }

    // remove distant chunks
    pruneChunks(centerChunk) {
        for (let key of Array.from(this.chunks.keys())) {
            const idx = Number(key);
            if (Math.abs(idx - centerChunk) > this.viewDistanceChunks) {
                const g = this.chunks.get(idx);
                g.destroy({ children: true, texture: false, baseTexture: false });
                this.chunks.delete(idx);
            }
        }
    }

    // ensure chunks around playerX exist
    updateForX(playerX) {
        const chunkIndex = Math.floor(playerX / (this.tileSize * this.chunkTiles));
        for (let i = -this.viewDistanceChunks; i <= this.viewDistanceChunks; i++) {
            this.generateChunk(chunkIndex + i);
        }
        this.pruneChunks(chunkIndex);
    }
}