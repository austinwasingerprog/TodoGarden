import * as PIXI from 'pixi.js';
import { SpriteSheetBuilder } from './spriteFactory.js';
import { Terrain } from './terrain.js';
import { Background } from './background.js';
import { WeedManager } from './weedManager.js';
import { Dialog } from './ui/dialog.js';
import { Controls } from './ui/controls.js';
import spriteSheetUrl from './resources/adventurer-v1.5-Sheet.png';

// Constants
const GRAVITY = 1200; // pixels / s^2
const PLAYER_SPEED = 220; // pixels / s
const SPRINT_MULTIPLIER = 2; // sprint speed = PLAYER_SPEED * SPRINT_MULTIPLIER
const GROUND_TOLERANCE = 6; // px tolerance to snap to ground
const FALL_VELOCITY_THRESHOLD = 80; // px/s downward to be considered "falling"
const JUMP_VELOCITY_THRESHOLD = 80; // px/s upward to be considered "jumping"

(async () => {
    const app = new PIXI.Application({ resizeTo: window, resolution: 1, autoDensity: false });
    app.view.style.imageRendering = 'pixelated';
    document.body.appendChild(app.view);

    // allow children drawn by zIndex so UI can sit above world/terrain
    app.stage.sortableChildren = true;

    const background = new Background(app);
    app.stage.addChildAt(background.container, 0);
    background.resize();

    // central resize handler: main owns layout lifecycle so controls get repositioned correctly
    // controls created later (after world) so they render on top
    let controls = null;
    const onResize = () => {
        background.resize();
        try { if (controls) controls.resize(); } catch (e) { /* ignore */ }
    };
    window.addEventListener('resize', onResize);
    onResize();

    // detect maximize / restore and handle minimize (visibility) and focus changes.
    // There is no direct maximize/minimize event, so combine resize + visibility/focus heuristics.
    let _lastOuterW = window.outerWidth, _lastOuterH = window.outerHeight;
    let _lastInnerW = window.innerWidth, _lastInnerH = window.innerHeight;
    function _handleWindowState(e) {
        // ensure we run after the browser has a chance to resize canvas; try RAF then a short timeout fallback
        const syncAndLayout = () => {
            try {
                // if inner size changed, force renderer resize so controls/background read updated dims
                if (window.innerWidth !== _lastInnerW || window.innerHeight !== _lastInnerH) {
                    try { app.renderer.resize(window.innerWidth, window.innerHeight); } catch (resizeErr) { /* ignore */ }
                    _lastInnerW = window.innerWidth; _lastInnerH = window.innerHeight;
                }
            } finally {
                // central layout update
                onResize();
            }
        };

        requestAnimationFrame(() => {
            syncAndLayout();
            // fallback in case renderer updates slightly later (covers maximize timing quirks)
            setTimeout(syncAndLayout, 120);
        });

        // update outer size tracking
        _lastOuterW = window.outerWidth; _lastOuterH = window.outerHeight;
    }

    // visibilitychange handles minimize / tab hidden; focus/blur cover other cases
    document.addEventListener('visibilitychange', _handleWindowState, { passive: true });
    window.addEventListener('focus', _handleWindowState, { passive: true });
    window.addEventListener('blur', _handleWindowState, { passive: true });
    // keep resize routed through the same handler (already added above)
    // ensure we also respond to fullscreen changes
    document.addEventListener('fullscreenchange', _handleWindowState);

    const world = new PIXI.Container();
    app.stage.addChild(world);
    app.stage.setChildIndex(world, app.stage.children.length - 1);

    // create controls AFTER world so they sit above terrain/world visuals
    controls = new Controls(app, { text: 'press [S] to plant a weed (to-do item) | press [E] to water (complete) a weed' });
    app.stage.addChild(controls.container);
    // ensure initial layout
    try { controls.resize(); } catch (e) {}

    // ticker-based renderer-size watcher: robustly detect maximize/restore timing and call onResize
    let _lastRendererW = app.renderer.width, _lastRendererH = app.renderer.height;
    app.ticker.add(() => {
        const rw = app.renderer.width, rh = app.renderer.height;
        if (rw !== _lastRendererW || rh !== _lastRendererH) {
            _lastRendererW = rw; _lastRendererH = rh;
            onResize();
        }
    });

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
    player.x = app.renderer.width * 0.5;
    player.y = app.renderer.height * 0.2;
    // keep container sizing automatic; don't force width from child textures

    world.addChild(player);

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
    world.addChildAt(terrain.container, 0);

    // instantiate WeedManager with app, world, player, terrain
    // WeedManager will create its own dialog/button (it expects to own UI)
    const weedManager = new WeedManager(app, world, player, terrain);

    window.addEventListener('resize', () => {
        // central resize: keep visuals, UI and terrain visuals in sync
        onResize(); // updates background + controls
        for (const g of terrain.chunks.values()) {
            g.destroy({ children: true, texture: false, baseTexture: false });
        }
        terrain.chunks.clear();
        // regen chunks for the new viewport (visual only)
        terrain.updateForX(player.x);
    });

    const camera = { x: 0, y: 0, smooth: 0.12 };
    function updateCamera(dt) {
        const centerX = app.renderer.width / 2;
        const centerY = app.renderer.height / 2;
        const targetX = centerX - player.x;
        const targetY = centerY - player.y;

        const lerpFactor = 1 - Math.pow(1 - camera.smooth, Math.max(0, dt * 60));

        camera.x += (targetX - camera.x) * lerpFactor;
        camera.y += (targetY - camera.y) * lerpFactor;

        world.x = camera.x;
        world.y = camera.y;

        background.update(camera.x);
    }

    let wateringPressedPrev = false;
    let plantingPressedPrev = false;

    app.ticker.add((delta) => {
        const dt = app.ticker.deltaMS / 1000;
        // update weeds (handles proximity labels & water)
        weedManager.update();

        // watering on key-down edge (E)
        const wateringNow = Boolean(keys['KeyE'] || keys['KeyZ']); // KeyZ optionally
        if (wateringNow && !wateringPressedPrev) {
            weedManager.startWatering();
        }
        wateringPressedPrev = wateringNow;

        // plant (open dialog) on key-down edge (S)
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
            phys.vy = -520;
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