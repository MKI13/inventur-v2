// =============================================================================
// ImageManager v2.0.0 - Separate Bild-Dateien statt Base64
// =============================================================================

class ImageManager {
    constructor() {
        this.imageCache = new Map(); // Map<imageId, Blob>
        this.indexedDB = null;
        this.compression = {
            maxWidth: 800,
            maxHeight: 600,
            quality: 0.7
        };
    }

    // -------------------------------------------------------------------------
    // IndexedDB für Bild-Cache
    // -------------------------------------------------------------------------

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('efsinImagesDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.indexedDB = request.result;
                console.log('✅ ImageManager: IndexedDB initialisiert');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'id' });
                }
            };
        });
    }

    // -------------------------------------------------------------------------
    // Bild komprimieren
    // -------------------------------------------------------------------------

    async compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    let { width, height } = img;
                    const { maxWidth, maxHeight } = this.compression;
                    
                    if (width > maxWidth || height > maxHeight) {
                        if (width > height) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        } else {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    canvas.toBlob(
                        (blob) => resolve(blob),
                        'image/jpeg',
                        this.compression.quality
                    );
                };
                img.onerror = reject;
                img.src = event.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // -------------------------------------------------------------------------
    // Bild speichern (lokal)
    // -------------------------------------------------------------------------

    async saveImage(itemId, categoryId, file) {
        // Komprimieren
        const blob = await this.compressImage(file);
        
        // ID generieren
        const imageId = `${categoryId}/${itemId}`;
        
        // In IndexedDB speichern
        await this.storeInDB(imageId, blob);
        
        // Cache aktualisieren
        this.imageCache.set(imageId, blob);
        
        console.log(`📸 Bild gespeichert: ${imageId} (${(blob.size / 1024).toFixed(0)}KB)`);
        
        return imageId;
    }

    async storeInDB(imageId, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.indexedDB.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const request = store.put({
                id: imageId,
                blob: blob,
                timestamp: Date.now()
            });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // -------------------------------------------------------------------------
    // Bild laden (lokal)
    // -------------------------------------------------------------------------

    async loadImage(imageId) {
        // Cache prüfen
        if (this.imageCache.has(imageId)) {
            return this.imageCache.get(imageId);
        }
        
        // Von IndexedDB laden
        const blob = await this.loadFromDB(imageId);
        if (blob) {
            this.imageCache.set(imageId, blob);
            return blob;
        }
        
        return null;
    }

    async loadFromDB(imageId) {
        return new Promise((resolve, reject) => {
            const transaction = this.indexedDB.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.get(imageId);
            
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.blob : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // -------------------------------------------------------------------------
    // Bild als DataURL (für Preview)
    // -------------------------------------------------------------------------

    async getImageDataURL(imageId) {
        const blob = await this.loadImage(imageId);
        if (!blob) return null;
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(blob);
        });
    }

    // -------------------------------------------------------------------------
    // Bild löschen
    // -------------------------------------------------------------------------

    async deleteImage(imageId) {
        return new Promise((resolve, reject) => {
            const transaction = this.indexedDB.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const request = store.delete(imageId);
            
            request.onsuccess = () => {
                this.imageCache.delete(imageId);
                console.log(`🗑️ Bild gelöscht: ${imageId}`);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    // -------------------------------------------------------------------------
    // GitHub Upload/Download
    // -------------------------------------------------------------------------

    async uploadToGitHub(imageId, blob, githubSync) {
        const path = `images/${imageId}.jpg`;
        
        // Blob zu Base64
        const base64 = await this.blobToBase64(blob);
        
        // Upload zu GitHub
        await githubSync.uploadFile(path, base64);
        
        console.log(`⬆️ Bild hochgeladen: ${path}`);
    }

    async downloadFromGitHub(imageId, githubSync) {
        const path = `images/${imageId}.jpg`;
        
        try {
            // Download von GitHub
            const base64 = await githubSync.downloadFile(path);
            
            // Base64 zu Blob
            const blob = await this.base64ToBlob(base64, 'image/jpeg');
            
            // Lokal speichern
            await this.storeInDB(imageId, blob);
            this.imageCache.set(imageId, blob);
            
            console.log(`⬇️ Bild heruntergeladen: ${path}`);
            return blob;
            
        } catch (error) {
            console.error(`❌ Fehler beim Laden von ${path}:`, error);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Base64 Conversion
    // -------------------------------------------------------------------------

    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    // -------------------------------------------------------------------------
    // Alle Bilder einer Kategorie
    // -------------------------------------------------------------------------

    async getCategoryImages(categoryId) {
        return new Promise((resolve, reject) => {
            const transaction = this.indexedDB.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const all = request.result;
                const categoryImages = all.filter(img => 
                    img.id.startsWith(`${categoryId}/`)
                );
                resolve(categoryImages);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // -------------------------------------------------------------------------
    // Migration von Base64 zu Blob
    // -------------------------------------------------------------------------

    async migrateFromBase64(itemId, categoryId, base64DataURL) {
        try {
            // Base64 DataURL zu Blob
            const response = await fetch(base64DataURL);
            const blob = await response.blob();
            
            // Komprimieren
            const compressedBlob = await this.compressImage(
                new File([blob], 'photo.jpg', { type: blob.type })
            );
            
            // Speichern
            const imageId = await this.saveImage(itemId, categoryId, 
                new File([compressedBlob], 'photo.jpg', { type: 'image/jpeg' })
            );
            
            console.log(`🔄 Migriert: ${itemId} → ${imageId}`);
            return imageId;
            
        } catch (error) {
            console.error(`❌ Migration fehlgeschlagen: ${itemId}`, error);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Statistiken
    // -------------------------------------------------------------------------

    async getStats() {
        return new Promise((resolve, reject) => {
            const transaction = this.indexedDB.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.getAll();
            
            request.onsuccess = () => {
                const images = request.result;
                const totalSize = images.reduce((sum, img) => sum + img.blob.size, 0);
                
                resolve({
                    count: images.length,
                    totalSize: totalSize,
                    averageSize: images.length > 0 ? totalSize / images.length : 0
                });
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageManager;
}
