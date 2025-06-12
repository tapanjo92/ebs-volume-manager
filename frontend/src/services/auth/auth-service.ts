    return session.getIdToken().getJwtToken();
  }
  
  getAccessToken(): string | null {
    const cognitoUser = this.userPool.getCurrentUser();
    if (!cognitoUser) return null;
    
    const session = cognitoUser.getSignInUserSession();
    if (!session) return null;
    
    return session.getAccessToken().getJwtToken();
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
  
  getUserAttributes(): Promise<CognitoUserAttribute[]> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        reject(new Error('No user logged in'));
        return;
      }
      
      cognitoUser.getUserAttributes((err, attributes) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(attributes || []);
      });
    });
  }
  
  async updateUserAttributes(attributes: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const cognitoUser = this.userPool.getCurrentUser();
      
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
      return null;
    }
  }
  
  // Get user claims from ID token
  getUserClaims(): any {
    const idToken = this.getIdToken();
    if (!idToken) return null;
    
    return this.decodeToken(idToken);
  }
}

export default new AuthService();
