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

        this.weeds = []; // { container, text, x, y, label, bg, graphic, completed, hits, strike, check, ... }
        this.dialog = new Dialog(this.addWeed.bind(this));

        this._waters = []; // active water particles: { gfx, start, target, elapsed, dur, weed }
        this._splashes = []; // splash remnants: { gfx, elapsed, dur }
        this._swayTime = 0;

        this.storageKey = 'todo-garden-weeds-v1';

        this.initAddWeedButton();
        this._load();
    }

    initAddWeedButton() {
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
        wrap.appendChild(addBtn);
        this.addWeedButton = addBtn;

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
            const ok = window.confirm('Clear the garden? This will remove all weeds and flowers.');
            if (!ok) return;
            this.clearAllWeeds();
            setTimeout(() => clearBtn.blur(), 0);
        });
        wrap.appendChild(clearBtn);
        this.clearGardenButton = clearBtn;

        document.body.appendChild(wrap);
        this._weedUiWrap = wrap;
    }

    clearAllWeeds() {
        for (const w of this.weeds) {
            try {
                if (w.container && w.container.parent) this.world.removeChild(w.container);
                if (w.container && typeof w.container.destroy === 'function') w.container.destroy({ children: true, texture: false, baseTexture: false });
            } catch (e) {}
        }
        this.weeds.length = 0;

        for (const p of this._waters) {
            try { if (p.gfx && p.gfx.parent) p.gfx.parent.removeChild(p.gfx); if (p.gfx) p.gfx.destroy(); } catch (e) {}
        }
        this._waters.length = 0;

        for (const s of this._splashes) {
            try { if (s.gfx && s.gfx.parent) s.gfx.parent.removeChild(s.gfx); if (s.gfx) s.gfx.destroy(); } catch (e) {}
        }
        this._splashes.length = 0;

        try { localStorage.removeItem(this.storageKey); } catch (e) {}
    }

    addWeed(text) {
        if (!text) return;
        this._spawnWeed({ text, x: null, y: null, completed: false, hits: 0 });
        this._save();
    }

    _spawnWeed(record) {
        const text = record.text || 'Unnamed';
        const px = this.player?.x ?? (this.app.renderer.width / 2);
        let spawnX = (Number.isFinite(record.x) ? record.x : px + (Math.random() * 200 - 100));
        let spawnY = Number.isFinite(record.y) ? record.y : (this.terrain ? this.terrain.groundY(spawnX) : (this.player?.y ?? (this.app.renderer.height / 2)) + 80);

        let tries = 0;
        while (this.weeds.some(w => this._distance(w.x, w.y, spawnX, spawnY) < 64) && tries++ < 40) {
            spawnX += (Math.random() * 200 - 100);
            if (this.terrain) spawnY = this.terrain.groundY(spawnX);
        }

        const c = new PIXI.Container();
        c.x = spawnX;
        c.y = spawnY;

        const plant = createBranchyWeed(record.text ?? 'weed', { baseLength: 16, leafSize: 8 });
        plant.y = 0;
        if (plant.pivot && typeof plant.pivot.set === 'function') plant.pivot.set(0, 0);

        const visuals = new PIXI.Container();
        visuals.name = 'visuals';
        visuals.addChild(plant);
        c.addChild(visuals);

        c.y = spawnY;

        if (plant && plant.sway) {
            c.sway = Object.assign({}, plant.sway);
        } else {
            c.sway = { amp: 0.03, freq: 2, phase: Math.random() * Math.PI * 2, xAmp: 1.2, rotAmp: 0.02 };
        }
        c.sway.offset = (Math.random() * Math.PI * 2);
        if (c.pivot && typeof c.pivot.set === 'function') c.pivot.set(0, 0);

        const label = new PIXI.Text(text, {
            fontSize: 12,
            fill: 0x111111,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 200,
        });
        label.anchor = new PIXI.Point(0.5, 1);
        label.x = 0;
        try {
            const b = plant.getLocalBounds();
            label.y = -(b.y + b.height) - 8;
        } catch (e) {
            label.y = -26;
        }
        label.visible = false;

        const bg = new PIXI.Graphics();
        bg.visible = false;

        // halo/exclaim simplified (exclaim will be above)
        const exclaim = new PIXI.Text('!', { fontSize: 26, fill: 0xFFDD33, fontWeight: 'bold' });
        exclaim.anchor.set(0.5, 0.5);
        exclaim.x = 0;
        exclaim.y = label.y - 24;
        exclaim.visible = false;
        c.addChild(exclaim);

        const localParticles = [];
        let particleAcc = 0;

        const strike = new PIXI.Graphics();
        strike.visible = false;

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
            flower: null,
            exclaim,
            particles: localParticles,
            _particleAcc: 0
        };

        if (weed.completed) {
            this._applyCompletedVisuals(weed);
        }

        this.weeds.push(weed);

        this._attachWeedInputHandlers(weed);

        return weed;
    }

    _attachWeedInputHandlers(weed) {
        try {
            const vis = weed.container.getChildByName && weed.container.getChildByName('visuals') || weed.container.children[0];
            if (!vis) return;

            // PIXI v7: prefer eventMode and an explicit hitArea for reliable pointer hits.
            vis.eventMode = 'static';        // enable pointer events on this container
            vis.cursor = 'pointer';          // show pointer cursor

            // ensure a simple rectangular hitArea based on local bounds so taps aren't missed
            try {
                const b = vis.getLocalBounds();
                const minW = Math.max(8, b.width || 24);
                const minH = Math.max(8, b.height || 24);
                vis.hitArea = new PIXI.Rectangle(b.x || 0, b.y || 0, minW, minH);
            } catch (e) {
                // fallback: no hitArea set
            }

            weed._lastTap = 0;
            weed._longPressTimer = null;

            const startLongPress = () => {
                clearTimeout(weed._longPressTimer);
                weed._longPressTimer = setTimeout(() => {
                    this._openWeedDialog(weed);
                }, 600);
            };
            const cancelLongPress = () => {
                clearTimeout(weed._longPressTimer);
                weed._longPressTimer = null;
            };

            // Start long-press on pointerdown
            vis.on('pointerdown', (ev) => {
                startLongPress();
            });

            // Use pointerup for tap/double-tap detection
            vis.on('pointerup', (ev) => {
                cancelLongPress();
                const now = performance.now();
                const DOUBLE_TAP_MS = 350;
                if (now - (weed._lastTap || 0) < DOUBLE_TAP_MS) {
                    // double-tap => open details
                    this._openWeedDialog(weed);
                    weed._lastTap = 0;
                } else {
                    // single tap: record time (could add short visual feedback here)
                    weed._lastTap = now;
                }
            });

            vis.on('pointerupoutside', cancelLongPress);
            vis.on('pointercancel', cancelLongPress);
            vis.on('pointerout', cancelLongPress);
        } catch (e) {}
    }

    _openWeedDialog(weed) {
        if (!weed) return;
        if (this._activeWeedDialog) return;

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', zIndex: 10000
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
            width: 'min(560px, 92vw)', maxHeight: '82vh', overflow: 'auto',
            background: '#fff', borderRadius: '8px', padding: '14px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.45)', fontFamily: 'sans-serif'
        });
        overlay.appendChild(box);

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        box.appendChild(header);

        const title = document.createElement('input');
        title.type = 'text';
        title.value = weed.text || '';
        Object.assign(title.style, { fontSize: '18px', fontWeight: '600', border: 'none', outline: 'none', flex: '1' });
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, { marginLeft: '12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px' });
        header.appendChild(closeBtn);

        const metaRow = document.createElement('div');
        Object.assign(metaRow.style, { display: 'flex', alignItems: 'center', marginTop: '10px', gap: '12px' });
        box.appendChild(metaRow);

        const checkLabel = document.createElement('label');
        Object.assign(checkLabel.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(weed.completed);
        checkLabel.appendChild(checkbox);
        const checkText = document.createElement('span');
        checkText.textContent = 'Done';
        checkLabel.appendChild(checkText);
        metaRow.appendChild(checkLabel);

        const dueLabel = document.createElement('div');
        Object.assign(dueLabel.style, { display: 'flex', flexDirection: 'column', fontSize: '13px' });
        const dueCaption = document.createElement('div');
        dueCaption.textContent = 'Due date';
        dueCaption.style.opacity = '0.8';
        dueLabel.appendChild(dueCaption);
        const dueInput = document.createElement('input');
        dueInput.type = 'date';
        if (weed.due) {
            try { dueInput.value = new Date(weed.due).toISOString().slice(0, 10); } catch (e) {}
        }
        dueLabel.appendChild(dueInput);
        metaRow.appendChild(dueLabel);

        const desc = document.createElement('textarea');
        desc.placeholder = 'Description / notes...';
        Object.assign(desc.style, { width: '100%', minHeight: '96px', marginTop: '12px' });
        desc.value = weed.description || '';
        box.appendChild(desc);

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' });
        box.appendChild(actions);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        Object.assign(saveBtn.style, { padding: '8px 12px', cursor: 'pointer' });
        actions.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, { padding: '8px 12px', cursor: 'pointer' });
        actions.appendChild(cancelBtn);

        const cleanup = () => { try { document.body.removeChild(overlay); } catch (e) {} ; this._activeWeedDialog = null; };
        closeBtn.onclick = cancelBtn.onclick = () => cleanup();
        overlay.onclick = (ev) => { if (ev.target === overlay) cleanup(); };

        saveBtn.onclick = () => {
            weed.text = title.value;
            weed.completed = Boolean(checkbox.checked);
            weed.due = dueInput.value ? new Date(dueInput.value).toISOString() : null;
            weed.description = desc.value;
            try {
                if (weed.label) weed.label.text = weed.text;
                if (weed.check) weed.check.visible = !!weed.completed;
                if (weed.strike) weed.strike.visible = !!weed.completed;
            } catch (e) {}
            try { this._save(); } catch (e) {}
            if (weed.completed) this._bloom(weed);
            cleanup();
        };

        this._activeWeedDialog = overlay;
        document.body.appendChild(overlay);
        setTimeout(() => title.focus(), 40);
    }

    // shoot a water particle from player to nearest weed (called by controls)
    startWatering() {
        if (!this.player || !this.weeds.length) return;
        // pick nearest incomplete weed within a reasonable range
        const px = this.player.x, py = this._playerFootY();
        let best = null, bd = Infinity;
        for (const w of this.weeds) {
            if (w.completed) continue;
            const d = this._distance(px, py, w.x, w.y);
            if (d < bd && d < 300) { bd = d; best = w; }
        }
        if (!best) return;
        const start = { x: this.player.x + 0, y: this.player.y - 20 };
        const target = { x: best.x + (best.container.pivot?.x || 0), y: best.y - 6 };
        const g = new PIXI.Graphics();
        g.beginFill(0x66CCFF);
        g.drawCircle(start.x, start.y, 6);
        g.endFill();
        this.world.addChild(g);
        const dur = 0.45 + Math.random() * 0.35;
        this._waters.push({ gfx: g, start, target, elapsed: 0, dur, weed: best });
    }

    _bloom(weed) {
        if (weed.completed) return;
        weed.completed = true;
        try {
            if (weed.graphic && weed.graphic.parent) weed.graphic.destroy({ children: true, texture: false, baseTexture: false });
        } catch (e) {}
        const flower = createFlowerBush(weed.text || Math.floor(Math.random() * 99999), {
            stems: 1 + Math.floor(Math.random() * 2),
            stemHeightMin: 22,
            stemHeightMax: 48,
            petalRadius: 12,
            scale: 1.1
        });
        weed.container.addChildAt(flower, 0);
        weed.flower = flower;

        try {
            weed.label.style = Object.assign({}, weed.label.style, { fill: 0x666666 });
            weed.strike.clear();
            weed.strike.visible = true;
            const lw = weed.label.width;
            const ly = weed.label.y - (weed.label.style.fontSize ?? 12) / 2;
            weed.strike.lineStyle(2, 0x666666);
            weed.strike.moveTo(-lw / 2, ly);
            weed.strike.lineTo(lw / 2, ly);
            weed.check.visible = true;
        } catch (e) {}

        try { this._save(); } catch (e) {}
    }

    _applyCompletedVisuals(weed) {
        try {
            if (weed.graphic && weed.graphic.parent) weed.graphic.destroy({ children: true, texture: false, baseTexture: false });
        } catch (e) {}
        const flower = createFlowerBush(weed.text || Math.floor(Math.random() * 99999), {
            stems: 1 + Math.floor(Math.random() * 2),
            stemHeightMin: 22,
            stemHeightMax: 48,
            petalRadius: 12,
            scale: 1.1
        });
        weed.container.addChildAt(flower, 0);
        weed.flower = flower;
        try {
            weed.label.style = Object.assign({}, weed.label.style, { fill: 0x666666 });
            weed.strike.clear();
            weed.strike.visible = true;
            const lw = weed.label.width;
            const ly = weed.label.y - (weed.label.style.fontSize ?? 12) / 2;
            weed.strike.lineStyle(2, 0x666666);
            weed.strike.moveTo(-lw / 2, ly);
            weed.strike.lineTo(lw / 2, ly);
            weed.check.visible = true;
        } catch (e) {}
    }

    update(dtSec = null) {
        const dt = (dtSec != null) ? dtSec : (this.app.ticker ? this.app.ticker.deltaMS / 1000 : 1 / 60);
        this._swayTime += dt;
        if (!this.player) return;
        const px = this.player.x, py = this._playerFootY();

        for (const w of this.weeds) {
            const d = this._distance(px, py, w.x, w.y);
            const show = d < 110;
            if (show && !w.label.visible) {
                w.label.visible = true;
                w.bg.visible = true;
                w.bg.clear();
                w.bg.beginFill(0xffffff, 0.95);
                w.bg.drawRoundedRect(-w.label.width / 2 - 6, w.label.y - 18, w.label.width + 12, 18, 6);
                w.bg.endFill();
            } else if (!show && w.label.visible) {
                w.label.visible = false;
                w.bg.visible = false;
            }

            if (w.container && !w.completed && w.container.sway) {
                const s = w.container.sway;
                const tval = (this._swayTime * s.freq) + (s.phase || 0) + (s.offset || 0);
                const v = Math.sin(tval);
                const nearFactor = Math.max(0, 1 - (d / 200));
                const rot = v * s.amp * (1 + nearFactor * 0.6);
                w.container.rotation = rot;
                w.container.x = w.x;

                try {
                    const vis = w.container.getChildByName && w.container.getChildByName('visuals') || w.container.children[0];
                    if (vis && vis.children && vis.children[0]) {
                        const wiggle = Math.sin(tval * 2 + (s.phase || 0)) * 0.03 * (0.7 + nearFactor);
                        vis.children[0].rotation = wiggle;
                    }
                    if (w.exclaim) {
                        w.exclaim.visible = (Math.floor(tval * 2) % 2 === 0) && !show;
                    }
                } catch (e) {}

                if (!show && w.particles) {
                    w._particleAcc = (w._particleAcc || 0) + dt;
                    const rate = 0.25;
                    if (w._particleAcc > rate) {
                        w._particleAcc = 0;
                        if (Math.random() < 0.8) {
                            const pG = new PIXI.Graphics();
                            pG.beginFill(0xFFD87A, 0.95);
                            pG.drawCircle(0, 0, 2 + Math.random() * 2);
                            pG.endFill();
                            const vis = w.container.getChildByName && w.container.getChildByName('visuals') || w.container.children[0];
                            if (vis) {
                                pG.x = (Math.random() * 36 - 18);
                                pG.y = -Math.random() * 20;
                                pG.alpha = 0.95;
                                vis.addChild(pG);
                                w.particles.push({
                                    gfx: pG,
                                    elapsed: 0,
                                    dur: 0.9 + Math.random() * 0.8,
                                    vx: (Math.random() - 0.5) * 8,
                                    vy: -40 - Math.random() * 80
                                });
                            } else {
                                pG.destroy();
                            }
                        }
                    }
                }
            } else if (w.container) {
                w.container.rotation = 0;
                w.container.x = w.x;
            }

            if (w.particles && w.particles.length) {
                for (let pi = w.particles.length - 1; pi >= 0; pi--) {
                    const P = w.particles[pi];
                    P.elapsed += dt;
                    const tt = P.elapsed / P.dur;
                    if (P.gfx) {
                        P.gfx.x += (P.vx || 0) * dt;
                        P.gfx.y += (P.vy || 0) * dt;
                        P.gfx.alpha = Math.max(0, 1 - tt);
                    }
                    if (P.elapsed >= P.dur) {
                        try { if (P.gfx && P.gfx.parent) P.gfx.parent.removeChild(P.gfx); if (P.gfx) P.gfx.destroy(); } catch (e) {}
                        w.particles.splice(pi, 1);
                    }
                }
            }
        }

        for (let i = this._waters.length - 1; i >= 0; i--) {
            const p = this._waters[i];
            p.elapsed += dt;
            const t = Math.min(1, p.elapsed / p.dur);
            const et = 1 - Math.pow(1 - t, 2.2);
            p.gfx.x = p.start.x + (p.target.x - p.start.x) * et;
            p.gfx.y = p.start.y + (p.target.y - p.start.y) * et;
            p.gfx.alpha = 0.95 * (1 - t * 0.8);
            if (t >= 1) {
                try {
                    const s = new PIXI.Graphics();
                    s.beginFill(0x4EAFFC, 0.95);
                    s.drawCircle(p.target.x, p.target.y, 6 + Math.random() * 4);
                    s.endFill();
                    s.alpha = 1;
                    this.world.addChild(s);
                    this._splashes.push({ gfx: s, elapsed: 0, dur: 0.9 + Math.random() * 0.6 });
                } catch (e) {}

                p.weed.hits = (p.weed.hits || 0) + 1;
                try { if (p.gfx && p.gfx.parent) p.gfx.destroy(); } catch (e) {}
                this._waters.splice(i, 1);

                if (p.weed.hits >= 6) this._bloom(p.weed);
            }
        }

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

    _playerFootY() {
        if (!this.player) return 0;
        return (this.player.y || 0) + (this.player.height ? (this.player.height / 2) : 0);
    }

    _distance(ax, ay, bx, by) {
        const dx = (ax - bx || 0), dy = (ay - by || 0);
        return Math.hypot(dx, dy);
    }

    _save() {
        try {
            const out = this.weeds.map(w => ({
                text: w.text,
                x: w.x,
                completed: !!w.completed,
                hits: Number(w.hits || 0),
                due: w.due || null,
                description: w.description || null
            }));
            localStorage.setItem(this.storageKey, JSON.stringify(out));
        } catch (e) {}
    }

    _load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            for (const r of arr) {
                this._spawnWeed({
                    text: r.text,
                    x: Number.isFinite(r.x) ? r.x : null,
                    y: null,
                    completed: !!r.completed,
                    hits: Number.isFinite(r.hits) ? r.hits : 0
                });
            }
        } catch (e) {}
    }

    repositionToTerrain() {
        if (!this.terrain) return;
        for (const w of this.weeds) {
            try {
                const newY = this.terrain.groundY(w.x);
                w.y = newY;
                if (w.container) w.container.y = newY;
            } catch (e) {}
        }
    }
}

export default WeedManager;