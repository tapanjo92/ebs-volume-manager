'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

export default function ConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirmSignUp } = useAuth();
  
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Get email from query params or session storage
    const emailParam = searchParams.get('email');
    const storedEmail = sessionStorage.getItem('signupEmail');
    
    if (emailParam) {
      setEmail(emailParam);
    } else if (storedEmail) {
      setEmail(storedEmail);
    } else {
      // If no email found, redirect to signup
      router.push('/auth/signup');
    }
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await confirmSignUp(email, code);
      setSuccess(true);
      
      // Clear stored email
      sessionStorage.removeItem('signupEmail');
      
      // Redirect to sign in after 2 seconds
      setTimeout(() => {
        router.push('/auth/signin?confirmed=true');
      }, 2000);
    } catch (err: any) {
      console.error('Confirmation error:', err);
      
      // Handle specific Cognito errors
      if (err.code === 'CodeMismatchException') {
        setError('Invalid verification code. Please check and try again.');
      } else if (err.code === 'ExpiredCodeException') {
        setError('Verification code has expired. Please request a new one.');
      } else if (err.code === 'NotAuthorizedException') {
        setError('Account is already confirmed. Please sign in.');
        setTimeout(() => router.push('/auth/signin'), 2000);
      } else {
        setError(err.message || 'Failed to confirm account');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setResending(true);

    try {
      const authService = (await import('@/services/auth/auth-service')).default;
      await authService.resendConfirmationCode(email);
      setError(''); // Clear any existing errors
      alert('Verification code resent! Please check your email.');
    } catch (err: any) {
      console.error('Resend error:', err);
      
      if (err.code === 'LimitExceededException') {
        setError('Too many attempts. Please wait a moment before trying again.');
      } else {
        setError(err.message || 'Failed to resend code');
      }
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="rounded-md bg-green-50 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-green-800">
                  Account confirmed successfully! Redirecting to sign in...
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Confirm your email
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            We've sent a verification code to{' '}
            <span className="font-medium text-gray-900">{email}</span>
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}
          
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700">
              Verification Code
            </label>
            <div className="mt-1">
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="one-time-code"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm text-center text-2xl tracking-widest"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Enter the 6-digit code sent to your email
            </p>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Confirming...' : 'Confirm Account'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resending}
              className="text-sm text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
            >
              {resending ? 'Resending...' : 'Resend code'}
            </button>
            
            <Link href="/auth/signin" className="text-sm text-indigo-600 hover:text-indigo-500">
              Back to sign in
            </Link>
          </div>
        </form>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            Didn't receive the email? Check your spam folder or{' '}
            <button
              onClick={() => setEmail('')}
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              use a different email
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
