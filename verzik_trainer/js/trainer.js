
const img_path = "./img/";
const img_ext = ".png";
const sounds_path = "./sounds/";
const sounds_ext = ".m4a";

var numAssetsToLoad = 0;
var imgs = {};
const img_ = {
    tile_board: "",
    whip: {idle: "", attack: ["0","1","2","3","4","5","6","7","8","9"]},
    scythe: {idle: "", attack: ["0","1","2","3","4","5","6","7","8","9"]},
    birds: ["0","1","2","3","4","5"],
    hitsplat: {25:""},
    verzik: {idle: ["0","1","2","3","4","5","6","7"],
            attack: ["0","1","2","3","4","5","6","7","8","9"]},
    bomb: {f:  ["0","1","2","3","4","5"],
           e:  ["0","1","2","3","4","5","6","7","8"]}
};
var sounds = {};
const sounds_ = {
    scythe: "",
    whip: "",
    verzik_range: "",
    verzik_bounce: "",
    verzik_hit: ""
};

const cycle_length = 100; // .1 seconds per animation cycle, 10 fps
const cycles_per_tick = 6;
const tick_length = cycle_length * cycles_per_tick;
const board_width = 15;  // # game tiles wide
const board_height = 11; // # game tiles high

const tile_marker_json = '{"none":[],"1":[[7,2],[4,5],[10,5],[7,8]],"2":[[6,2],[8,2],[4,4],[4,6],[10,4],[10,6],[6,8],[8,8]],"3":[[5,2],[6,2],[7,2],[8,2],[9,2],[4,3],[4,4],[4,5],[4,6],[4,7],[10,3],[10,4],[10,5],[10,6],[10,7],[5,8],[6,8],[7,8],[8,8],[9,8]]}';
const tile_marker_arr = JSON.parse(tile_marker_json);

const tile_size_max = 110;
var tile_size = tile_size_max;
var tile_stroke = tile_size / 25;
var draw_scale = 1; //scale by which everything is drawn

const whip = {
    NAME: 'whip',
    CD: 4
};

const scythe = {
    NAME: 'scythe',
    CD: 5
};

const weapons = {
    "SCYTHE": scythe,
    "WHIP": whip
};

var booleans = {
    "show-verzik-tiles": false,
    "show-melee-tiles": false,
    "show-tile-indicators": true,
    "show-path-tiles": false
};

var values = {
    "weapon-select": "SCYTHE",
    "tile-marker-type": "none",
    "color-tile-marker": "#ffffff",
    "color-verzik-marker": "#00ffff",
    "color-melee-marker": "#ff0000",
    "color-tile-indicator": "#ffffff" //add "20" to make semi-transparent
};

var ping = 30;

var canvas = $("tile-board");
var ctxt = canvas.getContext("2d");


/// variables that are reset with init();

var board_img;

var cycles; //count .1 second intervals
var ticks;  //count ticks
var paused;
var tick_timer;

var p1;
var verzik;

var recent_click;

function $(id) {
    return document.getElementById(id);
}

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Returns the number of tile movements between this point and p
     *
     * @param {Point} p is a Point, or any object with an x and y field
     * @returns {Number}
     */
    dist(p) {
        if (p === null) return null;
        return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    }

    /**
     * Returns the biased distance between this point and point p.
     *
     * For distances with the same number of tile movements, this function
     * always returns a lesser value for left(westward) distances than for
     * right(eastward) distances, and a lesser value for right distances than
     * for up or down distances.  This is to mimic the pathing in osrs.
     *
     * @param {Point} p is a Point, or any object with an x and y field
     * @returns {Number}
     */
    distBiased(p) {
        let dist = this.dist(p);
        let diagonal = dist - Math.abs(Math.abs(this.x - p.x) - Math.abs(this.y - p.y));
        let west_east = p.x - this.x;
        return dist + diagonal * .414 //add .414 * amount of diagonal movement
                + (west_east < 0 ? .02 : -.01) * west_east; //subtract .02 if movement is going west and .01 if movement is going east
    }
}

class Player  {
    constructor() {
        this.position = new Point(3, 5); //default start
        this.prev_pos = new Point(3, 5);
        this.target_tile = null;        //the tile on which to draw a tile indicator, the next target_tile_server
        this.target_tile_server = null; //target_tile as seen by the 'server', delayed by ping
        this.path_tiles = [];           //array of tiles in path to target_tile_server
        this.attack_target = null;      //the npc being targetted for attack
        this.focus_angle = null;        //the center point of the player's focus
        this.anim_angle = 0;            //the direction in which the player is facing
        this.anim_pos = new Point(3, 5);
        this.weapon = weapons[values["weapon-select"]];
        this.img = new Image();
        this.animation_frames = [];
        this.attack_cd = 0;         //attack cool-down timer in ticks
        this.attack_audio = null;
        this.stun_timer = 0;
        this.stun_birds = null;
    }

