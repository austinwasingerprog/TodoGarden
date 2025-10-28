import * as PIXI from 'pixi.js';
const { Container, Graphics } = PIXI;

/**
 * Background (refactored)
 * - Constructor: pure setup (creates containers/graphics). No implicit resize().
 * - World coords: mountains drawn using worldTileWidth and worldHeight so they don't "scrunch" on viewport resize.
 * - resize(viewW, viewH): short, updates visible/sky sizes and repositions UI-visible items only.
 * - update(cameraX): moves clouds & mountains; redraws mountain tiles ONLY when the camera crosses tile boundaries.
 *
 * Usage:
 *   const bg = new Background(app, opts);
 *   bg.resize(app.screen.width, app.screen.height); // call from main when viewport changes
 *   bg.update(player.x); // each frame
 */
export class Background {
    constructor(app, opts = {}) {
        this.app = app;
        this.container = new Container();

        // appearance
        this.skyColor = opts.skyColor ?? 0x87CEFF;

        // world-stable parameters (do not change on viewport resize unless you intentionally want to)
        this.worldHeight = Number.isFinite(opts.worldHeight) ? opts.worldHeight : 900;
        this.worldTileWidth = Number.isFinite(opts.worldTileWidth) ? opts.worldTileWidth : 2048;
        this.worldPeaksBase = opts.worldPeaksBase ?? 8;

        // mountain layer configs (parallax 0..1)
        this.mountainConfigs = opts.mountainConfigs ?? [
            { parallax: 0.2, color: 0x1f4f8a, peaks: 6, verticalBias: 0.25 },
            { parallax: 0.45, color: 0x275f9e, peaks: 8, verticalBias: 0.35 },
            { parallax: 0.75, color: 0x3b6fae, peaks: 10, verticalBias: 0.5 },
        ];

        // cloud groups config (z-ordering defined by insertion order)
        this._cloudGroupsConfig = [
            { name: 'far', parallax: 0.12, count: opts.cloudFarCount ?? 10, scaleMin: 0.6, scaleMax: 1.0, alpha: 0.72, insertAfterLayer: -1 },
            { name: 'mid', parallax: 0.28, count: opts.cloudMidCount ?? 12, scaleMin: 0.9, scaleMax: 1.6, alpha: 0.62, insertAfterLayer: 1 },
            { name: 'front', parallax: 0.55, count: opts.cloudFrontCount ?? 8, scaleMin: 1.4, scaleMax: 2.4, alpha: 0.48, insertAfterLayer: null },
        ];

        // core display nodes
        this._sky = new Graphics();
        this.container.addChild(this._sky);

        this.layers = [];       // each: { cfg, container, gfx[3], tileWidth, gap, baseY, h, baseIndex }
        this._cloudGroups = []; // each: { cfg, container, items: [{g, baseX, baseY, parallax}] }

        // create containers & graphics. Do not rely on viewport here.
        this._setupLayers();
        this._setupCloudGroups();

        // last known view size (logical pixels)
        this._viewW = 0;
        this._viewH = 0;
    }

    // ----- setup helpers (constructor-time, world-stable) -----
    _setupLayers() {
        for (const cfg of this.mountainConfigs) {
            const layerContainer = new Container();
            // three gfx tiles: prev, current, next (we redraw them as camera crosses boundaries)
            const gfxPrev = new Graphics();
            const gfxCurr = new Graphics();
            const gfxNext = new Graphics();
            layerContainer.addChild(gfxPrev, gfxCurr, gfxNext);

            this.layers.push({
                cfg,
                container: layerContainer,
                gfx: [gfxPrev, gfxCurr, gfxNext],
                parallax: cfg.parallax,
                color: cfg.color,
                peaks: cfg.peaks ?? this.worldPeaksBase,
                verticalBias: cfg.verticalBias ?? 0.5,
                tileWidth: this.worldTileWidth,
                gap: 0,
                baseY: this.worldHeight * (cfg.verticalBias ?? 0.5),
                h: this.worldHeight,
                baseIndex: null
            });

            this.container.addChild(layerContainer);
        }

        // initial static draw of tiles at world start (0). These will be redrawn in update when camera moves.
        for (const layer of this.layers) {
            const tw = layer.tileWidth;
            this._drawMountainTile(layer, layer.gfx[0], -tw, tw);
            this._drawMountainTile(layer, layer.gfx[1], 0, tw);
            this._drawMountainTile(layer, layer.gfx[2], tw, tw);
            layer.gfx[0].x = -tw;
            layer.gfx[1].x = 0;
            layer.gfx[2].x = tw;
            layer.baseIndex = 0;
        }
    }

