export { ApiClient, ApiClientError } from './client';
export type * from './types';

import { ApiClient } from './client';
export const apiClient = new ApiClient();
