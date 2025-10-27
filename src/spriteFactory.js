import * as PIXI from 'pixi.js';
const { BaseTexture, Spritesheet, AnimatedSprite } = PIXI;

// Simple builder to assemble atlas JSON for a single image and produce PIXI AnimatedSprites
export class SpriteSheetBuilder {
    constructor(imagePath, frameW, frameH, metaSize = null) {
        this.imagePath = imagePath;
        this.frameW = frameW;
        this.frameH = frameH;
        this.atlasData = {
            frames: {},
            meta: {
                image: imagePath,
                size: metaSize || { w: 0, h: 0 },
                scale: 1,
            },
            animations: {},
        };
        this._nextIndex = 0;
        this.spritesheet = null;
        this.baseTexture = null;
    }

    // startCol/startRow and endCol/endRow are inclusive (grid coords, 0-based)
    addGridFrames(startCol, startRow, endCol, endRow, namePrefix = 'frame', animationName = 'default') {
        if (!this.atlasData.frames) this.atlasData.frames = {};
        this.atlasData.animations[animationName] = this.atlasData.animations[animationName] || [];

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const name = `${namePrefix}_${this._nextIndex++}`;
                this.atlasData.frames[name] = {
                    frame: { x: col * this.frameW, y: row * this.frameH, w: this.frameW, h: this.frameH },
                    rotated: false,
                    trimmed: false,
                    spriteSourceSize: { x: 0, y: 0, w: this.frameW, h: this.frameH },
                    sourceSize: { w: this.frameW, h: this.frameH },
                };
                this.atlasData.animations[animationName].push(name);
            }
        }
    }

    // parse the spritesheet (creates Textures) and returns the parsed Spritesheet
    async build() {
        this.baseTexture = BaseTexture.from(this.imagePath);
        this.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        // if meta size wasn't provided, fill it from the baseTexture once loaded
        if (!this.atlasData.meta.size || (this.atlasData.meta.size.w === 0 && this.atlasData.meta.size.h === 0)) {
            this.atlasData.meta.size = { w: this.baseTexture.width, h: this.baseTexture.height };
        }
        this.spritesheet = new Spritesheet(this.baseTexture, this.atlasData);
        await this.spritesheet.parse();
        return this.spritesheet;
    }

    // convenience to create an AnimatedSprite from a parsed spritesheet
    createAnimatedSprite(animationName, options = {}) {
        if (!this.spritesheet) throw new Error('Spritesheet not built — call build() first.');
        const { animationSpeed = 0.1, scale = 1, loop = true } = options;
        const frames = this.spritesheet.animations[animationName];
        if (!frames) throw new Error(`Animation "${animationName}" not found`);
        const anim = new AnimatedSprite(frames);
        anim.animationSpeed = animationSpeed;
        anim.loop = loop;
        anim.scale.set(scale);
        return anim;
    }
}