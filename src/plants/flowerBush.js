import * as PIXI from 'pixi.js';

// seeded PRNG (mulberry32)
function makeRng(seed = 1) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function textHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * createFlowerBush(seedOrText, opts)
 * - single main stem, one flower head (petals consistent)
 * - variable stem height and leaf distribution
 */
export function createFlowerBush(seedOrText, opts = {}) {
    const seed = (typeof seedOrText === 'string') ? textHash(seedOrText) : (Number.isFinite(seedOrText) ? seedOrText | 0 : 1);
    const rng = makeRng(seed ^ 0xC0FFEE);

    const cfg = {
        stemHeightMin: opts.stemHeightMin ?? 28,
        stemHeightMax: opts.stemHeightMax ?? 54,
        stemThickness: opts.stemThickness ?? 3,
        leafSize: opts.leafSize ?? 8,
        petalCount: opts.petalCount ?? (7), // consistent petals
        petalRadius: opts.petalRadius ?? 14,
        petalColor: opts.petalColor ?? 0xFF8FB3,
        centerColor: opts.centerColor ?? 0xFFD24D,
        stemColor: opts.stemColor ?? 0x2e8b57,
        leafColor: opts.leafColor ?? 0x3a6b3a,
        scale: opts.scale ?? (1 + rng() * 0.5),
    };

    const c = new PIXI.Container();

    // compute single stem geometry
    const offsetX = (opts.offsetX ?? 0) + (rng() - 0.5) * 6;
    const height = cfg.stemHeightMin + rng() * (cfg.stemHeightMax - cfg.stemHeightMin);
    const thickness = Math.max(1, cfg.stemThickness * (0.8 + rng() * 0.6));
    const baseY = 0;
    const topX = offsetX;
    const topY = -height;

    // stem graphics
    const stemG = new PIXI.Graphics();
    stemG.lineStyle(Math.max(1, thickness), cfg.stemColor, 1, 0.5, false);
    const midX = offsetX + (rng() - 0.5) * 6;
    const midY = -(height * (0.45 + rng() * 0.15));
    stemG.moveTo(offsetX, baseY);
    // gentle quadratic curve
    stemG.quadraticCurveTo(midX, midY, topX, topY);
    c.addChild(stemG);

    // leaves along stem (variable count & placement)
    const leafCount = 1 + Math.floor(rng() * 2); // 1..4 leaves
    for (let L = 0; L < leafCount; L++) {
        const tpos = (L + 1) / (leafCount + 1);
        const lx = offsetX + (topX - offsetX) * tpos + (rng() - 0.5) * 6;
        const ly = baseY + (topY - baseY) * tpos + (rng() - 0.5) * 6;
        const leaf = new PIXI.Graphics();
        const lw = cfg.leafSize * (0.9 + rng() * 0.6);
        leaf.beginFill(cfg.leafColor);
        leaf.drawEllipse(lx, ly, lw * (0.9 + rng() * 0.3), lw * (0.45 + rng() * 0.6));
        leaf.endFill();
        leaf.alpha = 0.9 - rng() * 0.25;
        // alternate left/right placement
        leaf.rotation = (L % 2 === 0 ? -0.6 : 0.6) + (rng() - 0.5) * 0.4;
        c.addChild(leaf);
    }

    // flower head (single) - petals consistent for this flower
    const petals = cfg.petalCount;
    const pr = cfg.petalRadius * (0.95 + (rng() - 0.5) * 0.15);
    // draw petals into one Graphics for consistent shape
    const petalG = new PIXI.Graphics();
    petalG.beginFill(cfg.petalColor);
    for (let p = 0; p < petals; p++) {
        const a = (p / petals) * Math.PI * 2;
        const px = topX + Math.cos(a) * pr;
        const py = topY + Math.sin(a) * pr * 0.8;
        // draw uniform petal ellipse oriented radially
        // use a small transform: rotate petal to face outward by drawing ellipse offset along angle
        petalG.drawEllipse(px, py, pr * 0.9, pr * 0.45);
    }
    petalG.endFill();
    petalG.alpha = 0.98;
    c.addChild(petalG);

    // center circle
    const center = new PIXI.Graphics();
    center.beginFill(cfg.centerColor);
    center.drawCircle(topX, topY, Math.max(6, pr * 0.45));
    center.endFill();
    c.addChild(center);

    // small white highlight dot
    const dot = new PIXI.Graphics();
    dot.beginFill(0xffffff, 0.9);
    dot.drawCircle(topX - pr * 0.2, topY - pr * 0.2, Math.max(1.5, pr * 0.08));
    dot.endFill();
    dot.alpha = 0.9;
    c.addChild(dot);

    c.scale.set(cfg.scale);
    c.rotation = (rng() - 0.5) * 0.06;

    return c;
}

export default createFlowerBush;