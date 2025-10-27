import * as PIXI from 'pixi.js';
const { Container, Graphics } = PIXI;

/**
 * Parallax background: sky + clouds + layered mountains.
 * - Clouds are simple white blobs that parallax slower than world.
 * - Mountains are drawn as filled polygons; a lighter top-band highlights ridges.
 */
export class Background {
    constructor(app, opts = {}) {
        this.app = app;
        this.container = new Container();

        this.skyColor = opts.skyColor ?? 0x87CEFF;

        this.mountainConfigs = opts.mountainConfigs ?? [
            { parallax: 0.2, color: 0x1f4f8a, peaks: 6, verticalBias: 0.25 },
            { parallax: 0.45, color: 0x275f9e, peaks: 8, verticalBias: 0.35 },
            { parallax: 0.75, color: 0x3b6fae, peaks: 10, verticalBias: 0.5 },
        ];

        // sky then mountain layers (cloud groups will be inserted after layers so we can place them between layers)
        this._sky = new Graphics();
        this.container.addChild(this._sky);

        this.layers = [];
        for (const cfg of this.mountainConfigs) {
            const layerContainer = new Container();
            this.container.addChild(layerContainer);
            const gA = new Graphics();
            const gB = new Graphics();
            const gC = new Graphics();
            layerContainer.addChild(gA, gB, gC);
            this.layers.push({
                container: layerContainer,
                gfxA: gA,
                gfxB: gB,
                gfxC: gC,
                parallax: cfg.parallax,
                color: cfg.color,
                peaks: cfg.peaks,
                verticalBias: cfg.verticalBias,
                tileWidth: 0,
                // cached params for redraw-on-scroll
                _baseIndex: null,
                _gap: null,
                _baseY: null,
                _h: null
            });
        }

        // cloud groups: far (behind mountains), mid (between mid & close mountains), front (in front of all)
        this._cloudGroups = [
            { name: 'far', container: new Container(), parallax: 0.12, count: opts.cloudFarCount ?? 10, scaleMin: 0.6, scaleMax: 1.0, alpha: 0.72, insertAfterLayer: -1 }, // behind all (insert after sky)
            { name: 'mid', container: new Container(), parallax: 0.28, count: opts.cloudMidCount ?? 12, scaleMin: 0.9, scaleMax: 1.6, alpha: 0.62, insertAfterLayer: 1 }, // between layer1 and layer2
            { name: 'front', container: new Container(), parallax: 0.55, count: opts.cloudFrontCount ?? 8, scaleMin: 1.4, scaleMax: 2.4, alpha: 0.48, insertAfterLayer: null } // in front of all mountains
        ];
        // each group's internal array of clouds (g, baseX, baseY)
        for (const g of this._cloudGroups) {
            g._items = [];
        }
    }

    // deterministic-ish helper for peak variation (keeps visuals stable across redraws)
    _peakOffset(x, seed = 0) {
        return Math.sin(x * 0.001 + seed) * 0.5 + 0.5;
    }

    // draw a simple cloud composed of multiple overlapping circles
    _drawCloud(g, scale = 1, opts = {}) {
        // opts: { seed, minCircles, maxCircles }
        g.clear();
        // simple local RNG if seed provided for nice repeatability when resizing
        let rnd = Math.random;
        if (Number.isFinite(opts.seed)) {
            let t = opts.seed >>> 0;
            rnd = () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = ((r >>> 0) / 4294967295); return r; };
        }

        const minC = opts.minCircles ?? 3;
        const maxC = opts.maxCircles ?? 6;
        const circles = minC + Math.floor(rnd() * (maxC - minC + 1));

        // draw several softly-alpha'd circles to create fluffy clouds.
        // use SCREEN blend mode so overlapping clouds don't darken (they stay soft/light).
        for (let i = 0; i < circles; i++) {
            // bias first circle toward origin
            const bias = i === 0 ? 0 : (10 + rnd() * 36);
            const cx = (i === 0 ? 0 : bias + (rnd() * 16 - 8)) * scale;
            const cy = (i === 0 ? 0 : (rnd() * 14 - 7)) * scale;
            const baseR = 12 + rnd() * 26;
            const r = baseR * scale * (1 - i * 0.06);
            const a = 0.28 + rnd() * 0.22; // softer per-circle alpha
            g.beginFill(0xffffff, a);
            g.drawCircle(cx, cy, r);
            g.endFill();
        }

