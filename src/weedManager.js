import * as PIXI from 'pixi.js';
import { Dialog } from './ui/dialog.js';

export class WeedManager {
    // app: PIXI.Application, world: PIXI.Container (world), player: PIXI.Container (player), terrain: optional Terrain
    constructor(app, world, player, terrain = null) {
        this.app = app;
        this.world = world;
        this.player = player;
        this.terrain = terrain;

        this.weeds = []; // { container, text, x, y, label, bg, graphic, completed, hits, strike, check }
        this.dialog = new Dialog(this.addWeed.bind(this));

        // active water particles
        this._waters = []; // { gfx, start, target, elapsed, dur, weed }

        // splash remnants (fade & auto-remove)
        this._splashes = []; // { gfx, elapsed, dur }

        this.initAddWeedButton();
    }

    initAddWeedButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = '+';
        Object.assign(btn.style, {
            position: 'fixed',
            left: '18px',
            top: '18px',
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            background: '#2e8b57',
            color: '#fff',
            fontSize: '28px',
            border: 'none',
            cursor: 'pointer',
            zIndex: 9999,
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        });
        btn.title = 'Add Weed (opens dialog)';

        // open dialog then immediately remove focus so SPACE/Enter won't retrigger the button
        btn.addEventListener('click', () => {
            this.dialog.open();
            // blur asynchronously to ensure click handling completes then remove focus
            setTimeout(() => btn.blur(), 0);
        });