    //center of animation in terms of tile
    getAnimCenter() {
        return new Point((this.anim_pos.x + .5), (this.anim_pos.y + .5));
    }

    //center in terms of pixel
    getCenterPixel() {
        return new Point((this.position.x + .5) * tile_size, (this.position.y + .5) * tile_size);
    }

    /**
     * Calculates the target tile from the given click_target
     *
     * @param click_target can be either an NPC or a Point
     * @returns {Point} target_tile
     */
    calcTargetTile(click_target) {
        let target_tile = null;
        if (click_target.isNpc) {
            let tiles = click_target.getTilesInAttackableRange(1);
            let min = 999;
            for (let tile of tiles) {
                let dist = this.position.distBiased(tile);
                if (dist < min) {
                    min = dist;
                    target_tile = tile;
                }
            }
        } else { //click_target is not an NPC, so is a Point
            target_tile = new Point(click_target.x, click_target.y);
        }
        return target_tile;
    }

    setTargetTile(click_target) {
        this.target_tile = this.calcTargetTile(click_target);
    }

    tick() {

        if (this.stun_timer) {
            this.stun_timer--;
            //log movement
            if (this.position.dist(this.prev_pos) !== 0) {
                console.log(`Moved from (${this.prev_pos.x},${this.prev_pos.y}) to (${this.position.x},${this.position.y})`)
            }
            //save prev position
            //since stun timer is active, log movement before saving prev_pos
            this.prev_pos = new Point(this.position.x, this.position.y);
            if (this.attack_cd) {
                this.attack_cd -= 1;
            }
            if (this.stun_timer === 0) this.stun_birds = null;
        } else {
            if (recent_click) {
                this.attack_target = recent_click.isNpc ? recent_click : null;
                this.target_tile_server = this.calcTargetTile(recent_click);
                this.path_tiles = generate_path(this.position, this.target_tile_server);
                recent_click = null;
            }

            //save prev position
            this.prev_pos = new Point(this.position.x, this.position.y);

            //change player position
            //delete this.path_tiles entry
            if (this.target_tile_server) {
                if (this.path_tiles.length > 1) this.path_tiles.shift();
                this.position = this.path_tiles.shift(); //remove first path tile and set this.pos to it
            }
            //log movement
            if (this.position.dist(this.prev_pos) !== 0) {
                console.log(`Moved from (${this.prev_pos.x},${this.prev_pos.y}) to (${this.position.x},${this.position.y})`)
            }
            //update this.target_tile/_server
            if (this.position.dist(this.target_tile_server) === 0) {
                this.target_tile_server = null;
                //only clear target_tile if you're already standing there,
                //and there's no target_tile_server
                if (this.position.dist(this.target_tile) === 0) {
                    this.target_tile = null;
                }
            }
            if (this.attack_cd) {
                this.attack_cd -= 1;
            }
            //check if can attack
            if (this.canAttack()) {
                this.performAttack();
            }
        }
    }

    canAttack() {
        return this.attack_target && !this.target_tile_server && this.attack_cd === 0;
    }

    performAttack() {
        console.log(`Attack! with ${this.weapon.NAME}`);

        this.attack_cd += this.weapon.CD;
        this.animation_frames = [...imgs[this.weapon.NAME].attack];

//        this.attack_audio = sounds[this.weapon.NAME];
//        this.attack_audio.play();
        this.attack_target.hit(this.weapon);
    }

    hit(dmg) {
        this.hitsplat = new HitSplat(dmg);
        setTimeout(()=>{
            this.hitsplat = null;
        }, 2 * tick_length);
    }

    stun(t) {
        this.stun_timer = t;
        this.stun_birds = new StunBirds();

        this.target_tile = null;
        this.target_tile_server = null;
        this.path_tiles = [];
        this.attack_target = null;
        this.focus_angle = null;
        this.anim_angle = Math.atan2(this.position.y-(this.prev_pos.y),this.position.x-(this.prev_pos.x));
    }

