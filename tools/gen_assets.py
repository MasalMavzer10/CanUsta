#!/usr/bin/env python3
"""
CAN USTA — procedural pixel-art asset generator.

Regenerates every file in ./assets to the exact dimensions required by the
animation blueprint table in game.js (ASSET_MANIFEST).

    python3 tools/gen_assets.py

Frame sizes produced here MUST stay in sync with ASSET_MANIFEST in game.js:
    PLAYER_IDLE   48x48 x4      PLAYER_RUN    48x48 x6
    PLAYER_JUMP   48x48 x3      PLAYER_CROUCH 48x48 x2
    PLAYER_SHOOT  48x48 x4      ENEMY_WALK    48x48 x4
    ENEMY_ATTACK  48x48 x4
"""

import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SPR = os.path.join(ROOT, "assets", "sprites")
ENV = os.path.join(ROOT, "assets", "environment")
UI = os.path.join(ROOT, "assets", "ui")
for d in (SPR, ENV, UI):
    os.makedirs(d, exist_ok=True)

FW = FH = 48  # canonical frame size for every character sheet

# ---------------------------------------------------------------- palette ---
OUT = (34, 26, 32, 255)          # universal dark outline
UNI = (248, 248, 252, 255)       # chef whites
UNI_S = (203, 206, 220, 255)     # chef whites, shaded
UNI_D = (168, 172, 190, 255)
SKIN = (241, 189, 141, 255)
SKIN_S = (206, 148, 104, 255)
HAIR = (58, 41, 34, 255)         # mustache / brows
MOUTH = (150, 62, 62, 255)
TEETH = (252, 250, 246, 255)
EYE = (40, 32, 40, 255)
PANT_A = (86, 92, 110, 255)      # chef check pants
PANT_B = (60, 65, 82, 255)
SHOE = (44, 40, 50, 255)
SILVER = (196, 205, 220, 255)
SILVER_H = (243, 248, 255, 255)
SILVER_S = (134, 145, 168, 255)
GOLD = (232, 186, 92, 255)
CLEAVER = (222, 231, 244, 255)
CLEAVER_S = (150, 162, 184, 255)
HANDLE = (110, 72, 44, 255)

WOOL = (247, 243, 236, 255)
WOOL_S = (209, 202, 190, 255)
WOOL_D = (172, 164, 152, 255)
SHEEPFACE = (62, 58, 68, 255)
SHEEPFACE_S = (44, 41, 50, 255)
GRASS = (110, 190, 88, 255)
GRASS_D = (68, 140, 60, 255)

TRANSPARENT = (0, 0, 0, 0)


def sheet(frames, w=FW, h=FH):
    """Allocate a horizontal spritesheet of `frames` cells."""
    return Image.new("RGBA", (w * frames, h), TRANSPARENT)


def cell(img, i, w=FW, h=FH):
    """Return a per-frame (draw, ox, oy) tuple for frame index `i`."""
    return ImageDraw.Draw(img), i * w, 0


def rect(d, ox, oy, x, y, w, h, c):
    if w <= 0 or h <= 0:
        return
    d.rectangle([ox + x, oy + y, ox + x + w - 1, oy + y + h - 1], fill=c)


def ell(d, ox, oy, x, y, w, h, c, outline=None):
    d.ellipse([ox + x, oy + y, ox + x + w - 1, oy + y + h - 1], fill=c, outline=outline)


def line(d, ox, oy, x0, y0, x1, y1, c, wd=1):
    d.line([ox + x0, oy + y0, ox + x1, oy + y1], fill=c, width=wd)


# =============================================================== the chef ===
# Anchor contract: the character's feet rest on y = 46 and the silhouette is
# horizontally centred on x = 24 of the 48x48 cell.  game.js draws the sprite
# with the same anchor so the AABB (20 x 48) lines up with the art.

def chef(d, ox, oy, *, bob=0, larm=0, rarm=0, lleg=0, rleg=0,
         crouch=0, cleaver=None, blink=False, squash=0):
    """
    Draw the chef.

    bob      vertical body offset in px (run cycle)
    larm     front (cloche) arm angle bucket: -1 low, 0 neutral, 1 high
    rarm     back arm swing: -1 back, 0 neutral, 1 forward
    lleg/rleg  leg pose buckets, -2..2
    crouch   0 = standing, 1 = crouched (body compressed into 24px box)
    cleaver  None or 0..3 swing phase (draws the cutting arc)
    squash   negative = stretched (jump up), positive = squashed (land)
    """
    b = bob
    if crouch:
        # Crouched: everything is compressed down into the lower 24px.
        top = 24
    else:
        top = 0
    t = top + b

    # ---- legs -------------------------------------------------------------
    leg_top = 36 + t - squash
    if crouch:
        leg_top = 41
    # back leg — `lleg` shifts the foot, the thigh stays under the hip
    lx = 19
    lfoot = lx + lleg
    rect(d, ox, oy, lx, leg_top, 5, 44 - leg_top, PANT_B)
    rect(d, ox, oy, min(lx, lfoot), 43, 5 + abs(lleg), 2, PANT_B)
    rect(d, ox, oy, lfoot - 1, 45, 7, 2, SHOE)
    # front leg
    rx = 25
    rfoot = rx + rleg
    rect(d, ox, oy, rx, leg_top, 5, 44 - leg_top, PANT_A)
    rect(d, ox, oy, min(rx, rfoot), 43, 5 + abs(rleg), 2, PANT_A)
    rect(d, ox, oy, rfoot - 1, 45, 7, 2, SHOE)
    # pant check detail
    if not crouch:
        rect(d, ox, oy, rx, leg_top + 2, 5, 1, PANT_B)
        rect(d, ox, oy, lx, leg_top + 4, 5, 1, PANT_A)

    # ---- torso (double breasted jacket) -----------------------------------
    ty = 26 + t + (2 if crouch else 0) - squash
    th = (37 + t) - ty
    if crouch:
        ty, th = 34, 9
    rect(d, ox, oy, 15, ty, 18, th, UNI)
    rect(d, ox, oy, 15, ty, 18, 1, UNI_S)          # shoulder line
    rect(d, ox, oy, 30, ty, 3, th, UNI_S)          # right-side shading
    rect(d, ox, oy, 15, ty + th - 1, 18, 1, UNI_D)  # hem
    # button rows
    for i in range(3):
        yy = ty + 2 + i * 3
        if yy < ty + th - 1:
            rect(d, ox, oy, 21, yy, 1, 1, UNI_D)
            rect(d, ox, oy, 26, yy, 1, 1, UNI_D)
    # apron string
    rect(d, ox, oy, 15, ty + th - 3, 18, 1, UNI_S)

    # ---- head -------------------------------------------------------------
    hy = 13 + t + (2 if crouch else 0) - squash
    if crouch:
        hy = 23
    # neck
    rect(d, ox, oy, 22, hy + 11, 5, 2, SKIN_S)
    # collar
    rect(d, ox, oy, 19, hy + 12, 11, 2, UNI)
    # face
    rect(d, ox, oy, 17, hy, 14, 12, SKIN)
    rect(d, ox, oy, 17, hy, 14, 1, SKIN)
    rect(d, ox, oy, 29, hy + 1, 2, 11, SKIN_S)     # cheek shadow
    # ears
    rect(d, ox, oy, 16, hy + 5, 1, 3, SKIN_S)
    rect(d, ox, oy, 31, hy + 5, 1, 3, SKIN_S)
    # brows
    rect(d, ox, oy, 20, hy + 3, 3, 1, HAIR)
    rect(d, ox, oy, 26, hy + 3, 3, 1, HAIR)
    # eyes (happy, closed on blink)
    if blink:
        rect(d, ox, oy, 20, hy + 5, 3, 1, EYE)
        rect(d, ox, oy, 26, hy + 5, 3, 1, EYE)
    else:
        rect(d, ox, oy, 21, hy + 5, 2, 2, EYE)
        rect(d, ox, oy, 27, hy + 5, 2, 2, EYE)
        rect(d, ox, oy, 21, hy + 5, 1, 1, TEETH)
        rect(d, ox, oy, 27, hy + 5, 1, 1, TEETH)
    # THE mustache — big, curled, unmistakable
    rect(d, ox, oy, 19, hy + 8, 11, 2, HAIR)
    rect(d, ox, oy, 18, hy + 7, 2, 2, HAIR)
    rect(d, ox, oy, 29, hy + 7, 2, 2, HAIR)
    # smiling mouth under the mustache
    rect(d, ox, oy, 21, hy + 10, 7, 1, MOUTH)
    rect(d, ox, oy, 22, hy + 11, 5, 1, TEETH)

    # ---- toque ------------------------------------------------------------
    ky = hy - 12
    rect(d, ox, oy, 17, ky + 9, 14, 3, UNI)        # hat band
    rect(d, ox, oy, 17, ky + 11, 14, 1, UNI_S)
    # puffy crown: three overlapping blobs
    ell(d, ox, oy, 14, ky + 1, 10, 10, UNI)
    ell(d, ox, oy, 24, ky + 1, 10, 10, UNI)
    ell(d, ox, oy, 19, ky - 1, 11, 11, UNI)
    ell(d, ox, oy, 25, ky + 3, 7, 7, UNI_S)        # crown shading
    rect(d, ox, oy, 15, ky + 6, 18, 4, UNI)

    # ---- back arm (swings) ------------------------------------------------
    ay = ty + 2
    if rarm > 0:
        rect(d, ox, oy, 12, ay, 4, 7, UNI_S)
        rect(d, ox, oy, 12, ay + 7, 4, 3, SKIN_S)
    elif rarm < 0:
        rect(d, ox, oy, 32, ay, 4, 7, UNI_S)
        rect(d, ox, oy, 33, ay + 7, 4, 3, SKIN_S)
    else:
        rect(d, ox, oy, 32, ay, 4, 8, UNI_S)
        rect(d, ox, oy, 32, ay + 8, 4, 3, SKIN_S)

    # ---- front arm + silver cloche ---------------------------------------
    cy = ay + 2 - larm * 3
    if crouch:
        cy = ty + 1
    rect(d, ox, oy, 13, cy, 5, 4, UNI)             # upper arm
    rect(d, ox, oy, 10, cy + 3, 5, 3, UNI)         # forearm
    rect(d, ox, oy, 8, cy + 4, 4, 3, SKIN)         # hand
    # plate
    rect(d, ox, oy, 2, cy + 6, 14, 2, SILVER)
    rect(d, ox, oy, 2, cy + 8, 14, 1, SILVER_S)
    # dome
    ell(d, ox, oy, 3, cy - 1, 12, 9, SILVER)
    rect(d, ox, oy, 3, cy + 3, 12, 4, SILVER)
    ell(d, ox, oy, 4, cy, 5, 5, SILVER_H)          # specular highlight
    rect(d, ox, oy, 12, cy + 2, 3, 5, SILVER_S)    # dome shading
    rect(d, ox, oy, 8, cy - 3, 2, 3, GOLD)         # knob
    rect(d, ox, oy, 7, cy - 4, 4, 1, GOLD)

    # ---- cleaver swing (cutting) -----------------------------------------
    if cleaver is not None:
        ph = cleaver
        # shoulder -> hand, raising on 0/1 then chopping down-forward on 2/3
        angles = [-52, -18, 18, 40]
        a = math.radians(angles[ph])
        sx, sy = 31, ty + 3
        hx = sx + int(math.cos(a) * 8)
        hy2 = sy + int(math.sin(a) * 8)
        rect(d, ox, oy, 30, ty + 1, 4, 5, UNI_S)      # shoulder cap
        line(d, ox, oy, sx, sy, hx, hy2, UNI, 3)      # sleeve
        rect(d, ox, oy, hx - 1, hy2 - 1, 3, 3, SKIN)  # fist
        # wooden handle continues along the same vector past the fist
        gx = hx + int(math.cos(a) * 4)
        gy = hy2 + int(math.sin(a) * 4)
        line(d, ox, oy, hx, hy2, gx, gy, HANDLE, 2)
        # blade hangs off the far end of the handle
        if ph <= 1:
            rect(d, ox, oy, gx - 1, gy - 8, 8, 8, CLEAVER)
            rect(d, ox, oy, gx - 1, gy - 8, 8, 1, CLEAVER_S)
            rect(d, ox, oy, gx + 5, gy - 8, 2, 8, CLEAVER_S)
            rect(d, ox, oy, gx - 1, gy - 1, 8, 1, (255, 255, 255, 255))
        else:
            rect(d, ox, oy, gx, gy - 4, 9, 8, CLEAVER)
            rect(d, ox, oy, gx, gy - 4, 9, 1, CLEAVER_S)
            rect(d, ox, oy, gx, gy + 3, 9, 1, (255, 255, 255, 255))
            rect(d, ox, oy, gx + 7, gy - 4, 2, 8, CLEAVER_S)


