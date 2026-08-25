/* ============================================================================
 *  CAN USTA — KITCHEN PATROL
 *  A side-scrolling action prototype on the bare HTML5 Canvas 2D context.
 *  No engine, no framework, no build step: open index.html and play.
 *
 *  ARCHITECTURE
 *    Game        owns the loop, the states and every subsystem.
 *    LevelMap    tile matrix + all world-vs-AABB queries and raycasts.
 *    Player      the chef. Kinematics, crouch, coyote/buffer, chopping.
 *    Kuzu        the sheep ("kuzu" = lamb). Finite state machine AI.
 *    Cut         the player's projectile (a flying cleaver arc).
 *    Bullet      the sheep's projectile (a spat wad of grass).
 *    Camera      lerp tracking + decaying screen-shake matrix.
 *    HUD         hearts, counters, banners, all in a 5x7 bitmap font.
 *
 *  DESIGN RULES OBSERVED THROUGHOUT
 *    * Physics runs on a FIXED timestep (1/60 s). Rendering is decoupled and
 *      may run at any refresh rate; nothing can tunnel at low FPS.
 *    * All collision is strict AABB with explicit displacement correction.
 *    * All world coordinates are floats; all *draw* coordinates are snapped
 *      to integers so the pixel grid never shimmers.
 * ==========================================================================*/

'use strict';

/* ==========================================================================
 * 1. CONFIGURATION
 * ========================================================================*/

const CFG = {
  /* --- rendering ------------------------------------------------------- */
  BASE_VIEW_W: 480,         // 16:9 baseline used by desktop displays
  VIEW_W: 480,              // widens on landscape phones; never stretches
  VIEW_H: 270,
  MAX_MOBILE_VIEW_W: 640,   // enough for ultrawide phones without tiny art
  TILE: 16,                 // tileset cell size, px

  /* --- world ----------------------------------------------------------- */
  MAP_COLS: 180,            // ACT 1: 180 * 16 = 2880 px == 6 screen widths
  MAP_ROWS: 17,             // 17 * 16 = 272 px  (2 px of vertical slack)
  KITCHEN_COLS: 78,         // ACT 2: 78 * 16 = 1248 px (yard, line, salon)

  /* --- fixed-step simulation ------------------------------------------- */
  DT: 1 / 60,               // one physics tick
  MAX_FRAME: 0.25,          // clamp huge tab-switch deltas
  MAX_STEPS: 5,             // spiral-of-death guard

  /* --- player kinematics (see the governing equations in Player.step) --- */
  GRAVITY: 1500,            // g,  px/s^2
  JUMP_V: -450,             // v0, px/s
  ACCEL_X: 2000,            // a_x, px/s^2
  FRICTION: 0.85,           // linear decel factor applied when no input
  MAX_SPEED: 150,           // horizontal clamp, px/s
  MAX_FALL: 900,            // terminal velocity; keeps |dy| < TILE per tick
  COYOTE: 0.066,            // 4 frames of late-jump grace
  JUMP_BUFFER: 0.05,        // 3 frames of early-jump memory
  DROP_THRU: 0.18,          // one-way platforms ignored for this long

  PLAYER_W: 20,
  PLAYER_H: 48,             // standing AABB height
  PLAYER_H_CROUCH: 24,      // crouched AABB height  (= H / 2, per spec)
  PLAYER_HP: 3,
  PLAYER_IFRAMES: 1.1,

  /* --- combat ---------------------------------------------------------- */
  CUT_SPEED: 1200,          // player projectile, px/s
  CUT_COOLDOWN: 0.22,
  CUT_LIFE: 0.42,
  BULLET_SPEED: 400,        // sheep grass wad, px/s
  SHEEP_FIRE_RATE: 1.2,     // seconds between spits
  SHEEP_SIGHT: 250,         // line-of-sight raycast length, px
  SHEEP_HP: 2,
  SHEEP_W: 30,
  SHEEP_H: 30,
  SHEEP_SPEED: 26,
  SHEEP_CHARGE: 58,
  SHEEP_TOTAL: 20,          // win condition target

  /* --- juice ------------------------------------------------------------ */
  HITSTOP: 0.05,            // 3 frames of global freeze on a connecting cut
  FLASH_FRAMES: 2,          // solid-white damage flash, in ticks
  SHAKE_DECAY: 9,           // lambda in Intensity * e^(-lambda*t)
  CAM_LERP: 0.1,

  /* --- level ------------------------------------------------------------ */
  EXTRACTION_COL: 168,      // extraction zone starts here (tile column)
};

CFG.WORLD_W = CFG.MAP_COLS * CFG.TILE;   // 2880 (Act 1; Act 2 differs)
CFG.WORLD_H = CFG.MAP_ROWS * CFG.TILE;   // 272

/* Three family-friendly difficulty levels. RAHAT never triggers a game-over;
 * it is a sandbox for younger children who mainly want to cook and explore. */
const DIFFICULTY = {
  NORMAL: 'normal',
  EASY: 'easy',
  RELAXED: 'relaxed',
};
const DIFFICULTY_ORDER = [DIFFICULTY.NORMAL, DIFFICULTY.EASY, DIFFICULTY.RELAXED];
const DIFFICULTY_LABEL = {
  [DIFFICULTY.NORMAL]: 'NORMAL',
  [DIFFICULTY.EASY]: 'KOLAY',
  [DIFFICULTY.RELAXED]: 'RAHAT - OYUN BİTMEZ',
};

/* ---- ACT 2: "CAN USTA - MANGAL", the grill service game ---------------- */
CFG.K = {
  GRILL_TIME: 2.8,          // seconds for the cook meter to travel 0 -> 1
  RAW_MAX: 0.55,            // below this the skewer is still raw
  PERFECT_MAX: 0.95,        // above this it is burnt  (window ~1.2 s)
  BURN_OUT: 1.9,            // cook value at which it is unsalvageable char

  // ECONOMY. Two numbers, deliberately separate:
  //   love — the spendable wallet. Diners pay in it, the shop drains it.
  //   fame — lifetime love EARNED. Never spent, never falls. Wins the game.
  // Splitting them means hiring accelerates you toward the win rather than
  // pushing you away from it, and a spending spree can never lock the menu.
  // The wage bill has to be payable out of a single service, or the shop is
  // a museum: you buy one hire and never afford another. Income is sized so
  // a good run can staff most of the roster and still have slack.
  LOVE_START: 26,           // opening float in the till
  LOVE_PERFECT: 10,         // a delighted diner tips well
  LOVE_OK: 4,               // an acceptable plate
  LOVE_BAD: -5,             // a rejected plate: you refund the takings
  LOVE_TIMEOUT: -4,         // walked out before being served
  FAME_PERFECT: 9,          // fame tracks love EARNED, so these mirror it
  FAME_OK: 3,
  MAX_COMPLAINTS: 5,

  // THE SQUEEZE. Word of mouth is supposed to outgrow one pair of hands:
  // as fame spreads, diners arrive faster and wait less, until a solo chef
  // simply cannot cover the room and the payroll stops being optional.
  PATIENCE: 34,             // seconds the first diners will wait
  PATIENCE_FLOOR: 19,       // ...the floor once the place is packed
  PATIENCE_RAMP: 0.30,      // seconds shaved off per diner served

  QUEUE_SLOTS: 4,           // how many can wait at the pass at once
  SPAWN_GAP: 5.2,           // base seconds between "ambient" arrivals
  SPAWN_GAP_MIN: 2.0,       // ...as busy as it is ever allowed to get
  HYPE_PER_GAP: 0.30,       // each point of hype shortens the gap by this

  // Word of mouth. A delighted diner brings ONE friend, never more: the
  // queue must not be able to outgrow what one chef can physically serve,
  // or perfect play still ends in a wall of walkouts. The *growth* the
  // player feels comes from `hype` shortening the arrival gap and from the
  // menu expanding, not from an unbounded backlog.
  WOM_PERFECT: 1,
  WOM_OK: 0,
  HYPE_PERFECT: 1,
  HYPE_OK: 0.5,

  // WASHING UP. Every plate you send out comes back dirty. Run out of clean
  // ones and the pass shuts down until somebody scrubs — which is exactly
  // the job the BULASIKCI exists to do.
  PLATES: 6,                // the whole stock of plates in the house
  WASH_TIME: 0.45,          // seconds the chef spends on one plate
  SHELF_MAX: 5,             // finished plates the pass shelf can hold
};

/* ==========================================================================
 * 2. SMALL MATH / UTILITY HELPERS
 * ========================================================================*/

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randSign = () => (Math.random() < 0.5 ? -1 : 1);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Strict axis-aligned bounding-box overlap. Touching edges do NOT count. */
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ==========================================================================
 * 3. ASSET MANIFEST + PROMISE-BASED PRELOADER
 *
 *    Every frame size below maps 1:1 back to the animation blueprint table.
 *    tools/gen_assets.py writes the PNGs at exactly these dimensions.
 * ========================================================================*/

const ASSET_MANIFEST = {
  //  key              path                                    fw  fh  frames  fps  loop
  PLAYER_IDLE:   { src: 'assets/sprites/player_idle.png',       fw: 48, fh: 48, frames: 4, fps: 8,  loop: true  },
  PLAYER_RUN:    { src: 'assets/sprites/player_run.png',        fw: 48, fh: 48, frames: 6, fps: 12, loop: true  },
  PLAYER_JUMP:   { src: 'assets/sprites/player_jump.png',       fw: 48, fh: 48, frames: 3, fps: 10, loop: false },
  PLAYER_CROUCH: { src: 'assets/sprites/player_crouch.png',     fw: 48, fh: 48, frames: 2, fps: 6,  loop: true  },
  PLAYER_SHOOT:  { src: 'assets/sprites/player_shoot.png',      fw: 48, fh: 48, frames: 4, fps: 16, loop: false },
  ENEMY_WALK:    { src: 'assets/sprites/enemy_thug_walk.png',   fw: 48, fh: 48, frames: 4, fps: 8,  loop: true  },
  ENEMY_ATTACK:  { src: 'assets/sprites/enemy_thug_attack.png', fw: 48, fh: 48, frames: 4, fps: 10, loop: true  },
  // ACT 2. CUSTOMER is an 8-column x 3-row sheet: the rows are three
  // different diners, selected per-entity via AnimationController.variant.
  CUSTOMER:      { src: 'assets/sprites/customer.png',         fw: 48, fh: 48, frames: 4, fps: 9,  loop: true, rows: 3 },
  // Non-animated sheets: frames/fps are irrelevant, only the image matters.
  STAFF:         { src: 'assets/sprites/staff.png',             fw: 48, fh: 48, frames: 4, fps: 6,  loop: true, rows: 5 },
  STATIONS:      { src: 'assets/sprites/stations.png' },
  STATIONS_UP:   { src: 'assets/sprites/stations_up.png' },
  FOOD:          { src: 'assets/ui/food_icons.png' },
  BG_KITCHEN:    { src: 'assets/environment/background_kitchen.png' },
  BG_GARDEN:     { src: 'assets/environment/background_garden.png' },
  TILESET:       { src: 'assets/environment/tileset.png' },
  BG_FAR:        { src: 'assets/environment/background_far.png' },
  BG_NEAR:       { src: 'assets/environment/background_near.png' },
  HUD:           { src: 'assets/ui/hud_elements.png' },
};

class AssetLoader {
  constructor(manifest) {
    this.manifest = manifest;
    this.images = Object.create(null);
    this.total = Object.keys(manifest).length;
    this.done = 0;
    this.errors = [];
  }

  /** Resolves once every image has fully decoded (or definitively failed). */
  load() {
    const jobs = Object.entries(this.manifest).map(([key, def]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.images[key] = img;
          this.done++;
          resolve();
        };
        img.onerror = () => {
          // Never reject: a missing PNG must not deadlock the loader. We
          // substitute a magenta placeholder so the failure is obvious.
          this.errors.push(def.src);
          this.images[key] = AssetLoader.placeholder(def.fw || 48, def.fh || 48);
          this.done++;
          resolve();
        };
        img.src = def.src;
      })
    );
    return Promise.all(jobs).then(() => this);
  }

  static placeholder(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000000'; g.fillRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#ff00ff';
    for (let i = 0; i < w + h; i += 8) g.fillRect(i, 0, 2, h);
    return c;
  }

  get(key) { return this.images[key]; }
  get progress() { return this.total === 0 ? 1 : this.done / this.total; }
}

/* ==========================================================================
 * 4. 5x7 BITMAP FONT
 *
 *    Rendered once into a white atlas, then re-tinted on demand and cached.
 *    Keeps the HUD authentically pixel-crisp at the 480x270 base resolution.
 * ========================================================================*/

const FONT_W = 5, FONT_H = 7, FONT_GAP = 1;

const FONT_GLYPHS = {
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '<': ['.....', '...#.', '..#..', '.#...', '..#..', '...#.', '.....'],
  '>': ['.....', '.#...', '..#..', '...#.', '..#..', '.#...', '.....'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  // Turkish letterforms. Without these the whole game reads as mangled
  // ASCII (CALISAN for CALISAN, BORC for BORC) which is worse than useless.
  'Ç': ['.###.', '#...#', '#....', '#....', '#...#', '.###.', '..#..'],
  'Ğ': ['.#.#.', '..#..', '.###.', '#....', '#.###', '#...#', '.###.'],
  'İ': ['..#..', '#####', '..#..', '..#..', '..#..', '..#..', '#####'],
  'Ö': ['.#.#.', '.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'Ş': ['.####', '#....', '.###.', '....#', '....#', '####.', '..#..'],
  'Ü': ['.#.#.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

class PixelFont {
  /** Turkish-aware uppercase: i -> İ and ı -> I, which the default rules
   *  get backwards. Everything else falls through to the normal mapping. */
  static upper(text) {
    return String(text).replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  }

  constructor() {
    this.order = Object.keys(FONT_GLYPHS);
    this.index = new Map(this.order.map((ch, i) => [ch, i]));
    this.atlas = this._bake();
    this.tints = new Map();          // css colour -> tinted atlas canvas
  }

  /** Bake every glyph into a single white 1-bit strip. */
  _bake() {
    const c = document.createElement('canvas');
    c.width = this.order.length * FONT_W;
    c.height = FONT_H;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    this.order.forEach((ch, i) => {
      const rows = FONT_GLYPHS[ch];
      for (let y = 0; y < FONT_H; y++) {
        for (let x = 0; x < FONT_W; x++) {
          if (rows[y][x] === '#') g.fillRect(i * FONT_W + x, y, 1, 1);
        }
      }
    });
    return c;
  }

  /** Lazily produce (and cache) a solid-colour copy of the atlas. */
  _tinted(color) {
    let t = this.tints.get(color);
    if (t) return t;
    t = document.createElement('canvas');
    t.width = this.atlas.width;
    t.height = this.atlas.height;
    const g = t.getContext('2d');
    g.drawImage(this.atlas, 0, 0);
    g.globalCompositeOperation = 'source-in';   // keep alpha, replace RGB
    g.fillStyle = color;
    g.fillRect(0, 0, t.width, t.height);
    g.globalCompositeOperation = 'source-over';
    this.tints.set(color, t);
    return t;
  }

  width(text, scale = 1) {
    return text.length * (FONT_W + FONT_GAP) * scale - FONT_GAP * scale;
  }

  /**
   * @param {object} o  {color, scale, align:'left'|'center'|'right', shadow}
   */
  draw(ctx, text, x, y, o = {}) {
    const scale = o.scale || 1;
    const color = o.color || '#f8e9cf';
    const str = PixelFont.upper(text);
    const w = this.width(str, scale);

    let px = Math.round(x);
    if (o.align === 'center') px = Math.round(x - w / 2);
    else if (o.align === 'right') px = Math.round(x - w);
    const py = Math.round(y);

    if (o.shadow) this._blit(ctx, str, px + scale, py + scale, scale, o.shadow);
    this._blit(ctx, str, px, py, scale, color);
    return w;
  }

  _blit(ctx, str, px, py, scale, color) {
    const atlas = this._tinted(color);
    const adv = (FONT_W + FONT_GAP) * scale;
    for (let i = 0; i < str.length; i++) {
      const gi = this.index.get(str[i]);
      if (gi === undefined) continue;            // silently skip unknowns
      if (str[i] === ' ') continue;              // nothing to blit
      ctx.drawImage(
        atlas, gi * FONT_W, 0, FONT_W, FONT_H,
        px + i * adv, py, FONT_W * scale, FONT_H * scale
      );
    }
  }
}

/* ==========================================================================
 * 5. ANIMATION ENGINE
 *
 *    An Animation is immutable metadata straight out of the blueprint table;
 *    an AnimationController is the per-entity playhead over it.
 * ========================================================================*/

class Animation {
  constructor(image, def) {
    this.image = image;
    this.fw = def.fw;                   // frame width  (blueprint column 3)
    this.fh = def.fh;                   // frame height (blueprint column 4)
    this.frames = def.frames;           // total frames (blueprint column 5)
    this.fps = def.fps;                 // speed        (blueprint column 6)
    this.loop = def.loop !== false;
    this.frameTime = 1 / def.fps;
    // `from` lets several clips share one sheet: the customer sheet packs
    // walk (0-3), idle (4-5), delighted (6) and furious (7) side by side.
    this.from = def.from || 0;
  }
}

class AnimationController {
  constructor() {
    this.anim = null;
    this.name = '';
    this.time = 0;
    this.frame = 0;
    this.finished = false;
    // Row index into a multi-row sheet (customer palettes). 0 for everyone
    // else, whose sheets are a single row tall.
    this.variant = 0;
  }

  /**
   * Switch clips. Re-playing the same clip does not restart it unless
   * `force` is set — that keeps run cycles continuous across state churn.
   */
  play(name, anim, force = false) {
    if (this.name === name && !force) return;
    this.name = name;
    this.anim = anim;
    this.time = 0;
    this.frame = 0;
    this.finished = false;
  }

  update(dt) {
    if (!this.anim) return;
    this.time += dt;
    while (this.time >= this.anim.frameTime) {
      this.time -= this.anim.frameTime;
      if (this.frame + 1 >= this.anim.frames) {
        if (this.anim.loop) this.frame = 0;
        else { this.frame = this.anim.frames - 1; this.finished = true; }
      } else {
        this.frame++;
      }
    }
  }

  /**
   * Blit the current frame.
   *
   * @param dx,dy  top-left of the sprite cell in *screen* space, already
   *               offset by the caller so the art aligns with the AABB.
   * @param flip   true renders mirrored about the cell's vertical centre.
   * @param white  true renders a pure solid-white silhouette (damage flash).
   */
  draw(ctx, dx, dy, flip, white, scratch) {
    if (!this.anim) return;
    const a = this.anim;
    const sx = (a.from + this.frame) * a.fw;
    const sy = this.variant * a.fh;
    const ix = Math.round(dx), iy = Math.round(dy);

    let src = a.image, srcX = sx, srcY = sy;

    if (white) {
      // Solid-white damage flash. Draw the frame into a scratch buffer, then
      // `source-in` a white fill over it: alpha is preserved, RGB replaced.
      scratch.clear(a.fw, a.fh);
      scratch.ctx.drawImage(a.image, sx, sy, a.fw, a.fh, 0, 0, a.fw, a.fh);
      scratch.ctx.globalCompositeOperation = 'source-in';
      scratch.ctx.fillStyle = '#ffffff';
      scratch.ctx.fillRect(0, 0, a.fw, a.fh);
      scratch.ctx.globalCompositeOperation = 'source-over';
      src = scratch.canvas; srcX = 0; srcY = 0;
    }

    if (flip) {
      ctx.save();
      ctx.translate(ix + a.fw, iy);
      ctx.scale(-1, 1);
      ctx.drawImage(src, srcX, srcY, a.fw, a.fh, 0, 0, a.fw, a.fh);
      ctx.restore();
    } else {
      ctx.drawImage(src, srcX, srcY, a.fw, a.fh, ix, iy, a.fw, a.fh);
    }
  }
}

/** Reusable offscreen buffer for the white-flash composite. */
class Scratch {
  constructor(w = 64, h = 64) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }
  clear(w, h) {
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
      this.ctx.imageSmoothingEnabled = false;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

/* ==========================================================================
 * 6. INPUT
 *
 *    Edge-triggered ("pressed") and level-triggered ("held") queries, with
 *    the edge set cleared once per *fixed step* so buffering stays exact.
 * ========================================================================*/

const KEYMAP = {
  KeyA: 'left',  ArrowLeft: 'left',      // strafe left
  KeyD: 'right', ArrowRight: 'right',    // strafe right
  KeyS: 'down',  ArrowDown: 'down',      // crouch / climb down / menu down
  KeyW: 'jump',                          // jump
  Space: 'chop',                         // Act 1: cleaver. Act 2: the action key.
  ArrowUp: 'up',                         // climb a spit / menu up
  KeyE: 'use', KeyF: 'use',              // interact, pick up, hire, wash up
  KeyX: 'dismiss',                       // MAAŞ GÜNÜ: let a worker go
  KeyO: 'retry',
  KeyP: 'pause', Escape: 'pause',
};

class Input {
  constructor(target) {
    this.held = Object.create(null);
    this.pressed = Object.create(null);
    this.keyboardHeld = Object.create(null);
    this.touchCounts = Object.create(null);
    this.touchPointers = new Map();
    this.anyPressed = false;
    this.worldTouchAllowed = () => false;

    target.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      // Stop the page from scrolling under the canvas.
      if (a) e.preventDefault();
      this.anyPressed = true;
      if (!a || e.repeat) return;
      this.keyboardHeld[a] = true;
      this.held[a] = true;
      this.pressed[a] = true;
    });

    target.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      this.keyboardHeld[a] = false;
      if (!(this.touchCounts[a] > 0)) this.held[a] = false;
    });

    // A lost focus must not leave keys stuck down.
    window.addEventListener('blur', () => this.releaseAll());

    const touchCapable = navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 900px) and (max-height: 500px)').matches;
    this.touchMode = touchCapable;
    document.documentElement.classList.toggle('touch-enabled', touchCapable);
    this.bindTouchControls(document.getElementById('mobile-controls'));
    this.bindWorldTouch(document.getElementById('game'));

    // Hybrid laptops may report no touch points until the first real touch.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touchMode = true;
        document.documentElement.classList.add('touch-enabled');
      }
    }, { passive: true });
  }

  /** Map each finger to one or more existing game actions. */
  bindTouchControls(root) {
    if (!root) return;
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // iOS Safari can interpret three quick taps as a double-tap zoom even
    // when the viewport is locked. Gameplay is handled on pointerdown, so
    // cancelling the browser's compatibility touch/click gestures does not
    // discard any chop presses.
    root.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });

    for (const button of root.querySelectorAll('[data-actions]')) {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const actions = button.dataset.actions.trim().split(/\s+/);

        // Full-screen is a browser command, not a held game action. Keeping
        // it on pointerdown preserves the user gesture required by iOS and
        // Android browsers. Unsupported browsers simply keep playing.
        if (actions.includes('fullscreen')) {
          const page = document.documentElement;
          const active = document.fullscreenElement || document.webkitFullscreenElement;
          const request = page.requestFullscreen || page.webkitRequestFullscreen;
          const leave = document.exitFullscreen || document.webkitExitFullscreen;
          try {
            const result = active ? leave?.call(document) : request?.call(page);
            result?.then?.(() => {
              if (!active) screen.orientation?.lock?.('landscape').catch(() => {});
            }).catch?.(() => {});
          } catch (_) { /* Fullscreen is optional on older mobile Safari. */ }
          button.classList.add('is-held');
          window.setTimeout(() => button.classList.remove('is-held'), 140);
          return;
        }

        button.setPointerCapture?.(e.pointerId);
        if (this.touchPointers.has(e.pointerId)) return;
        this.touchPointers.set(e.pointerId, { actions, button });
        button.classList.add('is-held');

        for (const action of actions) {
          const wasDown = this.down(action);
          this.touchCounts[action] = (this.touchCounts[action] || 0) + 1;
          this.held[action] = true;
          if (!wasDown) this.pressed[action] = true;
        }
        this.anyPressed = true;
      });

      const release = (e) => {
        const pointer = this.touchPointers.get(e.pointerId);
        if (!pointer) return;
        this.touchPointers.delete(e.pointerId);
        pointer.button.classList.remove('is-held');
        for (const action of pointer.actions) {
          this.touchCounts[action] = Math.max(0, (this.touchCounts[action] || 1) - 1);
          if (this.touchCounts[action] === 0 && !this.keyboardHeld[action]) {
            this.held[action] = false;
          }
        }
      };

      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
  }

  /**
   * Pressing and holding an empty part of the game view replaces the old
   * dedicated TIR button. The gesture maps to the same continuous `up`
   * action as ArrowUp, which is important because climbing is not a tap.
   */
  bindWorldTouch(surface) {
    if (!surface) return;
    const release = (e) => {
      const pointer = this.touchPointers.get(e.pointerId);
      if (!pointer || pointer.button !== surface) return;
      this.touchPointers.delete(e.pointerId);
      this.touchCounts.up = Math.max(0, (this.touchCounts.up || 1) - 1);
      if (this.touchCounts.up === 0 && !this.keyboardHeld.up) this.held.up = false;
    };

    surface.addEventListener('pointerdown', (e) => {
      if (!this.touchMode || !this.worldTouchAllowed() || this.touchPointers.has(e.pointerId)) return;
      e.preventDefault();
      surface.setPointerCapture?.(e.pointerId);
      const wasDown = this.down('up');
      this.touchPointers.set(e.pointerId, { actions: ['up'], button: surface });
      this.touchCounts.up = (this.touchCounts.up || 0) + 1;
      this.held.up = true;
      if (!wasDown) this.pressed.up = true;
      this.anyPressed = true;
    });
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('lostpointercapture', release);
  }

  down(a) { return !!this.held[a]; }
  hit(a) { return !!this.pressed[a]; }

  /** Called at the end of every fixed step. */
  endStep() {
    for (const k in this.pressed) this.pressed[k] = false;
    this.anyPressed = false;
  }

  releaseAll() {
    for (const k in this.held) this.held[k] = false;
    for (const k in this.pressed) this.pressed[k] = false;
    for (const k in this.keyboardHeld) this.keyboardHeld[k] = false;
    for (const k in this.touchCounts) this.touchCounts[k] = 0;
    for (const pointer of this.touchPointers.values()) pointer.button.classList.remove('is-held');
    this.touchPointers.clear();
  }
}

/* ==========================================================================
 * 7. CAMERA — lerp tracking + decaying screen shake
 * ========================================================================*/

class Camera {
  constructor() {
    this.x = 0;
    this.y = 2;                 // world is 272 tall, viewport 270
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.ox = 0;
    this.oy = 0;
  }

  /** Cam_x += (Player_x - Cam_x - ScreenWidth/2) * 0.1 */
  follow(target, dt, worldW = CFG.WORLD_W) {
    const want = target.cx - CFG.VIEW_W / 2;
    this.x += (want - this.x) * CFG.CAM_LERP;
    this.x = clamp(this.x, 0, Math.max(0, worldW - CFG.VIEW_W));

    // Offset_{x,y} = Intensity * random(-1,1) * e^(-lambda * t)
    if (this.shakeAmp > 0) {
      this.shakeT += dt;
      const decay = Math.exp(-CFG.SHAKE_DECAY * this.shakeT);
      const mag = this.shakeAmp * decay;
      if (mag < 0.15) {
        this.shakeAmp = 0; this.ox = 0; this.oy = 0;
      } else {
        this.ox = mag * rand(-1, 1);
        this.oy = mag * rand(-1, 1);
      }
    }
  }

  /** Additive impulse: a bigger shake never cancels a smaller one. */
  shake(intensity) {
    const current = this.shakeAmp * Math.exp(-CFG.SHAKE_DECAY * this.shakeT);
    this.shakeAmp = Math.max(intensity, current);
    this.shakeT = 0;
  }

  get drawX() { return Math.round(this.x + this.ox); }
  get drawY() { return Math.round(this.y + this.oy); }
}

/* ==========================================================================
 * 8. LEVEL MAP
 *
 *    Tile ids match the atlas cell index in assets/environment/tileset.png:
 *      atlas source rect = ((id % 8) * 16, floor(id / 8) * 16, 16, 16)
 * ========================================================================*/

const TILE = {
  EMPTY:    0,
  FLOOR:    1,   // checkered restaurant floor, top surface   (solid)
  SUBFLOOR: 2,   // dirt/board fill under the floor           (solid)
  BRICK:    3,   // wall                                      (solid)
  PLATE:    4,   // porcelain plate platform                  (one-way)
  LAHMACUN: 5,   // flatbread layer            (one-way + climbable)
  DONER:    6,   // kebab spit column                         (climbable)
  TREE:     7,   // potted tree, LOWER half        (cover, non-solid)
  TABLE:    8,   // wooden table top                       (semi-solid)
  COUNTER:  9,   // stainless kitchen counter                 (solid)
  CARPET:  10,   // red rug surface                           (solid)
  CRATE:   11,   // flour-sack crate               (solid + cover)
  TREE_TOP:12,   // potted tree, UPPER half        (cover, non-solid)
};

const SOLID_TILES  = new Set([TILE.FLOOR, TILE.SUBFLOOR, TILE.BRICK,
                              TILE.COUNTER, TILE.CARPET, TILE.CRATE]);
// Tables are semi-solid: you hop onto them from below and can drop back
// through, but they still break an enemy's line of sight (see COVER_TILES).
const ONEWAY_TILES = new Set([TILE.PLATE, TILE.LAHMACUN, TILE.TABLE]);
const CLIMB_TILES  = new Set([TILE.LAHMACUN, TILE.DONER]);
/** Tiles that break an enemy's line of sight — this is what "cover" means. */
const COVER_TILES  = new Set([TILE.BRICK, TILE.TABLE, TILE.COUNTER,
                              TILE.CRATE, TILE.TREE, TILE.TREE_TOP]);

class LevelMap {
  constructor(tileset, cols = CFG.MAP_COLS, rows = CFG.MAP_ROWS) {
    this.tileset = tileset;
    this.cols = cols;
    this.rows = rows;
    this.worldW = cols * CFG.TILE;
    this.worldH = rows * CFG.TILE;
    this.tiles = new Uint8Array(this.cols * this.rows);
  }

  /* ---------------------------------------------------------- authoring - */

  set(c, r, t) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
    this.tiles[r * this.cols + c] = t;
  }

  fill(c0, r0, c1, r1, t) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.set(c, r, t);
  }

  at(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return TILE.EMPTY;
    return this.tiles[r * this.cols + c];
  }

  /** A potted tree occupies TWO rows so that it is genuine crouch cover. */
  tree(c, baseRow) {
    this.set(c, baseRow, TILE.TREE);
    this.set(c, baseRow - 1, TILE.TREE_TOP);
  }

  isSolid(c, r) {
    // Outside the left/right edges the world is a wall; above/below it is air.
    if (c < 0 || c >= this.cols) return true;
    if (r < 0 || r >= this.rows) return false;
    return SOLID_TILES.has(this.tiles[r * this.cols + c]);
  }
  isOneWay(c, r) { return ONEWAY_TILES.has(this.at(c, r)); }
  isClimb(c, r) { return CLIMB_TILES.has(this.at(c, r)); }
  blocksSight(c, r) {
    const t = this.at(c, r);
    return COVER_TILES.has(t) || SOLID_TILES.has(t);
  }

  /**
   * ACT 1 — "CAN USTA", the restaurant: six screens wide, built left to
   * right. Rows: 0 is the ceiling line, 15 the floor surface, 16 subfloor.
   */
  buildRestaurant() {
    const F = 15;                                   // floor surface row

    /* ---- continuous floor + subfloor -------------------------------- */
    this.fill(0, F, this.cols - 1, F, TILE.FLOOR);
    this.fill(0, F + 1, this.cols - 1, F + 1, TILE.SUBFLOOR);

    /* ---- hard world bounds ------------------------------------------ */
    this.fill(0, 0, 0, F, TILE.BRICK);
    this.fill(this.cols - 1, 0, this.cols - 1, F, TILE.BRICK);

    /* =============== SECTION A — DINING ROOM  (cols 1..34) =========== */
    this.fill(2, F, 20, F, TILE.CARPET);            // red rug down the aisle
    this.fill(6, 13, 9, 13, TILE.TABLE);            // two dining tables
    this.fill(14, 13, 17, 13, TILE.TABLE);
    this.tree(4, F - 1);                            // two-tile crouch cover
    this.tree(22, F - 1);
    this.fill(10, 10, 13, 10, TILE.PLATE);          // hanging plate platforms
    this.fill(19, 11, 24, 11, TILE.PLATE);
    this.fill(27, 13, 28, 14, TILE.CRATE);          // cover + a step up
    this.fill(30, 9, 34, 9, TILE.PLATE);

    /* =============== SECTION B — THE KITCHEN  (cols 35..75) ========== */
    this.fill(36, 13, 44, 14, TILE.COUNTER);        // prep line
    this.fill(46, 10, 50, 10, TILE.PLATE);
    this.fill(52, 9, 52, 14, TILE.DONER);           // climbable kebab spit
    this.fill(54, 12, 58, 12, TILE.PLATE);
    this.fill(60, 13, 61, 14, TILE.CRATE);
    this.fill(62, 9, 66, 9, TILE.PLATE);
    this.fill(68, 11, 72, 11, TILE.LAHMACUN);       // climb AND stand on it
    this.tree(70, F - 1);
    this.fill(74, 13, 75, 14, TILE.CRATE);

    /* =============== SECTION C — THE PANTRY  (cols 76..120) ========== */
    this.fill(78, 12, 82, 12, TILE.PLATE);
    this.fill(84, 8, 84, 14, TILE.DONER);
    this.fill(86, 8, 95, 8, TILE.LAHMACUN);         // long flatbread mezzanine
    this.fill(88, 12, 91, 12, TILE.PLATE);
    this.fill(93, 13, 94, 14, TILE.CRATE);
    this.fill(97, 11, 101, 11, TILE.PLATE);
    this.fill(100, 5, 100, 10, TILE.DONER);
    this.fill(103, 6, 108, 6, TILE.LAHMACUN);
    this.fill(104, 13, 105, 14, TILE.CRATE);
    this.fill(110, 12, 115, 12, TILE.PLATE);
    this.tree(112, F - 1);
    this.fill(117, 9, 120, 9, TILE.PLATE);

    /* =============== SECTION D — THE GRAND HALL  (cols 121..165) ===== */
    this.fill(122, 13, 126, 13, TILE.TABLE);
    this.fill(124, 10, 124, 12, TILE.BRICK);        // pillar
    this.fill(128, 11, 133, 11, TILE.PLATE);
    this.fill(131, 7, 136, 7, TILE.PLATE);
    this.fill(136, 13, 140, 13, TILE.TABLE);
    this.tree(138, F - 1);
    this.fill(142, 10, 147, 10, TILE.PLATE);
    this.fill(145, 13, 146, 14, TILE.CRATE);
    this.fill(149, 12, 152, 12, TILE.LAHMACUN);
    this.fill(154, 8, 158, 8, TILE.PLATE);
    this.fill(154, 13, 155, 14, TILE.CRATE);
    this.fill(158, 12, 163, 12, TILE.PLATE);
    this.fill(160, 4, 160, 11, TILE.DONER);         // the big rotating spit
    this.tree(164, F - 1);

    /* =============== SECTION E — EXTRACTION  (cols 166..179) ========= */
    this.fill(166, 13, 179, 14, TILE.COUNTER);      // the pass, raised
    this.fill(170, 10, 175, 10, TILE.PLATE);

    return this;
  }

  /**
   * ACT 2 — the kitchen line. Deliberately FLAT: act two is about running
   * the line under time pressure, not platforming, so nothing here may
   * interrupt a sprint between stations. The only geometry is the floor,
   * the tiled back wall and the two end walls.
   */
  buildKitchen() {
    const F = 15;
    this.fill(0, F, this.cols - 1, F, TILE.FLOOR);
    this.fill(0, F + 1, this.cols - 1, F + 1, TILE.SUBFLOOR);
    // Stainless end walls rather than Act 1's brick: this is a kitchen.
    this.fill(0, 0, 0, F, TILE.COUNTER);
    this.fill(this.cols - 1, 0, this.cols - 1, F, TILE.COUNTER);
    return this;
  }

  /* ---------------------------------------------------------- queries -- */

  /**
   * Scan downward from `rowHint` for the first surface an entity can stand
   * on in column `c`. Returns the row *of the surface*, or the floor row.
   */
  surfaceRowBelow(c, rowHint) {
    for (let r = Math.max(0, rowHint); r < this.rows; r++) {
      if (this.isSolid(c, r) || this.isOneWay(c, r)) return r;
    }
    return this.rows - 2;
  }

  /** Is there standing ground directly under this world-space point? */
  hasFootingAt(wx, wy) {
    const c = Math.floor(wx / CFG.TILE);
    const r = Math.floor(wy / CFG.TILE);
    return this.isSolid(c, r) || this.isOneWay(c, r);
  }

  /**
   * Line-of-sight raycast from (x0,y0) to (x1,y1). Samples the segment at
   * half-tile intervals and reports false the moment it enters a cover tile.
   * Interpolating y matters: a sheep's eye and the chef's eye are rarely on
   * the same tile row, and a single-row cast would see straight through a
   * crate the chef is legitimately hiding behind.
   */
  lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return true;
    const steps = Math.max(1, Math.ceil(dist / (CFG.TILE / 2)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const c = Math.floor((x0 + dx * t) / CFG.TILE);
      const r = Math.floor((y0 + dy * t) / CFG.TILE);
      if (this.blocksSight(c, r)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ render - */

  draw(ctx, cam) {
    const t = CFG.TILE;
    const c0 = Math.max(0, Math.floor(cam.drawX / t));
    const c1 = Math.min(this.cols - 1, Math.ceil((cam.drawX + CFG.VIEW_W) / t));
    const r0 = Math.max(0, Math.floor(cam.drawY / t));
    const r1 = Math.min(this.rows - 1, Math.ceil((cam.drawY + CFG.VIEW_H) / t));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const id = this.tiles[r * this.cols + c];
        if (id === TILE.EMPTY) continue;
        const sx = (id % 8) * t;
        const sy = Math.floor(id / 8) * t;
        ctx.drawImage(this.tileset, sx, sy, t, t,
                      c * t - cam.drawX, r * t - cam.drawY, t, t);
      }
    }
  }
}

