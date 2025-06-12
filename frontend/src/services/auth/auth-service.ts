import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { cognitoConfig } from './cognito-config';

class AuthService {
  private userPool: CognitoUserPool;
  private currentUser: CognitoUser | null = null;
  
  constructor() {
    this.userPool = new CognitoUserPool({
      UserPoolId: cognitoConfig.userPoolId,
      ClientId: cognitoConfig.clientId,
    });
  }
  
  async signUp(email: string, password: string, attributes: Record<string, string>) {
    return new Promise((resolve, reject) => {
      const attributeList: CognitoUserAttribute[] = [];
      
      // Add email attribute
      attributeList.push(
        new CognitoUserAttribute({
          Name: 'email',
          Value: email,
        })
      );
      
      // Add other attributes
      Object.entries(attributes).forEach(([key, value]) => {
        attributeList.push(
          new CognitoUserAttribute({
            Name: key,
            Value: value,
          })
        );
      });
      
      this.userPool.signUp(email, password, attributeList, [], (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  }
  
  async signIn(email: string, password: string): Promise<CognitoUserSession> {
    return new Promise((resolve, reject) => {
      const authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });
      
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });
      
      this.currentUser = cognitoUser;
      
      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result) => {
          // Store the user for later use
          this.currentUser = cognitoUser;
          resolve(result);
        },
        onFailure: (err) => {
          this.currentUser = null;
          reject(err);
        },
        newPasswordRequired: (userAttributes, requiredAttributes) => {
          // Handle password change requirement
          reject({
            code: 'NewPasswordRequired',
            message: 'New password required',
            userAttributes,
            requiredAttributes
          });
        },
      });
    });
  }
  
  async signOut(): Promise<void> {
    const cognitoUser = this.userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
      this.currentUser = null;
    }
  }
  
  async getCurrentSession(): Promise<CognitoUserSession | null> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        resolve(null);
        return;
      }
      
      // Update current user reference
      this.currentUser = cognitoUser;
      
      cognitoUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err) {
          this.currentUser = null;
          reject(err);
          return;
        }
        
        if (session && session.isValid()) {
          resolve(session);
        } else {
          resolve(null);
        }
      });
    });
  }
  
  async refreshToken(): Promise<CognitoUserSession | null> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        resolve(null);
        return;
      }
      
      cognitoUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (session && session.isValid()) {
          resolve(session);
          return;
        }
        
        const refreshToken = session?.getRefreshToken();
        if (refreshToken) {
          cognitoUser.refreshSession(refreshToken, (err, newSession) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(newSession);
          });
        } else {
          resolve(null);
        }
      });
    });
  }
  
  getIdToken(): string | null {
    try {
      const cognitoUser = this.currentUser || this.userPool.getCurrentUser();
      if (!cognitoUser) return null;
      
      const session = cognitoUser.getSignInUserSession();
      if (!session || !session.isValid()) return null;
      
      return session.getIdToken().getJwtToken();
    } catch (error) {
      console.error('Error getting ID token:', error);
      return null;
    }
  }
  
  getAccessToken(): string | null {
    try {
      const cognitoUser = this.currentUser || this.userPool.getCurrentUser();
      if (!cognitoUser) return null;
      
      const session = cognitoUser.getSignInUserSession();
      if (!session || !session.isValid()) return null;
      
      return session.getAccessToken().getJwtToken();
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  }
  
  async confirmSignUp(email: string, code: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });
      
      cognitoUser.confirmRegistration(code, true, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  }
  
  async resendConfirmationCode(email: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });
      
      cognitoUser.resendConfirmationCode((err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  }
  
  async forgotPassword(email: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });
      
      cognitoUser.forgotPassword({
        onSuccess: (result) => {
          resolve(result);
        },
        onFailure: (err) => {
          reject(err);
        },
      });
    });
  }
  
  async confirmPassword(email: string, code: string, newPassword: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });
      
      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => {
          resolve('Password confirmed successfully');
        },
        onFailure: (err) => {
          reject(err);
        },
      });
    });
  }
  
  async getUserAttributes(): Promise<CognitoUserAttribute[]> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.currentUser || this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        reject(new Error('No user logged in'));
        return;
      }
      
      // First ensure we have a valid session
      cognitoUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          reject(new Error('Invalid session'));
          return;
        }
        
        // Now get attributes
        cognitoUser.getUserAttributes((err, attributes) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(attributes || []);
        });
      });
    });
  }
  
  async updateUserAttributes(attributes: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.currentUser || this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        reject(new Error('No user logged in'));
        return;
      }
      
      const attributeList: CognitoUserAttribute[] = [];
      Object.entries(attributes).forEach(([key, value]) => {
        attributeList.push(
          new CognitoUserAttribute({
            Name: key,
            Value: value,
          })
        );
      });
      
      cognitoUser.updateAttributes(attributeList, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  }
  
  // Helper method to decode JWT token
  decodeToken(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  }
  
  // Get user claims from ID token
  getUserClaims(): any {
    const idToken = this.getIdToken();
    if (!idToken) return null;
    
    return this.decodeToken(idToken);
  }
  
  // Check if user is authenticated
  isAuthenticated(): boolean {
    const cognitoUser = this.currentUser || this.userPool.getCurrentUser();
    if (!cognitoUser) return false;
    
    const session = cognitoUser.getSignInUserSession();
    return session !== null && session.isValid();
  }
}

export default new AuthService();