        // Prevent spacebar from activating while the button is focused (extra safety)
        btn.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        document.body.appendChild(btn);
        this.addWeedButton = btn;
    }

    // dialog -> calls this with the text
    addWeed(text) {
        if (!text) return;

        // spawn near player x, prefer ground if terrain available
        const px = this.player?.x ?? (this.app.renderer.width / 2);
        let spawnX = px + (Math.random() * 200 - 100);
        const groundY = this.terrain ? this.terrain.groundY(spawnX) : (this.player?.y ?? (this.app.renderer.height / 2)) + 80;
        let spawnY = groundY - 8;

        // simple non-overlap: n attempts to find a free spot
        let tries = 0;
        while (this.weeds.some(w => this._distance(w.x, w.y, spawnX, spawnY) < 64) && tries++ < 20) {
            spawnX += (Math.random() * 200 - 100);
            if (this.terrain) spawnY = this.terrain.groundY(spawnX) - 8;
        }

        // build a small PIXI container for the weed
        const c = new PIXI.Container();
        c.x = spawnX;
        c.y = spawnY;

        // simple plant graphics (replace with sprite if you have art)
        const plant = new PIXI.Graphics();
        plant.beginFill(0x2e8b57);
        plant.drawEllipse(0, -6, 10, 6); // leaves
        plant.endFill();
        plant.beginFill(0x1f5f2e);
        plant.drawRect(-2, -18, 4, 12); // stem
        plant.endFill();
        c.addChild(plant);

        // hidden label / thought bubble text (shown when player is near)
        const label = new PIXI.Text(text, {
            fontSize: 12,
            fill: 0x111111,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 200,
        });
        label.anchor = new PIXI.Point(0.5, 1);
        label.x = 0;
        label.y = -26;
        label.visible = false;

        // simple background for readability
        const bg = new PIXI.Graphics();
        // bg will be drawn/updated when label is shown
        bg.visible = false;

        // strike-through graphic (hidden until completed)
        const strike = new PIXI.Graphics();
        strike.visible = false;

        // checkmark (hidden until completed)
        const check = new PIXI.Text('✔', { fontSize: 14, fill: 0x2e8b57 });
        check.anchor.set(0.5, 0.5);
        check.visible = false;
        check.x = 18;
        check.y = -26;

        c.addChild(bg);
        c.addChild(label);
        c.addChild(strike);
        c.addChild(check);

        this.world.addChild(c);
        this.weeds.push({ container: c, text, x: spawnX, y: spawnY, label, bg, graphic: plant, completed: false, hits: 0, strike, check });
    }

    _distance(x1, y1, x2, y2) {
        const dx = x1 - x2, dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Start watering the nearest weed within range. This spawns a flood of water
    // from the player's "head" to the weed. Called by main on E press.
    startWatering() {
        if (!this.player) return;
        // find nearest non-completed weed within range
        const px = this.player.x, py = this.player.y;
        let best = null;
        let bestD = Infinity;
        for (const w of this.weeds) {
            if (w.completed) continue;
            const d = this._distance(px, py, w.x, w.y);
            if (d < bestD) { bestD = d; best = w; }
        }
        if (!best || bestD > 200) return; // too far to water

        // spawn several water particles aimed at the weed
        const particles = 18;
        for (let i = 0; i < particles; i++) {
            const start = { x: px + (Math.random() * 6 - 3), y: py - 36 + (Math.random() * 8 - 4) };
            const target = { x: best.x + (Math.random() * 20 - 10), y: best.y - 4 + (Math.random() * 8 - 4) };
            const dur = 0.3 + Math.random() * 0.35;

            const g = new PIXI.Graphics();
            g.beginFill(0x4EAFFC);
            g.drawRect(-2, 0, 4, 12);
            g.endFill();
            g.x = start.x;
            g.y = start.y;
            g.rotation = 0.2 - Math.random() * 0.4;
            g.alpha = 0.95;
            // add to world (so it follows camera/transforms like other world objects)
            this.world.addChild(g);

            this._waters.push({ gfx: g, start, target, elapsed: 0, dur, weed: best });
        }
    }

    // convert weed into a flower (visuals + mark completed)
    _bloom(weed) {
        if (weed.completed) return;
        weed.completed = true;

        // remove old plant graphic and create flower
        if (weed.graphic && weed.graphic.parent) weed.graphic.destroy({ children: true, texture: false, baseTexture: false });
        const flower = new PIXI.Container();
        // petals
        for (let i = 0; i < 5; i++) {
            const p = new PIXI.Graphics();
            p.beginFill(0xFF8FB3);
            p.drawEllipse(0, -6, 10, 6);
            p.endFill();
            p.rotation = (i / 5) * Math.PI * 2;
            p.x = 0;
            p.y = -8;
            flower.addChild(p);
        }
        // center
        const core = new PIXI.Graphics();
        core.beginFill(0xFFD24D);
        core.drawCircle(0, -8, 6);
        core.endFill();
        flower.addChild(core);

        // add small sparkle
        const sparkle = new PIXI.Graphics();
        sparkle.beginFill(0xFFFFFF, 0.9);
        sparkle.drawCircle(-6, -14, 2);
        sparkle.endFill();
        flower.addChild(sparkle);

        weed.container.addChildAt(flower, 0);
        weed.flower = flower;

        // mark label as completed: dim text, show strike-through and checkmark
        weed.label.style = Object.assign({}, weed.label.style, { fill: 0x666666 });
        weed.strike.clear();
        weed.strike.visible = true;
        const lw = weed.label.width;
        const ly = weed.label.y - (weed.label.style.fontSize ?? 12) / 2;
        weed.strike.lineStyle(2, 0x666666);
        weed.strike.moveTo(-lw / 2, ly);
        weed.strike.lineTo(lw / 2, ly);

        weed.check.visible = true;
    }

    // call each frame from your main loop
    update(dtSec = null) {
        // dtSec optional for testing; otherwise compute from app.ticker
        const dt = (dtSec != null) ? dtSec : (this.app.ticker ? this.app.ticker.deltaMS / 1000 : 1 / 60);

        if (!this.player) return;
        const px = this.player.x, py = this.player.y;
        for (const w of this.weeds) {
            const d = this._distance(px, py, w.x, w.y);
            const show = d < 110; // proximity threshold
            if (show && !w.label.visible) {
                // show bubble
                w.label.visible = true;
                w.bg.visible = true;
                // regenerate bg to match label size
                w.bg.clear();
                w.bg.beginFill(0xffffff, 0.95);
                w.bg.drawRoundedRect(-w.label.width / 2 - 6, w.label.y - 18, w.label.width + 12, 18, 6);
                w.bg.endFill();
            } else if (!show && w.label.visible) {
                w.label.visible = false;
                w.bg.visible = false;
            }
        }

        // update water particles
        for (let i = this._waters.length - 1; i >= 0; i--) {
            const p = this._waters[i];
            p.elapsed += dt;
            const t = Math.min(1, p.elapsed / p.dur);
            // simple ease-out
            const et = 1 - Math.pow(1 - t, 2.2);
            p.gfx.x = p.start.x + (p.target.x - p.start.x) * et;
            p.gfx.y = p.start.y + (p.target.y - p.start.y) * et;
            p.gfx.alpha = 0.95 * (1 - t * 0.8);
            if (t >= 1) {
                // impact
                try {
                    // small splash graphic that will be faded/removed by the manager update loop
                    const s = new PIXI.Graphics();
                    s.beginFill(0x4EAFFC, 0.95);
                    s.drawCircle(p.target.x, p.target.y, 6 + Math.random() * 4);
                    s.endFill();
                    s.alpha = 1;
                    this.world.addChild(s);
                    // track splash for timed fade-out
                    this._splashes.push({ gfx: s, elapsed: 0, dur: 0.9 + Math.random() * 0.6 });
                } catch (e) { /* ignore ticker errors */ }

                // count hit on weed
                p.weed.hits = (p.weed.hits || 0) + 1;
                // remove particle gfx
                if (p.gfx && p.gfx.parent) p.gfx.destroy();
                this._waters.splice(i, 1);

                // threshold to bloom (few hits)
                if (p.weed.hits >= 6) {
                    this._bloom(p.weed);
                }
            }
        }

        // update splashes: fade and remove after duration
        for (let i = this._splashes.length - 1; i >= 0; i--) {
            const s = this._splashes[i];
            s.elapsed += dt;
            const t = Math.min(1, s.elapsed / s.dur);
            if (s.gfx && s.gfx.parent) s.gfx.alpha = 1 - t;
            if (s.elapsed >= s.dur) {
                if (s.gfx && s.gfx.parent) s.gfx.destroy();
                this._splashes.splice(i, 1);
            }
        }
    }
}

export default WeedManager;