/* ==========================================================================
 * 9. PHYSICS BODY + TILE COLLISION
 *
 *    Strict AABB with explicit displacement correction, resolved on one axis
 *    at a time. Because the fixed step guarantees |dx|,|dy| < TILE, checking
 *    only the leading edge is sufficient and cannot tunnel.
 * ========================================================================*/

class Body {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.hitWall = false;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get right() { return this.x + this.w; }
  get bottom() { return this.y + this.h; }
  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

/**
 * Integrate one axis at a time and correct the overlap.
 * @param {boolean} useOneWay  false while dropping through a plate.
 */
function moveAndCollide(body, map, dx, dy, useOneWay = true) {
  const T = CFG.TILE;
  body.onGround = false;
  body.hitWall = false;

  /* ---------------------------------------------------------- X axis --- */
  if (dx !== 0) {
    body.x += dx;
    const r0 = Math.floor(body.y / T);
    const r1 = Math.floor((body.bottom - 0.001) / T);
    if (dx > 0) {
      const c = Math.floor((body.right - 0.001) / T);
      for (let r = r0; r <= r1; r++) {
        if (map.isSolid(c, r)) {
          body.x = c * T - body.w;      // displacement correction
          body.vx = 0;
          body.hitWall = true;
          break;
        }
      }
    } else {
      const c = Math.floor(body.x / T);
      for (let r = r0; r <= r1; r++) {
        if (map.isSolid(c, r)) {
          body.x = (c + 1) * T;
          body.vx = 0;
          body.hitWall = true;
          break;
        }
      }
    }
  }

  /* ---------------------------------------------------------- Y axis --- */
  if (dy !== 0) {
    const prevBottom = body.bottom;
    body.y += dy;
    const c0 = Math.floor(body.x / T);
    const c1 = Math.floor((body.right - 0.001) / T);
    if (dy > 0) {
      const r = Math.floor((body.bottom - 0.001) / T);
      for (let c = c0; c <= c1; c++) {
        const solid = map.isSolid(c, r);
        // A one-way platform only catches you if you were fully above it.
        const oneway = useOneWay && map.isOneWay(c, r) && prevBottom <= r * T + 0.5;
        if (solid || oneway) {
          body.y = r * T - body.h;
          body.vy = 0;
          body.onGround = true;
          break;
        }
      }
    } else {
      const r = Math.floor(body.y / T);
      for (let c = c0; c <= c1; c++) {
        if (map.isSolid(c, r)) {
          body.y = (r + 1) * T;
          body.vy = 0;
          break;
        }
      }
    }
  }

  /* ------------------------------------------------- world boundaries -- */
  body.x = clamp(body.x, 0, map.worldW - body.w);
  if (body.y > map.worldH) {            // safety net; the floor is continuous
    body.y = map.worldH - body.h;
    body.vy = 0;
    body.onGround = true;
  }
}

/* ==========================================================================
 * 10. PARTICLES — wool puffs, sparks, dust. Deliberately non-gory.
 * ========================================================================*/

class Particle {
  constructor(x, y, vx, vy, life, size, color, gravity = 220) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color; this.gravity = gravity;
    this.dead = false;
  }
  step(dt) {
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx, cam) {
    const t = this.life / this.maxLife;
    const s = Math.max(1, Math.round(this.size * t));
    ctx.globalAlpha = clamp(t * 1.6, 0, 1);
    ctx.fillStyle = this.color;
    ctx.fillRect(Math.round(this.x - cam.drawX - s / 2),
                 Math.round(this.y - cam.drawY - s / 2), s, s);
    ctx.globalAlpha = 1;
  }
}

/* ==========================================================================
 * 11. PROJECTILES
 * ========================================================================*/

/** The player's cleaver arc. Travels at +/- CUT_SPEED horizontally. */
class Cut {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.w = 14; this.h = 9;
    this.vx = CFG.CUT_SPEED * dir;
    this.dir = dir;
    this.life = CFG.CUT_LIFE;
    this.spin = 0;
    this.dead = false;
  }
  get rect() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }

  step(dt, map) {
    this.x += this.vx * dt;
    this.spin += dt * 26;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const c = Math.floor(this.x / CFG.TILE);
    const r = Math.floor(this.y / CFG.TILE);
    if (map.isSolid(c, r)) this.dead = true;
    if (this.x < 0 || this.x > map.worldW) this.dead = true;
  }

  draw(ctx, cam) {
    const x = Math.round(this.x - cam.drawX);
    const y = Math.round(this.y - cam.drawY);
    // motion trail
    ctx.fillStyle = 'rgba(190,235,255,0.35)';
    ctx.fillRect(x - this.dir * 14, y - 1, 14, 3);
    // spinning blade: a bright lens that pulses with `spin`
    const k = 2 + Math.round(Math.abs(Math.sin(this.spin)) * 3);
    ctx.fillStyle = '#dfeaf7';
    ctx.fillRect(x - 5, y - k, 10, k * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillStyle = '#8fa4c4';
    ctx.fillRect(x + this.dir * 4, y - k, 2, k * 2);
  }
}

/** A sheep's spat wad of grass. Travels at +/- BULLET_SPEED horizontally. */
class Bullet {
  constructor(x, y, dir) {
    this.x = x; this.y = y;
    this.w = 7; this.h = 7;
    this.vx = CFG.BULLET_SPEED * dir;
    this.life = 2.2;
    this.spin = 0;
    this.dead = false;
  }
  get rect() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }

  step(dt, map) {
    this.x += this.vx * dt;
    this.spin += dt * 12;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const c = Math.floor(this.x / CFG.TILE);
    const r = Math.floor(this.y / CFG.TILE);
    if (map.isSolid(c, r)) this.dead = true;
    if (this.x < 0 || this.x > map.worldW) this.dead = true;
  }

  draw(ctx, cam) {
    const x = Math.round(this.x - cam.drawX);
    const y = Math.round(this.y - cam.drawY);
    const w = 2 + Math.round(Math.abs(Math.sin(this.spin)) * 2);
    ctx.fillStyle = '#448c3c';
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillStyle = '#6ebe58';
    ctx.fillRect(x - 2, y - 3, 4, 4);
    ctx.fillStyle = '#9ade7c';
    ctx.fillRect(x - w / 2, y - 4, w, 2);
  }
}

/* ==========================================================================
 * 12. PLAYER — Can Usta himself
 * ========================================================================*/

/* Sprite anchoring: the 48x48 cell has the chef's feet on row 46 and his
 * silhouette centred on column 24. These constants map the art onto the AABB.
 * (tools/gen_assets.py enforces the same contract.)                        */
const P_SPRITE_FOOT = 46;
const P_SPRITE_MIDX = 24;

const PSTATE = { ALIVE: 0, DYING: 1, DEAD: 2 };

class Player {
  constructor(game, x, y) {
    this.game = game;
    this.body = new Body(x, y, CFG.PLAYER_W, CFG.PLAYER_H);
    this.anim = new AnimationController();

    this.facing = 1;               // +1 right, -1 left
    this.crouching = false;
    this.climbing = false;
    this.state = PSTATE.ALIVE;

    this.hp = CFG.PLAYER_HP;
    this.iframes = 0;
    this.flashTicks = 0;           // solid-white frames remaining

    this.coyote = 0;               // time left to still count as grounded
    this.jumpBuffer = 0;           // time left on a buffered jump press
    this.dropTimer = 0;            // one-way collision disabled while > 0
    this.cutCooldown = 0;
    this.cutAnimTimer = 0;         // how long to keep showing PLAYER_SHOOT
    this.deathTimer = 0;
    this.canChop = true;           // Act 2 disables combat; J becomes USE

    // Seed a clip immediately so the chef is visible before his first step
    // (the title screen renders the live world behind the banner).
    this.anim.play('idle', game.anims.PLAYER_IDLE);
  }

  get cx() { return this.body.cx; }
  get rect() { return this.body.rect; }

  /* ------------------------------------------------------------- damage - */

  hurt(fromX) {
    if (this.state !== PSTATE.ALIVE || this.iframes > 0) return;
    this.hp--;
    this.iframes = CFG.PLAYER_IFRAMES;
    this.flashTicks = CFG.FLASH_FRAMES;
    // knockback away from the source
    const dir = sign(this.body.cx - fromX) || -this.facing;
    this.body.vx = dir * 140;
    this.body.vy = -180;
    this.game.camera.shake(7);
    this.game.hitstop = Math.max(this.game.hitstop, 0.06);
    this.game.sfx.hurt();
    this.game.burst(this.body.cx, this.body.cy, 10, '#f2b53c');

    // RAHAT mode is a true no-game-over playground. The hit still has
    // sound, knockback and feedback, but Can Usta always gets back up.
    if (this.game.difficulty === DIFFICULTY.RELAXED && this.hp <= 0) {
      this.hp = 1;
      this.iframes = 2.0;
      this.game.act1Popups.push(new Popup(this.body.cx, this.body.y - 10,
                                          'DEVAM CAN USTA!', '#74e0b0'));
      return;
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = PSTATE.DYING;
      this.deathTimer = 1.0;               // 1 s of dramatic shake, per spec
      this.game.camera.shake(12);
      this.game.sfx.die();
    }
  }

  /* ------------------------------------------------------------- update - */

  step(dt, map, input) {
    if (this.state === PSTATE.DYING) return this._stepDying(dt, map);
    if (this.state === PSTATE.DEAD) return;

    if (this.iframes > 0) this.iframes -= dt;
    if (this.dropTimer > 0) this.dropTimer -= dt;
    if (this.cutCooldown > 0) this.cutCooldown -= dt;
    if (this.cutAnimTimer > 0) this.cutAnimTimer -= dt;
    if (this.flashTicks > 0) this.flashTicks--;

    const b = this.body;
    const wantLeft = input.down('left');
    const wantRight = input.down('right');
    const wantDown = input.down('down');
    const wantUp = input.down('up');

    /* ---- crouch: halve the AABB height, keeping the feet planted ------ */
    const wantCrouch = wantDown && b.onGround && !this.climbing;
    this._setCrouch(wantCrouch, map);

    /* ---- climbing the doner spits & lahmacun layers ------------------- */
    this._updateClimb(dt, map, input, wantUp, wantDown);

    /* ---- horizontal kinematics ---------------------------------------
     * v_x(t+dt) = clamp( v_x(t) + a_x*dt , -maxSpeed, +maxSpeed )
     * with the friction coefficient applied only when no input is held,
     * exactly as the control spec describes.
     * ------------------------------------------------------------------ */
    let ax = 0;
    if (wantLeft && !wantRight) { ax = -CFG.ACCEL_X; this.facing = -1; }
    else if (wantRight && !wantLeft) { ax = CFG.ACCEL_X; this.facing = 1; }

    // Crouching pins you in place — that is what makes it *cover*.
    if (this.crouching) ax = 0;

    b.vx += ax * dt;
    if (ax === 0) b.vx *= CFG.FRICTION;
    if (Math.abs(b.vx) < 1) b.vx = 0;
    b.vx = clamp(b.vx, -CFG.MAX_SPEED, CFG.MAX_SPEED);

    /* ---- coyote time & input buffering -------------------------------- */
    if (b.onGround) this.coyote = CFG.COYOTE; else this.coyote -= dt;
    if (input.hit('jump')) this.jumpBuffer = CFG.JUMP_BUFFER;
    else this.jumpBuffer -= dt;

    /* ---- jump / drop-through ------------------------------------------ */
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.climbing)) {
      if (wantDown && b.onGround && this._standingOnOneWay(map)) {
        // S + W (crouch + jump) on a semi-solid plate: drop through it.
        this.dropTimer = CFG.DROP_THRU;
        b.y += 1;
        b.vy = 40;
        this.game.sfx.drop();
      } else {
        b.vy = CFG.JUMP_V;             // v_0, applied instantaneously
        this.game.sfx.jump();
        this.game.puff(b.cx, b.bottom, 5);
      }
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.climbing = false;
      this._setCrouch(false, map);
    }

    // Variable jump height: releasing SPACE early cuts the rise short.
    if (b.vy < 0 && !input.down('jump')) b.vy *= 0.86;

    /* ---- vertical kinematics:  v_y(t+dt) = v_y(t) + g*dt -------------- */
    if (!this.climbing) {
      b.vy += CFG.GRAVITY * dt;
      b.vy = Math.min(b.vy, CFG.MAX_FALL);
    }

    /* ---- chop --------------------------------------------------------- */
    if (this.canChop && input.hit('chop') && this.cutCooldown <= 0) this._chop();

    /* ---- integrate:  x += v_x*dt ,  y += v_y*dt ----------------------- */
    const wasAir = !b.onGround;
    moveAndCollide(b, map, b.vx * dt, b.vy * dt, this.dropTimer <= 0);
    if (wasAir && b.onGround) {
      this.game.puff(b.cx, b.bottom, 4);        // landing dust
    }

    this._animate();
  }

  _stepDying(dt, map) {
    this.deathTimer -= dt;
    const b = this.body;
    b.vy += CFG.GRAVITY * dt;
    b.vx *= 0.9;
    moveAndCollide(b, map, b.vx * dt, b.vy * dt, false);
    this.game.camera.shake(6);
    this.anim.play('jump', this.game.anims.PLAYER_JUMP);
    this.anim.update(dt);
    if (this.deathTimer <= 0) {
      this.state = PSTATE.DEAD;
      this.game.onPlayerDead();
    }
  }

  /* -------------------------------------------------------- sub-systems - */

  /** Grow/shrink the AABB about the FEET so crouching never clips a floor. */
  _setCrouch(on, map) {
    if (on === this.crouching) return;
    const b = this.body;
    if (on) {
      b.y += CFG.PLAYER_H - CFG.PLAYER_H_CROUCH;
      b.h = CFG.PLAYER_H_CROUCH;
      this.crouching = true;
    } else {
      // Refuse to stand up if the full-height box would intersect geometry.
      const test = { x: b.x, y: b.y - (CFG.PLAYER_H - CFG.PLAYER_H_CROUCH),
                     w: b.w, h: CFG.PLAYER_H };
      if (this._boxHitsSolid(test, map)) return;
      b.y = test.y;
      b.h = CFG.PLAYER_H;
      this.crouching = false;
    }
  }

  _boxHitsSolid(r, map) {
    const T = CFG.TILE;
    const c0 = Math.floor(r.x / T), c1 = Math.floor((r.x + r.w - 0.001) / T);
    const r0 = Math.floor(r.y / T), r1 = Math.floor((r.y + r.h - 0.001) / T);
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++)
        if (map.isSolid(cc, rr)) return true;
    return false;
  }

  _standingOnOneWay(map) {
    const T = CFG.TILE;
    const r = Math.floor((this.body.bottom + 1) / T);
    const c0 = Math.floor(this.body.x / T);
    const c1 = Math.floor((this.body.right - 0.001) / T);
    for (let c = c0; c <= c1; c++) {
      if (map.isSolid(c, r)) return false;       // real ground wins
      if (map.isOneWay(c, r)) return true;
    }
    return false;
  }

  _updateClimb(dt, map, input, wantUp, wantDown) {
    const b = this.body;
    const c = Math.floor(b.cx / CFG.TILE);
    const rTop = Math.floor(b.y / CFG.TILE);
    const rMid = Math.floor(b.cy / CFG.TILE);
    const onLadder = map.isClimb(c, rTop) || map.isClimb(c, rMid);

    if (!onLadder) { this.climbing = false; return; }
    if (!this.climbing && (wantUp || (wantDown && !b.onGround))) {
      this.climbing = true;
      this._setCrouch(false, map);
    }
    if (this.climbing) {
      b.vy = (wantUp ? -70 : 0) + (wantDown ? 70 : 0);
      b.vx *= 0.6;
      // Snap toward the ladder centre so you never rub off the edge.
      const centre = c * CFG.TILE + CFG.TILE / 2;
      b.x = lerp(b.x, centre - b.w / 2, 0.25);
    }
  }

  _chop() {
    this.cutCooldown = CFG.CUT_COOLDOWN;
    this.cutAnimTimer = 4 / ASSET_MANIFEST.PLAYER_SHOOT.fps;  // one full clip
    this.anim.play('shoot', this.game.anims.PLAYER_SHOOT, true);

    // Muzzle offset: the cleaver leaves from chest height, slightly ahead of
    // the body — lower and closer while crouched.
    const b = this.body;
    const ox = this.facing * (b.w / 2 + 8);
    const oy = this.crouching ? -4 : -8;
    this.game.cuts.push(new Cut(b.cx + ox, b.cy + oy, this.facing));

    this.game.camera.shake(2.2);                 // minor impulse per shot
    this.game.sfx.chop();
    this.game.spark(b.cx + ox, b.cy + oy, this.facing);
  }

  _animate() {
    const A = this.game.anims;
    const b = this.body;

    if (this.cutAnimTimer > 0) {
      // The chop overlay wins over locomotion, except while crouched where
      // the compact pose has to stay (its AABB is only 24 px tall).
      this.anim.play(this.crouching ? 'crouch' : 'shoot',
                     this.crouching ? A.PLAYER_CROUCH : A.PLAYER_SHOOT);
    } else if (this.crouching) {
      this.anim.play('crouch', A.PLAYER_CROUCH);
    } else if (this.climbing) {
      this.anim.play('jump', A.PLAYER_JUMP);
    } else if (!b.onGround) {
      this.anim.play('jump', A.PLAYER_JUMP);
    } else if (Math.abs(b.vx) > 8) {
      this.anim.play('run', A.PLAYER_RUN);
    } else {
      this.anim.play('idle', A.PLAYER_IDLE);
    }
    this.anim.update(CFG.DT);
  }

  /* ------------------------------------------------------------- render - */

  draw(ctx, cam, scratch) {
    if (this.state === PSTATE.DEAD) return;
    const b = this.body;

    // Blink during invulnerability, but never hide the death animation.
    if (this.iframes > 0 && this.state === PSTATE.ALIVE &&
        Math.floor(this.iframes * 20) % 2 === 0) return;

    const dx = b.x + b.w / 2 - P_SPRITE_MIDX - cam.drawX;
    const dy = b.bottom - P_SPRITE_FOOT - cam.drawY;
    this.anim.draw(ctx, dx, dy, this.facing < 0, this.flashTicks > 0, scratch);
  }
}

/* ==========================================================================
 * 13. KUZU — the sheep. Finite state machine AI.
 *
 *      PATROL --(player in LOS within 250px)--> ALERT --> ATTACK
 *         ^                                        |
 *         +-------------(lost the player)----------+
 *      any --(hp damaged)--> STAGGER --> back to ALERT
 *      any --(hp <= 0)-----> DYING (knockback, leaves the collision layer)
 * ========================================================================*/

const K_SPRITE_FOOT = 46;
const K_SPRITE_MIDX = 24;

const KSTATE = { PATROL: 'patrol', ALERT: 'alert', ATTACK: 'attack',
                 STAGGER: 'stagger', DYING: 'dying' };

class Kuzu {
  /**
   * @param {boolean} spitter  true = ranged archetype that fires grass wads.
   */
  constructor(game, x, y, spitter) {
    this.game = game;
    this.body = new Body(x, y, CFG.SHEEP_W, CFG.SHEEP_H);
    this.anim = new AnimationController();

    this.spitter = spitter;
    this.hp = game.difficulty === DIFFICULTY.NORMAL ? CFG.SHEEP_HP : 1;
    this.facing = -1;
    this.state = KSTATE.PATROL;

    this.homeX = x;
    this.patrolRange = rand(36, 74);
    this.dir = randSign();
    this.pauseTimer = rand(0.4, 1.6);
    this.fireTimer = rand(0.3, CFG.SHEEP_FIRE_RATE);
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.flashTicks = 0;
    this.alive = true;

    this.anim.play('walk', game.anims.ENEMY_WALK);
  }

  get rect() { return this.body.rect; }

  /* -------------------------------------------------------------- damage */

  hit(fromDir) {
    if (this.state === KSTATE.DYING) return;
    this.hp--;
    this.flashTicks = CFG.FLASH_FRAMES;
    this.game.camera.shake(3.5);
    this.game.hitstop = Math.max(this.game.hitstop, CFG.HITSTOP);
    this.game.puff(this.body.cx, this.body.cy, 8);

    if (this.hp <= 0) {
      this.state = KSTATE.DYING;
      this.deathTimer = 0.65;
      this.body.vx = fromDir * 180;      // knockback vector
      this.body.vy = -190;
      this.game.camera.shake(8);         // large shake on a kill
      this.game.sfx.kill();
      this.game.onSheepKilled(this);
      // Bright stars and a friendly caption replace violent defeat cues.
      this.game.burst(this.body.cx, this.body.cy, 10, '#f8f3ec');
      this.game.burst(this.body.cx, this.body.cy, 7, '#f2b53c');
      this.game.burst(this.body.cx, this.body.cy, 5, '#74e0b0');
      this.game.act1Popups.push(new Popup(this.body.cx, this.body.y - 12,
                                          'YAKALANDI!', '#f2b53c'));
    } else {
      this.state = KSTATE.STAGGER;
      this.staggerTimer = 0.22;
      this.body.vx = fromDir * 120;
      this.game.sfx.thud();
    }
  }

  /* -------------------------------------------------------------- update */

  step(dt, map, player) {
    if (this.state === KSTATE.DYING) return this._stepDying(dt, map);
    if (this.flashTicks > 0) this.flashTicks--;

    const b = this.body;
    b.vy += CFG.GRAVITY * dt;
    b.vy = Math.min(b.vy, CFG.MAX_FALL);

    switch (this.state) {
      case KSTATE.STAGGER: this._stagger(dt, player); break;
      case KSTATE.PATROL:  this._patrol(dt, map, player); break;
      case KSTATE.ALERT:
      case KSTATE.ATTACK:  this._combat(dt, map, player); break;
    }

    // A dead sheep drops out of the collision layer; a live one never does.
    moveAndCollide(b, map, b.vx * dt, b.vy * dt, true);

    this._animate(dt);
  }

  _stepDying(dt, map) {
    this.deathTimer -= dt;
    const b = this.body;
    b.vy += CFG.GRAVITY * 0.7 * dt;
    b.vx *= 0.94;
    b.x += b.vx * dt;                 // no tile collision: it is "out"
    b.y += b.vy * dt;
    this.anim.update(dt);
    if (this.deathTimer <= 0) this.alive = false;
  }

  _stagger(dt, player) {
    this.staggerTimer -= dt;
    this.body.vx *= 0.82;
    if (this.staggerTimer <= 0) {
      this.state = KSTATE.ALERT;
      this.facing = sign(player.body.cx - this.body.cx) || this.facing;
    }
  }

  _patrol(dt, map, player) {
    const b = this.body;

    if (this._sees(map, player)) {
      this.state = KSTATE.ALERT;
      this.facing = sign(player.body.cx - b.cx) || this.facing;
      this.game.sfx.baa();
      return;
    }

    if (this.pauseTimer > 0) {           // grazing pause
      this.pauseTimer -= dt;
      b.vx *= 0.8;
      return;
    }

    b.vx = this.dir * CFG.SHEEP_SPEED;
    this.facing = this.dir;

    // Turn at a wall, at the patrol limit, or at a ledge.
    const aheadX = this.dir > 0 ? b.right + 3 : b.x - 3;
    const noFooting = !map.hasFootingAt(aheadX, b.bottom + 2);
    const outOfRange = Math.abs(b.cx - this.homeX) > this.patrolRange;
    if (b.hitWall || noFooting || outOfRange) {
      this.dir = -this.dir;
      b.vx = 0;
      this.pauseTimer = rand(0.3, 1.1);
    }
  }

  _combat(dt, map, player) {
    const b = this.body;
    const dx = player.body.cx - b.cx;

    if (!this._sees(map, player)) {
      // Lost him — cover works. Drift back to patrolling.
      this.state = KSTATE.PATROL;
      this.pauseTimer = 0.5;
      b.vx *= 0.8;
      return;
    }

    this.facing = sign(dx) || this.facing;

    if (this.spitter) {
      // Ranged archetype: hold position, face the target, spit on a timer.
      this.state = KSTATE.ATTACK;
      b.vx *= 0.75;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = CFG.SHEEP_FIRE_RATE;
        // The rearing pose puts the muzzle well above the crouch line, so a
        // crouched player (24 px tall) genuinely ducks under the shot.
        this.game.bullets.push(
          new Bullet(b.cx + this.facing * 16, b.y - 6, this.facing));
        this.game.sfx.spit();
      }
    } else {
      // Melee archetype: trot at the chef and body-check him.
      this.state = KSTATE.ALERT;
      const aheadX = this.facing > 0 ? b.right + 3 : b.x - 3;
      if (map.hasFootingAt(aheadX, b.bottom + 2) && Math.abs(dx) > 14) {
        b.vx = this.facing * CFG.SHEEP_CHARGE;
      } else {
        b.vx *= 0.8;
      }
    }
  }

  /**
   * Horizontal line-of-sight raycast, 250 px, blocked by cover tiles.
   * Also requires rough vertical alignment — sheep do not look up.
   */
  _sees(map, player) {
    if (player.state !== PSTATE.ALIVE) return false;
    const b = this.body;
    const dx = player.body.cx - b.cx;
    if (Math.abs(dx) > CFG.SHEEP_SIGHT) return false;
    if (Math.abs(player.body.cy - b.cy) > 42) return false;

    // Cast eye-to-eye. Standing, the chef's head clears a two-tile crate or
    // tree and he is spotted; crouched, his eye line drops behind it and the
    // ray is blocked — that is the whole point of the tactical crouch.
    const eyeY = player.body.y + 8;
    return map.lineOfSight(b.cx, b.y + 8, player.body.cx, eyeY);
  }

  _animate(dt) {
    const A = this.game.anims;
    if (this.state === KSTATE.ATTACK || this.state === KSTATE.STAGGER) {
      this.anim.play('attack', A.ENEMY_ATTACK);
    } else {
      this.anim.play('walk', A.ENEMY_WALK);
    }
    this.anim.update(dt);
  }

  /* -------------------------------------------------------------- render */

  draw(ctx, cam, scratch) {
    const b = this.body;
    let alpha = 1;
    if (this.state === KSTATE.DYING) {
      // "flashes out": strobe, then fade.
      const t = this.deathTimer / 0.65;
      if (Math.floor(this.deathTimer * 22) % 2 === 0) return;
      alpha = clamp(t, 0, 1);
    }

    const dx = b.x + b.w / 2 - K_SPRITE_MIDX - cam.drawX;
    const dy = b.bottom - K_SPRITE_FOOT - cam.drawY;

    if (alpha < 1) ctx.globalAlpha = alpha;
    // The art faces right; sheep default to facing left, hence the invert.
    this.anim.draw(ctx, dx, dy, this.facing > 0, this.flashTicks > 0, scratch);
    ctx.globalAlpha = 1;

    // A small alert marker so the FSM state is legible to the player.
    if (this.state === KSTATE.ALERT || this.state === KSTATE.ATTACK) {
      const mx = Math.round(b.cx - cam.drawX);
      const my = Math.round(b.y - cam.drawY - 10 + Math.sin(this.game.time * 9));
      ctx.fillStyle = '#e8604f';
      ctx.fillRect(mx - 1, my, 2, 6);
      ctx.fillRect(mx - 1, my + 7, 2, 2);
    }
  }
}

/* ==========================================================================
 * 14. SFX — tiny WebAudio synth. No files, no loading, no licences.
 * ========================================================================*/

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  /** Must be called from a user gesture (the title screen keypress). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16;
    this.master.connect(this.ctx.destination);
  }
  _blip(freq, dur, type = 'square', slideTo = null, vol = 1) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  jump()  { this._blip(320, 0.13, 'square', 620); }
  chop()  { this._blip(880, 0.07, 'sawtooth', 300, 0.8); }
  thud()  { this._blip(180, 0.09, 'square', 90); }
  kill()  { this._blip(520, 0.22, 'square', 120); this._blip(260, 0.26, 'triangle', 70); }
  hurt()  { this._blip(200, 0.24, 'sawtooth', 60); }
  die()   { this._blip(300, 0.7, 'sawtooth', 40); }
  spit()  { this._blip(420, 0.1, 'triangle', 220, 0.7); }
  baa()   { this._blip(300, 0.16, 'sawtooth', 360, 0.5); }
  drop()  { this._blip(240, 0.08, 'triangle', 150, 0.6); }
  /** Muffled, behind-the-hand complaining from a fed-up diner. */
  grumble() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g2 = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.linearRampToValueAtTime(96, t + 0.34);
    f.type = 'lowpass';                       // the "behind a wall" quality
    f.frequency.setValueAtTime(420, t);
    f.Q.value = 6;
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(f); f.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t + 0.4);
  }
  win()   { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._blip(f, 0.22, 'square'), i * 110)); }
}

/* ==========================================================================
 * 15. HUD
 * ========================================================================*/

/* Source regions inside assets/ui/hud_elements.png (128 x 64). */
const UI = {
  HEART_FULL:  { x: 0,  y: 0,  w: 16, h: 16 },
  HEART_EMPTY: { x: 16, y: 0,  w: 16, h: 16 },
  FRAME:       { x: 32, y: 0,  w: 32, h: 16 },
  BANNER:      { x: 0,  y: 16, w: 64, h: 16 },
  ICON_SHEEP:  { x: 0,  y: 32, w: 16, h: 16 },
  ICON_CLEAVER:{ x: 16, y: 32, w: 16, h: 16 },
  CHEVRON:     { x: 32, y: 32, w: 16, h: 16 },
};

class HUD {
  constructor(game) { this.game = game; this.flashCheckpoint = 0; }

  _sprite(ctx, r, x, y) {
    ctx.drawImage(this.game.assets.get('HUD'), r.x, r.y, r.w, r.h,
                  Math.round(x), Math.round(y), r.w, r.h);
  }

