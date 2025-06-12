'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      setLoading(true);
      const session = await authService.getCurrentSession();
      
      if (session && session.isValid()) {
        await loadUserFromSession(session);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserFromSession = async (session: CognitoUserSession) => {
    try {
      const claims = authService.getUserClaims();
      const attributes = await authService.getUserAttributes();
      
      const attributesMap: Record<string, string> = {};
      attributes.forEach(attr => {
        attributesMap[attr.getName()] = attr.getValue();
      });
      
      setUser({
        email: claims.email,
        tenantId: claims.tenantId || 'default',
        userRole: claims.userRole || 'user',
        permissions: claims.permissions ? claims.permissions.split(',') : [],
        attributes: attributesMap,
      });
    } catch (err) {
      console.error('Failed to load user from session:', err);
      setError('Failed to load user data');
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setError(null);
      setLoading(true);
      
      const session = await authService.signIn(email, password);
      await loadUserFromSession(session);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, attributes: Record<string, string>) => {
    try {
      setError(null);
      setLoading(true);
      
      await authService.signUp(email, password, attributes);
    } catch (err: any) {
      setError(err.message || 'Sign up failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      await authService.signOut();
      setUser(null);
    } catch (err: any) {
      setError(err.message || 'Sign out failed');
      throw err;
    }
  };

  const confirmSignUp = async (email: string, code: string) => {
    try {
      setError(null);
      await authService.confirmSignUp(email, code);
    } catch (err: any) {
      setError(err.message || 'Confirmation failed');
      throw err;
    }
  };

  const forgotPassword = async (email: string) => {
    try {
      setError(null);
      await authService.forgotPassword(email);
    } catch (err: any) {
      setError(err.message || 'Password reset request failed');
      throw err;
    }
  };

  const confirmPassword = async (email: string, code: string, newPassword: string) => {
    try {
      setError(null);
      await authService.confirmPassword(email, code, newPassword);
    } catch (err: any) {
      setError(err.message || 'Password reset failed');
      throw err;
    }
  };

  const refreshSession = async () => {
    try {
      setError(null);
      const session = await authService.refreshToken();
      
      if (session) {
        await loadUserFromSession(session);
      }
    } catch (err: any) {
      setError(err.message || 'Session refresh failed');
      throw err;
    }
  };

  const value = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