    _setupCloudGroups() {
        for (const gcfg of this._cloudGroupsConfig) {
            const cont = new Container();
            cont.name = `clouds_${gcfg.name}`;
            this._cloudGroups.push({ cfg: gcfg, container: cont, items: [] });
        }

        // Insert cloud containers relative to mountains: deterministic order
        for (const group of this._cloudGroups) {
            const insertAfterLayer = group.cfg.insertAfterLayer;
            if (insertAfterLayer === -1) {
                this.container.addChildAt(group.container, 1); // after sky
            } else if (Number.isInteger(insertAfterLayer)) {
                const insertIndex = Math.min(this.container.children.length, 2 + insertAfterLayer);
                this.container.addChildAt(group.container, insertIndex);
            } else {
                this.container.addChild(group.container); // front
            }
        }
    }

    // deterministic-ish helper so adjacent tiles match when redrawn using worldStartX
    _rand(seed) {
        let t = seed >>> 0;
        return () => { t += 0x6D2B79F5; const r = Math.imul(t ^ (t >>> 15), 1 | t); return ((r >>> 0) / 4294967295); };
    }

    _drawCloud(g, scale = 1, seed = 0) {
        g.clear();
        const rnd = Number.isFinite(seed) ? this._rand(seed) : Math.random;
        const circles = 3 + Math.floor(rnd() * 5);
        for (let i = 0; i < circles; i++) {
            const cx = (i === 0 ? 0 : (10 + rnd() * 36) + (rnd() * 16 - 8)) * scale;
            const cy = (i === 0 ? 0 : (rnd() * 14 - 7)) * scale;
            const r = (12 + rnd() * 26) * scale * (1 - i * 0.06);
            const a = 0.22 + rnd() * 0.26;
            g.beginFill(0xffffff, a);
            g.drawCircle(cx, cy, r);
            g.endFill();
        }
        g.beginFill(0xffffff, 0.04 + Math.random() * 0.06);
        g.drawEllipse(20 * scale, 0, 44 * scale, 18 * scale);
        g.endFill();
        g.rotation = (Math.random() * 6 - 3) * (Math.PI / 180);
        g.blendMode = PIXI.BLEND_MODES.SCREEN;
    }

    resize(viewW = null, viewH = null) {
        const w = Number.isFinite(viewW) ? viewW : this.app.screen.width;
        const h = Number.isFinite(viewH) ? viewH : this.app.screen.height;
        this._viewW = w; this._viewH = h;

        // ensure renderer fallback color matches sky so brief gaps don't show black
        try { this.app.renderer.backgroundColor = this.skyColor; } catch (e) { /* ignore */ }

        // sky: draw slightly padded rectangle to avoid subpixel gaps
        const pad = 4;
        this._sky.clear();
        this._sky.beginFill(this.skyColor);
        this._sky.drawRect(-pad, -pad, Math.ceil(w) + pad * 2, Math.ceil(h) + pad * 2);
        this._sky.endFill();

        // Clouds: if first time or view got much wider, ensure clouds cover visible span.
        for (const group of this._cloudGroups) {
            const cfg = group.cfg;
            const span = Math.max(w * 3, this.worldTileWidth * 1.5);
            // if group empty, populate once; otherwise keep existing items and nudge base positions to fit
            if (group.items.length === 0) {
                for (let i = 0; i < cfg.count; i++) {
                    const g = new Graphics();
                    const t = i / Math.max(1, cfg.count - 1);
                    const scale = cfg.scaleMin + Math.random() * (cfg.scaleMax - cfg.scaleMin);
                    const seed = Math.floor((i + 1) * (cfg.parallax * 1000 + 13));
                    this._drawCloud(g, scale, seed);
                    const baseX = -w + t * span + (Math.cos(i * 1.3 + cfg.parallax * 10) * 40 * (0.5 + Math.random()));
                    const baseY = Math.max(30, this.worldHeight * (0.06 + Math.random() * 0.24) + Math.sin(i * 0.7 + cfg.parallax * 7) * 28);
                    g.x = baseX; g.y = baseY; g.alpha = cfg.alpha;
                    group.container.addChild(g);
                    group.items.push({ g, baseX, baseY, parallax: cfg.parallax });
                }
            } else {
                // adjust baseY for each item proportionally to new view height (visually only)
                for (const it of group.items) {
                    it.baseY = Math.max(20, this.worldHeight * 0.06 + (it.baseY - (this._viewH || h)) * 0.2);
                }
            }
        }

        for (const layer of this.layers) {
            layer.baseY = this.worldHeight * (layer.verticalBias ?? 0.5);
            layer.h = this.worldHeight;
        }
    }