  draw(ctx) {
    const g = this.game;
    const f = g.font;

    /* ---- segmented health bar, top-left ------------------------------- */
    for (let i = 0; i < CFG.PLAYER_HP; i++) {
      this._sprite(ctx, i < g.player.hp ? UI.HEART_FULL : UI.HEART_EMPTY,
                   4 + i * 15, 3);
    }

    /* ---- sheep counter ------------------------------------------------ */
    const remaining = g.sheepRemaining;
    const label = `KALAN KOYUN: ${String(remaining).padStart(2, '0')}`;
    const w = f.width(label) + 22;

    // Stretch the 32px bounty frame to fit by drawing its caps + a body.
    const fx = 4, fy = 21;
    ctx.fillStyle = 'rgba(26,20,28,0.86)';
    ctx.fillRect(fx, fy, w, 16);
    ctx.fillStyle = '#e8ba5c';
    ctx.fillRect(fx, fy, w, 1);
    ctx.fillRect(fx, fy + 15, w, 1);
    ctx.fillRect(fx, fy, 1, 16);
    ctx.fillRect(fx + w - 1, fy, 1, 16);

    this._sprite(ctx, UI.ICON_SHEEP, fx + 1, fy);
    f.draw(ctx, label, fx + 18, fy + 5,
           { color: remaining === 0 ? '#74e0b0' : '#f8e9cf', shadow: '#1b1220' });

    /* ---- objective hint ----------------------------------------------- */
    if (remaining === 0) {
      const blink = Math.sin(g.time * 6) > -0.2;
      if (blink) {
        f.draw(ctx, 'HEPSİ AĞILDA - SAĞDAKİ ÇIKIŞA GİT',
               CFG.VIEW_W / 2, 42, { color: '#74e0b0', align: 'center', shadow: '#1b1220' });
      }
    }

    /* ---- checkpoint banked -------------------------------------------- */
    if (this.flashCheckpoint > 0) {
      this.flashCheckpoint -= CFG.DT;
      ctx.globalAlpha = clamp(this.flashCheckpoint, 0, 1);
      f.draw(ctx, 'KAYIT NOKTASI!', CFG.VIEW_W / 2, 60,
             { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
      ctx.globalAlpha = 1;
    }

    /* ---- distance-to-extraction ticker, top-right --------------------- */
    const exX = CFG.EXTRACTION_COL * CFG.TILE;
    const dist = Math.max(0, Math.round((exX - g.player.body.cx) / 10));
    f.draw(ctx, `ÇIKIŞ ${String(dist).padStart(3, '0')}M`,
           CFG.VIEW_W - 5, 5, { color: '#c9bda8', align: 'right', shadow: '#1b1220' });
  }

  /** Big centred banner used by the win / lose / pause overlays. */
  banner(ctx, lines, opts = {}) {
    const f = this.game.font;
    ctx.fillStyle = opts.veil || 'rgba(20,12,22,0.72)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    let y = opts.y != null ? opts.y : 92;
    lines.forEach((ln) => {
      const scale = ln.scale || 2;
      if (ln.blink && Math.sin(this.game.time * (ln.rate || 7)) < -0.25) {
        y += FONT_H * scale + (ln.gap || 10);
        return;
      }
      f.draw(ctx, ln.text, CFG.VIEW_W / 2, y, {
        color: ln.color || '#f8e9cf',
        scale,
        align: 'center',
        shadow: ln.shadow || '#1b1220',
      });
      y += FONT_H * scale + (ln.gap || 10);
    });
  }
}

/* ==========================================================================
 * KIDS GUIDE — short, playable lessons instead of a wall of instructions.
 * Progress is saved, but each new game starts with the friendly guide again.
 * ========================================================================*/

class KidsGuide {
  constructor(game) {
    this.game = game;
    this.act1 = 0;
    this.act2 = 0;
    this.toast = 0;
  }

  advance(which) {
    this[which]++;
    this.toast = 1.0;
    this.game.sfx.jump();
  }

  stepAct1(input) {
    if (this.toast > 0) this.toast -= CFG.DT;
    if (this.act1 === 0 && (input.hit('left') || input.hit('right') ||
                           input.down('left') || input.down('right'))) this.advance('act1');
    else if (this.act1 === 1 && input.hit('jump')) this.advance('act1');
    else if (this.act1 === 2 && input.hit('up')) this.advance('act1');
    else if (this.act1 === 3 && this.game.killed > 0) this.advance('act1');
    else if (this.act1 === 4 && this.game.checkpointX >= CFG.VIEW_W) this.advance('act1');
  }

  stepKitchen(kitchen) {
    if (this.toast > 0) this.toast -= CFG.DT;
    if (this.act2 === 0 && kitchen.carried) this.advance('act2');
    else if (this.act2 === 1 && kitchen.carried && kitchen.carried.seasonings.size > 0) this.advance('act2');
    else if (this.act2 === 2 && kitchen.byId.MANGAL.slots.length > 0) this.advance('act2');
    else if (this.act2 === 3 && kitchen.served > 0) this.advance('act2');
    else if (this.act2 === 4 && kitchen.headcount > 0) this.advance('act2');
  }

  line(phase) {
    const touch = this.game.input.touchMode;
    const act1 = touch ? [
      '1/5  SOL VE SAĞ OKLARLA YÜRÜ',
      '2/5  ZIPLA DÜĞMESİNE DOKUN',
      '3/5  TIRMANMAK İÇİN BOŞ EKRANA BASILI TUT',
      '4/5  YAKALA DÜĞMESİNE DOKUN',
      '5/5  İLERLE VE KAYIT NOKTASINA ULAŞ',
    ] : [
      '1/5  A VE D İLE YÜRÜ',
      '2/5  W İLE ZIPLA',
      '3/5  YUKARI OK İLE TIRMAN',
      '4/5  SPACE İLE KOYUNU YAKALA',
      '5/5  İLERLE VE KAYIT NOKTASINA ULAŞ',
    ];
    const act2 = [
      '1/5  TEZGAHA GİT VE MALZEMEYİ AL',
      '2/5  FİŞTEKİ BAHARATLARI EKLE',
      '3/5  YEMEĞİ MANGALA KOY',
      '4/5  YEŞİLDE AL VE MÜŞTERİYE SERVİS ET',
      '5/5  SEVGİYLE BİR PERSONEL İŞE AL',
    ];
    const list = phase === 1 ? act1 : act2;
    const at = phase === 1 ? this.act1 : this.act2;
    return list[at] || null;
  }

  draw(ctx, phase) {
    const line = this.line(phase);
    if (!line && this.toast <= 0) return;
    const f = this.game.font;
    const text = this.toast > 0 ? 'HARİKA! BİR SONRAKİ ADIM...' : line;
    const w = Math.min(CFG.VIEW_W - 80, f.width(text) + 18);
    const x = Math.round((CFG.VIEW_W - w) / 2);
    const y = CFG.VIEW_H - 25;
    ctx.fillStyle = 'rgba(12,24,30,0.90)';
    ctx.fillRect(x, y, w, 17);
    ctx.fillStyle = this.toast > 0 ? '#74e0b0' : '#f2b53c';
    ctx.fillRect(x, y, w, 2);
    f.draw(ctx, text, CFG.VIEW_W / 2, y + 6,
           { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
  }
}

/* ==========================================================================
 * 16. ACT 2 — "CAN USTA: MANGAL"
 *
 *     The lamb you brought back in Act 1 becomes stock. Diners queue at the
 *     pass with an order; you run the line — grab the base, season it, time
 *     it on the mangal, serve it. Delight someone and they TELL A FRIEND
 *     (word of mouth spawns more diners); disappoint them and you take a
 *     complaint. Reputation ("LOVE") unlocks a bigger menu as you go.
 *
 *     Loop:  base station -> seasoning stations -> mangal -> pass
 * ========================================================================*/

/* Cell indices into assets/ui/food_icons.png (16x16, 8 columns). */
const ICON = {
  LAMB: 0, SALT: 1, PEPPER: 2, CHILI: 3, LAHMACUN: 4, DONER: 5,
  GOOD: 6, BURNT: 7, HEART: 8, ANGRY: 9, FLAME: 10, CHECK: 11,
  CROSS: 12, PLATE: 13, CLOCK: 14, STAR: 15,
};

const SEASONINGS = ['SALT', 'PEPPER', 'CHILI'];
const SEASONING_ICON = { SALT: ICON.SALT, PEPPER: ICON.PEPPER, CHILI: ICON.CHILI };

/**
 * The menu. Items unlock as reputation grows, which is the whole point of
 * word of mouth: a beloved restaurant earns a bigger menu.
 */
const MENU = [
  { id: 'KEBAB',    name: 'ADANA KEBAP', icon: ICON.LAMB,     unlockAt: 0,  lamb: 1, maxSpice: 2 },
  { id: 'LAHMACUN', name: 'LAHMACUN',    icon: ICON.LAHMACUN, unlockAt: 42, lamb: 0, maxSpice: 3 },
  { id: 'DONER',    name: 'DÖNER',       icon: ICON.DONER,    unlockAt: 84, lamb: 1, maxSpice: 3 },
];
const MENU_BY_ID = Object.fromEntries(MENU.map((m) => [m.id, m]));

/* Small achievements keep the restaurant loop moving in 3–5 minute bites.
 * Every completed card gives love plus a permanent wall sticker. */
const KIDS_GOALS = [
  { id: 'SERVE',   label: '5 MÜŞTERİYE SERVİS ET', target: 5, value: (k) => k.served },
  { id: 'PERFECT', label: '3 MÜKEMMEL TABAK ÇIKAR', target: 3, value: (k) => k.perfectServed },
  { id: 'WASH',    label: '5 TABAĞI TEMİZLE', target: 5, value: (k) => k.washedTotal },
  { id: 'HIRE',    label: '1 PERSONEL İŞE AL', target: 1, value: (k) => k.hiredTotal },
  { id: 'UPGRADE', label: '1 EKİPMANI YÜKSELT', target: 1, value: (k) => k.upgradeTotal },
];
const GOAL_REWARD = 6;

/**
 * THE HIRING BOARD.
 *
 * One chef cannot work a full pass, so the love diners pay you is spent on
 * staff. Each hire removes a different link of the chain — patience, the
 * grill timer, the run to the base stations, the payout — so they stack
 * into a genuinely different game rather than just "numbers go up".
 *
 * `variant` indexes the row in assets/sprites/staff.png.
 */
const STAFF = [
  {
    id: 'CIRAK', name: 'ÇIRAK', role: 'MANGALCI', cost: 14, variant: 0,
    blurb: ['MANGALA BAKAR: AYNI ANDA İKİ TANE,', 'HİÇBİR ŞEY YANMAZ, TABAĞI PASA KOYAR.'],
    post: 'grill',
  },
  {
    id: 'KOMI', name: 'KOMİ', role: 'KOMİ', cost: 16, variant: 5,
    blurb: ['İYİ TABAKLARI ÇIKARIR: +4 TABAK,', 'BULAŞIKÇIYA DA YARDIM EDER.'],
    post: 'sink2',
  },
  {
    id: 'BULASIKCI', name: 'BULAŞIKÇI', role: 'BULAŞIKÇI', cost: 20, variant: 2,
    blurb: ['EVYENİN BAŞINDA DURUR, YIKAR.', 'TEMİZ TABAĞIN HİÇ BİTMEZ.'],
    post: 'sink',
  },
  {
    id: 'CAYCI', name: 'ÇAYCI', role: 'ÇAYCI', cost: 24, variant: 6,
    blurb: ['SIRADAKİ HERKESE ÇAY DAĞITIR.', 'BEKLEYEN MÜŞTERİ SAKİNLEŞİR.'],
    post: 'queue2',
  },
  {
    id: 'KASAP', name: 'KASAP', role: 'KASAP', cost: 26, variant: 7,
    blurb: ['KÜTÜKTE TAZE KUZU HAZIRLAR.', 'STOĞUN KENDİ KENDİNE DOLAR.'],
    post: 'lamb',
  },
  {
    id: 'MUDUR', name: 'MÜDÜR', role: 'MÜDÜR', cost: 30, variant: 4,
    blurb: ['SIRAYI GEZER, SABRI TAZELER.', 'BİR MASA DAHA, İKİ HAK DAHA.'],
    post: 'queue',
  },
  {
    id: 'KASIYER', name: 'KASİYER', role: 'KASİYER', cost: 32, variant: 3,
    blurb: ['HESABI MASAYA KADAR GÖTÜRÜR.', 'MEMNUN MÜŞTERİ %50 FAZLA ÖDER.'],
    post: 'till',
  },
  {
    id: 'GARSON', name: 'GARSON', role: 'GARSON', cost: 38, variant: 1,
    blurb: ['PASTAN TABAKLARI ALIR VE', 'MASALARA KENDİ SERVİS EDER.'],
    post: 'pass',
  },
];
const STAFF_BY_ID = Object.fromEntries(STAFF.map((w) => [w.id, w]));

/* Tuning for each hire's effect. */
const STAFF_FX = {
  MUDUR_PATIENCE: 0.62,    // MANAGER: passive calm across the room
  MUDUR_TOPUP: 3.5,        // MANAGER: seconds handed back per greeting
  MUDUR_SLACK: 2,          // MANAGER: extra complaints tolerated
  MUDUR_SEATS: 1,          // MANAGER: extra place at the pass
  CASHIER_MUL: 1.5,        // CASHIER: multiplier on positive love
  CIRAK_CAPACITY: 2,       // GRILL COOK: plates the mangal holds at once
  KOMI_PLATES: 4,          // BUSSER: extra place settings in the house
  CAYCI_TOPUP: 2.0,        // TEA BOY: seconds handed back to EVERY diner
  KASAP_LAMB: 2,           // BUTCHER: lamb trimmed per trip to the block
  WALK: 62,                // px/s every worker moves at
};

/**
 * A hired worker. Each one runs a small errand loop — walk somewhere, do a
 * job, walk back — so the money you spend is visibly at work on the floor
 * rather than quietly editing a multiplier.
 *
 *   WSTATE.IDLE  waiting at their post for something to do
 *   WSTATE.GO    walking to wherever the job is
 *   WSTATE.WORK  doing it (a short dwell so the action reads)
 *   WSTATE.BACK  returning to the post
 */
/* ==========================================================================
 * PERDE GEÇİŞİ — Can Usta decides to open his own restaurant
 *
 * The first act ends with happy guests, not a hard menu jump. This short,
 * skippable story beat gives Can Usta a reason to build the mangal restaurant
 * the player manages in Act 2. It is drawn from the existing atlases so it
 * stays visually consistent and loads without another asset dependency.
 * ========================================================================*/

const ACT2_FILM = {
  FADE: 1.2,
  GUESTS: 1.8,
  CHEF: 5.0,
  THOUGHT: 8.2,
  DECISION: 12.0,
  PROMPT: 16.0,
};

class ActTwoOpening {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.happyCue = false;
    this.decisionCue = false;
    this.confirmed = false;
  }

  get ready() { return this.t >= ACT2_FILM.PROMPT; }
  get finished() { return this.confirmed; }

  skip() {
    if (this.t < 1.2) return;
    // First press skips to the final story card; the second confirms it.
    // This prevents an accidental tap from erasing the whole transition.
    if (!this.ready) this.t = ACT2_FILM.PROMPT;
    else this.confirmed = true;
  }

  step(dt) {
    // Hold on the final card until DEVAM is pressed. Children can read at
    // their own speed and the next act never begins without acknowledgement.
    this.t = Math.min(ACT2_FILM.PROMPT, this.t + dt);
    if (!this.happyCue && this.t >= ACT2_FILM.GUESTS + 1.0) {
      this.happyCue = true;
      this.game.sfx.win();
    }
    if (!this.decisionCue && this.t >= ACT2_FILM.DECISION) {
      this.decisionCue = true;
      this.game.sfx.drop();
      this.game.camera.shake(4);
    }
  }

  _icon(ctx, id, x, y, scale = 1) {
    const sx = (id % 8) * 16;
    const sy = Math.floor(id / 8) * 16;
    ctx.drawImage(this.game.assets.get('FOOD'), sx, sy, 16, 16,
                  Math.round(x), Math.round(y), 16 * scale, 16 * scale);
  }

  draw(ctx) {
    const g = this.game;
    const f = g.font;
    const W = CFG.VIEW_W;
    const H = CFG.VIEW_H;
    const ox = Math.round((W - CFG.BASE_VIEW_W) / 2);
    const t = this.t;
    const floor = 222;

    // Warm, hand-built lokanta interior. It extends to any phone ratio so
    // an ultrawide screen reveals more room rather than stretching the art.
    ctx.fillStyle = '#d98a55';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f1c77f';
    ctx.fillRect(0, 12, W, 146);
    ctx.fillStyle = '#d6a865';
    for (let y = 18; y < 156; y += 18) {
      ctx.fillRect(0, y, W, 1);
      for (let x = ((y / 18) % 2) * 18; x < W; x += 36) ctx.fillRect(x, y, 1, 18);
    }
    ctx.fillStyle = '#6e3e2b';
    ctx.fillRect(0, 158, W, 64);
    ctx.fillStyle = '#a85a38';
    for (let x = 0; x < W; x += 28) ctx.fillRect(x, 158, 2, 64);
    ctx.fillStyle = '#3c2830';
    ctx.fillRect(0, floor, W, H - floor);
    ctx.fillStyle = '#67414a';
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, floor, 1, H - floor);

    // Windows and bunting make this clearly the cheerful meal Can Usta saw.
    for (const wx of [ox + 34, ox + 366]) {
      ctx.fillStyle = '#64392f'; ctx.fillRect(wx, 34, 80, 64);
      ctx.fillStyle = '#8fd4ff'; ctx.fillRect(wx + 5, 39, 70, 54);
      ctx.fillStyle = '#e8f5e8'; ctx.fillRect(wx + 39, 39, 2, 54);
      ctx.fillRect(wx + 5, 65, 70, 2);
      ctx.fillStyle = '#7fbf79'; ctx.fillRect(wx + 5, 78, 70, 15);
    }
    for (let i = -1; i < 14; i++) {
      const bx = ox + i * 38;
      ctx.fillStyle = i % 3 === 0 ? '#e8604f' : i % 3 === 1 ? '#f2b53c' : '#74e0b0';
      ctx.beginPath(); ctx.moveTo(bx, 10); ctx.lineTo(bx + 18, 10);
      ctx.lineTo(bx + 9, 24); ctx.closePath(); ctx.fill();
    }

    const stations = g.assets.get('STATIONS');
    const customers = g.assets.get('CUSTOMER');
    const tableXs = [ox + 112, ox + 368];
    tableXs.forEach((x) => {
      ctx.drawImage(stations, 11 * 48, 0, 48, 48, x - 24, floor - 45, 48, 48);
      ctx.fillStyle = '#f8e9cf';
      ctx.fillRect(x - 20, floor - 34, 40, 3);
      this._icon(ctx, ICON.GOOD, x - 7, floor - 48, 0.8);
    });

    // Four guests walk in, sit, bounce and show that the meal made them glad.
    const seats = [
      { x: ox + 82, v: 0, flip: false }, { x: ox + 142, v: 1, flip: true },
      { x: ox + 338, v: 2, flip: false }, { x: ox + 398, v: 0, flip: true },
    ];
    seats.forEach((s, i) => {
      const at = ACT2_FILM.GUESTS + i * 0.5;
      if (t < at) return;
      const age = t - at;
      const arrive = clamp(age / 1.0, 0, 1);
      const from = s.x < ox + 240 ? -54 : 54;
      const x = s.x + (1 - arrive) * from;
      const happy = age > 1.1;
      const frame = happy ? 6 : Math.floor(t * 8) % 4;
      const bounce = happy ? Math.round(Math.abs(Math.sin(t * 6 + i)) * 2) : 0;
      ctx.save();
      if (s.flip) {
        ctx.translate(Math.round(x) + 24, 0); ctx.scale(-1, 1); ctx.translate(-24, 0);
      } else ctx.translate(Math.round(x) - 24, 0);
      ctx.drawImage(customers, frame * 48, s.v * 48, 48, 48,
                    0, floor - 46 - bounce, 48, 48);
      ctx.restore();
      if (happy && Math.sin(t * 5 + i * 1.7) > 0.15) {
        this._icon(ctx, ICON.HEART, x - 8, floor - 72 - bounce, 0.8);
      }
    });

    // Can Usta enters to watch the room. His thought grows into the Act 2 plan.
    if (t >= ACT2_FILM.CHEF) {
      const age = t - ACT2_FILM.CHEF;
      const arrive = clamp(age / 1.4, 0, 1);
      const x = ox + 240 + (1 - arrive) * -90;
      const anim = arrive < 1 ? g.anims.PLAYER_RUN : g.anims.PLAYER_IDLE;
      const frame = Math.floor(t * anim.fps) % anim.frames;
      ctx.drawImage(anim.image, (anim.from + frame) * 48, 0, 48, 48,
                    Math.round(x - 24), floor - 48, 48, 48);

      if (t >= ACT2_FILM.THOUGHT && t < ACT2_FILM.DECISION) {
        const pulse = 1 + Math.sin(t * 4) * 2;
        ctx.fillStyle = 'rgba(255,250,230,0.96)';
        ctx.fillRect(Math.round(x + 20), 83 - pulse, 175, 43);
        ctx.fillRect(Math.round(x + 8), 119 - pulse, 8, 8);
        ctx.fillRect(Math.round(x + 1), 129 - pulse, 5, 5);
        f.draw(ctx, 'BU MUTLULUĞU', x + 107, 92 - pulse,
               { align: 'center', scale: 2, color: '#7a3d18' });
        f.draw(ctx, 'HER GÜN PAYLAŞMALIYIM!', x + 107, 110 - pulse,
               { align: 'center', color: '#7a3d18' });
      }
    }

    // The decision lands like a little storybook card and names the next act.
    if (t >= ACT2_FILM.DECISION) {
      const p = clamp((t - ACT2_FILM.DECISION) / 0.7, 0, 1);
      const cardW = 306;
      const cardX = Math.round((W - cardW) / 2);
      const cardY = Math.round(48 + (1 - p) * -90);
      ctx.fillStyle = 'rgba(38,25,30,0.95)';
      ctx.fillRect(cardX, cardY, cardW, 92);
      ctx.fillStyle = '#f2b53c';
      ctx.fillRect(cardX, cardY, cardW, 3);
      ctx.fillRect(cardX, cardY + 89, cardW, 3);
      f.draw(ctx, 'CAN USTA KARARINI VERDİ', W / 2, cardY + 14,
             { align: 'center', color: '#f8e9cf' });
      f.draw(ctx, 'KENDİ RESTORANIMI', W / 2, cardY + 34,
             { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
      f.draw(ctx, 'AÇACAĞIM!', W / 2, cardY + 55,
             { align: 'center', scale: 3, color: '#f2b53c', shadow: '#7a3a10' });
      f.draw(ctx, 'CAN USTA MANGAL - ÇOK YAKINDA', W / 2, cardY + 78,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
    }

    // Story caption stays above the touch controls and clarifies causality.
    if (t < ACT2_FILM.DECISION) {
      ctx.fillStyle = 'rgba(27,18,32,0.84)';
      ctx.fillRect(0, 0, W, 30);
      f.draw(ctx, t < ACT2_FILM.CHEF
                   ? 'MİSAFİRLER CAN USTA\'NIN YEMEKLERİNE BAYILDI.'
                   : 'CAN USTA ONLARIN MUTLULUĞUNU İZLEDİ.',
             W / 2, 10, { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
    }

    const fade = clamp(t / ACT2_FILM.FADE, 0, 1);
    if (fade < 1) {
      ctx.globalAlpha = 1 - fade;
      ctx.fillStyle = '#120c16'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    if (t >= ACT2_FILM.PROMPT && Math.sin(t * 6) > -0.35) {
      f.draw(ctx, g.input.touchMode ? 'DEVAM DÜĞMESİNE DOKUN' : 'SPACE İLE DEVAM',
             W / 2, H - 14,
             { align: 'center', color: '#74e0b0', shadow: '#1b1220' });
    }
  }
}

/* ==========================================================================
 * FİNAL — "CAN USTA BAHÇE" opening cutscene
 *
 * A scripted, timed sequence rather than a simulation: a fixed cast walks on
 * to a beat sheet, so it looks the same every time and cannot be broken by
 * whatever state the restaurant happened to be in. Skippable from one
 * second in — nobody should be trapped in a cutscene.
 * ========================================================================*/

/** Where each beat lands, in seconds. */
const FIN = {
  FADE: 1.2,          // black -> garden
  CHEF: 1.4,          // Can Usta walks on
  BANNER: 3.0,        // the sign drops
  GUESTS: 4.2,        // diners arrive, 0.7s apart
  CREW: 7.6,          // the staff line up behind him
  STAMP: 10.2,        // "AÇILDI!" slams down
  STATS: 12.0,
  PROMPT: 14.5,
  END: 15.0,          // from here it just holds
};

/** Guest seats along the garden, and where the crew stand. */
const FIN_SEATS = [
  { x: 58,  v: 0 }, { x: 104, v: 1 }, { x: 150, v: 2 },
  { x: 334, v: 1 }, { x: 380, v: 0 }, { x: 426, v: 2 },
];
const FIN_CREW = [0, 1, 2, 3, 4, 5, 6, 7];

class Ending {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.skipped = false;
    this.puffs = [];        // mangal smoke
    this.confetti = [];
    this.laughs = [];       // floating "HA HA!" from the guests
    this.laughTimer = 0;
    this.bannerRung = false;
    this.stampRung = false;

    const k = game.kitchen;
    this.stats = k ? {
      days: k.day, plates: k.served, friends: k.friendsTold,
      fame: k.totalFame, crew: k.headcount,
    } : { days: 0, plates: 0, friends: 0, fame: 0, crew: 0 };
  }

  /** Jump to the held final frame. */
  skip() {
    if (this.t < 1) return;
    this.skipped = true;
    this.t = Math.max(this.t, FIN.END);
  }
  get finished() { return this.t >= FIN.END; }

  step(dt) {
    this.t += dt;
    const g = this.game;

    // smoke off the mangal, once the chef is at it
    if (this.t > FIN.CHEF + 0.8) {
      if (Math.random() < dt * 22) {
        this.puffs.push({ x: 240 + rand(-13, 13), y: 176,
                          vx: rand(-7, 7), vy: rand(-26, -14),
                          life: rand(1.0, 1.9), max: 1.9, r: rand(2, 5) });
      }
    }
    for (const p of this.puffs) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    this.puffs = this.puffs.filter((p) => p.life > 0);

    // the guests laugh, in turns
    if (this.t > FIN.GUESTS + 1.2) {
      this.laughTimer -= dt;
      if (this.laughTimer <= 0) {
        this.laughTimer = rand(0.5, 1.1);
        const seated = FIN_SEATS.filter((_, i) => this.t > FIN.GUESTS + i * 0.7);
        if (seated.length) {
          const s = seated[Math.floor(Math.random() * seated.length)];
          this.laughs.push({ x: s.x + rand(-6, 6), y: 186, life: 1.5 });
          if (Math.random() < 0.5) g.sfx.jump();
        }
      }
    }
    for (const l of this.laughs) { l.y -= 16 * dt; l.life -= dt; }
    this.laughs = this.laughs.filter((l) => l.life > 0);

    // one-shot cues
    if (!this.bannerRung && this.t >= FIN.BANNER) { this.bannerRung = true; g.sfx.win(); }
    if (!this.stampRung && this.t >= FIN.STAMP) {
      this.stampRung = true;
      g.sfx.win(); g.camera.shake(9);
      for (let i = 0; i < 90; i++) {
        this.confetti.push({
          x: rand(0, CFG.VIEW_W), y: rand(-40, 20),
          vx: rand(-26, 26), vy: rand(24, 78),
          life: rand(2.4, 4.2), r: rand(2, 4), spin: rand(0, 6),
          c: ['#f2b53c', '#74e0b0', '#e8604f', '#8fd4ff', '#f8e9cf'][i % 5],
        });
      }
    }
    for (const c of this.confetti) {
      c.x += c.vx * dt; c.y += c.vy * dt; c.spin += dt * 6; c.life -= dt;
      c.vx *= 0.995;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < CFG.VIEW_H + 10);
  }

  /* --------------------------------------------------------------- draw - */

  draw(ctx) {
    const g = this.game;
    const f = g.font;
    const t = this.t;
    const W = CFG.VIEW_W, H = CFG.VIEW_H;

    ctx.fillStyle = '#120c16';
    ctx.fillRect(0, 0, W, H);

    // ---- the garden, easing gently downward as it fades up -------------
    const fade = clamp(t / FIN.FADE, 0, 1);
    const drift = Math.round((1 - fade) * 10);
    ctx.globalAlpha = fade;
    ctx.drawImage(g.assets.get('BG_GARDEN'), 0, -drift);
    ctx.globalAlpha = 1;
    if (fade < 1) return;

    const stations = g.assets.get('STATIONS');
    const upSheet = g.assets.get('STATIONS_UP');
    const custSheet = g.assets.get('CUSTOMER');
    const staffSheet = g.assets.get('STAFF');
    const FLOOR = 232;

    // ---- garden tables --------------------------------------------------
    for (const tx of [82, 128, 356, 402]) {
      ctx.drawImage(stations, 11 * 48, 0, 48, 48, tx - 24, FLOOR - 46, 48, 48);
    }

    // ---- the guests, bouncing with laughter ----------------------------
    FIN_SEATS.forEach((s, i) => {
      const at = FIN.GUESTS + i * 0.7;
      if (t < at) return;
      const age = t - at;
      const walk = clamp(age / 0.9, 0, 1);              // slide in from the edge
      const fromLeft = s.x < W / 2;
      const x = s.x + (1 - walk) * (fromLeft ? -70 : 70);
      const bounce = age > 1 ? Math.round(Math.abs(Math.sin((t + i) * 7)) * 3) : 0;
      const frame = age > 1 ? 6 : 0;                    // 6 = delighted
      ctx.save();
      if (!fromLeft) { ctx.translate(Math.round(x) + 24, 0); ctx.scale(-1, 1); ctx.translate(-24, 0); }
      else ctx.translate(Math.round(x) - 24, 0);
      ctx.drawImage(custSheet, frame * 48, s.v * 48, 48, 48,
                    0, FLOOR - 46 - bounce, 48, 48);
      ctx.restore();
    });

    // ---- the crew, lined up behind the mangal --------------------------
    FIN_CREW.forEach((v, i) => {
      const at = FIN.CREW + i * 0.18;
      if (t < at) return;
      const walk = clamp((t - at) / 0.7, 0, 1);
      const x = 176 + i * 18 + (1 - walk) * -90;
      const bob = Math.round(Math.sin((t + i * 0.6) * 4) * 1.5);
      // Hazed and set back so the row never fights the guests for attention.
      ctx.globalAlpha = (0.55 + 0.45 * walk) * 0.85;
      ctx.drawImage(staffSheet, 4 * 48, v * 48, 48, 48,
                    Math.round(x) - 24, FLOOR - 96 - bob, 48, 48);
      ctx.globalAlpha = 1;
    });

    // ---- the mangal, and Can Usta working it ---------------------------
    if (t > FIN.CHEF) {
      const walk = clamp((t - FIN.CHEF) / 1.1, 0, 1);
      const cx = 200 + walk * 4;
      ctx.drawImage(upSheet, 1 * 64, 0, 64, 64, 240 - 32, FLOOR - 62, 64, 64);

      // smoke sits over the coals
      for (const p of this.puffs) {
        const a = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = '#e8e2d8';
        const r = Math.max(1, Math.round(p.r * (1.4 - a * 0.4)));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), r, r);
      }
      ctx.globalAlpha = 1;

      // he turns the skewers on a beat
      const flipping = Math.floor(t * 1.6) % 2 === 0;
      const anim = flipping ? g.anims.PLAYER_SHOOT : g.anims.PLAYER_IDLE;
      const fr = Math.floor(t * anim.fps) % anim.frames;
      const bob = Math.round(Math.sin(t * 5) * 1.2);
      ctx.drawImage(anim.image, (anim.from + fr) * 48, 0, 48, 48,
                    Math.round(cx) - 24, FLOOR - 46 + bob, 48, 48);
    }

    // ---- floating laughter ---------------------------------------------
    for (const l of this.laughs) {
      ctx.globalAlpha = clamp(l.life * 1.3, 0, 1);
      f.draw(ctx, 'HA HA!', l.x, l.y, { align: 'center', color: '#7a3d18' });
      ctx.globalAlpha = 1;
    }

    // ---- the sign drops on a rope --------------------------------------
    if (t > FIN.BANNER) {
      const drop = clamp((t - FIN.BANNER) / 0.8, 0, 1);
      // a little overshoot so it swings into place
      const ease = drop < 1 ? drop * drop * (3 - 2 * drop)
                            : 1 + Math.sin((t - FIN.BANNER - 0.8) * 9) *
                                  Math.max(0, 0.05 - (t - FIN.BANNER - 0.8) * 0.03);
      const by = Math.round(-40 + ease * 74);
      const bw = 226, bx = Math.round((W - bw) / 2);
      ctx.fillStyle = '#7a3d18';
      ctx.fillRect(bx + 12, 0, 3, by + 8);
      ctx.fillRect(bx + bw - 15, 0, 3, by + 8);
      ctx.fillStyle = '#8f2f2a';
      ctx.fillRect(bx, by, bw, 30);
      ctx.fillStyle = '#c4413a';
      ctx.fillRect(bx + 2, by + 2, bw - 4, 26);
      ctx.fillStyle = '#f2b53c';
      ctx.fillRect(bx + 2, by + 2, bw - 4, 1);
      ctx.fillRect(bx + 2, by + 27, bw - 4, 1);
      f.draw(ctx, 'CAN USTA BAHÇE', W / 2, by + 9,
             { align: 'center', scale: 2, color: '#ffe9b0', shadow: '#5a1f18' });
    }

    // ---- AÇILDI! stamp --------------------------------------------------
    if (t > FIN.STAMP) {
      const age = t - FIN.STAMP;
      const sc = age < 0.25 ? 5 - age * 16 : 1;          // slams down
      const wob = age < 0.5 ? Math.sin(age * 40) * (0.5 - age) * 6 : 0;
      ctx.save();
      ctx.translate(W / 2, 128);
      ctx.rotate(-0.14 + wob * 0.02);
      const sw = Math.round(120 * Math.max(1, sc));
      const sh = Math.round(30 * Math.max(1, sc));
      ctx.globalAlpha = clamp(age * 4, 0, 1);
      // Solid plaque, not a wash: a translucent stamp over the treeline was
      // unreadable, which rather defeats the point of a stamp.
      ctx.fillStyle = '#f6efdd';
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      ctx.strokeStyle = '#2f7a5c';
      ctx.lineWidth = 3;
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.strokeStyle = '#7ec2a2';
      ctx.lineWidth = 1;
      ctx.strokeRect(-sw / 2 + 4, -sh / 2 + 4, sw - 8, sh - 8);
      f.draw(ctx, 'AÇILDI!', 0, -6,
             { align: 'center', scale: Math.max(1, Math.round(sc * 2)),
               color: '#2f7a5c' });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- confetti -------------------------------------------------------
    for (const c of this.confetti) {
      ctx.globalAlpha = clamp(c.life, 0, 1);
      ctx.fillStyle = c.c;
      const h = Math.max(1, Math.round(Math.abs(Math.cos(c.spin)) * c.r));
      ctx.fillRect(Math.round(c.x), Math.round(c.y), Math.round(c.r), h);
    }
    ctx.globalAlpha = 1;

    // ---- the books, and the way out ------------------------------------
    if (t > FIN.STATS) {
      const a = clamp((t - FIN.STATS) / 0.8, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(18,12,22,0.72)';
      ctx.fillRect(28, 186, W - 56, 40);
      ctx.fillStyle = '#f2b53c';
      ctx.fillRect(28, 186, W - 56, 1);
      ctx.fillRect(28, 225, W - 56, 1);
      const st = this.stats;
      f.draw(ctx, `${st.days} GÜN   ${st.plates} TABAK   ${st.friends} KİŞİYE ANLATILDI`,
             W / 2, 192, { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, `ÜN ${st.fame}   EKİP ${st.crew} KİŞİ   İKİ ŞUBE, TEK İSİM`,
             W / 2, 204, { align: 'center', color: '#8fd4ff', shadow: '#1b1220' });
      f.draw(ctx, 'AFİYET OLSUN!', W / 2, 216,
             { align: 'center', color: '#74e0b0', shadow: '#1b1220' });
      ctx.globalAlpha = 1;
    }

    if (t > FIN.PROMPT && Math.sin(t * 5) > -0.3) {
      f.draw(ctx, this.game.input.touchMode ? 'TEKRAR DÜĞMESİ - YENİDEN OYNA' : 'O - TEKRAR OYNA', W / 2, 250,
             { align: 'center', color: '#c9bda8', shadow: '#1b1220' });
    }
    if (t > 1 && t < FIN.STAMP && Math.sin(t * 4) > 0) {
      f.draw(ctx, this.game.input.touchMode ? 'ATLA' : 'SPACE - GEÇ', W - 6, 250,
             { align: 'right', color: '#8d8296' });
    }
  }
}

/* ==========================================================================
 * KAYIT — localStorage persistence
 *
 * A full run is the better part of an hour. Losing it because someone was
 * called to dinner is the single worst thing about the game, so the state
 * is written at every natural pause: each Act 1 checkpoint, and the open and
 * close of every trading day.
 *
 * Only durable facts are stored. Live things — diners on the floor, workers
 * mid-errand, particles — are rebuilt from those facts on load.
 * ========================================================================*/

const SAVE_KEY = 'canusta.kayit.v1';
const SETTINGS_KEY = 'canusta.ayarlar.v1';

const GameSettings = {
  readDifficulty() {
    try {
      const value = window.localStorage.getItem(SETTINGS_KEY);
      return DIFFICULTY_ORDER.includes(value) ? value : DIFFICULTY.EASY;
    } catch (e) { return DIFFICULTY.EASY; }
  },
  writeDifficulty(value) {
    try { window.localStorage.setItem(SETTINGS_KEY, value); }
    catch (e) { /* private mode: setting simply lasts for this session */ }
  },
};

const SaveGame = {
  /** localStorage throws in private mode on some browsers; never let that
   *  take the game down with it. */
  _ls() {
    try {
      const t = '__cu';
      window.localStorage.setItem(t, t);
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (e) { return null; }
  },

  read() {
    const ls = this._ls();
    if (!ls) return null;
    try {
      const raw = ls.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.v === 1 ? d : null;
    } catch (e) { return null; }
  },

  has() { return this.read() !== null; },

  clear() {
    const ls = this._ls();
    if (ls) { try { ls.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
  },

  _write(data) {
    const ls = this._ls();
    if (!ls) return false;
    try { ls.setItem(SAVE_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  },

  /** Mid-Act-1: which screen you reached and which sheep stay dead. */
  saveAct1(game) {
    return this._write({
      v: 1, act: 1, at: Date.now(),
      killed: game.killed,
      difficulty: game.difficulty,
      guide: { act1: game.guide.act1, act2: game.guide.act2 },
      checkpointX: game.checkpointX,
      cleared: [...game.clearedSpawns],
    });
  },

  /** A whole trading day's worth of restaurant. */
  saveAct2(game) {
    const k = game.kitchen;
    if (!k) return false;
    return this._write({
      v: 1, act: 2, at: Date.now(),
      killed: game.killed,
      difficulty: game.difficulty,
      guide: { act1: game.guide.act1, act2: game.guide.act2 },
      k: {
        day: k.day, love: Math.round(k.love), fame: Math.round(k.fame),
        lamb: k.lamb, dirty: k.dirty, complaints: k.complaints,
        served: k.served, friendsTold: k.friendsTold, hype: k.hype,
        perfectServed: k.perfectServed, washedTotal: k.washedTotal,
        hiredTotal: k.hiredTotal, upgradeTotal: k.upgradeTotal,
        goalIndex: k.goalIndex, stickers: k.stickers,
        lambStart: k.lambStart,
        levels: { ...k.levels },
        staff: { ...k.staff },
        debts: k.debts.map((d) => ({ ...d })),
        unlocked: [...k.unlocked],
        branches: k.branches, branchIndex: k.branchIndex,
        away: k.away ? JSON.parse(JSON.stringify(k.away)) : null,
        rivals: k.rivals.map((r) => ({ ...r })),
      },
    });
  },

  /** Rebuild a kitchen from a snapshot. */
  applyAct2(game, data) {
    const d = data.k;
    if (DIFFICULTY_ORDER.includes(data.difficulty)) game.difficulty = data.difficulty;
    if (data.guide) {
      game.guide.act1 = data.guide.act1 || 0;
      game.guide.act2 = data.guide.act2 || 0;
    }
    game.killed = data.killed || 0;
    game.startKitchen(d.lambStart != null ? d.lambStart : (data.killed || 20));
    const k = game.kitchen;

    k.day = d.day; k.love = d.love; k.fame = d.fame;
    k.lamb = d.lamb; k.dirty = d.dirty || 0;
    k.complaints = 0;                       // a saved day always opens clean
    k.served = d.served || 0;
    k.perfectServed = d.perfectServed || 0;
    k.washedTotal = d.washedTotal || 0;
    k.hiredTotal = d.hiredTotal || 0;
    k.upgradeTotal = d.upgradeTotal || 0;
    k.goalIndex = d.goalIndex || 0;
    k.stickers = d.stickers || 0;
    k.friendsTold = d.friendsTold || 0;
    k.hype = d.hype || 0;
    k.levels = { ...d.levels };
    k.staff = { ...d.staff };
    k.debts = (d.debts || []).map((x) => ({ ...x }));
    k.unlocked = new Set(d.unlocked || ['KEBAB']);
    k.branches = d.branches || 1;
    k.branchIndex = d.branchIndex || 0;
    k.away = d.away ? JSON.parse(JSON.stringify(d.away)) : null;
    if (d.rivals) k.rivals = d.rivals.map((r) => ({ ...r }));

    // Put the staff back on the floor.
    k.workers = [];
    for (const def of STAFF) {
      for (let i = 0; i < k.count(def.id); i++) {
        k.workers.push(new Worker(k, def, k._postFor(def) + i * 26));
      }
    }
    k.hour = CLOCK.OPEN;
    k.closed = false;
    k.shopOpen = false;
    k.payrollDue = false;
    k.pushAlert(`${k.day}. GÜN - KAYIT YÜKLENDİ`, '#74e0b0');
    return k;
  },
};

/* ==========================================================================
 * ACT 2 PROGRESSION — the trading day, the equipment, the competition
 * ========================================================================*/

/** The restaurant's opening hours, and how fast the clock runs. */
const CLOCK = {
  OPEN: 5,                  // 05:00, shutters up
  CLOSE: 21,                // 21:00, last orders
  SEC_PER_HOUR: 9,          // real seconds per in-game hour (~2.4 min/day)
};

/**
 * How busy each hour is. Early mornings are deliberately dead — that is the
 * breathing room to learn the line and bank the first wages before the
 * afternoon rush lands.
 */
function demandAt(hour) {
  if (hour < 8) return 0.22;          // 05-08  dead quiet
  if (hour < 11) return 0.50;         // 08-11  breakfast trickle
  if (hour < 14) return 0.85;         // 11-14  lunch
  if (hour < 20) return 1.70;         // 14-20  THE RUSH
  return 0.40;                        // 20-21  winding down
}

function clockLabel(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The equipment you can pour love into. Every material runs 1..6; the art
 * steps up at 3 and again at 5 (see assets/sprites/stations_up.png), so a
 * levelled kitchen is obvious at a glance.
 */
const MAX_LEVEL = 6;
const MATERIALS = [
  { id: 'MANGAL', name: 'MANGAL',      station: 'MANGAL', up: 0,
    perk: 'DAHA HIZLI PİŞİRİR, ÇOK ALIR' },
  { id: 'SINK',   name: 'BULASIK',     station: 'SINK',   up: 2,
    perk: 'DAHA ÇABUK YIKAR' },
  { id: 'PASS',   name: 'PASS',        station: 'PASS',   up: 4,
    perk: 'RAFTA DAHA ÇOK TABAK' },
  { id: 'LAMB',   name: 'KASAP KÜTÜĞÜ', station: 'LAMB',   up: 6,
    perk: 'EVDE DAHA ÇOK KUZU' },
];
const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

/** Love to go from `level` to `level + 1`. Climbs steeply on purpose. */
function upgradeCost(level) {
  return Math.round(14 * Math.pow(level, 1.45));
}

/**
 * The butcher's yard. Bulk is cheaper, but every trip costs you half an
 * hour of trading — walking out of a full house is meant to hurt.
 */
const LAMB_BUNDLES = [
  { n: 5,  cost: 16 },
  { n: 15, cost: 42 },
  { n: 40, cost: 100 },
];
const BUTCHER_TRIP_HOURS = 0.5;

/** Fame earned for owning a material at this level. */
const FAME_PER_LEVEL = 5;

/* ---- expansion: the second branch, bought with FAME, not love ---------- */
const BRANCH_FAME_COST = 260;
const BRANCH_NAME = 'CAN USTA CATERING';

/**
 * The two houses. Only the one you are standing in is simulated properly;
 * the other runs on an abstract tick (see Kitchen._stepAway) and shouts for
 * help when something goes wrong there.
 */
const BRANCHES = [
  { name: 'CAN USTA MANGAL',   x: 0.50, y: 0.48 },
  { name: 'CAN USTA CATERING', x: 0.14, y: 0.60 },
];
/** Where the salon tables stand, as tile columns. */
// Close enough to the pass that one phone camera can show the hand-off and
// the first tables together, while still leaving the counter queue an aisle.
const TABLE_COLS = [57, 61, 65, 69];
/** How likely an arriving diner takes a table rather than the counter. */
const TABLE_CHANCE = 0.55;

const AWAY_TICK = 5.0;        // seconds between offstage events
const TRAVEL_HOURS = 1.0;     // crossing town costs an hour of trading
const EMPIRE_FAME = 520;      // both houses + this much fame = you have won

/** Rival houses. Deliberately unnamed — they are just the competition. */
function makeRivals() {
  return [
    { id: 'R1', fame: 40, growth: 5.5, x: 0.22, y: 0.30 },
    { id: 'R2', fame: 28, growth: 7.0, x: 0.70, y: 0.22 },
    { id: 'R3', fame: 16, growth: 4.0, x: 0.78, y: 0.68 },
    { id: 'R4', fame: 8,  growth: 8.5, x: 0.34, y: 0.74 },
  ];
}

const WSTATE = { IDLE: 'idle', GO: 'go', WORK: 'work', BACK: 'back' };
const WORK_TIME = 0.35;
const JOB_LABEL = {
  lift: 'MANGALDAN AL', drop: 'PASA BIRAK', scrape: 'TEMİZLİK',
  wash: 'TABAK YIKIYOR', tea: 'ÇAY DAĞITIYOR', trim: 'HAZIRLIYOR',
  collect: 'TABAĞI AL', putback: 'TABAĞI BIRAK', serve: 'SERVİS',
  'collect-pay': 'HESAP ALIYOR', greet: 'İLGİLENİYOR',
};

class Worker {
  constructor(kitchen, def, homeX) {
    this.kitchen = kitchen;
    this.def = def;
    this.homeX = homeX;
    this.x = homeX;
    this.facing = -1;
    this.state = WSTATE.IDLE;
    this.targetX = homeX;
    this.timer = 0;
    this.carrying = null;        // a Skewer in transit (CIRAK / GARSON)
    this.job = null;             // whatever the current errand needs
    this.anim = new AnimationController();
    this.anim.variant = def.variant;
    this.anim.play('idle', kitchen.game.anims.STAFF_IDLE);
  }

  /** Head for a spot; `then` is the errand phase to enter on arrival. */
  goTo(x, job) {
    this.targetX = x;
    this.job = job;
    this.state = WSTATE.GO;
  }

  step(dt) {
    const A = this.kitchen.game.anims;

    if (this.state === WSTATE.GO || this.state === WSTATE.BACK) {
      const d = this.targetX - this.x;
      const move = STAFF_FX.WALK * dt;
      if (Math.abs(d) <= move) {
        this.x = this.targetX;
        if (this.state === WSTATE.GO) { this.state = WSTATE.WORK; this.timer = WORK_TIME; }
        else { this.state = WSTATE.IDLE; this.job = null; }
      } else {
        this.x += Math.sign(d) * move;
        this.facing = Math.sign(d);
      }
      this.anim.play('walk', A.STAFF_WALK);
    } else if (this.state === WSTATE.WORK) {
      this.timer -= dt;
      this.anim.play('idle', A.STAFF_IDLE);
      if (this.timer <= 0) {
        this.kitchen.workerFinished(this);      // the actual effect lands here
        this.state = WSTATE.BACK;
        this.targetX = this.homeX;
      }
    } else {
      this.anim.play('idle', A.STAFF_IDLE);
      this.kitchen.workerLookForJob(this);      // anything to do?
    }

    this.anim.update(dt);
  }

  draw(ctx, cam, floorY) {
    this.anim.draw(ctx, this.x - 24 - cam.drawX, floorY - 46 - cam.drawY,
                   this.facing > 0, false, this.kitchen.game.scratch);
    // whatever they are carrying, held out in front
    if (this.carrying) {
      this.kitchen.icon(ctx, this.carrying.icon,
                        this.x - 8 - cam.drawX + this.facing * 12,
                        floorY - 34 - cam.drawY, 0.8);
    }

    // A readable job bubble makes the value of every hire obvious.
    if (this.job && this.state !== WSTATE.IDLE) {
      const font = this.kitchen.game.font;
      const label = JOB_LABEL[this.job] || this.def.role;
      const maxW = 104;
      const w = Math.min(maxW, font.width(label) + 10);
      const x = Math.round(this.x - cam.drawX - w / 2);
      const y = Math.round(floorY - 82 - cam.drawY);
      ctx.fillStyle = 'rgba(12,20,27,0.90)';
      ctx.fillRect(x, y, w, 14);
      ctx.fillStyle = '#8fd4ff';
      ctx.fillRect(x, y, w, 1);
      font.draw(ctx, label, x + w / 2, y + 4,
                { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
      if (this.state === WSTATE.WORK) {
        ctx.fillStyle = '#34434d';
        ctx.fillRect(x + 2, y + 11, w - 4, 2);
        ctx.fillStyle = '#74e0b0';
        ctx.fillRect(x + 2, y + 11,
                     Math.round((w - 4) * clamp(1 - this.timer / WORK_TIME, 0, 1)), 2);
      }
    }
  }
}

/**
 * The kitchen line, left to right. `col` is a tile column; the 48x48 sprite
 * is drawn from there with its base on the floor, and `pad`/`w` describe the
 * interaction AABB inside it.
 */
const STATION_DEFS = [
  // Back of house. Washing up happens as far from the diners as the room
  // allows — which also makes running out of plates a genuinely long walk,
  // and the BULASIKCI worth every bit of his wage.
  // The back door sits behind the wash-up: the yard route out to the
  // butcher, and the answer to an empty cold room.
  { id: 'DOOR',   sprite: 10, col: 2, label: 'KASABA',    kind: 'door'    },
  { id: 'SINK',   sprite: 9, col:  6, label: 'BULAŞIK',   kind: 'sink'    },
  { id: 'LAMB',   sprite: 0, col: 11, label: 'KUZU',      kind: 'base',   makes: 'KEBAB'    },
  { id: 'SALT',   sprite: 1, col: 15, label: 'TUZ',      kind: 'season', gives: 'SALT'     },
  { id: 'PEPPER', sprite: 2, col: 19, label: 'KARABİBER',    kind: 'season', gives: 'PEPPER'   },
  { id: 'CHILI',  sprite: 3, col: 23, label: 'PUL BİBER', kind: 'season', gives: 'CHILI'    },
  { id: 'DOUGH',  sprite: 4, col: 27, label: 'LAHMACUN',  kind: 'base',   makes: 'LAHMACUN' },
  { id: 'SPIT',   sprite: 5, col: 31, label: 'DONER',     kind: 'base',   makes: 'DONER'    },
  { id: 'MANGAL', sprite: 6, col: 35, label: 'MANGAL',    kind: 'grill'   },
  // The board sits beside the pass on purpose: hiring should be a decision
  // you make where you already are, not a punishing trek across the kitchen.
  { id: 'OCAK',   sprite: 8, col: 39, label: 'İLAN',    kind: 'shop'    },
  { id: 'PASS',   sprite: 7, col: 44, label: 'PAS',      kind: 'pass'    },
];

/* -------------------------------------------------------------- the dish - */

/**
 * One plate in progress. Seasoning is only possible before it goes on the
 * heat — exactly like the real thing.
 */
class Skewer {
  constructor(itemId) {
    this.item = itemId;                 // 'KEBAB' | 'LAHMACUN' | 'DONER'
    this.seasonings = new Set();
    this.cook = 0;                      // 0 -> 1 over CFG.K.GRILL_TIME
  }
  get raw() { return this.cook <= 0; }
  /** RAW below the window, PERFECT inside it, BURNT past it. */
  get cookState() {
    const K = CFG.K;
    if (this.cook < K.RAW_MAX) return 'RAW';
    if (this.cook <= K.PERFECT_MAX) return 'PERFECT';
    return 'BURNT';
  }
  get icon() {
    if (this.cookState === 'BURNT') return ICON.BURNT;
    if (this.cookState === 'PERFECT') return ICON.GOOD;
    return MENU_BY_ID[this.item].icon;
  }
}

/* ------------------------------------------------------------- stations - */

class Station {
  constructor(def, floorY) {
    Object.assign(this, def);
    this.x = this.col * CFG.TILE;
    this.y = floorY - 46;               // sprites are anchored on row 46
    // Interaction box: generous, so you never fight the controls under time
    // pressure, but tight enough that adjacent stations never overlap.
    this.rect = { x: this.x + 2, y: floorY - 46, w: 44, h: 46 };
    this.slots = [];                    // the mangal's occupants, if any
    this.flash = 0;                     // brief highlight after a successful use
  }
  get cx() { return this.x + 24; }
}

/* ------------------------------------------------------------- customer - */

const CSTATE = { ENTER: 'enter', WAIT: 'wait', LEAVE: 'leave' };

class Customer {
  /**
   * @param {number|null} table  a table index, or null for the counter queue.
   *   Seated diners have to be carried to — which is the entire reason a
   *   GARSON is worth paying.
   */
  constructor(kitchen, variant, order, patience, slot, table = null) {
    this.kitchen = kitchen;
    this.variant = variant;
    this.order = order;                 // { item, seasonings: [...] }
    this.patience = patience;
    this.maxPatience = patience;
    this.slot = slot;
    this.table = table;
    this.seated = false;
    this.grumbled = false;
    this.state = CSTATE.ENTER;
    this.mood = 'neutral';
    this.x = kitchen.map.worldW + 26;   // walk in from off the right edge
    this.facing = -1;
    this.leaveTimer = 0;
    this.bob = 0;
    this.anim = new AnimationController();
    this.anim.variant = variant;
    this.anim.play('walk', kitchen.game.anims.CUST_WALK);
  }

  get targetX() {
    return this.table === null ? this.kitchen.slotX(this.slot)
                               : this.kitchen.tableX(this.table);
  }
  get atTable() { return this.table !== null; }
  get done() { return this.state === CSTATE.LEAVE && this.x > this.kitchen.map.worldW + 40; }

  step(dt) {
    const A = this.kitchen.game.anims;

    switch (this.state) {
      case CSTATE.ENTER: {
        const t = this.targetX;
        this.x -= 54 * dt;
        this.facing = -1;
        this.anim.play('walk', A.CUST_WALK);
        if (this.x <= t) { this.x = t; this.state = CSTATE.WAIT; }
        break;
      }
      case CSTATE.WAIT: {
        // Diners shuffle forward when the queue ahead of them clears.
        const t = this.targetX;
        if (this.x > t + 0.5) {
          this.x = Math.max(t, this.x - 54 * dt);
          this.anim.play('walk', A.CUST_WALK);
        } else {
          this.anim.play('idle', A.CUST_IDLE);
        }
        this.patience -= dt * this.kitchen.patienceRate;
        // Muffled grumbling once they are visibly fed up.
        if (!this.grumbled && this.patience < this.maxPatience * 0.3) {
          this.grumbled = true;
          this.kitchen.game.sfx.grumble();
          this.kitchen.popups.push(new Popup(this.x, this.kitchen.floorY - 62,
                                             'ÇOK BEKLEDİM...', '#e8a24a'));
        }
        if (this.patience <= 0) this.kitchen.onTimeout(this);
        break;
      }
      case CSTATE.LEAVE: {
        this.leaveTimer -= dt;
        if (this.leaveTimer > 0) {
          // Beat of reaction before they turn and go.
          this.anim.play(this.mood === 'happy' ? 'happy' : 'angry',
                         this.mood === 'happy' ? A.CUST_HAPPY : A.CUST_ANGRY);
        } else {
          this.facing = 1;
          this.x += 78 * dt;
          this.anim.play('walk', A.CUST_WALK);
        }
        break;
      }
    }
    this.anim.update(dt);
  }

  leave(mood) {
    this.state = CSTATE.LEAVE;
    this.mood = mood;
    this.leaveTimer = 1.1;
  }

  draw(ctx, cam, floorY) {
    // The sheet faces right; diners walk in facing left, hence the invert.
    this.anim.draw(ctx, this.x - 24 - cam.drawX, floorY - 46 - cam.drawY,
                   this.facing < 0, false, this.kitchen.game.scratch);
  }
}

/* ---------------------------------------------------------- floating text */

class Popup {
  constructor(x, y, text, color, scale = 1) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.scale = scale; this.life = 1.5; this.dead = false;
  }
  step(dt) {
    this.y -= 22 * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx, cam, font) {
    ctx.globalAlpha = clamp(this.life * 1.4, 0, 1);
    font.draw(ctx, this.text, this.x - cam.drawX, this.y - cam.drawY,
              { color: this.color, align: 'center', scale: this.scale, shadow: '#1b1220' });
    ctx.globalAlpha = 1;
  }
}

/* ================================================================ kitchen */

class Kitchen {
  /**
   * @param {number} lambStock  carried straight over from Act 1 — one per
   *                            sheep you actually cleared.
   */
  constructor(game, lambStock) {
    this.game = game;
    this.map = new LevelMap(game.assets.get('TILESET'),
                            CFG.KITCHEN_COLS, CFG.MAP_ROWS).buildKitchen();
    this.floorY = 15 * CFG.TILE;

    this.stations = STATION_DEFS.map((d) => new Station(d, this.floorY));
    this.byId = Object.fromEntries(this.stations.map((s) => [s.id, s]));

    this.player = new Player(game, 7 * CFG.TILE, this.floorY - CFG.PLAYER_H);
    this.player.canChop = false;        // the cleaver stays in Act 1

    this.customers = [];
    this.popups = [];
    this.pending = [];                  // queued arrivals: [{ delay }]

    this.carried = null;                // the Skewer in the chef's hands
    this.lamb = lambStock;
    this.love = CFG.K.LOVE_START;       // the spendable wallet
    this.fame = 0;                      // lifetime love earned; wins the game
    this.complaints = 0;

    /* ---- payroll ---------------------------------------------------- */
    this.staff = Object.create(null);    // role id -> how many are employed
    this.workers = [];
    this.shopOpen = false;
    this.shopCursor = 0;
    this.shopTab = 0;                   // 0 STAFF, 1 UPGRADES, 2 MAP
    this.butcherOpen = false;           // out in the yard buying lamb
    this.butcherCursor = 0;
    this.payrollDue = false;            // the books are open and unsettled
    this.payrollBill = 0;
    this.payrollCursor = 0;
    this.debts = [];                    // BORÇ DEFTERİ - every IOU, dated
    this.debtCursor = 0;
    this.lowLambWarned = false;

    /* ---- the trading day --------------------------------------------- */
    this.day = 1;
    this.hour = CLOCK.OPEN;
    this.closed = false;                // true between 21:00 and the next open
    this.dayServed = 0;
    this.dayLove = 0;
    this.lastBooks = null;              // previous day's summary

    /* ---- equipment, expansion, competition --------------------------- */
    this.levels = Object.fromEntries(MATERIALS.map((m) => [m.id, 1]));
    this.branches = 1;
    this.branchIndex = 0;               // which house you are standing in
    this.away = null;                   // the other house's books, when open
    this.alerts = [];                   // messages shouted over from there
    this.rivals = makeRivals();

    /* ---- the wash-up ------------------------------------------------- */
    this.dirty = 0;                     // plates in the sink
    this.washProgress = 0;              // the chef's current scrub
    this.shelf = [];                    // finished plates waiting on the pass
    this.pendingPayments = [];          // tables the cashier still has to visit
    this.served = 0;
    this.perfectServed = 0;
    this.washedTotal = 0;
    this.hiredTotal = 0;
    this.upgradeTotal = 0;
    this.goalIndex = 0;
    this.stickers = 0;
    this.friendsTold = 0;
    this.hype = 0;              // busier dining room as word gets around
    this.unlocked = new Set(['KEBAB']);
    this.newlyUnlocked = null;          // { name, timer } banner
    this.spawnTimer = 1.2;
    this.hint = '';                     // contextual prompt under the HUD
    this.hintTimer = 0;
    this.finished = null;               // 'won' | 'lost'
  }

  /* -------------------------------------------------- staff effects ---- */
  /* Every hire's effect is read through one of these, so the shop blurb and
     the behaviour can never drift apart. */

  /* ----------------------------------------------------------- controls -
   * ACT 2 runs on SPACE. The cleaver is Act 1's key and does nothing in a
   * kitchen, so the action button lands where the thumb already sits rather
   * than making the player move to E. E/F stay live as a silent alias so an
   * old habit never leaves anyone stuck; every label says SPACE.
   * ------------------------------------------------------------------- */
  act(input) { return input.hit('chop') || input.hit('use'); }
  actHeld(input) { return input.down('chop') || input.down('use'); }

  count(id) { return this.staff[id] || 0; }
  has(id) { return this.count(id) > 0; }
  get headcount() { return Object.values(this.staff).reduce((a, b) => a + b, 0); }
  /**
   * Every point of equipment above level 1 buys room for another pair of
   * hands — bigger kitchen, more people you can physically fit in it.
   */
  get headcountCap() {
    return 2 + Math.floor((this.totalLevels - MATERIALS.length) / 2);
  }
  get totalLevels() {
    return MATERIALS.reduce((a, m) => a + this.levels[m.id], 0);
  }
  get allMaxed() {
    return MATERIALS.every((m) => this.levels[m.id] >= MAX_LEVEL);
  }
  /** Fame is earned by service AND by the standard of the room itself. */
  get equipmentFame() {
    return (this.totalLevels - MATERIALS.length) * FAME_PER_LEVEL;
  }
  get totalFame() { return Math.round(this.fame + this.equipmentFame); }
  /** What one of this trade costs you per day. */
  wageOf(def) { return Math.max(1, Math.round(def.cost * 0.2)); }
  /** Tonight's wage bill, itemised. */
  get wageLines() {
    return STAFF.filter((w) => this.count(w.id) > 0).map((w) => ({
      def: w, n: this.count(w.id), each: this.wageOf(w),
      total: this.count(w.id) * this.wageOf(w),
    }));
  }
  get payroll() { return this.wageLines.reduce((a, l) => a + l.total, 0); }
  /** The other house's wage bill — one business, one payday. */
  get awayPayroll() {
    if (!this.away) return 0;
    return STAFF.reduce((a, w) => a + (this.away.staff[w.id] || 0) * this.wageOf(w), 0);
  }
  get totalPayroll() { return this.payroll + this.awayPayroll; }
  lvl(id) { return this.levels[id]; }
  /** MANAGER keeps the room calm; a second one helps, a third barely. */
  get patienceRate() {
    return Math.pow(STAFF_FX.MUDUR_PATIENCE, Math.min(this.count('MUDUR'), 2));
  }
  get queueSlots() {
    return CFG.K.QUEUE_SLOTS + Math.min(this.count('MUDUR'), 3) * STAFF_FX.MUDUR_SEATS;
  }
  /** A grate per grill cook, plus what the mangal itself can take. */
  get grillCapacity() {
    return Math.min(1 + this.count('CIRAK') + Math.floor((this.lvl('MANGAL') - 1) / 2), 5);
  }
  /** The mangal cooks faster as it improves. */
  get grillTime() {
    return CFG.K.GRILL_TIME * (1 - (this.lvl('MANGAL') - 1) * 0.07);
  }
  /** A better sink means a faster scrub. */
  get washTime() {
    return CFG.K.WASH_TIME * (1 - (this.lvl('SINK') - 1) * 0.11);
  }
  get shelfMax() { return CFG.K.SHELF_MAX + (this.lvl('PASS') - 1); }
  /** Total place settings in the house — the busser brings more out. */
  get plateStock() {
    return CFG.K.PLATES + this.count('KOMI') * STAFF_FX.KOMI_PLATES
                        + (this.lvl('PASS') - 1) * 2;
  }
  /** The butcher's block holds more lamb as it improves. */
  get lambCap() { return 20 + (this.lvl('LAMB') - 1) * 8; }
  /** Clean plates left. At zero the pass stops. */
  get clean() { return this.plateStock - this.dirty - this.shelf.length; }
  /** MANAGER absorbs some of the flak. */
  get maxComplaints() {
    const easyHelp = this.game.difficulty === DIFFICULTY.EASY ||
                     this.game.difficulty === DIFFICULTY.RELAXED ? 3 : 0;
    return CFG.K.MAX_COMPLAINTS + easyHelp +
           Math.min(this.count('MUDUR'), 2) * STAFF_FX.MUDUR_SLACK;
  }
  /** CASHIER works the till; extra tills help, with diminishing returns. */
  get loveMul() {
    const n = this.count('KASIYER');
    return n === 0 ? 1 : Math.min(2.25, 1 + 0.5 + 0.25 * (n - 1));
  }

  /* ---------------------------------------------------------- queue math - */

  slotX(i) { return this.byId.PASS.cx + 44 + i * 46; }
  tableX(i) { return TABLE_COLS[i % TABLE_COLS.length] * CFG.TILE + 24; }
  /** A table nobody is using, or -1. */
  freeTable() {
    const taken = new Set(this.customers.filter((c) => c.table !== null)
                                        .map((c) => c.table));
    for (let i = 0; i < TABLE_COLS.length; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /* ----------------------------------------------------- BORÇ DEFTERİ --- */

  get totalDebt() { return this.debts.reduce((a, d) => a + d.amount, 0); }

  /** Write an IOU into the book. */
  addDebt(who, amount, note) {
    if (amount <= 0) return;
    this.debts.push({ day: this.day, who, amount: Math.round(amount), note });
    this.pushAlert(`BORÇ DEFTERİNE YAZILDI: ${Math.round(amount)}`, '#e8604f');
  }

  /** Pay one entry off, oldest first or whichever is picked. */
  payDebt(i) {
    const d = this.debts[i];
    if (!d) return false;
    if (this.love < d.amount) { this.say('YETERLİ SEVGİ YOK'); this.game.sfx.thud(); return false; }
    this.love -= d.amount;
    this.debts.splice(i, 1);
    this.debtCursor = clamp(this.debtCursor, 0, Math.max(0, this.debts.length - 1));
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                               'BORÇ ÖDENDİ', '#74e0b0'));
    this.game.sfx.win();
    return true;
  }

  get waiting() {
    return this.customers.filter((c) => c.state !== CSTATE.LEAVE);
  }
  get seated() {
    return this.customers.filter((c) => c.table !== null && c.state === CSTATE.WAIT);
  }

  /** The diner at the head of the queue — the one the pass will serve. */
  /** Head of the COUNTER queue — seated diners are served at their table. */
  get front() {
    let best = null;
    for (const c of this.customers) {
      if (c.state !== CSTATE.WAIT || c.table !== null) continue;
      if (!best || c.slot < best.slot) best = c;
    }
    return best;
  }
  /** A seated diner within arm's reach of the chef. */
  seatedNear(x, r = 34) {
    return this.customers.find((c) => c.table !== null &&
      c.state === CSTATE.WAIT && Math.abs(c.x - x) < r) || null;
  }

  /* ------------------------------------------------------------- spawning */

  get availableItems() {
    return MENU.filter((m) => this.unlocked.has(m.id) &&
                              (m.lamb === 0 || this.lamb > 0));
  }

  rollOrder() {
    const pool = this.availableItems.length ? this.availableItems
                                            : [MENU_BY_ID.LAHMACUN];
    const item = pool[Math.floor(Math.random() * pool.length)];
    // 1..maxSpice distinct seasonings, drawn without replacement.
    const bag = SEASONINGS.slice();
    const n = 1 + Math.floor(Math.random() * item.maxSpice);
    const picks = [];
    for (let i = 0; i < n && bag.length; i++) {
      picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    }
    // Keep the order readable: always render in a stable order.
    picks.sort((a, b) => SEASONINGS.indexOf(a) - SEASONINGS.indexOf(b));
    return { item: item.id, seasonings: picks };
  }

  /** Free queue slot, or -1 when the pass is full. */
  freeSlot() {
    const taken = new Set(this.waiting.filter((c) => c.table === null)
                                      .map((c) => c.slot));
    for (let i = 0; i < this.queueSlots; i++) if (!taken.has(i)) return i;
    return -1;
  }

  spawnCustomer() {
    const modeMul = this.game.difficulty === DIFFICULTY.RELAXED ? 1.65
                  : this.game.difficulty === DIFFICULTY.EASY ? 1.35 : 1;
    const patience = Math.max(CFG.K.PATIENCE_FLOOR,
                              CFG.K.PATIENCE - this.served * CFG.K.PATIENCE_RAMP) * modeMul;
    // Roughly half of them would rather sit down. Seated diners have to be
    // carried to, which is what makes a waiter worth his wage.
    const table = Math.random() < TABLE_CHANCE ? this.freeTable() : -1;
    if (table >= 0) {
      // A seated diner is patient — they are comfortable.
      this.customers.push(new Customer(this, Math.floor(Math.random() * 3),
        this.rollOrder(), patience * 1.35, 99, table));
      return true;
    }
    const slot = this.freeSlot();
    if (slot < 0) return false;
    this.customers.push(new Customer(
      this, Math.floor(Math.random() * 3), this.rollOrder(), patience, slot));
    return true;
  }

  /**
   * Word of mouth. Friends only ever join if the pass can actually take
   * them — an unbounded backlog would guarantee walkouts no matter how well
   * the player cooks. Surplus goodwill becomes `hype` instead, which makes
   * the room busier without making it unservable.
   */
  tellFriends(n, hype) {
    this.hype += hype;
    for (let i = 0; i < n; i++) {
      if (this.pending.length + this.waiting.length >= this.queueSlots) break;
      this.pending.push({ delay: 0.9 + i * 0.8 });
      this.friendsTold++;
    }
  }

  /* --------------------------------------------------------------- update */

  step(dt, input) {
    if (this.finished) {
      // Let the last reaction play out, but stop the simulation churning.
      for (const c of this.customers) c.step(dt);
      this.customers = this.customers.filter((c) => !c.done);
      this._stepPopups(dt);
      return;
    }

    // The hiring board freezes the room: this is a management screen, and
    // being mauled by the queue while reading job descriptions is no fun.
    if (this.payrollDue) { this._stepPayroll(input); this._stepPopups(dt); return; }
    if (this.butcherOpen) { this._stepButcher(input); this._stepPopups(dt); return; }
    if (this.shopOpen) { this._stepShop(input); this._stepPopups(dt); return; }

    // The clock only turns while the doors are open.
    this.hour += dt / CLOCK.SEC_PER_HOUR;
    if (this.hour >= CLOCK.CLOSE) { this.hour = CLOCK.CLOSE; this.closeUp(); return; }

    this.player.step(dt, this.map, input);
    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.newlyUnlocked) {
      this.newlyUnlocked.timer -= dt;
      if (this.newlyUnlocked.timer <= 0) this.newlyUnlocked = null;
    }

    /* ---- the mangal cooks whatever is on it, tended or not ------------- */
    const grill = this.byId.MANGAL;
    for (const sk of grill.slots) {
      // Was it already ruined *before* this tick? A CIRAK holds anything
      // still cooking at the window so it can never char on his watch —
      // without that the grill jams, since he only lifts PERFECT plates and
      // anything burned while he was away delivering would block a grate
      // forever. He does not, however, magically rescue a skewer that was
      // already charcoal when he was hired: that one he scrapes off.
      const alreadyRuined = sk.cookState === 'BURNT';
      sk.cook += dt / this.grillTime;
      if (this.has('CIRAK') && !alreadyRuined) {
        sk.cook = Math.min(sk.cook, CFG.K.PERFECT_MAX);
      }
      if (Math.random() < dt * 14) {
        this.game.particles.push(new Particle(
          grill.cx + rand(-16, 16), grill.y + 20, rand(-8, 8), rand(-30, -12),
          rand(0.3, 0.7), rand(1, 3),
          sk.cookState === 'BURNT' ? '#5a5460' : '#ffb45a', -20));
      }
    }

    /* ---- the meat situation ------------------------------------------- */
    if (this.lamb <= 5 && !this.lowLambWarned) {
      this.lowLambWarned = true;
      this.pushAlert('AZ KUZU KALDI - KASABA GİT', '#f2b53c');
    }
    if (this.lamb > 5) this.lowLambWarned = false;
    if (this.lamb <= 0) this._rerollLambTickets();

    /* ---- the chef scrubbing at the sink -------------------------------- */
    const atSink = this.stationUnder(this.player.body) === this.byId.SINK;
    if (atSink && this.actHeld(input) && this.dirty > 0 && !this.carried) {
      this.washProgress += dt;
      if (this.washProgress >= this.washTime) {
        this.washProgress = 0;
        this.dirty--;
        this.washedTotal++;
        this.byId.SINK.flash = 0.18;
        this.game.sfx.drop();
        this.game.burst(this.byId.SINK.cx, this.byId.SINK.y + 24, 4, '#9cd8f0');
      }
    } else {
      this.washProgress = 0;
    }

    /* ---- staff at their posts, doing their actual jobs ----------------- */
    for (const w of this.workers) w.step(dt);
    this._stepAway(dt);
    for (const s of this.stations) if (s.flash > 0) s.flash -= dt;

    /* ---- interaction --------------------------------------------------- */
    if (this.act(input)) {
      if (input.down('down') && this.carried) this._bin();
      else {
        // A plate in hand beside a table beats any station underfoot — this
        // is how a seated diner gets served without a waiter.
        const seat = this.carried ? this.seatedNear(this.player.body.cx) : null;
        if (seat) { this._serve(seat, this.carried); this.carried = null; }
        else this._use();
      }
    }

    /* ---- arrivals ------------------------------------------------------ */
    for (const p of this.pending) p.delay -= dt;
    while (this.pending.length && this.pending[0].delay <= 0) {
      if (this.freeSlot() < 0) break;       // pass is full; they wait outside
      this.pending.shift();
      this.spawnCustomer();
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const K = CFG.K;
      // Trade follows the clock, and a rival on a hot streak thins it out.
      // Rivals bite. Fall behind the best house in town and the room
      // empties fast — this is what makes their fame worth watching.
      const topRival = Math.max(...this.rivals.map((r) => r.fame));
      const behind = Math.max(0, topRival - this.totalFame);
      const pressure = clamp(1 - behind / 180, 0.25, 1);
      const busy = demandAt(this.hour) * pressure;
      this.spawnTimer = Math.max(K.SPAWN_GAP_MIN,
                                 (K.SPAWN_GAP - this.hype * K.HYPE_PER_GAP) / busy);
      // Never stack the queue to the brim from ambient traffic alone: an
      // empty pass always refills, a busy one is left to the player.
      if (this.waiting.length === 0 ||
          (this.waiting.length < this.queueSlots - 1 && Math.random() < 0.7)) {
        this.spawnCustomer();
      }
    }

    for (const c of this.customers) c.step(dt);
    this.customers = this.customers.filter((c) => !c.done);
    this._compactQueue();
    this._stepPopups(dt);

    this.game.camera.follow(this.player, dt, this.map.worldW);
    this.game.guide.stepKitchen(this);
    this._checkGoal();
    this._checkEnd();
  }

  _stepPopups(dt) {
    for (const p of this.popups) p.step(dt);
    this.popups = this.popups.filter((p) => !p.dead);
  }

  /** Pull waiting diners forward into the lowest free slots. */
  _compactQueue() {
    const q = this.customers.filter((c) => c.table === null &&
                                    (c.state === CSTATE.WAIT || c.state === CSTATE.ENTER))
                            .sort((a, b) => a.slot - b.slot);
    q.forEach((c, i) => { c.slot = i; });
  }

  /* ------------------------------------------------------- the payroll --
   * Workers ask the kitchen for something to do (workerLookForJob) and the
   * kitchen applies the result when they arrive (workerFinished). Keeping
   * both halves here means a worker never mutates the kitchen behind its
   * back, and every effect is in one readable place.
   * -------------------------------------------------------------------- */

  workerLookForJob(w) {
    const grill = this.byId.MANGAL;
    const pass = this.byId.PASS;
    const sink = this.byId.SINK;

    switch (w.def.id) {
      /* ---- GRILL COOK: lift anything that is ready onto the pass ------ */
      case 'CIRAK': {
        // Holding a plate with nowhere to put it: wait at the post rather
        // than pacing back and forth to a full shelf.
        if (w.carrying) {
          if (this.shelf.length < this.shelfMax) w.goTo(pass.cx - 16, 'drop');
          return;
        }
        // Clearing a ruined plate always takes priority — a charred skewer
        // occupies a grate forever otherwise.
        if (grill.slots.some((sk) => sk.cookState === 'BURNT')) {
          w.goTo(grill.cx, 'scrape');
          return;
        }
        const i = grill.slots.findIndex((sk) => sk.cookState === 'PERFECT');
        if (i >= 0 && this.shelf.length < this.shelfMax) w.goTo(grill.cx, 'lift');
        return;
      }

      /* ---- BUSSER: a second pair of hands at the sink ----------------- */
      case 'KOMI': {
        if (this.dirty > 0) w.goTo(sink.cx + 22, 'wash');
        return;
      }

      /* ---- TEA BOY: tea for the whole queue --------------------------- */
      case 'CAYCI': {
        const q = this.waiting.filter((d) => d.state === CSTATE.WAIT);
        if (q.length) w.goTo(clamp(q[q.length - 1].x - 18, 0, this.map.worldW), 'tea');
        return;
      }

      /* ---- BUTCHER: keep the lamb coming ------------------------------ */
      case 'KASAP': {
        if (this.lamb < this.lambCap) w.goTo(this.byId.LAMB.cx - 22, 'trim');
        return;
      }

      /* ---- DISHWASHER: scrub whatever is in the basin ----------------- */
      case 'BULASIKCI': {
        if (this.dirty > 0) w.goTo(sink.cx, 'wash');
        return;
      }

      /* ---- WAITER: carry a finished plate out to the right diner ------ */
      case 'GARSON': {
        if (w.carrying) {
          const c = this._dinerFor(w.carrying);
          if (c) { w.goTo(clamp(c.x - 22, 0, this.map.worldW), 'serve'); return; }
          w.goTo(pass.cx - 16, 'putback');
          return;
        }
        const idx = this.shelf.findIndex((sk) => this._dinerFor(sk));
        if (idx >= 0) w.goTo(pass.cx - 16, 'collect');
        return;
      }

      /* ---- CASHIER: run the payment out to whoever was just served ---- */
      case 'KASIYER': {
        if (this.pendingPayments.length) {
          const p = this.pendingPayments[0];
          w.goTo(clamp(p.x, 0, this.map.worldW), 'collect-pay');
        }
        return;
      }

      /* ---- MANAGER: work the queue, hand patience back ---------------- */
      case 'MUDUR': {
        const c = this.waiting
          .filter((d) => d.state === CSTATE.WAIT && d.patience < d.maxPatience * 0.7)
          .sort((a, b) => a.patience - b.patience)[0];
        if (c) w.goTo(clamp(c.x - 24, 0, this.map.worldW), 'greet');
        return;
      }
    }
  }

  workerFinished(w) {
    const grill = this.byId.MANGAL;

    switch (w.job) {
      case 'lift': {
        const i = grill.slots.findIndex((sk) => sk.cookState === 'PERFECT');
        if (i >= 0) {
          w.carrying = grill.slots.splice(i, 1)[0];
          this.popups.push(new Popup(w.x, this.floorY - 58, 'MÜKEMMEL!', '#74e0b0'));
        }
        break;
      }
      case 'drop': {
        if (w.carrying && this.shelf.length < this.shelfMax) {
          this.shelf.push(w.carrying);
          w.carrying = null;
        }
        break;
      }
      case 'wash': {
        if (this.dirty > 0) {
          this.dirty--;
          this.washedTotal++;
          this.game.burst(w.x, this.floorY - 26, 4, '#9cd8f0');
        }
        break;
      }
      case 'scrape': {
        const i = grill.slots.findIndex((sk) => sk.cookState === 'BURNT');
        if (i >= 0) {
          grill.slots.splice(i, 1);
          this.dirty++;                       // the plate still needs washing
          this.popups.push(new Popup(w.x, this.floorY - 58, 'KAZINDI', '#8d8296'));
          this.game.burst(w.x, this.floorY - 34, 5, '#5a5460');
        }
        break;
      }
      case 'tea': {
        let n = 0;
        for (const c of this.waiting) {
          if (c.state !== CSTATE.WAIT) continue;
          c.patience = Math.min(c.maxPatience, c.patience + STAFF_FX.CAYCI_TOPUP);
          n++;
        }
        if (n) this.popups.push(new Popup(w.x, this.floorY - 58, 'ÇAY!', '#e8a24a'));
        break;
      }
      case 'trim': {
        this.lamb = Math.min(this.lambCap, this.lamb + STAFF_FX.KASAP_LAMB);
        this.popups.push(new Popup(w.x, this.floorY - 58,
                                   `+${STAFF_FX.KASAP_LAMB} KUZU`, '#f2b53c'));
        break;
      }
      case 'collect': {
        const idx = this.shelf.findIndex((sk) => this._dinerFor(sk));
        if (idx >= 0) w.carrying = this.shelf.splice(idx, 1)[0];
        break;
      }
      case 'putback': {
        if (w.carrying && this.shelf.length < this.shelfMax) {
          this.shelf.push(w.carrying);
          w.carrying = null;
        }
        break;
      }
      case 'serve': {
        if (w.carrying) {
          const c = this._dinerFor(w.carrying);
          if (c) { this._serve(c, w.carrying); w.carrying = null; }
        }
        break;
      }
      case 'collect-pay': {
        const p = this.pendingPayments.shift();
        if (p) {
          this.popups.push(new Popup(w.x, this.floorY - 54, 'TESEKKURLER!', '#ffd27a'));
          this.game.sfx.drop();
        }
        break;
      }
      case 'greet': {
        const c = this.waiting
          .filter((d) => d.state === CSTATE.WAIT)
          .sort((a, b) => Math.abs(a.x - w.x) - Math.abs(b.x - w.x))[0];
        if (c) {
          c.patience = Math.min(c.maxPatience, c.patience + STAFF_FX.MUDUR_TOPUP);
          this.popups.push(new Popup(c.x, this.floorY - 62, 'BUYURUN', '#8fd4ff'));
        }
        break;
      }
    }
  }

  /**
   * Out of meat: rewrite any waiting ticket that needs it to a lahmacun,
   * which needs none. Without this a dry cold room leaves a queue of orders
   * nobody could ever fill, and the day is lost with no way back.
   */
  _rerollLambTickets() {
    if (!this.unlocked.has('LAHMACUN')) return;
    for (const c of this.customers) {
      if (c.state !== CSTATE.WAIT) continue;
      if (MENU_BY_ID[c.order.item].lamb === 0) continue;
      c.order = { item: 'LAHMACUN', seasonings: c.order.seasonings.slice(0, 2) };
      this.popups.push(new Popup(c.x, this.floorY - 70, 'LAHMACUN OLSUN', '#f2b53c'));
    }
  }

  /**
   * The waiting diner whose ticket this finished plate satisfies EXACTLY.
   * The waiter is deliberately fussy: he will leave a mis-seasoned plate on
   * the shelf rather than carry it out and earn you a complaint you never
   * chose. Bin it yourself (S+E) if it is a write-off.
   */
  _dinerFor(skewer) {
    return this.customers.find((c) => {
      if (c.state !== CSTATE.WAIT) return false;
      if (c.order.item !== skewer.item) return false;
      if (c.order.seasonings.length !== skewer.seasonings.size) return false;
      return c.order.seasonings.every((sn) => skewer.seasonings.has(sn));
    }) || null;
  }

  /* ---------------------------------------------------------- interaction */

  stationUnder(body) {
    for (const s of this.stations) if (aabb(body.rect, s.rect)) return s;
    return null;
  }

  say(msg) { this.hint = msg; this.hintTimer = 2.2; }

  _bin() {
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 6,
                               'ATILDI', '#c9bda8'));
    this.carried = null;
    this.game.sfx.drop();
  }

  _use() {
    const s = this.stationUnder(this.player.body);
    if (!s) return;

    switch (s.kind) {
      /* ---- pick up a base ------------------------------------------- */
      case 'base': {
        if (this.carried) {
          this.say(this.game.input.touchMode ? 'ELİN DOLU - TABAĞI AT DÜĞMESİ' : 'ELİN DOLU - S+SPACE İLE AT');
          return;
        }
        if (!this.unlocked.has(s.makes)) { this.say('HENÜZ MENÜDE YOK'); return; }
        const item = MENU_BY_ID[s.makes];
        if (item.lamb > 0 && this.lamb < item.lamb) {
          this.say('KUZU BİTTİ - ARKA KAPIDAN KASABA!');
          return;
        }
        if (this.clean <= 0) { this.say('TEMİZ TABAK YOK - BULAŞIK YIKA!'); return; }
        this.lamb -= item.lamb;
        this.carried = new Skewer(s.makes);
        s.flash = 0.25;
        this.game.sfx.drop();
        break;
      }

      /* ---- season (only before it hits the heat) --------------------- */
      case 'season': {
        if (!this.carried) { this.say('ÖNCE HAMURU AL'); return; }
        if (!this.carried.raw) { this.say('GEÇ KALDIN - PİŞMİŞ'); return; }
        if (this.carried.seasonings.has(s.gives)) { this.say('ZATEN BAHARATLI'); return; }
        this.carried.seasonings.add(s.gives);
        s.flash = 0.25;
        this.game.sfx.chop();
        this.game.burst(this.player.body.cx, this.player.body.cy - 6, 5, '#f8e9cf');
        break;
      }

      /* ---- the mangal: drop it on, or lift it off -------------------- */
      case 'grill': {
        if (this.carried && s.slots.length < this.grillCapacity) {
          if (!this.carried.raw) { this.say('BU ZATEN PİŞTİ'); return; }
          s.slots.push(this.carried);
          this.carried = null;
          s.flash = 0.25;
          this.game.sfx.spit();
        } else if (!this.carried && s.slots.length) {
          // Always hand back the one that went on first — the most cooked.
          this.carried = s.slots.shift();
          const st = this.carried.cookState;
          this.popups.push(new Popup(
            s.cx, s.y + 6,
            st === 'PERFECT' ? 'MÜKEMMEL!' : st === 'BURNT' ? 'YANDI' : 'HÂLÂ ÇİĞ',
            st === 'PERFECT' ? '#74e0b0' : st === 'BURNT' ? '#e8604f' : '#f2b53c'));
          if (st === 'PERFECT') { this.game.camera.shake(2); this.game.sfx.chop(); }
          else this.game.sfx.thud();
        } else if (this.carried) {
          this.say('MANGAL DOLU');
        } else {
          this.say('PİŞİRECEK BİR ŞEY YOK');
        }
        break;
      }

      /* ---- the back door: out to the butcher -------------------------- */
      case 'door': {
        if (this.carried) { this.say('ÖNCE TABAĞI BIRAK'); return; }
        this.butcherOpen = true;
        this.butcherCursor = 0;
        // The trip costs trading time, so it is never a free reset.
        this.hour = Math.min(CLOCK.CLOSE, this.hour + BUTCHER_TRIP_HOURS);
        s.flash = 0.25;
        this.game.sfx.jump();
        break;
      }

      /* ---- the hiring board ------------------------------------------ */
      case 'shop': {
        this.shopOpen = true;
        this.shopTab = 0;
        this.shopCursor = 0;
        s.flash = 0.25;
        this.game.sfx.jump();
        break;
      }

      /* ---- the pass: serve, or lift a finished plate off the shelf --- */
      case 'pass': {
        if (!this.carried) {
          if (s.shelfPick !== undefined) { /* nothing */ }
          if (this.shelf.length) {        // take what the grill cook left out
            this.carried = this.shelf.shift();
            s.flash = 0.25;
            this.game.sfx.drop();
            return;
          }
          this.say('SERVİS EDECEK BİR ŞEY YOK');
          return;
        }
        const c = this.front;
        if (!c) { this.say('BEKLEYEN YOK'); return; }
        this._serve(c, this.carried);
        this.carried = null;
        s.flash = 0.3;
        break;
      }

      /* ---- the sink: held down, E scrubs (see step()) ---------------- */
      case 'sink': {
        if (this.carried) { this.say('ÖNCE TABAĞI BIRAK'); return; }
        if (this.dirty <= 0) this.say('YIKANACAK BİR ŞEY YOK');
        break;
      }
    }
  }

  /* ------------------------------------------------------------- scoring - */

  /**
   * Grade a plate against its ticket.
   *   PERFECT — right dish, exact seasoning, pulled inside the window
   *   OK      — right dish, at most one seasoning slip, not burnt
   *   BAD     — wrong dish, burnt, or two or more slips
   */
  static grade(skewer, order) {
    if (skewer.item !== order.item) return 'BAD';
    if (skewer.cookState === 'BURNT') return 'BAD';
    const want = new Set(order.seasonings);
    let errs = 0;
    for (const s of want) if (!skewer.seasonings.has(s)) errs++;
    for (const s of skewer.seasonings) if (!want.has(s)) errs++;
    if (errs >= 2) return 'BAD';
    if (errs === 0 && skewer.cookState === 'PERFECT') return 'PERFECT';
    return 'OK';
  }

  _serve(customer, skewer) {
    const K = CFG.K;
    const verdict = Kitchen.grade(skewer, customer.order);
    this.served++;
    this.dayServed++;
    this.dirty++;                       // it always comes back dirty
    // The cashier has somewhere to run to; without one the money just lands.
    if (this.has('KASIYER') && verdict !== 'BAD') {
      this.pendingPayments.push({ x: customer.x });
      if (this.pendingPayments.length > 4) this.pendingPayments.shift();
    }

    if (verdict === 'PERFECT') {
      this.perfectServed++;
      this._earn(K.LOVE_PERFECT, K.FAME_PERFECT);
      this.tellFriends(K.WOM_PERFECT, K.HYPE_PERFECT);
      customer.leave('happy');
      this.popups.push(new Popup(customer.x, this.floorY - 62,
                                 'ARKADAŞINA ANLATTI!', '#74e0b0'));
      this.game.camera.shake(3);
      this.game.sfx.win();
      this.game.burst(customer.x, this.floorY - 40, 14, '#74e0b0');
    } else if (verdict === 'OK') {
      this._earn(K.LOVE_OK, K.FAME_OK);
      this.tellFriends(K.WOM_OK, K.HYPE_OK);
      customer.leave('happy');
      this.popups.push(new Popup(customer.x, this.floorY - 62, 'FENA DEĞİL', '#f2b53c'));
      this.game.sfx.jump();
    } else {
      this._earn(K.LOVE_BAD, 0);
      this.game.sfx.grumble();
      this.complaints++;
      customer.leave('angry');
      this.popups.push(new Popup(customer.x, this.floorY - 62, 'BU OLMADI!', '#e8604f'));
      this.game.camera.shake(6);
      this.game.sfx.hurt();
    }
  }

  onTimeout(customer) {
    this._earn(CFG.K.LOVE_TIMEOUT, 0);
    this.game.sfx.grumble();
    this.complaints++;
    customer.leave('angry');
    this.popups.push(new Popup(customer.x, this.floorY - 62, 'ÇOK BEKLEDİM!', '#e8604f'));
    this.game.camera.shake(5);
    this.game.sfx.hurt();
  }

  /**
   * Diners pay in love. `fame` banks what was EARNED and is never spent, so
   * the payroll can never push the win condition further away.
   * @param {number} love  wallet delta (the cashier multiplies gains)
   * @param {number} fame  progress delta (never negative)
   */
  _earn(love, fame) {
    let paid = love > 0 ? Math.round(love * this.loveMul) : love;
    if (paid < 0 && this.game.difficulty === DIFFICULTY.EASY) paid = Math.ceil(paid / 2);
    if (paid < 0 && this.game.difficulty === DIFFICULTY.RELAXED) paid = 0;
    this.love = Math.max(0, this.love + paid);
    if (paid > 0) this.dayLove += paid;
    if (fame > 0) this.fame += Math.round(fame * this.loveMul);
    this.popups.push(new Popup(
      this.player.body.cx, this.player.body.y - 10,
      `${paid > 0 ? '+' : ''}${paid} LOVE`,
      paid > 0 ? '#74e0b0' : '#e8604f'));
    this._checkUnlocks();
  }

  /* ------------------------------------------------------------ the shop - */

  /** Where each role idles between errands. */
  _postFor(def) {
    return {
      grill:  this.byId.MANGAL.cx + 30,
      sink:   this.byId.SINK.cx - 26,
      sink2:  this.byId.SINK.cx + 26,
      lamb:   this.byId.LAMB.cx - 26,
      pass:   this.byId.PASS.cx - 30,
      till:   this.byId.PASS.cx + 16,
      queue:  this.byId.PASS.cx + 40,
      queue2: this.byId.PASS.cx + 66,
    }[def.post] ?? this.byId.PASS.cx;
  }

  /** Each extra copy of a role costs half as much again as the last. */
  hireCost(def) {
    return Math.round(def.cost * Math.pow(1.5, this.count(def.id)));
  }

  hire(def) {
    if (this.count(def.id) >= 3) { this.say('BİR MESLEKTEN ÜÇ YETER'); return false; }
    if (this.headcount >= this.headcountCap) {
      this.say('YER YOK - ÖNCE MUTFAĞI BÜYÜT');
      this.game.sfx.thud();
      return false;
    }
    const price = this.hireCost(def);
    if (this.love < price) { this.say('YETERLİ SEVGİ YOK'); this.game.sfx.thud(); return false; }
    this.love -= price;
    this.staff[def.id] = this.count(def.id) + 1;
    // Stagger duplicates so a second cook does not stand inside the first.
    const dupe = (this.count(def.id) - 1) * 26;
    this.workers.push(new Worker(this, def, this._postFor(def) + dupe));
    this.hiredTotal++;
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                               `${def.name} İŞE ALINDI!`, '#8fd4ff'));
    this.game.sfx.win();
    this.game.camera.shake(3);
    return true;
  }

  /* ------------------------------------------------------- the equipment */

  upgrade(mat) {
    const lv = this.levels[mat.id];
    if (lv >= MAX_LEVEL) { this.say('ŞEHRİN EN İYİSİ'); return false; }
    const price = upgradeCost(lv);
    if (this.love < price) { this.say('YETERLİ SEVGİ YOK'); this.game.sfx.thud(); return false; }
    this.love -= price;
    this.levels[mat.id] = lv + 1;
    this.upgradeTotal++;
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                               `${mat.name} SEVİYE ${lv + 1}!`, '#f2b53c'));
    this.game.sfx.win();
    this.game.camera.shake(4);
    return true;
  }

  /* ----------------------------------------------------- the other house */

  get branchName() { return BRANCHES[this.branchIndex].name; }
  get awayName() { return this.away ? this.away.name : null; }

  /** Shout something over from the branch you are not standing in. */
  pushAlert(text, color = '#f2b53c', trouble = null) {
    this.alerts.push({ text, color, life: 7 });
    if (this.alerts.length > 3) this.alerts.shift();
    if (trouble && this.away) this.away.trouble = trouble;
    this.game.sfx.thud();
  }

  /**
   * The house you are not in, ticked abstractly. It serves what its staff
   * and kit can manage, burns lamb doing it, and calls for help the moment
   * something goes wrong — which is the whole point of having two.
   */
  _stepAway(dt) {
    const a = this.away;
    if (!a) return;

    for (const al of this.alerts) al.life -= dt;
    this.alerts = this.alerts.filter((al) => al.life > 0);

    a.timer -= dt;
    if (a.timer > 0) return;
    a.timer = AWAY_TICK / Math.max(0.5, demandAt(this.hour));

    const hands = Object.values(a.staff).reduce((x, y) => x + y, 0);
    if (hands === 0) {
      if (a.trouble !== 'NOSTAFF') {
        this.pushAlert(`${a.name} ŞUBESİNDE KİMSE YOK`, '#e8604f', 'NOSTAFF');
      }
      return;
    }

    // No lamb? It can still push lahmacun, but it will say so once.
    const needsLamb = Math.random() < 0.6;
    if (needsLamb && a.lamb <= 0) {
      if (a.trouble !== 'NOLAMB') {
        this.pushAlert(`${a.name} ŞUBESİNDE KUZU BİTTİ`, '#e8604f', 'NOLAMB');
      }
      return;
    }
    if (needsLamb) a.lamb--;

    // Plates pile up over there too.
    a.dirty++;
    const washers = (a.staff.BULASIKCI || 0) + (a.staff.KOMI || 0);
    a.dirty = Math.max(0, a.dirty - washers);
    if (a.dirty >= 8) {
      if (a.trouble !== 'PLATES') {
        this.pushAlert(`${a.name} ŞUBESİNDE TEMİZ TABAK YOK`, '#e8604f', 'PLATES');
      }
      return;
    }

    // A short-handed house drops one now and then.
    const lv = MATERIALS.reduce((x, m) => x + a.levels[m.id], 0);
    const capable = hands * 1.6 + (lv - MATERIALS.length) * 0.3;
    if (Math.random() > Math.min(0.95, 0.35 + capable * 0.12)) {
      a.walkouts = (a.walkouts || 0) + 1;
      this.fame = Math.max(0, this.fame - 1);
      if (a.walkouts % 3 === 0) {
        this.pushAlert(`${a.name} ŞUBESİNDEN ${a.walkouts} MÜŞTERİ GİTTİ`,
                       '#e8604f', 'WALKOUTS');
      }
      return;
    }

    // A good plate, offstage.
    const take = Math.round((3 + capable) * (this.has('KASIYER') ? 1.2 : 1));
    this.love += take;
    this.dayLove += take;
    this.fame += 2;
    a.served++;
    a.dayServed = (a.dayServed || 0) + 1;
    if (a.trouble && a.trouble !== 'NOSTAFF') a.trouble = null;
  }

  /** Swap which house you are standing in. */
  travelTo(index) {
    if (!this.away || index === this.branchIndex) return false;
    // Park everything about this house, and unpack the other.
    const parked = {
      name: this.branchName, staff: this.staff, levels: this.levels,
      lamb: this.lamb, dirty: this.dirty, timer: AWAY_TICK,
      trouble: null, served: this.served, walkouts: 0,
    };
    const inc = this.away;

    this.staff = inc.staff;
    this.levels = inc.levels;
    this.lamb = inc.lamb;
    this.dirty = inc.dirty;
    this.branchIndex = index;
    this.away = parked;

    // Rebuild the floor for the house you have just walked into.
    this.workers = [];
    for (const def of STAFF) {
      for (let i = 0; i < this.count(def.id); i++) {
        this.workers.push(new Worker(this, def, this._postFor(def) + i * 26));
      }
    }
    this.customers = [];
    this.pending = [];
    this.shelf = [];
    this.carried = null;
    this.byId.MANGAL.slots = [];
    this.spawnTimer = 2.5;
    this.hour = Math.min(CLOCK.CLOSE, this.hour + TRAVEL_HOURS);
    this.alerts = [];
    this.pushAlert(`${this.branchName} ŞUBESİNDESİN`, '#8fd4ff');
    this.game.camera.x = 0;
    return true;
  }

  /* --------------------------------------------------------- expansion - */

  canOpenBranch() {
    return this.branches < 2 && this.allMaxed && this.totalFame >= BRANCH_FAME_COST;
  }

  openBranch() {
    if (this.branches >= 2) return false;
    if (!this.allMaxed) { this.say('ÖNCE MUTFAĞI BİTİR'); return false; }
    if (this.totalFame < BRANCH_FAME_COST) { this.say('HENÜZ YETERİNCE ÜNLÜ DEĞİLSİN'); return false; }
    this.branches = 2;
    // The new house opens bare: no staff, LV1 benches, a little lamb. It
    // will start shouting for help almost immediately, which is the point.
    this.away = {
      name: BRANCH_NAME,
      staff: Object.create(null),
      levels: Object.fromEntries(MATERIALS.map((m) => [m.id, 1])),
      lamb: 10, dirty: 0, timer: AWAY_TICK,
      trouble: null, served: 0, walkouts: 0, dayServed: 0,
    };
    this.pushAlert(`${BRANCH_NAME} AÇILDI - HARİTADAN GİT`, '#74e0b0');
    this.game.sfx.win();
    this.game.camera.shake(6);
    return true;
  }

  /* -------------------------------------------------- the trading day --- */

  /**
   * 21:00. The shutters come down and the books come out — but nobody is
   * paid until the player says so. Settling up is a decision, not a silent
   * deduction: if the till is short you either let someone go or pay what
   * you have and watch somebody walk.
   */
  closeUp() {
    for (const r of this.rivals) r.fame += r.growth * rand(0.6, 1.4);

    this.payrollBill = this.totalPayroll;
    this.payrollDue = this.payrollBill > 0;
    this.payrollCursor = 0;
    this.lastBooks = {
      day: this.day, served: this.dayServed, took: Math.round(this.dayLove),
      wages: this.payrollBill, shortfall: 0, quit: null, paid: false,
    };
    this.closed = true;
    // With no staff there is nothing to settle; go straight to the books.
    this.shopOpen = !this.payrollDue;
    this.shopTab = 1;
    this.shopCursor = 0;
    this.game.sfx.win();
    SaveGame.saveAct2(this.game);
  }

  /* ---------------------------------------------------------- the payroll */

  /** Settle in full. */
  payWages() {
    if (this.love < this.payrollBill) return false;
    this.love -= this.payrollBill;
    this.lastBooks.wages = this.payrollBill;
    this.lastBooks.paid = true;
    this.payrollDue = false;
    this.shopOpen = true;
    this.shopTab = 1;
    this.shopCursor = 0;
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                               'MAAŞLAR ÖDENDİ', '#74e0b0'));
    this.game.sfx.win();
    return true;
  }

  /** Hand over everything in the till and take the consequences. */
  payWhatYouCan() {
    const short = this.payrollBill - this.love;
    if (short <= 0) return this.payWages();
    this.lastBooks.wages = Math.round(this.love);
    this.lastBooks.shortfall = Math.round(short);
    this.love = 0;
    // Whatever you could not cover goes in the book against the staff.
    this.addDebt('PERSONEL', short, `${this.day}. GÜN MAAŞI`);

    // Somebody walks, and word gets round the trade. The other house is
    // just as likely to lose them — and you find out by message.
    const awayRoles = this.away
      ? STAFF.filter((w) => (this.away.staff[w.id] || 0) > 0) : [];
    const lines = this.wageLines;
    if (awayRoles.length && (Math.random() < 0.5 || !lines.length)) {
      const r = awayRoles[awayRoles.length - 1];
      this.away.staff[r.id]--;
      this.lastBooks.quit = `${r.name} (${this.away.name})`;
      this.pushAlert(`${this.away.name} ŞUBESİNDEN BİR ${r.name} AYRILDI`, '#e8604f', 'QUIT');
    } else if (lines.length) {
      const l = lines[lines.length - 1];
      this._removeWorker(l.def);
      this.lastBooks.quit = l.def.name;
    }
    this.fame = Math.max(0, this.fame - 6);
    this.lastBooks.paid = true;
    this.payrollDue = false;
    this.shopOpen = true;
    this.shopTab = 1;
    this.shopCursor = 0;
    this.game.sfx.hurt();
    this.game.camera.shake(5);
    return true;
  }

  /** Let one of a trade go, before the wages are counted. */
  letGo(def) {
    if (this.count(def.id) <= 0) return false;
    this._removeWorker(def);
    this.payrollBill = this.totalPayroll;
    this.payrollDue = this.payrollBill > 0;
    if (!this.payrollDue) {
      // Cut the bill to nothing: there is no longer anything to settle.
      this.lastBooks.wages = 0;
      this.lastBooks.paid = true;
      this.shopOpen = true;
      this.shopTab = 1;
    }
    this.fame = Math.max(0, this.fame - 2);   // a reputation for cutting staff
    this.payrollCursor = clamp(this.payrollCursor, 0,
                               Math.max(0, this.wageLines.length - 1));
    this.game.sfx.thud();
    return true;
  }

  _removeWorker(def) {
    this.staff[def.id] = Math.max(0, this.count(def.id) - 1);
    const i = this.workers.findIndex((w) => w.def.id === def.id);
    if (i >= 0) this.workers.splice(i, 1);
  }

  _stepPayroll(input) {
    const lines = this.wageLines;
    const n = Math.max(1, lines.length);
    if (input.hit('jump') || input.hit('up')) {
      this.payrollCursor = (this.payrollCursor + n - 1) % n; this.game.sfx.drop();
    }
    if (input.hit('down')) {
      this.payrollCursor = (this.payrollCursor + 1) % n; this.game.sfx.drop();
    }
    if (this.act(input)) {
      if (this.love >= this.payrollBill) this.payWages();
      else this.payWhatYouCan();
    }
    // SPACE is the interact button in Act 2, so dismissing moved to X.
    if (input.hit('dismiss') && lines[this.payrollCursor]) {
      this.letGo(lines[this.payrollCursor].def);
    }
  }

  /** Shutters up on a new day. */
  openUp() {
    this.day++;
    this.hour = CLOCK.OPEN;
    this.closed = false;
    this.shopOpen = false;
    this.dayServed = 0;
    this.dayLove = 0;
    this.complaints = 0;                // a fresh day, a clean slate
    this.customers = [];
    this.pending = [];
    this.spawnTimer = 3;
    if (this.away) { this.away.dayServed = 0; this.away.walkouts = 0; }
    SaveGame.saveAct2(this.game);
    this.pushAlert('KAYDEDİLDİ', '#74e0b0');
  }

  /* ------------------------------------------------------- the butcher - */

  buyLamb(b) {
    if (this.lamb >= this.lambCap) { this.say('SOĞUK ODA DOLU'); return false; }
    // The kasap knows you. Short of cash he writes it in the book rather
    // than letting the restaurant starve — which is what used to end runs.
    if (this.love < b.cost) {
      const owed = b.cost - this.love;
      this.love = 0;
      this.addDebt('KASAP', owed, `${b.n} KUZU`);
      const had = this.lamb;
      this.lamb = Math.min(this.lambCap, this.lamb + b.n);
      this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                                 `+${this.lamb - had} KUZU (VERESİYE)`, '#f2b53c'));
      this.game.sfx.drop();
      return true;
    }
    this.love -= b.cost;
    const before = this.lamb;
    this.lamb = Math.min(this.lambCap, this.lamb + b.n);
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 16,
                               `+${this.lamb - before} LAMB`, '#f2b53c'));
    this.game.sfx.win();
    return true;
  }

  _stepButcher(input) {
    const n = LAMB_BUNDLES.length;
    if (input.hit('jump') || input.hit('up') || input.hit('left')) {
      this.butcherCursor = (this.butcherCursor + n - 1) % n; this.game.sfx.drop();
    }
    if (input.hit('down') || input.hit('right')) {
      this.butcherCursor = (this.butcherCursor + 1) % n; this.game.sfx.drop();
    }
    if (this.act(input)) this.buyLamb(LAMB_BUNDLES[this.butcherCursor]);
    if (input.hit('pause')) { this.butcherOpen = false; this.game.sfx.drop(); }
  }

  /**
   * The management screen. Three tabs: who works here, what they work with,
   * and who else is out there. A/D switch tab, W/S move, E confirms.
   */
  _stepShop(input) {
    const TABS = 4;
    if (input.hit('left'))  { this.shopTab = (this.shopTab + TABS - 1) % TABS; this.shopCursor = 0; this.game.sfx.drop(); }
    if (input.hit('right')) { this.shopTab = (this.shopTab + 1) % TABS; this.shopCursor = 0; this.game.sfx.drop(); }

    const n = this.shopTab === 0 ? STAFF.length
            : this.shopTab === 1 ? MATERIALS.length
            : this.shopTab === 3 ? Math.max(1, this.debts.length) : 1;
    if (input.hit('jump') || input.hit('up')) {
      this.shopCursor = (this.shopCursor + n - 1) % n; this.game.sfx.drop();
    }
    if (input.hit('down')) {
      this.shopCursor = (this.shopCursor + 1) % n; this.game.sfx.drop();
    }

    if (this.act(input)) {
      if (this.shopTab === 0) this.hire(STAFF[this.shopCursor]);
      else if (this.shopTab === 1) this.upgrade(MATERIALS[this.shopCursor]);
      else if (this.shopTab === 3) this.payDebt(this.shopCursor);
      else if (this.branches >= 2) {
        if (this.travelTo(this.branchIndex === 0 ? 1 : 0)) this.shopOpen = false;
      } else this.openBranch();
    }

    if (input.hit('pause')) {
      // While the shutters are down this is the only way back to work.
      if (this.closed) this.openUp();
      else this.shopOpen = false;
      this.game.sfx.drop();
    }
  }

  /** Reputation milestones grow the menu — the payoff for word of mouth. */
  _checkUnlocks() {
    for (const m of MENU) {
      if (!this.unlocked.has(m.id) && this.totalFame >= m.unlockAt) {
        this.unlocked.add(m.id);
        this.newlyUnlocked = { name: m.name, timer: 3.4 };
        this.game.sfx.win();
      }
    }
  }

  /** Complete one bite-sized goal and hang its sticker on the wall. */
  _checkGoal() {
    const goal = KIDS_GOALS[this.goalIndex];
    if (!goal || goal.value(this) < goal.target) return;
    this.goalIndex++;
    this.stickers++;
    this.love += GOAL_REWARD;
    this.popups.push(new Popup(this.player.body.cx, this.player.body.y - 24,
                               `ROZET! +${GOAL_REWARD} SEVGİ`, '#f2b53c', 1));
    this.pushAlert(`HEDEF TAMAM: ${goal.label}`, '#74e0b0');
    this.game.sfx.win();
    this.game.camera.shake(4);
  }

  /**
   * You no longer "win" by banking fame — fame is the key, and the door is
   * the second branch. Losing is still five bad services in one day.
   */
  _checkEnd() {
    if (this.complaints >= this.maxComplaints &&
        this.game.difficulty !== DIFFICULTY.RELAXED) {
      this.finished = 'lost';
      this.game.onKitchenLost();
    } else if (this.branches >= 2 && this.totalFame >= EMPIRE_FAME) {
      this.finished = 'won';
      this.game.onKitchenWon();
    }
  }

  /* --------------------------------------------------------------- render */

  icon(ctx, id, x, y, scale = 1) {
    const sx = (id % 8) * 16, sy = Math.floor(id / 8) * 16;
    ctx.drawImage(this.game.assets.get('FOOD'), sx, sy, 16, 16,
                  Math.round(x), Math.round(y), 16 * scale, 16 * scale);
  }

  draw(ctx, cam) {
    const g = this.game;
    const font = g.font;

    /* ---- kitchen wall parallax + floor -------------------------------- */
    g._drawParallax(g.assets.get('BG_KITCHEN'), 0.3, 0);
    this.map.draw(ctx, cam);

    /* Earned goal stickers become restaurant decorations, not just numbers. */
    for (let i = 0; i < this.stickers; i++) {
      const sx = 86 + i * 34 - cam.drawX;
      if (sx < -20 || sx > CFG.VIEW_W + 20) continue;
      this.icon(ctx, ICON.STAR, sx, 82 - cam.drawY, 0.85);
      ctx.fillStyle = i % 2 ? '#74e0b0' : '#f2b53c';
      ctx.fillRect(Math.round(sx - 2), Math.round(98 - cam.drawY), 16, 2);
    }

    /* ---- stations ------------------------------------------------------ */
    const sheet = g.assets.get('STATIONS');
    const upSheet = g.assets.get('STATIONS_UP');
    for (const s of this.stations) {
      const locked = s.kind === 'base' && !this.unlocked.has(s.makes);
      ctx.globalAlpha = locked ? 0.32 : 1;
      // Levelled equipment swaps to the 64px art (tier at LV3, again at LV5)
      // and is drawn from the same floor line, so it visibly outgrows the
      // original bench rather than just changing colour.
      const mat = MATERIALS.find((m) => m.station === s.id);
      const lv = mat ? this.levels[mat.id] : 1;
      if (mat && lv >= 3) {
        ctx.drawImage(upSheet, (mat.up + (lv >= 5 ? 1 : 0)) * 64, 0, 64, 64,
                      Math.round(s.cx - 32 - cam.drawX),
                      Math.round(this.floorY - 62 - cam.drawY), 64, 64);
      } else {
        ctx.drawImage(sheet, s.sprite * 48, 0, 48, 48,
                      Math.round(s.x - cam.drawX), Math.round(s.y - cam.drawY), 48, 48);
      }
      ctx.globalAlpha = 1;

      if (s.flash > 0) {
        ctx.globalAlpha = s.flash * 2.4;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(s.x - cam.drawX), Math.round(s.y - cam.drawY), 48, 48);
        ctx.globalAlpha = 1;
      }

      // Name plate under every station. Backed with a dark plate so it
      // stays legible against the checkerboard floor.
      const label = locked ? 'KİLİTLİ' : s.label;
      const lw = font.width(label);
      const lx = Math.round(s.cx - cam.drawX);
      const ly = Math.round(this.floorY - cam.drawY + 3);
      ctx.fillStyle = 'rgba(20,14,24,0.78)';
      ctx.fillRect(lx - lw / 2 - 3, ly - 2, lw + 6, 11);
      font.draw(ctx, label, s.cx - cam.drawX, ly,
                { align: 'center', color: locked ? '#8d8296' : '#f2e6ce' });
      if (mat) {
        for (let k = 0; k < MAX_LEVEL; k++) {
          ctx.fillStyle = k < lv ? (lv >= MAX_LEVEL ? '#74e0b0' : '#f2b53c') : '#4a3a48';
          ctx.fillRect(lx - MAX_LEVEL * 2 + k * 4, ly + 10, 3, 2);
        }
      }
    }

    /* ---- what is on the mangal right now ------------------------------ */
    const grill = this.byId.MANGAL;
    grill.slots.forEach((sk, i) => this._drawCookBar(ctx, cam, grill, sk, i));

    /* ---- the salon tables --------------------------------------------- */
    TABLE_COLS.forEach((c) => {
      ctx.drawImage(sheet, 11 * 48, 0, 48, 48,
                    Math.round(c * CFG.TILE - cam.drawX),
                    Math.round(this.floorY - 46 - cam.drawY), 48, 48);
    });

    /* ---- the payroll, at their posts ---------------------------------- */
    for (const w of this.workers) w.draw(ctx, cam, this.floorY);

    /* ---- diners -------------------------------------------------------- */
    for (const c of this.customers) c.draw(ctx, cam, this.floorY);

    /* ---- plates waiting on the pass shelf ----------------------------- */
    const pass = this.byId.PASS;
    this.shelf.forEach((sk, i) => {
      this.icon(ctx, sk.icon, pass.cx - 22 + i * 14 - cam.drawX,
                pass.y + 18 - cam.drawY, 0.85);
    });

    /* ---- the wash-up pile at the sink --------------------------------- */
    const sink = this.byId.SINK;
    for (let i = 0; i < Math.min(this.dirty, 6); i++) {
      ctx.fillStyle = i % 2 ? '#ded8cc' : '#c8c1b4';
      ctx.fillRect(Math.round(sink.cx - 20 - cam.drawX),
                   Math.round(sink.y + 20 - i * 3 - cam.drawY), 13, 2);
    }
    if (this.washProgress > 0) {
      const w = 24;
      const px = Math.round(sink.cx - w / 2 - cam.drawX);
      const py = Math.round(sink.y - 6 - cam.drawY);
      ctx.fillStyle = '#1b1220'; ctx.fillRect(px - 1, py - 1, w + 2, 5);
      ctx.fillStyle = '#9cd8f0';
      ctx.fillRect(px, py, Math.round(w * (this.washProgress / this.washTime)), 3);
    }

    /* ---- the chef ------------------------------------------------------ */
    this.player.draw(ctx, cam, g.scratch);
    if (this.carried) this._drawCarried(ctx, cam);

    /* ---- a slim patience pip over each diner; the full ticket lives on
           the HUD rail, where three of them can never overlap ----------- */
    const head = this.front;
    for (const c of this.customers) {
      if (c.state !== CSTATE.WAIT) continue;
      this._drawPatiencePip(ctx, cam, c, c === head);
      if (c.table !== null) this._drawSeatTicket(ctx, cam, c);
    }

    // Daylight wash: dawn is amber, the afternoon is clear, dusk goes blue.
    // Drawn over the world but under the HUD so the readouts stay legible.
    const tint = this._dayTint();
    if (tint.a > 0.01) {
      ctx.globalAlpha = tint.a;
      ctx.fillStyle = tint.c;
      ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
      ctx.globalAlpha = 1;
    }

    for (const p of g.particles) p.draw(ctx, cam);
    for (const p of this.popups) p.draw(ctx, cam, font);

    /* ---- station prompt ------------------------------------------------ */
    const near = this.stationUnder(this.player.body);
    if (near && !this.finished) {
      const label = this._promptFor(near);
      if (label) {
        font.draw(ctx, label, near.cx - cam.drawX, this.floorY - cam.drawY - 62,
                  { align: 'center', color: '#ffffff', shadow: '#1b1220' });
      }
    }
  }

  /** Colour wash for the current hour. */
  _dayTint() {
    const h = this.hour;
    if (h < 7) return { c: '#ff9a3c', a: 0.30 * (1 - (h - CLOCK.OPEN) / 2) };
    if (h < 17) return { c: '#ffffff', a: 0 };
    if (h < 19) return { c: '#ffb45a', a: 0.16 * ((h - 17) / 2) };
    return { c: '#2f3f7a', a: 0.16 + 0.30 * clamp((h - 19) / 2, 0, 1) };
  }

  _promptFor(s) {
    const touch = this.game.input.touchMode;
    const tap = touch ? '' : 'SPACE: ';
    switch (s.kind) {
      case 'base':
        if (!this.unlocked.has(s.makes)) return null;
        return this.carried ? null : `${tap}AL`;
      case 'season': return this.carried && this.carried.raw ? `${tap}BAHARATLA` : null;
      case 'grill':
        if (this.carried && this.carried.raw && s.slots.length < this.grillCapacity) return `${tap}MANGALA KOY`;
        if (!this.carried && s.slots.length) return `${tap}MANGALDAN AL`;
        return null;
      case 'pass':
        if (this.carried && this.front) return `${tap}SERVİS ET`;
        if (!this.carried && this.shelf.length) return `${tap}TABAĞI AL`;
        return null;
      case 'shop': return touch ? 'DÜKKÂNI AÇ' : 'SPACE: PERSONEL, EKİPMAN, HARİTA';
      case 'door':
        return this.carried ? null
             : this.lamb <= 0 ? `${tap}KASABA GİT!` : `${tap}KASABA GİT`;
      case 'sink': return this.dirty > 0 && !this.carried
        ? (touch ? 'BULAŞIK YIKA DÜĞMESİNİ BASILI TUT' : 'SPACE BASILI TUT: BULAŞIK') : null;
    }
    return null;
  }

  /** One short verb for the large phone button, based on current context. */
  contextActionLabel() {
    if (this.payrollDue) return 'MAAŞ ÖDE';
    if (this.butcherOpen) return 'SATIN AL';
    if (this.shopOpen) return this.shopTab === 0 ? 'İŞE AL'
                               : this.shopTab === 1 ? 'YÜKSELT'
                               : this.shopTab === 2 ? 'ŞUBE'
                               : 'BORÇ ÖDE';
    if (this.carried && this.seatedNear(this.player.body.cx)) return 'SERVİS ET';
    const s = this.stationUnder(this.player.body);
    if (!s) return this.carried ? 'TAŞI' : 'KULLAN';
    if (s.kind === 'base') return 'AL';
    if (s.kind === 'season') return 'BAHARATLA';
    if (s.kind === 'grill') return this.carried ? 'MANGALA KOY' : 'MANGALDAN AL';
    if (s.kind === 'pass') return this.carried ? 'SERVİS ET' : 'TABAĞI AL';
    if (s.kind === 'sink') return 'BULAŞIK YIKA';
    if (s.kind === 'door') return 'KASABA GİT';
    if (s.kind === 'shop') return 'DÜKKÂNI AÇ';
    return 'KULLAN';
  }

  /** The cook meter, with the perfect window marked in green. */
  _drawCookBar(ctx, cam, grill, sk, i) {
    const K = CFG.K;
    const w = 44, h = 6;
    const x = Math.round(grill.cx - w / 2 - cam.drawX);
    // Sits well clear of the chef's carried-plate bubble (body.y - 22),
    // which shares this airspace whenever he is standing at the mangal.
    // A second grate (DISHWASHER) stacks its meter above the first.
    const y = Math.round(grill.y - 34 - cam.drawY - i * 11);

    ctx.fillStyle = '#1b1220';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#4a3a48';
    ctx.fillRect(x, y, w, h);

    // the perfect window
    const a = Math.round(w * (K.RAW_MAX / K.BURN_OUT));
    const b = Math.round(w * (K.PERFECT_MAX / K.BURN_OUT));
    ctx.fillStyle = '#2f7a5c';
    ctx.fillRect(x + a, y, b - a, h);

    // fill + needle
    const p = Math.round(w * clamp(sk.cook / K.BURN_OUT, 0, 1));
    const st = sk.cookState;
    ctx.fillStyle = st === 'PERFECT' ? '#74e0b0' : st === 'BURNT' ? '#e8604f' : '#f2b53c';
    ctx.fillRect(x, y, p, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + Math.min(p, w - 1), y - 1, 1, h + 2);

    // the item riding the grate
    this.icon(ctx, sk.icon,
              grill.cx - 8 - cam.drawX + (i === 0 ? -7 : 7),
              grill.y + 10 - cam.drawY);
  }

  /** A small bubble over the chef showing exactly what he is holding. */
  _drawCarried(ctx, cam) {
    const b = this.player.body;
    const sk = this.carried;
    const n = 1 + sk.seasonings.size;
    const w = n * 11 + 6;
    const x = Math.round(b.cx - w / 2 - cam.drawX);
    const y = Math.round(b.y - 22 - cam.drawY);

    ctx.fillStyle = 'rgba(20,14,24,0.82)';
    ctx.fillRect(x, y, w, 15);
    ctx.fillStyle = sk.cookState === 'PERFECT' ? '#74e0b0'
                  : sk.cookState === 'BURNT' ? '#e8604f' : '#e8ba5c';
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + 14, w, 1);

    let ix = x + 3;
    this.icon(ctx, sk.icon, ix - 2, y - 1, 0.75);
    ix += 11;
    for (const s of SEASONINGS) {
      if (!sk.seasonings.has(s)) continue;
      this.icon(ctx, SEASONING_ICON[s], ix - 2, y - 1, 0.75);
      ix += 11;
    }
  }

