import * as PIXI from 'pixi.js';
import { SpriteSheetBuilder } from './spriteFactory.js';
import { Terrain } from './terrain.js';
import { Background } from './background.js';
import { WeedManager } from './weedManager.js';
import { Dialog } from './ui/dialog.js';
import { Controls } from './ui/controls.js';
import spriteSheetUrl from './resources/adventurer-v1.5-Sheet.png';
import { createTree } from './tree.js';

// Constants
const GRAVITY = 1200; // pixels / s^2
const PLAYER_SPEED = 220; // pixels / s
const SPRINT_MULTIPLIER = 2; // sprint speed = PLAYER_SPEED * SPRINT_MULTIPLIER
const GROUND_TOLERANCE = 6; // px tolerance to snap to ground
const FALL_VELOCITY_THRESHOLD = 80; // px/s downward to be considered "falling"
const JUMP_VELOCITY_THRESHOLD = 80; // px/s upward to be considered "jumping"
const PLAYER_JUMP_VEL = 1000;
(async () => {
    const app = new PIXI.Application(
        {
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true
        });
    app.view.style.imageRendering = 'pixelated';
    app.stage.sortableChildren = true;
    document.body.appendChild(app.view);

    const background = new Background(app);
    app.stage.addChildAt(background.container, 0);
    background.resize();

    const world = new PIXI.Container();
    app.stage.addChild(world);
    app.stage.setChildIndex(world, app.stage.children.length - 1);

    const controls = new Controls(app, { text: 'press [S] to plant a weed (to-do item) | press [E] to water (complete) a weed' });
    app.stage.addChild(controls.container);

    const playerSpriteBuilder = new SpriteSheetBuilder(spriteSheetUrl, 50, 37);
    playerSpriteBuilder.addGridFrames(0, 0, 3, 0, 'idleFrame', 'idle');
    playerSpriteBuilder.addGridFrames(1, 1, 6, 1, 'runFrame', 'runRight');
    playerSpriteBuilder.addGridFrames(2, 2, 2, 2, 'jumpFrame', 'jump');
    playerSpriteBuilder.addGridFrames(1, 3, 2, 3, 'fallFrame', 'fall');

    await playerSpriteBuilder.build();

    const playerIdleAnim = playerSpriteBuilder.createAnimatedSprite('idle', { animationSpeed: 0.08, scale: 4 });
    playerIdleAnim.gotoAndStop(0);
    playerIdleAnim.play();

    const playerRunAnim = playerSpriteBuilder.createAnimatedSprite('runRight', { animationSpeed: 0.12, scale: 4 });
    playerRunAnim.gotoAndStop(0);
    playerRunAnim.loop = true;
    playerRunAnim.play();
    playerRunAnim.visible = false;

    const playerJumpAnim = playerSpriteBuilder.createAnimatedSprite('jump', { animationSpeed: 0.0, scale: 4 });
    playerJumpAnim.gotoAndStop(0);
    playerJumpAnim.loop = false;
    playerJumpAnim.visible = false;

    const playerFallAnim = playerSpriteBuilder.createAnimatedSprite('fall', { animationSpeed: 0.10, scale: 4 });
    playerFallAnim.gotoAndStop(0);
    playerFallAnim.loop = true;
    playerFallAnim.visible = false;

    const player = new PIXI.Container();
    player.addChild(playerIdleAnim);
    player.addChild(playerRunAnim);
    player.addChild(playerJumpAnim);
    player.addChild(playerFallAnim);
    // DO NOT override child anchors here — SpriteSheetBuilder already set bottom-center anchors
    // (removing the center-anchor overrides fixes the floating/visibility issue).
    // use app.screen (logical/CSS pixels) so coordinates stay stable when resolution != 1
    player.x = app.screen.width * 0.5;
    player.y = app.screen.height * 0.2;
    // keep container sizing automatic; don't force width from child textures

    const phys = {
        vx: 0,
        vy: 0,
        onGround: false,
        width: 50 * 4,
        height: 37 * 4,
    };

    // position each AnimatedSprite so its visual bottom sits at container.y + halfHeight
    // (physics treats player.y as the character center, so this makes visual bottom == player.y + halfHeight)
    const frameHalfH = phys.height / 2 + 5;
    [playerIdleAnim, playerRunAnim, playerJumpAnim, playerFallAnim].forEach(a => {
        try { a.anchor.set(0.5, 1); } catch (e) { /* ignore if not AnimatedSprite */ }
        a.x = 0;
        a.y = frameHalfH;
    });

    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    const terrain = new Terrain(app, {
        wavelength: 1000,
        ampPixels: 100,
        chunkWidthPx: 512,
        sampleStep: 16,
        seed: 42,
        viewDistanceChunks: 3,
    });
    terrain.updateForX(player.x);
    if (terrain.container.parent === app.stage) app.stage.removeChild(terrain.container);

    const trees = [];
    for (var i=0; i<10; i++) {
        let treeX = i * 600;
        let treeY = terrain.groundY(treeX) + 10;
        const tree = createTree('tree' + i, {
            height: 300 + Math.round(Math.random() * 200),
            branchFactor: 3,
            minBranchThickness: 1.8,
            canopyDensity: 10 + Math.round(Math.random() * 20),
            depth: 4,
            x: treeX,
            y: treeY
        });
        world.addChild(tree);
        trees.push(tree);
    }

    world.addChild(terrain.container);
    world.addChild(player);

    // instantiate WeedManager with app, world, player, terrain
    // WeedManager will create its own dialog/button (it expects to own UI)
    const weedManager = new WeedManager(app, world, player, terrain);

    const onResize = () => {
        background.resize();

        for (const g of terrain.chunks.values()) {
            g.destroy({ children: true, texture: false, baseTexture: false });
        }
        terrain.chunks.clear();
        terrain.updateForX(player.x);

        controls.resize();
    };

    window.addEventListener('resize', onResize);
    onResize();

    // ticker-based renderer-size watcher: robustly detect maximize/restore timing and call onResize
    // track logical screen size instead of backing-buffer size
    let _lastRendererW = app.screen.width, _lastRendererH = app.screen.height;
    app.ticker.add(() => {
        // use app.screen for camera centering (logical pixels)
        const rw = app.screen.width, rh = app.screen.height;
        if (rw !== _lastRendererW || rh !== _lastRendererH) {
            _lastRendererW = rw; _lastRendererH = rh;
            onResize();
        }
    });

    const camera = { x: 0, y: 0, smooth: 0.05 };
    function updateCamera(dt) {
        const centerX = app.screen.width / 2;
        const centerY = app.screen.height / 2;
        const targetX = centerX - player.x;
        const targetY = centerY - player.y;

        const lerpFactor = 1 - Math.pow(1 - camera.smooth, Math.max(0, dt * 60));

        camera.x += (targetX - camera.x) * lerpFactor;
        camera.y += (targetY - camera.y) * lerpFactor;

        world.x = camera.x;
        world.y = camera.y;

        background.update(camera.x);
    }

    // -----------------------
    // Mobile / pointer controls
    // -----------------------
    // map active pointerId -> 'left'|'right'|'none'
    const activePointers = new Map();
    const pointerTapInfo = new Map();
    // prevent default touch behaviors (panning/zoom)
    app.view.style.touchAction = 'none';

    // prevent long-press vibration / context menu on mobile
    app.view.style.webkitUserSelect = 'none';
    app.view.style.userSelect = 'none';
    app.view.style.webkitTouchCallout = 'none';
    app.view.style.webkitTapHighlightColor = 'transparent';

    // block context menu
    app.view.addEventListener('contextmenu', (e) => e.preventDefault());

    // make touchstart non-passive so we can prevent the default long-press behavior that triggers haptics
    app.view.addEventListener('touchstart', (e) => {
        e.preventDefault();
    }, { passive: false });

    // also prevent pointer context for some platforms
    app.view.addEventListener('pointerdown', (e) => {
        // don't prevent normal pointer handling here — only block the default OS long-press action
        // calling preventDefault on pointerdown can be used if you still see haptics on some devices:
        // e.preventDefault();
    }, { passive: true });

    function screenToWorld(clientX, clientY) {
        const rect = app.view.getBoundingClientRect();
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        const wx = sx - camera.x;
        const wy = sy - camera.y;
        return { sx, sy, wx, wy };
    }

    app.view.addEventListener('pointerdown', (ev) => {
        const { sx, sy, wx, wy } = screenToWorld(ev.clientX, ev.clientY);
        pointerTapInfo.set(ev.pointerId, { sx, sy, t: performance.now() });

        // 1) Edge-based movement takes priority — start moving even if pointer is over a weed
        const leftEdge = app.screen.width * 0.25;
        const rightEdge = app.screen.width * 0.75;
        if (sx < leftEdge) {
            keys['ArrowLeft'] = true;
            activePointers.set(ev.pointerId, 'left');
            return;
        } else if (sx > rightEdge) {
            keys['ArrowRight'] = true;
            activePointers.set(ev.pointerId, 'right');
            return;
        }
        activePointers.set(ev.pointerId, 'none');

        // 2) If not an edge press, check for weed taps (water)
        try {
            if (weedManager && Array.isArray(weedManager.weeds)) {
                for (const w of weedManager.weeds) {
                    const b = w.container && typeof w.container.getBounds === 'function' ? w.container.getBounds() : null;
                    if (b && b.contains(sx, sy)) {
                        player.x = (typeof w.x === 'number') ? w.x : (w.container.x || player.x);
                        terrain.updateForX(player.x);
                        if (typeof weedManager.startWatering === 'function') weedManager.startWatering();
                        activePointers.set(ev.pointerId, 'none');
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }
    });

    function releasePointer(id) {
        const side = activePointers.get(id);
        if (side === 'left') keys['ArrowLeft'] = false;
        if (side === 'right') keys['ArrowRight'] = false;
        activePointers.delete(id);
        pointerTapInfo.delete(id);
    }

    app.view.addEventListener('pointerup', (ev) => {
        releasePointer(ev.pointerId);
        // optionally detect quick taps here if you want tap-on-up behavior
    });
    app.view.addEventListener('pointercancel', (ev) => releasePointer(ev.pointerId));
    app.view.addEventListener('pointerout', (ev) => releasePointer(ev.pointerId));
    app.view.addEventListener('pointerleave', (ev) => releasePointer(ev.pointerId));

    let wateringPressedPrev = false;
    let plantingPressedPrev = false;

    app.ticker.add((delta) => {
        const dt = app.ticker.deltaMS / 1000;
        
        weedManager.update();

        for (const tree of trees) {
            tree.update(dt);
        }

        const wateringNow = Boolean(keys['KeyE']);
        if (wateringNow && !wateringPressedPrev) {
            weedManager.startWatering();
        }
        wateringPressedPrev = wateringNow;

        const plantingNow = Boolean(keys['KeyS']);
        if (plantingNow && !plantingPressedPrev) {
            if (weedManager && weedManager.dialog && typeof weedManager.dialog.open === 'function') {
                weedManager.dialog.open();
            }
        }
        plantingPressedPrev = plantingNow;

        let move = 0;
        if (keys['ArrowLeft'] || keys['KeyA']) move -= 1;
        if (keys['ArrowRight'] || keys['KeyD']) move += 1;

        const sprint = Boolean(keys['ShiftLeft'] || keys['ShiftRight'] || keys['Shift']);
        const speedMul = sprint ? SPRINT_MULTIPLIER : 1;

        phys.vx = move * PLAYER_SPEED * speedMul;

        if ((keys['Space'] || keys['KeyW'] || keys['ArrowUp']) && phys.onGround) {
            phys.vy = -PLAYER_JUMP_VEL;
            phys.onGround = false;
        }

        phys.vy += GRAVITY * dt;

        player.x += phys.vx * dt;
        player.y += phys.vy * dt;

        terrain.updateForX(player.x);

        const playerBottomX = player.x;
        const groundY = terrain.groundY(playerBottomX);
        const playerHalfH = phys.height / 2;
        const playerBottomY = player.y + playerHalfH;

        if (playerBottomY >= groundY - GROUND_TOLERANCE) {
            player.y = groundY - playerHalfH;
            if (phys.vy > 0) phys.vy = 0;
            phys.onGround = true;
        } else {
            phys.onGround = false;
        }

        const isRunning = Math.abs(phys.vx) > 1 && phys.onGround;

        function showAnim(anim) {
            const all = [playerIdleAnim, playerRunAnim, playerJumpAnim, playerFallAnim];
            for (const a of all) {
                if (a === anim) {
                    if (!a.visible) a.visible = true;
                    if (!a.playing) a.play();
                } else {
                    if (a.visible) a.visible = false;
                    if (a.playing) a.stop();
                }
            }
        }

        if (!phys.onGround) {
            if (phys.vy < -JUMP_VELOCITY_THRESHOLD) {
                showAnim(playerJumpAnim);
            } else if (phys.vy > FALL_VELOCITY_THRESHOLD) {
                showAnim(playerFallAnim);
            } else {
                showAnim(playerFallAnim);
            }
        } else {
            if (isRunning) {
                showAnim(playerRunAnim);
            } else {
                showAnim(playerIdleAnim);
            }
        }

        if (playerRunAnim) {
            playerRunAnim.animationSpeed = sprint ? 0.22 : 0.12;
        }

        const baseScaleX = Math.abs(playerRunAnim.scale.x) || Math.abs(playerIdleAnim.scale.x) || 1;
        if (phys.vx < 0) {
            playerRunAnim.scale.x = -baseScaleX;
            playerIdleAnim.scale.x = -baseScaleX;
            playerJumpAnim.scale.x = -baseScaleX;
            playerFallAnim.scale.x = -baseScaleX;
        } else if (phys.vx > 0) {
            playerRunAnim.scale.x = baseScaleX;
            playerIdleAnim.scale.x = baseScaleX;
            playerJumpAnim.scale.x = baseScaleX;
            playerFallAnim.scale.x = baseScaleX;
        }

        updateCamera(dt);
    });
})();