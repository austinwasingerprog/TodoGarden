import * as PIXI from 'pixi.js';
import { Dialog } from './ui/dialog.js';
import { createBranchyWeed } from './plants/branchyWeed.js';
import { createFlowerBush } from './plants/flowerBush.js';

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

        this.storageKey = 'todo-garden-weeds-v1';

        this.initAddWeedButton();

        // load persisted weeds (if any)
        this._load();
    }

    initAddWeedButton() {
        // wrapper so we can add multiple small controls without overlapping
        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
            position: 'fixed',
            right: '18px',
            bottom: '18px',
            display: 'flex',
            flexDirection: 'row',
            gap: '8px',
            alignItems: 'center',
            zIndex: 9999,
            pointerEvents: 'auto'
        });

        // Add button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.innerHTML = '+';
        Object.assign(addBtn.style, {
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            background: '#2e8b57',
            color: '#fff',
            fontSize: '28px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        });
        addBtn.title = 'Add Weed (opens dialog)';
        addBtn.addEventListener('click', () => {
            this.dialog.open();
            setTimeout(() => addBtn.blur(), 0);
        });
        addBtn.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); }
        });
        wrap.appendChild(addBtn);
        this.addWeedButton = addBtn;

        // Clear button (delete all weeds) with confirmation
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.innerHTML = '🗑';
        Object.assign(clearBtn.style, {
            width: '48px',
            height: '48px',
            borderRadius: '10px',
            background: '#c94b4b',
            color: '#fff',
            fontSize: '20px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
        });
        clearBtn.title = 'Clear garden (remove all weeds & flowers)';
        clearBtn.addEventListener('click', () => {
            // confirm to avoid accidental wipe
            const ok = window.confirm('Clear the garden? This will remove all weeds and flowers.');
            if (!ok) return;
            this.clearAllWeeds();
            setTimeout(() => clearBtn.blur(), 0);
        });
        clearBtn.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); }
        });
        wrap.appendChild(clearBtn);
        this.clearGardenButton = clearBtn;

        document.body.appendChild(wrap);
        this._weedUiWrap = wrap;
    }

    // remove all weeds/flowers, clear particles, and persist empty state
    clearAllWeeds() {
        // destroy weed containers
        for (const w of this.weeds) {
            try {
                if (w.container && w.container.parent) this.world.removeChild(w.container);
                if (w.container && typeof w.container.destroy === 'function') w.container.destroy({ children: true, texture: false, baseTexture: false });
            } catch (e) {}
        }
        this.weeds.length = 0;

        // destroy water particles
        for (const p of this._waters) {
            try { if (p.gfx && p.gfx.parent) p.gfx.parent.removeChild(p.gfx); if (p.gfx) p.gfx.destroy(); } catch (e) {}
        }
        this._waters.length = 0;

        // destroy splashes
        for (const s of this._splashes) {
            try { if (s.gfx && s.gfx.parent) s.gfx.parent.removeChild(s.gfx); if (s.gfx) s.gfx.destroy(); } catch (e) {}
        }
        this._splashes.length = 0;

        // persist empty garden
        try {
            localStorage.removeItem(this.storageKey);
        } catch (e) {}
    }

    // public api: called by Dialog (text string)
    addWeed(text) {
        if (!text) return;
        // spawn near player if possible; _spawnWeed handles default positioning and overlap
        this._spawnWeed({ text, x: null, y: null, completed: false, hits: 0 });
        this._save();
    }

    // internal spawn helper: accepts partial record { text, x, y, completed, hits }
    _spawnWeed(record) {
        const text = record.text || 'Unnamed';
        // spawn near player x, prefer ground if terrain available; allow record.x to override
        const px = this.player?.x ?? (this.app.renderer.width / 2);
        let spawnX = (Number.isFinite(record.x) ? record.x : px + (Math.random() * 200 - 100));
        const groundY = this.terrain ? this.terrain.groundY(spawnX) : (this.player?.y ?? (this.app.renderer.height / 2)) + 80;
        // place container at exact ground Y so plant root (y=0) sits on terrain
        let spawnY = Number.isFinite(record.y) ? record.y : groundY;

        // simple non-overlap: n attempts to find a free spot (respect saved position but relocate if overlapping)
        let tries = 0;
        while (this.weeds.some(w => this._distance(w.x, w.y, spawnX, spawnY) < 64) && tries++ < 40) {
            spawnX += (Math.random() * 200 - 100);
            // recompute ground Y for the new X (consistent: no ad-hoc offsets here)
            if (this.terrain) spawnY = this.terrain.groundY(spawnX);
        }

        // build a small PIXI container for the weed
        const c = new PIXI.Container();
        c.x = spawnX;
        c.y = spawnY;

        // create procedural branchy weed (module) -- seed by text so same item is reproducible
        const plant = createBranchyWeed(record.text ?? 'weed', { baseLength: 16, leafSize: 8 });
        // make sure plant draws upward from y=0 (root at 0) and add into outer container
        plant.y = 0;
        if (plant.pivot && typeof plant.pivot.set === 'function') plant.pivot.set(0, 0);
        c.addChild(plant);

        // set outer container to sit exactly on the ground (plant root aligns to terrain)
        c.y = spawnY;

        // copy/mix-in sway params to the outer container so each weed gets its own unique animation
        if (plant && plant.sway) {
            // clone so different weeds don't share same object
            c.sway = Object.assign({}, plant.sway);
        } else {
            // fallback sway if plant doesn't provide one
            c.sway = { amp: 0.03, freq: 2, phase: Math.random() * Math.PI * 2, xAmp: 1.2 };
        }
        // add a per-weed random offset/phase so multiple weeds can be out of phase (opposite)
        c.sway.offset = (Math.random() * Math.PI * 2);
        // ensure pivot is at the base so rotation looks natural
        if (c.pivot && typeof c.pivot.set === 'function') c.pivot.set(0, 0);

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
        // position label just above the top of the plant using its bounds
        try {
            const b = plant.getLocalBounds();
            label.y = -(b.y + b.height) - 8; // top of plant plus small gap
        } catch (e) {
            label.y = -26;
        }
        label.visible = false;

        // simple background for readability
        const bg = new PIXI.Graphics();
        // bg will be drawn/updated when label is shown
        bg.visible = false;

        // strike-through graphic (hidden until completed)
        const strike = new PIXI.Graphics();
        strike.visible = false;

        // checkmark (hidden until completed)
        const check = new PIXI.Text('✔', { fontSize: 30, fill: 0x00FF00 });
        check.anchor.set(0.5, 0.5);
        check.visible = false;
        check.x = 18;
        check.y = -26;

        c.addChild(bg);
        c.addChild(label);
        c.addChild(strike);
        c.addChild(check);

        this.world.addChild(c);

        const weed = {
            container: c,
            text,
            x: spawnX,
            y: spawnY,
            label,
            bg,
            graphic: plant,
            completed: Boolean(record.completed),
            hits: Number.isFinite(record.hits) ? record.hits : 0,
            strike,
            check,
            flower: null
        };

        // if loaded and marked completed, immediately convert visuals to flower state
        if (weed.completed) {
            this._applyCompletedVisuals(weed);
        }

        this.weeds.push(weed);
    }

    _distance(x1, y1, x2, y2) {
        const dx = x1 - x2, dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // helper: compute player's visual "foot" Y (bottom of sprite) for interactions
    _playerFootY() {
        if (!this.player) return 0;
        for (const c of this.player.children || []) {
            if (c && c.anchor && typeof c.anchor.y === 'number' && c.anchor.y === 1 && typeof c.y === 'number') {
                return this.player.y + c.y;
            }
        }
        return this.player.y;
    }

    // helper: compute player's visual "head" Y (top of sprite) for spawning water
    _playerHeadY() {
        if (!this.player) return 0;
        let head = Infinity;
        for (const c of this.player.children || []) {
            try {
                const b = (typeof c.getLocalBounds === 'function') ? c.getLocalBounds() : { y: 0 };
                const top = this.player.y + c.y + (b.y ?? 0);
                if (top < head) head = top;
            } catch (e) { /* ignore */ }
        }
        if (!isFinite(head)) return this.player.y;
        return head;
    }

    // Start watering the nearest weed within range. This spawns a flood of water
    // from the player's "head" to the weed. Called by main on E press.
    startWatering() {
        if (!this.player) return;
        // find nearest non-completed weed within range
        const px = this.player.x;
        const headY = this.player.y; // water starts from visual head
        const py = this.player.y; // proximity checks use foot
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
            const start = { x: px + (Math.random() * 6 - 3), y: headY + (Math.random() * 8 - 4) };
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

        // remove old plant graphic and create flower bush (bigger, stems + head)
        if (weed.graphic && weed.graphic.parent) weed.graphic.destroy({ children: true, texture: false, baseTexture: false });
        const flower = createFlowerBush(weed.text || Math.floor(Math.random() * 99999), {
            stems: 1 + Math.floor(Math.random() * 2),
            stemHeightMin: 28,
            stemHeightMax: 56,
            petalRadius: 14,
            scale: 1.2
        });
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

        // persist change
        this._save();
    }

    // shared helper to apply completed visuals for loaded weeds
    _applyCompletedVisuals(weed) {
        // remove plant if exists
        if (weed.graphic && weed.graphic.parent) weed.graphic.destroy({ children: true, texture: false, baseTexture: false });
        // add flower visuals (same as _bloom but without saving)
        const flower = createFlowerBush(weed.text || Math.floor(Math.random() * 99999), {
            stems: 1 + Math.floor(Math.random() * 2),
            stemHeightMin: 22,
            stemHeightMax: 48,
            petalRadius: 12,
            scale: 1.1
        });
        weed.container.addChildAt(flower, 0);
        weed.flower = flower;

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

        // accumulate a global time for procedural animations
        this._swayTime = (this._swayTime || 0) + dt;

        if (!this.player) return;
        const px = this.player.x, py = this._playerFootY();
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

            // apply subtle sway for alive weeds (not completed) using per-weed offset so each is independent
            if (w.container && !w.completed && w.container.sway) {
                const s = w.container.sway;
                // combine global time with per-weed offset and phase so weeds are out-of-phase / sometimes opposite
                const tval = (this._swayTime * s.freq) + (s.phase || 0) + (s.offset || 0);
                const v = Math.sin(tval);
                // increase sway slightly when weed is nearer (draw attention)
                const nearFactor = Math.max(0, 1 - (d / 200));
                const rot = v * s.amp * (1 + nearFactor * 0.6);
                w.container.rotation = rot;
                w.container.x = w.x + v * (s.xAmp || 0) * (1 + nearFactor * 0.4);
            } else if (w.container) {
                // reset transform for completed/unsupported plants
                w.container.rotation = 0;
                w.container.x = w.x;
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

    // persist weeds -> localStorage
    _save() {
        try {
            const out = this.weeds.map(w => ({
                text: w.text,
                x: w.x,
                // don't persist absolute y (depends on renderer height/terrain).
                // y will be recomputed on load via terrain.groundY(x) to avoid floating issues.
                completed: !!w.completed,
                hits: Number(w.hits || 0)
            }));
            localStorage.setItem(this.storageKey, JSON.stringify(out));
        } catch (e) {
            // ignore storage errors on private mode, quota, etc.
            // console.warn('weed save failed', e);
        }
    }

    // load persisted weeds (if any)
    _load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            for (const r of arr) {
                // spawn with saved data
                // Note: do NOT use saved absolute y — recompute from terrain so plants sit on ground
                this._spawnWeed({
                    text: r.text,
                    x: Number.isFinite(r.x) ? r.x : null,
                    y: null, // force _spawnWeed to compute groundY(x) (avoids floating after resize)
                    completed: !!r.completed,
                    hits: Number.isFinite(r.hits) ? r.hits : 0
                });
            }
        } catch (e) {
            // malformed data -> ignore and continue
            // console.warn('weed load failed', e);
        }
    }

    // Recompute all weeds' Y positions based on current terrain (call on resize)
    repositionToTerrain() {
        if (!this.terrain) return;
        for (const w of this.weeds) {
            try {
                const newY = this.terrain.groundY(w.x);
                w.y = newY;
                if (w.container) w.container.y = newY;
            } catch (e) { /* ignore */ }
        }
    }
}

export default WeedManager;