    animate() {
        //update image
        this.img = this.getImg();

        let focus_point;
        //set focus_point
        if (this.attack_target) { //if there's an attack target, point character towards it
            focus_point = this.attack_target.getAnimCenter(); //tile center
        } else if (this.position.dist(this.prev_pos)) { //if moving, point character in that direction
            focus_point = new Point(
                    this.position.x + .5,
                    this.position.y + .5);
        } else { //else, no target, not moving
            focus_point = null;
        }
        if (focus_point) {
            //animate movement position
            this.anim_pos = new Point(
                    this.prev_pos.x + (this.position.x - this.prev_pos.x) * ((cycles +1)/cycles_per_tick),
                    this.prev_pos.y + (this.position.y - this.prev_pos.y) * ((cycles +1)/cycles_per_tick));
            //animate rotational movement
            //if animated position is not the same as focus_point, rotate player towards focus_point
            if (this.anim_pos.x+.5!==focus_point.x||this.anim_pos.y+.5!==focus_point.y) {
                this.focus_angle = Math.atan2(focus_point.y-(this.anim_pos.y+.5),focus_point.x-(this.anim_pos.x+.5));
                let angleDif = getAngleDifference(this.anim_angle, this.focus_angle);
                //set anim_angle closer to focus_angle
                if (angleDif > 0) {
                    this.anim_angle += Math.min(Math.PI / 3.8, angleDif);
                    if (this.anim_angle > Math.PI) this.anim_angle -= 2 * Math.PI;
                } else if (angleDif < 0) {
                    this.anim_angle -= Math.min(Math.PI / 3.8, -angleDif);
                    if (this.anim_angle < -Math.PI) this.anim_angle += 2 * Math.PI;
                }
            }
        }
    }

    getImg() {
        let anim_frame = this.animation_frames.shift();
        if (!anim_frame) anim_frame = imgs[this.weapon.NAME].idle;
        return anim_frame;
    }

    draw(context) {
        context.translate((this.anim_pos.x +.5)*tile_size,(this.anim_pos.y +.5)*tile_size);
        context.rotate(this.anim_angle);
        drawImgCentered(context, this.img);
        context.rotate(-this.anim_angle);
        if (this.stun_timer) this.stun_birds.drawInPlace(context);
        if (this.hitsplat) this.hitsplat.drawInPlace(context);
        context.translate(-(this.anim_pos.x +.5)*tile_size,-(this.anim_pos.y +.5)*tile_size);
    }

}

class HitSplat {
    constructor(dmg) {
        this.img = imgs.hitsplat[dmg];
    }

    drawInPlace(context) {
        drawImgCentered(context, this.img);
    }
}

class StunBirds {
    constructor() {
        this.img = new Image();
        this.animation_frames = [...imgs.birds];
    }

    getImg() {
        let anim_frame = this.animation_frames.shift();
        if (!anim_frame) {
            this.animation_frames = [...imgs.birds];
            anim_frame = this.animation_frames.shift();
        }
        return anim_frame;
    }

    drawInPlace(context) {
        this.img = this.getImg();
        drawImgCentered(context, this.img);
    }
}

class NPC {
    constructor(pos, size) {
        this.pos = new Point(pos.x, pos.y);
        this.size = size;   //size x size tiles
        this.isNpc = true;

        this.attack_target = null;  //the player being targetted for attack
        this.target_loc = null;     //the location of the attack_target when targetted
        this.range_att = false;     //true if attack_target will receive a range attack
        this.bounce_att = false;    //true if attack_target will receive a bounce attack
        this.focus_angle = null;    //the center point of the npc's focus
        this.angle = 0;             //the direction in which the npc is facing
        this.prev_angle = 0;
        this.attack_speed = 4;
        this.img;
        this.animation_frames = [];
        this.attack_audio = null;
        this.attack_cycle = 4;      //attack cycle counter in ticks
    }

    target(player) {
        this.attack_target = player;
    }

    //center in terms of tiles
    getAnimCenter() {
        return new Point(this.pos.x + this.size/2, this.pos.y + this.size/2);
    }

    //center in terms of pixel
    getCenterPixel() {
        return new Point((this.pos.x + this.size/2) * tile_size, (this.pos.y + this.size/2) * tile_size);
    }

    tick() {
        this.attackCycle();
    }

    attackCycle() {
        switch (this.attack_cycle--) {
            case 3:
                if (this.range_att) {
                    this.range_bomb = new RangeBomb(this, this.attack_target, this.target_loc);
                }
                break;
            case 2:
                if (this.range_att) {
                    this.range_bomb.detonate();
                }
                break;
            case 1:
                this.target_loc = this.attack_target.position;
                this.bounce_att = this.checkInBounceRange(this.target_loc); //bounce attack if in melee range
                this.range_att = !this.bounce_att;  //range attack if outside of bounce range
                break;
            case 0:
                this.performAttack();
        }
    }

