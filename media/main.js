// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const contentDiv = document.getElementById('content');

    // Track expansion state and filter preferences
    const state = vscode.getState() || { expandedProjects: {}, expandedPhases: {}, showCompleted: false };

    // Loading timeout to prevent infinite loading states
    let loadingTimeoutId = null;
    const LOADING_TIMEOUT_MS = 30000; // 30 seconds

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
                renderAllProjects(message.repoProjects, message.orgProjects, message.statusOptions);
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

        toolbar.appendChild(refreshButton);
        toolbar.appendChild(toggleButton);
        return toolbar;
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
     */
    function renderAllProjects(repoProjects, orgProjects, statusOptions, isCached = false, isStale = false, cacheAge = 0) {
        if (!contentDiv) return;

        hideLoading();
        contentDiv.innerHTML = '';

        // Add toolbar
        const toolbar = createToolbar();
        contentDiv.appendChild(toolbar);

        // Add cache indicator if showing cached data - status bar at bottom
        if (isCached) {
            // Remove any existing cache indicator
            const existing = document.getElementById('cache-indicator');
            if (existing) existing.remove();

            const cacheIndicator = document.createElement('div');
            cacheIndicator.className = 'cache-indicator';
            cacheIndicator.id = 'cache-indicator';
            const statusText = isStale ? '⚠️ Cached (updating...)' : `✓ Cached (${cacheAge}s ago, updating...)`;
            cacheIndicator.textContent = statusText;
            document.body.appendChild(cacheIndicator);
        }

        if (repoProjects.length === 0 && orgProjects.length === 0) {
            contentDiv.textContent = 'No projects found.';
            return;
        }

        // Determine if we should auto-expand (only if single project total)
        const totalProjects = repoProjects.length + orgProjects.length;
        const autoExpand = totalProjects === 1;

        if (repoProjects.length > 0) {
            const headerContainer = document.createElement('div');
            headerContainer.className = 'group-header-container';

            const header = document.createElement('h2');
            header.textContent = 'Repository Projects';
            header.className = 'group-header';

            const addButton = document.createElement('button');
            addButton.className = 'add-project-button';
            addButton.textContent = '+';
            addButton.title = 'Add new project';
            addButton.onclick = () => {
                vscode.postMessage({ type: 'addProject' });
            };

            headerContainer.appendChild(header);
            headerContainer.appendChild(addButton);
            contentDiv.appendChild(headerContainer);

            repoProjects.forEach(p => {
                contentDiv.appendChild(createProjectElement(p, autoExpand, statusOptions));
            });
        }

        if (orgProjects.length > 0) {
            const header = document.createElement('h2');
            header.textContent = 'Organization Projects';
            header.className = 'group-header';
            contentDiv.appendChild(header);

            orgProjects.forEach(p => {
                contentDiv.appendChild(createProjectElement(p, autoExpand, statusOptions));
            });
        }

        // Apply initial visibility based on filter state
        toggleCompletedItemsVisibility();
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

        // Add class for styling when all items are done
        if (project.notDoneCount === 0 && project.items && project.items.length > 0) {
            projectEl.classList.add('project-all-done');
        }

        const projectKey = `project-${project.id}`;
        const isExpanded = autoExpand || state.expandedProjects[projectKey];

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
        stats.textContent = `${project.notDoneCount} ready`;

        // Start Work button (icon only)
        const startButton = document.createElement('button');
        startButton.className = 'action-button start-button';
        startButton.textContent = '▶';
        startButton.title = 'Start working on this project';
        startButton.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
                type: 'startProject',
                projectNumber: project.number
            });
        };

        // Mark All Done button
        const markDoneButton = document.createElement('button');
        markDoneButton.className = 'action-button mark-done-button';
        markDoneButton.textContent = '✓';
        markDoneButton.title = 'Mark all items as Done';
        markDoneButton.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
                type: 'markAllDone',
                projectId: project.id,
                projectTitle: project.title
            });
        };

        // Delete project button
        const deleteProjectButton = document.createElement('button');
        deleteProjectButton.className = 'action-button delete-button';
        deleteProjectButton.textContent = '🗑️';
        deleteProjectButton.title = 'Delete entire project';
        deleteProjectButton.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
                type: 'deleteProject',
                projectId: project.id,
                projectTitle: project.title
            });
        };

        // Action buttons container for right alignment
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';
        actionButtons.appendChild(startButton);
        actionButtons.appendChild(markDoneButton);
        actionButtons.appendChild(deleteProjectButton);

        header.appendChild(expandIcon);
        header.appendChild(title);
        header.appendChild(stats);
        header.appendChild(actionButtons);

        // Toggle expansion on header click
        header.onclick = (e) => {
            if (e.target === title || e.target === startButton || e.target === deleteProjectButton) return;
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
            errorDiv.textContent = message;
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
        const cacheIndicator = document.getElementById('cache-indicator');
        if (cacheIndicator) {
            cacheIndicator.style.transition = 'opacity 0.3s';
            cacheIndicator.style.opacity = '0';
            setTimeout(() => cacheIndicator.remove(), 300);
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
     * Update project stats in the DOM
     * @param {any} update
     */
    function updateProjectInDOM(update) {
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
