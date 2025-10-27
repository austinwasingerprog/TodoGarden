import * as PIXI from 'pixi.js';

export class Controls {
    constructor(app, opts = {}) {
        this.app = app;
        // snap renderer to integer pixels to avoid sub-pixel blurring
        try { this.app.renderer.roundPixels = true; } catch (e) { /* ignore */ }
        // ensure high-res text textures on HiDPI displays
        this.dpi = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
        this.container = new PIXI.Container();
        this.container.zIndex = 10000;
        this.container.interactive = false;

        this.margin = opts.margin ?? 12;
        this._resizeHandler = this.resize.bind(this);

        // appearance
        this.bgAlpha = opts.bgAlpha ?? 0.22;
        this.spacing = opts.spacing ?? 8;
        this.barPaddingX = opts.barPaddingX ?? 14;
        this.barPaddingY = opts.barPaddingY ?? 8;

        // text style shared by all items
        this.style = new PIXI.TextStyle({
            fontFamily: opts.fontFamily ?? 'Arial, sans-serif',
            fontSize: opts.fontSize ?? 14,
            fill: opts.fill ?? 0xffffff,
            align: 'center',
            dropShadow: true,
            dropShadowAlpha: 0.55,
            dropShadowDistance: 1,
            lineHeight: opts.lineHeight ?? 18,
        });

        // containers for per-item bg and text
        this._items = []; // { bg: Graphics, text: PIXI.Text, boxW, boxH }

        // parse initial text/items (compat: split on '|' if passed single text)
        const raw = opts.text ?? 'press [E] to water (complete) a weed';
        const parts = Array.isArray(opts.items) ? opts.items.slice() :
            (typeof raw === 'string' ? raw.split('|').map(s => s.trim()).filter(Boolean) : [String(raw)]);

        // build visuals
        this._buildItems(parts);

        // add to stage (fixed to screen)
        this.app.stage.addChild(this.container);

        // initial layout (resize driven by main so we don't duplicate listeners)
        this.resize();
    }

    _buildItems(parts) {
        // clear any existing children and items
        for (const it of this._items) {
            if (it.bg && it.bg.parent) it.bg.parent.removeChild(it.bg);
            if (it.text && it.text.parent) it.text.parent.removeChild(it.text);
            if (it.bg) it.bg.destroy({ children: true, texture: false, baseTexture: false });
            if (it.text) it.text.destroy();
        }
        this._items.length = 0;

        for (const p of parts) {
            const bg = new PIXI.Graphics();
            bg.interactive = false;
            // text
            const txt = new PIXI.Text(p, this.style);
            // render text at device pixel resolution and snap to integer pixels
            try { txt.resolution = this.dpi; } catch (e) { /* ignore */ }
            txt.roundPixels = true;
            txt.anchor.set(0.5, 0.5);
            txt.interactive = false;

            // add bg first (so it sits behind text)
            this.container.addChild(bg);
            this.container.addChild(txt);

            this._items.push({ bg, text: txt, boxW: 0, boxH: 0 });
        }
    }

    setText(txt) {
        // accept either array or string (split on '|' for legacy)
        let parts;
        if (Array.isArray(txt)) parts = txt.slice();
        else if (typeof txt === 'string') parts = txt.split('|').map(s => s.trim()).filter(Boolean);
        else parts = [String(txt)];
        this._buildItems(parts);
        this.resize();
    }

    resize() {
        const w = this.app.renderer.width;
        const h = this.app.renderer.height;

        // measure each text and compute box sizes
        for (const it of this._items) {
            const tw = it.text.width;
            const th = it.text.height;
            it.boxW = Math.max(120, tw + this.barPaddingX * 2);
            it.boxH = Math.max(28, th + this.barPaddingY * 2);
        }

        // total stacked height
        const totalHeight = this._items.reduce((s, it) => s + it.boxH, 0) + Math.max(0, this._items.length - 1) * this.spacing;

        // position container centered at bottom
        this.container.x = Math.round(w / 2);
        this.container.y = Math.round(h - this.margin - totalHeight / 2);

        // draw each item stacked vertically (top -> bottom)
        let y = -totalHeight / 2;
        for (const it of this._items) {
            const { bg, text, boxW, boxH } = it;
            const cx = 0;
            const cy = Math.round(y + boxH / 2);

            // draw bg centered at (cx, cy)
            bg.clear();
            bg.beginFill(0x000000, 1);
            bg.drawRoundedRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 8);
            bg.endFill();
            bg.alpha = this.bgAlpha;

            // position text centered inside box
            text.x = cx;
            text.y = cy;

            y += boxH + this.spacing;
        }
    }

    destroy() {
        // resize listener removed — main owns resize lifecycle now
        if (this.container.parent) this.container.parent.removeChild(this.container);
        // destroy item graphics & texts
        for (const it of this._items) {
            if (it.bg && it.bg.parent) it.bg.parent.removeChild(it.bg);
            if (it.text && it.text.parent) it.text.parent.removeChild(it.text);
            if (it.bg) it.bg.destroy({ children: true, texture: false, baseTexture: false });
            if (it.text) it.text.destroy();
        }
        this._items.length = 0;
        this.container.destroy({ children: true, texture: false, baseTexture: false });
    }
}

export default Controls;