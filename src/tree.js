import * as PIXI from 'pixi.js';
const { Graphics, Container } = PIXI;

// small FNV-1a text hash
function textHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
// small seeded RNG (mulberry32 variant)
function makeRng(seed = 1) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r >>> 0) / 4294967295);
    };
}

/**
 * createTree(seedOrText, opts)
 * - seedOrText: number|string
 * - opts: { height, trunkWidth, depth, branchFactor, leafColor, trunkColor, canopyDensity, leafSize, x, y, showLeaves }
 * returns PIXI.Container rooted at (0,0) (ground), drawn upward (negative y)
 */
export function createTree(seedOrText = 'tree', opts = {}) {
    const seed = (typeof seedOrText === 'string') ? textHash(seedOrText) : (Number.isFinite(seedOrText) ? seedOrText | 0 : 1);
    const rnd = makeRng(seed);

    const height = opts.height ?? Math.round(320 + rnd() * 320);
    const trunkWidth = opts.trunkWidth ?? Math.round(30 + rnd() * 36);
    const maxDepth = opts.depth ?? Math.max(3, Math.floor(Math.log2(height) - 2));
    // allow more branching by default (can be overridden via opts.branchFactor)
    const branchFactor = opts.branchFactor ?? 3 + (rnd() > 0.8 ? 1 : 0);
    const trunkColor = opts.trunkColor ?? 0x6b4228;
    const leafColor = opts.leafColor ?? 0x2f9e4f;
    // denser canopy by default
    const canopyDensity = opts.canopyDensity ?? Math.round(40 + rnd() * 40);
    const leafSize = opts.leafSize ?? Math.round(10 + rnd() * 10);
    const showLeavesOpt = (typeof opts.showLeaves === 'boolean') ? opts.showLeaves : true;

    const container = new Container();
    // don't set pivot yet — we'll set it to the trunk base after trunkPath is built
    // store base position so update can safely apply temporary sway offsets
    container._baseX = Number.isFinite(opts.x) ? opts.x : 0;
    container._baseY = Number.isFinite(opts.y) ? opts.y : 0;
    container.x = container._baseX;
    container.y = container._baseY;

    // leaves container
    const leaves = new Container();
    leaves.name = 'leaves';
    leaves.cacheAsBitmap = true;

    // branch polygons container (filled shells)
    const shells = new Graphics();

    // will hold branch centerline paths: each is [{x,y,thickness}, ...]
    const branchPaths = [];

    // helper to create a segmented curved centerline for a branch and record thickness per point
    function makeCenterline(x, y, angle, length, thickness, segments = null) {
        // use more points for smoother, more detailed branch polygons
        const segs = segments || Math.max(4, Math.floor(length / 16));
        let pts = [];
        let cx = x, cy = y;
        let a = angle;
        let segLen = length / segs;
        let t = thickness;
        for (let i = 0; i <= segs; i++) {
            pts.push({ x: cx, y: cy, thickness: t });
            // advance
            const delta = (Math.random() * 0.04 - 0.02); // tiny jitter
            const nx = cx + Math.cos(a + delta) * segLen;
            const ny = cy + Math.sin(a + delta) * segLen;
            // progress wobble
            cx = nx; cy = ny;
            a += (rnd() - 0.5) * 0.18;
            segLen *= 0.96 + rnd() * 0.06;
            // make thickness decay less aggressive so branches stay chunkier
            t *= 0.8 + rnd() * 0.05;
        }
        return pts;
    }

    // place leaf clusters from endpoints and random canopy points
    function placeLeafCluster(cx, cy, scale = 1) {
        const ccount = 3 + Math.floor(rnd() * 6);
        for (let i = 0; i < ccount; i++) {
            const g = new Graphics();
            const r = leafSize * scale * (0.6 + rnd() * 1.2);
            const rx = (rnd() * 2 - 1) * leafSize * 0.6 * scale;
            const ry = (rnd() * 2 - 1) * leafSize * 0.4 * scale;
            g.beginFill(leafColor, 0.7 + rnd() * 0.2);
            g.drawEllipse(0, 0, r * (0.9 + rnd() * 0.6), r * (0.6 + rnd() * 0.8));
            g.endFill();
            g.x = cx + rx;
            g.y = cy + ry;
            g.rotation = (rnd() * 40 - 20) * (Math.PI / 180);
            g.blendMode = PIXI.BLEND_MODES.NORMAL;
            leaves.addChild(g);
        }
    }

    // ---- build trunk centerline and primary trunk-path splits ----
    // === Reverted recursive branch-generation (records centerlines for shell renderer) ===
    const trunkSegments = 3 + Math.floor(rnd() * 4);
    let sx = 0, sy = 0;
    let mainAngle = -Math.PI / 2 + (rnd() - 0.5) * 0.12;
    let segLen = height / trunkSegments;
    let thickness = trunkWidth;
    const canopyEndpoints = [];
    const crownStart = -Math.abs(height) * 0.5;

    // Build trunk as a sequence of centerline points (push as a single path)
    const trunkPath = [];
    for (let i = 0; i <= trunkSegments; i++) {
        trunkPath.push({ x: sx, y: sy, thickness: thickness });
        const nx = sx + Math.cos(mainAngle) * segLen;
        const ny = sy + Math.sin(mainAngle) * segLen;
        sx = nx; sy = ny;
        mainAngle += (rnd() - 0.5) * 0.14;
        segLen *= 0.92 + rnd() * 0.08;
        // taper trunk more gently
        thickness *= 0.8 + rnd() * 0.06;
    }
    branchPaths.push(trunkPath);

    // recursive branch builder modeled after the original algorithm but producing centerlines
    function buildBranch(x, y, angle, length, thick, depth) {
        const path = makeCenterline(x, y, angle, length, thick, Math.max(3, Math.floor(length / 18)));
        branchPaths.push(path);
        const end = path[path.length - 1];
        const endpoints = [{ x: end.x, y: end.y }];

        if (depth >= maxDepth) return endpoints;

        // bias number of children like the original: 1..branchFactor
        const children = 1 + Math.floor(rnd() * branchFactor);
        for (let i = 0; i < children; i++) {
            const spread = 0.3 + rnd() * 0.9;
            const dir = (i % 2 === 0) ? 1 : -1;
            const delta = dir * (spread + rnd() * 0.35);
            const newAngle = angle + delta + (rnd() - 0.5) * 0.18;
            const lenScale = 0.55 + rnd() * 0.42;
            const newLen = length * lenScale;
            // compute a child starting thickness that matches the parent's endpoint to avoid shell mismatch
            // start child thickness closer to parent's end to avoid thin necks
            const childStartThick = Math.max(1.0, end.thickness * (0.96 + rnd() * 0.08));
            // still skip strongly downward children
            if (newAngle > -0.2) continue;
            const childEnds = buildBranch(end.x, end.y, newAngle, newLen, childStartThick, depth + 1);
            endpoints.push(...childEnds);
        }

        // occasional small twig off mid-point
        if (rnd() < 0.28 && depth > 0) {
            const mid = path[Math.max(1, Math.floor(path.length * 0.45))];
            const twigA = angle + (rnd() - 0.5) * 1.6;
            buildBranch(mid.x, mid.y, twigA, length * 0.45, Math.max(0.6, thick * 0.35), depth + 1);
        }

        return endpoints;
    }

    // spawn side branches only above crownStart (keep trunk as before)
    for (let i = 1; i < trunkPath.length; i++) {
        const p = trunkPath[i];
        if (p.y <= crownStart) {
            const sideCount = 1 + Math.floor(rnd() * 2);
            for (let s = 0; s < sideCount; s++) {
                const baseA = -Math.PI / 2 + (rnd() - 0.5) * 0.12; // local bias similar to trunk
                const a = baseA + (rnd() > 0.5 ? 1 : -1) * (0.28 + rnd() * 0.8);
                const l = (height / 4) * (0.85 + rnd() * 0.5);
                // start branch thickness from the trunk point thickness to smoothly continue the shell
                const t = Math.max(1, p.thickness * (0.9 + rnd() * 0.18));
                const ends = buildBranch(p.x, p.y, a, l, t, 0);
                canopyEndpoints.push(...ends);
            }
        }
    }

    // canopy points from branch endpoints (same as original)
    for (const p of canopyEndpoints) {
        placeLeafCluster(p.x + (rnd() - 0.5) * 12, p.y + (rnd() - 0.5) * 8, 0.9 + rnd() * 1.4);
    }

    // top cluster (use trunk tip as reference)
    const trunkTip = trunkPath[trunkPath.length - 1];
    placeLeafCluster(trunkTip.x + (rnd() - 0.5) * 8, trunkTip.y - (leafSize * 0.5 + rnd() * 8), 2.2 + rnd() * 1.2);

    // extra canopy density
    for (let i = 0; i < canopyDensity; i++) {
        const ang = rnd() * Math.PI * 2;
        const rad = (rnd() * 0.95 + 0.05) * (height * 0.26);
        const lx = trunkTip.x + Math.cos(ang) * rad * 0.35 + (rnd() - 0.5) * 18;
        const ly = trunkTip.y + Math.sin(ang) * rad * 0.12 - (rnd() * height * 0.2);
        placeLeafCluster(lx, ly, 0.6 + rnd() * 1.6);
    }

    // ---- draw branch polygons (shells) from centerlines ----
    function drawShells() {
        shells.clear();

        // grouping epsilon for shared points (pixels)
        const eps = 0.5;
        const keyFor = (x, y) => `${Math.round(x / eps)},${Math.round(y / eps)}`;

        // collect local directions and thicknesses for every occurrence of a point
        const occ = new Map(); // key -> [{dx,dy,thickness}]
        for (const path of branchPaths) {
            if (!path || path.length < 1) continue;
            for (let i = 0; i < path.length; i++) {
                const p = path[i];
                let dx = 0, dy = 0;
                if (i < path.length - 1) {
                    dx = path[i + 1].x - p.x;
                    dy = path[i + 1].y - p.y;
                }
                if ((Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) && i > 0) {
                    dx = p.x - path[i - 1].x;
                    dy = p.y - path[i - 1].y;
                }
                const L = Math.hypot(dx, dy) || 1;
                dx /= L; dy /= L;
                const k = keyFor(p.x, p.y);
                if (!occ.has(k)) occ.set(k, []);
                occ.get(k).push({ dx, dy, thickness: p.thickness || 1 });
            }
        }

        // average directions per shared location -> produce a single normal per key
        const normals = new Map(); // key -> {nx,ny}
        for (const [k, arr] of occ.entries()) {
            let sx = 0, sy = 0;
            for (const a of arr) { sx += a.dx; sy += a.dy; }
            const L = Math.hypot(sx, sy) || 1;
            sx /= L; sy /= L;
            // perpendicular normal
            normals.set(k, { nx: -sy, ny: sx });
        }

        // build per-path left/right points using the averaged normals for shared vertices
        for (const path of branchPaths) {
            if (!path || path.length < 2) continue;
            const leftPts = [];
            const rightPts = [];
            for (let i = 0; i < path.length; i++) {
                const p = path[i];
                const k = keyFor(p.x, p.y);
                const n = normals.get(k);
                let nx = n?.nx, ny = n?.ny;
                if (typeof nx !== 'number' || typeof ny !== 'number') {
                    // fallback to local perpendicular
                    let dx = 0, dy = -1;
                    if (i < path.length - 1) { dx = path[i + 1].x - p.x; dy = path[i + 1].y - p.y; }
                    else if (i > 0) { dx = p.x - path[i - 1].x; dy = p.y - path[i - 1].y; }
                    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
                    nx = -dy; ny = dx;
                }
                const half = (p.thickness || 1) * 0.5;
                leftPts.push({ x: p.x + nx * half, y: p.y + ny * half });
                rightPts.push({ x: p.x - nx * half, y: p.y - ny * half });
            }

            // draw polygon for this path using the consistent normals
            shells.beginFill(trunkColor);
            shells.moveTo(leftPts[0].x, leftPts[0].y);
            for (let i = 1; i < leftPts.length; i++) shells.lineTo(leftPts[i].x, leftPts[i].y);
            for (let i = rightPts.length - 1; i >= 0; i--) shells.lineTo(rightPts[i].x, rightPts[i].y);
            shells.closePath();
            shells.endFill();
        }
    }

    drawShells();

    container.addChild(leaves);
    container.addChild(shells);

    // leaves visibility helpers
    leaves.visible = !!showLeavesOpt;
    container.setLeavesVisible = (v) => { leaves.visible = !!v; };
    container.toggleLeaves = () => { leaves.visible = !leaves.visible; return leaves.visible; };
    container.getLeavesVisible = () => !!leaves.visible;


    const basePt = trunkPath[0];
    container.pivot.set(basePt.x || 0, basePt.y || 0);


    // small sway data for optional animation (pixels & radians)
    // make amplitude be in visible pixels / radians
    container.sway = {
        amp: 2 + rnd() * 6,           // horizontal sway in pixels
        freq: 0.6 + rnd() * 1.2,     // oscillation speed
        phase: rnd() * Math.PI * 2,
        xAmp: 0.6 + rnd() * 1.6,     // horizontal multiplier
        rotAmp: 0.01 + rnd() * 0.03  // rotation amplitude (radians)
    };

    container._swayTime = 0;
    container.update = (dt = 0) => {
        try {
            const s = container.sway || { amp: 0, freq: 0, phase: 0, xAmp: 0 };

            container._swayTime += Math.max(0, dt);
            const t = container._swayTime + (s.phase || 0);
            // use pixel/radian amplitudes so sway is visible
            const swayX = Math.sin(t * s.freq) * (s.amp || 1) * (s.xAmp || 1);
            const swayR = Math.sin(t * s.freq * 0.6) * (s.rotAmp || 0.02);
            //container.x = container._baseX + swayX;
            container.rotation = swayR;
        } catch (e) { /* defensive */ }
    };
    // short helper to set base position (keeps update consistent)
    container.setBasePosition = (x, y) => { if (Number.isFinite(x)) container._baseX = x; if (Number.isFinite(y)) container._baseY = y; container.x = container._baseX; container.y = container._baseY; };
    // keep leaves toggle helpers already present

    return container;
}

export default createTree;