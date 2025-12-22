// =============================================================================
// Migration v1.7 → v2.0 - Automatische Daten-Migration
// =============================================================================

class MigrationV1toV2 {
    constructor(app, categoryManager, imageManager) {
        this.app = app;
        this.categoryManager = categoryManager;
        this.imageManager = imageManager;
        this.stats = {
            items: 0,
            images: 0,
            categories: 0,
            errors: []
        };
    }

    // -------------------------------------------------------------------------
    // Migration durchführen
    // -------------------------------------------------------------------------

    async migrate() {
        console.log('🔄 Migration v1.7 → v2.0 gestartet...');
        
        try {
            // Backup erstellen
            await this.createBackup();
            
            // Bilder migrieren
            await this.migrateImages();
            
            // Kategorien initialisieren
            await this.initializeCategories();
            
            // Version setzen
            localStorage.setItem('efsin_version', '2.0.0');
            
            console.log('✅ Migration abgeschlossen:', this.stats);
            return { success: true, stats: this.stats };
            
        } catch (error) {
            console.error('❌ Migration fehlgeschlagen:', error);
            return { success: false, error };
        }
    }

    // -------------------------------------------------------------------------
    // Backup erstellen
    // -------------------------------------------------------------------------

    async createBackup() {
        console.log('💾 Erstelle Backup...');
        
        const items = await this.app.db.getAll();
        const categories = this.app.categories;
        
        const backup = {
            version: '1.7.0',
            timestamp: new Date().toISOString(),
            items,
            categories
        };
        
        localStorage.setItem('efsin_backup_v1.7', JSON.stringify(backup));
        console.log(`✅ Backup: ${items.length} Artikel gesichert`);
    }

    // -------------------------------------------------------------------------
    // Bilder migrieren (Base64 → Blobs)
    // -------------------------------------------------------------------------

    async migrateImages() {
        console.log('📸 Migriere Bilder zu Blob-Storage...');
        
        const items = await this.app.db.getAll();
        let migrated = 0;
        
        for (const item of items) {
            if (item.photo && item.photo.startsWith('data:image/')) {
                try {
                    // Base64 zu Blob migrieren
                    const imageId = await this.imageManager.migrateFromBase64(
                        item.id,
                        item.category,
                        item.photo
                    );
                    
                    if (imageId) {
                        // Item aktualisieren (photo = imageId statt Base64)
                        item.photo = imageId;
                        await this.app.db.update(item);
                        migrated++;
                    }
                    
                } catch (error) {
                    console.error(`⚠️ Bild-Migration fehlgeschlagen: ${item.id}`, error);
                    this.stats.errors.push({
                        item: item.id,
                        error: error.message
                    });
                }
            }
        }
        
        this.stats.images = migrated;
        console.log(`✅ ${migrated} Bilder migriert`);
    }

    // -------------------------------------------------------------------------
    // Kategorien initialisieren
    // -------------------------------------------------------------------------

    async initializeCategories() {
        console.log('📂 Initialisiere Kategorien...');
        
        const items = await this.app.db.getAll();
        
        // Kategorien aus Items extrahieren
        const categorySet = new Set(items.map(item => item.category));
        this.stats.categories = categorySet.size;
        
        console.log(`✅ ${categorySet.size} Kategorien erkannt`);
        this.stats.items = items.length;
    }

    // -------------------------------------------------------------------------
    // Backup wiederherstellen (falls Migration fehlschlägt)
    // -------------------------------------------------------------------------

    async restoreBackup() {
        console.log('🔄 Stelle Backup wieder her...');
        
        const backup = localStorage.getItem('efsin_backup_v1.7');
        if (!backup) {
            throw new Error('Kein Backup gefunden!');
        }
        
        const data = JSON.parse(backup);
        
        // Items wiederherstellen
        for (const item of data.items) {
            await this.app.db.update(item);
        }
        
        // Kategorien wiederherstellen
        this.app.categories = data.categories;
        localStorage.setItem('efsin_categories', JSON.stringify(data.categories));
        
        console.log('✅ Backup wiederhergestellt');
    }

    // -------------------------------------------------------------------------
    // Migration-Dialog (UI)
    // -------------------------------------------------------------------------

    showMigrationDialog() {
        const dialog = `
            <div class="migration-dialog">
                <h2>🚀 Migration zu v2.0.0</h2>
                <p>Ihre Daten werden zur neuen Architektur migriert:</p>
                <ul>
                    <li>✅ Kategorien-basierte Dateien</li>
                    <li>✅ Bilder als separate Dateien</li>
                    <li>✅ Schnellerer Sync</li>
                    <li>✅ Unbegrenzte Skalierung</li>
                </ul>
                <p><strong>Wichtig:</strong></p>
                <ul>
                    <li>Backup wird automatisch erstellt</li>
                    <li>Dauer: ~2 Minuten</li>
                    <li>Nach Migration: GitHub neu syncen</li>
                </ul>
                <div class="dialog-actions">
                    <button onclick="migration.migrate()">Migration starten</button>
                    <button onclick="migration.cancel()">Abbrechen</button>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', dialog);
    }

    // -------------------------------------------------------------------------
    // Version prüfen
    // -------------------------------------------------------------------------

    static needsMigration() {
        const currentVersion = localStorage.getItem('efsin_version');
        return !currentVersion || currentVersion < '2.0.0';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MigrationV1toV2;
}
