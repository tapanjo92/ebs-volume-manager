// frontend/src/contexts/AuthContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import authService from '@/services/auth/auth-service';
import { CognitoUserSession } from 'amazon-cognito-identity-js';

interface User {
  email: string;
  tenantId: string;
  userRole: string;
  permissions: string[];
  attributes: Record<string, string>;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, attributes: Record<string, string>) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout>();
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    checkAuth();
    return () => {
      // Cleanup intervals on unmount
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  // Setup automatic token refresh
  useEffect(() => {
    if (user) {
      setupTokenRefresh();
    } else {
      // Clear refresh timers if user logs out
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = undefined;
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = undefined;
      }
    };
  }, [user]);

  const signIn = async (email: string, password: string): Promise<void> => {
    try {
      setError(null);
      const session = await authService.signIn(email, password);
      const userInfo = await getUserInfo();
      setUser(userInfo);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const signUp = async (email: string, password: string, attributes: Record<string, string>): Promise<void> => {
    try {
      setError(null);
      await authService.signUp(email, password, attributes);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      await authService.signOut();
      setUser(null);
    } catch (error: any) {
      setError(error.message);
    }
  };

  const confirmSignUp = async (email: string, code: string): Promise<void> => {
    try {
      setError(null);
      await authService.confirmSignUp(email, code);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const forgotPassword = async (email: string): Promise<void> => {
    try {
      setError(null);
      await authService.forgotPassword(email);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const confirmPassword = async (email: string, code: string, newPassword: string): Promise<void> => {
    try {
      setError(null);
      await authService.confirmPassword(email, code, newPassword);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const refreshSession = async (): Promise<void> => {
    try {
      await authService.refreshToken();
      const userInfo = await getUserInfo();
      setUser(userInfo);
    } catch (error: any) {
      setError(error.message);
      throw error;
    }
  };

  const setupTokenRefresh = (): void => {
    // Setup automatic token refresh 5 minutes before expiration
    const refreshInterval = setInterval(async () => {
      try {
        await refreshSession();
      } catch (error) {
        console.error('Auto refresh failed:', error);
        await signOut();
      }
    }, 55 * 60 * 1000); // 55 minutes

    refreshIntervalRef.current = refreshInterval;
  };

  const checkAuth = async (): Promise<void> => {
    try {
      const session = await authService.getCurrentSession();
      if (session) {
        const userInfo = await getUserInfo();
        setUser(userInfo);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserInfo = async (): Promise<User> => {
    const claims = authService.getUserClaims();
    if (!claims) throw new Error('No user claims found');

    return {
      email: claims.email,
      tenantId: claims['custom:tenant_id'] || 'default-tenant',
      userRole: claims['custom:user_role'] || 'user',
      permissions: (claims['custom:permissions'] || '').split(',').filter(Boolean),
      attributes: claims,
    };
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      confirmSignUp,
      forgotPassword,
      confirmPassword,
      refreshSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
