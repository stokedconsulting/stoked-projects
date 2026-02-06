// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const contentDiv = document.getElementById('content');
    const taskHistoryDiv = document.getElementById('task-history');

    // Track expansion state and filter preferences
    const state = vscode.getState() || {
        expandedProjects: {},
        expandedPhases: {},
        showCompleted: false, // Hide completed by default
        showOrgProjects: false, // Show repo projects by default (false = show repo, true = show org)
        lastData: null, // Store last rendered data for instant restore
        orchestrationData: null, // Store orchestration data
        llmProvider: 'claudeCode', // LLM Provider: 'claudeCode' or 'goose'
        searchQuery: '' // Search filter text
    };

    // Loading timeout to prevent infinite loading states
    let loadingTimeoutId = null;
    const LOADING_TIMEOUT_MS = 60000; // 60 seconds

    // Track currently open context menu
    let currentContextMenu = null;

    // If we have cached data from a previous session, render it immediately
    if (state.lastData) {
        // Hide loading and show cached data immediately
        hideLoading();
        const { repoProjects, orgProjects, statusOptions } = state.lastData;
        renderAllProjects(repoProjects, orgProjects, statusOptions, true, false, 0, false);
    }

    /**
     * Ensure toolbar and orchestration controls exist (create once, never remove)
     */
    function ensureToolbarAndControls() {
        console.log('[Webview] ensureToolbarAndControls called');

        // Check if already exists
        if (contentDiv.querySelector('.sticky-header')) {
            console.log('[Webview] Toolbar and controls already exist');
            return; // Already exists, nothing to do
        }

        console.log('[Webview] Creating toolbar and controls');
        // Clear content and add sticky header container with orchestration + toolbar
        contentDiv.innerHTML = '';

        // Create sticky header container
        const stickyHeader = document.createElement('div');
        stickyHeader.className = 'sticky-header';

        const orchestrationControl = createOrchestrationControl();
        stickyHeader.appendChild(orchestrationControl);
        const toolbar = createToolbar();
        stickyHeader.appendChild(toolbar);
        const searchBar = createSearchBar();
        stickyHeader.appendChild(searchBar);

        contentDiv.appendChild(stickyHeader);
        console.log('[Webview] Toolbar and controls created');
    }

    /**
     * Clear project cards without removing toolbar/controls
     */
    function clearProjectCards() {
        const projectCards = contentDiv.querySelectorAll('.project-card');
        projectCards.forEach(card => card.remove());
    }

    // Request data when webview is loaded/restored (for background refresh)
    vscode.postMessage({ type: 'ready' });

    // Close context menu when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (currentContextMenu && !e.target.closest('.context-menu')) {
            closeContextMenu();
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        console.log('[Webview] Received message:', message.type, message);
        switch (message.type) {
            case 'loading':
                clearNoRepoState();
                showLoading();
                // Set timeout to prevent infinite loading
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                loadingTimeoutId = setTimeout(() => {
                    if (loadingDiv && loadingDiv.style.display !== 'none') {
                        showError('Loading timed out. Click refresh (🔄) to try again.');
                    }
                }, LOADING_TIMEOUT_MS);
                break;
            case 'error':
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                // Ensure toolbar and orchestration controls exist
                ensureToolbarAndControls();
                // Clear only project cards
                clearProjectCards();
                // Update orchestration data if available
                if (state.orchestrationData) {
                    updateOrchestrationUI(state.orchestrationData);
                }
                // Make sure contentDiv is visible
                if (loadingDiv) loadingDiv.style.display = 'none';
                if (contentDiv) contentDiv.style.display = 'block';

                // Special handling for "No git repository found" and "No remote found"
                if (message.message && message.message.includes('No git repository found')) {
                    showNoRepoPanel();
                } else if (message.message && message.message.includes('No remote found')) {
                    showNoRemotePanel();
                } else {
                    showError(message.message);
                }
                break;
            case 'data':
                console.log('[Webview] data case hit!', message);
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                clearNoRepoState();
                console.log('[Webview] About to call renderAllProjects...');
                try {
                    renderAllProjects(message.repoProjects, message.orgProjects, message.statusOptions, false, false, 0, message.isPartial);
                    console.log('[Webview] renderAllProjects returned');
                } catch (error) {
                    console.error('[Webview] ERROR in renderAllProjects:', error);
                }
                break;
            case 'cachedData':
                console.log('[Webview] cachedData case hit!', message);
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                clearNoRepoState();
                console.log('[Webview] About to call renderAllProjects...');
                try {
                    renderAllProjects(message.repoProjects, message.orgProjects, message.statusOptions, true, message.isStale, message.cacheAge);
                    console.log('[Webview] renderAllProjects returned');
                } catch (error) {
                    console.error('[Webview] ERROR in renderAllProjects:', error);
                }
                break;
            case 'incrementalUpdate':
                applyIncrementalUpdate(message.diff, message.statusOptions);
                break;
            case 'dataFresh':
                markDataAsFresh();
                break;
            case 'noProjects':
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                // Ensure toolbar and orchestration controls exist
                ensureToolbarAndControls();
                // Clear only project cards
                clearProjectCards();
                // Update orchestration data if available
                if (state.orchestrationData) {
                    updateOrchestrationUI(state.orchestrationData);
                }
                // Make sure contentDiv is visible
                if (loadingDiv) loadingDiv.style.display = 'none';
                if (contentDiv) contentDiv.style.display = 'block';
                // Then show the error
                showError(message.message);
                break;
            case 'removeItem':
                removeItemFromDOM(message.projectId, message.itemId);
                break;
            case 'removeProject':
                removeProjectFromDOM(message.projectId);
                break;
            case 'refreshing':
                showRefreshIndicator('Refreshing...');
                break;
            case 'projectRefreshing':
                showProjectRefreshing(message.projectId);
                break;
            case 'projectUpdate':
                updateProjectInDOM(message.projectId, message.projectData, message.statusOptions, message.isLinked);
                break;
            case 'projectRefreshError':
                clearProjectRefreshing(message.projectId);
                break;
            case 'projectRemoved':
                handleProjectRemoved(message.projectId);
                break;
            case 'projectLinked':
                handleProjectLinked(message.projectId);
                break;
            case 'projectUnlinked':
                handleProjectUnlinked(message.projectId);
                break;
            case 'repoInfo':
                updateRepoInfo(message.owner, message.repo);
                break;
            case 'orchestrationData':
                updateOrchestrationUI(message.data);
                break;
            case 'showTaskHistory':
                showTaskHistory();
                break;
            case 'itemStatusUpdate':
                handleItemStatusUpdate(message);
                break;
            case 'itemAdded':
                handleItemAdded(message);
                break;
            case 'projectMetadataUpdate':
                handleProjectMetadataUpdate(message);
                break;
            case 'worktreeStatusUpdate':
                handleWorktreeStatusUpdate(message);
                break;
            case 'projectCreated':
                handleProjectCreated(message);
                break;
        }
    });

    /**
     * Create orchestration control UI
     */
    function createOrchestrationControl() {
        const container = document.createElement('div');
        container.className = 'orchestration-control';
        container.id = 'orchestration-control';

        // Workspace Section
        const workspaceSection = document.createElement('div');
        workspaceSection.className = 'orchestration-section workspace-section';

        const workspaceHeader = document.createElement('div');
        workspaceHeader.className = 'orchestration-section-header';
        workspaceHeader.textContent = 'Workspace';

        const workspaceStats = document.createElement('div');
        workspaceStats.className = 'orchestration-stats';

        // Workspace Running
        const wsRunningLabel = document.createElement('span');
        wsRunningLabel.className = 'orchestration-label';
        wsRunningLabel.textContent = 'Running:';

        const wsRunningValue = document.createElement('span');
        wsRunningValue.className = 'orchestration-value running';
        wsRunningValue.id = 'orchestration-ws-running';
        wsRunningValue.textContent = '0';

        // Workspace Desired
        const wsDesiredLabel = document.createElement('span');
        wsDesiredLabel.className = 'orchestration-label';
        wsDesiredLabel.textContent = 'Desired:';

        const wsDesiredInput = document.createElement('input');
        wsDesiredInput.type = 'number';
        wsDesiredInput.id = 'orchestration-ws-desired';
        wsDesiredInput.className = 'orchestration-input';
        wsDesiredInput.min = '0';
        wsDesiredInput.max = '20';
        wsDesiredInput.value = '0';

        wsDesiredInput.addEventListener('blur', () => {
            const value = parseInt(wsDesiredInput.value) || 0;
            vscode.postMessage({
                type: 'updateOrchestrationDesired',
                scope: 'workspace',
                desired: value
            });
        });

        wsDesiredInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                wsDesiredInput.blur();
            }
        });

        workspaceStats.appendChild(wsRunningLabel);
        workspaceStats.appendChild(wsRunningValue);
        workspaceStats.appendChild(wsDesiredLabel);
        workspaceStats.appendChild(wsDesiredInput);

        workspaceSection.appendChild(workspaceHeader);
        workspaceSection.appendChild(workspaceStats);

        // Global Section
        const globalSection = document.createElement('div');
        globalSection.className = 'orchestration-section global-section';

        const globalHeader = document.createElement('div');
        globalHeader.className = 'orchestration-section-header';
        globalHeader.textContent = 'Global';

        const globalStats = document.createElement('div');
        globalStats.className = 'orchestration-stats';

        // Global Running
        const globalRunningLabel = document.createElement('span');
        globalRunningLabel.className = 'orchestration-label';
        globalRunningLabel.textContent = 'Running:';

        const globalRunningValue = document.createElement('span');
        globalRunningValue.className = 'orchestration-value running';
        globalRunningValue.id = 'orchestration-global-running';
        globalRunningValue.textContent = '0';

        // Global Desired
        const globalDesiredLabel = document.createElement('span');
        globalDesiredLabel.className = 'orchestration-label';
        globalDesiredLabel.textContent = 'Desired:';

        const globalDesiredValue = document.createElement('span');
        globalDesiredValue.className = 'orchestration-value';
        globalDesiredValue.id = 'orchestration-global-desired';
        globalDesiredValue.textContent = '0';

        globalStats.appendChild(globalRunningLabel);
        globalStats.appendChild(globalRunningValue);
        globalStats.appendChild(globalDesiredLabel);
        globalStats.appendChild(globalDesiredValue);

        globalSection.appendChild(globalHeader);
        globalSection.appendChild(globalStats);

        container.appendChild(workspaceSection);
        container.appendChild(globalSection);

        return container;
    }

    /**
     * Update orchestration UI with new data
     */
    function updateOrchestrationUI(data) {
        // Store in state
        state.orchestrationData = data;
        vscode.setState(state);

        // Update Workspace UI elements
        const wsRunningEl = document.getElementById('orchestration-ws-running');
        const wsDesiredEl = document.getElementById('orchestration-ws-desired');

        if (wsRunningEl && data.workspace) {
            wsRunningEl.textContent = data.workspace.running.toString();
        }

        if (wsDesiredEl && data.workspace) {
            wsDesiredEl.value = data.workspace.desired.toString();
        }

        // Update Global UI elements
        const globalRunningEl = document.getElementById('orchestration-global-running');
        const globalDesiredEl = document.getElementById('orchestration-global-desired');

        if (globalRunningEl && data.global) {
            globalRunningEl.textContent = data.global.running.toString();
        }

        if (globalDesiredEl && data.global) {
            globalDesiredEl.textContent = data.global.desired.toString();
        }
    }

    /**
     * Create toolbar with filter controls
     */
    function createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';

        // Add Project button (far left)
        const addProjectButton = document.createElement('button');
        addProjectButton.className = 'toolbar-button add-project-toolbar-button';
        addProjectButton.title = 'Add new project';
        addProjectButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
        addProjectButton.onclick = () => {
            vscode.postMessage({ type: 'addProject' });
        };

        // Spacer to push other buttons to the right
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';

        // Refresh button
        const refreshButton = document.createElement('button');
        refreshButton.className = 'toolbar-button';
        refreshButton.title = 'Refresh projects';
        refreshButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
        refreshButton.onclick = () => {
            vscode.postMessage({ type: 'refresh' });
        };
        // Toggle org/repo projects button (Material Design domain/business icon)
        const orgToggleButton = document.createElement('button');
        orgToggleButton.className = state.showOrgProjects ? 'toolbar-button active' : 'toolbar-button';
        orgToggleButton.title = state.showOrgProjects ? 'Show all projects' : 'Show only repo-linked projects';
        // Material Design "domain" icon when showing all projects, "folder" icon when repo-only
        orgToggleButton.innerHTML = state.showOrgProjects
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';

        orgToggleButton.onclick = () => {
            state.showOrgProjects = !state.showOrgProjects;
            vscode.setState(state);
            orgToggleButton.title = state.showOrgProjects ? 'Show all projects' : 'Show only repo-linked projects';
            orgToggleButton.innerHTML = state.showOrgProjects
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
            orgToggleButton.className = state.showOrgProjects ? 'toolbar-button active' : 'toolbar-button';
            // Notify extension of mode change to update view title
            vscode.postMessage({ type: 'modeChanged', showOrgProjects: state.showOrgProjects });
            // Toggle visibility instead of re-fetching
            toggleOrgProjectsVisibility();
        };


        // Toggle completed items button
        const toggleButton = document.createElement('button');
        toggleButton.className = state.showCompleted ? 'toolbar-button active' : 'toolbar-button';
        toggleButton.title = state.showCompleted ? 'Hide completed items' : 'Show completed items';
        toggleButton.innerHTML = state.showCompleted ? '👁️' : '👁️‍🗨️';

        toggleButton.onclick = () => {
            state.showCompleted = !state.showCompleted;
            vscode.setState(state);
            toggleButton.title = state.showCompleted ? 'Hide completed items' : 'Show completed items';
            toggleButton.innerHTML = state.showCompleted ? '👁️' : '👁️‍🗨️';
            toggleButton.className = state.showCompleted ? 'toolbar-button active' : 'toolbar-button';
            // Toggle visibility instead of re-fetching
            toggleCompletedItemsVisibility();
        };

        // Clear cache button (Material Design delete icon)
        const clearCacheButton = document.createElement('button');
        clearCacheButton.className = 'toolbar-button';
        clearCacheButton.title = 'Clear cache and refresh';
        clearCacheButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14zM6 7v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zm2 12V9h8v10zm6-5H8v2h6v-2zm2-4H8v2h8v-2z"/></svg>';
        clearCacheButton.onclick = () => {
            vscode.postMessage({ type: 'clearCache' });
        };

        // View on GitHub button
        const githubButton = document.createElement('button');
        githubButton.className = 'toolbar-button github-repo-button';
        githubButton.title = 'View repository on GitHub';
        githubButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>';
        githubButton.onclick = () => {
            if (currentRepoOwner && currentRepoName) {
                vscode.postMessage({
                    type: 'openUrl',
                    url: `https://github.com/${currentRepoOwner}/${currentRepoName}`
                });
            }
        };
        githubButton.style.display = 'none'; // Hidden until repo info is available

        // Task History button (Material Design history icon)
        const taskHistoryButton = document.createElement('button');
        taskHistoryButton.className = 'toolbar-button task-history-button';
        taskHistoryButton.title = 'View task history';
        taskHistoryButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>';
        taskHistoryButton.onclick = () => {
            vscode.postMessage({ type: 'openTaskHistory' });
        };

        // Settings button (Material Design settings/gear icon)
        const settingsButton = document.createElement('button');
        settingsButton.className = 'toolbar-button settings-button';
        settingsButton.title = 'Settings';
        settingsButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
        settingsButton.onclick = (e) => {
            e.stopPropagation();
            showSettingsMenu(e);
        };

        // Assemble toolbar: + button, spacer, then right-aligned buttons
        toolbar.appendChild(addProjectButton);
        toolbar.appendChild(spacer);
        toolbar.appendChild(refreshButton);
        toolbar.appendChild(clearCacheButton);
        toolbar.appendChild(orgToggleButton);
        toolbar.appendChild(toggleButton);
        toolbar.appendChild(githubButton);
        toolbar.appendChild(taskHistoryButton);
        toolbar.appendChild(settingsButton);
        return toolbar;
    }

    /**
     * Create search bar for filtering projects by text
     */
    function createSearchBar() {
        const container = document.createElement('div');
        container.className = 'search-bar';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'search-icon';
        searchIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'search-input';
        input.placeholder = 'Search projects...';
        input.value = state.searchQuery || '';

        let debounceTimer = null;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                state.searchQuery = input.value;
                vscode.setState(state);
                applySearchFilter();
            }, 150);
        });

        // Clear on Escape
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                state.searchQuery = '';
                vscode.setState(state);
                applySearchFilter();
                input.blur();
            }
        });

        const clearButton = document.createElement('button');
        clearButton.className = 'search-clear';
        clearButton.title = 'Clear search';
        clearButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        clearButton.style.display = state.searchQuery ? 'flex' : 'none';
        clearButton.onclick = () => {
            input.value = '';
            state.searchQuery = '';
            vscode.setState(state);
            clearButton.style.display = 'none';
            applySearchFilter();
        };

        container.appendChild(searchIcon);
        container.appendChild(input);
        container.appendChild(clearButton);
        return container;
    }

    /**
     * Apply search filter across all project cards, respecting other active filters.
     * Searches project title, item titles, and phase names.
     */
    function applySearchFilter() {
        const query = (state.searchQuery || '').toLowerCase().trim();
        const clearBtn = document.querySelector('.search-clear');
        if (clearBtn) {
            clearBtn.style.display = query ? 'flex' : 'none';
        }

        const allProjects = document.querySelectorAll('.project-card');

        allProjects.forEach(projectCard => {
            // First check other filters (org/repo, completed)
            const isRepoLinked = projectCard.getAttribute('data-is-repo-linked') === 'true';
            const isDone = projectCard.getAttribute('data-is-done') === 'true';
            const isClosed = projectCard.getAttribute('data-is-closed') === 'true';
            const notDoneCount = parseInt(projectCard.getAttribute('data-not-done-count') || '0', 10);
            const hasNoActiveItems = notDoneCount === 0;

            const hiddenByOrgFilter = state.showOrgProjects ? isRepoLinked : !isRepoLinked;
            const hiddenByCompletion = !state.showCompleted && (isDone || isClosed || hasNoActiveItems);

            if (hiddenByOrgFilter || hiddenByCompletion) {
                projectCard.style.display = 'none';
                return;
            }

            // If no search query, show the project
            if (!query) {
                projectCard.style.display = 'block';
                return;
            }

            // Search through all text content in the project card
            const textContent = projectCard.textContent.toLowerCase();
            if (textContent.includes(query)) {
                projectCard.style.display = 'block';
            } else {
                projectCard.style.display = 'none';
            }
        });

        updateNoProjectsMessage();
    }

    /**
     * Close any open context menu
     */
    function closeContextMenu() {
        if (currentContextMenu) {
            currentContextMenu.remove();
            currentContextMenu = null;
        }
    }

    /**
     * Close settings menu if it exists
     */
    function closeSettingsMenu() {
        const existingMenu = document.querySelector('.settings-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
    }

    /**
     * Show settings dropdown menu
     * @param {MouseEvent} event
     */
    function showSettingsMenu(event) {
        event.stopPropagation();

        // Close any existing settings menu
        closeSettingsMenu();

        // Create settings menu container
        const menu = document.createElement('div');
        menu.className = 'settings-menu';

        // Position menu below the settings button
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.right = '10px';

        // Menu header
        const header = document.createElement('div');
        header.className = 'settings-menu-header';
        header.textContent = 'Settings';
        menu.appendChild(header);

        // LLM Provider section
        const providerSection = document.createElement('div');
        providerSection.className = 'settings-section';

        const providerLabel = document.createElement('div');
        providerLabel.className = 'settings-label';
        providerLabel.textContent = 'LLM Provider:';
        providerSection.appendChild(providerLabel);

        // Radio options container
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'settings-options';

        // Claude Code option
        const claudeOption = document.createElement('label');
        claudeOption.className = 'settings-radio-option';
        const claudeRadio = document.createElement('input');
        claudeRadio.type = 'radio';
        claudeRadio.name = 'llmProvider';
        claudeRadio.value = 'claudeCode';
        claudeRadio.checked = state.llmProvider === 'claudeCode';
        claudeRadio.onchange = () => {
            state.llmProvider = 'claudeCode';
            vscode.setState(state);
            vscode.postMessage({ type: 'updateSettings', settings: { llmProvider: 'claudeCode' } });
            updateProviderStyles(claudeOption, gooseOption, 'claudeCode');
        };
        const claudeText = document.createElement('span');
        claudeText.textContent = 'Claude Code';
        claudeOption.appendChild(claudeRadio);
        claudeOption.appendChild(claudeText);
        optionsContainer.appendChild(claudeOption);

        // Goose option
        const gooseOption = document.createElement('label');
        gooseOption.className = 'settings-radio-option';
        const gooseRadio = document.createElement('input');
        gooseRadio.type = 'radio';
        gooseRadio.name = 'llmProvider';
        gooseRadio.value = 'goose';
        gooseRadio.checked = state.llmProvider === 'goose';
        gooseRadio.onchange = () => {
            state.llmProvider = 'goose';
            vscode.setState(state);
            vscode.postMessage({ type: 'updateSettings', settings: { llmProvider: 'goose' } });
            updateProviderStyles(claudeOption, gooseOption, 'goose');
        };
        const gooseText = document.createElement('span');
        gooseText.textContent = 'Goose';
        gooseOption.appendChild(gooseRadio);
        gooseOption.appendChild(gooseText);
        optionsContainer.appendChild(gooseOption);

        // Apply initial selected styles
        updateProviderStyles(claudeOption, gooseOption, state.llmProvider);

        providerSection.appendChild(optionsContainer);
        menu.appendChild(providerSection);

        // Add to document
        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeHandler = (e) => {
            if (!e.target.closest('.settings-menu') && !e.target.closest('.settings-button')) {
                closeSettingsMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        // Delay adding listener to prevent immediate close
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    /**
     * Update visual styles for provider options
     */
    function updateProviderStyles(claudeOption, gooseOption, selected) {
        claudeOption.classList.toggle('selected', selected === 'claudeCode');
        gooseOption.classList.toggle('selected', selected === 'goose');
    }

    /**
     * Create and show context popup for project actions
     * @param {MouseEvent} event
     * @param {any} project
     * @param {any} statusOptions
     */
    function showProjectContextMenu(event, project, statusOptions) {
        event.stopPropagation();

        // Close any existing menu
        closeContextMenu();

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        // Position the menu near the click
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left}px`;

        // Refresh button
        const refreshItem = createContextMenuItem(
            'Refresh Project',
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
            () => {
                vscode.postMessage({
                    type: 'refreshProject',
                    projectId: project.id,
                    projectNumber: project.number
                });
                closeContextMenu();
            }
        );

        // Start Work button
        const startItem = createContextMenuItem(
            'Start',
            '▶',
            () => {
                vscode.postMessage({
                    type: 'startProject',
                    projectNumber: project.number
                });
                closeContextMenu();
            }
        );

        // Start with Context button
        const startContextItem = createContextMenuItem(
            'Start with Context',
            '+',
            () => {
                vscode.postMessage({
                    type: 'startProjectWithContext',
                    projectNumber: project.number
                });
                closeContextMenu();
            }
        );

        // Link to Current Project (only show when not already linked)
        let linkItem = null;
        if (!project.isRepoLinked) {
            linkItem = createContextMenuItem(
                'Link to Current Project',
                '🔗',
                () => {
                    vscode.postMessage({
                        type: 'linkProjectToRepo',
                        projectId: project.id,
                        projectNumber: project.number
                    });
                    closeContextMenu();
                }
            );
        }

        // Unlink from Repository (only show when already linked)
        let unlinkItem = null;
        if (project.isRepoLinked) {
            unlinkItem = createContextMenuItem(
                'Unlink from Repository',
                '🔓',
                () => {
                    vscode.postMessage({
                        type: 'unlinkProjectFromRepo',
                        projectId: project.id,
                        projectNumber: project.number
                    });
                    closeContextMenu();
                }
            );
        }

        // Review Project button
        const reviewItem = createContextMenuItem(
            'Review Project',
            '📋',
            () => {
                vscode.postMessage({
                    type: 'reviewProject',
                    projectNumber: project.number
                });
                closeContextMenu();
            }
        );

        // Mark All Done button
        const markDoneItem = createContextMenuItem(
            'Mark All Items Done',
            '✓',
            () => {
                vscode.postMessage({
                    type: 'markAllDone',
                    projectId: project.id,
                    projectTitle: project.title
                });
                closeContextMenu();
            }
        );

        // Delete Project button
        const deleteItem = createContextMenuItem(
            'Delete Project',
            '🗑️',
            () => {
                vscode.postMessage({
                    type: 'deleteProject',
                    projectId: project.id,
                    projectTitle: project.title
                });
                closeContextMenu();
            },
            'delete'
        );

        // Worktree action (contextual — only one shown based on state)
        // Read from data attribute first (may have been updated via worktreeStatusUpdate),
        // fall back to original project object
        let worktreeItem = null;
        const projectCard = document.querySelector(`.project-card[data-project-id="${project.id}"]`);
        const wtAttr = projectCard && projectCard.getAttribute('data-worktree');
        const wt = wtAttr ? JSON.parse(wtAttr) : project.worktree;
        if (wt && wt.hasWorktree) {
            if (wt.hasUncommittedChanges) {
                worktreeItem = createContextMenuItem(
                    'Commit & Push',
                    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/></svg>',
                    () => {
                        vscode.postMessage({
                            type: 'worktreeCommitPush',
                            projectNumber: project.number,
                            projectTitle: project.title,
                            worktreePath: wt.worktreePath
                        });
                        closeContextMenu();
                    }
                );
            } else if (!wt.hasPR && !wt.prMerged) {
                worktreeItem = createContextMenuItem(
                    'Create PR',
                    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12-10a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM6 9v6M18 9v3c0 2-2 3-4 3H8"/></svg>',
                    () => {
                        vscode.postMessage({
                            type: 'worktreeCreatePR',
                            projectNumber: project.number,
                            projectTitle: project.title,
                            branch: wt.branch,
                            worktreePath: wt.worktreePath
                        });
                        closeContextMenu();
                    }
                );
            } else if (wt.hasPR && !wt.prMerged) {
                worktreeItem = createContextMenuItem(
                    `Merge PR #${wt.prNumber}`,
                    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 20.41L18.41 19 15 15.59 13.59 17 17 20.41zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8z"/></svg>',
                    () => {
                        vscode.postMessage({
                            type: 'worktreeMerge',
                            prNumber: wt.prNumber,
                            worktreePath: wt.worktreePath
                        });
                        closeContextMenu();
                    }
                );
            } else if (wt.prMerged) {
                worktreeItem = createContextMenuItem(
                    'Clean Worktree',
                    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z"/></svg>',
                    () => {
                        vscode.postMessage({
                            type: 'worktreeClean',
                            worktreePath: wt.worktreePath,
                            projectNumber: project.number
                        });
                        closeContextMenu();
                    }
                );
            }
        }

        // Add items to menu
        menu.appendChild(refreshItem);
        menu.appendChild(startItem);
        menu.appendChild(startContextItem);
        if (linkItem) {
            menu.appendChild(linkItem);
        }
        if (unlinkItem) {
            menu.appendChild(unlinkItem);
        }
        menu.appendChild(reviewItem);
        if (worktreeItem) {
            menu.appendChild(worktreeItem);
        }
        menu.appendChild(markDoneItem);
        menu.appendChild(deleteItem);

        // Add to document
        document.body.appendChild(menu);
        currentContextMenu = menu;

        // Position adjustment if menu goes off screen
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
        }
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = `${rect.top - menuRect.height - 5}px`;
        }
    }

    /**
     * Create a context menu item
     * @param {string} label
     * @param {string} icon
     * @param {Function} onClick
     * @param {string} className
     */
    function createContextMenuItem(label, icon, onClick, className = '') {
        const item = document.createElement('div');
        item.className = `context-menu-item${className ? ' ' + className : ''}`;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'context-menu-icon';
        iconSpan.innerHTML = icon;

        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;

        item.appendChild(iconSpan);
        item.appendChild(labelSpan);

        item.onclick = onClick;

        return item;
    }

    /**
     * Create and show context popup for phase actions
     * @param {MouseEvent} event
     * @param {any} phase
     * @param {string} projectId
     * @param {number} projectNumber
     */
    function showPhaseContextMenu(event, phase, projectId, projectNumber) {
        event.stopPropagation();

        // Close any existing menu
        closeContextMenu();

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        // Position the menu near the click
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left}px`;

        // Review Phase button
        const reviewItem = createContextMenuItem(
            'Review Phase',
            '📋',
            () => {
                vscode.postMessage({
                    type: 'reviewPhase',
                    projectNumber: projectNumber,
                    phaseNumber: phase.phaseNumber
                });
                closeContextMenu();
            }
        );

        // Mark Phase Done button
        const markDoneItem = createContextMenuItem(
            'Mark Phase Done',
            '✓',
            () => {
                // Collect all item IDs in this phase
                const itemIds = phase.workItems.map(item => item.id);
                if (phase.masterItem) {
                    itemIds.push(phase.masterItem.id);
                }
                vscode.postMessage({
                    type: 'markPhaseDone',
                    projectId: projectId,
                    itemIds: itemIds,
                    phaseName: phase.phaseName
                });
                closeContextMenu();
            }
        );

        // Delete Phase Master button (only if master item exists)
        let deleteItem = null;
        if (phase.masterItem) {
            deleteItem = createContextMenuItem(
                'Delete Phase Master',
                '🗑️',
                () => {
                    vscode.postMessage({
                        type: 'deleteItem',
                        projectId: projectId,
                        itemId: phase.masterItem.id,
                        itemTitle: phase.phaseName + ' (Master)'
                    });
                    closeContextMenu();
                },
                'delete'
            );
        }

        // Add items to menu
        menu.appendChild(reviewItem);
        menu.appendChild(markDoneItem);
        if (deleteItem) {
            menu.appendChild(deleteItem);
        }

        // Add to document
        document.body.appendChild(menu);
        currentContextMenu = menu;

        // Position adjustment if menu goes off screen
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
        }
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = `${rect.top - menuRect.height - 5}px`;
        }
    }

    /**
     * Create and show context popup for item actions
     * @param {MouseEvent} event
     * @param {any} item
     * @param {string} projectId
     * @param {number} projectNumber
     */
    function showItemContextMenu(event, item, projectId, projectNumber) {
        event.stopPropagation();

        // Close any existing menu
        closeContextMenu();

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        // Position the menu near the click
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left}px`;

        // Extract phase item number from title (e.g., "2.2" from "(2.2) Task name")
        let phaseItemNumber = '';
        const match = item.content.title.match(/\((\d+\.\d+)\)/);
        if (match) {
            phaseItemNumber = match[1];
        }

        // Review Item button
        const reviewItem = createContextMenuItem(
            'Review Item',
            '📋',
            () => {
                vscode.postMessage({
                    type: 'reviewItem',
                    projectNumber: projectNumber,
                    phaseItemNumber: phaseItemNumber || item.content.number.toString()
                });
                closeContextMenu();
            }
        );

        // Delete Item button
        const deleteItem = createContextMenuItem(
            'Delete Item',
            '🗑️',
            () => {
                vscode.postMessage({
                    type: 'deleteItem',
                    projectId: projectId,
                    itemId: item.id,
                    itemTitle: item.content.title
                });
                closeContextMenu();
            },
            'delete'
        );

        // Add items to menu
        menu.appendChild(reviewItem);
        menu.appendChild(deleteItem);

        // Add to document
        document.body.appendChild(menu);
        currentContextMenu = menu;

        // Position adjustment if menu goes off screen
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
        }
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = `${rect.top - menuRect.height - 5}px`;
        }
    }

    /**
     * Toggle visibility of completed items without re-fetching data
     * Also respects the org/repo view filter
     */
    function toggleCompletedItemsVisibility() {
        const query = (state.searchQuery || '').toLowerCase().trim();
        const allProjects = document.querySelectorAll('.project-card');

        allProjects.forEach(projectCard => {
            const isDone = projectCard.getAttribute('data-is-done') === 'true';
            const isClosed = projectCard.getAttribute('data-is-closed') === 'true';
            const notDoneCount = parseInt(projectCard.getAttribute('data-not-done-count') || '0', 10);
            const hasNoActiveItems = notDoneCount === 0;
            const isRepoLinked = projectCard.getAttribute('data-is-repo-linked') === 'true';

            // Check if should be hidden due to completion status
            const hiddenByCompletion = !state.showCompleted && (isDone || isClosed || hasNoActiveItems);

            // Check if should be hidden due to org/repo filter
            const hiddenByOrgFilter = state.showOrgProjects ? isRepoLinked : !isRepoLinked;

            // Check if should be hidden due to search filter
            const hiddenBySearch = query && !projectCard.textContent.toLowerCase().includes(query);

            // Hide if any filter applies
            if (hiddenByCompletion || hiddenByOrgFilter || hiddenBySearch) {
                projectCard.style.display = 'none';
            } else {
                projectCard.style.display = 'block';
            }
        });

        // Toggle phase visibility
        const allPhases = document.querySelectorAll('.phase-group');
        allPhases.forEach(phaseGroup => {
            const isDone = phaseGroup.getAttribute('data-is-done') === 'true';

            if (!state.showCompleted && isDone) {
                phaseGroup.style.display = 'none';
            } else {
                phaseGroup.style.display = 'block';
            }
        });

        // Toggle item visibility
        const allItems = document.querySelectorAll('.project-item');
        allItems.forEach(item => {
            const isDone = item.getAttribute('data-is-done') === 'true';

            if (!state.showCompleted && isDone) {
                item.style.display = 'none';
            } else {
                item.style.display = 'flex';
            }
        });

        // Update "no projects" message
        updateNoProjectsMessage();
    }

    /**
     * Toggle visibility of org-only projects (those not linked to current repo)
     * Also respects the completed items filter
     */
    function toggleOrgProjectsVisibility() {
        const query = (state.searchQuery || '').toLowerCase().trim();
        const allProjects = document.querySelectorAll('.project-card');
        console.log('[Webview] toggleOrgProjectsVisibility - found', allProjects.length, 'project cards');
        console.log('[Webview] Filter state:', { showOrgProjects: state.showOrgProjects, showCompleted: state.showCompleted, searchQuery: state.searchQuery });

        let visibleCount = 0;
        allProjects.forEach(projectCard => {
            const isRepoLinked = projectCard.getAttribute('data-is-repo-linked') === 'true';
            const isDone = projectCard.getAttribute('data-is-done') === 'true';
            const isClosed = projectCard.getAttribute('data-is-closed') === 'true';
            const notDoneCount = parseInt(projectCard.getAttribute('data-not-done-count') || '0', 10);
            const hasNoActiveItems = notDoneCount === 0;
            const projectTitle = projectCard.querySelector('h3')?.textContent || 'unknown';

            // Check if should be hidden due to org/repo filter
            const hiddenByOrgFilter = state.showOrgProjects ? isRepoLinked : !isRepoLinked;

            // Check if should be hidden due to completion status
            const hiddenByCompletion = !state.showCompleted && (isDone || isClosed || hasNoActiveItems);

            // Check if should be hidden due to search filter
            const hiddenBySearch = query && !projectCard.textContent.toLowerCase().includes(query);

            // Hide if any filter applies
            if (hiddenByOrgFilter || hiddenByCompletion || hiddenBySearch) {
                projectCard.style.display = 'none';
                console.log('[Webview] HIDING', projectTitle, { isRepoLinked, hiddenByOrgFilter, isDone, isClosed, hasNoActiveItems, hiddenByCompletion, hiddenBySearch });
            } else {
                projectCard.style.display = 'block';
                visibleCount++;
                console.log('[Webview] SHOWING', projectTitle);
            }
        });

        console.log('[Webview] toggleOrgProjectsVisibility complete -', visibleCount, 'visible projects');

        // Update "no projects" message
        updateNoProjectsMessage();
    }

    /**
     * Show/hide "no projects" message based on current visibility
     */
    function updateNoProjectsMessage() {
        // Remove existing message
        const existingMessage = contentDiv.querySelector('.no-projects-message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Check if any projects are visible
        const visibleProjects = Array.from(contentDiv.querySelectorAll('.project-card'))
            .filter(card => card.style.display !== 'none');

        if (visibleProjects.length === 0) {
            // Show helpful message when no projects match filters
            const messageDiv = document.createElement('div');
            messageDiv.className = 'no-projects-message';
            messageDiv.style.padding = '20px';
            messageDiv.style.textAlign = 'center';
            messageDiv.style.color = 'var(--vscode-descriptionForeground)';

            if (!state.showOrgProjects && !state.showCompleted) {
                // Showing repo projects, hiding completed
                messageDiv.innerHTML = `
                    <p>No incomplete tasks in repository projects.</p>
                    <p style="margin-top: 10px; font-size: 0.9em;">
                        • Click <strong>Show Completed</strong> to see finished tasks<br>
                        • Click <strong>Show Org Projects</strong> to view all organization projects
                    </p>
                `;
            } else {
                messageDiv.textContent = 'No projects match the current filters.';
            }

            contentDiv.appendChild(messageDiv);
        }
    }


    /** 
     * @param {any[]} repoProjects 
     * @param {any[]} orgProjects 
     * @param {any} statusOptions
     * @param {boolean} isCached
     * @param {boolean} isStale
     * @param {number} cacheAge
     * @param {boolean} isPartial - true when this is initial metadata, more data is coming
     */
    function renderAllProjects(repoProjects, orgProjects, statusOptions, isCached = false, isStale = false, cacheAge = 0, isPartial = false) {
        console.log('[Webview] renderAllProjects called', {
            repoProjects: repoProjects?.length,
            orgProjects: orgProjects?.length,
            statusOptions: statusOptions?.length,
            contentDiv: !!contentDiv
        });

        if (!contentDiv) {
            console.error('[Webview] contentDiv not found!');
            return;
        }

        hideLoading();

        // Save data to state for instant restoration on tab switch
        if (!isPartial) {
            state.lastData = { repoProjects, orgProjects, statusOptions };
            vscode.setState(state);
        }

        // Show/hide refresh indicator based on partial data
        if (isPartial) {
            showRefreshIndicator('Refreshing projects...');
        } else {
            removeRefreshIndicator();
        }

        // Ensure toolbar and orchestration controls exist
        ensureToolbarAndControls();

        // Clear only project cards, keep toolbar and orchestration
        clearProjectCards();

        // Restore orchestration data if available
        if (state.orchestrationData) {
            updateOrchestrationUI(state.orchestrationData);
        }

        // Add cache/refresh indicator if showing cached data - status bar at bottom
        if (isCached) {
            showRefreshIndicator(isStale ? '⚠️ Cached (updating...)' : `✓ Cached (${cacheAge}s ago, updating...)`);
        }

        // Combine all projects, marking which are repo-linked
        // Create a Set of repo-linked project IDs for quick lookup
        const repoProjectIds = new Set(repoProjects.map(p => p.id));

        const allProjects = [...repoProjects, ...orgProjects];

        // Deduplicate by project id (in case same project appears in both lists)
        const projectMap = new Map();
        allProjects.forEach(p => {
            if (!projectMap.has(p.id)) {
                projectMap.set(p.id, p);
            }
        });
        const uniqueProjects = Array.from(projectMap.values());

        // Mark each project as repo-linked or not
        uniqueProjects.forEach(p => {
            p.isRepoLinked = repoProjectIds.has(p.id);
        });

        // Sort by project number descending (newest/highest first)
        uniqueProjects.sort((a, b) => b.number - a.number);

        console.log('[Webview] After dedup and sort:', uniqueProjects.length, 'projects');

        if (uniqueProjects.length === 0) {
            console.log('[Webview] No projects to show');
            contentDiv.textContent = 'No projects found.';
            return;
        }

        // Determine if we should auto-expand (only if single project total)
        const autoExpand = uniqueProjects.length === 1;

        console.log('[Webview] Creating project elements for', uniqueProjects.length, 'projects');
        uniqueProjects.forEach(p => {
            const el = createProjectElement(p, autoExpand, statusOptions);
            console.log('[Webview] Appending project', p.number, p.title);
            contentDiv.appendChild(el);
        });

        console.log('[Webview] Applying visibility filters');
        // Apply initial visibility based on filter state (these will call updateNoProjectsMessage internally)
        toggleCompletedItemsVisibility();
        toggleOrgProjectsVisibility();
        console.log('[Webview] Rendering complete');
    }

    /** 
     * @param {any} project 
     * @param {boolean} autoExpand
     * @param {any} statusOptions
     */
    function createProjectElement(project, autoExpand, statusOptions) {
        const projectEl = document.createElement('div');
        projectEl.className = 'project-card';
        projectEl.setAttribute('data-project-id', project.id);

        // Add data attributes for filtering
        const isDone = project.title.includes('[Done]');
        const isClosed = project.closed === true;
        projectEl.setAttribute('data-is-done', isDone.toString());
        projectEl.setAttribute('data-is-closed', isClosed.toString());
        projectEl.setAttribute('data-not-done-count', (project.notDoneCount || 0).toString());
        projectEl.setAttribute('data-is-repo-linked', (project.isRepoLinked || false).toString());

        // Add class for styling when all items are done
        if (project.notDoneCount === 0 && project.items && project.items.length > 0) {
            projectEl.classList.add('project-all-done');
        }

        const projectKey = `project-${project.id}`;
        const isExpanded = autoExpand || state.expandedProjects[projectKey];
        if (!isExpanded) {
            projectEl.classList.add('collapsed');
        }

        // Header with expand/collapse icon
        const header = document.createElement('div');
        header.className = 'project-header';
        header.style.cursor = 'pointer';

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = isExpanded ? '−' : '+';

        const title = document.createElement('h3');
        title.textContent = `#${project.number} ${project.title}`;
        title.style.cursor = 'pointer';
        title.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'openUrl', url: project.url });
        };

        const stats = document.createElement('span');
        stats.className = 'project-stats';
        stats.textContent = `${project.notDoneCount || 0} ready`;

        // Context menu button (three dots)
        const contextMenuButton = document.createElement('button');
        contextMenuButton.className = 'action-button context-menu-button';
        contextMenuButton.textContent = '⋮';
        contextMenuButton.title = 'Project actions';
        contextMenuButton.onclick = (e) => {
            showProjectContextMenu(e, project, statusOptions);
        };

        header.appendChild(expandIcon);
        header.appendChild(title);
        header.appendChild(stats);
        header.appendChild(contextMenuButton);

        // Toggle expansion on header click
        header.onclick = (e) => {
            if (e.target === title || e.target === contextMenuButton) return;
            toggleProjectExpansion(projectKey, projectEl, expandIcon);
        };

        projectEl.appendChild(header);

        // Store title, itemCount, and worktree data for context menu and updates
        projectEl.setAttribute('data-project-title', project.title || '');
        projectEl.setAttribute('data-item-count', (project.itemCount || 0).toString());
        if (project.worktree) {
            projectEl.setAttribute('data-worktree', JSON.stringify(project.worktree));
        }

        // Content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'project-content';
        contentContainer.style.display = isExpanded ? 'block' : 'none';

        // Render Phases
        if (project.phases && project.phases.length > 0) {
            const phasesContainer = document.createElement('div');
            phasesContainer.className = 'phases-container';

            project.phases.forEach((phase) => {
                const phaseEl = createPhaseElement(phase, project.id, project.number, statusOptions);
                if (phaseEl) {
                    phasesContainer.appendChild(phaseEl);
                }
            });

            if (phasesContainer.children.length > 0) {
                contentContainer.appendChild(phasesContainer);
            } else {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'empty-msg';
                emptyMsg.textContent = 'No active items in phases.';
                contentContainer.appendChild(emptyMsg);
            }
        } else {
            // Flat list if no phases
            const list = document.createElement('ul');
            project.items.forEach((item) => {
                const li = createItemElement(item, project.id, project.number, statusOptions);
                list.appendChild(li);
            });
            contentContainer.appendChild(list);
        }

        projectEl.appendChild(contentContainer);
        return projectEl;
    }

    /**
     * @param {any} phase
     * @param {string} projectId
     * @param {number} projectNumber
     * @param {any} statusOptions
     */
    function createPhaseElement(phase, projectId, projectNumber, statusOptions) {
        // Calculate aggregate status based on work items
        const workItems = phase.workItems || [];
        const allStatuses = workItems.map(item => item.fieldValues['Status'] || 'Todo');

        // Determine aggregate status
        const allTodo = allStatuses.every(status => status === 'Todo');
        const allDone = allStatuses.length > 0 && allStatuses.every(status => ['Done', 'Merged', 'Closed'].includes(status));
        const anyInProgressOrDone = allStatuses.some(status => status === 'In Progress' || ['Done', 'Merged', 'Closed'].includes(status));

        // Calculate display status and text color
        let displayStatus;
        let textColor;

        if (allDone) {
            displayStatus = 'Done';
            textColor = '#ffffff'; // White
        } else if (anyInProgressOrDone) {
            displayStatus = 'In Progress';
            textColor = '#4ade80'; // Green
        } else {
            displayStatus = 'Todo';
            textColor = '#60a5fa'; // Blue
        }

        const isDone = allDone;

        const phaseEl = document.createElement('div');
        phaseEl.className = 'phase-group' + (allDone ? ' phase-completed' : '');
        phaseEl.setAttribute('data-is-done', isDone.toString());

        const phaseKey = `phase-${projectId}-${phase.phaseName}`;
        const isExpanded = state.expandedPhases[phaseKey] !== false; // Default expanded

        // Phase header with expand/collapse
        const phaseHeader = document.createElement('div');
        phaseHeader.className = 'phase-header';
        phaseHeader.style.cursor = 'pointer';

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = isExpanded ? '−' : '+';

        // Extract clean title from master item if available
        let phaseDisplayName = phase.phaseName;
        if (phase.masterItem && phase.masterItem.content && phase.masterItem.content.title) {
            const masterTitle = phase.masterItem.content.title;
            // Clean the title: remove phase prefix and MASTER suffix
            let cleanTitle = masterTitle
                .replace(/^\[Phase\s+\d+\]\s*/i, '')
                .replace(/^\(Phase\s+\d+\)\s*/i, '')
                .replace(/^Phase\s+\d+\s*:\s*/i, '')
                .replace(/\s*-?\s*MASTER\s*$/i, '')
                .trim();
            if (cleanTitle) {
                phaseDisplayName = `${phase.phaseName}: ${cleanTitle}`;
            }
        }

        const phaseTitle = document.createElement('h4');
        phaseTitle.style.display = 'inline';
        phaseTitle.style.flex = '1';
        phaseTitle.innerHTML = `<span class="phase-name" style="color: ${textColor}">${phaseDisplayName}</span> <span class="phase-status status-${displayStatus.toLowerCase().replace(/\\s+/g, '-')}">${displayStatus}</span>`;

        // Context menu button (three dots)
        const contextMenuButton = document.createElement('button');
        contextMenuButton.className = 'action-button context-menu-button';
        contextMenuButton.textContent = '⋮';
        contextMenuButton.title = 'Phase actions';
        contextMenuButton.onclick = (e) => {
            showPhaseContextMenu(e, phase, projectId, projectNumber);
        };

        phaseHeader.appendChild(expandIcon);
        phaseHeader.appendChild(phaseTitle);
        phaseHeader.appendChild(contextMenuButton);

        phaseHeader.onclick = (e) => {
            if (e.target === contextMenuButton) return;
            togglePhaseExpansion(phaseKey, phaseEl, expandIcon);
        };

        phaseEl.appendChild(phaseHeader);

        // Phase content
        const phaseContent = document.createElement('div');
        phaseContent.className = 'phase-content';
        phaseContent.style.display = isExpanded ? 'block' : 'none';

        const itemsList = document.createElement('ul');
        let hasItems = false;

        phase.workItems.forEach((item) => {
            const li = createItemElement(item, projectId, projectNumber, statusOptions);
            itemsList.appendChild(li);
            hasItems = true;
        });

        if (hasItems) {
            phaseContent.appendChild(itemsList);
            phaseEl.appendChild(phaseContent);
            return phaseEl;
        }

        return null; // Don't render empty phases
    }

    /**
     * @param {any} item
     * @param {string} projectId
     * @param {number} projectNumber
     * @param {any} statusOptions
     */
    function createItemElement(item, projectId, projectNumber, statusOptions) {
        const li = document.createElement('li');
        li.className = 'project-item !flex w-full items-center gap-2 min-w-0';
        li.setAttribute('data-item-id', item.id);

        const status = item.fieldValues['Status'];
        const isDone = ['Done', 'Merged', 'Closed'].includes(status);
        li.setAttribute('data-is-done', isDone.toString());
        li.setAttribute('data-status', status || 'Todo');

        // Build tooltip text if item has issue/PR number and project item number
        let tooltipText = '';
        if (item.content && item.content.number) {
            tooltipText = `Issue: #${item.content.number}`;
            if (item.databaseId) {
                tooltipText += `\nItem: #${item.databaseId}`;
            }
        } else if (item.databaseId) {
            tooltipText = `Item: #${item.databaseId}`;
        }

        if (tooltipText) {
            li.title = tooltipText;
        }

        // Status dropdown
        const statusSelect = document.createElement('select');
        statusSelect.className = 'item-status-select';

        if (statusOptions && statusOptions.length > 0) {
            statusOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.id;
                option.textContent = opt.name;
                option.selected = opt.name === status;
                statusSelect.appendChild(option);
            });

            statusSelect.onchange = () => {
                const selectedOption = statusOptions.find(o => o.id === statusSelect.value);
                if (selectedOption) {
                    vscode.postMessage({
                        type: 'updateStatus',
                        projectId: projectId,
                        itemId: item.id,
                        statusOptionId: statusSelect.value
                    });
                }
            };
        } else {
            // Fallback to static display if no options
            const statusSpan = document.createElement('span');
            statusSpan.className = `item-status status-${(status || 'todo').toLowerCase().replace(/\s+/g, '-')}`;
            statusSpan.textContent = status || 'No Status';
            li.appendChild(statusSpan);
        }

        if (statusOptions && statusOptions.length > 0) {
            li.appendChild(statusSelect);
        }

        // Process item title to simplify phase numbering
        let displayTitle = item.content.title;
        // Replace "(Phase X.Y)" or "(Phase X)" with just "(X.Y)" or "(X)"
        displayTitle = displayTitle.replace(/\(Phase\s+(\d+(?:\.\d+)?)\)/gi, '($1)');
        // Also handle format without parentheses at the start: "Phase X.Y" -> "X.Y"
        displayTitle = displayTitle.replace(/^Phase\s+(\d+(?:\.\d+)?)/i, '$1');

        const itemLink = document.createElement('a');
        itemLink.textContent = displayTitle;
        itemLink.className = 'item-link block flex-1 min-w-0 w-0 overflow-hidden whitespace-nowrap text-ellipsis';
        itemLink.onclick = () => {
            vscode.postMessage({ type: 'openUrl', url: item.content.url });
        };

        li.appendChild(itemLink);

        // Context menu button (three dots)
        const contextMenuButton = document.createElement('button');
        contextMenuButton.className = 'action-button context-menu-button item-context-button';
        contextMenuButton.textContent = '⋮';
        contextMenuButton.title = 'Item actions';
        contextMenuButton.onclick = (e) => {
            showItemContextMenu(e, item, projectId, projectNumber);
        };

        li.appendChild(contextMenuButton);

        return li;
    }

    /**
     * @param {string} projectKey
     * @param {HTMLElement} projectEl
     * @param {HTMLElement} icon
     */
    function toggleProjectExpansion(projectKey, projectEl, icon) {
        const content = projectEl.querySelector('.project-content');
        if (!content) return;

        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
        projectEl.classList.toggle('collapsed', isExpanded);
        icon.textContent = isExpanded ? '+' : '−';

        state.expandedProjects[projectKey] = !isExpanded;
        vscode.setState(state);
    }

    /**
     * @param {string} phaseKey
     * @param {HTMLElement} phaseEl
     * @param {HTMLElement} icon
     */
    function togglePhaseExpansion(phaseKey, phaseEl, icon) {
        const content = phaseEl.querySelector('.phase-content');
        if (!content) return;

        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
        icon.textContent = isExpanded ? '+' : '−';

        state.expandedPhases[phaseKey] = !isExpanded;
        vscode.setState(state);
    }

    /**
     * Remove an item from the DOM
     * @param {string} projectId
     * @param {string} itemId
     */
    function removeItemFromDOM(projectId, itemId) {
        // Find all list items and check their data or find by item ID
        const allItems = document.querySelectorAll('.project-item');
        for (const item of allItems) {
            // Check if this item's delete button has the matching itemId
            const deleteBtn = item.querySelector('.delete-button');
            if (deleteBtn) {
                const onclickStr = deleteBtn.getAttribute('onclick') || '';
                // We need a better way to identify items - let's add data attributes
                // For now, we'll search through the DOM structure
                // This is a workaround - ideally we'd add data-item-id attributes
            }
        }

        // Better approach: find the item by searching for the delete button's message
        // Since we don't have data attributes yet, let's just do a full search
        const items = document.querySelectorAll('.project-item');
        items.forEach(item => {
            const deleteButton = item.querySelector('.delete-button');
            if (deleteButton) {
                // Check if clicking this button would send the matching itemId
                // We'll need to store itemId as a data attribute for this to work properly
                const itemIdAttr = item.getAttribute('data-item-id');
                if (itemIdAttr === itemId) {
                    // Fade out and remove
                    item.style.transition = 'opacity 0.3s';
                    item.style.opacity = '0';
                    setTimeout(() => {
                        item.remove();
                        // Check if parent phase is now empty
                        const phaseContent = item.closest('.phase-content');
                        if (phaseContent) {
                            const remainingItems = phaseContent.querySelectorAll('.project-item');
                            if (remainingItems.length === 0) {
                                const phaseGroup = phaseContent.closest('.phase-group');
                                if (phaseGroup) {
                                    phaseGroup.style.transition = 'opacity 0.3s';
                                    phaseGroup.style.opacity = '0';
                                    setTimeout(() => phaseGroup.remove(), 300);
                                }
                            }
                        }
                    }, 300);
                }
            }
        });
    }

    /**
     * Remove a project from the DOM
     * @param {string} projectId
     */
    function removeProjectFromDOM(projectId) {
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const projectIdAttr = card.getAttribute('data-project-id');
            if (projectIdAttr === projectId) {
                // Fade out and remove
                card.style.transition = 'opacity 0.3s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 300);
            }
        });
    }

    /**
     * Handle project linked - remove from org projects list immediately
     */
    function handleProjectLinked(projectId) {
        console.log('Project linked:', projectId);
        // Remove from org projects in the UI (it's now in repo projects)
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const projectIdAttr = card.getAttribute('data-project-id');
            const isRepoLinked = card.getAttribute('data-is-repo-linked') === 'true';
            if (projectIdAttr === projectId && !isRepoLinked) {
                // This is the org version - remove it
                card.style.transition = 'opacity 0.3s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 300);
            } else if (projectIdAttr === projectId && isRepoLinked) {
                // Update the repo version to show it's linked
                card.setAttribute('data-is-repo-linked', 'true');
            }
        });
    }

    /**
     * Handle project unlinked - remove from repo projects list immediately
     */
    function handleProjectUnlinked(projectId) {
        console.log('Project unlinked:', projectId);
        // Remove from repo projects in the UI (it's now only in org projects)
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const projectIdAttr = card.getAttribute('data-project-id');
            const isRepoLinked = card.getAttribute('data-is-repo-linked') === 'true';
            if (projectIdAttr === projectId && isRepoLinked) {
                // This is the repo version - remove it
                card.style.transition = 'opacity 0.3s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 300);
            }
        });
    }

    /**
     * Handle project removed - remove from view entirely (not linked to this repo or org)
     */
    function handleProjectRemoved(projectId) {
        console.log('Project removed:', projectId);
        // Remove all instances of this project from the UI
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const projectIdAttr = card.getAttribute('data-project-id');
            if (projectIdAttr === projectId) {
                card.style.transition = 'opacity 0.3s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 300);
            }
        });
    }

    /**
     * Store current repo info for GitHub button
     */
    let currentRepoOwner = null;
    let currentRepoName = null;

    function updateRepoInfo(owner, repo) {
        currentRepoOwner = owner;
        currentRepoName = repo;
        // Update GitHub button if it exists
        const githubButton = document.querySelector('.github-repo-button');
        if (githubButton) {
            githubButton.style.display = owner && repo ? 'block' : 'none';
        }
    }

    function showLoading() {
        if (loadingDiv) loadingDiv.style.display = 'flex';
        if (errorDiv) errorDiv.style.display = 'none';
        if (contentDiv) contentDiv.style.display = 'none';
    }

    function hideLoading() {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';
        if (contentDiv) contentDiv.style.display = 'block';
    }

    /**
     * Remove the no-repo panel and re-enable toolbar buttons/inputs
     * that were disabled by showNoRepoPanel().
     */
    function clearNoRepoState() {
        const panel = document.getElementById('no-repo-panel');
        if (panel) panel.remove();
        const remotePanel = document.getElementById('no-remote-panel');
        if (remotePanel) remotePanel.remove();
        const inlineError = document.getElementById('inline-error');
        if (inlineError) inlineError.remove();

        if (contentDiv) {
            // Re-enable toolbar buttons
            const disabledButtons = contentDiv.querySelectorAll('.toolbar-button-disabled');
            disabledButtons.forEach(btn => {
                btn.disabled = false;
                btn.classList.remove('toolbar-button-disabled');
            });
            // Re-enable search input
            const searchInput = contentDiv.querySelector('.search-input');
            if (searchInput) {
                searchInput.disabled = false;
            }
            // Re-enable orchestration desired input
            const wsDesiredInput = contentDiv.querySelector('#orchestration-ws-desired');
            if (wsDesiredInput) {
                wsDesiredInput.disabled = false;
                wsDesiredInput.classList.remove('orchestration-input-disabled');
            }
        }
    }

    /** @param {string} message */
    function showError(message) {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';

        // Remove any existing inline error
        const existingError = document.getElementById('inline-error');
        if (existingError) existingError.remove();

        if (!contentDiv) return;

        // Create inline error container inside contentDiv (after sticky header)
        const errorContainer = document.createElement('div');
        errorContainer.id = 'inline-error';
        errorContainer.className = 'error-container';
        errorContainer.style.display = 'block';

        // Create error message container
        const errorText = document.createElement('span');
        const cleanMessage = message.replace('Click refresh (🔄) to try again.', 'Click refresh to try again.');

        // Split by URL regex
        const parts = cleanMessage.split(/(https?:\/\/[^\s]+)/g);

        parts.forEach(part => {
            if (part.match(/^https?:\/\//)) {
                const link = document.createElement('a');
                link.href = '#';
                link.textContent = part;
                link.className = 'error-link';
                link.onclick = (e) => {
                    e.preventDefault();
                    vscode.postMessage({ type: 'openUrl', url: part });
                };
                errorText.appendChild(link);
            } else {
                errorText.appendChild(document.createTextNode(part));
            }
        });

        errorContainer.appendChild(errorText);

        // Add refresh button inline with error
        const refreshButton = document.createElement('button');
        refreshButton.className = 'error-refresh-button';
        refreshButton.title = 'Refresh projects';
        refreshButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
        refreshButton.onclick = () => {
            vscode.postMessage({ type: 'refresh' });
        };
        errorContainer.appendChild(refreshButton);

        contentDiv.appendChild(errorContainer);
    }

    /**
     * Show the "No git repository found" panel inside #content
     * with an "Initialize Repository" button.
     * Also disables all toolbar action buttons except settings.
     */
    function showNoRepoPanel() {
        // Hide the error div - we render inside content instead
        if (errorDiv) errorDiv.style.display = 'none';

        // Remove any existing no-repo panel
        const existing = document.getElementById('no-repo-panel');
        if (existing) existing.remove();

        // Disable all toolbar buttons except settings
        if (contentDiv) {
            const toolbarButtons = contentDiv.querySelectorAll('.toolbar .toolbar-button');
            toolbarButtons.forEach(btn => {
                if (!btn.classList.contains('settings-button')) {
                    btn.disabled = true;
                    btn.classList.add('toolbar-button-disabled');
                }
            });
            // Also disable the search input
            const searchInput = contentDiv.querySelector('.search-input');
            if (searchInput) {
                searchInput.disabled = true;
            }
            // Also disable the orchestration desired input
            const wsDesiredInput = contentDiv.querySelector('#orchestration-ws-desired');
            if (wsDesiredInput) {
                wsDesiredInput.disabled = true;
                wsDesiredInput.classList.add('orchestration-input-disabled');
            }
        }

        const panel = document.createElement('div');
        panel.id = 'no-repo-panel';
        panel.className = 'no-repo-panel';

        const icon = document.createElement('div');
        icon.className = 'no-repo-icon';
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';

        const msg = document.createElement('div');
        msg.className = 'no-repo-message';
        msg.textContent = 'No git repository found';

        const desc = document.createElement('div');
        desc.className = 'no-repo-description';
        desc.textContent = 'Initialize a repository and connect it to GitHub to start tracking projects.';

        const btn = document.createElement('button');
        btn.className = 'no-repo-init-button';
        btn.textContent = 'Initialize Repository';
        btn.onclick = () => {
            vscode.postMessage({ type: 'initGitRepo' });
        };

        panel.appendChild(icon);
        panel.appendChild(msg);
        panel.appendChild(desc);
        panel.appendChild(btn);

        // Append after the sticky header (which is the first child of contentDiv)
        if (contentDiv) {
            contentDiv.appendChild(panel);
        }
    }

    /**
     * Show the "No remote found" panel inside #content
     * with an "Add Remote" button.
     * Also disables toolbar buttons except settings.
     */
    function showNoRemotePanel() {
        // Hide the error div - we render inside content instead
        if (errorDiv) errorDiv.style.display = 'none';

        // Remove any existing panels
        const existingNoRepo = document.getElementById('no-repo-panel');
        if (existingNoRepo) existingNoRepo.remove();
        const existingNoRemote = document.getElementById('no-remote-panel');
        if (existingNoRemote) existingNoRemote.remove();

        // Disable all toolbar buttons except settings
        if (contentDiv) {
            const toolbarButtons = contentDiv.querySelectorAll('.toolbar .toolbar-button');
            toolbarButtons.forEach(btn => {
                if (!btn.classList.contains('settings-button')) {
                    btn.disabled = true;
                    btn.classList.add('toolbar-button-disabled');
                }
            });
            const searchInput = contentDiv.querySelector('.search-input');
            if (searchInput) {
                searchInput.disabled = true;
            }
            const wsDesiredInput = contentDiv.querySelector('#orchestration-ws-desired');
            if (wsDesiredInput) {
                wsDesiredInput.disabled = true;
                wsDesiredInput.classList.add('orchestration-input-disabled');
            }
        }

        const panel = document.createElement('div');
        panel.id = 'no-remote-panel';
        panel.className = 'no-repo-panel';

        const icon = document.createElement('div');
        icon.className = 'no-repo-icon';
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';

        const msg = document.createElement('div');
        msg.className = 'no-repo-message';
        msg.textContent = 'No remote found in current repository';

        const desc = document.createElement('div');
        desc.className = 'no-repo-description';
        desc.textContent = 'Create a GitHub repository and add it as a remote to start tracking projects.';

        const btn = document.createElement('button');
        btn.className = 'no-repo-init-button';
        btn.textContent = 'Create GitHub Repository';
        btn.onclick = () => {
            vscode.postMessage({ type: 'initGitRepo' });
        };

        panel.appendChild(icon);
        panel.appendChild(msg);
        panel.appendChild(desc);
        panel.appendChild(btn);

        if (contentDiv) {
            contentDiv.appendChild(panel);
        }
    }

    /**
     * Apply incremental updates to the DOM
     * @param {any} diff
     * @param {any} statusOptions
     */
    function applyIncrementalUpdate(diff, statusOptions) {
        console.log('Applying incremental update:', diff);

        // Handle removed projects
        diff.projectsRemoved.forEach(projectId => {
            removeProjectFromDOM(projectId);
        });

        // Handle removed items
        diff.itemsRemoved.forEach(removal => {
            removal.itemIds.forEach(itemId => {
                removeItemFromDOM(removal.projectId, itemId);
            });
        });

        // Handle added projects - need to re-render or append
        // For simplicity, if projects are added/removed, we might want to do a full re-render
        // But for now, let's handle item-level updates

        // Handle modified items
        diff.itemsModified.forEach(update => {
            update.items.forEach(item => {
                updateItemInDOM(item, update.projectId, statusOptions);
            });
        });

        // Handle added items
        diff.itemsAdded.forEach(addition => {
            addition.items.forEach(item => {
                addItemToDOM(item, addition.projectId, statusOptions);
            });
        });

        // Handle modified projects (update stats, etc.)
        diff.projectsModified.forEach(update => {
            updateProjectInDOM(update);
        });

        // Mark data as fresh
        markDataAsFresh();
    }

    /**
     * Mark data as fresh (remove cache indicator)
     */
    function markDataAsFresh() {
        removeRefreshIndicator();
    }

    /**
     * Show a single status bar indicator at the bottom
     * @param {string} message
     */
    function showRefreshIndicator(message) {
        // Remove any existing indicator
        const existing = document.getElementById('cache-indicator');
        if (existing) existing.remove();

        const indicator = document.createElement('div');
        indicator.className = 'cache-indicator';
        indicator.id = 'cache-indicator';

        // Add spinner
        const spinner = document.createElement('span');
        spinner.className = 'mini-spinner';
        indicator.appendChild(spinner);

        // Add message
        const text = document.createTextNode(' ' + message);
        indicator.appendChild(text);

        document.body.appendChild(indicator);
    }

    /**
     * Remove the refresh/cache indicator
     */
    function removeRefreshIndicator() {
        const indicator = document.getElementById('cache-indicator');
        if (indicator) {
            indicator.style.transition = 'opacity 0.3s';
            indicator.style.opacity = '0';
            setTimeout(() => indicator.remove(), 300);
        }
    }

    /**
     * Update an item in the DOM
     * @param {any} item
     * @param {string} projectId
     * @param {any} statusOptions
     */
    function updateItemInDOM(item, projectId, statusOptions) {
        const itemEl = document.querySelector(`.project-item[data-item-id="${item.id}"]`);
        if (!itemEl) return;

        // Update status dropdown
        const statusSelect = itemEl.querySelector('.item-status-select');
        if (statusSelect && statusOptions) {
            const status = item.fieldValues['Status'];
            const option = statusOptions.find(opt => opt.name === status);
            if (option) {
                statusSelect.value = option.id;
            }
        }

        // Update data attributes
        const status = item.fieldValues['Status'];
        const isDone = ['Done', 'Merged', 'Closed'].includes(status);
        itemEl.setAttribute('data-is-done', isDone.toString());
        itemEl.setAttribute('data-status', status || 'Todo');

        // Update title if changed
        const itemLink = itemEl.querySelector('.item-link');
        if (itemLink && item.content && item.content.title) {
            let displayTitle = item.content.title;
            displayTitle = displayTitle.replace(/\(Phase\s+(\d+(?:\.\d+)?)\)/gi, '($1)');
            displayTitle = displayTitle.replace(/^Phase\s+(\d+(?:\.\d+)?)/i, '$1');
            itemLink.textContent = displayTitle;
        }

        // Apply visibility filter
        toggleCompletedItemsVisibility();
    }

    /**
     * Add a new item to the DOM
     * @param {any} item
     * @param {string} projectId
     * @param {any} statusOptions
     */
    function addItemToDOM(item, projectId, statusOptions) {
        // Find the project card
        const projectCard = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!projectCard) return;

        // Extract project number from the header h3
        const projectHeader = projectCard.querySelector('h3');
        const projectNumberMatch = projectHeader?.textContent?.match(/#(\d+)/);
        const projectNumber = projectNumberMatch ? parseInt(projectNumberMatch[1]) : 0;

        // Find the appropriate phase or items list
        const phasesContainer = projectCard.querySelector('.phases-container');
        if (phasesContainer) {
            // Try to find the matching phase
            // For now, append to the first phase or create a new one
            // This is simplified - in production you'd want to match the phase properly
            const firstPhase = phasesContainer.querySelector('.phase-content ul');
            if (firstPhase) {
                const li = createItemElement(item, projectId, projectNumber, statusOptions);
                firstPhase.appendChild(li);

                // Animate in
                li.style.opacity = '0';
                setTimeout(() => {
                    li.style.transition = 'opacity 0.3s';
                    li.style.opacity = '1';
                }, 10);
            }
        }

        // Apply visibility filter
        toggleCompletedItemsVisibility();
    }

    /**
     * Show a loading indicator on a specific project
     * @param {string} projectId
     */
    function showProjectRefreshing(projectId) {
        const projectCard = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!projectCard) return;

        // Add refreshing class for styling
        projectCard.classList.add('project-refreshing');

        // Add spinner overlay to the project header
        const header = projectCard.querySelector('.project-header');
        if (header && !header.querySelector('.project-refresh-spinner')) {
            const spinner = document.createElement('span');
            spinner.className = 'mini-spinner project-refresh-spinner';
            spinner.style.marginLeft = '8px';
            header.insertBefore(spinner, header.querySelector('.project-stats'));
        }
    }

    /**
     * Clear the loading indicator from a specific project
     * @param {string} projectId
     */
    function clearProjectRefreshing(projectId) {
        const projectCard = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!projectCard) return;

        projectCard.classList.remove('project-refreshing');

        // Remove spinner
        const spinner = projectCard.querySelector('.project-refresh-spinner');
        if (spinner) {
            spinner.remove();
        }
    }

    /**
     * Update a single project's content in the DOM without full re-render
     * @param {string} projectId
     * @param {any} projectData
     * @param {any} statusOptions
     */
    function updateProjectInDOM(projectId, projectData, statusOptions, isLinked) {
        const projectCard = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!projectCard) return;

        // Clear refreshing state
        clearProjectRefreshing(projectId);

        // Check if link status has changed
        if (isLinked !== undefined) {
            const currentLinkStatus = projectCard.getAttribute('data-is-repo-linked') === 'true';
            const newLinkStatus = isLinked;

            // If link status changed, trigger appropriate handler and do a full refresh
            if (currentLinkStatus !== newLinkStatus) {
                console.log(`Project ${projectId} link status changed: ${currentLinkStatus} -> ${newLinkStatus}`);

                // Trigger the appropriate link/unlink handler
                if (newLinkStatus) {
                    handleProjectLinked(projectId);
                } else {
                    handleProjectUnlinked(projectId);
                }

                // Request full refresh to get project in correct list
                vscode.postMessage({ type: 'refresh' });
                return;
            }
        }

        // Preserve expansion state
        const projectKey = `project-${projectId}`;
        const wasExpanded = state.expandedProjects[projectKey];

        // Update stats in header
        const statsEl = projectCard.querySelector('.project-stats');
        if (statsEl) {
            statsEl.textContent = `${projectData.notDoneCount || 0} ready`;
        }

        // Update data attributes
        projectCard.setAttribute('data-not-done-count', (projectData.notDoneCount || 0).toString());
        if (isLinked !== undefined) {
            projectCard.setAttribute('data-is-repo-linked', isLinked.toString());
        }

        // Update project-all-done class based on new data
        if (projectData.notDoneCount === 0 && projectData.itemCount > 0) {
            projectCard.classList.add('project-all-done');
        } else {
            projectCard.classList.remove('project-all-done');
        }

        // Get or create content container
        let contentContainer = projectCard.querySelector('.project-content');
        if (contentContainer) {
            // Clear and rebuild content
            contentContainer.innerHTML = '';

            // Re-render phases
            if (projectData.phases && projectData.phases.length > 0) {
                const phasesContainer = document.createElement('div');
                phasesContainer.className = 'phases-container';

                projectData.phases.forEach((phase) => {
                    const phaseEl = createPhaseElement(phase, projectId, projectData.number, statusOptions);
                    if (phaseEl) {
                        phasesContainer.appendChild(phaseEl);
                    }
                });

                if (phasesContainer.children.length > 0) {
                    contentContainer.appendChild(phasesContainer);
                } else {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'empty-msg';
                    emptyMsg.textContent = 'No active items in phases.';
                    contentContainer.appendChild(emptyMsg);
                }
            } else {
                // Flat list if no phases
                const list = document.createElement('ul');
                (projectData.items || []).forEach((item) => {
                    const li = createItemElement(item, projectId, projectData.number, statusOptions);
                    list.appendChild(li);
                });
                contentContainer.appendChild(list);
            }
        }

        // Apply visibility filters
        toggleCompletedItemsVisibility();
        toggleOrgProjectsVisibility();
    }

    /**
     * Show the task history overlay
     */
    function showTaskHistory() {
        if (taskHistoryDiv) {
            taskHistoryDiv.style.display = 'flex';
            // Hide the projects content
            if (contentDiv) contentDiv.style.display = 'none';
        }
    }

    /**
     * Close the task history overlay and return to projects
     */
    function closeTaskHistory() {
        if (taskHistoryDiv) {
            taskHistoryDiv.style.display = 'none';
            // Show the projects content
            if (contentDiv) contentDiv.style.display = 'block';
        }
        vscode.postMessage({ type: 'closeTaskHistory' });
    }

    // Attach click listener to task history close button (can't use inline onclick due to CSP)
    const taskHistoryCloseBtn = document.getElementById('task-history-close-btn');
    if (taskHistoryCloseBtn) {
        taskHistoryCloseBtn.addEventListener('click', closeTaskHistory);
    }

    /**
     * Handle granular item status update from real-time event
     * Updates a specific item's status badge/dropdown without full refresh
     * @param {object} message - { projectNumber, issueNumber, status, title, state, phaseName, updatedFields }
     */
    function handleItemStatusUpdate(message) {
        const { projectNumber, issueNumber, status, title, state } = message;
        console.log('[Webview] itemStatusUpdate:', message);

        // Find all project items and match by issue number
        const items = document.querySelectorAll('.project-item');
        let found = false;

        items.forEach(item => {
            // Check tooltip for issue number match
            const tooltip = item.getAttribute('title') || '';
            if (tooltip.includes(`#${issueNumber}`)) {
                found = true;

                // Update status data attribute
                if (status) {
                    const isDone = ['Done', 'Merged', 'Closed'].includes(status);
                    item.setAttribute('data-is-done', isDone.toString());
                    item.setAttribute('data-status', status);

                    // Update status dropdown if present
                    const statusSelect = item.querySelector('.item-status-select');
                    if (statusSelect) {
                        const options = statusSelect.querySelectorAll('option');
                        options.forEach(opt => {
                            if (opt.textContent === status) {
                                statusSelect.value = opt.value;
                            }
                        });
                    }
                }

                // Update state (CLOSED)
                if (state === 'CLOSED') {
                    item.setAttribute('data-is-done', 'true');
                    item.setAttribute('data-status', 'Done');
                }

                // Update title if provided
                if (title) {
                    const itemLink = item.querySelector('.item-link');
                    if (itemLink) {
                        itemLink.textContent = title;
                    }
                }

                // Highlight animation
                highlightElement(item);
            }
        });

        if (!found) {
            console.log(`[Webview] itemStatusUpdate: item with issue #${issueNumber} not found in DOM`);
        }

        // Reapply visibility filters
        toggleCompletedItemsVisibility();
    }

    /**
     * Handle granular item added from real-time event.
     * Creates a lightweight item element in the DOM immediately.
     * @param {object} message - { projectNumber, issueNumber, title, url, state, owner, repo, labels }
     */
    function handleItemAdded(message) {
        const { projectNumber, issueNumber, title, url } = message;
        console.log('[Webview] itemAdded:', message);

        // Find the project card by matching the project number in the header
        const projectCards = document.querySelectorAll('.project-card');
        let targetCard = null;

        projectCards.forEach(card => {
            const header = card.querySelector('h3');
            if (header) {
                const numberMatch = header.textContent.match(/#(\d+)/);
                if (numberMatch && parseInt(numberMatch[1]) === projectNumber) {
                    targetCard = card;
                }
            }
        });

        if (!targetCard) {
            console.log(`[Webview] itemAdded: project #${projectNumber} card not found`);
            return;
        }

        // Check for duplicate — don't add if issue already in DOM
        const existing = targetCard.querySelector(`[title*="#${issueNumber}"]`);
        if (existing) {
            console.log(`[Webview] itemAdded: issue #${issueNumber} already in DOM, skipping`);
            highlightElement(existing);
            return;
        }

        // Create a lightweight item element
        const li = document.createElement('li');
        li.className = 'project-item';
        li.setAttribute('data-status', 'Todo');
        li.setAttribute('data-is-done', 'false');
        li.title = `Issue: #${issueNumber}`;

        // Status badge (static — will get a full dropdown on next refresh)
        const statusSpan = document.createElement('span');
        statusSpan.className = 'item-status status-todo';
        statusSpan.textContent = 'Todo';
        statusSpan.style.minWidth = '80px';
        statusSpan.style.textAlign = 'center';
        li.appendChild(statusSpan);

        // Title link
        const itemLink = document.createElement('a');
        itemLink.className = 'item-link';
        // Simplify phase numbering in title
        let displayTitle = title || `Issue #${issueNumber}`;
        displayTitle = displayTitle.replace(/\(Phase\s+(\d+(?:\.\d+)?)\)/gi, '($1)');
        displayTitle = displayTitle.replace(/^Phase\s+(\d+(?:\.\d+)?)/i, '$1');
        itemLink.textContent = displayTitle;
        if (url) {
            itemLink.onclick = () => {
                vscode.postMessage({ type: 'openUrl', url });
            };
        }
        li.appendChild(itemLink);

        // Find or create a list container in the project content
        let contentContainer = targetCard.querySelector('.project-content');
        if (!contentContainer) {
            contentContainer = document.createElement('div');
            contentContainer.className = 'project-content';
            contentContainer.style.display = 'block';
            targetCard.appendChild(contentContainer);
        }

        // Ensure content is visible (auto-expand on first item)
        if (contentContainer.style.display === 'none') {
            contentContainer.style.display = 'block';
            targetCard.classList.remove('collapsed');
            const expandIcon = targetCard.querySelector('.expand-icon');
            if (expandIcon) expandIcon.textContent = '−';
        }

        // Find existing <ul> or phases container, append to first available list
        let list = contentContainer.querySelector('ul');
        if (!list) {
            // Remove any "No active items" message
            const emptyMsg = contentContainer.querySelector('.empty-msg');
            if (emptyMsg) emptyMsg.remove();

            list = document.createElement('ul');
            contentContainer.appendChild(list);
        }

        list.appendChild(li);

        // Update stats counter
        const statsEl = targetCard.querySelector('.project-stats');
        if (statsEl) {
            const currentCount = parseInt(targetCard.getAttribute('data-not-done-count') || '0', 10);
            const newCount = currentCount + 1;
            targetCard.setAttribute('data-not-done-count', newCount.toString());
            statsEl.textContent = `${newCount} ready`;
        }

        // Remove "all done" styling if it was set
        targetCard.classList.remove('project-all-done');

        // Highlight the new item
        highlightElement(li);
    }

    /**
     * Handle project created from real-time event.
     * Creates a stub project card that items can be added to as they arrive.
     * @param {object} message - { projectNumber, title, url }
     */
    function handleProjectCreated(message) {
        const { projectNumber, title, url } = message;
        console.log('[Webview] projectCreated:', message);

        // Check if project card already exists
        const projectCards = document.querySelectorAll('.project-card');
        for (const card of projectCards) {
            const header = card.querySelector('h3');
            if (header) {
                const numberMatch = header.textContent.match(/#(\d+)/);
                if (numberMatch && parseInt(numberMatch[1]) === projectNumber) {
                    console.log(`[Webview] projectCreated: project #${projectNumber} already exists`);
                    highlightElement(card.querySelector('.project-header') || card);
                    return;
                }
            }
        }

        // Ensure toolbar exists
        ensureToolbarAndControls();

        // Create a stub project card
        const projectEl = document.createElement('div');
        projectEl.className = 'project-card';
        projectEl.setAttribute('data-not-done-count', '0');
        projectEl.setAttribute('data-item-count', '0');
        projectEl.setAttribute('data-project-title', title || '');
        projectEl.setAttribute('data-is-repo-linked', 'true');

        const header = document.createElement('div');
        header.className = 'project-header';
        header.style.cursor = 'pointer';

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = '−';

        const titleEl = document.createElement('h3');
        titleEl.textContent = `#${projectNumber} ${title || 'New Project'}`;
        titleEl.style.cursor = 'pointer';
        if (url) {
            titleEl.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'openUrl', url });
            };
        }

        const stats = document.createElement('span');
        stats.className = 'project-stats';
        stats.textContent = '0 ready';

        header.appendChild(expandIcon);
        header.appendChild(titleEl);
        header.appendChild(stats);

        const projectKey = `project-new-${projectNumber}`;
        header.onclick = (e) => {
            if (e.target === titleEl) return;
            toggleProjectExpansion(projectKey, projectEl, expandIcon);
        };

        projectEl.appendChild(header);

        // Content container — starts expanded and visible
        const contentContainer = document.createElement('div');
        contentContainer.className = 'project-content';
        contentContainer.style.display = 'block';

        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-msg';
        emptyMsg.textContent = 'Creating issues...';
        contentContainer.appendChild(emptyMsg);

        projectEl.appendChild(contentContainer);

        // Insert at the top of content (after sticky header)
        const stickyHeader = contentDiv.querySelector('.sticky-header');
        if (stickyHeader && stickyHeader.nextSibling) {
            contentDiv.insertBefore(projectEl, stickyHeader.nextSibling);
        } else {
            contentDiv.appendChild(projectEl);
        }

        // Highlight
        highlightElement(header);
    }

    /**
     * Handle project metadata update from real-time event
     * @param {object} message - { projectNumber, title, state }
     */
    function handleProjectMetadataUpdate(message) {
        const { projectNumber, title, state } = message;
        console.log('[Webview] projectMetadataUpdate:', message);

        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const header = card.querySelector('h3');
            if (header) {
                const numberMatch = header.textContent.match(/#(\d+)/);
                if (numberMatch && parseInt(numberMatch[1]) === projectNumber) {
                    // Update title
                    if (title) {
                        header.textContent = `#${projectNumber} ${title}`;
                    }

                    // Update closed state
                    if (state === 'closed') {
                        card.setAttribute('data-is-closed', 'true');
                    } else if (state === 'open') {
                        card.setAttribute('data-is-closed', 'false');
                    }

                    // Highlight
                    highlightElement(card.querySelector('.project-header') || card);
                }
            }
        });
    }

    /**
     * Handle worktree status update from extension.
     * Stores updated worktree data on the project card element so the context menu
     * shows the correct action next time it opens.
     */
    function handleWorktreeStatusUpdate(message) {
        const { projectNumber, worktree } = message;
        console.log('[Webview] worktreeStatusUpdate:', message);

        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            const header = card.querySelector('h3');
            if (!header) return;
            const numberMatch = header.textContent.match(/#(\d+)/);
            if (!numberMatch || parseInt(numberMatch[1]) !== projectNumber) return;

            // Store updated worktree data as a JSON data attribute
            card.setAttribute('data-worktree', JSON.stringify(worktree));
        });
    }

    /**
     * Apply a brief highlight animation to an element
     * @param {HTMLElement} element
     */
    function highlightElement(element) {
        element.style.transition = 'background-color 0.3s ease';
        element.style.backgroundColor = 'rgba(255, 213, 79, 0.3)';
        setTimeout(() => {
            element.style.backgroundColor = '';
            setTimeout(() => {
                element.style.transition = '';
            }, 300);
        }, 1500);
    }

    /**
     * Update project stats in the DOM (for incremental updates)
     * @param {any} update
     */
    function updateProjectStats(update) {
        const projectCard = document.querySelector(`.project-card[data-project-id="${update.id}"]`);
        if (!projectCard) return;

        const header = projectCard.querySelector('.project-header');
        if (!header) return;

        // Update stats
        if (update.changes.notDoneCount !== undefined) {
            const stats = header.querySelector('.project-stats');
            if (stats) {
                stats.textContent = `${update.changes.notDoneCount} active items`;
            }
            // Update data attribute for filtering
            projectCard.setAttribute('data-not-done-count', update.changes.notDoneCount.toString());
            // Reapply visibility filter in case project should now be hidden
            toggleCompletedItemsVisibility();
        }

        // Update title if changed
        if (update.changes.title) {
            const title = header.querySelector('h3');
            if (title) {
                const projectNumber = title.textContent.match(/#(\d+)/)?.[1] || '';
                title.textContent = `#${projectNumber} ${update.changes.title}`;
            }
        }
    }
}());
