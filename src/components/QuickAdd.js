// =============================================================================
// QuickAdd v2.0.0 - Schnelleingabe Mode
// =============================================================================

class QuickAdd {
    constructor(app, categoryManager) {
        this.app = app;
        this.categoryManager = categoryManager;
        this.lastCategory = null;
        this.todayCount = 0;
        this.templates = new Map();
        this.barcodeDB = new Map(); // Erweiterte Barcode-DB später
    }

    // -------------------------------------------------------------------------
    // Modal öffnen
    // -------------------------------------------------------------------------

    open() {
        const modal = document.getElementById('quickAddModal');
        modal.classList.add('active');
        
        // Reset
        this.resetForm();
        
        // Kategorie vorauswählen
        if (this.lastCategory) {
            document.getElementById('quickCategory').value = this.lastCategory;
        }
        
        // Focus auf Barcode-Feld
        document.getElementById('quickSKU').focus();
        
        // Statistik aktualisieren
        this.updateStats();
    }

    close() {
        document.getElementById('quickAddModal').classList.remove('active');
    }

    resetForm() {
        document.getElementById('quickSKU').value = '';
        document.getElementById('quickName').value = '';
        document.getElementById('quickStock').value = '';
        document.getElementById('quickPrice').value = '';
        document.getElementById('quickLocation').value = '';
    }

    // -------------------------------------------------------------------------
    // Smart Defaults
    // -------------------------------------------------------------------------

    async getDefaults(categoryId) {
        if (this.templates.has(categoryId)) {
            return this.templates.get(categoryId);
        }
        
        const items = await this.categoryManager.loadCategoryItems(categoryId);
        if (items.length === 0) {
            return {
                unit: 'Stück',
                min: 1,
                max: 10,
                location: ''
            };
        }
        
        // Letzter Artikel in Kategorie
        const lastItem = items[items.length - 1];
        const defaults = {
            unit: lastItem.unit,
            min: lastItem.min,
            max: lastItem.max,
            location: lastItem.location
        };
        
        this.templates.set(categoryId, defaults);
        return defaults;
    }

    // -------------------------------------------------------------------------
    // Barcode Lookup
    // -------------------------------------------------------------------------

    async lookupBarcode(code) {
        // 1. Interne DB prüfen
        if (this.barcodeDB.has(code)) {
            return this.barcodeDB.get(code);
        }
        
        // 2. Bestehende Artikel durchsuchen
        const allItems = await this.app.db.getAll();
        const existing = allItems.find(item => item.sku === code);
        if (existing) {
            return {
                name: existing.name,
                category: existing.category,
                unit: existing.unit,
                price: existing.price,
                existing: true
            };
        }
        
        // 3. Externe API (später implementieren)
        // const external = await this.fetchFromAPI(code);
        
        return null;
    }

    // -------------------------------------------------------------------------
    // Speichern
    // -------------------------------------------------------------------------

    async save() {
        const sku = document.getElementById('quickSKU').value.trim();
        const name = document.getElementById('quickName').value.trim();
        const stock = parseFloat(document.getElementById('quickStock').value);
        const categoryId = document.getElementById('quickCategory').value;
        
        if (!name || !stock || !categoryId) {
            this.app.showToast('Name, Anzahl und Kategorie erforderlich!', 'error');
            return;
        }
        
        // Smart Defaults laden
        const defaults = await this.getDefaults(categoryId);
        
        // Artikel erstellen
        const item = {
            id: this.app.generateId(),
            name,
            sku: sku || '',
            category: categoryId,
            stock,
            unit: defaults.unit,
            min: defaults.min,
            max: defaults.max,
            price: parseFloat(document.getElementById('quickPrice').value) || 0,
            location: document.getElementById('quickLocation').value || defaults.location,
            notes: '',
            photo: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Speichern
        await this.app.db.add(item);
        
        // Statistik
        this.todayCount++;
        this.lastCategory = categoryId;
        
        // Cache invalidieren
        this.categoryManager.invalidateCache(categoryId);
        
        // Toast
        this.app.showToast(`✅ "${name}" hinzugefügt`, 'success');
        
        // Form reset für nächsten Artikel
        this.resetForm();
        document.getElementById('quickCategory').value = categoryId;
        document.getElementById('quickSKU').focus();
        
        // Statistik aktualisieren
        this.updateStats();
    }

    // -------------------------------------------------------------------------
    // UI Updates
    // -------------------------------------------------------------------------

    updateStats() {
        document.getElementById('quickTodayCount').textContent = this.todayCount;
    }

    async handleBarcodeInput(code) {
        if (!code) return;
        
        const result = await this.lookupBarcode(code);
        
        if (result) {
            if (result.existing) {
                // Artikel existiert bereits
                const increase = confirm(
                    `Artikel "${result.name}" existiert bereits!\n\n` +
                    `Bestand erhöhen statt neu anzulegen?`
                );
                
                if (increase) {
                    // Bestand erhöhen (später implementieren)
                    this.close();
                    return;
                }
            }
            
            // Auto-Fill
            document.getElementById('quickName').value = result.name;
            if (result.category) {
                document.getElementById('quickCategory').value = result.category;
            }
            if (result.price) {
                document.getElementById('quickPrice').value = result.price;
            }
            
            // Focus auf Anzahl
            document.getElementById('quickStock').focus();
        }
    }

    // -------------------------------------------------------------------------
    // Keyboard Shortcuts
    // -------------------------------------------------------------------------

    handleKeyboard(event) {
        if (event.key === 'Enter' && event.target.id !== 'quickSKU') {
            event.preventDefault();
            this.save();
        }
        
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close();
        }
        
        if (event.ctrlKey && event.key === 'b') {
            event.preventDefault();
            // Barcode-Scanner aktivieren (später)
            document.getElementById('quickSKU').focus();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuickAdd;
}
