import { registry, BLOCK } from './world.js';

// ── ItemStack ─────────────────────────────────────────────────────────────────

export class ItemStack {
    constructor(type, count = 1, maxStack = 64) {
        this.type = type;
        this.count = Math.min(count, maxStack);
        this.maxStack = maxStack;
    }

    isEmpty() {
        return this.count <= 0 || this.type === BLOCK.AIR || this.type === 0 || this.type == null;
    }

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
        this.onChange = null;
    }

    _markDirty() {
        this.dirty = true;
        this.onChange?.();
    }

    clearDirty() { this.dirty = false; }

    getSlot(index) {
        if (index < 0 || index >= this.size) return null;

        const slot = this.slots[index];
        // Автоматическая очистка пустых слотов при доступе
        if (slot && slot.isEmpty()) {
            this.slots[index] = null;
            return null;
        }
        return slot;
    }

    setSlot(index, itemStack) {
        if (index < 0 || index >= this.size) return;
        this.slots[index] = (itemStack && !itemStack.isEmpty()) ? itemStack : null;
        this._markDirty();
    }

    // Очистка всех пустых ItemStack
    cleanup() {
        let cleaned = false;
        for (let i = 0; i < this.size; i++) {
            if (this.slots[i] && this.slots[i].isEmpty()) {
                this.slots[i] = null;
                cleaned = true;
            }
        }
        if (cleaned) this._markDirty();
    }

    findEmptySlot() {
        for (let i = 0; i < this.size; i++) {
            const slot = this.slots[i];
            // Считаем пустой ItemStack тоже пустым слотом
            if (!slot || slot.isEmpty()) {
                // Очищаем если это пустой ItemStack
                if (slot) this.slots[i] = null;
                return i;
            }
        }
        return -1;
    }

    // Найти слот с таким же типом предмета, который не полный
    findMergeSlot(type) {
        for (let i = 0; i < this.size; i++) {
            const slot = this.slots[i];
            if (slot && !slot.isEmpty() && slot.type === type && !slot.isFull()) {
                return i;
            }
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

            // Пропускаем null и пустые слоты
            if (!slot || slot.isEmpty()) {
                // Очищаем пустые ItemStack
                if (slot) this.slots[i] = null;
                continue;
            }

            if (slot.type === type && !slot.isFull()) {
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

    // Проверить сколько предметов можно добавить
    canAdd(type, count = 1, maxStack = 64) {
        let canAddCount = 0;

        // Считаем место в существующих стаках
        for (let i = 0; i < this.size && canAddCount < count; i++) {
            const slot = this.slots[i];
            if (!slot || slot.isEmpty()) {
                canAddCount += maxStack;
            } else if (slot.type === type) {
                canAddCount += slot.getSpace();
            }
        }

        return Math.min(canAddCount, count);
    }

    // Получить общее количество предметов определённого типа
    countItems(type) {
        let total = 0;
        for (let i = 0; i < this.size; i++) {
            const slot = this.slots[i];
            if (slot && !slot.isEmpty() && slot.type === type) {
                total += slot.count;
            }
        }
        return total;
    }

    // Старый метод для совместимости
    addItem(itemStack) {
        if (!itemStack || itemStack.isEmpty()) return null;
        let remaining = itemStack.clone();

        for (let i = 0; i < this.size && !remaining.isEmpty(); i++) {
            const slot = this.slots[i];
            if (slot && !slot.isEmpty() && slot.canMergeWith(remaining)) {
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

        if (slot.count <= 0 || slot.isEmpty()) {
            // Принудительно очищаем слот
            this.inventory.slots[this.selectedSlot] = null;
            this.inventory._markDirty();
        } else {
            this.inventory._markDirty();
        }
        return true;
    }

    getSlots() {
        const slots = [];
        for (let i = 0; i < 9; i++) {
            slots.push(this.inventory.getSlot(i));
        }
        return slots;
    }
}