    performAttack() {
        console.log(`Attack! from verzik`); //TODO
        this.attack_cycle += this.attack_speed;
        if (this.bounce_att) {  //bounce attack if in melee range
            this.bounceAttack(this.attack_target);
        } else {                //range attack if outside of bounce range
            this.rangeAttack(this.attack_target);
        }
    }

    checkInBounceRange(p) {
        let tiles = this.getTilesInAttackRange(1);
        let returnBool = false;

        for (let tile of tiles) {
            if (tile.dist(p) === 0) {
                returnBool = true;
                break;
            }
        }

        return returnBool;
    }

    bounceAttack(attack_target) {
        let bounce_tile = null;
        let tiles = this.getTilesAtRange(4);
        let min = 999;
        for (let tile of tiles) {
            let dist = attack_target.position.distBiased(tile);
            if (dist < min) {
                min = dist;
                bounce_tile = tile;
            }
        }

        attack_target.position = bounce_tile;

        attack_target.hit(25);
        attack_target.stun(8);

        this.animation_frames = [...imgs.verzik.attack]; //TODO add bounce anim
        this.attack_audio = sounds.verzik_bounce.cloneNode();
        this.attack_audio.volume = .2;
        this.attack_audio.play();
    }

    rangeAttack(attack_target) {

        this.animation_frames = [...imgs.verzik.attack];
        this.attack_audio = sounds.verzik_range.cloneNode();
        this.attack_audio.volume = .2;
        this.attack_audio.play();
    }

    hit(wep) {
        let defend_audio = sounds.verzik_hit;
        defend_audio.play();
    }

    animate() {
        //update image
        this.img = this.getImg();

        //set focus_point :: assuming there's always an attack_target
        let focus_point = this.attack_target.getAnimCenter();

        //set this.angle :: assuming npc doesn't move
        let cp = this.getAnimCenter();
        this.focus_angle = Math.atan2(focus_point.y - (cp.y), focus_point.x - (cp.x));
        this.angle = this.focus_angle;

        if (this.range_bomb) this.range_bomb.animate();
    }

    getImg() {
        let anim_frame = this.animation_frames.shift();
        if (!anim_frame) {
            this.animation_frames = [...imgs.verzik.idle];
            anim_frame = this.animation_frames.shift();
        }
        return anim_frame;
    }

    draw(context) {
        let center = this.getCenterPixel();
        context.beginPath();
        context.arc(center.x, center.y, tile_size*this.size/2, 0, 2 * Math.PI);
        context.fillStyle = '#00000040';
        context.fill();
        context.beginPath();
        context.arc(center.x, center.y, .9*tile_size*this.size/2, 0, 2 * Math.PI);
        context.fillStyle = '#00000010';
        context.fill();

        let cp = this.getCenterPixel();
        context.translate(cp.x, cp.y);
        context.rotate(this.angle);
        drawImgCentered(context, this.img);
        context.rotate(-this.angle);
        context.translate(-cp.x, -cp.y);

        if (this.range_bomb) this.range_bomb.draw(context);
    }

    /**
     * Tests a point, p, to see if it's within the click area of this npc.
     *
     * It is within the click area iff it's within a circle with diameter of
     * this.size which is centered at getCenterPixel().
     *
     * @param {Point} p the Point to test
     * @returns {boolean} true iff p is within size/2 units of getCenterPixel()
     */
    circleCollision(p) {
        let center = this.getCenterPixel();
        return (this.size * tile_size / 2) > Math.sqrt((p.x - center.x) * (p.x - center.x) + (p.y-center.y) * (p.y-center.y));
    }

    /**
     * Returns an array of Points that are exactly r tiles away from NPC
     *
     * @param {int} r the attack range of this NPC
     * @returns {Array|NPC.getTilesInAttackRange.tiles}
     */
    getTilesAtRange(r) {
        let tiles = [];
        for (let x = -r; x < this.size + r; x++) {
            for (let y = -r; y < this.size + r; y++) {
                if (x === -r || x === this.size+r-1|| y === -r || y === this.size+r-1) {
                    tiles.push(new Point(this.pos.x + x, this.pos.y + y));
                }
            }
        }
        return tiles;
    }

    /**
     * Returns an array of Points within this NPC's attack range
     *
     * @param {int} r the attack range of this NPC
     * @returns {Array|NPC.getTilesInAttackRange.tiles}
     */
    getTilesInAttackRange(r) {
        let tiles = [];
        for (let x = -r; x < this.size + r; x++) {
            for (let y = -r; y < this.size + r; y++) {
                if (x < 0 || x > this.size - 1 || y < 0 || y > this.size - 1) {
                    tiles.push(new Point(this.pos.x + x, this.pos.y + y));
                }
            }
        }
        return tiles;
    }

