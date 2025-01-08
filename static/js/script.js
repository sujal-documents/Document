document.addEventListener('DOMContentLoaded', function() {
    // Hamburger Menu Functionality
    const hamburger = document.querySelector('.hamburger-menu');
    const navItems = document.querySelector('.nav-items');
    
    hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('active');
        navItems.classList.toggle('active');
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(event) {
        if (!hamburger.contains(event.target) && !navItems.contains(event.target)) {
            hamburger.classList.remove('active');
            navItems.classList.remove('active');
        }
    });

    // Upload functionality
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressBar = uploadProgress.querySelector('.progress');
    const progressText = uploadProgress.querySelector('.progress-text');

    // Trigger file input when clicking the upload area
    uploadArea.addEventListener('click', () => fileInput.click());

    // Drag and drop functionality
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.remove('dragover');
        });
    });

    uploadArea.addEventListener('drop', handleDrop);
    fileInput.addEventListener('change', handleFiles);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
    }

    async function handleFiles(e) {
        const file = e.target.files[0];
        if (!file) return;

        uploadProgress.hidden = false;
        progressBar.style.width = '0%';
        progressText.textContent = 'Uploading...';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                progressBar.style.width = '100%';
                progressText.textContent = 'Upload complete!';
                showToast('File uploaded successfully', 'success');
                
                // Refresh the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 1000); // 1 second delay to show the success message
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            showToast(error.message || 'Error uploading file', 'error');
        }

        setTimeout(() => {
            uploadProgress.hidden = true;
            fileInput.value = '';
        }, 2000);
    }

    function createFileCard(file) {
        const fileIcon = getFileIcon(file.type);
        let previewContent = '';
        if (file.preview) {
            if (file.preview.startsWith('data:image')) {
                previewContent = `<div class="file-preview"><img src="${file.preview}" alt="${file.name} preview" /></div>`;
            } else {
                previewContent = `<div class="file-preview">${file.preview}</div>`;
            }
        }
        const uploadTime = file.uploaded_time; 
        return `
            <div class="file-card" data-filename="${file.name}">
                ${!file.preview ? `<div class="file-icon"><i class="${fileIcon}"></i></div>` : ''}
                ${previewContent}
                <div class="file-info">
                    <h3>${file.name}</h3>
                    <p>Size: ${(file.size / 1024).toFixed(2)} KB</p>
                    <p>Uploaded: ${uploadTime}</p>
                </div>
                <div class="file-actions">
                    <button class="action-btn download" onclick="window.location.href='/download/${file.name}'">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="action-btn share" onclick="shareFile('${file.name}')">
                        <i class="fas fa-share-alt"></i>
                    </button>
                    <button class="action-btn delete" onclick="confirmDelete('${file.name}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    function getFileIcon(type) {
        const imageTypes = ['jpg', 'jpeg', 'png', 'gif'];
        if (imageTypes.includes(type)) return 'fas fa-image';
        if (type === 'pdf') return 'fas fa-file-pdf';
        if (['doc', 'docx'].includes(type)) return 'fas fa-file-word';
        return 'fas fa-file';
    }

    // Delete functionality
    let fileToDelete = null;
    const deleteModal = document.getElementById('deleteModal');

    window.confirmDelete = function(filename) {
        fileToDelete = filename;
        deleteModal.querySelector('.filename').textContent = filename;
        deleteModal.classList.add('active');
    };

    window.closeDeleteModal = function() {
        deleteModal.classList.remove('active');
        fileToDelete = null;
    };

    window.deleteFile = async function() {
        if (!fileToDelete) return;

        try {
            const response = await fetch(`/delete/${fileToDelete}`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                const fileCard = document.querySelector(`[data-filename="${fileToDelete}"]`);
                if (fileCard) {
                    fileCard.style.transform = 'scale(0.8)';
                    fileCard.style.opacity = '0';
                    setTimeout(() => {
                        fileCard.remove();
                        // Check if no files left
                        const filesContainer = document.getElementById('filesContainer');
                        if (!filesContainer.querySelector('.file-card')) {
                            filesContainer.innerHTML = '<p class="no-files">No files uploaded yet.</p>';
                        }
                    }, 300);
                }
                showToast('File deleted successfully', 'success');
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error deleting file:', error);
            showToast(error.message || 'Error deleting file', 'error');
        }

        closeDeleteModal();
    };

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;

    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const query = this.value.trim();
        
        searchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`/search?query=${encodeURIComponent(query)}`);
                const files = await response.json();
                const filesContainer = document.getElementById('filesContainer');
                
                filesContainer.innerHTML = files.length ? 
                    files.map(file => createFileCard(file)).join('') :
                    '<p class="no-files">No files found.</p>';
            } catch (error) {
                console.error('Error searching files:', error);
                showToast('Error searching files', 'error');
            }
        }, 300);
    });

    // Share functionality
    window.shareFile = async function(filename) {
        try {
            const response = await fetch(`/download/${filename}`);
            const blob = await response.blob();
            const file = new File([blob], filename, { type: blob.type });

            if (navigator.share) {
                await navigator.share({
                    title: filename,
                    text: `Sharing file: ${filename}`,
                    files: [file]
                });
            } else {
                // Fallback for browsers that don't support Web Share API
                const shareUrl = window.URL.createObjectURL(blob);
                const tempLink = document.createElement('a');
                tempLink.href = shareUrl;
                tempLink.setAttribute('download', filename);
                
                // Create a custom share modal
                const modal = document.createElement('div');
                modal.className = 'share-modal';
                modal.innerHTML = `
                    <div class="share-modal-content">
                        <h3>Share ${filename}</h3>
                        <div class="share-options">
                            <a href="https://wa.me/?text=${encodeURIComponent(`Check out this file: ${filename}`)}" target="_blank" class="share-option">
                                <i class="fab fa-whatsapp"></i>
                                <span>WhatsApp</span>
                            </a>
                            <a href="https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(`Check out this file: ${filename}`)}" target="_blank" class="share-option">
                                <i class="fab fa-telegram"></i>
                                <span>Telegram</span>
                            </a>
                            <a href="mailto:?subject=${encodeURIComponent(`Sharing file: ${filename}`)}&body=${encodeURIComponent(`Check out this file: ${filename}`)}" class="share-option">
                                <i class="fas fa-envelope"></i>
                                <span>Email</span>
                            </a>
                        </div>
                        <button class="close-modal">Close</button>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                // Close modal functionality
                modal.querySelector('.close-modal').addEventListener('click', () => {
                    modal.remove();
                });
                
                // Close when clicking outside
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.remove();
                    }
                });
            }
        } catch (error) {
            console.error('Error sharing file:', error);
            alert('Error sharing file. Please try again.');
        }
    };

    // Toast notification function
    window.showToast = function(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            ${message}
        `;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    const filesContainer = document.getElementById('filesContainer');

    filesContainer.addEventListener('dblclick', function(event) {
        const card = event.target.closest('.file-card');
        const isButton = event.target.closest('.action-btn');
        if (card && !isButton) {
            const fileName = card.getAttribute('data-filename');
            openFileInNewTab(fileName);
        }
    });

    function openFileInNewTab(fileName) {
        window.open(`/view/${fileName}`, '_blank');
    }
});
