/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST Configuration for Claude Projects State Tracking API
 *
 * This configuration deploys a NestJS application as a Lambda function
 * behind API Gateway with custom domain support.
 */
export default $config({
  app(input) {
    return {
      name: "claude-projects-state-api",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    // Get current stage (dev, staging, production)
    const stage = $app.stage;

    // Import secrets for production
    // For dev/staging, you can use .env files or SST secrets
    const mongodbUri = new sst.Secret("MongoDBUri");
    const apiKeys = new sst.Secret("ApiKeys");

    // Create the API Gateway with Lambda function
    const api = new sst.aws.ApiGatewayV2("StateTrackingApi", {
      cors: {
        allowOrigins: ["*"], // TODO: Restrict in production
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Api-Key",
          "X-Requested-With",
        ],
        maxAge: "86400s",
      },

      // Custom domain configuration
      // Note: You'll need to create the certificate in ACM first
      ...(stage === "production" && {
        domain: {
          name: "claude-projects.truapi.com",
          // For non-production, use stage prefix
          // name: `${stage}-claude-projects.truapi.com`,
        },
      }),

      transform: {
        api: {
          // Enable detailed CloudWatch metrics
          defaultRouteSettings: {
            detailedMetricsEnabled: true,
            loggingLevel: "INFO",
            dataTraceEnabled: stage !== "production",
            throttlingBurstLimit: 5000,
            throttlingRateLimit: 2000,
          },
        },
      },
    });

    // Add catch-all route to proxy all requests to the NestJS Lambda
    api.route("ANY /{proxy+}", {
      handler: "src/lambda.handler",
      runtime: "nodejs20.x",

      // Lambda configuration
      memory: "512 MB",
      timeout: "30 seconds",

      // Link secrets to Lambda environment
      link: [mongodbUri, apiKeys],

      // Environment variables
      environment: {
        NODE_ENV: stage === "production" ? "production" : "development",
        PORT: "3000",
        // Secrets are auto-injected via link
      },

      // Build configuration for NestJS
      nodejs: {
        esbuild: {
          external: [
            "@nestjs/microservices",
            "@nestjs/websockets",
            "cache-manager",
            "class-transformer",
            "class-validator",
          ],
          // Bundle all dependencies for Lambda
          bundle: true,
          minify: stage === "production",
          sourcemap: stage !== "production",
          target: "node20",
          format: "cjs",
        },
        // Install dependencies in Lambda layer if needed
        install: ["@nestjs/platform-express"],
      },

      transform: {
        function: {
          // Enable Lambda Insights for monitoring
          // layers: stage === "production"
          //   ? ["arn:aws:lambda:us-east-1:580247275435:layer:LambdaInsightsExtension:14"]
          //   : [],

          // VPC configuration for MongoDB Atlas (if using VPC peering)
          // vpcConfig: stage === "production" ? {
          //   subnetIds: ["subnet-xxx", "subnet-yyy"],
          //   securityGroupIds: ["sg-xxx"],
          // } : undefined,
        },
      },
    });

    // Add health check endpoint
    api.route("GET /health", {
      handler: "src/lambda.handler",
      runtime: "nodejs20.x",
      memory: "256 MB",
      timeout: "10 seconds",
      link: [mongodbUri, apiKeys],
      environment: {
        NODE_ENV: stage === "production" ? "production" : "development",
        PORT: "3000",
      },
    });

    // CloudWatch Log Group for API Gateway
    const logGroup = new aws.cloudwatch.LogGroup("ApiGatewayLogs", {
      name: `/aws/apigateway/claude-projects-state-api-${stage}`,
      retentionInDays: stage === "production" ? 30 : 7,
    });

    // CloudWatch Alarms for monitoring
    if (stage === "production") {
      // Alarm for API errors (5xx)
      new aws.cloudwatch.MetricAlarm("ApiErrorAlarm", {
        name: `claude-projects-state-api-${stage}-errors`,
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 2,
        metricName: "5XXError",
        namespace: "AWS/ApiGateway",
        period: 300, // 5 minutes
        statistic: "Sum",
        threshold: 10,
        alarmDescription: "Triggers when API returns too many 5xx errors",
        dimensions: {
          ApiId: api.nodes.api.id,
        },
        // TODO: Add SNS topic for notifications
        // alarmActions: [snsTopicArn],
      });

      // Alarm for Lambda errors
      new aws.cloudwatch.MetricAlarm("LambdaErrorAlarm", {
        name: `claude-projects-state-api-${stage}-lambda-errors`,
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 2,
        metricName: "Errors",
        namespace: "AWS/Lambda",
        period: 300,
        statistic: "Sum",
        threshold: 5,
        alarmDescription: "Triggers when Lambda function has too many errors",
        // TODO: Add SNS topic for notifications
      });

      // Alarm for Lambda throttles
      new aws.cloudwatch.MetricAlarm("LambdaThrottleAlarm", {
        name: `claude-projects-state-api-${stage}-lambda-throttles`,
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        metricName: "Throttles",
        namespace: "AWS/Lambda",
        period: 60,
        statistic: "Sum",
        threshold: 0,
        alarmDescription: "Triggers when Lambda function is throttled",
        // TODO: Add SNS topic for notifications
      });
    }

    // Output the API endpoint
    return {
      api: api.url,
      stage: stage,
      region: $app.providers?.aws.region || "us-east-1",
    };
  },
});