    /**
     * Returns an array of Points from which this NPC is attackable
     *
     * @param {int} r the attack range of the attacker
     * @returns {Array|NPC.getTilesInAttackableRange.tiles}
     */
    getTilesInAttackableRange(r) {
        let tiles = [];
        for (let x = -r; x < this.size + r; x++) {
            for (let y = -r; y < this.size + r; y++) {
                if (x < 0 || x > this.size - 1 || y < 0 || y > this.size - 1) {
                    if (r === 1) {
                        if((x === -1 && (y === -1 || y === this.size)) || (x === this.size && (y === -1 || y === this.size))) {
                            continue; //don't add tile if it's on the corner
                        }
                    }
                    tiles.push(new Point(this.pos.x + x, this.pos.y + y));
                }
            }
        }
        return tiles;
    }
}

class RangeBomb {
    constructor(npc, player, location) {
        this.npc = npc;
        this.npc_center = npc.getAnimCenter();
        this.player = player;
        this.target_tile = location;
        this.img = null;
        this.angle = Math.atan2(this.target_tile.y+.5-(this.npc_center.y),this.target_tile.x+.5-(this.npc_center.x));
        this.location = null;
        this.animation_frames = [...imgs.bomb.f];
    }

    detonate() {
        this.detonated = true;
        this.animation_frames = [...imgs.bomb.e];
        if (this.player.prev_pos.dist(this.target_tile) === 0) {
            this.player.hit(25);
        }
    }

    animate() {
        this.img = this.getImg();
        if (this.detonated) {
            this.anim_pos = {x: this.target_tile.x+.5, y: this.target_tile.y+.5};
        } else {
            this.anim_pos = new Point(
                    this.npc_center.x + (this.target_tile.x+.5 - this.npc_center.x) * (1/3 + (cycles * (19/30))/cycles_per_tick),
                    this.npc_center.y + (this.target_tile.y+.5 - this.npc_center.y) * (1/3 + (cycles * (19/30))/cycles_per_tick));
        }
    }

    getImg() {
        let anim_frame = this.animation_frames.shift();
        if (!anim_frame) {
            return null;
        }
        return anim_frame;
    }

    draw(context) {
        let cp = new Point(this.anim_pos.x * tile_size, this.anim_pos.y * tile_size);
        context.translate(cp.x, cp.y);
        context.rotate(this.angle);
        drawImgCentered(context, this.img);
        context.rotate(-this.angle);
        context.translate(-cp.x, -cp.y);
    }
}

function getAngleDifference(startAngle, targetAngle) {
    let pi = Math.PI;
    let a = targetAngle - startAngle;

    a += a>pi ? -2*pi : a<-pi ? 2*pi : 0;

    return Math.round(a*1000)/1000;
}

/**
 * Resizes the tile board based on the size of the browser window.
 *
 * Called whenever the browser window is resized.
 *
 * Changes tile_size, tile_stroke, canvas.width, and canvas.height
 */
function resize() {
    let viewport_width = .96 * window.innerWidth;
    let viewport_height = .9 * window.innerHeight;

    draw_scale = Math.min(
            Math.min(1, viewport_width / (tile_size_max * board_width)),
            Math.min(1, viewport_height / (tile_size_max * board_height)));

    tile_size = tile_size_max * draw_scale;
    tile_stroke = tile_size / 25;

    canvas.width = board_width * tile_size;
    canvas.height = board_height * tile_size;

    if (paused) draw();
}

function clickedOnNpc(x, y) {
    let npc = null;
    if (verzik.circleCollision({x:x,y:y})) {
        npc = verzik;
    }
    return npc;
}

function getCanvasPointFromEvent(event) {
    let rect = canvas.getBoundingClientRect();
    let pixel_x = event.clientX - rect.left;
    let pixel_y = event.clientY - rect.top;
    return {x: pixel_x, y: pixel_y};
}

function getClickTarget(event) {
    let coord = getCanvasPointFromEvent(event);
    let tile_x = Math.floor(coord.x / tile_size);
    let tile_y = Math.floor(coord.y / tile_size);
    let npc = clickedOnNpc(coord.x, coord.y);
    return npc ? npc : {x: tile_x, y: tile_y};
}

canvas.addEventListener('mousedown', function (event) {

    if (!p1.stun_timer) {
        let click_target = getClickTarget(event);

        p1.setTargetTile(click_target);

        setTimeout(() => {
            recent_click = click_target;
        }, ping);
    }
});

canvas.addEventListener('keydown', function (event) {
    if (event.keyCode===32||event.keyCode===80) { // if space-bar or "P" are down
        pause_play();
        event.preventDefault();
    }

});

