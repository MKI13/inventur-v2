// =============================================================================
// MultiFileGitHubSync v2.0.0 - Intelligenter Multi-File Sync
// =============================================================================

class MultiFileGitHubSync {
    constructor(categoryManager, imageManager) {
        this.categoryManager = categoryManager;
        this.imageManager = imageManager;
        this.token = localStorage.getItem('efsin_github_token');
        this.owner = localStorage.getItem('efsin_github_owner');
        this.repo = localStorage.getItem('efsin_github_repo');
        this.branch = 'main';
        this.syncInterval = null;
        this.isSyncing = false;
        this.fileSHAs = new Map(); // Map<filePath, sha>
    }

    isConfigured() {
        return !!(this.token && this.owner && this.repo);
    }

    // -------------------------------------------------------------------------
    // index.json Sync
    // -------------------------------------------------------------------------

    async syncIndex() {
        console.log('📄 Syncing index.json...');
        
        const localIndex = await this.categoryManager.exportIndexJSON();
        const remoteIndex = await this.getFile('index.json');
        
        if (!remoteIndex) {
            // Erste Sync
            await this.putFile('index.json', localIndex, 'Initial sync: index.json');
            return { action: 'uploaded', file: 'index.json' };
        }
        
        // Vergleiche Timestamps
        const localTime = new Date(localIndex.lastUpdated).getTime();
        const remoteTime = new Date(remoteIndex.lastUpdated).getTime();
        
        if (localTime > remoteTime) {
            await this.putFile('index.json', localIndex, 'Update index.json');
            return { action: 'uploaded', file: 'index.json' };
        } else if (remoteTime > localTime) {
            return { action: 'downloaded', file: 'index.json', data: remoteIndex };
        }
        
        return { action: 'none', file: 'index.json' };
    }

    // -------------------------------------------------------------------------
    // Kategorie-Dateien Sync
    // -------------------------------------------------------------------------

    async syncCategory(categoryId) {
        console.log(`📂 Syncing category: ${categoryId}...`);
        
        const localData = await this.categoryManager.exportCategoryJSON(categoryId);
        const remoteData = await this.getFile(`categories/${categoryId}.json`);
        
        if (!remoteData) {
            // Kategorie existiert nicht remote
            await this.putFile(
                `categories/${categoryId}.json`,
                localData,
                `Add category: ${categoryId}`
            );
            return { action: 'uploaded', category: categoryId };
        }
        
        // Vergleiche lastModified
        const localTime = new Date(localData.lastModified).getTime();
        const remoteTime = new Date(remoteData.lastModified).getTime();
        
        if (localTime > remoteTime) {
            await this.putFile(
                `categories/${categoryId}.json`,
                localData,
                `Update category: ${categoryId}`
            );
            return { action: 'uploaded', category: categoryId };
        } else if (remoteTime > localTime) {
            await this.categoryManager.importCategoryJSON(categoryId, remoteData);
            return { action: 'downloaded', category: categoryId };
        }
        
        return { action: 'none', category: categoryId };
    }

    async syncAllCategories() {
        const results = [];
        
        for (const category of this.categoryManager.categories) {
            try {
                const result = await this.syncCategory(category.id);
                results.push(result);
            } catch (error) {
                console.error(`❌ Fehler bei Kategorie ${category.id}:`, error);
                results.push({ action: 'error', category: category.id, error });
            }
        }
        
        return results;
    }

    // -------------------------------------------------------------------------
    // Intelligenter Sync (nur geänderte Kategorien)
    // -------------------------------------------------------------------------

    async smartSync() {
        if (this.isSyncing) {
            console.log('⏸️ Sync läuft bereits');
            return { status: 'busy' };
        }
        
        this.isSyncing = true;
        const startTime = Date.now();
        
        try {
            console.log('🔄 Smart Sync gestartet...');
            
            // 1. Index syncen
            const indexResult = await this.syncIndex();
            
            // 2. Geänderte Kategorien ermitteln
            const remoteIndex = indexResult.action === 'downloaded' 
                ? indexResult.data 
                : await this.getFile('index.json');
            
            const changedCategories = await this.detectChangedCategories(remoteIndex);
            
            console.log(`📊 ${changedCategories.length} Kategorien zu syncen`);
            
            // 3. Nur geänderte Kategorien syncen
            const results = [];
            for (const categoryId of changedCategories) {
                const result = await this.syncCategory(categoryId);
                results.push(result);
            }
            
            const duration = Date.now() - startTime;
            console.log(`✅ Smart Sync abgeschlossen in ${duration}ms`);
            
            return {
                status: 'success',
                duration,
                index: indexResult,
                categories: results
            };
            
        } catch (error) {
            console.error('❌ Smart Sync Fehler:', error);
            return { status: 'error', error };
        } finally {
            this.isSyncing = false;
        }
    }

