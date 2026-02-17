export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-projects',
  },
  auth: {
    apiKeys: (process.env.API_KEYS || '').split(',').filter(Boolean),
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    oauth: {
      clientId: process.env.GITHUB_CLIENT_ID || 'Ov23liu4KalPYYr8EAX7',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '04cd8185ca939e587bdeb5ba14d8bea62f16b2ee',
      callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:8167/api/auth/github/callback',
    },
  },
  app: {
    environment: process.env.NODE_ENV || 'development',
    name: 'Claude Projects State Tracking API',
    version: '0.1.0',
  },
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG'),
    format: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
  },
  audit: {
    retentionDays: (() => {
      const days = parseInt(process.env.AUDIT_RETENTION_DAYS || '90', 10);
      return isNaN(days) || days <= 0 ? 90 : days;
    })(),
  },
});