canvas.addEventListener('keypress', function (event) {
    event.stopPropagation();
});

function generate_path(from, to) {
    let current = new Point(from.x, from.y);
    let path_tiles = [];
    while (current.dist(to) > 1) { //while dist from 'current' to 'to' is > 1
        let vector = new Point(to.x - current.x, to.y - current.y);
        if (Math.abs(vector.x) === Math.abs(vector.y)) { //diagonal
            current.x += (current.x < to.x ? 1 : -1);
            current.y += (current.y < to.y ? 1 : -1);
        } else if (Math.abs(vector.x) > Math.abs(vector.y)) { //left-right
            current.x += (current.x < to.x ? 1 : -1);
        } else { //up-down
            current.y += (current.y < to.y ? 1 : -1);
        }
        path_tiles.push(new Point(current.x, current.y));
    }
    path_tiles.push(to);
    return path_tiles;
}

function pause_play() {
    paused = !paused;
    $("pause_btn").innerHTML = paused ? "Play" : "Pause";
    if (paused) {
        if (verzik.attack_audio) verzik.attack_audio.pause();
    }
}

function tickPlayers() {
    p1.tick();
}

function tickNPCs() {
    verzik.tick();
}

function gameCycles() {
    if (numAssetsToLoad > 0) {console.log("loading...");return;}
    if (paused) return;
    cycles = (cycles + 1) % cycles_per_tick;
    if(!cycles) { //game tick every .6 sec
        gameTick();
    }
    animatePlayers();
    animateNPCs();
    draw();
}

function gameTick() {
    ticks += 1;
    console.log(`tick ${ticks}`);
    tickPlayers();
    tickNPCs();
}

function animateNPCs() {
    verzik.animate();
}

function animatePlayers() {
    p1.animate();
}

function draw() {
    drawTileBoard();
    drawTargetTile();
    drawPlayers();
    drawNPCs();
    drawText();
//    drawTestTiles();
}

function drawTestTiles() {
    let s = tile_size;
    let st = tile_stroke;
    ctxt.fillStyle = "#00ff0050";
    strokeRect(p1.prev_pos.x*s,p1.prev_pos.y*s,s,s,st);
    ctxt.fillStyle = "#80ff0050";
    strokeRect(p1.anim_pos.x*s,p1.anim_pos.y*s,s,s,st);
    ctxt.fillStyle = "#ffff0050";
    strokeRect(p1.position.x*s,p1.position.y*s,s,s,st);
    ctxt.fillStyle = "#ff800050";
//    strokeRect(.x*s,.y*s,s,s,st);
    ctxt.fillStyle = "#ff000050";
    if (p1.focus_point) strokeRect((p1.focus_point.x-.5)*s,(p1.focus_point.y-.5)*s,s,s,st);
}

/**
 * Draw a rectangle with specified stroke.
 *
 * @param {type} x pos
 * @param {type} y pos
 * @param {type} w witdh
 * @param {type} h height
 * @param {type} s stroke thickness
 */
function strokeRect(x, y, w, h, s) {
    ctxt.fillRect(x, y, w, s);
    ctxt.fillRect(x, y, s, h);
    ctxt.fillRect(x, y + h - s, w, s);
    ctxt.fillRect(x + w - s, y, s, h);
}

function drawTileBoard() {
    ctxt.drawImage(imgs.tile_board, 0, 0,
                   imgs.tile_board.width * draw_scale, imgs.tile_board.height * draw_scale);
    drawTileMarkers();
    drawVerzikTiles();
    drawMeleeTiles();
}

/**
 * Draws the tile markers around where Verzik sits based on the tile_marker_type
 * selected in the options.
 */
function drawTileMarkers() {
    if (values["tile-marker-type"] === "none") return;
    s = tile_size;
    st = tile_stroke;
    ctxt.fillStyle = values["color-tile-marker"];
    for (let p of tile_marker_arr[values["tile-marker-type"]]) {
        strokeRect(p[0] * s, p[1] * s, s, s, st);
    }
    ctxt.fillStyle = values["color-tile-marker"] + "20";
    for (let p of tile_marker_arr[values["tile-marker-type"]]) {
        ctxt.fillRect(p[0] * s, p[1] * s, s, s);
    }
}

/**
 * NPC Indicator for Verzik
 */
function drawVerzikTiles() {
    if (!booleans["show-verzik-tiles"] || !verzik) return;
    s = tile_size;
    st = tile_stroke;
    //draw box stroke
    ctxt.fillStyle = values["color-verzik-marker"];
    strokeRect(verzik.pos.x * s, verzik.pos.y * s, verzik.size * s, verzik.size * s, st);
    //draw box highlight
    ctxt.fillStyle = values["color-verzik-marker"] + "20";
    ctxt.fillRect(verzik.pos.x * s, verzik.pos.y * s, verzik.size * s, verzik.size * s);
}