        // soft outer shape for silhouette (low alpha ellipse)
        g.beginFill(0xffffff, 0.06 + rnd() * 0.06);
        g.drawEllipse(20 * scale, 0, 44 * scale, 18 * scale);
        g.endFill();

        // slight random rotation for variety (set on the graphic rather than here if desired)
        g.rotation = (rnd() * 6 - 3) * (Math.PI / 180);
        g.blendMode = PIXI.BLEND_MODES.SCREEN;
    }

    // redraw everything for current renderer size
    resize() {
        const w = this.app.renderer.width;
        const h = this.app.renderer.height;

        // fallback: keep renderer clear color same as sky so brief gaps never show black
        try { this.app.renderer.backgroundColor = this.skyColor; } catch (e) { /* ignore if readonly */ }

         // sky
         this._sky.clear();
        // draw slightly padded / integer-aligned rect to avoid sub-pixel gaps when resizing
        const pad = 4;
        const ww = Math.ceil(w) + pad * 2;
        const hh = Math.ceil(h) + pad * 2;
        this._sky.beginFill(this.skyColor);
        this._sky.drawRect(-pad, -pad, ww, hh);
        this._sky.endFill();

        // rebuild cloud groups and place them in the display list relative to mountain layers
        // remove existing cloud children and re-insert at desired depths
        for (const g of this._cloudGroups) {
            // clear previous items and container
            g.container.removeChildren();
            g._items.length = 0;
        }

        // insert cloud containers at the correct indices:
        // current children order: [sky, layer0, layer1, layer2, ...]
        // insertAfterLayer: -1 -> after sky (index 1), 1 -> after layer1 (index 3), null -> append (front)
        for (const group of this._cloudGroups) {
            if (group.insertAfterLayer === -1) {
                this.container.addChildAt(group.container, 1);
            } else if (Number.isInteger(group.insertAfterLayer)) {
                // compute index: sky is 0, layers start at 1; insert after layer N => index = 1 + N + 1
                const insertIndex = Math.min(this.container.children.length, 2 + group.insertAfterLayer);
                this.container.addChildAt(group.container, insertIndex);
            } else {
                this.container.addChild(group.container); // front
            }
        }

        // populate each group with clouds spanning -w .. 2w for safe parallax coverage
        for (const group of this._cloudGroups) {
            const span = w * 3;
            for (let i = 0; i < group.count; i++) {
                const g = new Graphics();
                const t = i / Math.max(1, group.count - 1);
                const scale = group.scaleMin + Math.random() * (group.scaleMax - group.scaleMin);
                // give each cloud a small seed so its internal layout is stable on redraw
                const seed = Math.floor((i + 1) * (group.parallax * 1000 + 13));
                this._drawCloud(g, scale, { seed, minCircles: 3, maxCircles: 7 });
                const baseX = -w + t * span + (Math.cos(i * 1.3 + group.parallax * 10) * 40 * (0.5 + Math.random()));
                const baseY = Math.max(30, h * (0.06 + Math.random() * 0.24) + Math.sin(i * 0.7 + group.parallax * 7) * 28);
                g.x = baseX;
                g.y = baseY;
                // let per-circle alpha control final density; still allow group alpha for global control
                g.alpha = group.alpha;
                group.container.addChild(g);
                group._items.push({ g, baseX, baseY, parallax: group.parallax });
            }
        }

        // draw tiled mountains (two tiles per layer so we can wrap infinitely)
        for (const layer of this.layers) {
            const gA = layer.gfxA;
            const gB = layer.gfxB;

            const peaks = Math.max(3, layer.peaks);
            const tileWidth = Math.max(Math.floor(w * 1.5), 800);
            layer.tileWidth = tileWidth;
            const gap = Math.max(48, Math.floor(tileWidth / peaks));
            layer._gap = gap;
            const baseY = h * (layer.verticalBias ?? 0.5);
            layer._baseY = baseY;
            layer._h = h;

            // initially draw three tiles centered at worldStart  -tileWidth, 0, +tileWidth so seams are correct
            this._drawMountainTile(layer, gA, -tileWidth, tileWidth);
            this._drawMountainTile(layer, gB, 0, tileWidth);
            this._drawMountainTile(layer, layer.gfxC, tileWidth, tileWidth);

            // mark base index so update() can detect camera crossing and redraw as needed
            layer._baseIndex = 0;

            // position tiles adjacent; actual world alignment occurs in update()
            gA.x = -tileWidth;
            gB.x = 0;
            layer.gfxC.x = tileWidth;
        }
    }

    // helper: draw one mountain tile using a worldStartX so adjacent tiles match exactly
    _drawMountainTile(layer, g, worldStartX, tileWidth) {
        const h = layer._h;
        const baseY = layer._baseY;
        const gap = layer._gap;
        g.clear();

        const peakPoints = [];
        for (let lx = 0; lx <= tileWidth; lx += gap) {
            const worldX = worldStartX + lx;
            const offset = (gap * 0.5) * (0.5 + Math.sin(worldX * 0.001) * 0.5);
            const peakX = lx + offset;
            const peakHeight = (0.12 + Math.abs(Math.sin(worldX * 0.013)) * 0.45) * h * 0.32;
            const peakY = baseY - peakHeight;
            peakPoints.push({ x: peakX, y: peakY, h: peakHeight, worldX });
        }

        // ensure exact edges to avoid sub-pixel seams:
        if (peakPoints.length >= 1) {
            // first point precisely at 0
            const firstWorld = worldStartX;
            const firstHeight = (0.12 + Math.abs(Math.sin(firstWorld * 0.013)) * 0.45) * h * 0.32;
            peakPoints[0].x = 0;
            peakPoints[0].y = baseY - firstHeight;
            // last point precisely at tileWidth
            const last = peakPoints[peakPoints.length - 1];
            const lastWorld = worldStartX + tileWidth;
            const lastHeight = (0.12 + Math.abs(Math.sin(lastWorld * 0.013)) * 0.45) * h * 0.32;
            last.x = tileWidth;
            last.y = baseY - lastHeight;
        }

        g.beginFill(layer.color);
        g.moveTo(peakPoints[0].x, h + 50);
        for (const p of peakPoints) g.lineTo(p.x, p.y);
        g.lineTo(peakPoints[peakPoints.length - 1].x, h + 50);
        g.lineTo(peakPoints[0].x, h + 50);
        g.closePath();
        g.endFill();
    }

    // Update parallax based on camera/world translation (cameraX is world container x)
    update(cameraX = 0) {
        // clouds: move with a layerOffset consistent with mountains (layerOffset = -cameraX * parallax)
        for (const group of this._cloudGroups) {
            const layerOffset = -cameraX * group.parallax;
            for (const c of group._items) {
                // move clouds opposite the camera; subtracting keeps direction consistent with mountains
                c.g.x = Math.round(c.baseX - layerOffset);
                c.g.y = c.baseY + Math.sin((cameraX + c.baseX) * 0.0008) * 6;
            }
        }

         // mountains: tile each layer and offset by parallax. Use modulo to wrap tile positions.
         for (const layer of this.layers) {
             const tileW = layer.tileWidth || (this.app.renderer.width * 1.5);
            // compute layer world-offset: layers should move opposite the camera,
            // and use pure world-aligned coordinates (no extra ad-hoc multiplier).
            const layerOffset = -cameraX * layer.parallax;
            const baseIndex = Math.floor(layerOffset / tileW);
            const baseStart = baseIndex * tileW;
            const offsetWithin = layerOffset - baseStart; // may be negative

             // if camera crossed a tile boundary, redraw three tiles (prev/current/next)
             if (layer._baseIndex !== baseIndex) {
                const prevStart = baseStart - tileW;
                this._drawMountainTile(layer, layer.gfxA, prevStart, tileW);           // prev
                this._drawMountainTile(layer, layer.gfxB, baseStart, tileW);          // current
                this._drawMountainTile(layer, layer.gfxC, baseStart + tileW, tileW);  // next
                 layer._baseIndex = baseIndex;
             }

             // place tiles so they wrap seamlessly (gfxB is the "current" tile at baseStart)
             // round to integers to avoid sub-pixel gaps
             layer.gfxA.x = Math.round(-offsetWithin - tileW);       // prev
             layer.gfxB.x = Math.round(-offsetWithin);               // current
             layer.gfxC.x = Math.round(-offsetWithin + tileW);       // next
         }
     }
 }