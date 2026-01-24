/**
 * GitHub Project interface (matches VSCode extension schema)
 */
export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
  shortDescription?: string;
  readme?: string;
  closed: boolean;
  public: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Response for list projects endpoint
 */
export interface ListProjectsResponse {
  projects: Project[];
  repositoryId?: string;
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string;
}

/**
 * Response for create project endpoint
 */
export interface CreateProjectResponse {
  project: Project;
}

/**
 * Response for update project endpoint
 */
export interface UpdateProjectResponse {
  project: Project;
}

/**
 * Response for link/unlink operations
 */
export interface LinkProjectResponse {
  success: boolean;
  project: {
    id: string;
    number: number;
  };
  repository: {
    id: string;
    name: string;
    owner: string;
  };
}