/**
 * Draws a highlight around the melee range of Verzik
 */
function drawMeleeTiles() {
    if (!booleans["show-melee-tiles"] || !verzik) return;
    s = tile_size;
    st = tile_stroke;
    //draw box stroke
    ctxt.fillStyle = values["color-melee-marker"];
    strokeRect((verzik.pos.x-1) * s,  (verzik.pos.y-1) * s,  (verzik.size+2) * s,      (verzik.size+2) * s,      st);
    strokeRect(verzik.pos.x * s - st, verzik.pos.y * s - st, verzik.size * s + 2 * st, verzik.size * s + 2 * st, st);
    //draw box highlight
    ctxt.fillStyle = values["color-melee-marker"] + "20";
    ctxt.fillRect((verzik.pos.x-1) * s,           (verzik.pos.y-1) * s,           (verzik.size+2) * s, s                    );
    ctxt.fillRect((verzik.pos.x-1) * s,           verzik.pos.y * s,               s,                   (verzik.size+1) * s  );
    ctxt.fillRect(verzik.pos.x * s,               (verzik.pos.y+verzik.size) * s, (verzik.size+1) * s, s                    );
    ctxt.fillRect((verzik.pos.x+verzik.size) * s, verzik.pos.y * s,               s,                   verzik.size * s      );
}

/**
 * Draws the client side target_tile
 */
function drawTargetTile() {
    if (!booleans["show-tile-indicators"]) return;
    if (p1.target_tile) {
        //draw tile outline 100% opacity
        ctxt.fillStyle = values["color-tile-indicator"];
        strokeRect(p1.target_tile.x * tile_size, p1.target_tile.y * tile_size,
                tile_size, tile_size, tile_stroke);
        //draw tile fill 0x20/0xff opacity
        ctxt.fillStyle = values["color-tile-indicator"] + "20";
        ctxt.fillRect(p1.target_tile.x * tile_size, p1.target_tile.y * tile_size,
                tile_size, tile_size);
        //draw path tiles
        if(booleans["show-path-tiles"]) {
            for (let i = 0; i < p1.path_tiles.length; i++) {
                if (!(i % 2 || i === p1.path_tiles.length - 1)) continue; //skip draw unless i is odd or equal to array length
                let p = p1.path_tiles[i];
                ctxt.fillRect(p.x * tile_size, p.y * tile_size, tile_size, tile_size);
            }
        }
    }
}

function drawPlayers() {
    p1.draw(ctxt);
}

function drawNPCs() {
    verzik.draw(ctxt);
}

function drawText() {
    let font_size = 12;
    ctxt.fillStyle = '#ffffff';
    ctxt.textAlign = 'start';
    ctxt.font = `${font_size}px ${"Courier"}`;
    ctxt.fillText(`Damage Taken: ${225}`,5, font_size);
    ctxt.fillText(`Damage Dealt: ${225}`,5, 2*font_size);
}

function drawImgCentered(context, img) {
    if (img === null) return;
    let draw_x = -draw_scale*img.width/2;
    let draw_y = -draw_scale*img.height/2;
    context.drawImage(img, draw_x, draw_y, draw_scale * img.width, draw_scale * img.height);
}

function updateBoolean(id) {
    booleans[id] = $(id).checked;
    if (paused) draw();
}

function updateValue(id) {
    values[id] = $(id).value;
    if (paused) draw();
}

function updateWeaponSelect(id) {
    values[id] = $(id).value;
    p1.weapon = weapons[values[id]];
    if (paused) draw();
}

function updatePing() {
    ping = $("ping-select").value;
    $("ping-display").innerHTML = ping + " ms";
}

function reset_verzik() {
    var btn = $("reset_btn");
    pause_play();
    init();
}

/**
 * On a new page load, initializes the form data with default values.
 *
 * On a page refresh, loads the data already in the form.
 *
 */
