import { registry, BLOCK } from './world.js';

// ── ItemStack ─────────────────────────────────────────────────────────────────

export class ItemStack {
    constructor(type, count = 1, maxStack = 64) {
        this.type = type;
        this.count = Math.min(count, maxStack);
        this.maxStack = maxStack;
    }

    isEmpty() { return this.count <= 0 || this.type === BLOCK.AIR; }
    isFull() { return this.count >= this.maxStack; }
    getSpace() { return this.maxStack - this.count; }

    canMergeWith(other) {
        return other && !other.isEmpty() && this.type === other.type && !this.isFull();
    }

    clone() { return new ItemStack(this.type, this.count, this.maxStack); }
    getName() { return registry.get(this.type)?.name ?? 'Unknown'; }
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export class Inventory {
    constructor(size = 36) {
        this.size = size;
        this.slots = new Array(size).fill(null);
        this.dirty = false;
    }

    _markDirty() { this.dirty = true; }
    clearDirty() { this.dirty = false; }

    getSlot(index) {
        return (index >= 0 && index < this.size) ? this.slots[index] : null;
    }

    setSlot(index, itemStack) {
        if (index < 0 || index >= this.size) return;
        this.slots[index] = (itemStack && !itemStack.isEmpty()) ? itemStack : null;
        this._markDirty();
    }

    findEmptySlot() {
        for (let i = 0; i < this.size; i++) {
            if (!this.slots[i]) return i;
        }
        return -1;
    }

    // Добавить предмет, МОДИФИЦИРУЯ оригинальный itemStack
    // Возвращает количество добавленных предметов
    addItemDirect(itemStack) {
        if (!itemStack || itemStack.isEmpty()) return 0;

        let added = 0;
        const type = itemStack.type;
        const maxStack = itemStack.maxStack;

        // Сначала в существующие стаки того же типа
        for (let i = 0; i < this.size && itemStack.count > 0; i++) {
            const slot = this.slots[i];
            if (slot && slot.type === type && !slot.isFull()) {
                const canAdd = Math.min(itemStack.count, slot.getSpace());
                slot.count += canAdd;
                itemStack.count -= canAdd;
                added += canAdd;
            }
        }

        // Затем в пустые слоты
        while (itemStack.count > 0) {
            const idx = this.findEmptySlot();
            if (idx < 0) break;

            const toTake = Math.min(itemStack.count, maxStack);
            this.slots[idx] = new ItemStack(type, toTake, maxStack);
            itemStack.count -= toTake;
            added += toTake;
        }

        if (added > 0) this._markDirty();
        return added;
    }

    // Старый метод для совместимости (используется при установке блоков)
    addItem(itemStack) {
        if (!itemStack || itemStack.isEmpty()) return null;
        let remaining = itemStack.clone();

        for (let i = 0; i < this.size && !remaining.isEmpty(); i++) {
            const slot = this.slots[i];
            if (slot && slot.canMergeWith(remaining)) {
                const canAdd = Math.min(remaining.count, slot.getSpace());
                slot.count += canAdd;
                remaining.count -= canAdd;
                this._markDirty();
            }
        }

        while (remaining && !remaining.isEmpty()) {
            const idx = this.findEmptySlot();
            if (idx < 0) break;
            this.slots[idx] = remaining;
            this._markDirty();
            remaining = null;
        }

        return remaining;
    }
}

// ── Hotbar ────────────────────────────────────────────────────────────────────

export class Hotbar {
    constructor(inventory) {
        this.inventory = inventory;
        this.selectedSlot = 0;
    }

    select(slot) { this.selectedSlot = Math.max(0, Math.min(8, slot)); }
    selectNext() { this.selectedSlot = (this.selectedSlot + 1) % 9; }
    selectPrev() { this.selectedSlot = (this.selectedSlot + 8) % 9; }

    getSelected() { return this.inventory.getSlot(this.selectedSlot); }

    useSelected() {
        const slot = this.getSelected();
        if (!slot || slot.isEmpty()) return false;
        slot.count--;
        if (slot.isEmpty()) {
            this.inventory.setSlot(this.selectedSlot, null);
        } else {
            this.inventory._markDirty();
        }
        return true;
    }

    getSlots() {
        const slots = [];
        for (let i = 0; i < 9; i++) slots.push(this.inventory.getSlot(i));
        return slots;
    }
}