    // ----- core drawing: mountain tile using worldStartX so adjacent tiles align exactly -----
    _drawMountainTile(layer, g, worldStartX, tileWidth) {
        const h = layer.h;
        const baseY = layer.baseY;
        const peaks = Math.max(3, layer.peaks);
        const gap = Math.max(32, Math.floor(tileWidth / peaks));
        layer.gap = gap;

        g.clear();
        const peakPoints = [];

        // sample points on [0..tileWidth] using world-aligned coordinates
        for (let lx = 0; lx <= tileWidth; lx += gap) {
            const worldX = worldStartX + lx;
            const offset = (gap * 0.5) * (0.5 + Math.sin(worldX * 0.001) * 0.5);
            const peakX = lx + offset;
            const peakHeight = (0.12 + Math.abs(Math.sin(worldX * 0.013)) * 0.45) * h * 0.32;
            const peakY = baseY - peakHeight;
            peakPoints.push({ x: peakX, y: peakY, h: peakHeight, worldX });
        }

        // snap exact edges to avoid seams
        if (peakPoints.length >= 1) {
            const firstWorld = worldStartX;
            const firstHeight = (0.12 + Math.abs(Math.sin(firstWorld * 0.013)) * 0.45) * h * 0.32;
            peakPoints[0].x = 0;
            peakPoints[0].y = baseY - firstHeight;
            const last = peakPoints[peakPoints.length - 1];
            const lastWorld = worldStartX + tileWidth;
            const lastHeight = (0.12 + Math.abs(Math.sin(lastWorld * 0.013)) * 0.45) * h * 0.32;
            last.x = tileWidth;
            last.y = baseY - lastHeight;
        }

        // draw polygon (world-space X within tile)
        g.beginFill(layer.color);
        g.moveTo(peakPoints[0].x, h + 50);
        for (const p of peakPoints) g.lineTo(p.x, p.y);
        g.lineTo(peakPoints[peakPoints.length - 1].x, h + 50);
        g.lineTo(peakPoints[0].x, h + 50);
        g.closePath();
        g.endFill();
    }

    // programmatic API: change world height intentionally (not a viewport resize)
    setWorldHeight(h) {
        if (!Number.isFinite(h)) return;
        this.worldHeight = h | 0;
        for (const layer of this.layers) {
            layer.baseY = this.worldHeight * (layer.verticalBias ?? 0.5);
            layer.h = this.worldHeight;
            // force full redraw next frame by clearing baseIndex so update will redraw tiles
            layer.baseIndex = null;
        }
    }

    // ----- update: pure movement & redraw on tile-boundary-cross only -----
    // cameraX = player's world X (positive to the right)
    update(cameraX = 0) {
        // move clouds (layerOffset = -cameraX * parallax). Clouds move opposite camera.
        for (const group of this._cloudGroups) {
            const layerOffset = -cameraX * group.cfg.parallax;
            for (const it of group.items) {
                it.g.x = Math.round(it.baseX - layerOffset);
                it.g.y = it.baseY + Math.sin((cameraX + it.baseX) * 0.0008) * 6;
            }
        }

        // mountains: compute layerOffset in world-space and redraw three tiles only when baseIndex changes
        for (const layer of this.layers) {
            const tileW = layer.tileWidth;
            const layerOffset = -cameraX * layer.parallax;
            const baseIndex = Math.floor(layerOffset / tileW);
            const baseStart = baseIndex * tileW;
            const offsetWithin = layerOffset - baseStart;

            if (layer.baseIndex !== baseIndex) {
                // redraw prev/current/next tiles aligned to world coordinates
                this._drawMountainTile(layer, layer.gfx[0], baseStart - tileW, tileW);
                this._drawMountainTile(layer, layer.gfx[1], baseStart, tileW);
                this._drawMountainTile(layer, layer.gfx[2], baseStart + tileW, tileW);
                layer.baseIndex = baseIndex;
            }

            // place tiles so they wrap seamlessly (round to integer pixels)
            layer.gfx[0].x = Math.round(-offsetWithin - tileW);
            layer.gfx[1].x = Math.round(-offsetWithin);
            layer.gfx[2].x = Math.round(-offsetWithin + tileW);
        }
    }
}

export default Background;