    async detectChangedCategories(remoteIndex) {
        const changed = [];
        
        for (const category of this.categoryManager.categories) {
            const localStats = await this.categoryManager.getCategoryStats(category.id);
            const remoteCat = remoteIndex?.categories?.find(c => c.id === category.id);
            
            if (!remoteCat) {
                // Neue Kategorie
                changed.push(category.id);
                continue;
            }
            
            // Vergleiche Timestamps
            const localTime = localStats.lastModified;
            const remoteTime = new Date(remoteCat.lastModified).getTime();
            
            if (localTime > remoteTime || remoteTime > localTime) {
                changed.push(category.id);
            }
        }
        
        return changed;
    }

    // -------------------------------------------------------------------------
    // Bild-Sync (on-demand)
    // -------------------------------------------------------------------------

    async syncImage(itemId, categoryId) {
        const imageId = `${categoryId}/${itemId}`;
        
        // Prüfe ob Bild lokal existiert
        const localBlob = await this.imageManager.loadImage(imageId);
        
        if (localBlob) {
            // Upload zu GitHub
            await this.imageManager.uploadToGitHub(imageId, localBlob, this);
            return { action: 'uploaded', image: imageId };
        } else {
            // Download von GitHub
            const blob = await this.imageManager.downloadFromGitHub(imageId, this);
            return { action: 'downloaded', image: imageId, blob };
        }
    }

    async syncAllImagesForCategory(categoryId) {
        const items = await this.categoryManager.loadCategoryItems(categoryId);
        const results = [];
        
        for (const item of items) {
            if (item.photo) {
                try {
                    const result = await this.syncImage(item.id, categoryId);
                    results.push(result);
                } catch (error) {
                    console.error(`❌ Bild-Sync Fehler: ${item.id}`, error);
                    results.push({ action: 'error', image: `${categoryId}/${item.id}`, error });
                }
            }
        }
        
        return results;
    }

    // -------------------------------------------------------------------------
    // GitHub API - Dateien
    // -------------------------------------------------------------------------

    async getFile(path) {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.status === 404) {
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`GitHub API Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            // SHA speichern
            this.fileSHAs.set(path, data.sha);
            
            // Content decodieren
            const base64Content = data.content.replace(/\s/g, '');
            const jsonString = base64DecodeUTF8(base64Content);
            return JSON.parse(jsonString);
            
        } catch (error) {
            console.error(`❌ getFile(${path}) Fehler:`, error);
            throw error;
        }
    }

    async putFile(path, data, message) {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
        
        const jsonString = JSON.stringify(data, null, 2);
        const content = base64EncodeUTF8(jsonString);
        
        const body = {
            message,
            content,
            branch: this.branch
        };
        
        // SHA hinzufügen wenn vorhanden
        if (this.fileSHAs.has(path)) {
            body.sha = this.fileSHAs.get(path);
        }
        
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `GitHub API Error: ${response.status}`);
            }
            
            const result = await response.json();
            
            // SHA aktualisieren
            this.fileSHAs.set(path, result.content.sha);
            
            return result;
            
        } catch (error) {
            console.error(`❌ putFile(${path}) Fehler:`, error);
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // GitHub API - Binärdateien (Bilder)
    // -------------------------------------------------------------------------

    async uploadFile(path, base64Content) {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
        
        const body = {
            message: `Upload image: ${path}`,
            content: base64Content,
            branch: this.branch
        };
        
        // SHA wenn vorhanden
        if (this.fileSHAs.has(path)) {
            body.sha = this.fileSHAs.get(path);
        }
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }
        
        const result = await response.json();
        this.fileSHAs.set(path, result.content.sha);
    }

    async downloadFile(path) {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        
        const data = await response.json();
        this.fileSHAs.set(path, data.sha);
        
        return data.content.replace(/\s/g, '');
    }

    // -------------------------------------------------------------------------
    // Auto-Sync
    // -------------------------------------------------------------------------

    startAutoSync(intervalMinutes = 5) {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        this.syncInterval = setInterval(
            () => this.smartSync(),
            intervalMinutes * 60 * 1000
        );
        
        console.log(`⏰ Auto-Sync gestartet: alle ${intervalMinutes} Minuten`);
    }

    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('⏸️ Auto-Sync gestoppt');
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiFileGitHubSync;
}
