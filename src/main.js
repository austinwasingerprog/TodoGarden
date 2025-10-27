import * as PIXI from 'pixi.js';
import { SpriteSheetBuilder } from './spriteFactory.js';
import { Terrain } from './terrain.js';
import { Background } from './background.js';

// Constants
const GRAVITY = 1200; // pixels / s^2
const PLAYER_SPEED = 220; // pixels / s
// tolerance + thresholds to avoid animation jitter on small slopes
const GROUND_TOLERANCE = 6;              // px tolerance to snap to ground
const FALL_VELOCITY_THRESHOLD = 80;      // px/s downward to be considered "falling"
const JUMP_VELOCITY_THRESHOLD = 80;      // px/s upward to be considered "jumping"

(async () => {
    // Make the canvas resize to the window and use nearest-neighbor pixel rendering
    const app = new PIXI.Application({ resizeTo: window, resolution: 1, autoDensity: false });
    app.view.style.imageRendering = 'pixelated';
    document.body.appendChild(app.view);

    // --- Background (bright sky) and world container ---
    const background = new Background(app);
    // add background behind everything (index 0)
    app.stage.addChildAt(background.container, 0);
    background.resize();

    // world container will be camera-translated; background stays fixed
    const world = new PIXI.Container();
    app.stage.addChild(world);
    // ensure world is above the background
    app.stage.setChildIndex(world, app.stage.children.length - 1);

    const spritePath = 'src/resources/adventurer-v1.5-sheet.png';
    const frameWidth = 50;
    const frameHeight = 37;

    // Build a small atlas for idle and run (cols 0..3 on row 0 for idle;
    // RunRight is at column 1, rows 1..6 -> addGridFrames(startCol, startRow, endCol, endRow, namePrefix, animationName))
    const playerSpriteBuilder = new SpriteSheetBuilder(spritePath, frameWidth, frameHeight);
    playerSpriteBuilder.addGridFrames(0, 0, 3, 0, 'idleFrame', 'idle');       // idle frames (0,0 .. 3,0)
    playerSpriteBuilder.addGridFrames(1, 1, 6, 1, 'runFrame', 'runRight');   // run-right frames (col 1..6 on row 1)

    // NEW: jump is a single frame at (2,2) and falling is cols 1..2 on row 3
    playerSpriteBuilder.addGridFrames(2, 2, 2, 2, 'jumpFrame', 'jump');      // jump (2,2)
    playerSpriteBuilder.addGridFrames(1, 3, 2, 3, 'fallFrame', 'fall');      // fall (1,3 .. 2,3)

    await playerSpriteBuilder.build();

    const playerIdleAnim = playerSpriteBuilder.createAnimatedSprite('idle', { animationSpeed: 0.08, scale: 4 });
    playerIdleAnim.play();

    // Create run animation (we'll flip this for left)
    const playerRunAnim = playerSpriteBuilder.createAnimatedSprite('runRight', { animationSpeed: 0.12, scale: 4 });
    playerRunAnim.loop = true;
    playerRunAnim.play();
    playerRunAnim.visible = false; // start with idle visible

    // NEW: create jump and fall animations
    const playerJumpAnim = playerSpriteBuilder.createAnimatedSprite('jump', { animationSpeed: 0.0, scale: 4 }); // single-frame
    playerJumpAnim.loop = false;
    playerJumpAnim.visible = false;

    const playerFallAnim = playerSpriteBuilder.createAnimatedSprite('fall', { animationSpeed: 0.10, scale: 4 });
    playerFallAnim.loop = true;
    playerFallAnim.visible = false;

    // player container (for anchor + easier collision)
    const player = new PIXI.Container();
    player.addChild(playerIdleAnim);
    player.addChild(playerRunAnim);
    player.addChild(playerJumpAnim); // added
    player.addChild(playerFallAnim); // added
    playerIdleAnim.anchor.set(0.5, 0.5);
    playerRunAnim.anchor.set(0.5, 0.5);
    playerJumpAnim.anchor.set(0.5, 0.5);
    playerFallAnim.anchor.set(0.5, 0.5);
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

    // Create Terrain using the simplified Terrain signature.
    // ampPixels controls hill height in pixels (use ~200px per request).
    // wavelength controls hill width (500px default, wide hills).
    const terrain = new Terrain(app, {
        wavelength: 1000,      // ~500px per hill
        ampPixels: 100,       // hill amplitude in pixels (requested ~200px)
        chunkWidthPx: 512,    // how wide each generated chunk is (pixels)
        sampleStep: 16,       // sampling step in pixels (lower = smoother)
        seed: 42,
        viewDistanceChunks: 3,
    });
    terrain.updateForX(player.x);
    if (terrain.container.parent === app.stage) app.stage.removeChild(terrain.container);
    world.addChildAt(terrain.container, 0); // keep terrain behind player in world

    // handle resize: redraw background and rebuild terrain chunks to match new height
    window.addEventListener('resize', () => {
        background.resize();
        // rebuild terrain chunks so height fits new renderer height
        for (const g of terrain.chunks.values()) {
            g.destroy({ children: true, texture: false, baseTexture: false });
        }
        terrain.chunks.clear();
        terrain.updateForX(player.x);
    });

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

        // update parallax background using the same camera translation
        background.update(camera.x);
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

        // Snap to ground if within tolerance to avoid tiny gaps on slopes
        if (playerBottomY >= groundY - GROUND_TOLERANCE) {
            // hit (or very near) ground -> snap to surface
            player.y = groundY - playerHalfH;
            // only kill downward velocity
            if (phys.vy > 0) phys.vy = 0;
            phys.onGround = true;
        } else {
            phys.onGround = false;
        }

        // Choose animation: running when moving horizontally on ground, otherwise idle/jump/fall
        const isRunning = Math.abs(phys.vx) > 1 && phys.onGround;

        // helper to switch visible animation and ensure play state
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
            // airborne: use velocity thresholds so tiny slope-driven vy doesn't trigger jump/fall
            if (phys.vy < -JUMP_VELOCITY_THRESHOLD) {
                showAnim(playerJumpAnim);
            } else if (phys.vy > FALL_VELOCITY_THRESHOLD) {
                showAnim(playerFallAnim);
            } else {
                // still airborne but slow vertical movement -> prefer fall animation (or keep previous)
                showAnim(playerFallAnim);
            }
        } else {
            if (isRunning) {
                showAnim(playerRunAnim);
            } else {
                showAnim(playerIdleAnim);
            }
        }

        // update player sprite orientation (flip all sprites)
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

        // update camera (pass dt for smooth lerp)
        updateCamera(dt);
    });
})();