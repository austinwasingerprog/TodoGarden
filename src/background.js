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
            const g = new Graphics();
            this.container.addChild(g);
            this.layers.push({ gfx: g, parallax: cfg.parallax, color: cfg.color, peaks: cfg.peaks, verticalBias: cfg.verticalBias });
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

        // draw mountains
        for (const layer of this.layers) {
            const g = layer.gfx;
            g.clear();

            const peaks = Math.max(3, layer.peaks);
            const gap = Math.max(64, Math.floor(w / peaks));
            const startX = -w;
            const endX = w * 2;
            const baseY = h * (layer.verticalBias ?? 0.5);

            // compute peaks
            const peakPoints = [];
            for (let x = startX; x <= endX; x += gap) {
                const offset = (gap * 0.5) * (0.5 + Math.sin(x * 0.001) * 0.5);
                const peakX = x + offset;
                const peakHeight = (0.12 + Math.abs(Math.sin(x * 0.013)) * 0.45) * h * 0.32;
                const peakY = baseY - peakHeight;
                peakPoints.push({ x: peakX, y: peakY, h: peakHeight });
            }

            // main mountain polygon
            g.beginFill(layer.color);
            g.moveTo(peakPoints[0].x, h + 50);
            for (const p of peakPoints) g.lineTo(p.x, p.y);
            g.lineTo(peakPoints[peakPoints.length - 1].x, h + 50);
            g.lineTo(peakPoints[0].x, h + 50);
            g.closePath();
            g.endFill();

            // lighter band along the top ridge (simple polygon using a small offset below peaks)
            g.beginFill(0xffffff, 0.12); // subtle highlight
            const bandOffsetFactor = 0.18; // fraction of peak height used for band thickness
            g.moveTo(peakPoints[0].x, peakPoints[0].y + peakPoints[0].h * bandOffsetFactor);
            for (const p of peakPoints) g.lineTo(p.x, p.y + p.h * bandOffsetFactor);
            // mirror back across the band to create a thin filled strip
            for (let i = peakPoints.length - 1; i >= 0; i--) {
                const p = peakPoints[i];
                g.lineTo(p.x, p.y + Math.min(p.h * (bandOffsetFactor + 0.08), p.h * 0.45) + 2);
            }
            g.closePath();
            g.endFill();
        }
    }

    // Update parallax based on camera/world translation (cameraX is world container x)
    update(cameraX = 0) {
        // clouds: move opposite cameraX by small factor
        for (const c of this._clouds) {
            c.g.x = c.baseX + cameraX * c.parallax;
            // optional gentle vertical bob
            c.g.y = c.baseY + Math.sin((cameraX + c.baseX) * 0.0008) * 6;
        }

        // mountains: move each layer by its parallax factor
        for (const layer of this.layers) {
            layer.gfx.x = cameraX * layer.parallax * 0.6;
        }
    }
}