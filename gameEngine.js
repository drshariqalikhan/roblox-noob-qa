/**
 * gameEngine.js - Stable Visual & Audio Engine
 * Handles Phaser 3 Scene, Tables, Roblox Avatars, Animations, and Web Audio Synthesis.
 * (Will remain unchanged during gameplay and database iterations)
 */

/* ==========================================================
   1. RETRO WEB AUDIO SYNTHESIZER
   ========================================================== */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

window.playBeep = function(type = 'blip') {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'blip') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
      osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.setValueAtTime(554, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
      osc.start(now); osc.stop(now + 0.4);
    } else if (type === 'oof') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'coin') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987, now);
      osc.frequency.setValueAtTime(1318, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    }
  } catch (e) {}
};

/* ==========================================================
   2. LEVEL CALCULATOR HELPER
   ========================================================== */
window.calculateLevel = function(coinCount) {
  const c = Math.max(0, parseInt(coinCount) || 0);
  return Math.floor(c / 50) + 1; // 0-49: Lv.1, 50-99: Lv.2, etc.
};

/* ==========================================================
   3. PHASER 3 ARENA SCENE & SPRITE GENERATION
   ========================================================== */
let phaserSceneInstance = null;

class ArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ArenaScene' });
  }

  create() {
    phaserSceneInstance = this;
    const w = this.scale.width;
    const h = this.scale.height;

    // Sky & Clouds
    this.add.rectangle(w / 2, h * 0.225, w, h * 0.45, 0x1da1f2);
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      this.clouds.push(this.add.rectangle(Phaser.Math.Between(0, w), Phaser.Math.Between(30, h * 0.3), 110, 35, 0xffffff, 0.85));
    }

    // Grassy Field with Stud Grid
    this.add.rectangle(w / 2, h * 0.725, w, h * 0.55, 0x43a047);
    this.add.grid(w / 2, h * 0.725, w, h * 0.55, 45, 45, null, null, 0x000000, 0.08);

    // 4 Tables Layout (Spread across width)
    this.tableDisplayData = [];
    const tablePositions = [0.14, 0.38, 0.62, 0.86];

    for (let i = 0; i < 4; i++) {
      const tx = w * tablePositions[i];
      const ty = h * 0.65;
      const tableId = i + 1;

      // Table Graphics
      this.add.ellipse(tx, ty + 18, 96, 26, 0x000000, 0.2);
      this.add.rectangle(tx - 24, ty + 14, 7, 24, 0x3a200a);
      this.add.rectangle(tx + 24, ty + 14, 7, 24, 0x3a200a);
      this.add.rectangle(tx, ty - 8, 68, 24, 0x8B4513);
      this.add.text(tx, ty + 38, `Table ${tableId} (2/2)`, { fontSize: '10px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);

      const chairOffsets = [-42, 42];
      const chairs = [];

      for (let seatIdx = 0; seatIdx < 2; seatIdx++) {
        const cx = tx + chairOffsets[seatIdx];
        const cy = ty - 10;

        this.add.rectangle(cx, cy + 10, 26, 20, 0x5c3a21);
        this.add.rectangle(cx, cy - 8, 26, 18, 0x5c3a21);
        const promptText = this.add.text(cx, cy - 26, 'SIT', { fontSize: '9px', fontStyle: 'bold', color: '#ffcc00' }).setOrigin(0.5);

        // Click Hitbox
        const hitRect = this.add.rectangle(cx, cy, 48, 64, 0xffffff, 0.001).setInteractive({ cursor: 'pointer' });
        hitRect.on('pointerover', () => promptText.setScale(1.2));
        hitRect.on('pointerout', () => promptText.setScale(1.0));
        hitRect.on('pointerdown', () => {
          if (typeof window.onChairClicked === 'function') {
            window.onChairClicked(tableId, seatIdx);
          }
        });

        chairs.push({ cx, cy, promptText, hitRect, avatarContainer: null });
      }

      this.tableDisplayData.push({ id: tableId, chairs });
    }

    // Touch/Mobile fallback hit detection
    this.input.on('pointerdown', (pointer) => {
      this.tableDisplayData.forEach(t => {
        t.chairs.forEach((c, seatIdx) => {
          if (Phaser.Math.Distance.Between(pointer.x, pointer.y, c.cx, c.cy) < 38) {
            if (typeof window.onChairClicked === 'function') {
              window.onChairClicked(t.id, seatIdx);
            }
          }
        });
      });
    });

    if (window.pendingTableSync) {
      this.syncWithState(window.pendingTableSync);
    }
  }

  update() {
    this.clouds.forEach(c => {
      c.x += 0.3;
      if (c.x > this.scale.width + 80) c.x = -80;
    });
  }

  syncWithState(tables) {
    if (!this.tableDisplayData) return;
    tables.forEach((tData, tIdx) => {
      const tDisplay = this.tableDisplayData[tIdx];
      if (!tDisplay) return;

      tData.seats.forEach((seatData, sIdx) => {
        const chair = tDisplay.chairs[sIdx];
        if (!chair) return;

        if (chair.avatarContainer) {
          chair.avatarContainer.destroy();
          chair.avatarContainer = null;
        }

        if (seatData) {
          chair.promptText.setVisible(false);
          chair.avatarContainer = this.createNoobContainer(chair.cx, chair.cy - 15, seatData);
        } else {
          chair.promptText.setVisible(true);
        }
      });
    });
  }

  createNoobContainer(x, y, playerData) {
    const noob = this.add.container(x, y);

    const torsoHex = parseInt((playerData.torsoColor || '#0055bf').replace('#', '0x'), 16);
    const headHex = parseInt((playerData.headColor || '#ffe800').replace('#', '0x'), 16);
    const playerLvl = window.calculateLevel(playerData.coins || 0);

    const shadow = this.add.ellipse(0, 25, 30, 10, 0x000000, 0.25);
    const leftLeg = this.add.rectangle(-6, 12, 10, 18, 0x00a651);
    const rightLeg = this.add.rectangle(6, 12, 10, 18, 0x00a651);
    const torso = this.add.rectangle(0, -4, 26, 20, torsoHex);
    const leftArm = this.add.rectangle(-17, -4, 8, 18, headHex);
    const rightArm = this.add.rectangle(17, -4, 8, 18, headHex);
    const head = this.add.rectangle(0, -19, 18, 16, headHex);
    const leftEye = this.add.rectangle(-4, -21, 2, 3, 0x000000);
    const rightEye = this.add.rectangle(4, -21, 2, 3, 0x000000);
    const smile = this.add.arc(0, -16, 4, 20, 160, false, 0x000000);

    // Overhead Tag with Level + Character Name
    const tagBg = this.add.rectangle(0, -44, 96, 22, 0x000000, 0.75);
    const nameText = this.add.text(0, -49, `[Lv.${playerLvl}] ${playerData.name}`, { fontSize: '9px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    const coinText = this.add.text(0, -38, `💰 ${playerData.coins} coins`, { fontSize: '9px', color: '#ffcc00' }).setOrigin(0.5);

    noob.add([shadow, leftLeg, rightLeg, torso, leftArm, rightArm, head, leftEye, rightEye, smile, tagBg, nameText, coinText]);

    // Hats
    if (playerData.hat === 'hat_cap') {
      noob.add([
        this.add.rectangle(0, -27, 22, 5, 0xff0033),
        this.add.rectangle(4, -25, 26, 2, 0xff0033)
      ]);
    } else if (playerData.hat === 'hat_crown') {
      noob.add(this.add.rectangle(0, -29, 20, 6, 0xffd700));
    }

    // Idle Bobbing Animation
    this.tweens.add({
      targets: noob,
      y: '-=3',
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    return noob;
  }

  spawnCoinFloat(text, color) {
    const floatText = this.add.text(window.innerWidth / 2, window.innerHeight * 0.5, text, {
      fontSize: '20px',
      fontStyle: 'bold',
      color: color,
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({
      targets: floatText,
      y: window.innerHeight * 0.5 - 60,
      alpha: 0,
      duration: 1600,
      ease: 'Cubic.easeOut',
      onComplete: () => floatText.destroy()
    });
  }
}

// Global bridges for index.html to call
window.syncPhaserTables = function(cachedTables) {
  if (phaserSceneInstance) {
    phaserSceneInstance.syncWithState(cachedTables);
  } else {
    window.pendingTableSync = cachedTables;
  }
};

window.spawnCoinFloat = function(text, color) {
  if (phaserSceneInstance) {
    phaserSceneInstance.spawnCoinFloat(text, color);
  }
};

// Auto-boot Phaser Game on DOM Load
window.addEventListener('DOMContentLoaded', () => {
  const containerEl = document.getElementById('game-container');
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: containerEl.clientWidth || window.innerWidth,
    height: containerEl.clientHeight || (window.innerHeight - 60),
    scene: [ArenaScene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
  });
});