function initFormData() {
    if ($("refreshed").value === "0") { //page was newly loaded :: init form data
        $("weapon-select").value = values["weapon-select"];
        $("tile-marker-type").value = values["tile-marker-type"];
        $("show-verzik-tiles").checked = booleans["show-verzik-tiles"];
        $("show-melee-tiles").checked = booleans["show-melee-tiles"];
        $("show-tile-indicators").checked = booleans["show-tile-indicators"];
        $("show-path-tiles").checked = booleans["show-path-tiles"];
        $("color-tile-indicator").value = values["color-tile-indicator"];
        $("color-verzik-marker").value = values["color-verzik-marker"];
        $("color-melee-marker").value = values["color-melee-marker"];
        $("color-tile-marker").value = values["color-tile-marker"];
        $("refreshed").value = "1"; //set refreshed for next refresh
    } else {//page was refreshed :: keep and load form data
        updateWeaponSelect("weapon-select");
        values["tile-marker-type"] = $("tile-marker-type").value;
        booleans["show-verzik-tiles"] = $("show-verzik-tiles").checked;
        booleans["show-melee-tiles"] = $("show-melee-tiles").checked;
        booleans["show-tile-indicators"] = $("show-tile-indicators").checked;
        booleans["show-path-tiles"] = $("show-path-tiles").checked;
        values["color-tile-indicator"] = $("color-tile-indicator").value;
        values["color-verzik-marker"] = $("color-verzik-marker").value;
        values["color-melee-marker"] = $("color-melee-marker").value;
        values["color-tile-marker"] = $("color-tile-marker").value;
        updatePing(); //need to update ping-display as well
    }
}

function init() {

    cycles = 0;
    ticks = 0;
    paused = false;
    clearInterval(tick_timer);
    tick_timer = null;

    p1 = new Player();
    verzik = new NPC({x:6, y:4}, 3);
    verzik.target(p1);

    recent_click = null;

    initFormData();

    numAssetsToLoad = getNumOfAssets(img_) + getNumOfAssets(sounds_);
    preloadImages(img_, imgs, img_path, img_ext);
    preloadAudio(sounds_, sounds, sounds_path, sounds_ext);

    tick_timer = setInterval(gameCycles, cycle_length);
}

function test1() {
    for (let i in img_) {
        if (typeof img_[i] === "string") { //string

        } else if (Array.isArray(img_[i])) { //array of strings

        } else { //object with more named members

        }
        console.log(`${i} : ${Array.isArray(img_[i])}`);
        console.log(typeof img_[i]);
    }
}

function test2() {
//    let r = Math.random();
    let max = 1000000;
    let date = new Date();
    console.log(`${date.getSeconds()}.${date.getMilliseconds()}`);
//    for (let i = 0; i < max; i++) {
//        r = Math.floor(r*1000)/1000;
//    }
    date = new Date();
    console.log(`${date.getSeconds()}.${date.getMilliseconds()}`);
//    for (let i = 0; i < max; i++) {
//        r = parseFloat(r.toFixed(3));
//    }
    date = new Date();
    console.log(`${date.getSeconds()}.${date.getMilliseconds()}`);
}

function getNumOfAssets(obj_src) {
    let num = 0;
    for (let i in obj_src) {
        if (typeof obj_src[i] === "string") { //static image
            num++;
        } else if (Array.isArray(obj_src[i])) { //animation frames
            num += obj_src[i].length;
        } else { //object with more categories of image
            num += getNumOfAssets(obj_src[i]);
        }
    }
    return num;
}

function preloadImages(obj_src, obj_img, prefix, ext) {
    for (let i in obj_src) {
        let src = null;
        if (typeof obj_src[i] === "string") { //static image
            src = `${prefix}${i}${ext}`;
            obj_img[i] = new Image();
            obj_img[i].onload = ()=>{numAssetsToLoad -= 1;};
            obj_img[i].src = src;
        } else if (Array.isArray(obj_src[i])) { //animation frames
            obj_img[i] = [];
            for (let frame of obj_src[i]) {
                src = `${prefix}${i}_${frame}${ext}`;
                obj_img[i][frame] = new Image();
                obj_img[i][frame].onload = ()=>{numAssetsToLoad -= 1;};
                obj_img[i][frame].src = src;
            }
        } else { //object with more categories of image
            obj_img[i] = {};
            preloadImages(obj_src[i], obj_img[i], `${prefix}${i}_`, ext);
        }
    }
}

function preloadAudio(obj_src, obj_sound, prefix, ext) {
    for (let i in obj_src) {
        if (typeof obj_src[i] === "string") {
            let src = `${prefix}${i}${ext}`;
            obj_sound[i] = new Audio();
            obj_sound[i].volume = .2;
            obj_sound[i].addEventListener('canplaythrough', ()=>{numAssetsToLoad -= 1;}, false);
            obj_sound[i].src = src;
        }
    }
}

window.onload = function () {
//    let a = new Audio();
//    a.addEventListener('canplaythrough', ()=>{console.log("test");}, false);
//    a.src = "./sounds/verzik_range.m4a";
    init();
    resize();
};