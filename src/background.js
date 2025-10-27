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

        // sky, clouds, then mountain layers
        this._sky = new Graphics();
        this.container.addChild(this._sky);

        this.cloudsContainer = new Container();
        this.container.addChild(this.cloudsContainer);

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

        // cloud data
        this._clouds = [];
        this._cloudCount = opts.cloudCount ?? 8;
    }

    // deterministic-ish helper for peak variation (keeps visuals stable across redraws)
    _peakOffset(x, seed = 0) {
        return Math.sin(x * 0.001 + seed) * 0.5 + 0.5;
    }

    // draw a simple cloud composed of 3 overlapping circles
    _drawCloud(g, scale = 1) {
        g.clear();
        g.beginFill(0xffffff);
        g.drawCircle(0, 0, 18 * scale);
        g.drawCircle(20 * scale, -6 * scale, 14 * scale);
        g.drawCircle(36 * scale, 0, 12 * scale);
        g.endFill();
    }

    // redraw everything for current renderer size
    resize() {
        const w = this.app.renderer.width;
        const h = this.app.renderer.height;

        // sky
        this._sky.clear();
        this._sky.beginFill(this.skyColor);
        this._sky.drawRect(0, 0, w, h);
        this._sky.endFill();

        // rebuild clouds (positions across a wider span)
        this.cloudsContainer.removeChildren();
        this._clouds = [];
        for (let i = 0; i < this._cloudCount; i++) {
            const g = new Graphics();
            const scale = 0.6 + (i % 3) * 0.25;
            this._drawCloud(g, scale);
            // spread across -w .. 2w so parallax has content when camera moves
            const baseX = -w + (i / this._cloudCount) * (w * 3) + (Math.cos(i * 1.3) * 40);
            const baseY = Math.max(40, h * (0.08 + (i % 3) * 0.06) + Math.sin(i * 0.7) * 30);
            g.x = baseX;
            g.y = baseY;
            g.alpha = 0.95;
            this.cloudsContainer.addChild(g);
            // store baseX and parallax factor for update
            this._clouds.push({ g, baseX, baseY, parallax: 0.25 + (i % 3) * 0.08 });
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
        // clouds: move opposite cameraX by small factor
        for (const c of this._clouds) {
            // clouds should move opposite the camera/player so they appear in the background
            c.g.x = c.baseX - cameraX * c.parallax;
            c.g.y = c.baseY + Math.sin((cameraX + c.baseX) * 0.0008) * 6;
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