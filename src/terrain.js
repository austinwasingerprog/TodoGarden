import * as PIXI from 'pixi.js';
const { Graphics, Container } = PIXI;

/**
 * Terrain using 1D Perlin noise for smooth, gently-varying hills.
 * - height function is deterministic, uses seeded permutation for Perlin.
 * - renderer and collision use the same function (groundY).
 * - options: wavelength (px per hill), ampPixels (height), sampleStep (px sampling),
 *   chunkWidthPx, seed, octaves.
 */
export class Terrain {
    constructor(app, opts = {}) {
        this.app = app;
        this.container = new Container();

        // options with sensible defaults oriented to user's request for ~100px wide/tall hills
        this.wavelength = opts.wavelength ?? 100;       // px per hill (lower -> tighter hills)
        this.ampPixels = opts.ampPixels ?? 100;         // px amplitude (hill height)
        this.sampleStep = Math.max(4, opts.sampleStep ?? 8); // px between rendered samples
        this.chunkWidthPx = opts.chunkWidthPx ?? 512;
        this.viewDistanceChunks = opts.viewDistanceChunks ?? 3;
        this.seed = Number.isFinite(opts.seed) ? opts.seed | 0 : 0;
        this.octaves = Math.max(1, opts.octaves ?? 3);  // multi-octave for richness

        // build permutation table from seed
        this._buildPerm(this.seed);

        this.chunks = new Map();
    }

    // seeded PRNG (mulberry32)
    _rng(seed) {
        let t = seed >>> 0;
        return function () {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    _buildPerm(seed) {
        const rng = this._rng(seed + 1);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        // Fisher-Yates shuffle
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
        }
        // duplicate to avoid overflow
        this.perm = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }

    // fade function 6t^5 - 15t^4 + 10t^3
    _fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    // linear interpolate
    _lerp(a, b, t) {
        return a + t * (b - a);
    }

    // gradient for 1D (returns dot(grad, x))
    _grad(hash, x) {
        // use hash low bit to pick +1/-1
        return ((hash & 1) === 0) ? x : -x;
    }

    // 1D Perlin noise at coordinate x (not worldX; caller may scale)
    _perlin1d(x) {
        const xi = Math.floor(x) & 255;
        const xf = x - Math.floor(x);

        const a = this.perm[xi];
        const b = this.perm[xi + 1];

        const u = this._fade(xf);

        const g1 = this._grad(a, xf);
        const g2 = this._grad(b, xf - 1);

        return this._lerp(g1, g2, u); // range ~[-1,1]
    }

    // octave Perlin (normalized to [-1,1])
    _octaveNoise(x) {
        let amplitude = 1;
        let frequency = 1;
        let maxAmp = 0;
        let total = 0;
        for (let o = 0; o < this.octaves; o++) {
            total += this._perlin1d(x * frequency) * amplitude;
            maxAmp += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return total / maxAmp;
    }

    // core height function used by renderer & collision (worldX in pixels)
    heightForX(worldX) {
        const h = this.app.renderer.height;
        const baseY = h * 0.6; // keep roughly centered; caller can adjust by moving camera if needed

        // convert pixels -> noise domain: wavelength px per cycle -> freq = 1/wavelength
        const freq = 1 / this.wavelength;
        const n = this._octaveNoise(worldX * freq);

        // small gentle extra ripple to avoid perfectly smooth sine-like look
        const ripple = Math.sin(worldX * 0.02 + this.seed) * (this.ampPixels * 0.03);

        return baseY + n * this.ampPixels + ripple;
    }

    // public collision API
    groundY(worldX) {
        return this.heightForX(worldX);
    }

    // generate a chunk polygon and cache it
    generateChunk(chunkIndex) {
        if (this.chunks.has(chunkIndex)) return;
        const g = new Graphics();
        g.zIndex = 0;

        const startX = chunkIndex * this.chunkWidthPx;
        const endX = startX + this.chunkWidthPx;

        // sample across chunk using sampleStep
        const pts = [];
        for (let x = startX; x <= endX; x += this.sampleStep) {
            pts.push({ x, y: this.heightForX(x) });
        }
        // ensure end included
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

        // subtle ridge highlight
        g.beginFill(0xffffff, 0.06);
        const band = Math.min(20, this.ampPixels * 0.15);
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5 + band * 0.35;
            g.moveTo(mx - this.sampleStep * 0.4, my);
            g.lineTo(mx + this.sampleStep * 0.4, my);
        }
        g.endFill();

        this.container.addChild(g);
        this.chunks.set(chunkIndex, g);
    }

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

    updateForX(playerX) {
        const chunkIndex = Math.floor(playerX / this.chunkWidthPx);
        for (let i = -this.viewDistanceChunks; i <= this.viewDistanceChunks; i++) {
            this.generateChunk(chunkIndex + i);
        }
        this.pruneChunks(chunkIndex);
    }
}