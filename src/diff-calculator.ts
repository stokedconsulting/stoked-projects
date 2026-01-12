import { ProjectItem } from './github-api';

export interface ProjectUpdate {
    id: string;
    changes: {
        title?: string;
        url?: string;
        itemCount?: number;
        notDoneCount?: number;
    };
}

export interface ItemUpdate {
    projectId: string;
    items: ProjectItem[];
}

export interface DataDiff {
    projectsAdded: any[];
    projectsRemoved: string[]; // Project IDs
    projectsModified: ProjectUpdate[];
    itemsAdded: ItemUpdate[];
    itemsRemoved: { projectId: string; itemIds: string[] }[];
    itemsModified: ItemUpdate[];
}

/**
 * Calculate differences between old and new project data
 */
export function calculateDataDiff(
    oldRepoProjects: any[],
    oldOrgProjects: any[],
    newRepoProjects: any[],
    newOrgProjects: any[]
): DataDiff {
    const oldProjects = [...oldRepoProjects, ...oldOrgProjects];
    const newProjects = [...newRepoProjects, ...newOrgProjects];

    const oldProjectMap = new Map(oldProjects.map(p => [p.id, p]));
    const newProjectMap = new Map(newProjects.map(p => [p.id, p]));

    // Find added projects
    const projectsAdded = newProjects.filter(p => !oldProjectMap.has(p.id));

    // Find removed projects
    const projectsRemoved = oldProjects
        .filter(p => !newProjectMap.has(p.id))
        .map(p => p.id);

    // Find modified projects
    const projectsModified: ProjectUpdate[] = [];
    for (const newProject of newProjects) {
        const oldProject = oldProjectMap.get(newProject.id);
        if (oldProject) {
            const changes: ProjectUpdate['changes'] = {};

            if (oldProject.title !== newProject.title) {
                changes.title = newProject.title;
            }
            if (oldProject.url !== newProject.url) {
                changes.url = newProject.url;
            }
            if (oldProject.itemCount !== newProject.itemCount) {
                changes.itemCount = newProject.itemCount;
            }
            if (oldProject.notDoneCount !== newProject.notDoneCount) {
                changes.notDoneCount = newProject.notDoneCount;
            }

            if (Object.keys(changes).length > 0) {
                projectsModified.push({
                    id: newProject.id,
                    changes,
                });
            }
        }
    }

    // Calculate item-level diffs
    const itemsAdded: ItemUpdate[] = [];
    const itemsRemoved: { projectId: string; itemIds: string[] }[] = [];
    const itemsModified: ItemUpdate[] = [];

    for (const newProject of newProjects) {
        const oldProject = oldProjectMap.get(newProject.id);

        if (!oldProject) {
            // New project, all items are added
            if (newProject.items && newProject.items.length > 0) {
                itemsAdded.push({
                    projectId: newProject.id,
                    items: newProject.items,
                });
            }
            continue;
        }

        const oldItems = oldProject.items || [];
        const newItems = newProject.items || [];

        const oldItemMap = new Map(oldItems.map((item: any) => [item.id, item]));
        const newItemMap = new Map(newItems.map((item: any) => [item.id, item]));

        // Find added items
        const added = newItems.filter((item: any) => !oldItemMap.has(item.id));
        if (added.length > 0) {
            itemsAdded.push({
                projectId: newProject.id,
                items: added,
            });
        }

        // Find removed items
        const removed = oldItems
            .filter((item: any) => !newItemMap.has(item.id))
            .map((item: any) => item.id);
        if (removed.length > 0) {
            itemsRemoved.push({
                projectId: newProject.id,
                itemIds: removed,
            });
        }

        // Find modified items
        const modified = newItems.filter((newItem: any) => {
            const oldItem = oldItemMap.get(newItem.id);
            if (!oldItem) return false;

            return isItemModified(oldItem, newItem);
        });

        if (modified.length > 0) {
            itemsModified.push({
                projectId: newProject.id,
                items: modified,
            });
        }
    }

    return {
        projectsAdded,
        projectsRemoved,
        projectsModified,
        itemsAdded,
        itemsRemoved,
        itemsModified,
    };
}

/**
 * Check if an item has been modified
 */
function isItemModified(oldItem: any, newItem: any): boolean {
    // Check content changes
    if (oldItem.content?.title !== newItem.content?.title) return true;
    if (oldItem.content?.body !== newItem.content?.body) return true;
    if (oldItem.content?.state !== newItem.content?.state) return true;

    // Check field values
    const oldFields = JSON.stringify(oldItem.fieldValues || {});
    const newFields = JSON.stringify(newItem.fieldValues || {});
    if (oldFields !== newFields) return true;

    // Check phases
    const oldPhases = JSON.stringify(oldItem.phases || []);
    const newPhases = JSON.stringify(newItem.phases || []);
    if (oldPhases !== newPhases) return true;

    return false;
}

/**
 * Check if there are any meaningful changes
 */
export function hasChanges(diff: DataDiff): boolean {
    return (
        diff.projectsAdded.length > 0 ||
        diff.projectsRemoved.length > 0 ||
        diff.projectsModified.length > 0 ||
        diff.itemsAdded.length > 0 ||
        diff.itemsRemoved.length > 0 ||
        diff.itemsModified.length > 0
    );
}