def chef_crouch(d, ox, oy, *, bob=0):
    """
    Dedicated compact crouch pose. The standing rig cannot compress into the
    24px crouch AABB, so this is drawn from scratch: the whole silhouette
    lives in y = 16..46 (30px) and reads as the chef ducking behind cover.
    """
    t = bob

    # ---- tucked legs ------------------------------------------------------
    rect(d, ox, oy, 15, 41, 8, 5, PANT_B)
    rect(d, ox, oy, 24, 41, 9, 5, PANT_A)
    rect(d, ox, oy, 14, 45, 10, 2, SHOE)
    rect(d, ox, oy, 24, 45, 10, 2, SHOE)

    # ---- hunched torso ----------------------------------------------------
    ty = 36 + t
    rect(d, ox, oy, 14, ty, 20, 42 - ty + t, UNI)
    rect(d, ox, oy, 14, ty, 20, 1, UNI_S)
    rect(d, ox, oy, 31, ty, 3, 42 - ty + t, UNI_S)
    rect(d, ox, oy, 21, ty + 2, 1, 1, UNI_D)
    rect(d, ox, oy, 26, ty + 2, 1, 1, UNI_D)

    # ---- head -------------------------------------------------------------
    hy = 26 + t
    rect(d, ox, oy, 19, hy + 9, 11, 2, UNI)        # collar
    rect(d, ox, oy, 17, hy, 14, 10, SKIN)
    rect(d, ox, oy, 29, hy + 1, 2, 9, SKIN_S)
    rect(d, ox, oy, 16, hy + 4, 1, 3, SKIN_S)
    rect(d, ox, oy, 31, hy + 4, 1, 3, SKIN_S)
    rect(d, ox, oy, 20, hy + 2, 3, 1, HAIR)        # brows
    rect(d, ox, oy, 26, hy + 2, 3, 1, HAIR)
    rect(d, ox, oy, 21, hy + 4, 2, 2, EYE)
    rect(d, ox, oy, 27, hy + 4, 2, 2, EYE)
    rect(d, ox, oy, 19, hy + 7, 11, 2, HAIR)       # mustache
    rect(d, ox, oy, 18, hy + 6, 2, 2, HAIR)
    rect(d, ox, oy, 29, hy + 6, 2, 2, HAIR)
    rect(d, ox, oy, 22, hy + 9, 5, 1, MOUTH)

    # ---- squat toque ------------------------------------------------------
    ky = hy - 10
    rect(d, ox, oy, 17, ky + 7, 14, 3, UNI)
    rect(d, ox, oy, 17, ky + 9, 14, 1, UNI_S)
    ell(d, ox, oy, 15, ky + 1, 9, 8, UNI)
    ell(d, ox, oy, 24, ky + 1, 9, 8, UNI)
    ell(d, ox, oy, 19, ky, 10, 9, UNI)
    ell(d, ox, oy, 25, ky + 3, 6, 5, UNI_S)
    rect(d, ox, oy, 16, ky + 5, 16, 3, UNI)

    # ---- cloche held low in front ----------------------------------------
    cy = 34 + t
    rect(d, ox, oy, 12, cy + 1, 4, 3, UNI)         # forearm
    rect(d, ox, oy, 9, cy + 3, 4, 3, SKIN)         # hand
    rect(d, ox, oy, 2, cy + 6, 13, 2, SILVER)      # plate
    rect(d, ox, oy, 2, cy + 8, 13, 1, SILVER_S)
    ell(d, ox, oy, 3, cy, 11, 8, SILVER)           # dome
    rect(d, ox, oy, 3, cy + 3, 11, 3, SILVER)
    ell(d, ox, oy, 4, cy + 1, 4, 4, SILVER_H)
    rect(d, ox, oy, 11, cy + 2, 3, 4, SILVER_S)
    rect(d, ox, oy, 8, cy - 2, 2, 3, GOLD)         # knob


def make_player_idle():
    """PLAYER_IDLE — 48x48, 4 frames, 8 fps. Gentle breathing + a blink."""
    img = sheet(4)
    poses = [
        dict(bob=0, larm=0, blink=False),
        dict(bob=-1, larm=1, blink=False),
        dict(bob=0, larm=0, blink=True),
        dict(bob=1, larm=0, blink=False),
    ]
    for i, p in enumerate(poses):
        d, ox, oy = cell(img, i)
        chef(d, ox, oy, **p)
    img.save(os.path.join(SPR, "player_idle.png"))


def make_player_run():
    """PLAYER_RUN — 48x48, 6 frames, 12 fps. Full contact/pass/push cycle."""
    img = sheet(6)
    cyc = [
        dict(bob=0, lleg=-5, rleg=5, rarm=1, larm=0),
        dict(bob=-2, lleg=-2, rleg=2, rarm=1, larm=1),
        dict(bob=-1, lleg=2, rleg=-2, rarm=0, larm=1),
        dict(bob=0, lleg=5, rleg=-5, rarm=-1, larm=0),
        dict(bob=-2, lleg=2, rleg=-2, rarm=-1, larm=1),
        dict(bob=-1, lleg=-2, rleg=2, rarm=0, larm=1),
    ]
    for i, p in enumerate(cyc):
        d, ox, oy = cell(img, i)
        chef(d, ox, oy, **p)
    img.save(os.path.join(SPR, "player_run.png"))


def make_player_jump():
    """PLAYER_JUMP — 48x48, 3 frames, 10 fps: launch / apex / fall."""
    img = sheet(3)
    poses = [
        dict(bob=-2, squash=2, lleg=-3, rleg=3, larm=1, rarm=1),
        dict(bob=-3, squash=1, lleg=-2, rleg=2, larm=1, rarm=-1),
        dict(bob=-1, squash=-1, lleg=3, rleg=-3, larm=0, rarm=-1),
    ]
    for i, p in enumerate(poses):
        d, ox, oy = cell(img, i)
        chef(d, ox, oy, **p)
    img.save(os.path.join(SPR, "player_jump.png"))


def make_player_crouch():
    """PLAYER_CROUCH — 48x48, 2 frames, 6 fps. Art sits in y = 16..46."""
    img = sheet(2)
    for i, b in enumerate((0, 1)):
        d, ox, oy = cell(img, i)
        chef_crouch(d, ox, oy, bob=b)
    img.save(os.path.join(SPR, "player_crouch.png"))


def make_player_shoot():
    """PLAYER_SHOOT — 48x48, 4 frames, 16 fps, single-play cleaver chop."""
    img = sheet(4)
    for i in range(4):
        d, ox, oy = cell(img, i)
        chef(d, ox, oy, bob=(0 if i < 2 else 1), larm=1, cleaver=i)
        # motion arc trailing the blade on the two strike frames
        if i >= 2:
            dd = ImageDraw.Draw(img)
            for k in range(5):
                yy = 24 + k * 2
                rect(dd, ox, oy, 34 + k, yy, 2, 1, (255, 255, 255, 120))
    img.save(os.path.join(SPR, "player_shoot.png"))


# ================================================================= sheep ====
def sheep(d, ox, oy, *, bob=0, legs=0, head_down=False, rear=0, mouth=0):
    """
    Woolly sheep, ~40x28, hooves on y=46, body centred on x=22. Faces RIGHT.
    The 28x28 AABB in game.js is centred on the same point.

    legs      : -2..2 gait bucket (front/back pairs swing in opposition)
    head_down : grazing pose
    rear      : 0 normal, 1..2 rearing back for the grass-spit attack
    mouth     : 0 closed, 1 open (spitting)
    """
    t = bob
    lift = rear * 3          # front end rises when rearing

    # ---- legs (drawn first; the wool mass covers their tops) --------------
    #        x   swing-sign  lifted-with-the-front-end
    for dx, sg, up in ((9, 1, 0), (14, -1, 0),
                       (23, -1, lift), (28, 1, lift)):
        fx = dx + sg * legs
        sh_y = 39 - up                      # shank top
        sh_h = max(3, 6 - up)               # shank never collapses to nothing
        rect(d, ox, oy, dx, 34 - up, 5, 6, SHEEPFACE)                 # thigh
        rect(d, ox, oy, fx, sh_y, 5, sh_h, SHEEPFACE)                 # shank
        rect(d, ox, oy, fx - 1, sh_y + sh_h - 1, 6, 2, SHEEPFACE_S)   # hoof

    # ---- woolly body: confined to x 3..33, y 17..38 -----------------------
    by = 17 + t
    rect(d, ox, oy, 8, by + 7, 23, 12, WOOL)
    for cx, cy, r in ((3, 5, 10), (8, 1, 12), (15, 0, 13), (22, 2, 12),
                      (7, 9, 11), (15, 9, 12), (22, 8, 11)):
        ell(d, ox, oy, cx, by + cy, r, r, WOOL)
    # rump + belly shading
    ell(d, ox, oy, 21, by + 8, 12, 11, WOOL_S)
    rect(d, ox, oy, 9, by + 15, 21, 3, WOOL_S)
    rect(d, ox, oy, 10, by + 18, 19, 1, WOOL_D)
    # curl highlights along the back
    for cx, cy in ((10, 2), (17, 1), (24, 3)):
        rect(d, ox, oy, cx, by + cy, 3, 2, (255, 255, 255, 255))
    # tail
    ell(d, ox, oy, 1, by + 9, 7, 7, WOOL)
    rect(d, ox, oy, 1, by + 12, 4, 3, WOOL_S)

    # ---- head: a large DARK skull, deliberately un-woolly so that the
    #      silhouette separates cleanly from the white fleece behind it.
    hx = 29 + rear
    hy = by + (8 if head_down else 1) - lift
    # ear sweeping back, behind the skull
    ell(d, ox, oy, hx - 5, hy + 6, 10, 5, SHEEPFACE_S)
    # neck bridging body -> skull
    rect(d, ox, oy, hx - 4, hy + 7, 8, 8, SHEEPFACE)
    # skull
    ell(d, ox, oy, hx, hy + 2, 16, 16, SHEEPFACE)
    rect(d, ox, oy, hx + 3, hy + 7, 12, 9, SHEEPFACE)
    # small wool cap on the crown only
    rect(d, ox, oy, hx + 1, hy, 9, 4, WOOL)
    rect(d, ox, oy, hx + 2, hy, 5, 2, (255, 255, 255, 255))
    rect(d, ox, oy, hx + 1, hy + 4, 9, 1, WOOL_S)
    # eye — 3x3 white with a 2x2 pupil low-right, so it reads as a pupil
    rect(d, ox, oy, hx + 8, hy + 7, 3, 3, TEETH)
    rect(d, ox, oy, hx + 9, hy + 8, 2, 2, EYE)
    # pale muzzle jutting forward
    rect(d, ox, oy, hx + 11, hy + 10, 6, 5, WOOL_S)
    rect(d, ox, oy, hx + 11, hy + 10, 6, 1, WOOL)
    rect(d, ox, oy, hx + 15, hy + 11, 1, 1, SHEEPFACE_S)
    if mouth:
        # open mouth = the bottom lip of the muzzle, never floating in air
        rect(d, ox, oy, hx + 11, hy + 13, 6, 2, MOUTH)
        rect(d, ox, oy, hx + 12, hy + 14, 4, 1, GRASS_D)


def make_enemy_walk():
    """ENEMY_WALK — 48x48, 4 frames, 8 fps. Grazing/walking sheep."""
    img = sheet(4)
    poses = [
        dict(bob=0, legs=2, head_down=False),
        dict(bob=-1, legs=0, head_down=True),
        dict(bob=0, legs=-2, head_down=False),
        dict(bob=-1, legs=0, head_down=True),
    ]
    for i, p in enumerate(poses):
        d, ox, oy = cell(img, i)
        sheep(d, ox, oy, **p)
    img.save(os.path.join(SPR, "enemy_thug_walk.png"))


def make_enemy_attack():
    """ENEMY_ATTACK — 48x48, 4 frames, 10 fps. Rear up, spit a grass wad."""
    img = sheet(4)
    poses = [
        dict(rear=0, legs=0, mouth=0),
        dict(rear=1, legs=1, mouth=0),
        dict(rear=2, legs=2, mouth=1),
        dict(rear=1, legs=0, mouth=1),
    ]
    for i, p in enumerate(poses):
        d, ox, oy = cell(img, i)
        sheep(d, ox, oy, **p)
        if i >= 2:
            # the grass wad leaving the muzzle (the projectile spawn point)
            dd = ImageDraw.Draw(img)
            ell(dd, ox, oy, 41, 22 + (i - 2) * 2, 6, 6, GRASS)
            rect(dd, ox, oy, 43, 21 + (i - 2) * 2, 2, 4, GRASS_D)
    img.save(os.path.join(SPR, "enemy_thug_attack.png"))


# =============================================================== tileset ====
TS = 16          # tile pixel size
TS_COLS = 8      # tileset atlas is 8 x 4 tiles = 128 x 64 px


