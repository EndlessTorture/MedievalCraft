// ══════════════════════════════════════════════════════════════════════════════
// GAME CONSOLE — command line for MedievalCraft
// ══════════════════════════════════════════════════════════════════════════════

import { BLOCK, BLOCK_NAMES, WORLD_SEED, registry, setBlock, getBlock, getTerrainHeight, CHUNK_HEIGHT } from './world/world.js';
import { player, keys } from './player.js';
import { ItemStack } from './inventory.js';
import { updateLightingForBlock } from './world/lighting.js';

let consoleOpen = false;
let consoleEl, outputEl, inputEl;
let commandHistory = [];
let historyIndex = -1;
let deps = {};

// ── Public API ───────────────────────────────────────────────────────────────

export function isConsoleOpen() {
    return consoleOpen;
}

export function initConsole(gameDeps) {
    deps = gameDeps;

    consoleEl = document.getElementById('gameConsole');
    outputEl = document.getElementById('consoleOutput');
    inputEl = document.getElementById('consoleInput');

    if (!consoleEl || !outputEl || !inputEl) {
        console.warn('Console DOM elements not found');
        return;
    }

    // Handle console input
    inputEl.addEventListener('keydown', e => {
        e.stopPropagation();

        if (e.key === 'Enter') {
            const text = inputEl.value.trim();
            if (text) {
                executeCommand(text);
                commandHistory.unshift(text);
                if (commandHistory.length > 50) commandHistory.pop();
            }
            inputEl.value = '';
            historyIndex = -1;
        } else if (e.key === 'Escape') {
            closeConsole();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                inputEl.value = commandHistory[historyIndex];
                // Move cursor to end
                setTimeout(() => inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length, 0);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                inputEl.value = commandHistory[historyIndex];
            } else {
                historyIndex = -1;
                inputEl.value = '';
            }
        }
    });

    // Prevent game from receiving input while console is open
    inputEl.addEventListener('keyup', e => e.stopPropagation());

    // Global key handler for opening/closing console
    document.addEventListener('keydown', e => {
        // Close console with Escape from anywhere
        if (consoleOpen && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeConsole();
            return;
        }

        if (consoleOpen) return;

        if (e.code === 'KeyT' || (e.key === '/' && !e.ctrlKey)) {
            e.preventDefault();
            openConsole(e.key === '/' ? '/' : '');
        }
    }, true); // Use capture phase to intercept before other handlers
}

// ── Open / Close ─────────────────────────────────────────────────────────────

function openConsole(prefill = '') {
    consoleOpen = true;
    consoleEl.classList.add('visible');
    inputEl.value = prefill;
    inputEl.focus();
    historyIndex = -1;

    // Release pointer lock
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    // Clear any held keys to stop player movement
    for (const k in keys) keys[k] = false;
}

function closeConsole() {
    consoleOpen = false;
    consoleEl.classList.remove('visible');
    inputEl.value = '';
    inputEl.blur();

    // Re-lock pointer
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
        setTimeout(() => canvas.requestPointerLock(), 50);
    }
}

// ── Output ───────────────────────────────────────────────────────────────────

function addLine(text, type = 'info') {
    const line = document.createElement('div');
    line.className = `console-line console-${type}`;
    line.textContent = text;
    outputEl.appendChild(line);

    // Limit to last 100 lines
    while (outputEl.children.length > 100) {
        outputEl.removeChild(outputEl.firstChild);
    }

    outputEl.scrollTop = outputEl.scrollHeight;

    // Auto-fade old messages after a delay if console is open
    setTimeout(() => {
        if (outputEl.contains(line)) {
            line.classList.add('fading');
        }
    }, 8000);
}

function addSuccess(text) { addLine(text, 'success'); }
function addError(text) { addLine(text, 'error'); }
function addInfo(text) { addLine(text, 'info'); }

// ── Command Execution ────────────────────────────────────────────────────────

