// ==UserScript==
// @name         Claude Chat Markers
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Add markers to specific text selections in Claude chat with side panel navigation
// @match        https://claude.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let selectionButton = null;

    // Get chat ID from URL
    function getChatId() {
        const match = window.location.pathname.match(/\/chat\/([^\/]+)/);
        return match ? match[1] : null;
    }

    // Storage functions
    function getMarkers() {
        const chatId = getChatId();
        if (!chatId) return [];
        const stored = localStorage.getItem(`claude-markers-${chatId}`);
        return stored ? JSON.parse(stored) : [];
    }

    function saveMarkers(markers) {
        const chatId = getChatId();
        if (!chatId) return;
        localStorage.setItem(`claude-markers-${chatId}`, JSON.stringify(markers));
    }

    function addMarker(name, selectedText, containerIndex, beforeText, afterText) {
        const markers = getMarkers();
        const markerId = `marker-${Date.now()}`;

        markers.push({
            id: markerId,
            name: name,
            selectedText: selectedText,
            containerIndex: containerIndex,
            beforeText: beforeText,
            afterText: afterText,
            timestamp: Date.now()
        });

        saveMarkers(markers);
        return markerId;
    }

    function deleteMarker(markerId) {
        let markers = getMarkers();
        markers = markers.filter(m => m.id !== markerId);
        saveMarkers(markers);
    }

    function getMessageContainers() {
        return document.querySelectorAll('div[data-test-render-count]');
    }

    function getContainerIndex(element) {
        const containers = Array.from(getMessageContainers());
        // Find the container that contains this element
        for (let i = 0; i < containers.length; i++) {
            if (containers[i].contains(element)) {
                return i;
            }
        }
        return -1;
    }

    // Create side panel
    function createSidePanel() {
        const panel = document.createElement('div');
        panel.id = 'marker-panel';

        // Restore saved position or use default
        const savedPosition = getSavedPanelPosition();
        panel.style.left = savedPosition.left;
        panel.style.top = savedPosition.top;

        panel.innerHTML = `
            <div id="marker-panel-header">
                <h3>Chat Markers</h3>
                <button id="marker-panel-toggle">−</button>
            </div>
            <div id="marker-list"></div>
        `;
        document.body.appendChild(panel);

        // Toggle panel
        document.getElementById('marker-panel-toggle').addEventListener('click', function() {
            const list = document.getElementById('marker-list');
            const isCollapsed = list.style.display === 'none';
            list.style.display = isCollapsed ? 'block' : 'none';
            this.textContent = isCollapsed ? '−' : '+';
        });

        // Make panel draggable
        makePanelDraggable(panel);

        updateMarkerList();
    }

    function getSavedPanelPosition() {
        const chatId = getChatId();
        const saved = localStorage.getItem(`marker-panel-position-${chatId}`);
        if (saved) {
            const position = JSON.parse(saved);
            // Ensure position is within current viewport
            return constrainToViewport(position);
        }
        // Default position
        return { left: 'auto', top: '80px', right: '20px' };
    }

    function constrainToViewport(position) {
        const panelWidth = 300;
        const panelHeight = 300;

        let left = position.left === 'auto' ? null : parseInt(position.left);
        let top = position.top === 'auto' ? 80 : parseInt(position.top);
        let right = position.right === 'auto' ? null : parseInt(position.right);

        // Convert right to left if needed
        if (right !== null && left === null) {
            left = window.innerWidth - right - panelWidth;
        }

        // Default left if still null
        if (left === null) {
            left = window.innerWidth - panelWidth - 20;
        }

        // Constrain both axes to viewport
        left = Math.max(10, Math.min(left, window.innerWidth - panelWidth - 10));
        top = Math.max(10, Math.min(top, window.innerHeight - panelHeight - 10));

        return { left: `${left}px`, top: `${top}px`, right: 'auto' };
    }

    function savePanelPosition(left, top) {
        const chatId = getChatId();
        localStorage.setItem(`marker-panel-position-${chatId}`, JSON.stringify({ left, top, right: 'auto' }));
    }

    function makePanelDraggable(panel) {
        const header = document.getElementById('marker-panel-header');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;

        header.style.cursor = 'move';

        header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking the toggle button
            if (e.target.id === 'marker-panel-toggle') return;

            isDragging = true;
            initialX = e.clientX - panel.offsetLeft;
            initialY = e.clientY - panel.offsetTop;

            // Remove right positioning when starting to drag
            panel.style.right = 'auto';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            // Keep panel within viewport
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;

            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

            panel.style.left = currentX + 'px';
            panel.style.top = currentY + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                // Save position
                savePanelPosition(panel.style.left, panel.style.top);
            }
        });
    }

    // Update marker list in panel
    function updateMarkerList() {
        const markers = getMarkers();
        const list = document.getElementById('marker-list');
        if (!list) return;

        list.innerHTML = '';

        if (markers.length === 0) {
            list.innerHTML = '<div class="marker-empty">No markers yet<br><small>Select text and click the 🔖 button</small></div>';
            return;
        }

        markers.forEach(marker => {
            const item = document.createElement('div');
            item.className = 'marker-item';

            const previewText = marker.selectedText.length > 50
                ? marker.selectedText.substring(0, 50) + '...'
                : marker.selectedText;

            item.innerHTML = `
                <div class="marker-item-content">
                    <div class="marker-name">${escapeHtml(marker.name)}</div>
                    <div class="marker-preview">${escapeHtml(previewText)}</div>
                    <div class="marker-time">${new Date(marker.timestamp).toLocaleTimeString()}</div>
                </div>
                <button class="marker-delete" data-marker-id="${marker.id}">×</button>
            `;

            // Navigate to marker
            item.querySelector('.marker-item-content').addEventListener('click', () => {
                navigateToMarker(marker);
            });

            // Delete marker
            item.querySelector('.marker-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteMarker(marker.id);
                updateMarkerList();
            });

            list.appendChild(item);
        });
    }

    // Navigate to marker
    function navigateToMarker(marker) {
        const containers = getMessageContainers();
        const container = containers[marker.containerIndex];

        if (!container) {
            alert('Message not found. It may have been deleted.');
            return;
        }

        // Scroll to container
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Find and highlight the text
        setTimeout(() => {
            highlightTextInContainer(container, marker.selectedText, marker.beforeText, marker.afterText);
        }, 500);
    }

    function highlightTextInContainer(container, searchText, beforeText, afterText) {
        // Remove any existing highlights
        const existingHighlights = container.querySelectorAll('.marker-highlight');
        existingHighlights.forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });

        // Find the text using TreeWalker
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent;
            const index = text.indexOf(searchText);

            if (index !== -1) {
                // Check context if provided
                if (beforeText || afterText) {
                    const fullText = getFullTextContext(node);
                    const fullIndex = fullText.indexOf(searchText);

                    if (fullIndex !== -1) {
                        const before = fullText.substring(Math.max(0, fullIndex - 50), fullIndex);
                        const after = fullText.substring(fullIndex + searchText.length, fullIndex + searchText.length + 50);

                        // Check if context matches (fuzzy match)
                        const contextMatches =
                            (!beforeText || before.includes(beforeText.substring(Math.max(0, beforeText.length - 30)))) &&
                            (!afterText || after.includes(afterText.substring(0, Math.min(30, afterText.length))));

                        if (!contextMatches) continue;
                    }
                }

                // Highlight the text
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + searchText.length);

                const highlight = document.createElement('span');
                highlight.className = 'marker-highlight';
                range.surroundContents(highlight);

                // Scroll to the highlight
                highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Flash effect
                setTimeout(() => highlight.classList.add('flash'), 100);
                setTimeout(() => highlight.classList.remove('flash'), 2100);

                return true;
            }
        }

        // If not found, just flash the container
        container.style.backgroundColor = '#fff3cd';
        setTimeout(() => {
            container.style.backgroundColor = '';
        }, 2000);

        return false;
    }

    function getFullTextContext(node) {
        let current = node;
        let text = '';

        // Get surrounding text nodes
        const walker = document.createTreeWalker(
            node.parentElement,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        while (walker.nextNode()) {
            text += walker.currentNode.textContent;
        }

        return text;
    }

    // Handle text selection
    function handleSelection() {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        // Remove existing button if no selection
        if (!selectedText || selectedText.length < 3) {
            hideSelectionButton();
            return;
        }

        // Get selection position
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Check if selection is within a message container
        const container = range.commonAncestorContainer;
        const containerIndex = getContainerIndex(container.nodeType === 3 ? container.parentElement : container);

        if (containerIndex === -1) {
            hideSelectionButton();
            return;
        }

        // Show button near selection
        showSelectionButton(rect, selectedText, containerIndex, range);
    }

    function showSelectionButton(rect, selectedText, containerIndex, range) {
        // Store range data to use in click handler
        const rangeData = {
            selectedText: selectedText,
            containerIndex: containerIndex,
            fullText: range.startContainer.textContent,
            startOffset: range.startOffset,
            endOffset: range.endOffset
        };

        if (!selectionButton) {
            selectionButton = document.createElement('button');
            selectionButton.className = 'selection-marker-btn';
            selectionButton.innerHTML = '🔖 Add Marker';
            selectionButton.title = 'Create marker for selected text';
            document.body.appendChild(selectionButton);

            // Add single click handler
            selectionButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleMarkerButtonClick();
            });
        }

        // Store data on button
        selectionButton.rangeData = rangeData;

        // Position button above selection
        selectionButton.style.left = `${rect.left + (rect.width / 2) - 60}px`;
        selectionButton.style.top = `${rect.top + window.scrollY - 40}px`;
        selectionButton.style.display = 'block';
    }

    function handleMarkerButtonClick() {
        if (!selectionButton || !selectionButton.rangeData) return;

        const data = selectionButton.rangeData;
        const name = prompt('Enter marker name:');

        if (name) {
            // Get context text for better matching
            const beforeText = data.fullText.substring(Math.max(0, data.startOffset - 50), data.startOffset);
            const afterText = data.fullText.substring(data.endOffset, Math.min(data.fullText.length, data.endOffset + 50));

            addMarker(name, data.selectedText, data.containerIndex, beforeText, afterText);
            updateMarkerList();

            // Clear selection
            window.getSelection().removeAllRanges();
            hideSelectionButton();
        }
    }

    function hideSelectionButton() {
        if (selectionButton) {
            selectionButton.style.display = 'none';
        }
    }

    // Utility function
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Inject CSS
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #marker-panel {
                position: fixed;
                width: 300px;
                background: white;
                border: 1px solid #ddd;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 10000;
                font-family: system-ui, -apple-system, sans-serif;
                user-select: none;
            }

            #marker-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid #eee;
                background: #f8f9fa;
                border-radius: 8px 8px 0 0;
                cursor: move;
                user-select: none;
            }

            #marker-panel-header:active {
                background: #e9ecef;
                cursor: grabbing;
            }

            #marker-panel-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: #333;
            }

            #marker-panel-toggle {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            #marker-panel-toggle:hover {
                color: #000;
            }

            #marker-list {
                max-height: 210px;
                overflow-y: auto;
                padding: 8px;
            }

            .marker-empty {
                padding: 20px;
                text-align: center;
                color: #999;
                font-size: 14px;
                line-height: 1.5;
            }

            .marker-empty small {
                display: block;
                margin-top: 8px;
                color: #aaa;
                font-size: 12px;
            }

            .marker-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                margin-bottom: 6px;
                background: #f8f9fa;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .marker-item:hover {
                background: #e9ecef;
                transform: translateX(-2px);
            }

            .marker-item-content {
                flex: 1;
                min-width: 0;
            }

            .marker-name {
                font-weight: 600;
                font-size: 14px;
                color: #333;
                margin-bottom: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .marker-preview {
                font-size: 12px;
                color: #666;
                margin-bottom: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-style: italic;
            }

            .marker-time {
                font-size: 11px;
                color: #999;
            }

            .marker-delete {
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 4px;
                width: 24px;
                height: 24px;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                margin-left: 8px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .marker-delete:hover {
                background: #c82333;
            }

            .selection-marker-btn {
                position: absolute;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 16px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                z-index: 10001;
                display: none;
                white-space: nowrap;
                transition: all 0.2s;
            }

            .selection-marker-btn:hover {
                background: #45a049;
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }

            .selection-marker-btn:active {
                transform: translateY(0);
            }

            .marker-highlight {
                background-color: #fff3cd;
                border-radius: 3px;
                padding: 2px 0;
                transition: background-color 0.3s;
            }

            .marker-highlight.flash {
                animation: flash 2s;
            }

            @keyframes flash {
                0%, 100% { background-color: #fff3cd; }
                50% { background-color: #ffd700; }
            }
        `;
        document.head.appendChild(style);
    }

    // Track current chat ID and viewport size
    let currentChatId = null;
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;

    // Reposition panel to stay in viewport using actual panel dimensions
    function repositionPanel() {
        const panel = document.getElementById('marker-panel');
        if (!panel) return;

        const left = panel.offsetLeft;
        const top = panel.offsetTop;
        const maxLeft = window.innerWidth - panel.offsetWidth - 10;
        const maxTop = window.innerHeight - panel.offsetHeight - 10;

        if (left > maxLeft || top > maxTop || left < 10 || top < 10) {
            const newLeft = Math.max(10, Math.min(left, maxLeft));
            const newTop = Math.max(10, Math.min(top, maxTop));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            panel.style.right = 'auto';
            savePanelPosition(panel.style.left, panel.style.top);
        }
    }

    // Check if chat ID changed and update markers
    function checkChatChange() {
        const newChatId = getChatId();

        // Check if viewport size changed (catches monitor switches)
        if (window.innerWidth !== lastWidth || window.innerHeight !== lastHeight) {
            lastWidth = window.innerWidth;
            lastHeight = window.innerHeight;
            repositionPanel();
        }

        if (newChatId !== currentChatId) {
            currentChatId = newChatId;
            console.log('[Markers] Chat changed to:', currentChatId);

            // Update marker list for new chat
            updateMarkerList();

            // Restore panel position for this chat
            const panel = document.getElementById('marker-panel');
            if (panel) {
                const savedPosition = getSavedPanelPosition();
                panel.style.left = savedPosition.left;
                panel.style.top = savedPosition.top;
                panel.style.right = savedPosition.right || 'auto';
            }
        }
    }

    // Initialize
    function init() {
        console.log('[Markers] Script initialized');
        currentChatId = getChatId();
        console.log('[Markers] Chat ID:', currentChatId);

        injectStyles();
        createSidePanel();

        // Listen for text selection
        document.addEventListener('mouseup', handleSelection);
        document.addEventListener('touchend', handleSelection);

        // Hide button when clicking elsewhere
        document.addEventListener('mousedown', (e) => {
            if (selectionButton && !selectionButton.contains(e.target)) {
                const selection = window.getSelection();
                if (!selection.toString().trim()) {
                    hideSelectionButton();
                }
            }
        });

        // Listen for URL changes (for SPA navigation)
        setInterval(checkChatChange, 500);

        // Handle window resize - reposition panel if needed
        window.addEventListener('resize', repositionPanel);

        console.log('[Markers] Selection-based markers ready');
    }

    // Start when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