  /** Over each diner: just how long they will wait, plus a queue marker. */
  _drawPatiencePip(ctx, cam, c, isFront) {
    const w = 34;
    const x = Math.round(c.x - w / 2 - cam.drawX);
    const y = Math.round(this.floorY - 56 - cam.drawY);
    const t = clamp(c.patience / c.maxPatience, 0, 1);

    ctx.fillStyle = 'rgba(20,14,24,0.8)';
    ctx.fillRect(x - 1, y - 1, w + 2, 8);
    ctx.fillStyle = t > 0.5 ? '#5cba86' : t > 0.22 ? '#f2b53c' : '#e8604f';
    ctx.fillRect(x, y, Math.round(w * t), 6);

    // A face icon makes urgency understandable before a child can read it.
    if (t < 0.3) {
      this.icon(ctx, ICON.ANGRY, x + w - 7, y - 8, 0.55);
    } else if (t > 0.7) {
      this.icon(ctx, ICON.HEART, x + w - 7, y - 8, 0.55);
    } else {
      this.icon(ctx, ICON.CLOCK, x + w - 7, y - 8, 0.55);
    }

    // The head of the queue is the one the pass will serve — call it out.
    if (isFront) {
      const by = y - 7 + Math.round(Math.sin(this.game.time * 6));
      ctx.fillStyle = '#f2b53c';
      ctx.fillRect(Math.round(c.x - cam.drawX) - 3, by, 6, 2);
      ctx.fillRect(Math.round(c.x - cam.drawX) - 2, by + 2, 4, 2);
      ctx.fillRect(Math.round(c.x - cam.drawX) - 1, by + 4, 2, 2);
    }
  }

