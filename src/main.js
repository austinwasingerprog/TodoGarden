import * as PIXI from 'pixi.js';
import { SpriteSheetBuilder } from './spriteFactory.js';
import { Terrain } from './terrain.js';

// Constants
const GRAVITY = 1200; // pixels / s^2
const PLAYER_SPEED = 220; // pixels / s
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;

(async () => {
    const app = new PIXI.Application({ resolution: 1, autoDensity: false, width: 800, height: 600 });
    app.view.style.imageRendering = 'pixelated';
    document.body.appendChild(app.view);

    // --- Background (bright sky) and world container ---
    const background = new PIXI.Graphics();
    background.beginFill(0x87CEFF); // light/bright sky blue
    background.drawRect(0, 0, app.renderer.width, app.renderer.height);
    background.endFill();
    app.stage.addChild(background);

    // world container will be camera-translated; background stays fixed
    const world = new PIXI.Container();
    app.stage.addChild(world);

    const spritePath = 'src/resources/adventurer-v1.5-sheet.png';
    const frameWidth = 50;
    const frameHeight = 37;

    // Build a small atlas for the first 4 frames (cols 0..3 on row 0)
    const playerSpriteBuilder = new SpriteSheetBuilder(spritePath, frameWidth, frameHeight);
    playerSpriteBuilder.addGridFrames(0, 0, 3, 0, 'idleFrame', 'idle');
    await playerSpriteBuilder.build();
    const playerIdleAnim = playerSpriteBuilder.createAnimatedSprite('idle', { animationSpeed: 0.08, scale: 4 });
    playerIdleAnim.play();

    // player container (for anchor + easier collision)
    const player = new PIXI.Container();
    player.addChild(playerIdleAnim);
    playerIdleAnim.anchor.set(0.5, 0.5);
    player.x = app.renderer.width * 0.5;
    player.y = app.renderer.height * 0.2;
    player.width = playerIdleAnim.width; // doesn't matter much; we use sprite bounds

    // add player to world (not stage) so camera moves the world but not the background
    world.addChild(player);

    // Physics state
    const phys = {
        vx: 0,
        vy: 0,
        onGround: false,
        width: frameWidth * 4, // scaled sprite approx
        height: frameHeight * 4,
    };

    // Input
    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    // Create Terrain (it initially attached its container to stage; reparent into world)
    const terrain = new Terrain(app, { tileSize: 16, chunkTiles: 32, viewDistanceChunks: 3, seed: 42, ampTiles: 6, noiseScale: 0.04 });
    terrain.updateForX(player.x);
    if (terrain.container.parent === app.stage) app.stage.removeChild(terrain.container);
    world.addChildAt(terrain.container, 0); // keep terrain behind player in world

    // Camera helper (smoothed / lerped)
    const camera = { x: 0, y: 0, smooth: 0.12 }; // increase smooth -> slower camera
    function updateCamera(dt) {
        // desired world position to center the player (world pos so background stays fixed)
        const centerX = app.renderer.width / 2;
        const centerY = app.renderer.height / 2;
        const targetX = centerX - player.x;
        const targetY = centerY - player.y;

        // frame-rate-independent exponential lerp:
        // lerpFactor ~ 1 - (1 - smooth)^(dt*60)
        const lerpFactor = 1 - Math.pow(1 - camera.smooth, Math.max(0, dt * 60));

        camera.x += (targetX - camera.x) * lerpFactor;
        camera.y += (targetY - camera.y) * lerpFactor;

        // translate the world container only
        world.x = camera.x;
        world.y = camera.y;
    }

    // Main loop
    app.ticker.add((delta) => {
        const dt = app.ticker.deltaMS / 1000; // seconds since last frame

        // Input -> horizontal velocity
        let move = 0;
        if (keys['ArrowLeft'] || keys['KeyA']) move -= 1;
        if (keys['ArrowRight'] || keys['KeyD']) move += 1;
        phys.vx = move * PLAYER_SPEED;

        // Jump
        if ((keys['Space'] || keys['KeyW'] || keys['ArrowUp']) && phys.onGround) {
            phys.vy = -520; // initial jump velocity (pixels/s)
            phys.onGround = false;
        }

        // apply gravity
        phys.vy += GRAVITY * dt;

        // integrate
        player.x += phys.vx * dt;
        player.y += phys.vy * dt;

        // update terrain generation around player
        terrain.updateForX(player.x);

        // Simple collision with heightmap (player bottom against ground)
        const playerBottomX = player.x; // sample at player's center
        const groundY = terrain.groundY(playerBottomX);
        const playerHalfH = phys.height / 2;
        const playerBottomY = player.y + playerHalfH;
        if (playerBottomY >= groundY) {
            // hit ground -> snap to surface
            player.y = groundY - playerHalfH;
            phys.vy = 0;
            phys.onGround = true;
        } else {
            phys.onGround = false;
        }

        // update player sprite orientation
        if (phys.vx < 0) playerIdleAnim.scale.x = -Math.abs(playerIdleAnim.scale.x);
        else if (phys.vx > 0) playerIdleAnim.scale.x = Math.abs(playerIdleAnim.scale.x);

        // update camera (pass dt for smooth lerp)
        updateCamera(dt);
    });
})();