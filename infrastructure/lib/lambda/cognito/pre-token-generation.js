// infrastructure/lib/lambda/cognito/pre-token-generation.ts - MISSING!
exports.handler = async (event) => {
  console.log('Pre-token generation event:', JSON.stringify(event, null, 2));
  
  // Add custom claims to JWT
  if (event.request.userAttributes) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: {
        'custom:tenant_id': event.request.userAttributes['custom:tenant_id'] || 'default-tenant',
        'custom:user_role': event.request.userAttributes['custom:user_role'] || 'user',
        'custom:permissions': event.request.userAttributes['custom:permissions'] || 'volumes:read',
      },
    };
  }
  
  return event;
};
