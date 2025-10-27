import * as PIXI from 'pixi.js';

// Simple seeded PRNG (mulberry32)
function makeRng(seed = 1) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// small text->int hash
function textHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * createBranchyWeed(seedOrText, opts)
 * - seedOrText: number or string (string will be hashed)
 * - opts: { maxDepth, branchiness, length, leafSize, colors... }
 * returns PIXI.Container with plant drawn centered at (0,0) where root sits ~ at y=0 (weed container y already set)
 */
export function createBranchyWeed(seedOrText, opts = {}) {
    const seed = (typeof seedOrText === 'string') ? textHash(seedOrText) : (Number.isFinite(seedOrText) ? seedOrText | 0 : 1);
    const rng = makeRng(seed ^ 0x9e3779b1);

    const cfg = {
        maxDepth: opts.maxDepth ?? 3,
        branchiness: opts.branchiness ?? 0.9, // chance to branch
        baseLength: opts.baseLength ?? 18,
        lengthVariance: opts.lengthVariance ?? 0.6,
        baseThickness: opts.baseThickness ?? 3,
        leafSize: opts.leafSize ?? 8,
        trunkColor: opts.trunkColor ?? 0x6b3a1a,
        leafColor: opts.leafColor ?? 0x2e8b57,
    };

    const c = new PIXI.Container();

    // draw trunk+branches into a Graphics, but we'll create separate leaf blobs as Graphics children
    const g = new PIXI.Graphics();
    c.addChild(g);

    function drawBranch(x, y, angle, length, thickness, depth) {
        // compute end
        const nx = x + Math.cos(angle) * length;
        const ny = y + Math.sin(angle) * length;

        // trunk stroke with thickness tapering
        g.lineStyle(Math.max(1, thickness), cfg.trunkColor, 1, 0.5, false);
        g.moveTo(x, y);
        g.lineTo(nx, ny);

        // // occasional small curl / jitter to make it ugly
        // if (depth === 0 || rng() < 0.4) {
        //     // leaf blob at tip sometimes
        //     const leaf = new PIXI.Graphics();
        //     const lv = cfg.leafSize * (0.8 + rng() * 0.8);
        //     leaf.beginFill(cfg.leafColor);
        //     leaf.drawEllipse(nx, ny, lv * (0.8 + rng() * 0.4), lv * (0.5 + rng() * 0.8));
        //     leaf.endFill();
        //     leaf.alpha = 0.95 - rng() * 0.25;
        //     leaf.rotation = (rng() - 0.5) * 0.6;
        //     c.addChild(leaf);
        // }

        if (depth >= cfg.maxDepth) return;

        // number of sub-branches (1..2 usually, sometimes 3 if rng high)
        const branches = (rng() < 0.12) ? 3 : ((rng() < 0.6) ? 2 : 1);
        for (let i = 0; i < branches; i++) {
            if (rng() > cfg.branchiness && depth > 0) continue;
            // angle spread
            const spread = 0.6 + rng() * 0.9;
            const dir = (i === 0) ? -1 : 1;
            const a = angle + dir * (0.2 + rng() * spread) + (rng() - 0.5) * 0.2;
            const len = length * (0.5 + (rng() * cfg.lengthVariance));
            const thin = Math.max(0.8, thickness * (0.5 + rng() * 0.6));
            drawBranch(nx, ny, a, len, thin, depth + 1);
        }

        // small chance to sprout a short side twig
        if (rng() < 0.25) {
            const a = angle + (rng() - 0.5) * 1.4;
            drawBranch(x + (Math.cos(angle) * length * 0.4), y + (Math.sin(angle) * length * 0.4), a, length * 0.5, Math.max(0.9, thickness * 0.4), depth + 1);
        }
    }

    // build main trunk with a couple of vertical segments to give a messy base
    const segments = 2 + Math.floor(rng() * 3);
    let sx = 0, sy = 0;
    let angle = -Math.PI / 2 + (rng() - 0.5) * 0.2; // mostly upward
    let length = cfg.baseLength * (0.9 + rng() * 0.6);
    let thickness = cfg.baseThickness;
    for (let s = 0; s < segments; s++) {
        const nx = sx + Math.cos(angle) * length;
        const ny = sy + Math.sin(angle) * length;
        g.lineStyle(Math.max(1, thickness), cfg.trunkColor, 1, 0.5, false);
        g.moveTo(sx, sy);
        g.lineTo(nx, ny);

        // sprout 1..2 branches from this segment
        const sproutCount = (rng() < 0.6) ? 1 : 2;
        for (let sp = 0; sp < sproutCount; sp++) {
            const a = angle + (rng() - 0.5) * 1.2 + (sp === 0 ? -0.3 : 0.3);
            drawBranch(nx, ny, a, length * (0.8 + rng() * 0.6), Math.max(0.8, thickness * 0.6), 0);
        }

        // advance trunk
        sx = nx; sy = ny;
        angle += (rng() - 0.5) * 0.2;
        length *= (0.7 + rng() * 0.4);
        thickness *= 0.7;
    }

    // // add a few small ground leaves at base
    // for (let i = 0; i < 3; i++) {
    //     const leaf = new PIXI.Graphics();
    //     const lx = (rng() - 0.5) * 10;
    //     const ly = 2 + rng() * 6;
    //     const lw = cfg.leafSize * (0.6 + rng() * 0.8);
    //     leaf.beginFill(cfg.leafColor);
    //     leaf.drawEllipse(lx, ly, lw * (0.9 + rng() * 0.4), lw * (0.5 + rng() * 0.8));
    //     leaf.endFill();
    //     leaf.alpha = 0.95 - rng() * 0.3;
    //     leaf.rotation = (rng() - 0.5) * 0.6;
    //     c.addChild(leaf);
    // }

    // slight random rotation / scale to vary silhouette
    c.rotation = (rng() - 0.5) * 0.12;
    c.scale.set(0.9 + rng() * 0.3);

    return c;
}

export default createBranchyWeed;