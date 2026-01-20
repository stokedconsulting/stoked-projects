export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-projects',
  },
  auth: {
    apiKeys: (process.env.API_KEYS || '').split(',').filter(Boolean),
  },
  app: {
    environment: process.env.NODE_ENV || 'development',
    name: 'Claude Projects State Tracking API',
    version: '0.1.0',
  },
});
