import * as PIXI from 'pixi.js';
const { Graphics, Container } = PIXI;

/**
 * Simple chunked terrain producing wide smooth hills.
 * - height function is a centered sine wave (plus tiny jitter) so visual hills are wide (~wavelength px).
 * - collision uses same height function (groundY).
 * - chunks are generated as a single polygon per chunk.
 */
export class Terrain {
    constructor(app, opts = {}) {
        this.app = app;
        this.container = new Container();

        // visual / collision parameters
        this.baseHeightPct = opts.baseHeightPct ?? 0.6;    // base ground height as fraction of screen
        this.tileSize = opts.tileSize ?? 16;               // kept for compatibility (not required)
        this.ampTiles = opts.ampTiles ?? 6;                // amplitude in tiles (converted below)
        this.ampPixels = (opts.ampPixels ?? (this.ampTiles * this.tileSize));
        this.wavelength = opts.wavelength ?? 500;          // desired width of a hill in pixels (default ~500)
        this.jitter = opts.jitter ?? 6;                    // small high-frequency jitter in pixels (visual only)

        // chunking
        this.chunkWidthPx = opts.chunkWidthPx ?? (this.tileSize * (opts.chunkTiles ?? 32));
        this.sampleStep = Math.max(8, opts.sampleStep ?? 16); // smaller => more points; 16 is fine for wide hills

        this.seed = opts.seed ?? 0;
        this.viewDistanceChunks = opts.viewDistanceChunks ?? 3;

        this.chunks = new Map();
    }

    // deterministic small pseudo-random jitter from x
    _jitterFor(x) {
        const n = Math.floor(x) + (this.seed * 374761393);
        let v = (n << 13) ^ n;
        v = (1.0 - ((v * (v * v * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);
        return v * this.jitter;
    }

    // height at world X in pixels (used by renderer and collision)
    heightForX(worldX) {
        const h = this.app.renderer.height;
        const baseY = h * this.baseHeightPct;

        // low-frequency sine for wide hills
        const phase = (worldX + this.seed) * (2 * Math.PI) / this.wavelength;
        const sine = Math.sin(phase);

        // tiny high-frequency jitter for visual texture (kept small)
        const jitter = this._jitterFor(Math.floor(worldX * 0.1)) * 0.5;

        return baseY + sine * this.ampPixels + jitter;
    }

    // collision sampling API (worldX in pixels)
    groundY(worldX) {
        return this.heightForX(worldX);
    }

    // generate a single chunk polygon and cache it
    generateChunk(chunkIndex) {
        if (this.chunks.has(chunkIndex)) return;
        const g = new Graphics();
        g.zIndex = 0;

        const startX = chunkIndex * this.chunkWidthPx;
        const endX = startX + this.chunkWidthPx;

        // build samples from start to end (include endpoints)
        const pts = [];
        for (let x = startX; x <= endX; x += this.sampleStep) {
            const y = this.heightForX(x);
            pts.push({ x, y });
        }
        // ensure final point is included
        if (pts.length === 0 || pts[pts.length - 1].x < endX) {
            pts.push({ x: endX, y: this.heightForX(endX) });
        }

        // main fill
        g.beginFill(0x4e944f);
        g.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) g.lineTo(p.x, p.y);
        g.lineTo(endX, this.app.renderer.height + 200);
        g.lineTo(startX, this.app.renderer.height + 200);
        g.closePath();
        g.endFill();

        // subtle lighter ridge band along the top (computed from same pts)
        g.beginFill(0xffffff, 0.08);
        const bandOffset = Math.min(24, this.ampPixels * 0.18);
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5 + bandOffset * 0.25;
            g.moveTo(mx - this.sampleStep * 0.4, my);
            g.lineTo(mx + this.sampleStep * 0.4, my);
        }
        g.endFill();

        this.container.addChild(g);
        this.chunks.set(chunkIndex, g);
    }

    // remove distant chunks
    pruneChunks(centerChunk) {
        for (const key of Array.from(this.chunks.keys())) {
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
        const chunkIndex = Math.floor(playerX / this.chunkWidthPx);
        for (let i = -this.viewDistanceChunks; i <= this.viewDistanceChunks; i++) {
            this.generateChunk(chunkIndex + i);
        }
        this.pruneChunks(chunkIndex);
    }
}