  /** A compact ticket floating over a seated diner's table. */
  _drawSeatTicket(ctx, cam, c) {
    const n = 1 + c.order.seasonings.length;
    const w = n * 11 + 6;
    const x = Math.round(c.x - w / 2 - cam.drawX);
    const y = Math.round(this.floorY - 76 - cam.drawY);

    ctx.fillStyle = 'rgba(250,246,238,0.95)';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = '#8d7f70';
    ctx.fillRect(x, y + 13, w, 1);
    ctx.fillRect(Math.round(c.x - cam.drawX) - 2, y + 14, 4, 3);

    let ix = x + 3;
    this.icon(ctx, MENU_BY_ID[c.order.item].icon, ix - 2, y - 1, 0.75);
    ix += 11;
    for (const sn of c.order.seasonings) {
      this.icon(ctx, SEASONING_ICON[sn], ix - 2, y - 1, 0.75);
      ix += 11;
    }
  }

  /**
   * The ticket rail. Screen-space, ordered by queue position, so three
   * simultaneous orders are always legible no matter how the diners bunch
   * up at the pass. The leftmost is the one the pass will serve next.
   */
  _drawRail(ctx) {
    const f = this.game.font;

    // EVERY waiting order, counter and table alike. Seated diners sit 300px
    // down the salon, so while you are at the mangal their tickets are off
    // camera — leaving them out of the rail meant cooking blind for half
    // the room. Capped at five with an overflow tag so it cannot spill.
    const counter = this.customers
      .filter((c) => c.state === CSTATE.WAIT && c.table === null)
      .sort((a, b) => a.slot - b.slot);
    const head = counter[0] || null;
    // The head of the counter queue always shows — it is the one the pass
    // serves. Everything else is ranked by how close it is to walking out,
    // so a full counter can never bury the tables behind an overflow tag.
    const rest = this.customers
      .filter((c) => c.state === CSTATE.WAIT && c !== head)
      .sort((a, b) => (a.patience / a.maxPatience) - (b.patience / b.maxPatience));
    const all = (head ? [head] : []).concat(rest);
    if (!all.length) return;

    const MAX = 5, TW = 58, GAP = 4, H = 30;
    const shown = all.slice(0, MAX);
    const total = shown.length * TW + (shown.length - 1) * GAP;
    let x = Math.round((CFG.VIEW_W - total) / 2);
    const y = 32;

    shown.forEach((c, i) => {
      const seated = c.table !== null;
      const isHead = c === head;

      ctx.fillStyle = isHead ? 'rgba(250,246,238,0.96)'
                     : seated ? 'rgba(232,226,242,0.90)'
                              : 'rgba(228,222,212,0.86)';
      ctx.fillRect(x, y, TW, H);
      ctx.fillStyle = isHead ? '#f2b53c' : seated ? '#8f86b8' : '#8d7f70';
      ctx.fillRect(x, y, TW, 1);
      ctx.fillRect(x, y + H - 1, TW, 1);
      ctx.fillRect(x, y, 1, H);
      ctx.fillRect(x + TW - 1, y, 1, H);

      // dish + the exact seasonings the ticket calls for
      let ix = x + 3;
      this.icon(ctx, MENU_BY_ID[c.order.item].icon, ix, y + 1, 0.75);
      ix += 14;
      ctx.fillStyle = '#b9ad9c';
      ctx.fillRect(ix - 2, y + 3, 1, 8);
      for (const sn of c.order.seasonings) {
        this.icon(ctx, SEASONING_ICON[sn], ix, y + 1, 0.75);
        ix += 12;
      }

      // WHERE it is waiting — inside the ticket, so nothing can collide
      f.draw(ctx, seated ? `MASA ${c.table + 1}` : isHead ? 'SIRADAKİ' : 'SIRA',
             x + 3, y + 14,
             { color: isHead ? '#a06a12' : seated ? '#4b4270' : '#6d6376' });

      // patience
      const t = clamp(c.patience / c.maxPatience, 0, 1);
      ctx.fillStyle = '#c9bda8';
      ctx.fillRect(x + 3, y + 23, TW - 6, 4);
      ctx.fillStyle = t > 0.5 ? '#5cba86' : t > 0.22 ? '#f2b53c' : '#e8604f';
      ctx.fillRect(x + 3, y + 23, Math.round((TW - 6) * t), 4);

      if (t < 0.3 && Math.sin(this.game.time * 8) > -0.2) {
        ctx.fillStyle = '#e8604f';
        ctx.fillRect(x, y, TW, 2);
        this.icon(ctx, ICON.ANGRY, x + TW - 13, y + 10, 0.65);
      }

      x += TW + GAP;
    });

    if (all.length > MAX) {
      f.draw(ctx, `+${all.length - MAX}`, x + 4, y + 11,
             { color: '#c9bda8', shadow: '#1b1220' });
    }
  }

