import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import authService from './auth/auth-service';

class ApiClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.example.com';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      async (config) => {
        const token = authService.getIdToken();
        
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor to handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          try {
            await authService.refreshToken();
            const newToken = authService.getIdToken();
            
            if (newToken && originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
            }
            
            return this.client(originalRequest);
          } catch (refreshError) {
            // Redirect to login
            window.location.href = '/auth/signin';
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(error);
      }
    );
  }

  // Volume endpoints
  async getVolumes(filters?: Record<string, any>) {
    const response = await this.client.get('/volumes', { params: filters });
    return response.data;
  }

  async getVolume(volumeId: string) {
    const response = await this.client.get(`/volumes/${volumeId}`);
    return response.data;
  }

  async scanVolumes(accountId: string) {
    const response = await this.client.post('/volumes/scan', { accountId });
    return response.data;
  }

  async backupVolume(volumeId: string, options?: any) {
    const response = await this.client.post(`/volumes/${volumeId}/backup`, options);
    return response.data;
  }

  async deleteVolume(volumeId: string) {
    const response = await this.client.delete(`/volumes/${volumeId}`);
    return response.data;
  }

  // Tenant endpoints
  async getTenantInfo() {
    const response = await this.client.get('/tenant');
    return response.data;
  }

  async updateTenantSettings(settings: any) {
    const response = await this.client.put('/tenant/settings', settings);
    return response.data;
  }

  // User management endpoints
  async inviteUser(email: string, role: string) {
    const response = await this.client.post('/users/invite', { email, role });
    return response.data;
  }

  async getUsers() {
    const response = await this.client.get('/users');
    return response.data;
  }

  async updateUserRole(userId: string, role: string) {
    const response = await this.client.put(`/users/${userId}/role`, { role });
    return response.data;
  }

  // Analytics endpoints
  async getVolumeStats() {
    const response = await this.client.get('/analytics/volumes');
    return response.data;
  }

  async getCostAnalysis(period: string) {
    const response = await this.client.get('/analytics/costs', { params: { period } });
    return response.data;
  }
}

export default new ApiClient();
