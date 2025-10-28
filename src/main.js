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

    let treeY = terrain.groundY(0) + 10;
    // create alpha tree (use opts to control appearance). showLeaves false -> starts hidden.
    const alphaTree = createTree('alpha' + Math.random() * 1000, {
        height: 420,
        trunkWidth: 60,
        branchFactor: 3,
        minBranchThickness: 3,
        depth: 4,
        leafSize: 10,
        canopyDensity: 30,
        x: 0,
        y: treeY,
        showLeaves: true
    });
    // ensure base position is correct and consistent with tree.update sway
    //if (typeof alphaTree.setBasePosition === 'function') alphaTree.setBasePosition(0, treeY);
    //if (typeof alphaTree.setLeavesVisible === 'function') alphaTree.setLeavesVisible(false);
    world.addChild(alphaTree);

    // keyboard: toggle leaves for debugging/runtime control (press 'L')
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyL' && alphaTree && typeof alphaTree.toggleLeaves === 'function') {
            const nowVis = alphaTree.toggleLeaves();
            console.log('alphaTree leaves visible =', nowVis);
        }
    });

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

    let wateringPressedPrev = false;
    let plantingPressedPrev = false;

    app.ticker.add((delta) => {
        const dt = app.ticker.deltaMS / 1000;
        weedManager.update();
        // update tree sway / runtime effects
        try {
            const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;
            if (alphaTree && typeof alphaTree.update === 'function') alphaTree.update(dt, now);
        } catch (e) { /* ignore */ }

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