  /**
   * The hiring board. Drawn over a frozen room, so the player can read the
   * job descriptions without the queue burning down behind them.
   */
  /**
   * MAAS GUNU — the wage slip. Shown the moment the shutters come down and
   * nobody gets paid until the player settles it.
   */
  _drawPayroll(ctx) {
    const f = this.game.font;
    const touch = this.game.input.touchMode;
    const sheet = this.game.assets.get('STAFF');
    const b = this.lastBooks;
    const lines = this.wageLines;
    const bill = this.payrollBill;
    const short = bill - this.love;

    ctx.fillStyle = 'rgba(14,10,18,0.985)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    f.draw(ctx, 'MAAŞ GÜNÜ', CFG.VIEW_W / 2, 8,
           { align: 'center', scale: 2, color: '#f2b53c', shadow: '#7a3a10' });
    f.draw(ctx, `${b.day}. GÜN KAPANDI - ${b.served} TABAK, KASA ${b.took}`,
           CFG.VIEW_W / 2, 26, { align: 'center', color: '#c9bda8' });

    // ---- the wage slip -------------------------------------------------
    const TOP = 40, ROW_H = 20;
    lines.forEach((l, i) => {
      const y = TOP + i * ROW_H;
      const sel = i === this.payrollCursor;
      ctx.fillStyle = sel ? 'rgba(70,58,78,0.96)' : 'rgba(34,26,40,0.9)';
      ctx.fillRect(30, y, CFG.VIEW_W - 60, ROW_H - 3);
      ctx.fillStyle = sel ? '#f2b53c' : '#4a3a48';
      ctx.fillRect(30, y, CFG.VIEW_W - 60, 1);

      // Scaled to the row height so a long slip does not cascade portraits
      // over one another.
      ctx.drawImage(sheet, 4 * 48, l.def.variant * 48, 48, 48, 33, y - 4, 22, 22);
      f.draw(ctx, l.def.name, 60, y + 5, { color: '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, `x${l.n}`, 60 + f.width(l.def.name) + 8, y + 5, { color: '#8fd4ff' });
      f.draw(ctx, `TANESİ ${l.each}`, 170, y + 5, { color: '#8d8296' });
      this.icon(ctx, ICON.HEART, CFG.VIEW_W - 66, y + 1, 0.7);
      f.draw(ctx, String(l.total), CFG.VIEW_W - 38, y + 5,
             { align: 'right', color: '#ff9db4', shadow: '#1b1220' });
    });

    // ---- the total -----------------------------------------------------
    const ty = TOP + lines.length * ROW_H + 6;
    ctx.fillStyle = '#4a3a48';
    ctx.fillRect(30, ty - 4, CFG.VIEW_W - 60, 1);
    f.draw(ctx, 'TOPLAM BORÇ', 34, ty + 2, { color: '#f8e9cf', shadow: '#1b1220' });
    this.icon(ctx, ICON.HEART, CFG.VIEW_W - 66, ty - 2, 0.8);
    f.draw(ctx, String(bill), CFG.VIEW_W - 38, ty + 2,
           { align: 'right', color: '#ff9db4', shadow: '#1b1220' });

    if (this.awayPayroll > 0) {
      f.draw(ctx, `${this.away.name} İÇİN ${this.awayPayroll} DAHİL`, 34, ty + 12,
             { color: '#8fd4ff' });
    }
    f.draw(ctx, 'KASADA', 34, ty + (this.awayPayroll > 0 ? 22 : 13),
           { color: '#8d8296' });
    f.draw(ctx, String(Math.round(this.love)), CFG.VIEW_W - 38,
           ty + (this.awayPayroll > 0 ? 22 : 13),
           { align: 'right', color: short > 0 ? '#e8604f' : '#74e0b0', shadow: '#1b1220' });

    // ---- the decision --------------------------------------------------
    const by = CFG.VIEW_H - 44;
    if (short > 0) {
      f.draw(ctx, `${Math.round(short)} SEVGİ EKSİK`, CFG.VIEW_W / 2, by - 12,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
      f.draw(ctx, touch ? 'MAAŞ ÖDE: ELİNDEKİ ÖDENİR - GERİSİ DEFTERE'
                        : 'SPACE: ELİNDEKİNİ ÖDE - GERİSİ DEFTERE',
             CFG.VIEW_W / 2, by, { align: 'center', color: '#f2b53c' });
      f.draw(ctx, touch ? 'İŞTEN ÇIKAR DÜĞMESİ: SEÇİLEN PERSONEL'
                        : 'X: SEÇİLENİ İŞTEN ÇIKAR',
             CFG.VIEW_W / 2, by + 10, { align: 'center', color: '#c9bda8' });
    } else {
      f.draw(ctx, touch ? 'MAAŞ ÖDE DÜĞMESİNE DOKUN' : 'SPACE: MAAŞLARI ÖDE', CFG.VIEW_W / 2, by,
             { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
      f.draw(ctx, touch ? 'İŞTEN ÇIKAR DÜĞMESİ: SEÇİLEN PERSONEL'
                        : 'X: SEÇİLENİ İŞTEN ÇIKAR',
             CFG.VIEW_W / 2, by + 18, { align: 'center', color: '#8d8296' });
    }
    f.draw(ctx, touch ? 'YUKARI AŞAĞI İLE SEÇ' : 'W S SEÇ', CFG.VIEW_W / 2, CFG.VIEW_H - 10,
           { align: 'center', color: '#6d6376' });

    if (this.hintTimer > 0) {
      f.draw(ctx, this.hint, CFG.VIEW_W / 2, CFG.VIEW_H - 22,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
    }
  }

  /**
   * Toasts from the branch you are not standing in, plus a standing badge
   * while whatever went wrong over there is still wrong.
   */
  _drawAlerts(ctx) {
    const f = this.game.font;
    let y = 66;

    for (const a of this.alerts) {
      const w = f.width(a.text) + 14;
      const x = Math.round((CFG.VIEW_W - w) / 2);
      ctx.globalAlpha = clamp(a.life / 1.2, 0, 1);
      ctx.fillStyle = 'rgba(18,12,22,0.92)';
      ctx.fillRect(x, y, w, 13);
      ctx.fillStyle = a.color;
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + 12, w, 1);
      ctx.fillRect(x, y, 2, 13);
      f.draw(ctx, a.text, CFG.VIEW_W / 2, y + 4,
             { align: 'center', color: a.color, shadow: '#1b1220' });
      ctx.globalAlpha = 1;
      y += 16;
    }

    // Standing reminder: the other house is still in trouble.
    if (this.away && this.away.trouble) {
      const t = `! ${this.away.name}: ${this._troubleText(this.away.trouble)}`;
      const blink = Math.sin(this.game.time * 4) > -0.5;
      f.draw(ctx, t, CFG.VIEW_W / 2, CFG.VIEW_H - 22,
             { align: 'center', color: blink ? '#e8604f' : '#8d5450', shadow: '#1b1220' });
    }
  }

  _troubleText(t) {
    return {
      NOSTAFF: 'ORADA KİMSE ÇALIŞMIYOR',
      NOLAMB: 'KUZULARI BİTMİŞ',
      PLATES: 'TEMİZ TABAKLARI YOK',
      WALKOUTS: 'MÜŞTERİLER ÇEKİP GİDİYOR',
      QUIT: 'BİRİ İŞTEN AYRILDI',
    }[t] || 'BİR SORUN VAR';
  }

  /**
   * The butcher's yard, through the back door behind the wash-up. The only
   * way to restock lamb mid-service, and it costs you half an hour.
   */
  _drawButcher(ctx) {
    const f = this.game.font;
    const touch = this.game.input.touchMode;
    const staff = this.game.assets.get('STAFF');

    ctx.fillStyle = 'rgba(20,14,12,0.94)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    // a scrap of yard: brick, a rail of carcasses, daylight
    ctx.fillStyle = '#6a4438';
    ctx.fillRect(0, 0, CFG.VIEW_W, 96);
    for (let r = 0; r < 96; r += 12) {
      ctx.fillStyle = '#5a3a30';
      ctx.fillRect(0, r, CFG.VIEW_W, 1);
      for (let c = (r / 12) % 2 ? 0 : 20; c < CFG.VIEW_W; c += 40) ctx.fillRect(c, r, 1, 12);
    }
    ctx.fillStyle = '#8a8f9c';
    ctx.fillRect(0, 22, CFG.VIEW_W, 3);
    for (let hx = 26; hx < CFG.VIEW_W; hx += 58) {
      ctx.fillStyle = '#8a8f9c'; ctx.fillRect(hx, 25, 2, 7);
      ctx.fillStyle = '#e28282'; ctx.fillRect(hx - 7, 32, 16, 26);
      ctx.fillStyle = '#bc5c60'; ctx.fillRect(hx - 7, 48, 16, 10);
      ctx.fillStyle = '#f2a8a8'; ctx.fillRect(hx - 5, 34, 5, 8);
    }

    f.draw(ctx, 'KASAP', CFG.VIEW_W / 2, 62,
           { align: 'center', scale: 3, color: '#f2b53c', shadow: '#5a2410' });
    f.draw(ctx, 'BULAŞIĞIN ARKASINDAKİ AVLU', CFG.VIEW_W / 2, 84,
           { align: 'center', color: '#e0c2a8' });

    // the butcher himself, minding the stall
    ctx.drawImage(staff, 4 * 48, 7 * 48, 48, 48, 16, 62, 48, 48);

    // stock + wallet
    this.icon(ctx, ICON.LAMB, CFG.VIEW_W / 2 - 62, 96, 0.8);
    f.draw(ctx, `SOĞUK ODA ${this.lamb}/${this.lambCap}`, CFG.VIEW_W / 2 - 46, 100,
           { color: this.lamb > 0 ? '#f8e9cf' : '#e8604f', shadow: '#1b1220' });
    this.icon(ctx, ICON.HEART, CFG.VIEW_W / 2 + 44, 96, 0.8);
    f.draw(ctx, String(Math.round(this.love)), CFG.VIEW_W / 2 + 60, 100,
           { color: '#ff9db4', shadow: '#1b1220' });

    const TOP = 118, ROW_H = 34;
    LAMB_BUNDLES.forEach((b, i) => {
      const y = TOP + i * ROW_H;
      const sel = i === this.butcherCursor;
      const afford = this.love >= b.cost && this.lamb < this.lambCap;

      ctx.fillStyle = sel ? 'rgba(78,58,48,0.96)' : 'rgba(44,30,26,0.9)';
      ctx.fillRect(40, y, CFG.VIEW_W - 80, ROW_H - 4);
      ctx.fillStyle = sel ? '#f2b53c' : '#5a3a30';
      ctx.fillRect(40, y, CFG.VIEW_W - 80, 1);
      ctx.fillRect(40, y + ROW_H - 5, CFG.VIEW_W - 80, 1);

      for (let k = 0; k < Math.min(4, 1 + Math.floor(b.n / 12)); k++) {
        this.icon(ctx, ICON.LAMB, 46 + k * 11, y + 6, 0.75);
      }
      f.draw(ctx, `${b.n} KUZU`, 96, y + 5, { color: '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, `TANESİ ${(b.cost / b.n).toFixed(1)} SEVGİ`, 96, y + 16,
             { color: '#c9bda8', shadow: '#1b1220' });
      this.icon(ctx, ICON.HEART, CFG.VIEW_W - 84, y + 8, 0.7);
      f.draw(ctx, String(b.cost), CFG.VIEW_W - 48, y + 13,
             { align: 'right', color: afford ? '#ff9db4' : '#7a5560', shadow: '#1b1220' });
    });

    f.draw(ctx, `YOL ${Math.round(BUTCHER_TRIP_HOURS * 60)} DAKİKA SÜRDÜ - SAAT ${clockLabel(this.hour)}`,
           CFG.VIEW_W / 2, CFG.VIEW_H - 24,
           { align: 'center', color: '#e8a24a' });
    f.draw(ctx, touch ? 'YUKARI AŞAĞI SEÇ - SATIN AL - DURAKLAT: DÖN'
                      : 'W S SEÇ     SPACE AL     P MUTFAĞA DÖN',
           CFG.VIEW_W / 2, CFG.VIEW_H - 12, { align: 'center', color: '#8d8296' });

    if (this.hintTimer > 0) {
      f.draw(ctx, this.hint, CFG.VIEW_W / 2, CFG.VIEW_H - 36,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
    }
  }

  /* ------------------------------------------------ the management screen */

  _drawShop(ctx) {
    const f = this.game.font;
    const touch = this.game.input.touchMode;
    ctx.fillStyle = 'rgba(16,12,20,0.93)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    // ---- end-of-day books, when the shutters just came down -----------
    if (this.closed && this.lastBooks) this._drawBooks(ctx);

    const title = this.closed ? `${this.lastBooks ? this.lastBooks.day : this.day}. GÜN - KASA KAPANDI`
                              : 'CAN USTA';
    f.draw(ctx, title, CFG.VIEW_W / 2, this.closed ? 76 : 8,
           { align: 'center', scale: 2, color: '#f2b53c', shadow: '#7a3a10' });

    // ---- tab strip ------------------------------------------------------
    const TABS = ['PERSONEL', 'EKİPMAN', 'HARİTA', 'BORÇ'];
    const ty = this.closed ? 94 : 24;
    let tx = 30;
    TABS.forEach((t, i) => {
      const on = i === this.shopTab;
      const w = f.width(t) + 12;
      ctx.fillStyle = on ? '#f2b53c' : 'rgba(60,50,68,0.9)';
      ctx.fillRect(tx, ty, w, 13);
      f.draw(ctx, t, tx + w / 2, ty + 3,
             { align: 'center', color: on ? '#2a1c30' : '#8d8296' });
      tx += w + 6;
    });
    // wallet + fame, always in view
    this.icon(ctx, ICON.HEART, CFG.VIEW_W - 108, ty - 2, 0.8);
    f.draw(ctx, String(Math.round(this.love)), CFG.VIEW_W - 92, ty + 3,
           { color: '#ff9db4', shadow: '#1b1220' });
    this.icon(ctx, ICON.STAR, CFG.VIEW_W - 60, ty - 2, 0.8);
    f.draw(ctx, String(this.totalFame), CFG.VIEW_W - 44, ty + 3,
           { color: '#f2e6ce', shadow: '#1b1220' });

    const top = ty + 18;
    if (this.shopTab === 0) this._drawStaffTab(ctx, top);
    else if (this.shopTab === 1) this._drawUpgradeTab(ctx, top);
    else if (this.shopTab === 3) this._drawDebtTab(ctx, top);
    else this._drawMapTab(ctx, top);

    f.draw(ctx, touch
             ? (this.closed ? `SOL SAĞ SEKME - YUKARI AŞAĞI SEÇ - DURAKLAT: ${this.day + 1}. GÜN`
                            : 'SOL SAĞ SEKME - YUKARI AŞAĞI SEÇ - DURAKLAT: DÖN')
             : (this.closed ? `A D SEKME   W S SEÇ   SPACE AL   P: ${this.day + 1}. GÜNÜ AÇ`
                            : 'A D SEKME   W S SEÇ   SPACE AL   P TEZGAHA DÖN'),
           CFG.VIEW_W / 2, CFG.VIEW_H - 10,
           { align: 'center', color: '#8d8296' });

    if (this.hintTimer > 0) {
      f.draw(ctx, this.hint, CFG.VIEW_W / 2, CFG.VIEW_H - 22,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
    }
  }

  /** The day's takings, wages and any casualty. */
  _drawBooks(ctx) {
    const f = this.game.font;
    const b = this.lastBooks;
    let y = 10;
    const row = (label, val, col) => {
      f.draw(ctx, label, 40, y, { color: '#8d8296' });
      f.draw(ctx, val, CFG.VIEW_W - 40, y, { align: 'right', color: col, shadow: '#1b1220' });
      y += 11;
    };
    row('ÇIKAN TABAK', String(b.served), '#f8e9cf');
    row('KASA', `+${b.took} SEVGİ`, '#74e0b0');
    row('MAAŞLAR', `-${b.wages} SEVGİ`, '#ff9db4');
    if (b.shortfall > 0) {
      row('KALAN BORÇ', `${b.shortfall} - ${b.quit || 'KİMSE'} AYRILDI`, '#e8604f');
    } else {
      row('BORDRO', 'TAMAMEN ÖDENDİ', '#74e0b0');
    }
  }

  _drawStaffTab(ctx, top) {
    const f = this.game.font;
    const sheet = this.game.assets.get('STAFF');
    const ROW_H = 30, VIEW = Math.min(5, Math.floor((CFG.VIEW_H - top - 28) / 30));
    const start = clamp(this.shopCursor - 2, 0, Math.max(0, STAFF.length - VIEW));

    f.draw(ctx, `MUTFAK ${this.headcount}/${this.headcountCap} KİŞİLİK - BÜYÜTÜNCE ARTAR`,
           CFG.VIEW_W / 2, top - 12,
           { align: 'center', color: this.headcount >= this.headcountCap ? '#e8604f' : '#8d8296' });

    STAFF.slice(start, start + VIEW).forEach((w, si) => {
      const i = start + si, y = top + si * ROW_H;
      const sel = i === this.shopCursor;
      const n = this.count(w.id);
      const price = this.hireCost(w);
      const afford = this.love >= price && this.headcount < this.headcountCap && n < 3;

      ctx.fillStyle = sel ? 'rgba(70,58,78,0.96)' : 'rgba(38,30,44,0.86)';
      ctx.fillRect(24, y, CFG.VIEW_W - 48, ROW_H - 3);
      ctx.fillStyle = sel ? '#f2b53c' : n ? '#4f7a63' : '#4a3a48';
      ctx.fillRect(24, y, CFG.VIEW_W - 48, 1);
      ctx.fillRect(24, y + ROW_H - 4, CFG.VIEW_W - 48, 1);

      ctx.drawImage(sheet, 4 * 48, w.variant * 48, 48, 48, 22, y - 15, 48, 48);
      f.draw(ctx, w.name, 68, y + 4, { color: n ? '#74e0b0' : '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, w.role, 68 + f.width(w.name) + 7, y + 4, { color: '#8d8296' });
      f.draw(ctx, w.blurb[0], 68, y + 15, { color: '#c9bda8', shadow: '#1b1220' });
      f.draw(ctx, `GÜNLÜK ${this.wageOf(w)}`, CFG.VIEW_W - 78, y + 20,
             { align: 'right', color: '#7a6f80' });

      if (n) {
        f.draw(ctx, `x${n}`, CFG.VIEW_W - 78, y + 9,
               { align: 'right', color: '#74e0b0', shadow: '#1b1220' });
      }
      if (n >= 3) {
        f.draw(ctx, 'DOLU', CFG.VIEW_W - 30, y + 9,
               { align: 'right', color: '#8d8296' });
      } else {
        this.icon(ctx, ICON.HEART, CFG.VIEW_W - 54, y + 4, 0.7);
        f.draw(ctx, String(price), CFG.VIEW_W - 30, y + 9,
               { align: 'right', color: afford ? '#ff9db4' : '#7a5560', shadow: '#1b1220' });
      }
    });
    f.draw(ctx, `${this.shopCursor + 1}/${STAFF.length}`, CFG.VIEW_W - 26, top - 12,
           { align: 'right', color: '#6d6376' });
  }

  _drawUpgradeTab(ctx, top) {
    const f = this.game.font;
    const sheet = this.game.assets.get('STATIONS_UP');
    const base = this.game.assets.get('STATIONS');
    const ROW_H = 34;

    MATERIALS.forEach((m, i) => {
      const y = top + i * ROW_H;
      const sel = i === this.shopCursor;
      const lv = this.levels[m.id];
      const maxed = lv >= MAX_LEVEL;
      const price = upgradeCost(lv);
      const afford = !maxed && this.love >= price;

      ctx.fillStyle = sel ? 'rgba(70,58,78,0.96)' : 'rgba(38,30,44,0.86)';
      ctx.fillRect(24, y, CFG.VIEW_W - 48, ROW_H - 3);
      ctx.fillStyle = sel ? '#f2b53c' : maxed ? '#4f7a63' : '#4a3a48';
      ctx.fillRect(24, y, CFG.VIEW_W - 48, 1);
      ctx.fillRect(24, y + ROW_H - 4, CFG.VIEW_W - 48, 1);

      // a thumbnail of what you actually own right now
      if (lv >= 3) {
        ctx.drawImage(sheet, (m.up + (lv >= 5 ? 1 : 0)) * 64, 0, 64, 64, 22, y - 12, 40, 40);
      } else {
        const si = this.byId[m.station].sprite;
        ctx.drawImage(base, si * 48, 0, 48, 48, 26, y - 8, 34, 34);
      }

      f.draw(ctx, m.name, 68, y + 3, { color: '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, `LV${lv}`, 68 + f.width(m.name) + 8, y + 3,
             { color: maxed ? '#74e0b0' : '#8d8296' });
      f.draw(ctx, m.perk, 68, y + 13, { color: '#c9bda8', shadow: '#1b1220' });

      // level pips, clear of the row edge
      for (let k = 0; k < MAX_LEVEL; k++) {
        ctx.fillStyle = k < lv ? (maxed ? '#74e0b0' : '#f2b53c') : '#4a3a48';
        ctx.fillRect(68 + k * 7, y + 23, 5, 3);
      }

      if (maxed) {
        f.draw(ctx, 'SON', CFG.VIEW_W - 30, y + 12,
               { align: 'right', color: '#74e0b0', shadow: '#1b1220' });
      } else {
        this.icon(ctx, ICON.HEART, CFG.VIEW_W - 56, y + 7, 0.7);
        f.draw(ctx, String(price), CFG.VIEW_W - 30, y + 12,
               { align: 'right', color: afford ? '#ff9db4' : '#7a5560', shadow: '#1b1220' });
      }
    });

    const done = this.allMaxed;
    f.draw(ctx, done ? 'TÜM TEZGAHLAR SEVİYE 6 - HARİTA AÇIK'
                     : `EKİPMAN ÜNÜ +${this.equipmentFame}`,
           CFG.VIEW_W / 2, top + MATERIALS.length * ROW_H + 2,
           { align: 'center', color: done ? '#74e0b0' : '#8d8296' });
  }

  /**
   * The map: your house, the branch you are working toward, and the
   * competition — who stay pointedly nameless.
   */
  /**
   * BORÇ DEFTERİ — every IOU, dated, with who it is owed to. The kasap's
   * credit and any wages you could not cover both land here, which is what
   * stops a bad day from being unrecoverable.
   */
  _drawDebtTab(ctx, top) {
    const f = this.game.font;
    if (!this.debts.length) {
      f.draw(ctx, 'DEFTER TEMİZ', CFG.VIEW_W / 2, top + 40,
             { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
      f.draw(ctx, 'KİMSEYE BORCUN YOK', CFG.VIEW_W / 2, top + 62,
             { align: 'center', color: '#8d8296' });
      return;
    }
    const ROW_H = 22, VIEW = Math.min(5, Math.floor((CFG.VIEW_H - top - 40) / ROW_H));
    const start = clamp(this.shopCursor - 2, 0, Math.max(0, this.debts.length - VIEW));

    this.debts.slice(start, start + VIEW).forEach((d, si) => {
      const i = start + si, y = top + si * ROW_H;
      const sel = i === this.shopCursor;
      const afford = this.love >= d.amount;
      ctx.fillStyle = sel ? 'rgba(70,58,78,0.96)' : 'rgba(38,30,44,0.86)';
      ctx.fillRect(26, y, CFG.VIEW_W - 52, ROW_H - 3);
      ctx.fillStyle = sel ? '#f2b53c' : '#4a3a48';
      ctx.fillRect(26, y, CFG.VIEW_W - 52, 1);

      f.draw(ctx, `${d.day}. GÜN`, 32, y + 3, { color: '#8d8296' });
      f.draw(ctx, d.who, 74, y + 3, { color: '#f8e9cf', shadow: '#1b1220' });
      f.draw(ctx, d.note, 74, y + 12, { color: '#c9bda8' });
      this.icon(ctx, ICON.HEART, CFG.VIEW_W - 60, y + 2, 0.7);
      f.draw(ctx, String(d.amount), CFG.VIEW_W - 32, y + 7,
             { align: 'right', color: afford ? '#ff9db4' : '#7a5560', shadow: '#1b1220' });
    });

    const ty = top + VIEW * ROW_H + 4;
    ctx.fillStyle = '#4a3a48';
    ctx.fillRect(26, ty, CFG.VIEW_W - 52, 1);
    f.draw(ctx, `TOPLAM BORÇ ${this.totalDebt}`, 32, ty + 5,
           { color: '#e8604f', shadow: '#1b1220' });
    f.draw(ctx, this.game.input.touchMode ? 'BORÇ ÖDE DÜĞMESİ' : 'SPACE: SEÇİLİ BORCU ÖDE', CFG.VIEW_W - 32, ty + 5,
           { align: 'right', color: '#8d8296' });
  }

  _drawMapTab(ctx, top) {
    const f = this.game.font;
    const X = 30, Y = top + 4, W = CFG.VIEW_W - 60, H = 118;

    // the town
    ctx.fillStyle = '#1d2a24';
    ctx.fillRect(X, Y, W, H);
    ctx.fillStyle = '#26362e';
    for (let bx = X + 6; bx < X + W - 10; bx += 34) {
      for (let by = Y + 6; by < Y + H - 10; by += 30) {
        ctx.fillRect(bx, by, 26, 22);
      }
    }
    ctx.fillStyle = '#3c5145';                     // roads
    for (let bx = X; bx < X + W; bx += 34) ctx.fillRect(bx + 30, Y, 4, H);
    for (let by = Y; by < Y + H; by += 30) ctx.fillRect(X, by + 26, W, 4);
    ctx.fillStyle = '#0f1712';
    ctx.fillRect(X, Y, W, 1); ctx.fillRect(X, Y + H - 1, W, 1);
    ctx.fillRect(X, Y, 1, H); ctx.fillRect(X + W - 1, Y, 1, H);

    const pin = (px, py, col, label, sub) => {
      const ix = Math.round(X + px * W), iy = Math.round(Y + py * H);
      ctx.fillStyle = col;
      ctx.fillRect(ix - 2, iy - 6, 4, 7);
      ctx.fillRect(ix - 4, iy - 8, 8, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(ix - 2, iy + 1, 5, 2);
      f.draw(ctx, label, ix, iy + 4, { align: 'center', color: col, shadow: '#0d1410' });
      if (sub) f.draw(ctx, sub, ix, iy + 12, { align: 'center', color: '#8d8296' });
    };

    // rivals, brightest = biggest threat
    const top1 = Math.max(...this.rivals.map((r) => r.fame));
    for (const r of this.rivals) {
      pin(r.x, r.y, r.fame >= top1 ? '#e8604f' : '#a2707a', 'RAKİP',
          String(Math.round(r.fame)));
    }
    // the butcher: reachable through the back door behind the wash-up
    pin(0.5, 0.86, '#f2b53c', 'KASAP', 'KUZU');

    // your house (or houses). The one you are standing in is green; the
    // other turns red the moment it is in trouble.
    BRANCHES.forEach((br, i) => {
      if (i > 0 && this.branches < 2) return;
      const here = i === this.branchIndex;
      const sick = !here && this.away && this.away.trouble;
      pin(br.x, br.y, here ? '#74e0b0' : sick ? '#e8604f' : '#8fd4ff',
          i === 0 ? 'MANGAL' : 'CATERING',
          here ? 'BURADASIN' : sick ? 'SORUN VAR!' : 'AÇIK');
    });

    const y2 = Y + H + 6;

    // ---- once both houses are open, this row is the commute -----------
    if (this.branches >= 2) {
      const other = this.branchIndex === 0 ? 1 : 0;
      ctx.fillStyle = 'rgba(70,58,78,0.96)';
      ctx.fillRect(24, y2, CFG.VIEW_W - 48, 26);
      ctx.fillStyle = '#8fd4ff';
      ctx.fillRect(24, y2, CFG.VIEW_W - 48, 1);
      ctx.fillRect(24, y2 + 25, CFG.VIEW_W - 48, 1);
      f.draw(ctx, this.game.input.touchMode ? `${BRANCHES[other].name} ŞUBESİNE GİT DÜĞMESİ`
                                            : `SPACE: ${BRANCHES[other].name} ŞUBESİNE GİT`, 34, y2 + 4,
             { color: '#f8e9cf', shadow: '#1b1220' });
      const t = this.away && this.away.trouble;
      f.draw(ctx, t ? `SANA İHTİYAÇ VAR - ${this._troubleText(t)}`
                    : `YOL ${Math.round(TRAVEL_HOURS * 60)} DAKİKA SÜRER`,
             34, y2 + 15, { color: t ? '#e8604f' : '#8d8296' });
      return;
    }

    // the expansion offer
    const ready = this.canOpenBranch();
    ctx.fillStyle = this.shopCursor === 0 ? 'rgba(70,58,78,0.96)' : 'rgba(38,30,44,0.86)';
    ctx.fillRect(24, y2, CFG.VIEW_W - 48, 26);
    ctx.fillStyle = ready ? '#74e0b0' : '#4a3a48';
    ctx.fillRect(24, y2, CFG.VIEW_W - 48, 1);
    ctx.fillRect(24, y2 + 25, CFG.VIEW_W - 48, 1);

    if (this.branches >= 2) {
      f.draw(ctx, `${BRANCH_NAME} AÇIK`, CFG.VIEW_W / 2, y2 + 9,
             { align: 'center', color: '#74e0b0', shadow: '#1b1220' });
    } else {
      f.draw(ctx, `${BRANCH_NAME} AÇ`, 34, y2 + 4,
             { color: ready ? '#f8e9cf' : '#8d8296', shadow: '#1b1220' });
      f.draw(ctx, this.allMaxed ? 'TÜM TEZGAHLAR SEVİYE 6 - HAZIR'
                                : 'TÜM TEZGAHLAR SEVİYE 6 OLMALI',
             34, y2 + 15, { color: this.allMaxed ? '#74e0b0' : '#e8604f' });
      this.icon(ctx, ICON.STAR, CFG.VIEW_W - 74, y2 + 5, 0.8);
      f.draw(ctx, `${BRANCH_FAME_COST}`, CFG.VIEW_W - 30, y2 + 10,
             { align: 'right',
               color: this.totalFame >= BRANCH_FAME_COST ? '#f2e6ce' : '#7a5560',
               shadow: '#1b1220' });
    }
  }

  /* ------------------------------------------------------------------ HUD */

  drawHUD(ctx) {
    const g = this.game;
    const f = g.font;
    const K = CFG.K;

    // These screens replace the HUD outright — drawing the counters
    // underneath just bleeds text through the panel.
    if (this.payrollDue) { this._drawPayroll(ctx); return; }
    if (this.butcherOpen) { this._drawButcher(ctx); return; }
    if (this.shopOpen) { this._drawShop(ctx); return; }

    /* ---- FAME track (progress) ----------------------------------------- */
    const bw = 108;
    ctx.fillStyle = 'rgba(26,20,28,0.86)';
    ctx.fillRect(4, 3, bw + 42, 16);
    ctx.fillStyle = '#e8ba5c';
    ctx.fillRect(4, 3, bw + 42, 1);
    ctx.fillRect(4, 18, bw + 42, 1);

    this.icon(ctx, ICON.STAR, 4, 2, 0.85);
    ctx.fillStyle = '#4a3a48';
    ctx.fillRect(19, 8, bw, 6);
    const fw2 = Math.round(bw * clamp(this.totalFame / BRANCH_FAME_COST, 0, 1));
    ctx.fillStyle = this.totalFame >= BRANCH_FAME_COST * 0.7 ? '#74e0b0'
                  : this.totalFame >= BRANCH_FAME_COST * 0.35 ? '#f2b53c' : '#e8604f';
    ctx.fillRect(19, 8, fw2, 6);
    // milestone ticks where the menu grows
    for (const m of MENU) {
      if (m.unlockAt <= 0) continue;
      const tx = 19 + Math.round(bw * (m.unlockAt / BRANCH_FAME_COST));
      ctx.fillStyle = this.unlocked.has(m.id) ? '#ffffff' : '#8d8296';
      ctx.fillRect(tx, 6, 1, 10);
    }
    f.draw(ctx, String(this.totalFame), bw + 28, 7,
           { color: '#f8e9cf', shadow: '#1b1220' });

    /* ---- LOVE wallet (the shop's currency) ----------------------------- */
    this.icon(ctx, ICON.HEART, 152, 2, 0.85);
    f.draw(ctx, String(Math.round(this.love)), 166, 7,
           { color: '#ff9db4', shadow: '#1b1220' });

    /* ---- what you owe -------------------------------------------------- */
    if (this.totalDebt > 0) {
      // Row 3, beside the complaint pips — row 2 is the clock line.
      this.icon(ctx, ICON.CROSS, 62, 30, 0.6);
      f.draw(ctx, `BORÇ ${this.totalDebt}`, 73, 33,
             { color: '#e8604f', shadow: '#1b1220' });
    }

    /* ---- the trading day ---------------------------------------------- */
    const busy = demandAt(this.hour);
    f.draw(ctx, `GÜN ${this.day}`, 4, 21, { color: '#c9bda8', shadow: '#1b1220' });
    f.draw(ctx, clockLabel(this.hour), 40, 21,
           { color: busy >= 1.4 ? '#e8604f' : busy >= 0.8 ? '#f2b53c' : '#8fd4ff',
             shadow: '#1b1220' });
    if (busy >= 1.4) {
      f.draw(ctx, 'YOĞUN', 76, 21, { color: '#e8604f', shadow: '#1b1220' });
    }
    // Tonight's wage bill, so closing time is never a nasty surprise.
    const bill = this.payroll;
    if (bill > 0) {
      f.draw(ctx, `MAAŞ ${bill}`, 122, 21,
             { color: this.love >= bill ? '#8d8296' : '#e8604f', shadow: '#1b1220' });
    }

    /* ---- complaints ---------------------------------------------------- */
    // Row 3. Row 2 belongs to the clock line, which used to be drawn
    // straight on top of these.
    for (let i = 0; i < this.maxComplaints; i++) {
      ctx.globalAlpha = i < this.complaints ? 1 : 0.22;
      this.icon(ctx, ICON.ANGRY, 4 + i * 11, 31, 0.6);
    }
    ctx.globalAlpha = 1;

    /* ---- clean plates: the wash-up pressure, always visible ----------- */
    const clean = this.clean;
    this.icon(ctx, ICON.PLATE, 186, 2, 0.85);
    // Denominator is the stock you actually own — the busser and a levelled
    // pass both add settings, so the base constant would read as a bug.
    f.draw(ctx, `${clean}/${this.plateStock}`, 200, 7,
           { color: clean > 2 ? '#dfe6f2' : clean > 0 ? '#f2b53c' : '#e8604f',
             shadow: '#1b1220' });
    if (this.dirty > 0) {
      f.draw(ctx, `KİRLİ ${this.dirty}`, 238, 7,
             { color: this.dirty >= this.plateStock - 1 ? '#e8604f' : '#8d8296',
               shadow: '#1b1220' });
    }

    /* ---- lamb stock, with an early warning ---------------------------- */
    this.icon(ctx, ICON.LAMB, CFG.VIEW_W - 74, 2, 0.8);
    const lambCol = this.lamb > 5 ? '#f8e9cf' : this.lamb > 0 ? '#f2b53c' : '#e8604f';
    f.draw(ctx, `KUZU ${String(this.lamb).padStart(2, '0')}`,
           CFG.VIEW_W - 5, 6, { align: 'right', color: lambCol, shadow: '#1b1220' });
    if (this.lamb <= 5 && Math.sin(g.time * 5) > -0.3) {
      f.draw(ctx, this.lamb > 0 ? 'AZ KUZU KALDI' : 'KUZU BİTTİ',
             CFG.VIEW_W - 5, 44,
             { align: 'right', color: '#e8604f', shadow: '#1b1220' });
    }

    /* ---- served / friends told ----------------------------------------- */
    f.draw(ctx, `TABAK ${this.served}  ANLATAN ${this.friendsTold}`,
           CFG.VIEW_W - 5, 20, { align: 'right', color: '#c9bda8', shadow: '#1b1220' });

    /* ---- which house you are standing in ------------------------------ */
    if (this.branches >= 2) {
      f.draw(ctx, this.branchName, CFG.VIEW_W - 5, 33,
             { align: 'right', color: '#8fd4ff', shadow: '#1b1220' });
    }

    /* ---- the order rail (screen-space, never overlaps) ----------------- */
    this._drawRail(ctx);

    /* ---- rivals eating your lunch ------------------------------------- */
    const topR = Math.max(...this.rivals.map((r) => r.fame));
    if (topR > this.totalFame + 20) {
      const bite = Math.round((1 - clamp(1 - (topR - this.totalFame) / 180, 0.25, 1)) * 100);
      f.draw(ctx, `RAKİPLER ÖNDE - MÜŞTERİ %${bite} AZALDI`, CFG.VIEW_W / 2, 48,
             { align: 'center', color: '#e8604f', shadow: '#1b1220' });
    }

    /* ---- messages shouted over from the other house ------------------- */
    this._drawAlerts(ctx);

    /* ---- the menu board, down the right-hand edge ---------------------- */
    let my = 78;
    f.draw(ctx, 'MENÜ', CFG.VIEW_W - 5, my, { align: 'right', color: '#8d8296' });
    my += 10;
    for (const m of MENU) {
      const has = this.unlocked.has(m.id);
      f.draw(ctx, has ? m.name : `??? ${m.unlockAt} ÜN`,
             CFG.VIEW_W - 5, my,
             { align: 'right', color: has ? '#e9dcc4' : '#6d6376', shadow: '#1b1220' });
      my += 9;
    }

    /* ---- payroll ------------------------------------------------------- */
    my += 4;
    f.draw(ctx, `PERSONEL ${this.headcount}/${this.headcountCap}`, CFG.VIEW_W - 5, my,
           { align: 'right', color: this.headcount ? '#8fd4ff' : '#6d6376', shadow: '#1b1220' });

    /* ---- contextual hint ----------------------------------------------- */
    if (this.hintTimer > 0) {
      f.draw(ctx, this.hint, CFG.VIEW_W / 2, 66,
             { align: 'center', color: '#f2b53c', shadow: '#1b1220' });
    }

    /* ---- "new dish unlocked" celebration ------------------------------- */
    if (this.newlyUnlocked) {
      const blink = Math.sin(g.time * 9) > -0.4;
      if (blink) {
        f.draw(ctx, 'MENÜ BÜYÜDÜ!', CFG.VIEW_W / 2, 88,
               { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
        f.draw(ctx, this.newlyUnlocked.name, CFG.VIEW_W / 2, 106,
               { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
      }
    }

    /* ---- current short goal ------------------------------------------ */
    const goal = KIDS_GOALS[this.goalIndex];
    if (goal) {
      const value = Math.min(goal.target, goal.value(this));
      const text = `HEDEF: ${goal.label}  ${value}/${goal.target}`;
      const w = Math.min(310, f.width(text) + 16);
      const x = Math.round((CFG.VIEW_W - w) / 2);
      const y = CFG.VIEW_H - 44;
      ctx.fillStyle = 'rgba(20,14,24,0.86)';
      ctx.fillRect(x, y, w, 16);
      ctx.fillStyle = '#4a3a48';
      ctx.fillRect(x + 4, y + 12, w - 8, 2);
      ctx.fillStyle = '#f2b53c';
      ctx.fillRect(x + 4, y + 12,
                   Math.round((w - 8) * clamp(value / goal.target, 0, 1)), 2);
      f.draw(ctx, text, CFG.VIEW_W / 2, y + 4,
             { align: 'center', color: '#f8e9cf', shadow: '#1b1220' });
    } else {
      this.icon(ctx, ICON.STAR, CFG.VIEW_W / 2 - 40, CFG.VIEW_H - 43, 0.7);
      f.draw(ctx, `TÜM ROZETLER TAMAM  ${this.stickers}/${KIDS_GOALS.length}`,
             CFG.VIEW_W / 2 + 8, CFG.VIEW_H - 38,
             { align: 'center', color: '#74e0b0', shadow: '#1b1220' });
    }
  }
}

/* ==========================================================================
 * 17. GAME — loop, states, systems, wiring
 * ========================================================================*/

const GSTATE = {
  LOADING: 'loading',
  ENDING: 'ending',         // the CAN USTA BAHÇE opening cutscene
  TITLE: 'title',
  PLAYING: 'playing',       // ACT 1 — clearing the restaurant
  PAUSED: 'paused',
  WON: 'won',               // Act 1 result banner
  ACT2_CUTSCENE: 'act2film',// happy diners inspire Can Usta's restaurant
  LOST: 'lost',
  KITCHEN_INTRO: 'kintro',  // ACT 2 briefing
  KITCHEN: 'kitchen',       // ACT 2 — running the grill
  KITCHEN_WON: 'kwon',
  KITCHEN_LOST: 'klost',
};

/** Where the sheep start. `col` is a tile column; `rowHint` is scanned
 *  downward for the first surface, so small level edits cannot orphan one. */
const SHEEP_SPAWNS = [
  { col:  10, rowHint: 14, spitter: false },
  { col:  16, rowHint: 14, spitter: false },
  { col:  21, rowHint: 11, spitter: true  },
  { col:  26, rowHint: 14, spitter: false },
  { col:  32, rowHint:  9, spitter: false },
  { col:  40, rowHint: 12, spitter: true  },
  { col:  48, rowHint: 10, spitter: false },
  { col:  56, rowHint: 12, spitter: false },
  { col:  64, rowHint:  9, spitter: true  },
  { col:  70, rowHint: 11, spitter: false },
  { col:  80, rowHint: 12, spitter: false },
  { col:  90, rowHint:  8, spitter: true  },
  { col:  98, rowHint: 11, spitter: false },
  { col: 106, rowHint: 14, spitter: false },
  { col: 113, rowHint: 12, spitter: true  },
  { col: 124, rowHint: 14, spitter: false },
  { col: 130, rowHint: 11, spitter: false },
  { col: 143, rowHint: 10, spitter: true  },
  { col: 151, rowHint: 12, spitter: false },
  { col: 160, rowHint: 14, spitter: false },
];

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.font = new PixelFont();
    this.scratch = new Scratch(64, 64);
    this.input = new Input(window);
    this.camera = new Camera();
    this.sfx = new Sfx();
    this.hud = new HUD(this);
    this.difficulty = GameSettings.readDifficulty();
    this.guide = new KidsGuide(this);
    this.mobileAction = document.querySelector('.touch-main');
    this.mobileActionText = this.mobileAction?.querySelector('strong') || null;
    this.mobileActionSub = this.mobileAction?.querySelector('small') || null;
    this.mobileSecondary = document.getElementById('touch-secondary');
    this.lastMobileLabel = '';

    this.state = GSTATE.LOADING;
    this.input.worldTouchAllowed = () => this.state === GSTATE.PLAYING;
    this.resumeState = GSTATE.PLAYING;   // where PAUSE returns to
    this.checkpointX = 0;                // furthest screen reached in Act 1
    this.clearedSpawns = new Set();      // sheep that stay dead across retries
    this.titleCursor = 0;
    this.titleSave = null;               // filled in at boot if a save exists
    this.time = 0;
    this.accumulator = 0;
    this.lastStamp = 0;
    this.hitstop = 0;
    this.act2Opening = null;

    this.assets = new AssetLoader(ASSET_MANIFEST);
    this.anims = {};

    this._resize = this._resize.bind(this);
    this._frame = this._frame.bind(this);
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', this._resize);
    window.visualViewport?.addEventListener('resize', this._resize);
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true, passive: true });
    this._resize();
  }

  /* ------------------------------------------------------------ startup - */

  async boot() {
    // Paint the LOADING screen immediately, before any decode work starts.
    this._drawLoading(0);
    const loopHandle = requestAnimationFrame(this._frame);

    await this.assets.load();

    // Build the Animation objects straight from the blueprint table.
    for (const [key, def] of Object.entries(ASSET_MANIFEST)) {
      if (def.frames) this.anims[key] = new Animation(this.assets.get(key), def);
    }

    // The customer sheet packs four clips into one row; slice them out with
    // the `from` frame offset (rows select which diner, see anim.variant).
    const cust = this.assets.get('CUSTOMER');
    this.anims.CUST_WALK  = new Animation(cust, { fw: 48, fh: 48, frames: 4, fps: 9, loop: true,  from: 0 });
    this.anims.CUST_IDLE  = new Animation(cust, { fw: 48, fh: 48, frames: 2, fps: 3, loop: true,  from: 4 });
    this.anims.CUST_HAPPY = new Animation(cust, { fw: 48, fh: 48, frames: 1, fps: 2, loop: true,  from: 6 });
    this.anims.CUST_ANGRY = new Animation(cust, { fw: 48, fh: 48, frames: 1, fps: 2, loop: true,  from: 7 });

    // The staff sheet is 6 columns x 5 rows: walk (0-3), working idle (4-5).
    const stf = this.assets.get('STAFF');
    this.anims.STAFF_WALK = new Animation(stf, { fw: 48, fh: 48, frames: 4, fps: 8, loop: true, from: 0 });
    this.anims.STAFF_IDLE = new Animation(stf, { fw: 48, fh: 48, frames: 2, fps: 3, loop: true, from: 4 });

    if (this.assets.errors.length) {
      console.warn('[CAN USTA] missing assets:', this.assets.errors);
    }

    this.map = new LevelMap(this.assets.get('TILESET')).buildRestaurant();
    this.kitchen = null;
    this.titleSave = SaveGame.read();
    this.reset();
    this.state = GSTATE.TITLE;
    return loopHandle;
  }

  /**
   * Restart Act 1. `fromCheckpoint` resumes at the last screen boundary you
   * reached with the sheep you already cleared still cleared — dying used to
   * throw away the whole level, which is brutal for a young player.
   */
  reset(fromCheckpoint = false) {
    if (!fromCheckpoint) {
      this.checkpointX = 0;
      this.clearedSpawns = new Set();
    }
    const startX = fromCheckpoint ? Math.max(3 * CFG.TILE, this.checkpointX + 24)
                                  : 3 * CFG.TILE;
    const startCol = Math.floor(startX / CFG.TILE);
    const spawnRow = this.map.surfaceRowBelow(startCol, 8);
    this.player = new Player(this, startX, spawnRow * CFG.TILE - CFG.PLAYER_H);

    this.sheep = [];
    SHEEP_SPAWNS.forEach((s, i) => {
      if (this.clearedSpawns.has(i)) return;     // stays dead
      const r = this.map.surfaceRowBelow(s.col, s.rowHint);
      const k = new Kuzu(this, s.col * CFG.TILE,
                         r * CFG.TILE - CFG.SHEEP_H, s.spitter);
      k.spawnIndex = i;
      this.sheep.push(k);
    });

    this.cuts = [];
    this.bullets = [];
    this.particles = [];
    this.act1Popups = [];

    this.killed = this.clearedSpawns.size;
    this.hitstop = 0;
    this.winTimer = 0;
    this.loseTimer = 0;

    this.camera.x = clamp(this.player.cx - CFG.VIEW_W / 2,
                          0, this.map.worldW - CFG.VIEW_W);
    this.camera.shakeAmp = 0;
  }

  get sheepRemaining() {
    return Math.max(0, CFG.SHEEP_TOTAL - this.killed);
  }

  /* -------------------------------------------------------------- canvas */

  /**
   * Match a landscape phone's aspect ratio in the backing store. The height
   * remains 270 retro pixels; wider phones receive extra horizontal world
   * view instead of a distorted 480px picture. Desktop keeps classic 16:9.
   */
  _resize() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    const mobileLandscape = width > height && (this.input?.touchMode ||
      window.matchMedia('(max-width: 1000px) and (max-height: 600px)').matches);
    const ratioWidth = Math.round(CFG.VIEW_H * (width / Math.max(1, height)));
    const viewWidth = mobileLandscape
      ? clamp(ratioWidth, CFG.BASE_VIEW_W, CFG.MAX_MOBILE_VIEW_W)
      : CFG.BASE_VIEW_W;

    CFG.VIEW_W = viewWidth + (viewWidth % 2); // even pixels keep camera centring crisp
    if (this.canvas.width !== CFG.VIEW_W || this.canvas.height !== CFG.VIEW_H) {
      this.canvas.width = CFG.VIEW_W;
      this.canvas.height = CFG.VIEW_H;
      this.ctx.imageSmoothingEnabled = false;
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /* ---------------------------------------------------------------- loop */

  /**
   * requestAnimationFrame drives rendering; physics is advanced in whole
   * fixed steps from an accumulator, so simulation is frame-rate independent
   * and nothing can clip through a wall on a slow frame.
   */
  _frame(stamp) {
    requestAnimationFrame(this._frame);

    if (!this.lastStamp) this.lastStamp = stamp;
    let frameDt = (stamp - this.lastStamp) / 1000;
    this.lastStamp = stamp;
    frameDt = clamp(frameDt, 0, CFG.MAX_FRAME);

    this.time += frameDt;

    if (this.state === GSTATE.LOADING) {
      this._drawLoading(this.assets.progress);
      return;
    }

    /* ---- hitstop: a true global engine freeze ------------------------- */
    if (this.hitstop > 0) {
      this.hitstop -= frameDt;
      this.render();               // keep presenting the frozen frame
      return;
    }

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= CFG.DT && steps < CFG.MAX_STEPS) {
      this.accumulator -= CFG.DT;
      steps++;
      this.step(CFG.DT);
      this.input.endStep();
      if (this.hitstop > 0) { this.accumulator = 0; break; }
    }
    if (steps === CFG.MAX_STEPS) this.accumulator = 0;   // shed the backlog

    this.render();
  }

  /* --------------------------------------------------------- simulation - */

  step(dt) {
    const inp = this.input;

    /* ---- global state transitions ------------------------------------ */
    if (this.state === GSTATE.TITLE) {
      const save = this.titleSave;
      const opts = save ? 2 : 1;
      if (inp.hit('left') || inp.hit('right')) {
        const dir = inp.hit('right') ? 1 : -1;
        const at = DIFFICULTY_ORDER.indexOf(this.difficulty);
        this.difficulty = DIFFICULTY_ORDER[(at + dir + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length];
        GameSettings.writeDifficulty(this.difficulty);
        this.sfx.drop();
      }
      if (inp.hit('up') || inp.hit('jump')) {
        this.titleCursor = (this.titleCursor + opts - 1) % opts; this.sfx.drop();
      }
      if (inp.hit('down')) {
        this.titleCursor = (this.titleCursor + 1) % opts; this.sfx.drop();
      }
      if (inp.hit('use')) {
        this.sfx.unlock();
        const continuing = save && this.titleCursor === 0;
        if (continuing && save.act === 2) {
          SaveGame.applyAct2(this, save);
          this.resumeState = GSTATE.KITCHEN;
          this.state = GSTATE.KITCHEN;
        } else if (continuing && save.act === 1) {
          if (DIFFICULTY_ORDER.includes(save.difficulty)) this.difficulty = save.difficulty;
          if (save.guide) {
            this.guide.act1 = save.guide.act1 || 0;
            this.guide.act2 = save.guide.act2 || 0;
          }
          this.killed = save.killed || 0;
          this.checkpointX = save.checkpointX || 0;
          this.clearedSpawns = new Set(save.cleared || []);
          this.reset(true);
          this.state = GSTATE.PLAYING;
        } else {
          SaveGame.clear();
          this.titleSave = null;
          this.guide = new KidsGuide(this);
          this.reset();
          this.state = GSTATE.PLAYING;
        }
      }
      this._stepParticles(dt);
      return;
    }

    if (this.state === GSTATE.PAUSED) {
      if (inp.hit('pause')) this.state = this.resumeState;
      if (inp.hit('retry')) {
        if (this.resumeState === GSTATE.KITCHEN) this.startKitchen(this.kitchen.lambStart);
        else { this.reset(); this.state = GSTATE.PLAYING; }
      }
      return;
    }

    /* ---- ACT 1 cleared: the bridge into the grill --------------------- */
    if (this.state === GSTATE.WON) {
      this.winTimer += dt;
      this.camera.follow(this.player, dt, this.map.worldW);
      this._stepParticles(dt);
      // A short beat so the banner lands before the prompt is live.
      if (this.winTimer > 1.2 && (inp.hit('jump') || inp.hit('use') || inp.hit('chop'))) {
        this.act2Opening = new ActTwoOpening(this);
        this.state = GSTATE.ACT2_CUTSCENE;
      }
      if (inp.hit('retry')) { this.reset(); this.state = GSTATE.PLAYING; }
      return;
    }

    if (this.state === GSTATE.ACT2_CUTSCENE) {
      this.act2Opening.step(dt);
      if (inp.hit('jump') || inp.hit('use') || inp.hit('chop')) this.act2Opening.skip();
      if (inp.hit('retry')) {
        this.act2Opening = null;
        this.reset();
        this.state = GSTATE.PLAYING;
      } else if (this.act2Opening.finished) {
        this.act2Opening = null;
        this.state = GSTATE.KITCHEN_INTRO;
        this.sfx.win();
      }
      return;
    }

    if (this.state === GSTATE.LOST) {
      this.loseTimer += dt;
      if (this.loseTimer < 1) this.camera.shake(4);   // 1 s dramatic shake
      this.camera.follow(this.player, dt, this.map.worldW);
      this._stepParticles(dt);
      if (inp.hit('retry')) { this.reset(true); this.state = GSTATE.PLAYING; }
      return;
    }

    if (this.state === GSTATE.KITCHEN_INTRO) {
      if (inp.hit('jump') || inp.hit('use') || inp.hit('chop')) this.startKitchen(this.killed);
      return;
    }

    if (this.state === GSTATE.KITCHEN) {
      // While the management screen is up, P belongs to it (close the books /
      // open the next day) — swallowing it here froze the day-end flow.
      if (inp.hit('pause') && !this.kitchen.shopOpen && !this.kitchen.butcherOpen) {
        this.resumeState = GSTATE.KITCHEN; this.state = GSTATE.PAUSED; return;
      }
      if (inp.hit('retry')) { this.startKitchen(this.kitchen.lambStart); return; }
      this.kitchen.step(dt, inp);
      this._stepParticles(dt);
      return;
    }

    if (this.state === GSTATE.ENDING) {
      this.ending.step(dt);
      this._stepParticles(dt);
      if (inp.hit('chop') || inp.hit('use') || inp.hit('jump')) this.ending.skip();
      if (inp.hit('retry')) {
        SaveGame.clear();
        this.ending = null;
        this.reset();
        this.state = GSTATE.TITLE;
      }
      return;
    }

    if (this.state === GSTATE.KITCHEN_WON || this.state === GSTATE.KITCHEN_LOST) {
      this.winTimer += dt;
      this.kitchen.step(dt, inp);
      this._stepParticles(dt);
      if (inp.hit('retry')) {
        // Retry resumes the last saved day rather than throwing the whole
        // restaurant away — losing on day 9 used to cost you all nine.
        const save = SaveGame.read();
        if (this.state === GSTATE.KITCHEN_LOST && save && save.act === 2) {
          SaveGame.applyAct2(this, save);
          this.state = GSTATE.KITCHEN;
        } else {
          SaveGame.clear();
          this.startKitchen(this.kitchen.lambStart);
        }
      }
      return;
    }

    /* ---- PLAYING ------------------------------------------------------ */
    if (inp.hit('pause')) { this.resumeState = GSTATE.PLAYING; this.state = GSTATE.PAUSED; return; }
    if (inp.hit('retry')) { this.reset(); return; }

    this.player.step(dt, this.map, inp);

    for (const k of this.sheep) k.step(dt, this.map, this.player);

    for (const c of this.cuts) c.step(dt, this.map);
    for (const b of this.bullets) b.step(dt, this.map);
    this._stepParticles(dt);

    this._resolveCombat();

    // Sweep the dead.
    this.cuts = this.cuts.filter((c) => !c.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.sheep = this.sheep.filter((k) => k.alive);

    this.camera.follow(this.player, dt, this.map.worldW);

    this.guide.stepAct1(inp);

    // A checkpoint every screen-width you push past.
    const screen = Math.floor(this.player.body.x / CFG.VIEW_W) * CFG.VIEW_W;
    if (screen > this.checkpointX) {
      this.checkpointX = screen;
      this.hud.flashCheckpoint = 1.6;
      this.sfx.jump();
      SaveGame.saveAct1(this);
    }

    this._checkWin();
  }

  _stepParticles(dt) {
    for (const p of this.particles) p.step(dt);
    this.particles = this.particles.filter((p) => !p.dead);
    for (const p of this.act1Popups) p.step(dt);
    this.act1Popups = this.act1Popups.filter((p) => !p.dead);
  }

  _resolveCombat() {
    const player = this.player;

    /* ---- player cuts vs sheep ---------------------------------------- */
    for (const c of this.cuts) {
      if (c.dead) continue;
      for (const k of this.sheep) {
        if (k.state === KSTATE.DYING) continue;
        if (!aabb(c.rect, k.rect)) continue;
        k.hit(sign(c.vx));
        c.dead = true;
        break;                                  // one cut, one sheep
      }
    }

    if (player.state !== PSTATE.ALIVE) return;

    /* ---- grass wads vs player ---------------------------------------- */
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (aabb(b.rect, player.rect)) {
        b.dead = true;
        player.hurt(b.x);
        this.burst(b.x, b.y, 8, '#6ebe58');
      }
    }

    /* ---- sheep body-check vs player ---------------------------------- */
    for (const k of this.sheep) {
      if (k.state === KSTATE.DYING) continue;
      if (aabb(k.rect, player.rect)) player.hurt(k.body.cx);
    }
  }

  _checkWin() {
    if (this.sheepRemaining > 0) return;
    const exX = CFG.EXTRACTION_COL * CFG.TILE;
    if (this.player.body.cx >= exX + 24) {
      this.state = GSTATE.WON;
      this.winTimer = 0;
      this.camera.shake(6);
      this.sfx.win();
      for (let i = 0; i < 40; i++) {
        this.particles.push(new Particle(
          rand(exX, this.map.worldW), rand(80, 220),
          rand(-60, 60), rand(-160, -40), rand(0.7, 1.6), rand(2, 5),
          ['#74e0b0', '#f2b53c', '#e8604f', '#f8e9cf'][i % 4], 120));
      }
    }
  }

  /* --------------------------------------------------------- callbacks -- */

  onSheepKilled(k) {
    this.killed++;
    // Remember it so a checkpoint restart does not resurrect it.
    if (k && k.spawnIndex !== undefined) this.clearedSpawns.add(k.spawnIndex);
  }

  onPlayerDead() {
    this.state = GSTATE.LOST;
    this.loseTimer = 0;
  }

  /* ------------------------------------------------------- ACT 2 wiring - */

  /**
   * Open the grill. The lamb you actually brought back from Act 1 becomes
   * your opening stock, so a clean sweep is rewarded with a longer runway.
   */
  startKitchen(lambStock) {
    this.kitchen = new Kitchen(this, lambStock);
    this.kitchen.lambStart = lambStock;   // remembered so O can restart Act 2
    this.particles = [];
    this.camera.x = 0;
    this.camera.shakeAmp = 0;
    this.winTimer = 0;
    this.resumeState = GSTATE.KITCHEN;
    this.state = GSTATE.KITCHEN;
    this.sfx.unlock();
    SaveGame.saveAct2(this);
  }

  onKitchenWon() {
    SaveGame.clear();                    // the run is over; start fresh next time
    // Roll the CAN USTA BAHÇE opening rather than a banner. The stats card
    // lives at the end of it, so nothing is lost by replacing the overlay.
    this.ending = new Ending(this);
    this.state = GSTATE.ENDING;
    this.winTimer = 0;
    this.camera.shake(7);
    this.sfx.win();
    for (let i = 0; i < 46; i++) {
      this.particles.push(new Particle(
        rand(this.camera.x, this.camera.x + CFG.VIEW_W), rand(40, 180),
        rand(-70, 70), rand(-170, -50), rand(0.8, 1.8), rand(2, 5),
        ['#74e0b0', '#f2b53c', '#e8604f', '#f8e9cf'][i % 4], 130));
    }
  }

  onKitchenLost() {
    this.state = GSTATE.KITCHEN_LOST;
    this.winTimer = 0;
    this.camera.shake(9);
    this.sfx.die();
  }

  /* ---------------------------------------------------------- particles - */

  /** White wool puff — the family-friendly "impact" effect. */
  puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push(new Particle(
        x + rand(-5, 5), y + rand(-4, 2),
        rand(-45, 45), rand(-60, -10),
        rand(0.22, 0.5), rand(2, 4), '#f8f3ec', 140));
    }
  }

  burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(45, 150);
      this.particles.push(new Particle(
        x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40,
        rand(0.3, 0.75), rand(2, 5), color, 260));
    }
  }

  spark(x, y, dir) {
    for (let i = 0; i < 4; i++) {
      this.particles.push(new Particle(
        x, y + rand(-3, 3), dir * rand(90, 200), rand(-40, 40),
        rand(0.1, 0.24), rand(1, 3), '#dfeaf7', 40));
    }
  }

  /* ------------------------------------------------------------- render - */

  _drawLoading(progress) {
    const ctx = this.ctx;
    ctx.fillStyle = '#16101c';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
    this.font.draw(ctx, 'LOADING...', CFG.VIEW_W / 2, 124,
                   { align: 'center', scale: 2, color: '#f8e9cf' });
    const w = 160, x = (CFG.VIEW_W - w) / 2, y = 148;
    ctx.fillStyle = '#2a1c30';
    ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = '#f2b53c';
    ctx.fillRect(x, y, Math.round(w * clamp(progress, 0, 1)), 5);
  }

  /** Tile a parallax layer horizontally at the given scroll factor. */
  _drawParallax(img, factor, yOff) {
    const ctx = this.ctx;
    const w = img.width;
    let ox = -((this.camera.drawX * factor) % w);
    if (ox > 0) ox -= w;
    for (let x = ox; x < CFG.VIEW_W; x += w) {
      ctx.drawImage(img, Math.round(x), yOff);
    }
  }

  _updateMobileAction() {
    if (!this.mobileActionText) return;
    let label = 'EYLEM';
    let sub = 'DOKUN';
    let actions = 'chop use';
    let secondary = null;
    if (this.state === GSTATE.TITLE) { label = 'BAŞLA'; sub = 'ONAYLA'; actions = 'use'; }
    else if (this.state === GSTATE.PLAYING) {
      label = 'YAKALA'; sub = 'KOYUNU AĞILA GÖTÜR'; actions = 'chop';
    }
    else if (this.state === GSTATE.WON || this.state === GSTATE.KITCHEN_INTRO) {
      label = 'DEVAM'; sub = 'MANGALA GEÇ'; actions = 'chop';
    } else if (this.state === GSTATE.ACT2_CUTSCENE) {
      label = this.act2Opening?.ready ? 'DEVAM' : 'ATLA';
      sub = this.act2Opening?.ready ? 'İKİNCİ PERDE' : 'HİKÂYE';
      actions = 'chop';
    } else if (this.state === GSTATE.LOST || this.state === GSTATE.KITCHEN_LOST) {
      label = 'TEKRAR'; sub = 'YENİDEN DENE'; actions = 'retry';
    } else if (this.state === GSTATE.PAUSED) {
      label = 'DEVAM'; sub = 'OYUNA DÖN'; actions = 'pause';
    }
    else if (this.state === GSTATE.KITCHEN && this.kitchen) {
      label = this.kitchen.contextActionLabel(); sub = 'EYLEM';
      if (this.kitchen.payrollDue) {
        secondary = { label: 'İŞTEN ÇIKAR', actions: 'dismiss' };
      } else if (!this.kitchen.shopOpen && !this.kitchen.butcherOpen && this.kitchen.carried) {
        secondary = { label: 'TABAĞI AT', actions: 'down chop' };
      }
    } else if (this.state === GSTATE.ENDING) {
      label = 'ATLA'; sub = 'DEVAM'; actions = 'chop';
    }

    const key = `${label}|${sub}|${actions}|${secondary?.label || ''}|${secondary?.actions || ''}`;
    if (key === this.lastMobileLabel) return;
    this.lastMobileLabel = key;
    this.mobileActionText.textContent = label;
    this.mobileActionSub.textContent = sub;
    this.mobileAction.dataset.actions = actions;
    this.mobileAction.setAttribute('aria-label', label);
    if (this.mobileSecondary) {
      this.mobileSecondary.hidden = !secondary;
      if (secondary) {
        this.mobileSecondary.dataset.actions = secondary.actions;
        this.mobileSecondary.querySelector('strong').textContent = secondary.label;
        this.mobileSecondary.setAttribute('aria-label', secondary.label);
      }
    }
  }

  render() {
    this._updateMobileAction();
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.fillStyle = '#16101c';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    if (this.state === GSTATE.LOADING) return;

    /* ---- the finale owns the whole screen ----------------------------- */
    if (this.state === GSTATE.ENDING) {
      this.ending.draw(ctx);
      this._scanlines(ctx);
      return;
    }

    if (this.state === GSTATE.ACT2_CUTSCENE && this.act2Opening) {
      this.act2Opening.draw(ctx);
      this._scanlines(ctx);
      return;
    }

    /* ---- ACT 2 renders its own world entirely ------------------------- */
    if (this.kitchen && (this.state === GSTATE.KITCHEN ||
                         this.state === GSTATE.KITCHEN_WON ||
                         this.state === GSTATE.KITCHEN_LOST ||
                         (this.state === GSTATE.PAUSED &&
                          this.resumeState === GSTATE.KITCHEN))) {
      this.kitchen.draw(ctx, cam);
      this.kitchen.drawHUD(ctx);
      if (this.state === GSTATE.KITCHEN && !this.kitchen.shopOpen &&
          !this.kitchen.butcherOpen && !this.kitchen.payrollDue) {
        this.guide.draw(ctx, 2);
      }
      if (this.state === GSTATE.PAUSED) this._drawPaused(ctx);
      if (this.state === GSTATE.KITCHEN_WON) this._drawKitchenWon(ctx);
      if (this.state === GSTATE.KITCHEN_LOST) this._drawKitchenLost(ctx);
      this._scanlines(ctx);
      return;
    }

    /* ---- parallax ----------------------------------------------------- */
    this._drawParallax(this.assets.get('BG_FAR'), 0.25, 0);
    this._drawParallax(this.assets.get('BG_NEAR'), 0.55, 0);

    /* ---- extraction zone glow (behind the tiles, so it reads as light) - */
    this._drawExtraction(ctx, cam);

    /* ---- world -------------------------------------------------------- */
    this.map.draw(ctx, cam);

    for (const b of this.bullets) b.draw(ctx, cam);
    for (const k of this.sheep) k.draw(ctx, cam, this.scratch);
    this.player.draw(ctx, cam, this.scratch);
    for (const c of this.cuts) c.draw(ctx, cam);
    for (const p of this.particles) p.draw(ctx, cam);
    for (const p of this.act1Popups) p.draw(ctx, cam, this.font);

    /* ---- HUD (never shaken — it is bolted to the screen) -------------- */
    this.hud.draw(ctx);
    if (this.state === GSTATE.PLAYING) this.guide.draw(ctx, 1);

    /* ---- overlays ----------------------------------------------------- */
    switch (this.state) {
      case GSTATE.TITLE:         this._drawTitle(ctx); break;
      case GSTATE.PAUSED:        this._drawPaused(ctx); break;
      case GSTATE.WON:           this._drawWin(ctx); break;
      case GSTATE.LOST:          this._drawLose(ctx); break;
      case GSTATE.KITCHEN_INTRO: this._drawKitchenIntro(ctx); break;
    }

    this._scanlines(ctx);
  }

  /** Subtle CRT veil, applied last on every path. */
  _scanlines(ctx) {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < CFG.VIEW_H; y += 3) ctx.fillRect(0, y, CFG.VIEW_W, 1);
    ctx.globalAlpha = 1;
  }

  _drawExtraction(ctx, cam) {
    const x0 = CFG.EXTRACTION_COL * CFG.TILE - cam.drawX;
    if (x0 > CFG.VIEW_W) return;
    const w = this.map.worldW - CFG.EXTRACTION_COL * CFG.TILE;
    const open = this.sheepRemaining === 0;
    const pulse = 0.35 + 0.35 * Math.sin(this.time * (open ? 7 : 2.5));

    ctx.globalAlpha = open ? pulse : pulse * 0.4;
    ctx.fillStyle = open ? '#74e0b0' : '#e8604f';
    ctx.fillRect(Math.round(x0), 0, w, CFG.VIEW_H);
    ctx.globalAlpha = 1;

    // neon edge
    ctx.fillStyle = open ? '#b8ffe4' : '#ff9d8c';
    ctx.fillRect(Math.round(x0), 0, 2, CFG.VIEW_H);

    // chevrons + label
    const hud = this.assets.get('HUD');
    for (let i = 0; i < 3; i++) {
      const cx = x0 + 16 + i * 20;
      if (cx < -16 || cx > CFG.VIEW_W) continue;
      ctx.globalAlpha = open ? (0.4 + 0.6 * Math.abs(Math.sin(this.time * 5 - i * 0.6))) : 0.25;
      ctx.drawImage(hud, UI.CHEVRON.x, UI.CHEVRON.y, 16, 16,
                    Math.round(cx), 120, 16, 16);
    }
    ctx.globalAlpha = 1;

    if (Math.sin(this.time * 6) > -0.4) {
      this.font.draw(ctx, 'ÇIKIŞ BÖLGESİ', x0 + 40, 100,
                     { align: 'center', color: open ? '#e6fff4' : '#ffd9d2',
                       shadow: '#1b1220' });
      if (!open) {
        this.font.draw(ctx, `KİLİTLİ - ${this.sheepRemaining} KALDI`, x0 + 40, 112,
                       { align: 'center', color: '#ffd9d2', shadow: '#1b1220' });
      }
    }
  }

  _drawTitle(ctx) {
    ctx.fillStyle = 'rgba(20,12,22,0.66)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
    const f = this.font;
    const touch = this.input.touchMode;
    f.draw(ctx, 'CAN USTA', CFG.VIEW_W / 2, 70,
           { align: 'center', scale: 4, color: '#f2b53c', shadow: '#7a3a10' });
    f.draw(ctx, 'MUTFAK DEVRİYESİ', CFG.VIEW_W / 2, 108,
           { align: 'center', scale: 2, color: '#f8e9cf', shadow: '#1b1220' });
    f.draw(ctx, '20 ŞAKACI KOYUNU YAKALA, SONRA ÇIKIŞA ULAŞ',
           CFG.VIEW_W / 2, 146, { align: 'center', color: '#c9bda8', shadow: '#1b1220' });
    const save = this.titleSave;
    const opts = save
      ? [save.act === 2 ? `DEVAM ET - ${save.k.day}. GÜN` : 'DEVAM ET - 1. PERDE',
         'YENİ OYUN']
      : ['YENİ OYUN'];
    opts.forEach((label, i) => {
      const sel = i === this.titleCursor;
      const y = 166 + i * 20;
      if (sel) {
        ctx.fillStyle = 'rgba(70,58,78,0.9)';
        ctx.fillRect(96, y - 3, CFG.VIEW_W - 192, 17);
        ctx.fillStyle = '#f2b53c';
        ctx.fillRect(96, y - 3, CFG.VIEW_W - 192, 1);
        ctx.fillRect(96, y + 13, CFG.VIEW_W - 192, 1);
      }
      f.draw(ctx, label, CFG.VIEW_W / 2, y,
             { align: 'center', scale: 2,
               color: sel ? '#74e0b0' : '#8d8296', shadow: '#1b1220' });
    });
    f.draw(ctx, touch ? (save ? 'OKLARLA SEÇ - BAŞLA İLE ONAYLA' : 'BAŞLA DÜĞMESİNE DOKUN')
                      : (save ? 'W S SEÇ     E ONAYLA' : 'E İLE BAŞLA'),
           CFG.VIEW_W / 2, 206, { align: 'center', color: '#8d8296' });
    f.draw(ctx, `${touch ? 'SOL SAĞ OKLARLA' : 'A D İLE'} MOD SEÇ: ${DIFFICULTY_LABEL[this.difficulty]}`,
           CFG.VIEW_W / 2, 218,
           { align: 'center', color: this.difficulty === DIFFICULTY.RELAXED ? '#74e0b0' : '#f2b53c',
             shadow: '#1b1220' });
    f.draw(ctx, touch ? 'EKRANDAKİ DÜĞMELERLE OYNA'
                      : 'A D YÜRÜ   W ZIPLA   S EĞİL   SPACE YAKALA   E KULLAN',
           CFG.VIEW_W / 2, 232, { align: 'center', color: '#6d6376' });
  }

  _drawPaused(ctx) {
    this.hud.banner(ctx, [
      { text: 'DURAKLATILDI', scale: 3, color: '#f2b53c' },
      { text: `MOD: ${DIFFICULTY_LABEL[this.difficulty]}`, scale: 1, color: '#74e0b0' },
      { text: this.input.touchMode ? 'DEVAM VEYA TEKRAR DÜĞMESİNE DOKUN'
                                   : 'P DEVAM   O BAŞTAN', scale: 1, color: '#c9bda8' },
    ], { y: 108 });
  }

  _drawWin(ctx) {
    this.hud.banner(ctx, [
      { text: 'KOYUNLAR AĞILDA!', scale: 3, color: '#74e0b0', blink: true, rate: 5 },
      { text: 'MUTFAK GÜVENDE.', scale: 3, color: '#74e0b0', blink: true, rate: 5 },
      { text: `${this.killed} ŞAKACI KOYUN GÜVENDE`, scale: 1, color: '#f8e9cf', gap: 14 },
      { text: this.winTimer > 1.2 ? (this.input.touchMode ? 'DEVAM - MANGAL YANDI' : 'SPACE - MANGAL YANDI') : ' ',
        scale: 2, color: '#f2b53c', blink: true, rate: 6, gap: 12 },
      { text: this.input.touchMode ? 'TEKRAR DÜĞMESİ: BİRİNCİ PERDE'
                                   : 'O İLE BİRİNCİ PERDE', scale: 1, color: '#8d8296' },
    ], { y: 50, veil: 'rgba(12,30,24,0.78)' });
  }

  /* ------------------------------------------------------- ACT 2 screens - */

  _drawKitchenIntro(ctx) {
    const f = this.font;
    ctx.fillStyle = 'rgba(18,14,20,0.86)';
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
    f.draw(ctx, 'İKİNCİ PERDE', CFG.VIEW_W / 2, 22,
           { align: 'center', color: '#8d8296' });
    f.draw(ctx, 'CAN USTA: MANGAL', CFG.VIEW_W / 2, 34,
           { align: 'center', scale: 3, color: '#f2b53c', shadow: '#7a3a10' });

    const lines = [
      ['HAMURU AL, BAHARATLA, PİŞİR, SERVİS ET.', '#f8e9cf'],
      ['FİŞE UY VE YEŞİL ARALIKTA MANGALDAN AL.', '#c9bda8'],
      ['', '#c9bda8'],
      ['KAPILAR 05:00 AÇILIR, 21:00 KAPANIR.', '#8fd4ff'],
      ['SABAHLAR SAKİN. 14:00-20:00 YOĞUN SAAT.', '#8fd4ff'],
      ['HER AKŞAM KASA SAYILIR, MAAŞ ÖDENİR.', '#8fd4ff'],
      ['', '#c9bda8'],
      ['KUZU BİTTİ Mİ? BULAŞIĞIN ARKASINDAKİ KAPI', '#f2b53c'],
      ['KASABA ÇIKAR. KASAP VERESİYE DE VERİR.', '#f2b53c'],
      ['', '#c9bda8'],
      ['SEVGİ PERSONEL VE EKİPMAN ALIR. İYİ EKİPMAN', '#74e0b0'],
      ['ÜN GETİRİR - VE DAHA ÇOK PERSONEL YERİ.', '#74e0b0'],
      ['', '#c9bda8'],
      ['TÜM TEZGAHLARI SEVİYE 6 YAP, SONRA ÜNLE', '#f2b53c'],
      ['İKİNCİ ŞUBEYİ AÇ. RAKİPLER BEKLEMİYOR.', '#f2b53c'],
    ];
    let y = 54;
    for (const [t, c] of lines) {
      if (t) f.draw(ctx, t, CFG.VIEW_W / 2, y, { align: 'center', color: c, shadow: '#1b1220' });
      y += 10;
    }

    f.draw(ctx, this.input.touchMode ? 'EYLEM DÜĞMESİ TEZGAHI KULLANIR - TABAĞI AT AYRIDIR'
                                     : 'SPACE TEZGAH      S + SPACE TABAĞI AT',
           CFG.VIEW_W / 2, 196, { align: 'center', color: '#8d8296' });
    if (Math.sin(this.time * 6) > -0.3) {
      f.draw(ctx, this.input.touchMode ? 'DEVAM DÜĞMESİNE DOKUN' : 'AÇMAK İÇİN SPACE', CFG.VIEW_W / 2, 216,
             { align: 'center', scale: 2, color: '#74e0b0', shadow: '#1b1220' });
    }
  }

  _drawKitchenWon(ctx) {
    const k = this.kitchen;
    this.hud.banner(ctx, [
      { text: 'İKİ ŞUBE, TEK İSİM', scale: 2, color: '#74e0b0', blink: true, rate: 5 },
      { text: 'CAN USTA', scale: 3, color: '#f2b53c', gap: 14 },
      { text: `${k.day} GÜN   ${k.served} TABAK   ${k.friendsTold} KİŞİYE ANLATILDI`,
        scale: 1, color: '#f8e9cf' },
      { text: `ÜN ${k.totalFame} - ŞEHRİN EN ÖNÜNDE`,
        scale: 1, color: '#8fd4ff' },
      { text: this.input.touchMode ? 'TEKRAR DÜĞMESİYLE BAŞTAN OYNA'
                                   : 'BAŞTAN OYNAMAK İÇİN O', scale: 1, color: '#8d8296', gap: 14 },
    ], { y: 50, veil: 'rgba(12,30,24,0.80)' });
  }

  _drawKitchenLost(ctx) {
    const k = this.kitchen;
    const why = k.complaints >= k.maxComplaints
      ? `${k.complaints} ŞİKÂYET` : 'KİMSE YEMEĞİ SEVMEDİ';
    this.hud.banner(ctx, [
      { text: 'KAPANDI.', scale: 4, color: '#e8604f' },
      { text: why, scale: 1, color: '#f8e9cf', gap: 12 },
      { text: `${k.served} TABAK ÇIKTI`, scale: 1, color: '#c9bda8' },
      { text: this.input.touchMode ? 'TEKRAR DÜĞMESİNE DOKUN' : 'TEKRAR İÇİN O.',
        scale: 2, color: '#f8e9cf', blink: true, rate: 6, gap: 14 },
    ], { y: 66, veil: 'rgba(34,10,14,0.82)' });
  }

  _drawLose(ctx) {
    this.hud.banner(ctx, [
      { text: 'KAYBETTİN.', scale: 4, color: '#e8604f' },
      { text: this.input.touchMode ? 'TEKRAR DÜĞMESİNE DOKUN' : 'TEKRAR İÇİN O.',
        scale: 2, color: '#f8e9cf', blink: true, rate: 6 },
      { text: 'KAYIT NOKTASINDAN DEVAM EDERSİN', scale: 1, color: '#74e0b0', gap: 10 },
      { text: `YAKALANAN: ${this.killed} / ${CFG.SHEEP_TOTAL}`, scale: 1, color: '#c9bda8', gap: 14 },
    ], { y: 78, veil: 'rgba(34,10,14,0.8)' });
  }
}

/* ==========================================================================
 * 17. BOOTSTRAP
 * ========================================================================*/

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  window.CAN_USTA = game;          // handy console handle while tuning
  game.boot();
});