function executeCommand(input) {
    addLine(`> ${input}`, 'input');

    // Parse: strip leading / if present
    const raw = input.startsWith('/') ? input.slice(1) : input;
    const parts = raw.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
        case 'help': cmdHelp(); break;
        case 'tp': cmdTeleport(args); break;
        case 'give': cmdGive(args); break;
        case 'fly': cmdFly(); break;
        case 'seed': cmdSeed(); break;
        case 'pos': cmdPos(); break;
        case 'clear': cmdClear(); break;
        case 'time': cmdTime(args); break;
        case 'kill': cmdKill(); break;
        case 'blocks': cmdBlocks(); break;
        case 'speed': cmdSpeed(args); break;
        case 'heal': cmdHeal(); break;
        case 'place': cmdPlace(args); break;
        case 'daytime': cmdDaytime(args); break;
        default:
            addError(`Unknown command: /${cmd}. Type /help for a list of commands.`);
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdHelp() {
    addInfo('═══ Available Commands ═══');
    addInfo('/help              — Show this list');
    addInfo('/tp <x> <y> <z>    — Teleport to coordinates');
    addInfo('/give <block> [n]  — Give items (e.g. /give STONE 64)');
    addInfo('/fly               — Toggle fly mode');
    addInfo('/seed              — Show world seed');
    addInfo('/pos               — Show current position');
    addInfo('/clear             — Clear console');
    addInfo('/time <value>      — Set game time');
    addInfo('/kill              — Respawn at world origin');
    addInfo('/blocks            — List all block types');
    addInfo('/speed <value>     — Set movement speed (1-20)');
    addInfo('/heal              — Teleport up to safety');
    addInfo('/place <block>     — Place block at feet');
    addInfo('/daytime <preset>  — Set time: day/night/dawn/dusk/noon/midnight');
}

function cmdTeleport(args) {
    if (args.length < 3) {
        addError('Usage: /tp <x> <y> <z>');
        return;
    }

    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
        addError('Invalid coordinates. Use numbers.');
        return;
    }

    player.x = x;
    player.y = y;
    player.z = z;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.prevX = x;
    player.prevY = y;
    player.prevZ = z;

    addSuccess(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
}

function cmdGive(args) {
    if (args.length < 1) {
        addError('Usage: /give <block_name> [count]');
        return;
    }

    const name = args[0].toUpperCase();
    const count = Math.max(1, Math.min(64, parseInt(args[1]) || 64));

    const blockId = BLOCK[name];
    if (blockId === undefined || blockId === BLOCK.AIR) {
        addError(`Unknown block: ${name}. Use /blocks to see available types.`);
        return;
    }

    const stack = new ItemStack(blockId, count);
    const added = player.inventory.addItemDirect(stack);

    if (added > 0) {
        addSuccess(`Given ${added}x ${name}`);
    } else {
        addError('Inventory is full!');
    }
}

function cmdFly() {
    player.flying = !player.flying;
    addSuccess(`Fly mode: ${player.flying ? 'ON' : 'OFF'}`);
}

function cmdSeed() {
    addInfo(`World Seed: ${WORLD_SEED}`);
}

function cmdPos() {
    addInfo(`Position: ${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)}`);
    addInfo(`Yaw: ${(player.yaw * 180 / Math.PI).toFixed(1)}° Pitch: ${(player.pitch * 180 / Math.PI).toFixed(1)}°`);
}

function cmdClear() {
    outputEl.innerHTML = '';
    addInfo('Console cleared.');
}

function cmdTime(args) {
    if (args.length < 1) {
        addInfo(`Current game time: ${deps.getGameTime?.().toFixed(1) ?? '?'}`);
        return;
    }

    const val = parseFloat(args[0]);
    if (isNaN(val)) {
        addError('Usage: /time <number>');
        return;
    }

    deps.setGameTime?.(val);
    addSuccess(`Game time set to ${val.toFixed(1)}`);
}

function cmdKill() {
    const spawnH = getTerrainHeight(0, 0);
    player.x = 0.5;
    player.y = spawnH + 2;
    player.z = 0.5;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.prevX = player.x;
    player.prevY = player.y;
    player.prevZ = player.z;
    addSuccess('Respawned at world origin.');
}

function cmdBlocks() {
    const names = Object.keys(BLOCK).filter(k => k !== 'AIR');
    addInfo(`═══ Available Blocks (${names.length}) ═══`);

    // Group in rows of 4
    for (let i = 0; i < names.length; i += 4) {
        const row = names.slice(i, i + 4).join(', ');
        addInfo(row);
    }
}

function cmdSpeed(args) {
    if (args.length < 1) {
        addInfo(`Current speed: ${player.speed.toFixed(1)}`);
        return;
    }

    const val = parseFloat(args[0]);
    if (isNaN(val) || val < 0.5 || val > 50) {
        addError('Speed must be between 0.5 and 50');
        return;
    }

    player.speed = val;
    addSuccess(`Movement speed set to ${val.toFixed(1)}`);
}

function cmdHeal() {
    // Teleport player up to the terrain surface
    const surfaceH = getTerrainHeight(Math.floor(player.x), Math.floor(player.z));
    player.y = surfaceH + 2;
    player.vy = 0;
    player.prevY = player.y;
    addSuccess(`Teleported to surface (Y: ${player.y.toFixed(1)})`);
}

function cmdPlace(args) {
    if (args.length < 1) {
        addError('Usage: /place <block_name>');
        return;
    }

    const name = args[0].toUpperCase();
    const blockId = BLOCK[name];
    if (blockId === undefined) {
        addError(`Unknown block: ${name}. Use /blocks to see available types.`);
        return;
    }

    // Place at feet position
    const bx = Math.floor(player.x);
    const by = Math.floor(player.y) - 1;
    const bz = Math.floor(player.z);

    if (by < 0 || by >= CHUNK_HEIGHT) {
        addError('Cannot place block outside world bounds.');
        return;
    }

    setBlock(bx, by, bz, blockId);
    updateLightingForBlock(bx, by, bz);
    addSuccess(`Placed ${name} at ${bx}, ${by}, ${bz}`);
}

function cmdDaytime(args) {
    // Renderer formula: dayTime = Math.sin(gameTime * 0.02) * 0.5 + 0.5
    // So: sin(gameTime * 0.02) = (dayTime - 0.5) / 0.5 = dayTime * 2 - 1
    // gameTime = asin(dayTime * 2 - 1) / 0.02

    const presets = {
        day: 1.0,   // full brightness
        noon: 1.0,   // same as day
        dawn: 0.5,   // half light, rising
        sunrise: 0.5,   // alias for dawn
        dusk: 0.5,   // half light, setting
        sunset: 0.5,   // alias for dusk
        night: 0.0,   // full darkness
        midnight: 0.0,   // same as night
    };

    if (args.length < 1) {
        const currentGameTime = deps.getGameTime?.() ?? 0;
        const dayTime = Math.sin(currentGameTime * 0.02) * 0.5 + 0.5;
        addInfo(`Current dayTime: ${dayTime.toFixed(2)} (0=night, 1=day)`);
        addInfo('Usage: /daytime <day|night|dawn|dusk|noon|midnight>');
        addInfo('       /daytime <0.0-1.0>');
        return;
    }

    const input = args[0].toLowerCase();
    let targetDayTime;

    if (presets.hasOwnProperty(input)) {
        targetDayTime = presets[input];
    } else {
        targetDayTime = parseFloat(input);
        if (isNaN(targetDayTime) || targetDayTime < 0 || targetDayTime > 1) {
            addError('Usage: /daytime <day|night|dawn|dusk|noon|midnight> or <0.0-1.0>');
            return;
        }
    }

    // Compute gameTime from dayTime value
    // dayTime = sin(gameTime * 0.02) * 0.5 + 0.5
    // sin(gameTime * 0.02) = (dayTime - 0.5) / 0.5
    const sinVal = Math.max(-1, Math.min(1, (targetDayTime - 0.5) / 0.5));
    const newGameTime = Math.asin(sinVal) / 0.02;

    deps.setGameTime?.(newGameTime);

    const label = presets.hasOwnProperty(input) ? input : targetDayTime.toFixed(2);
    addSuccess(`Daytime set to ${label} (dayTime: ${targetDayTime.toFixed(2)})`);
}