def make_tileset():
    """
    Grid-based environment atlas. Tile ids are read column-major-free:
        id = row * 8 + col        (id 0 is reserved as empty/air)
    See TILE.* in game.js for the semantic mapping.
    """
    img = Image.new("RGBA", (TS * TS_COLS, TS * 4), TRANSPARENT)
    d = ImageDraw.Draw(img)

    def at(idx):
        return (idx % TS_COLS) * TS, (idx // TS_COLS) * TS

    # --- 1: checkered restaurant floor, top surface -------------------------
    x, y = at(1)
    rect(d, x, y, 0, 0, 16, 16, (222, 216, 206, 255))
    rect(d, x, y, 0, 0, 8, 8, (58, 52, 60, 255))
    rect(d, x, y, 8, 8, 8, 8, (58, 52, 60, 255))
    rect(d, x, y, 0, 0, 16, 1, (250, 246, 240, 255))

    # --- 2: floor fill / substrate -----------------------------------------
    x, y = at(2)
    rect(d, x, y, 0, 0, 16, 16, (92, 66, 52, 255))
    rect(d, x, y, 0, 0, 16, 2, (74, 52, 42, 255))
    for i in range(0, 16, 4):
        rect(d, x, y, i, 6, 3, 1, (74, 52, 42, 255))
        rect(d, x, y, (i + 2) % 16, 12, 3, 1, (74, 52, 42, 255))

    # --- 3: brick wall ------------------------------------------------------
    x, y = at(3)
    rect(d, x, y, 0, 0, 16, 16, (150, 84, 66, 255))
    for r in range(0, 16, 4):
        rect(d, x, y, 0, r, 16, 1, (112, 60, 48, 255))
        off = 0 if (r // 4) % 2 == 0 else 8
        rect(d, x, y, off, r, 1, 4, (112, 60, 48, 255))
        rect(d, x, y, (off + 8) % 16, r, 1, 4, (112, 60, 48, 255))

    # --- 4: one-way porcelain plate platform -------------------------------
    x, y = at(4)
    rect(d, x, y, 0, 3, 16, 2, (250, 250, 252, 255))
    rect(d, x, y, 1, 5, 14, 2, (226, 228, 238, 255))
    rect(d, x, y, 3, 7, 10, 1, (196, 200, 214, 255))
    rect(d, x, y, 0, 3, 16, 1, (255, 255, 255, 255))
    rect(d, x, y, 2, 4, 3, 1, (255, 255, 255, 255))

    # --- 5: lahmacun climbable layer ---------------------------------------
    x, y = at(5)
    rect(d, x, y, 0, 0, 16, 16, (214, 168, 104, 255))
    rect(d, x, y, 0, 0, 16, 2, (232, 190, 128, 255))
    for px_, py_ in ((2, 4), (7, 3), (11, 6), (4, 9), (9, 11), (13, 12), (5, 13)):
        rect(d, x, y, px_, py_, 2, 2, (136, 62, 48, 255))
    for px_, py_ in ((3, 7), (10, 4), (12, 9)):
        rect(d, x, y, px_, py_, 1, 1, (96, 148, 70, 255))
    rect(d, x, y, 0, 15, 16, 1, (176, 128, 76, 255))

    # --- 6: doner kebab climbable column -----------------------------------
    x, y = at(6)
    rect(d, x, y, 3, 0, 10, 16, (168, 92, 54, 255))
    rect(d, x, y, 3, 0, 3, 16, (198, 122, 70, 255))
    rect(d, x, y, 11, 0, 2, 16, (128, 66, 40, 255))
    for r in range(0, 16, 3):
        rect(d, x, y, 3, r, 10, 1, (214, 148, 88, 255))
    rect(d, x, y, 7, 0, 2, 16, (232, 176, 110, 255))

    # --- 7: potted tree, LOWER half — planter + trunk (cover element) ------
    #        Trees are authored two tiles tall: id 12 sits directly above id 7,
    #        which is what makes them tall enough to actually hide a crouching
    #        chef from a sheep's line of sight.
    x, y = at(7)
    rect(d, x, y, 3, 6, 10, 10, (170, 96, 62, 255))
    rect(d, x, y, 3, 6, 10, 1, (198, 122, 82, 255))
    rect(d, x, y, 3, 6, 2, 10, (198, 122, 82, 255))
    rect(d, x, y, 12, 6, 1, 10, (132, 72, 46, 255))
    rect(d, x, y, 3, 9, 10, 1, (198, 122, 82, 255))
    rect(d, x, y, 7, 0, 2, 6, (110, 74, 46, 255))
    ell(d, x, y, 1, 0, 7, 6, (74, 148, 78, 255))
    ell(d, x, y, 8, 0, 7, 6, (60, 128, 66, 255))

    # --- 12: potted tree, UPPER half — the foliage crown -------------------
    x, y = at(12)
    ell(d, x, y, 0, 5, 10, 11, (74, 148, 78, 255))
    ell(d, x, y, 6, 5, 10, 11, (60, 128, 66, 255))
    ell(d, x, y, 2, 1, 12, 12, (92, 172, 92, 255))
    ell(d, x, y, 4, 2, 6, 6, (128, 200, 116, 255))
    rect(d, x, y, 7, 12, 2, 4, (110, 74, 46, 255))

    # --- 8: wooden table top (solid) ---------------------------------------
    x, y = at(8)
    rect(d, x, y, 0, 0, 16, 6, (176, 118, 70, 255))
    rect(d, x, y, 0, 0, 16, 1, (208, 150, 96, 255))
    rect(d, x, y, 0, 5, 16, 1, (126, 80, 48, 255))
    rect(d, x, y, 6, 6, 4, 10, (140, 92, 56, 255))

    # --- 9: kitchen counter / stainless steel ------------------------------
    x, y = at(9)
    rect(d, x, y, 0, 0, 16, 16, (168, 176, 190, 255))
    rect(d, x, y, 0, 0, 16, 2, (214, 222, 234, 255))
    rect(d, x, y, 0, 7, 16, 1, (128, 136, 152, 255))
    rect(d, x, y, 2, 10, 12, 4, (140, 148, 164, 255))

    # --- 10: red carpet / rug surface --------------------------------------
    x, y = at(10)
    rect(d, x, y, 0, 0, 16, 16, (150, 52, 58, 255))
    rect(d, x, y, 0, 0, 16, 2, (188, 74, 78, 255))
    for i in range(0, 16, 5):
        rect(d, x, y, i, 5, 2, 2, (122, 40, 46, 255))
        rect(d, x, y, i + 2, 10, 2, 2, (122, 40, 46, 255))

    # --- 11: crate / flour sack stack --------------------------------------
    x, y = at(11)
    rect(d, x, y, 0, 0, 16, 16, (196, 150, 96, 255))
    rect(d, x, y, 0, 0, 16, 1, (222, 182, 126, 255))
    rect(d, x, y, 0, 0, 1, 16, (222, 182, 126, 255))
    rect(d, x, y, 15, 0, 1, 16, (150, 108, 66, 255))
    rect(d, x, y, 0, 15, 16, 1, (150, 108, 66, 255))
    line(d, x, y, 1, 1, 14, 14, (162, 118, 74, 255))
    line(d, x, y, 14, 1, 1, 14, (162, 118, 74, 255))

    img.save(os.path.join(ENV, "tileset.png"))


# ============================================================ backgrounds ===
BW, BH = 480, 270


def make_bg_far():
    """Parallax layer 1 — warm restaurant back wall, tiles horizontally."""
    img = Image.new("RGBA", (BW, BH), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    # sunny cream wall, warm gradient (bright & friendly, not a noir diner)
    for yy in range(BH):
        f = yy / BH
        c = (int(252 - 34 * f), int(224 - 44 * f), int(184 - 44 * f), 255)
        d.line([0, yy, BW, yy], fill=c)
    # cheerful wallpaper stripes
    for xx in range(0, BW, 24):
        rect(d, 0, 0, xx, 0, 12, 150, (255, 236, 200, 255))
    # wainscot panelling
    rect(d, 0, 0, 0, 150, BW, 120, (206, 132, 86, 255))
    rect(d, 0, 0, 0, 148, BW, 4, (250, 214, 160, 255))
    for xx in range(0, BW, 40):
        rect(d, 0, 0, xx, 156, 2, 108, (170, 100, 66, 255))
        rect(d, 0, 0, xx + 6, 162, 26, 90, (224, 158, 108, 255))
    # arched windows onto a bright blue-sky street
    for xx in range(30, BW, 120):
        rect(d, 0, 0, xx, 46, 56, 100, (146, 208, 240, 255))
        d.ellipse([xx, 22, xx + 55, 74], fill=(146, 208, 240, 255))
        # little clouds + a rooftop skyline outside
        d.ellipse([xx + 8, 52, xx + 26, 64], fill=(255, 255, 255, 255))
        d.ellipse([xx + 30, 44, xx + 46, 56], fill=(255, 255, 255, 255))
        rect(d, 0, 0, xx + 4, 118, 16, 28, (176, 200, 214, 255))
        rect(d, 0, 0, xx + 24, 108, 14, 38, (196, 216, 228, 255))
        rect(d, 0, 0, xx + 40, 122, 14, 24, (176, 200, 214, 255))
        # frame + mullions
        rect(d, 0, 0, xx - 2, 44, 60, 4, (240, 196, 140, 255))
        rect(d, 0, 0, xx - 2, 142, 60, 6, (240, 196, 140, 255))
        rect(d, 0, 0, xx + 26, 30, 3, 116, (240, 196, 140, 255))
        rect(d, 0, 0, xx, 82, 56, 3, (240, 196, 140, 255))
    # Hanging pendant lamps. The soft glow must be ALPHA-COMPOSITED: PIL's
    # `fill` REPLACES the destination pixel (alpha included), so drawing a
    # low-alpha shape straight onto the wall would punch a hole in it.
    glow = Image.new("RGBA", (BW, BH), TRANSPARENT)
    gd = ImageDraw.Draw(glow)
    for xx in range(114, BW, 120):        # hung in the gaps between windows
        rect(d, 0, 0, xx, 0, 2, 26, (150, 108, 70, 255))
        d.polygon([(xx - 12, 40), (xx + 14, 40), (xx + 7, 24), (xx - 5, 24)],
                  fill=(255, 206, 118, 255))
        rect(d, 0, 0, xx - 12, 40, 26, 2, (255, 232, 178, 255))
        for r in range(24, 4, -4):
            gd.ellipse([xx - r, 38 - r // 2, xx + r, 38 + r],
                       fill=(255, 240, 190, 16))
    img.alpha_composite(glow)
    # bunting garland — reads instantly as "friendly restaurant"
    for i, xx in enumerate(range(0, BW, 20)):
        col = [(232, 96, 96, 255), (250, 196, 84, 255), (108, 196, 128, 255),
               (110, 168, 232, 255)][i % 4]
        d.polygon([(xx, 8), (xx + 14, 8), (xx + 7, 22)], fill=col)
    rect(d, 0, 0, 0, 6, BW, 2, (168, 120, 80, 255))
    img.save(os.path.join(ENV, "background_far.png"))


def make_bg_near():
    """Parallax layer 2 — foreground furniture silhouettes, alpha, tiles."""
    img = Image.new("RGBA", (BW, BH), TRANSPARENT)
    d = ImageDraw.Draw(img)
    # Mid-tone furniture, not black silhouettes — the playfield must stay
    # readable and the mood stays bright.  Everything is drawn fully opaque
    # so overlapping shapes composite correctly (PIL's `fill` replaces the
    # destination pixel outright); the whole layer is knocked back to 78%
    # alpha in one pass at the end.
    WOOD = (146, 92, 58, 255)
    WOOD_L = (182, 122, 78, 255)
    CLOTH = (226, 118, 118, 255)
    LEAF = (86, 156, 96, 255)
    for xx in range(0, BW, 160):
        # dining table wearing a red-check cloth + two chairs
        rect(d, 0, 0, xx + 20, 196, 72, 6, WOOD_L)
        rect(d, 0, 0, xx + 22, 202, 68, 18, CLOTH)
        for i in range(xx + 24, xx + 88, 12):
            rect(d, 0, 0, i, 202, 5, 18, (250, 236, 236, 255))
        rect(d, 0, 0, xx + 50, 220, 8, 28, WOOD)
        rect(d, 0, 0, xx + 36, 244, 38, 5, WOOD)
        rect(d, 0, 0, xx + 4, 186, 8, 62, WOOD)
        rect(d, 0, 0, xx + 4, 186, 8, 26, WOOD_L)
        rect(d, 0, 0, xx + 100, 186, 8, 62, WOOD)
        rect(d, 0, 0, xx + 100, 186, 8, 26, WOOD_L)
        # a potted plant
        rect(d, 0, 0, xx + 132, 214, 16, 34, WOOD_L)
        d.ellipse([xx + 124, 176, xx + 156, 216], fill=LEAF)
        d.ellipse([xx + 130, 172, xx + 150, 196], fill=(112, 184, 118, 255))
    # ceiling beam with pot hooks
    rect(d, 0, 0, 0, 0, BW, 14, WOOD)
    rect(d, 0, 0, 0, 12, BW, 2, WOOD_L)
    for xx in range(0, BW, 48):
        rect(d, 0, 0, xx, 14, 10, 6, WOOD_L)

    # Single global knock-back of the alpha channel -> a translucent layer
    # with internally-correct compositing.
    a = img.getchannel("A").point(lambda v: int(v * 0.78))
    img.putalpha(a)
    img.save(os.path.join(ENV, "background_near.png"))


# ============================================================== hud atlas ===
def make_hud():
    """
    UI atlas, 128x64. Regions consumed by game.js HUD.draw():
        (0,0,16,16)   heart full        (16,0,16,16) heart empty
        (32,0,32,16)  bounty frame left cap / body
        (0,16,64,16)  banner plate
        (0,32,16,16)  sheep icon        (16,32,16,16) cleaver icon
        (32,32,16,16) extraction chevron
    """
    img = Image.new("RGBA", (128, 64), TRANSPARENT)
    d = ImageDraw.Draw(img)

    def heart(ox, fill, shade):
        ell(d, ox, 0, 2, 3, 6, 6, fill)
        ell(d, ox, 0, 8, 3, 6, 6, fill)
        d.polygon([(ox + 2, 7), (ox + 14, 7), (ox + 8, 14)], fill=fill)
        rect(d, ox, 0, 4, 4, 2, 2, shade)

    heart(0, (226, 66, 74, 255), (255, 160, 165, 255))
    heart(16, (70, 54, 62, 255), (96, 78, 86, 255))

    # bounty frame (32,0)-(64,16)
    rect(d, 32, 0, 0, 0, 32, 16, (26, 20, 28, 220))
    rect(d, 32, 0, 0, 0, 32, 1, (232, 186, 92, 255))
    rect(d, 32, 0, 0, 15, 32, 1, (232, 186, 92, 255))
    rect(d, 32, 0, 0, 0, 1, 16, (232, 186, 92, 255))
    rect(d, 32, 0, 31, 0, 1, 16, (232, 186, 92, 255))

    # banner plate (0,16)-(64,32)
    rect(d, 0, 16, 0, 0, 64, 16, (22, 16, 24, 235))
    rect(d, 0, 16, 0, 1, 64, 1, (226, 66, 74, 255))
    rect(d, 0, 16, 0, 14, 64, 1, (226, 66, 74, 255))

    # sheep icon (0,32)
    ell(d, 0, 32, 2, 5, 10, 8, WOOL)
    ell(d, 0, 32, 8, 4, 6, 6, SHEEPFACE)
    rect(d, 0, 32, 3, 12, 2, 3, SHEEPFACE)
    rect(d, 0, 32, 9, 12, 2, 3, SHEEPFACE)

    # cleaver icon (16,32)
    rect(d, 16, 32, 3, 3, 8, 7, CLEAVER)
    rect(d, 16, 32, 3, 9, 8, 1, CLEAVER_S)
    rect(d, 16, 32, 10, 10, 3, 4, HANDLE)

    # extraction chevron (32,32)
    d.polygon([(36, 34), (44, 42), (36, 50)], fill=(120, 255, 190, 255))
    d.polygon([(41, 34), (49, 42), (41, 50)], fill=(60, 200, 150, 255))

    img.save(os.path.join(UI, "hud_elements.png"))


# ==================================================================== ACT 2 ==
# Level 2 ("CAN USTA - MANGAL") assets: the diners, the kitchen line stations,
# the food/verdict icon set, and the kitchen back wall.
# =============================================================================

CUSTOMER_PALETTES = [
    dict(shirt=(226, 92, 86, 255),  shirt_s=(184, 66, 62, 255),
         hair=(92, 58, 40, 255),    pants=(72, 88, 132, 255),
         pants_s=(56, 68, 104, 255), skin=(241, 189, 141, 255),
         skin_s=(206, 148, 104, 255)),
    dict(shirt=(86, 180, 178, 255), shirt_s=(58, 138, 138, 255),
         hair=(46, 40, 44, 255),    pants=(98, 102, 116, 255),
         pants_s=(74, 78, 92, 255), skin=(206, 150, 104, 255),
         skin_s=(168, 116, 78, 255)),
    dict(shirt=(246, 196, 80, 255), shirt_s=(204, 156, 52, 255),
         hair=(210, 118, 58, 255),  pants=(134, 96, 66, 255),
         pants_s=(104, 72, 48, 255), skin=(250, 210, 172, 255),
         skin_s=(214, 168, 128, 255)),
]

HEART_R = (232, 84, 92, 255)
ANGRY_R = (226, 74, 64, 255)


def customer(d, ox, oy, pal, *, legs=0, bob=0, arms=0, mood='neutral'):
    """
    A cheerful diner, ~40px tall. Same anchor contract as every other actor:
    feet rest on y = 46 and the silhouette is centred on x = 24.

    legs  : -4..4 gait bucket
    arms  : -1 back, 0 neutral, 1 forward, 2 raised (delighted)
    mood  : 'neutral' | 'happy' | 'angry'
    """
    t = bob

    # ---- legs -------------------------------------------------------------
    for dx, sg in ((18, 1), (25, -1)):
        fx = dx + sg * legs
        rect(d, ox, oy, dx, 33 + t, 5, 8, pal['pants'])
        rect(d, ox, oy, fx, 40, 5, 4, pal['pants_s'])
        rect(d, ox, oy, fx - 1, 44, 7, 2, (52, 44, 52, 255))

    # ---- torso ------------------------------------------------------------
    ty = 21 + t
    rect(d, ox, oy, 16, ty, 17, 13, pal['shirt'])
    rect(d, ox, oy, 29, ty, 4, 13, pal['shirt_s'])
    rect(d, ox, oy, 16, ty + 12, 17, 2, pal['shirt_s'])
    rect(d, ox, oy, 22, ty, 5, 4, pal['shirt_s'])          # collar notch

    # ---- arms -------------------------------------------------------------
    if arms == 2:                                          # both thrown up
        for ax in (12, 32):
            rect(d, ox, oy, ax, ty - 9, 4, 11, pal['shirt'])
            rect(d, ox, oy, ax, ty - 13, 4, 5, pal['skin'])
    else:
        rect(d, ox, oy, 13 - arms, ty + 1, 4, 9, pal['shirt'])
        rect(d, ox, oy, 13 - arms, ty + 10, 4, 4, pal['skin'])
        rect(d, ox, oy, 32 + arms, ty + 1, 4, 9, pal['shirt_s'])
        rect(d, ox, oy, 32 + arms, ty + 10, 4, 4, pal['skin_s'])

    # ---- head -------------------------------------------------------------
    hy = 9 + t
    rect(d, ox, oy, 22, hy + 11, 5, 2, pal['skin_s'])      # neck
    rect(d, ox, oy, 17, hy, 14, 12, pal['skin'])
    rect(d, ox, oy, 29, hy + 1, 2, 11, pal['skin_s'])      # cheek shadow
    rect(d, ox, oy, 16, hy + 5, 1, 3, pal['skin_s'])       # ears
    rect(d, ox, oy, 31, hy + 5, 1, 3, pal['skin_s'])
    # hair
    ell(d, ox, oy, 16, hy - 4, 16, 11, pal['hair'])
    rect(d, ox, oy, 16, hy, 16, 3, pal['hair'])
    rect(d, ox, oy, 16, hy + 2, 3, 4, pal['hair'])
    rect(d, ox, oy, 29, hy + 2, 3, 4, pal['hair'])

    if mood == 'happy':
        # ^ ^ eyes and a wide open smile
        rect(d, ox, oy, 20, hy + 6, 3, 1, EYE)
        rect(d, ox, oy, 21, hy + 5, 1, 1, EYE)
        rect(d, ox, oy, 26, hy + 6, 3, 1, EYE)
        rect(d, ox, oy, 27, hy + 5, 1, 1, EYE)
        rect(d, ox, oy, 21, hy + 8, 7, 3, MOUTH)
        rect(d, ox, oy, 22, hy + 8, 5, 1, TEETH)
        # floating hearts
        for hx_, hy_ in ((8, 2), (34, 6), (20, 0)):
            rect(d, ox, oy, hx_, hy_ + 1, 4, 3, HEART_R)
            rect(d, ox, oy, hx_ + 1, hy_, 1, 1, HEART_R)
            rect(d, ox, oy, hx_ + 3, hy_, 1, 1, HEART_R)
            rect(d, ox, oy, hx_ + 1, hy_ + 4, 2, 1, HEART_R)
    elif mood == 'angry':
        rect(d, ox, oy, 20, hy + 4, 3, 1, HAIR)            # angled brows
        rect(d, ox, oy, 21, hy + 5, 3, 1, HAIR)
        rect(d, ox, oy, 27, hy + 4, 3, 1, HAIR)
        rect(d, ox, oy, 26, hy + 5, 3, 1, HAIR)
        rect(d, ox, oy, 21, hy + 6, 2, 2, EYE)
        rect(d, ox, oy, 27, hy + 6, 2, 2, EYE)
        rect(d, ox, oy, 21, hy + 10, 7, 2, MOUTH)          # frown
        rect(d, ox, oy, 22, hy + 9, 5, 1, MOUTH)
        # anger burst
        for bx, by_ in ((9, 4), (34, 2)):
            rect(d, ox, oy, bx, by_ + 2, 5, 1, ANGRY_R)
            rect(d, ox, oy, bx + 2, by_, 1, 5, ANGRY_R)
    else:
        rect(d, ox, oy, 20, hy + 4, 3, 1, HAIR)            # brows
        rect(d, ox, oy, 26, hy + 4, 3, 1, HAIR)
        rect(d, ox, oy, 21, hy + 6, 2, 2, EYE)
        rect(d, ox, oy, 27, hy + 6, 2, 2, EYE)
        rect(d, ox, oy, 22, hy + 10, 5, 1, MOUTH)


def make_customer():
    """
    CUSTOMER — 48x48 cells, 8 columns x 3 rows.
      cols 0-3 : walk cycle        cols 4-5 : waiting idle
      col  6   : delighted         col  7   : furious
      rows 0-2 : three different diners (game.js picks one via `variant`)
    """
    img = Image.new("RGBA", (48 * 8, 48 * 3), TRANSPARENT)
    poses = [
        dict(legs=4, bob=0, arms=1),      # 0 walk
        dict(legs=0, bob=-1, arms=0),     # 1
        dict(legs=-4, bob=0, arms=-1),    # 2
        dict(legs=0, bob=-1, arms=0),     # 3
        dict(legs=0, bob=0, arms=0),      # 4 idle
        dict(legs=0, bob=-1, arms=0),     # 5 idle
        dict(legs=0, bob=-1, arms=2, mood='happy'),   # 6
        dict(legs=0, bob=0, arms=0, mood='angry'),    # 7
    ]
    for row, pal in enumerate(CUSTOMER_PALETTES):
        d = ImageDraw.Draw(img)
        for col, p in enumerate(poses):
            customer(d, col * 48, row * 48, pal, **p)
    img.save(os.path.join(SPR, "customer.png"))


STAFF_PALETTES = [
    # KOMI (busser): green apron over a white tee, cap
    dict(shirt=(240, 240, 244, 255), shirt_s=(202, 204, 214, 255),
         trim=(86, 158, 96, 255),   trim_s=(60, 120, 70, 255),
         hair=(74, 52, 38, 255),    pants=(78, 84, 100, 255),
         pants_s=(58, 64, 78, 255), skin=(241, 189, 141, 255),
         skin_s=(206, 148, 104, 255), hat='cap'),
    # CIRAK (apprentice cook): chef whites, little toque
    dict(shirt=(248, 248, 252, 255), shirt_s=(203, 206, 220, 255),
         trim=(226, 130, 130, 255), trim_s=(184, 92, 96, 255),
         hair=(46, 40, 44, 255),    pants=(86, 92, 110, 255),
         pants_s=(60, 65, 82, 255), skin=(206, 150, 104, 255),
         skin_s=(168, 116, 78, 255), hat='toque'),
    # GARSON (waiter): black waistcoat, bow tie, napkin
    dict(shirt=(58, 54, 66, 255),   shirt_s=(40, 37, 48, 255),
         trim=(232, 186, 92, 255),  trim_s=(190, 148, 62, 255),
         hair=(210, 118, 58, 255),  pants=(46, 44, 56, 255),
         pants_s=(34, 32, 42, 255), skin=(250, 210, 172, 255),
         skin_s=(214, 168, 128, 255), hat='none'),
    # KASIYER (cashier): burgundy waistcoat, visor
    dict(shirt=(150, 62, 74, 255),  shirt_s=(112, 44, 56, 255),
         trim=(246, 200, 84, 255),  trim_s=(198, 158, 56, 255),
         hair=(92, 58, 40, 255),    pants=(66, 62, 76, 255),
         pants_s=(48, 45, 58, 255), skin=(236, 178, 132, 255),
         skin_s=(198, 142, 98, 255), hat='visor'),
]


def staff(d, ox, oy, pal, *, legs=0, bob=0, arms=0):
    """
    A hired hand, ~40px tall. Same anchor contract as everyone else: feet on
    y = 46, centred on x = 24. Distinguished from diners by the apron/trim
    colour and the headwear, so the player can read the line at a glance.
    """
    t = bob

    # ---- legs -------------------------------------------------------------
    for dx, sg in ((18, 1), (25, -1)):
        fx = dx + sg * legs
        rect(d, ox, oy, dx, 33 + t, 5, 8, pal['pants'])
        rect(d, ox, oy, fx, 40, 5, 4, pal['pants_s'])
        rect(d, ox, oy, fx - 1, 44, 7, 2, (46, 40, 48, 255))

    # ---- torso + apron/waistcoat -----------------------------------------
    ty = 21 + t
    rect(d, ox, oy, 16, ty, 17, 13, pal['shirt'])
    rect(d, ox, oy, 29, ty, 4, 13, pal['shirt_s'])
    rect(d, ox, oy, 19, ty + 3, 11, 11, pal['trim'])       # the apron
    rect(d, ox, oy, 19, ty + 3, 11, 1, pal['trim_s'])
    rect(d, ox, oy, 27, ty + 3, 3, 11, pal['trim_s'])
    rect(d, ox, oy, 21, ty, 2, 4, pal['trim'])             # apron straps
    rect(d, ox, oy, 26, ty, 2, 4, pal['trim'])

    # ---- arms -------------------------------------------------------------
    rect(d, ox, oy, 13 - arms, ty + 1, 4, 9, pal['shirt'])
    rect(d, ox, oy, 13 - arms, ty + 10, 4, 4, pal['skin'])
    rect(d, ox, oy, 32 + arms, ty + 1, 4, 9, pal['shirt_s'])
    rect(d, ox, oy, 32 + arms, ty + 10, 4, 4, pal['skin_s'])

    # ---- head -------------------------------------------------------------
    hy = 9 + t
    rect(d, ox, oy, 22, hy + 11, 5, 2, pal['skin_s'])
    rect(d, ox, oy, 17, hy, 14, 12, pal['skin'])
    rect(d, ox, oy, 29, hy + 1, 2, 11, pal['skin_s'])
    rect(d, ox, oy, 16, hy + 5, 1, 3, pal['skin_s'])
    rect(d, ox, oy, 31, hy + 5, 1, 3, pal['skin_s'])
    ell(d, ox, oy, 16, hy - 3, 16, 10, pal['hair'])
    rect(d, ox, oy, 16, hy, 16, 2, pal['hair'])
    rect(d, ox, oy, 20, hy + 4, 3, 1, HAIR)
    rect(d, ox, oy, 26, hy + 4, 3, 1, HAIR)
    rect(d, ox, oy, 21, hy + 6, 2, 2, EYE)
    rect(d, ox, oy, 27, hy + 6, 2, 2, EYE)
    rect(d, ox, oy, 21, hy + 10, 6, 1, MOUTH)              # friendly smile
    rect(d, ox, oy, 22, hy + 11, 4, 1, TEETH)

    # ---- headwear tells you the role instantly ---------------------------
    if pal['hat'] == 'cap':
        rect(d, ox, oy, 16, hy - 4, 16, 5, pal['trim'])
        rect(d, ox, oy, 16, hy - 4, 16, 1, pal['trim_s'])
        rect(d, ox, oy, 12, hy, 8, 2, pal['trim_s'])       # peak
    elif pal['hat'] == 'toque':
        # Clamped to the cell top: `bob` can lift the head, and an unclamped
        # crown would bleed up into the row above in the packed sheet.
        ky = max(0, hy - 8)
        rect(d, ox, oy, 17, ky + 5, 14, 3, UNI)
        ell(d, ox, oy, 16, ky, 8, 8, UNI)
        ell(d, ox, oy, 24, ky, 8, 8, UNI)
        ell(d, ox, oy, 20, ky, 8, 8, UNI)
        rect(d, ox, oy, 17, ky + 3, 14, 4, UNI)
    elif pal['hat'] == 'visor':
        rect(d, ox, oy, 16, hy - 2, 16, 3, pal['trim'])
        rect(d, ox, oy, 11, hy + 1, 9, 2, pal['trim_s'])

    # bow tie for the waiter, collar for everyone else
    if pal['hat'] == 'none':
        rect(d, ox, oy, 21, hy + 13, 3, 3, pal['trim'])
        rect(d, ox, oy, 25, hy + 13, 3, 3, pal['trim'])
        rect(d, ox, oy, 24, hy + 14, 1, 1, pal['trim_s'])


def make_staff():
    """
    STAFF — 48x48 cells, 4 columns x 4 rows.
      rows: 0 KOMI, 1 CIRAK, 2 GARSON, 3 KASIYER  (game.js picks via variant)
      cols: a 4-frame working loop
    """
    img = Image.new("RGBA", (48 * 4, 48 * 4), TRANSPARENT)
    poses = [
        dict(legs=0, bob=0, arms=0),
        dict(legs=2, bob=-1, arms=1),
        dict(legs=0, bob=0, arms=0),
        dict(legs=-2, bob=-1, arms=-1),
    ]
    for row, pal in enumerate(STAFF_PALETTES):
        d = ImageDraw.Draw(img)
        for col, p in enumerate(poses):
            staff(d, col * 48, row * 48, pal, **p)
    img.save(os.path.join(SPR, "staff.png"))


def make_stations():
    """
    STATIONS — 48x48 cells, 8 columns. Each station sits with its base on
    y = 46 so it lines up with the kitchen floor exactly like an actor.
      0 LAMB  1 SALT  2 PEPPER  3 CHILI  4 DOUGH  5 DONER  6 MANGAL  7 PASS
      8 OCAK (ilan panosu)   9 BULASIK   10 KAPI (kasaba cikan arka kapi)
      11 MASA (salondaki musteri masasi)
    """
    img = Image.new("RGBA", (48 * 12, 48), TRANSPARENT)
    d = ImageDraw.Draw(img)
    STEEL = (170, 178, 192, 255)
    STEEL_H = (216, 224, 236, 255)
    STEEL_S = (124, 132, 148, 255)
    WOODT = (168, 116, 70, 255)
    WOODT_S = (128, 84, 50, 255)
    MEAT = (226, 130, 130, 255)
    MEAT_S = (188, 92, 96, 255)

    def pedestal(ox, top=30):
        """Shared stainless plinth every prep station stands on."""
        rect(d, ox, 0, 8, top, 32, 46 - top, STEEL)
        rect(d, ox, 0, 8, top, 32, 2, STEEL_H)
        rect(d, ox, 0, 36, top, 4, 46 - top, STEEL_S)
        rect(d, ox, 0, 8, 44, 32, 2, STEEL_S)

    # --- 0 LAMB tray: raw skewers on a butcher block ----------------------
    ox = 0
    pedestal(ox, 28)
    rect(d, ox, 0, 6, 22, 36, 6, WOODT)
    rect(d, ox, 0, 6, 22, 36, 1, (198, 146, 96, 255))
    rect(d, ox, 0, 6, 27, 36, 1, WOODT_S)
    for i, sy in enumerate((14, 18)):
        rect(d, ox, 0, 9, sy, 30, 1, STEEL_H)              # skewer rod
        for k in range(4):
            rect(d, ox, 0, 11 + k * 7, sy - 3, 6, 5, MEAT)
            rect(d, ox, 0, 11 + k * 7, sy, 6, 2, MEAT_S)

    # --- 1 SALT shaker ----------------------------------------------------
    ox = 48
    pedestal(ox)
    rect(d, ox, 0, 17, 14, 14, 16, (250, 250, 252, 255))
    rect(d, ox, 0, 27, 14, 4, 16, (214, 216, 226, 255))
    rect(d, ox, 0, 16, 10, 16, 5, (196, 202, 216, 255))
    rect(d, ox, 0, 16, 10, 16, 1, STEEL_H)
    for hx_ in (19, 23, 27):
        rect(d, ox, 0, hx_, 12, 2, 2, (120, 126, 140, 255))
    rect(d, ox, 0, 19, 20, 5, 5, (232, 234, 244, 255))

    # --- 2 PEPPER mill ----------------------------------------------------
    ox = 96
    pedestal(ox)
    rect(d, ox, 0, 18, 12, 12, 18, (78, 60, 48, 255))
    rect(d, ox, 0, 26, 12, 4, 18, (56, 42, 34, 255))
    rect(d, ox, 0, 18, 12, 12, 2, (112, 88, 68, 255))
    rect(d, ox, 0, 16, 8, 16, 5, (94, 72, 56, 255))
    rect(d, ox, 0, 22, 4, 4, 5, (140, 112, 86, 255))
    for yy in (18, 22, 26):
        rect(d, ox, 0, 18, yy, 12, 1, (48, 36, 30, 255))

    # --- 3 CHILI (pul biber) bowl ----------------------------------------
    ox = 144
    pedestal(ox)
    ell(d, ox, 0, 12, 16, 24, 14, (238, 232, 220, 255))
    rect(d, ox, 0, 12, 20, 24, 6, (238, 232, 220, 255))
    ell(d, ox, 0, 14, 14, 20, 8, (206, 62, 44, 255))
    for px_, py_ in ((17, 16), (22, 15), (27, 17), (20, 18), (25, 18), (30, 16)):
        rect(d, ox, 0, px_, py_, 2, 2, (238, 108, 68, 255))
    rect(d, ox, 0, 12, 26, 24, 2, (206, 200, 188, 255))

    # --- 4 DOUGH tray (lahmacun) -----------------------------------------
    ox = 192
    pedestal(ox, 28)
    rect(d, ox, 0, 6, 24, 36, 4, STEEL)
    rect(d, ox, 0, 6, 24, 36, 1, STEEL_H)
    for cx in (13, 27):
        ell(d, ox, 0, cx - 8, 14, 17, 11, (226, 190, 132, 255))
        ell(d, ox, 0, cx - 6, 16, 13, 7, (198, 152, 96, 255))
        for k in range(3):
            rect(d, ox, 0, cx - 4 + k * 4, 18, 2, 2, (146, 70, 52, 255))

    # --- 5 DONER vertical spit -------------------------------------------
    ox = 240
    rect(d, ox, 0, 22, 4, 4, 42, (150, 158, 172, 255))     # the pole
    rect(d, ox, 0, 12, 4, 24, 3, STEEL_S)
    rect(d, ox, 0, 14, 40, 20, 4, STEEL)
    rect(d, ox, 0, 14, 40, 20, 1, STEEL_H)
    # the cone of meat
    for i, (yy, hh, w) in enumerate(((8, 6, 10), (14, 7, 14), (21, 7, 18),
                                     (28, 7, 16), (35, 5, 11))):
        x0 = 24 - w // 2
        rect(d, ox, 0, x0, yy, w, hh, (176, 98, 56, 255))
        rect(d, ox, 0, x0, yy, w, 1, (216, 152, 96, 255))
        rect(d, ox, 0, x0 + w - 3, yy, 3, hh, (134, 70, 42, 255))

    # --- 6 MANGAL (the barbecue) -----------------------------------------
    ox = 288
    rect(d, ox, 0, 10, 40, 3, 6, (60, 56, 66, 255))        # legs
    rect(d, ox, 0, 35, 40, 3, 6, (60, 56, 66, 255))
    rect(d, ox, 0, 4, 24, 40, 18, (74, 70, 82, 255))       # trough
    rect(d, ox, 0, 4, 24, 40, 2, (104, 100, 114, 255))
    rect(d, ox, 0, 4, 40, 40, 2, (48, 44, 54, 255))
    # glowing coals
    for i in range(7):
        cx = 7 + i * 5
        rect(d, ox, 0, cx, 28, 4, 4, (206, 74, 40, 255))
        rect(d, ox, 0, cx, 28, 4, 2, (246, 156, 60, 255))
        rect(d, ox, 0, cx + 1, 28, 2, 1, (255, 224, 140, 255))
    # grill grate
    for i in range(9):
        rect(d, ox, 0, 5 + i * 4, 22, 2, 3, (168, 172, 184, 255))
    rect(d, ox, 0, 4, 21, 40, 2, (196, 202, 214, 255))
    # heat shimmer
    rect(d, ox, 0, 12, 16, 2, 4, (255, 190, 110, 140))
    rect(d, ox, 0, 24, 13, 2, 5, (255, 190, 110, 120))
    rect(d, ox, 0, 33, 17, 2, 3, (255, 190, 110, 140))

    # --- 7 PASS (service window + bell) ----------------------------------
    ox = 336
    rect(d, ox, 0, 2, 26, 44, 6, WOODT)                    # the pass shelf
    rect(d, ox, 0, 2, 26, 44, 1, (206, 156, 104, 255))
    rect(d, ox, 0, 2, 31, 44, 1, WOODT_S)
    rect(d, ox, 0, 4, 32, 40, 14, (188, 132, 84, 255))
    for i in range(5):
        rect(d, ox, 0, 6 + i * 9, 33, 3, 13, WOODT_S)
    # brass bell
    ell(d, ox, 0, 16, 14, 15, 13, (232, 186, 92, 255))
    rect(d, ox, 0, 16, 20, 15, 5, (232, 186, 92, 255))
    ell(d, ox, 0, 18, 16, 6, 6, (255, 232, 168, 255))
    rect(d, ox, 0, 14, 24, 19, 2, (198, 152, 66, 255))
    rect(d, ox, 0, 22, 10, 3, 5, (198, 152, 66, 255))

    # --- 8 HIRING BOARD (the shop) ---------------------------------------
    ox = 384
    rect(d, ox, 0, 10, 34, 5, 12, WOODT_S)                 # post
    rect(d, ox, 0, 33, 34, 5, 12, WOODT_S)
    rect(d, ox, 0, 4, 6, 40, 30, (150, 100, 62, 255))      # frame
    rect(d, ox, 0, 6, 8, 36, 26, (74, 92, 74, 255))        # cork/felt
    rect(d, ox, 0, 4, 6, 40, 2, (198, 146, 96, 255))
    # pinned job notices
    for nx, ny, nw, nh in ((9, 11, 13, 10), (25, 10, 13, 12), (14, 23, 16, 8)):
        rect(d, ox, 0, nx, ny, nw, nh, (248, 244, 232, 255))
        rect(d, ox, 0, nx, ny, nw, 1, (255, 255, 255, 255))
        for ly in range(ny + 2, ny + nh - 1, 3):
            rect(d, ox, 0, nx + 2, ly, nw - 5, 1, (152, 148, 138, 255))
        rect(d, ox, 0, nx + nw // 2, ny - 1, 2, 2, (226, 74, 64, 255))   # pin
    # a chef's toque badge so it reads as "staff wanted"
    ell(d, ox, 0, 30, 26, 10, 8, (250, 250, 252, 255))
    rect(d, ox, 0, 31, 31, 8, 3, (250, 250, 252, 255))
    rect(d, ox, 0, 31, 33, 8, 1, (206, 210, 222, 255))

    # --- 9 BULASIK: the wash-up sink -------------------------------------
    ox = 432
    rect(d, ox, 0, 4, 26, 40, 20, STEEL)                   # unit
    rect(d, ox, 0, 4, 26, 40, 2, STEEL_H)
    rect(d, ox, 0, 40, 28, 4, 18, STEEL_S)
    rect(d, ox, 0, 4, 44, 40, 2, STEEL_S)
    # basin
    rect(d, ox, 0, 8, 28, 32, 12, (120, 128, 146, 255))
    rect(d, ox, 0, 9, 29, 30, 10, (96, 104, 122, 255))
    # water + suds
    rect(d, ox, 0, 10, 31, 28, 7, (108, 168, 206, 255))
    rect(d, ox, 0, 10, 31, 28, 2, (156, 208, 236, 255))
    for bx, by, bw in ((12, 28, 5), (20, 27, 6), (29, 28, 5)):
        ell(d, ox, 0, bx, by, bw, bw, (238, 246, 250, 255))
    # tap
    rect(d, ox, 0, 22, 14, 3, 12, (176, 184, 198, 255))
    rect(d, ox, 0, 22, 14, 10, 3, (196, 204, 218, 255))
    rect(d, ox, 0, 30, 16, 3, 5, (196, 204, 218, 255))
    rect(d, ox, 0, 18, 16, 4, 3, (150, 158, 174, 255))     # handle
    # a stack of dirty plates waiting
    for i, py_ in enumerate((24, 21, 18)):
        ell(d, ox, 0, 5, py_, 13, 5, (222, 216, 204, 255))
        ell(d, ox, 0, 7, py_ + 1, 9, 3, (188, 180, 166, 255))

    # --- 10 KAPI: the back door, the yard route to the butcher ----------
    ox = 480
    # frame
    rect(d, ox, 0, 6, 4, 36, 42, (120, 78, 48, 255))
    rect(d, ox, 0, 6, 4, 36, 3, (162, 110, 68, 255))
    # daylight spilling in from the yard
    rect(d, ox, 0, 10, 8, 28, 38, (238, 216, 168, 255))
    rect(d, ox, 0, 10, 8, 28, 3, (255, 244, 210, 255))
    # the door itself, standing ajar
    rect(d, ox, 0, 20, 7, 20, 39, WOODT)
    rect(d, ox, 0, 20, 7, 20, 2, (206, 156, 104, 255))
    rect(d, ox, 0, 38, 7, 2, 39, WOODT_S)
    for py_ in (12, 24, 36):
        rect(d, ox, 0, 23, py_, 14, 2, WOODT_S)
    rect(d, ox, 0, 23, 25, 3, 3, (232, 186, 92, 255))       # handle
    # butcher's hook sign hung over the lintel
    rect(d, ox, 0, 22, 0, 2, 5, (150, 158, 172, 255))
    rect(d, ox, 0, 14, 4, 20, 3, (150, 158, 172, 255))
    for hx in (17, 24, 31):
        rect(d, ox, 0, hx, 6, 1, 3, (170, 178, 192, 255))
        ell(d, ox, 0, hx - 2, 8, 6, 7, (226, 130, 130, 255))
        ell(d, ox, 0, hx - 1, 11, 4, 3, (188, 92, 96, 255))

    # --- 11 MASA: a dining table with two stools ------------------------
    ox = 528
    rect(d, ox, 0, 6, 26, 36, 5, WOODT)                    # table top
    rect(d, ox, 0, 6, 26, 36, 2, (206, 156, 104, 255))
    rect(d, ox, 0, 6, 30, 36, 1, WOODT_S)
    rect(d, ox, 0, 8, 31, 32, 8, (226, 118, 118, 255))     # check cloth
    for i in range(9, 40, 8):
        rect(d, ox, 0, i, 31, 4, 8, (250, 236, 236, 255))
    rect(d, ox, 0, 22, 39, 4, 7, WOODT_S)                  # pedestal
    rect(d, ox, 0, 16, 45, 16, 2, WOODT_S)
    for sx in (2, 40):                                     # stools
        rect(d, ox, 0, sx, 34, 7, 3, (168, 116, 70, 255))
        rect(d, ox, 0, sx + 2, 37, 3, 9, WOODT_S)
    ell(d, ox, 0, 14, 20, 9, 7, (250, 250, 252, 255))      # a plate + glass
    ell(d, ox, 0, 16, 22, 5, 3, (216, 220, 232, 255))
    rect(d, ox, 0, 27, 19, 4, 7, (214, 118, 52, 255))
    rect(d, ox, 0, 27, 18, 4, 1, (244, 176, 96, 255))

    img.save(os.path.join(SPR, "stations.png"))


# ---------------------------------------------------------------- the staff -

STAFF_ROLES = ['KOMI', 'GARSON', 'BULASIKCI', 'KASIYER', 'MUDUR',
               'KOMI2', 'CAYCI', 'KASAP']


def staffer(d, ox, oy, role, *, legs=0, bob=0, arms=0):
    """
    One member of staff, ~40px tall, sharing the diner rig and the universal
    anchor contract (feet on y = 46, centred on x = 24). The outfit is what
    tells the player which job they do, so each is deliberately distinct.
    """
    t = bob
    SKIN_ = (241, 189, 141, 255)
    SKINS_ = (206, 148, 104, 255)
    DARK = (52, 46, 56, 255)

    outfit = {
        'KOMI':      dict(top=(248, 248, 252, 255), top_s=(206, 210, 222, 255),
                          pants=(86, 92, 110, 255), pants_s=(62, 68, 84, 255)),
        'GARSON':    dict(top=(246, 246, 250, 255), top_s=(202, 204, 216, 255),
                          pants=(48, 44, 56, 255),  pants_s=(34, 32, 42, 255)),
        'BULASIKCI': dict(top=(232, 236, 240, 255), top_s=(190, 196, 204, 255),
                          pants=(70, 96, 138, 255), pants_s=(52, 72, 108, 255)),
        'KASIYER':   dict(top=(250, 250, 252, 255), top_s=(208, 210, 220, 255),
                          pants=(96, 82, 74, 255),  pants_s=(72, 60, 54, 255)),
        'MUDUR':     dict(top=(58, 62, 84, 255),    top_s=(40, 44, 62, 255),
                          pants=(44, 48, 66, 255),  pants_s=(32, 36, 50, 255)),
        # --- second wave of hires ---
        'KOMI2':     dict(top=(242, 244, 248, 255), top_s=(198, 202, 212, 255),
                          pants=(74, 82, 76, 255),  pants_s=(54, 62, 58, 255)),
        'CAYCI':     dict(top=(238, 240, 246, 255), top_s=(196, 200, 210, 255),
                          pants=(64, 58, 70, 255),  pants_s=(46, 42, 52, 255)),
        'KASAP':     dict(top=(248, 248, 252, 255), top_s=(206, 210, 222, 255),
                          pants=(92, 96, 108, 255), pants_s=(68, 72, 84, 255)),
    }[role]

    # ---- legs -------------------------------------------------------------
    for dx, sg in ((18, 1), (25, -1)):
        fx = dx + sg * legs
        rect(d, ox, oy, dx, 33 + t, 5, 8, outfit['pants'])
        rect(d, ox, oy, fx, 40, 5, 4, outfit['pants_s'])
        rect(d, ox, oy, fx - 1, 44, 7, 2, DARK)

    # ---- torso ------------------------------------------------------------
    ty = 21 + t
    rect(d, ox, oy, 16, ty, 17, 13, outfit['top'])
    rect(d, ox, oy, 29, ty, 4, 13, outfit['top_s'])
    rect(d, ox, oy, 16, ty + 12, 17, 2, outfit['top_s'])

    # ---- role-specific torso detail --------------------------------------
    if role == 'KOMI':
        for i in range(3):                                  # double-breasted
            rect(d, ox, oy, 21, ty + 2 + i * 3, 1, 1, outfit['top_s'])
            rect(d, ox, oy, 26, ty + 2 + i * 3, 1, 1, outfit['top_s'])
    elif role == 'GARSON':
        rect(d, ox, oy, 16, ty + 1, 5, 12, (44, 40, 52, 255))   # waistcoat
        rect(d, ox, oy, 28, ty + 1, 5, 12, (32, 30, 40, 255))
        rect(d, ox, oy, 22, ty, 4, 2, (198, 62, 58, 255))       # bow tie
    elif role == 'BULASIKCI':
        rect(d, ox, oy, 17, ty + 3, 15, 10, (70, 118, 172, 255))  # apron
        rect(d, ox, oy, 17, ty + 3, 15, 1, (104, 152, 202, 255))
        rect(d, ox, oy, 22, ty, 4, 4, (70, 118, 172, 255))
    elif role == 'KASIYER':
        rect(d, ox, oy, 17, ty + 4, 15, 9, (198, 74, 70, 255))    # red apron
        rect(d, ox, oy, 17, ty + 4, 15, 1, (228, 112, 106, 255))
        rect(d, ox, oy, 23, ty, 3, 5, (198, 74, 70, 255))
    elif role == 'MUDUR':
        rect(d, ox, oy, 22, ty, 4, 9, (240, 240, 246, 255))       # shirt
        rect(d, ox, oy, 23, ty + 1, 2, 8, (196, 66, 62, 255))     # tie
    elif role == 'KOMI2':
        rect(d, ox, oy, 17, ty + 3, 15, 10, (74, 110, 88, 255))   # green apron
        rect(d, ox, oy, 17, ty + 3, 15, 1, (104, 148, 118, 255))
        rect(d, ox, oy, 22, ty, 4, 4, (74, 110, 88, 255))
    elif role == 'CAYCI':
        rect(d, ox, oy, 16, ty + 1, 5, 12, (172, 46, 44, 255))    # red waistcoat
        rect(d, ox, oy, 28, ty + 1, 5, 12, (140, 34, 34, 255))
        rect(d, ox, oy, 22, ty, 4, 2, (232, 186, 92, 255))        # gold stud
    elif role == 'KASAP':
        rect(d, ox, oy, 17, ty + 3, 15, 10, (236, 238, 244, 255))  # butcher apron
        for i in range(17, 32, 4):                                 # red stripes
            rect(d, ox, oy, i, ty + 3, 2, 10, (198, 74, 70, 255))
        rect(d, ox, oy, 22, ty, 4, 4, (236, 238, 244, 255))

    # ---- arms -------------------------------------------------------------
    rect(d, ox, oy, 13 - arms, ty + 1, 4, 9, outfit['top'])
    rect(d, ox, oy, 13 - arms, ty + 10, 4, 4, SKIN_)
    rect(d, ox, oy, 32 + arms, ty + 1, 4, 9, outfit['top_s'])
    rect(d, ox, oy, 32 + arms, ty + 10, 4, 4, SKINS_)

    # ---- what they are carrying ------------------------------------------
    if role == 'GARSON':                                   # a tray
        rect(d, ox, oy, 8, ty + 8, 12, 2, (198, 206, 218, 255))
        rect(d, ox, oy, 9, ty + 6, 4, 2, (226, 190, 132, 255))
        rect(d, ox, oy, 14, ty + 6, 4, 2, (226, 190, 132, 255))
    elif role == 'BULASIKCI':                              # a clean plate
        ell(d, ox, oy, 8, ty + 6, 11, 6, (250, 250, 252, 255))
        ell(d, ox, oy, 10, ty + 7, 7, 3, (216, 220, 232, 255))
    elif role == 'MUDUR':                                  # a clipboard
        rect(d, ox, oy, 9, ty + 6, 8, 10, (168, 124, 78, 255))
        rect(d, ox, oy, 10, ty + 8, 6, 7, (248, 244, 232, 255))
        rect(d, ox, oy, 11, ty + 5, 4, 2, (150, 156, 170, 255))
    elif role == 'KOMI2':                                  # a stack of plates
        for i, py_ in enumerate((10, 7, 4)):
            ell(d, ox, oy, 8, ty + py_, 12, 5, (250, 250, 252, 255))
            ell(d, ox, oy, 10, ty + py_ + 1, 8, 3, (214, 218, 230, 255))
    elif role == 'CAYCI':                                  # tea tray + glasses
        rect(d, ox, oy, 7, ty + 9, 14, 2, (198, 206, 218, 255))
        for gx in (9, 14, 18):
            rect(d, ox, oy, gx, ty + 5, 3, 4, (214, 118, 52, 255))
            rect(d, ox, oy, gx, ty + 4, 3, 1, (244, 176, 96, 255))
    elif role == 'KASAP':                                  # a cleaver
        rect(d, ox, oy, 9, ty + 4, 8, 7, (222, 231, 244, 255))
        rect(d, ox, oy, 9, ty + 10, 8, 1, (150, 162, 184, 255))
        rect(d, ox, oy, 12, ty + 11, 3, 4, (110, 72, 44, 255))

    # ---- head -------------------------------------------------------------
    hy = 9 + t
    rect(d, ox, oy, 22, hy + 11, 5, 2, SKINS_)
    rect(d, ox, oy, 17, hy, 14, 12, SKIN_)
    rect(d, ox, oy, 29, hy + 1, 2, 11, SKINS_)
    rect(d, ox, oy, 16, hy + 5, 1, 3, SKINS_)
    rect(d, ox, oy, 31, hy + 5, 1, 3, SKINS_)
    rect(d, ox, oy, 20, hy + 4, 3, 1, HAIR)
    rect(d, ox, oy, 26, hy + 4, 3, 1, HAIR)
    rect(d, ox, oy, 21, hy + 6, 2, 2, EYE)
    rect(d, ox, oy, 27, hy + 6, 2, 2, EYE)
    rect(d, ox, oy, 22, hy + 9, 5, 1, MOUTH)               # a working smile

    # ---- headwear, the clearest role tell --------------------------------
    if role == 'KOMI':                                     # short toque
        rect(d, ox, oy, 17, hy - 3, 14, 4, (248, 248, 252, 255))
        ell(d, ox, oy, 17, hy - 8, 14, 8, (248, 248, 252, 255))
        rect(d, ox, oy, 17, hy - 1, 14, 1, (206, 210, 222, 255))
    elif role == 'KASIYER':                                # visor
        rect(d, ox, oy, 16, hy - 2, 16, 3, (198, 74, 70, 255))
        rect(d, ox, oy, 12, hy + 1, 12, 2, (168, 56, 54, 255))
        ell(d, ox, oy, 17, hy - 5, 14, 7, HAIR)
    elif role == 'KASAP':                                  # flat butcher's cap
        ell(d, ox, oy, 17, hy - 5, 14, 8, HAIR)
        rect(d, ox, oy, 16, hy - 3, 16, 4, (236, 238, 244, 255))
        rect(d, ox, oy, 16, hy, 16, 1, (198, 202, 214, 255))
    elif role == 'CAYCI':                                  # neat side parting
        ell(d, ox, oy, 16, hy - 4, 16, 10, HAIR)
        rect(d, ox, oy, 16, hy, 16, 2, HAIR)
        rect(d, ox, oy, 26, hy - 2, 6, 3, (58, 50, 44, 255))
    else:                                                  # plain hair
        ell(d, ox, oy, 16, hy - 4, 16, 11, HAIR)
        rect(d, ox, oy, 16, hy, 16, 3, HAIR)
        rect(d, ox, oy, 16, hy + 2, 3, 4, HAIR)
        rect(d, ox, oy, 29, hy + 2, 3, 4, HAIR)


def make_staff():
    """
    STAFF — 48x48 cells, 6 columns x 5 rows.
      cols 0-3 : walk cycle      cols 4-5 : working idle
      rows     : KOMI, GARSON, BULASIKCI, KASIYER, MUDUR  (see STAFF in game.js)
    """
    img = Image.new("RGBA", (48 * 6, 48 * len(STAFF_ROLES)), TRANSPARENT)
    poses = [
        dict(legs=4, bob=0, arms=1),
        dict(legs=0, bob=-1, arms=0),
        dict(legs=-4, bob=0, arms=-1),
        dict(legs=0, bob=-1, arms=0),
        dict(legs=0, bob=0, arms=0),
        dict(legs=0, bob=-1, arms=1),
    ]
    d = ImageDraw.Draw(img)
    for row, role in enumerate(STAFF_ROLES):
        for col, p in enumerate(poses):
            staffer(d, col * 48, row * 48, role, **p)
    img.save(os.path.join(SPR, "staff.png"))


def make_stations_up():
    """
    STATIONS_UP — 64x64 cells, 8 columns: the upgraded equipment.
    Deliberately BIGGER than the 48x48 originals so a levelled-up kitchen
    reads at a glance. Two visual tiers per material:

        col 0/1  MANGAL   tier2 / tier3      (levels 3-4 / 5-6)
        col 2/3  SINK     tier2 / tier3
        col 4/5  PASS     tier2 / tier3
        col 6/7  LAMB     tier2 / tier3

    Everything is anchored so the base sits on y = 62.
    """
    W = 64
    img = Image.new("RGBA", (W * 8, W), TRANSPARENT)
    d = ImageDraw.Draw(img)
    STEEL = (170, 178, 192, 255)
    STEEL_H = (216, 224, 236, 255)
    STEEL_S = (124, 132, 148, 255)
    GOLD = (232, 186, 92, 255)
    WOODT = (168, 116, 70, 255)
    WOODT_S = (128, 84, 50, 255)
    MEAT = (226, 130, 130, 255)
    MEAT_S = (188, 92, 96, 255)

    def coals(ox, x0, y0, n, w=5):
        for i in range(n):
            cx = x0 + i * w
            rect(d, ox, 0, cx, y0, w - 1, 4, (206, 74, 40, 255))
            rect(d, ox, 0, cx, y0, w - 1, 2, (246, 156, 60, 255))
            rect(d, ox, 0, cx + 1, y0, 2, 1, (255, 224, 140, 255))

    def grate(ox, x0, y0, w, n):
        for i in range(n):
            rect(d, ox, 0, x0 + i * 4, y0, 2, 3, (168, 172, 184, 255))
        rect(d, ox, 0, x0 - 1, y0 - 1, w, 2, (196, 202, 214, 255))

    # ---------- 0: MANGAL tier 2 — wide grill with a back plate ----------
    ox = 0
    rect(d, ox, 0, 8, 56, 4, 6, (60, 56, 66, 255))
    rect(d, ox, 0, 52, 56, 4, 6, (60, 56, 66, 255))
    rect(d, ox, 0, 4, 34, 56, 24, (74, 70, 82, 255))
    rect(d, ox, 0, 4, 34, 56, 2, (104, 100, 114, 255))
    rect(d, ox, 0, 4, 56, 56, 2, (48, 44, 54, 255))
    coals(ox, 8, 40, 10)
    grate(ox, 6, 32, 54, 13)
    rect(d, ox, 0, 4, 22, 56, 4, STEEL_S)          # back splash
    rect(d, ox, 0, 4, 22, 56, 1, STEEL_H)
    for hx in (14, 30, 46):
        rect(d, ox, 0, hx, 16, 3, 7, (255, 190, 110, 150))

    # ---------- 1: MANGAL tier 3 — twin range under a hood --------------
    ox = W
    rect(d, ox, 0, 6, 56, 4, 6, (48, 44, 54, 255))
    rect(d, ox, 0, 54, 56, 4, 6, (48, 44, 54, 255))
    rect(d, ox, 0, 2, 32, 60, 26, (86, 82, 96, 255))
    rect(d, ox, 0, 2, 32, 60, 2, (124, 120, 136, 255))
    rect(d, ox, 0, 2, 56, 60, 2, (44, 40, 50, 255))
    coals(ox, 5, 38, 6)
    coals(ox, 35, 38, 6)
    grate(ox, 4, 30, 28, 7)
    grate(ox, 34, 30, 28, 7)
    rect(d, ox, 0, 30, 32, 3, 26, STEEL_S)         # divider
    # extractor hood + chimney
    d.polygon([(ox + 0, 20), (ox + 64, 20), (ox + 56, 8), (ox + 8, 8)],
              fill=(196, 204, 218, 255))
    rect(d, ox, 0, 0, 18, 64, 3, STEEL_S)
    rect(d, ox, 0, 26, 0, 12, 9, (168, 176, 190, 255))
    rect(d, ox, 0, 26, 0, 12, 2, STEEL_H)
    for hx in (12, 30, 48):
        rect(d, ox, 0, hx, 24, 3, 5, (255, 190, 110, 130))
    rect(d, ox, 0, 4, 12, 8, 3, GOLD)              # brass badge

    # ---------- 2: SINK tier 2 — double basin ---------------------------
    ox = W * 2
    rect(d, ox, 0, 2, 34, 60, 28, STEEL)
    rect(d, ox, 0, 2, 34, 60, 2, STEEL_H)
    rect(d, ox, 0, 58, 36, 4, 26, STEEL_S)
    rect(d, ox, 0, 2, 60, 60, 2, STEEL_S)
    for bx in (6, 34):
        rect(d, ox, 0, bx, 36, 24, 14, (120, 128, 146, 255))
        rect(d, ox, 0, bx + 1, 37, 22, 12, (96, 104, 122, 255))
        rect(d, ox, 0, bx + 2, 40, 20, 8, (108, 168, 206, 255))
        rect(d, ox, 0, bx + 2, 40, 20, 2, (156, 208, 236, 255))
        for i, sx in enumerate((bx + 3, bx + 10, bx + 17)):
            ell(d, ox, 0, sx, 36, 5, 5, (238, 246, 250, 255))
    rect(d, ox, 0, 30, 18, 3, 18, STEEL)           # tall mixer tap
    rect(d, ox, 0, 22, 18, 20, 3, STEEL_H)
    rect(d, ox, 0, 20, 20, 3, 6, STEEL_H)
    rect(d, ox, 0, 40, 20, 3, 6, STEEL_H)

    # ---------- 3: SINK tier 3 — industrial dishwasher ------------------
    ox = W * 3
    rect(d, ox, 0, 2, 20, 60, 42, STEEL)
    rect(d, ox, 0, 2, 20, 60, 3, STEEL_H)
    rect(d, ox, 0, 58, 22, 4, 40, STEEL_S)
    rect(d, ox, 0, 2, 60, 60, 2, STEEL_S)
    rect(d, ox, 0, 8, 28, 48, 26, (96, 104, 122, 255))   # glass door
    rect(d, ox, 0, 10, 30, 44, 22, (140, 190, 220, 255))
    for i in range(4):                                    # racked plates
        rect(d, ox, 0, 14 + i * 10, 33, 7, 16, (236, 240, 248, 255))
        rect(d, ox, 0, 14 + i * 10, 33, 7, 2, (255, 255, 255, 255))
    rect(d, ox, 0, 8, 26, 48, 3, STEEL_S)
    rect(d, ox, 0, 24, 22, 16, 3, GOLD)                   # control strip
    rect(d, ox, 0, 26, 22, 3, 3, (120, 255, 190, 255))
    for i, sy in enumerate((14, 10, 16)):                  # steam
        rect(d, ox, 0, 16 + i * 16, sy, 3, 6, (214, 236, 246, 150))

    # ---------- 4: PASS tier 2 — long counter + heat lamp ---------------
    ox = W * 4
    rect(d, ox, 0, 2, 34, 60, 8, WOODT)
    rect(d, ox, 0, 2, 34, 60, 2, (206, 156, 104, 255))
    rect(d, ox, 0, 2, 41, 60, 2, WOODT_S)
    rect(d, ox, 0, 4, 43, 56, 19, (188, 132, 84, 255))
    for i in range(6):
        rect(d, ox, 0, 8 + i * 9, 44, 4, 18, WOODT_S)
    rect(d, ox, 0, 10, 18, 44, 4, (120, 100, 92, 255))     # lamp bar
    for lx in (16, 32, 48):
        d.polygon([(ox + lx - 7, 30), (ox + lx + 7, 30),
                   (ox + lx + 4, 22), (ox + lx - 4, 22)], fill=(226, 176, 88, 255))
        rect(d, ox, 0, lx - 7, 30, 14, 2, (255, 226, 150, 255))
    ell(d, ox, 0, 26, 24, 13, 11, GOLD)                    # bell
    rect(d, ox, 0, 26, 30, 13, 4, GOLD)

    # ---------- 5: PASS tier 3 — full service station -------------------
    ox = W * 5
    rect(d, ox, 0, 0, 30, 64, 10, STEEL)
    rect(d, ox, 0, 0, 30, 64, 2, STEEL_H)
    rect(d, ox, 0, 0, 39, 64, 2, STEEL_S)
    rect(d, ox, 0, 2, 41, 60, 21, (196, 204, 218, 255))
    for i in range(5):
        rect(d, ox, 0, 6 + i * 12, 43, 8, 17, (168, 176, 190, 255))
    # heated glass display
    rect(d, ox, 0, 4, 10, 56, 20, (150, 200, 226, 120))
    rect(d, ox, 0, 4, 10, 56, 2, STEEL_H)
    rect(d, ox, 0, 4, 28, 56, 2, STEEL_S)
    rect(d, ox, 0, 4, 10, 2, 20, STEEL_S)
    rect(d, ox, 0, 58, 10, 2, 20, STEEL_S)
    for i in range(4):                                     # plated food
        ell(d, ox, 0, 8 + i * 13, 22, 11, 5, (250, 250, 252, 255))
        rect(d, ox, 0, 10 + i * 13, 19, 7, 4, (196, 122, 70, 255))
    ell(d, ox, 0, 25, 0, 15, 12, GOLD)                     # big brass bell
    rect(d, ox, 0, 25, 5, 15, 5, GOLD)
    ell(d, ox, 0, 28, 2, 6, 5, (255, 232, 168, 255))

    # ---------- 6: LAMB tier 2 — bigger block, hanging cuts -------------
    ox = W * 6
    rect(d, ox, 0, 4, 38, 56, 10, WOODT)
    rect(d, ox, 0, 4, 38, 56, 2, (198, 146, 96, 255))
    rect(d, ox, 0, 4, 46, 56, 2, WOODT_S)
    rect(d, ox, 0, 8, 48, 48, 14, STEEL)
    rect(d, ox, 0, 8, 48, 48, 2, STEEL_H)
    rect(d, ox, 0, 6, 16, 52, 3, STEEL_S)                  # rail
    for hx in (14, 30, 46):                                # hanging cuts
        rect(d, ox, 0, hx, 19, 2, 5, STEEL_S)
        ell(d, ox, 0, hx - 5, 22, 12, 14, MEAT)
        ell(d, ox, 0, hx - 3, 26, 8, 8, MEAT_S)
    for sy in (30, 34):                                    # skewers on the block
        rect(d, ox, 0, 10, sy, 44, 1, STEEL_H)
        for k in range(6):
            rect(d, ox, 0, 12 + k * 7, sy - 3, 6, 5, MEAT)

    # ---------- 7: LAMB tier 3 — cold display cabinet -------------------
    ox = W * 7
    rect(d, ox, 0, 2, 6, 60, 56, STEEL)
    rect(d, ox, 0, 2, 6, 60, 3, STEEL_H)
    rect(d, ox, 0, 58, 8, 4, 54, STEEL_S)
    rect(d, ox, 0, 2, 60, 60, 2, STEEL_S)
    rect(d, ox, 0, 6, 12, 52, 40, (168, 214, 232, 110))    # chilled glass
    rect(d, ox, 0, 6, 12, 52, 2, (226, 244, 252, 255))
    for shelf in (16, 30):
        rect(d, ox, 0, 8, shelf + 12, 48, 2, STEEL_S)
        for k in range(4):
            rect(d, ox, 0, 11 + k * 12, shelf, 9, 12, MEAT)
            rect(d, ox, 0, 11 + k * 12, shelf, 9, 3, (244, 168, 168, 255))
            rect(d, ox, 0, 11 + k * 12, shelf + 8, 9, 4, MEAT_S)
    rect(d, ox, 0, 20, 0, 24, 7, GOLD)                     # brand strip
    rect(d, ox, 0, 22, 2, 20, 3, (255, 232, 168, 255))
    rect(d, ox, 0, 8, 54, 20, 4, (120, 255, 190, 255))     # chiller readout

    img.save(os.path.join(SPR, "stations_up.png"))


def make_food_icons():
    """
    FOOD_ICONS — 16x16 cells, 8 columns x 2 rows. Used for order bubbles,
    the ticket rail, the menu board and verdict popups.
      0 LAMB  1 SALT  2 PEPPER  3 CHILI  4 LAHMACUN  5 DONER  6 GOOD  7 BURNT
      8 HEART 9 ANGRY 10 FLAME 11 CHECK 12 CROSS 13 PLATE 14 CLOCK 15 STAR
    """
    img = Image.new("RGBA", (16 * 8, 16 * 2), TRANSPARENT)
    d = ImageDraw.Draw(img)

    def at(i):
        return (i % 8) * 16, (i // 8) * 16

    # 0 raw lamb skewer
    x, y = at(0)
    rect(d, x, y, 1, 7, 14, 1, (206, 212, 226, 255))
    for k in range(3):
        rect(d, x, y, 2 + k * 4, 4, 4, 7, (226, 130, 130, 255))
        rect(d, x, y, 2 + k * 4, 8, 4, 3, (188, 92, 96, 255))

    # 1 salt
    x, y = at(1)
    rect(d, x, y, 5, 6, 7, 8, (250, 250, 252, 255))
    rect(d, x, y, 10, 6, 2, 8, (212, 214, 224, 255))
    rect(d, x, y, 4, 3, 9, 4, (188, 194, 208, 255))
    rect(d, x, y, 6, 4, 2, 2, (110, 116, 130, 255))
    rect(d, x, y, 9, 4, 2, 2, (110, 116, 130, 255))

    # 2 pepper
    x, y = at(2)
    rect(d, x, y, 5, 6, 7, 8, (78, 60, 48, 255))
    rect(d, x, y, 10, 6, 2, 8, (54, 40, 32, 255))
    rect(d, x, y, 4, 3, 9, 4, (108, 84, 66, 255))
    rect(d, x, y, 6, 4, 2, 2, (240, 232, 216, 255))
    rect(d, x, y, 9, 4, 2, 2, (240, 232, 216, 255))

    # 3 chili flakes
    x, y = at(3)
    ell(d, x, y, 2, 6, 12, 8, (238, 232, 220, 255))
    ell(d, x, y, 3, 5, 10, 5, (206, 62, 44, 255))
    for px_, py_ in ((4, 5), (7, 4), (10, 6), (6, 7)):
        rect(d, x, y, px_, py_, 2, 2, (240, 112, 70, 255))

    # 4 lahmacun
    x, y = at(4)
    ell(d, x, y, 1, 3, 14, 11, (226, 190, 132, 255))
    ell(d, x, y, 3, 5, 10, 7, (192, 142, 88, 255))
    for px_, py_ in ((5, 6), (8, 7), (6, 9), (9, 5)):
        rect(d, x, y, px_, py_, 2, 2, (146, 70, 52, 255))
    rect(d, x, y, 10, 8, 2, 2, (110, 168, 84, 255))

    # 5 doner
    x, y = at(5)
    rect(d, x, y, 7, 1, 2, 14, (170, 176, 190, 255))
    for i, (yy, hh, w) in enumerate(((2, 4, 6), (6, 4, 10), (10, 4, 8))):
        rect(d, x, y, 8 - w // 2, yy, w, hh, (176, 98, 56, 255))
        rect(d, x, y, 8 - w // 2, yy, w, 1, (216, 152, 96, 255))

    # 6 perfectly grilled skewer
    x, y = at(6)
    rect(d, x, y, 1, 7, 14, 1, (206, 212, 226, 255))
    for k in range(3):
        rect(d, x, y, 2 + k * 4, 4, 4, 7, (176, 104, 54, 255))
        rect(d, x, y, 2 + k * 4, 4, 4, 2, (214, 148, 84, 255))
        rect(d, x, y, 2 + k * 4, 9, 4, 2, (128, 70, 38, 255))

    # 7 burnt skewer
    x, y = at(7)
    rect(d, x, y, 1, 7, 14, 1, (150, 154, 166, 255))
    for k in range(3):
        rect(d, x, y, 2 + k * 4, 4, 4, 7, (58, 50, 50, 255))
        rect(d, x, y, 2 + k * 4, 4, 4, 2, (88, 78, 76, 255))
    rect(d, x, y, 4, 1, 2, 2, (120, 120, 128, 200))
    rect(d, x, y, 9, 0, 2, 2, (120, 120, 128, 160))

    # 8 heart
    x, y = at(8)
    ell(d, x, y, 2, 3, 6, 6, HEART_R)
    ell(d, x, y, 8, 3, 6, 6, HEART_R)
    d.polygon([(x + 2, y + 7), (x + 14, y + 7), (x + 8, y + 14)], fill=HEART_R)
    rect(d, x, y, 4, 4, 2, 2, (255, 170, 176, 255))

    # 9 complaint (angry face)
    x, y = at(9)
    ell(d, x, y, 1, 1, 14, 14, (238, 96, 84, 255))
    rect(d, x, y, 4, 5, 3, 1, (60, 30, 30, 255))
    rect(d, x, y, 5, 6, 3, 1, (60, 30, 30, 255))
    rect(d, x, y, 9, 5, 3, 1, (60, 30, 30, 255))
    rect(d, x, y, 8, 6, 3, 1, (60, 30, 30, 255))
    rect(d, x, y, 5, 10, 6, 2, (60, 30, 30, 255))
    rect(d, x, y, 6, 9, 4, 1, (60, 30, 30, 255))

    # 10 flame
    x, y = at(10)
    d.polygon([(x + 8, y + 1), (x + 13, y + 9), (x + 8, y + 15), (x + 3, y + 9)],
              fill=(240, 140, 50, 255))
    d.polygon([(x + 8, y + 5), (x + 11, y + 10), (x + 8, y + 14), (x + 5, y + 10)],
              fill=(252, 214, 110, 255))

    # 11 check
    x, y = at(11)
    for i in range(4):
        rect(d, x, y, 2 + i, 7 + i, 2, 2, (116, 224, 176, 255))
    for i in range(6):
        rect(d, x, y, 6 + i, 10 - i, 2, 2, (116, 224, 176, 255))

    # 12 cross
    x, y = at(12)
    for i in range(9):
        rect(d, x, y, 3 + i, 3 + i, 2, 2, (238, 96, 84, 255))
        rect(d, x, y, 11 - i, 3 + i, 2, 2, (238, 96, 84, 255))

    # 13 plate
    x, y = at(13)
    ell(d, x, y, 0, 5, 16, 8, (250, 250, 252, 255))
    ell(d, x, y, 3, 6, 10, 5, (216, 220, 232, 255))

    # 14 clock (patience)
    x, y = at(14)
    ell(d, x, y, 1, 1, 14, 14, (240, 236, 226, 255))
    ell(d, x, y, 3, 3, 10, 10, (60, 52, 60, 255))
    rect(d, x, y, 7, 5, 2, 4, (240, 236, 226, 255))
    rect(d, x, y, 8, 8, 3, 2, (240, 236, 226, 255))

    # 15 star
    x, y = at(15)
    d.polygon([(x + 8, y + 1), (x + 10, y + 6), (x + 15, y + 6), (x + 11, y + 9),
               (x + 13, y + 14), (x + 8, y + 11), (x + 3, y + 14), (x + 5, y + 9),
               (x + 1, y + 6), (x + 6, y + 6)], fill=(246, 200, 84, 255))

    img.save(os.path.join(UI, "food_icons.png"))


def make_bg_garden():
    """
    Finale backdrop: CAN USTA BAHÇE at golden hour. One 480x270 plate that
    the ending cutscene pans across — sunset sky, hills, poplars, a garden
    fence and a run of party lights.
    """
    img = Image.new("RGBA", (BW, BH), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)

    # ---- sunset sky ------------------------------------------------------
    for yy in range(BH):
        f = yy / 168.0
        if f > 1:
            f = 1
        c = (int(250 - 20 * f), int(168 + 46 * f), int(96 + 70 * f), 255)
        d.line([0, yy, BW, yy], fill=c)
    # low sun
    ell(d, 0, 0, 322, 60, 56, 56, (255, 232, 168, 255))
    ell(d, 0, 0, 330, 68, 40, 40, (255, 248, 214, 255))
    for i, yy in enumerate((44, 52, 96)):
        rect(d, 0, 0, 40 + i * 130, yy, 84, 5, (255, 214, 172, 190))
        rect(d, 0, 0, 60 + i * 130, yy + 7, 54, 4, (255, 224, 190, 150))

    # ---- distant hills ---------------------------------------------------
    for hx, hy, hw, col in ((-30, 118, 190, (150, 128, 112, 255)),
                            (120, 108, 220, (128, 110, 98, 255)),
                            (300, 116, 230, (142, 122, 106, 255))):
        d.ellipse([hx, hy, hx + hw, hy + 110], fill=col)

    # ---- poplar line -----------------------------------------------------
    for i, tx in enumerate(range(14, BW, 46)):
        h = 62 + (i % 3) * 12
        top = 150 - h
        d.ellipse([tx - 9, top, tx + 9, top + h], fill=(58, 96, 66, 255))
        d.ellipse([tx - 6, top + 4, tx + 5, top + h - 10], fill=(76, 122, 82, 255))
        rect(d, 0, 0, tx - 1, 148, 3, 12, (72, 52, 40, 255))

    # ---- garden fence ----------------------------------------------------
    rect(d, 0, 0, 0, 156, BW, 6, (176, 128, 82, 255))
    rect(d, 0, 0, 0, 156, BW, 2, (212, 166, 116, 255))
    for fx in range(0, BW, 14):
        rect(d, 0, 0, fx, 158, 6, 26, (196, 148, 98, 255))
        rect(d, 0, 0, fx, 158, 2, 26, (222, 178, 128, 255))
    rect(d, 0, 0, 0, 178, BW, 4, (160, 114, 72, 255))

    # ---- grass -----------------------------------------------------------
    rect(d, 0, 0, 0, 182, BW, BH - 182, (86, 134, 78, 255))
    rect(d, 0, 0, 0, 182, BW, 3, (112, 164, 92, 255))
    for i in range(0, BW, 9):
        rect(d, 0, 0, i, 190 + (i % 5), 2, 4, (74, 118, 68, 255))
        rect(d, 0, 0, i + 4, 206 + (i % 7), 2, 5, (100, 150, 86, 255))
    # a worn path down the middle
    d.ellipse([150, 214, 350, 268], fill=(168, 140, 100, 255))
    d.ellipse([164, 220, 336, 262], fill=(186, 158, 116, 255))

    # ---- party lights strung across the top ------------------------------
    for span in range(0, BW, 120):
        for t in range(0, 121, 6):
            x = span + t
            if x >= BW:
                break
            sag = int(14 * math.sin(math.pi * (t / 120.0)))
            rect(d, 0, 0, x, 10 + sag, 2, 2, (92, 70, 54, 255))
        for k in range(1, 6):
            t = k * 20
            x = span + t
            if x >= BW:
                break
            sag = int(14 * math.sin(math.pi * (t / 120.0)))
            col = [(255, 214, 120, 255), (246, 132, 118, 255),
                   (140, 208, 240, 255), (150, 226, 150, 255),
                   (250, 190, 240, 255)][k % 5]
            rect(d, 0, 0, x - 1, 12 + sag, 4, 5, col)
            rect(d, 0, 0, x, 12 + sag, 2, 2, (255, 255, 255, 210))

    img.save(os.path.join(ENV, "background_garden.png"))


def make_bg_kitchen():
    """Level 2 parallax: a bright tiled kitchen wall. Tiles horizontally."""
    img = Image.new("RGBA", (BW, BH), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)

    for yy in range(BH):
        f = yy / BH
        c = (int(238 - 26 * f), int(240 - 30 * f), int(244 - 30 * f), 255)
        d.line([0, yy, BW, yy], fill=c)

    # white subway tiling
    for r in range(0, 160, 14):
        off = 0 if (r // 14) % 2 == 0 else 13
        d.line([0, r, BW, r], fill=(206, 212, 220, 255))
        for c in range(-13, BW, 26):
            d.line([c + off, r, c + off, r + 14], fill=(206, 212, 220, 255))

    # extractor hood band
    rect(d, 0, 0, 0, 0, BW, 34, (176, 184, 198, 255))
    rect(d, 0, 0, 0, 30, BW, 6, (140, 148, 164, 255))
    rect(d, 0, 0, 0, 0, BW, 3, (214, 222, 234, 255))
    for xx in range(0, BW, 60):
        rect(d, 0, 0, xx + 8, 36, 44, 4, (150, 158, 174, 255))

    # hanging pans + utensils
    for xx in range(24, BW, 96):
        rect(d, 0, 0, xx, 40, 2, 10, (120, 128, 144, 255))
        ell(d, 0, 0, xx - 12, 48, 26, 22, (168, 176, 190, 255))
        ell(d, 0, 0, xx - 8, 52, 18, 14, (198, 206, 218, 255))
        rect(d, 0, 0, xx + 14, 54, 14, 3, (96, 102, 116, 255))
    for xx in range(72, BW, 96):
        rect(d, 0, 0, xx, 40, 2, 26, (150, 158, 174, 255))
        rect(d, 0, 0, xx - 4, 62, 10, 10, (198, 206, 218, 255))

    # chalkboard menu
    for xx in range(140, BW, 240):
        rect(d, 0, 0, xx, 74, 84, 56, (78, 62, 52, 255))
        rect(d, 0, 0, xx + 3, 77, 78, 50, (44, 56, 50, 255))
        rect(d, 0, 0, xx + 10, 84, 46, 3, (226, 226, 216, 255))
        for i in range(4):
            rect(d, 0, 0, xx + 10, 94 + i * 8, rand_w(i), 2, (186, 196, 186, 255))

    # counter backsplash + a stainless bench along the bottom
    rect(d, 0, 0, 0, 160, BW, 6, (196, 152, 96, 255))
    rect(d, 0, 0, 0, 166, BW, BH - 166, (222, 226, 234, 255))
    for xx in range(0, BW, 40):
        rect(d, 0, 0, xx, 166, 1, BH - 166, (198, 204, 214, 255))

    img.save(os.path.join(ENV, "background_kitchen.png"))


def rand_w(i):
    """Deterministic pseudo-random chalk-line widths for the menu board."""
    return (34, 52, 41, 47)[i % 4]


if __name__ == "__main__":
    make_player_idle()
    make_player_run()
    make_player_jump()
    make_player_crouch()
    make_player_shoot()
    make_enemy_walk()
    make_enemy_attack()
    make_tileset()
    make_bg_far()
    make_bg_near()
    make_hud()
    # --- Act 2 ---
    make_customer()
    make_staff()
    make_stations_up()
    make_stations()
    make_staff()
    make_food_icons()
    make_bg_kitchen()
    make_bg_garden()
    print("assets written to", os.path.abspath(os.path.join(ROOT, "assets")))
