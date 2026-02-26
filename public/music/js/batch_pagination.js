// Batch Selection and Deletion Functions
// Batch Selection and Deletion Functions
function handleBatchSelect(songId, isChecked) {
    const id = String(songId); // Force string ID
    if (isChecked) {
        selectedItems.add(id);
        // Cache song object if available in currentPlaylist
        if (currentPlaylist) {
            // Loose comparison just in case, though currentPlaylist IDs should match render
            const song = currentPlaylist.find(s => String(s.id) === id);
            if (song) selectedSongObjects.set(id, song);
        }
    } else {
        selectedItems.delete(id);
        selectedSongObjects.delete(id);
    }
    updateBatchToolbar();
}

function toggleBatchMode() {
    batchMode = !batchMode;
    selectedItems.clear();
    selectedSongObjects.clear();
    renderResults(currentPlaylist);
    updateBatchToolbar();

    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.classList.toggle('hidden', !batchMode);
    }
}

function selectAllVisible() {
    currentPlaylist.forEach(item => {
        const id = String(item.id);
        selectedItems.add(id);
        selectedSongObjects.set(id, item);
    });
    renderResults(currentPlaylist);
    updateBatchToolbar();
}

function deselectAll() {
    selectedItems.clear();
    selectedSongObjects.clear();
    renderResults(currentPlaylist);
    updateBatchToolbar();
}

function updateBatchToolbar() {
    const countEl = document.getElementById('batch-selected-count');
    if (countEl) {
        countEl.textContent = selectedItems.size;
    }

    const deleteBtn = document.getElementById('batch-delete-btn');
    if (deleteBtn) {
        // Hide delete button in network search mode
        if (typeof currentSearchScope !== 'undefined' && currentSearchScope === 'network') {
            deleteBtn.classList.add('hidden');
        } else {
            deleteBtn.classList.remove('hidden');
        }
    }
}

async function batchDeleteFromList() {
    if (selectedItems.size === 0) {
        alert('请先选择要删除的歌曲');
        return;
    }

    if (!confirm(`确定要删除选中的 ${selectedItems.size} 首歌曲吗?`)) {
        return;
    }

    // Get current list context
    const activeListId = getCurrentActiveListId();
    if (!activeListId || !currentListData) {
        alert('无法确定当前列表');
        return;
    }

    const idsToDelete = Array.from(selectedItems);

    if (window.SyncManager.mode === 'local') {
        // Local mode: Use user credentials to directly manipulate data
        const username = localStorage.getItem('lx_sync_user');
        const password = localStorage.getItem('lx_sync_pass');

        if (!username || !password) {
            alert('请先登录本地账号');
            return;
        }

        try {
            // Call user-specific API endpoint
            const res = await fetch('/api/music/user/list/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-name': username,
                    'x-user-password': password
                },
                body: JSON.stringify({
                    listId: activeListId,
                    songIds: idsToDelete
                })
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || '删除失败');
            }

            // Reload data from server
            const data = await window.SyncManager.sync();
            const oldUsername = currentListData ? currentListData.username : null;
            currentListData = data;
            if (oldUsername) currentListData.username = oldUsername; // Preserve username
            localStorage.setItem('lx_list_data', JSON.stringify(data));
            renderMyLists(data);

            // Refresh current view
            handleListClick(activeListId);

            console.log('[Batch] 本地模式删除成功');

        } catch (e) {
            alert('批量删除失败: ' + e.message);
            console.error('[Batch] 删除错误:', e);
        }
    } else if (window.SyncManager.mode === 'remote') {
        // Remote mode: Modify cache, sync on next connection
        try {
            // Get current list
            const listToModify = getListById(activeListId);
            if (!listToModify) {
                throw new Error('找不到当前列表');
            }

            // Remove items from list
            const remainingItems = listToModify.filter(item => !idsToDelete.includes(item.id));
            setListById(activeListId, remainingItems);

            // Save to cache
            localStorage.setItem('lx_list_data', JSON.stringify(currentListData));
            console.log('[Batch] WS模式:已修改缓存,下次连接时将同步');

            // If currently connected, push the change immediately
            if (window.SyncManager.client && window.SyncManager.client.isConnected) {
                try {
                    await pushDataChange();
                    console.log('[Batch] WS模式:实时推送成功');
                } catch (e) {
                    console.warn('[Batch] WS推送失败(将在下次连接时同步):', e);
                }
            }

            // Update UI
            renderMyLists(currentListData);
            handleListClick(activeListId);

        } catch (e) {
            alert('批量删除失败: ' + e.message);
            console.error('[Batch] WS删除错误:', e);
        }
    }

    // Clear selection and exit batch mode
    selectedItems.clear();
    batchMode = false;
    toggleBatchMode(); // Update UI
}

// Helper: Get current active list ID
function getCurrentActiveListId() {
    // From UI context or currentSearchScope
    if (currentSearchScope === 'local_list') {
        // Should track which list is being viewed
        return window.currentViewingListId || null;
    }
    return null;
}

// Helper: Get list by ID
function getListById(listId) {
    if (!currentListData) return null;
    if (listId === 'default') return currentListData.defaultList;
    if (listId === 'love') return currentListData.loveList;
    const userList = currentListData.userList.find(l => l.id === listId);
    return userList ? userList.list : null;
}

// Helper: Set list by ID
function setListById(listId, newList) {
    if (!currentListData) return;
    if (listId === 'default') currentListData.defaultList = newList;
    else if (listId === 'love') currentListData.loveList = newList;
    else {
        const userList = currentListData.userList.find(l => l.id === listId);
        if (userList) userList.list = newList;
    }
}

// Pagination Functions
function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '无结果';
        } else {
            infoEl.textContent = `显示 ${start}-${end} / 共 ${total} 首`;
        }
    }
}

function goToPage(page) {
    currentPage = page;
    renderResults(currentPlaylist);
}

function nextPage() {
    const totalItems = currentPlaylist.length;
    const itemsPerPage = settings.itemsPerPage === 'all' ? totalItems : parseInt(settings.itemsPerPage);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (currentPage < totalPages) {
        currentPage++;
        renderResults(currentPlaylist);
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderResults(currentPlaylist);
    }
}

// Settings: Items Per Page
function changeItemsPerPage(value) {
    settings.itemsPerPage = value === 'all' ? 'all' : parseInt(value);
    localStorage.setItem('lx_settings', JSON.stringify(settings));
    currentPage = 1; // Reset to first page
    renderResults(currentPlaylist);
}

// Load settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        try {
            settings = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
}

// Export functions to window
window.handleBatchSelect = handleBatchSelect;
window.toggleBatchMode = toggleBatchMode;
window.selectAllVisible = selectAllVisible;
window.deselectAll = deselectAll;
window.batchDeleteFromList = batchDeleteFromList;
window.goToPage = goToPage;
window.nextPage = nextPage;
window.prevPage = prevPage;
window.changeItemsPerPage = changeItemsPerPage;
