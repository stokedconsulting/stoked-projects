// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const contentDiv = document.getElementById('content');

    // Track expansion state and filter preferences
    const state = vscode.getState() || { expandedProjects: {}, expandedPhases: {}, showCompleted: false, showOrgProjects: true };

    // Loading timeout to prevent infinite loading states
    let loadingTimeoutId = null;
    const LOADING_TIMEOUT_MS = 60000; // 60 seconds

    // Track currently open context menu
    let currentContextMenu = null;

    // Request data when webview is loaded/restored
    vscode.postMessage({ type: 'ready' });

    // Close context menu when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (currentContextMenu && !e.target.closest('.context-menu')) {
            closeContextMenu();
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'loading':
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
                showError(message.message);
                break;
            case 'data':
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                renderAllProjects(message.repoProjects, message.orgProjects, message.statusOptions, false, false, 0, message.isPartial);
                break;
            case 'cachedData':
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
                renderAllProjects(message.repoProjects, message.orgProjects, message.statusOptions, true, message.isStale, message.cacheAge);
                break;
            case 'incrementalUpdate':
                applyIncrementalUpdate(message.diff, message.statusOptions);
                break;
            case 'dataFresh':
                markDataAsFresh();
                break;
            case 'noProjects':
                if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
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
                updateProjectInDOM(message.projectId, message.projectData, message.statusOptions);
                break;
            case 'projectRefreshError':
                clearProjectRefreshing(message.projectId);
                break;
        }
    });

    /**
     * Create toolbar with filter controls
     */
    function createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';

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

        // Add Project button
        const addProjectButton = document.createElement('button');
        addProjectButton.className = 'toolbar-button add-project-toolbar-button';
        addProjectButton.title = 'Add new project';
        addProjectButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
        addProjectButton.onclick = () => {
            vscode.postMessage({ type: 'addProject' });
        };

        toolbar.appendChild(refreshButton);
        toolbar.appendChild(clearCacheButton);
        toolbar.appendChild(orgToggleButton);
        toolbar.appendChild(toggleButton);
        toolbar.appendChild(addProjectButton);
        return toolbar;
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
            'Start Working (Standard)',
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
            'Start with Custom Context',
            '+',
            () => {
                vscode.postMessage({
                    type: 'startProjectWithContext',
                    projectNumber: project.number
                });
                closeContextMenu();
            }
        );

        // Link to Current Project (only show when in org mode and not already linked)
        let linkItem = null;
        if (state.showOrgProjects && !project.isRepoLinked) {
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

        // Unlink from Repository (only show when in repo mode and already linked)
        let unlinkItem = null;
        if (!state.showOrgProjects && project.isRepoLinked) {
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
     * Toggle visibility of completed items without re-fetching data
     */
    function toggleCompletedItemsVisibility() {
        const allProjects = document.querySelectorAll('.project-card');

        allProjects.forEach(projectCard => {
            const isDone = projectCard.getAttribute('data-is-done') === 'true';
            const isClosed = projectCard.getAttribute('data-is-closed') === 'true';
            const notDoneCount = parseInt(projectCard.getAttribute('data-not-done-count') || '0', 10);
            const hasNoActiveItems = notDoneCount === 0;

            if (!state.showCompleted && (isDone || isClosed || hasNoActiveItems)) {
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
    }

    /**
     * Toggle visibility of org-only projects (those not linked to current repo)
     */
    function toggleOrgProjectsVisibility() {
        const allProjects = document.querySelectorAll('.project-card');

        allProjects.forEach(projectCard => {
            const isRepoLinked = projectCard.getAttribute('data-is-repo-linked') === 'true';

            // If showOrgProjects is false, hide org-only projects
            if (!state.showOrgProjects && !isRepoLinked) {
                projectCard.style.display = 'none';
            } else {
                // Respect other visibility filters (completed toggle)
                const isDone = projectCard.getAttribute('data-is-done') === 'true';
                const isClosed = projectCard.getAttribute('data-is-closed') === 'true';
                const notDoneCount = parseInt(projectCard.getAttribute('data-not-done-count') || '0', 10);
                const hasNoActiveItems = notDoneCount === 0;

                if (!state.showCompleted && (isDone || isClosed || hasNoActiveItems)) {
                    projectCard.style.display = 'none';
                } else {
                    projectCard.style.display = 'block';
                }
            }
        });
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
        if (!contentDiv) return;

        hideLoading();

        // Show/hide refresh indicator based on partial data
        if (isPartial) {
            showRefreshIndicator('Refreshing projects...');
        } else {
            removeRefreshIndicator();
        }
        contentDiv.innerHTML = '';

        // Add toolbar
        const toolbar = createToolbar();
        contentDiv.appendChild(toolbar);

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

        if (uniqueProjects.length === 0) {
            contentDiv.textContent = 'No projects found.';
            return;
        }

        // Determine if we should auto-expand (only if single project total)
        const autoExpand = uniqueProjects.length === 1;

        uniqueProjects.forEach(p => {
            contentDiv.appendChild(createProjectElement(p, autoExpand, statusOptions));
        });

        // Apply initial visibility based on filter state
        toggleCompletedItemsVisibility();
        toggleOrgProjectsVisibility();
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
        expandIcon.textContent = isExpanded ? '▼' : '▶';

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

        // Content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'project-content';
        contentContainer.style.display = isExpanded ? 'block' : 'none';

        // Render Phases
        if (project.phases && project.phases.length > 0) {
            const phasesContainer = document.createElement('div');
            phasesContainer.className = 'phases-container';

            project.phases.forEach((phase) => {
                const phaseEl = createPhaseElement(phase, project.id, statusOptions);
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
                const li = createItemElement(item, project.id, statusOptions);
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
     * @param {any} statusOptions
     */
    function createPhaseElement(phase, projectId, statusOptions) {
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
        phaseEl.className = 'phase-group';
        phaseEl.setAttribute('data-is-done', isDone.toString());

        const phaseKey = `phase-${projectId}-${phase.phaseName}`;
        const isExpanded = state.expandedPhases[phaseKey] !== false; // Default expanded

        // Phase header with expand/collapse
        const phaseHeader = document.createElement('div');
        phaseHeader.className = 'phase-header';
        phaseHeader.style.cursor = 'pointer';

        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon';
        expandIcon.textContent = isExpanded ? '▼' : '▶';

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

        // Button container for right-aligned buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'phase-buttons';

        // Mark Phase Done button
        const markDoneButton = document.createElement('button');
        markDoneButton.className = 'action-button mark-done-button';
        markDoneButton.textContent = '✓';
        markDoneButton.title = 'Mark all phase items as Done';
        markDoneButton.onclick = (e) => {
            e.stopPropagation();
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
        };
        buttonContainer.appendChild(markDoneButton);

        // Add delete button for master item if it exists
        if (phase.masterItem) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'action-button delete-button';
            deleteButton.textContent = '🗑️';
            deleteButton.title = 'Delete phase master item';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({
                    type: 'deleteItem',
                    projectId: projectId,
                    itemId: phase.masterItem.id,
                    itemTitle: phase.phaseName + ' (Master)'
                });
            };
            buttonContainer.appendChild(deleteButton);
        }

        phaseHeader.appendChild(expandIcon);
        phaseHeader.appendChild(phaseTitle);
        phaseHeader.appendChild(buttonContainer);

        phaseHeader.onclick = (e) => {
            if (e.target.classList.contains('delete-button')) return;
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
            const li = createItemElement(item, projectId, statusOptions);
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
     * @param {any} statusOptions
     */
    function createItemElement(item, projectId, statusOptions) {
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

        // Delete button - now at the end for right alignment
        const deleteButton = document.createElement('button');
        deleteButton.className = 'action-button delete-button item-delete-button right-0';
        deleteButton.textContent = '🗑️';
        // Enhanced tooltip showing item title
        const shortTitle = item.content.title.length > 50
            ? item.content.title.substring(0, 50) + '...'
            : item.content.title;
        deleteButton.title = `Delete: ${shortTitle}`;
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
                type: 'deleteItem',
                projectId: projectId,
                itemId: item.id,
                itemTitle: item.content.title
            });
        };

        li.appendChild(deleteButton);

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
        icon.textContent = isExpanded ? '▶' : '▼';

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
        icon.textContent = isExpanded ? '▶' : '▼';

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

    /** @param {string} message */
    function showError(message) {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.innerHTML = '';

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

            errorDiv.appendChild(errorText);

            // Add refresh button inline with error
            const refreshButton = document.createElement('button');
            refreshButton.className = 'error-refresh-button';
            refreshButton.title = 'Refresh projects';
            refreshButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
            refreshButton.onclick = () => {
                vscode.postMessage({ type: 'refresh' });
            };
            errorDiv.appendChild(refreshButton);
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

        // Find the appropriate phase or items list
        const phasesContainer = projectCard.querySelector('.phases-container');
        if (phasesContainer) {
            // Try to find the matching phase
            // For now, append to the first phase or create a new one
            // This is simplified - in production you'd want to match the phase properly
            const firstPhase = phasesContainer.querySelector('.phase-content ul');
            if (firstPhase) {
                const li = createItemElement(item, projectId, statusOptions);
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
    function updateProjectInDOM(projectId, projectData, statusOptions) {
        const projectCard = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!projectCard) return;

        // Clear refreshing state
        clearProjectRefreshing(projectId);

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
                    const phaseEl = createPhaseElement(phase, projectId, statusOptions);
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
                    const li = createItemElement(item, projectId, statusOptions);
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
