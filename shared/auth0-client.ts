import { ManagementClient } from 'auth0';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

interface Auth0Credentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? 'ap-southeast-2',
});

// Cached across warm Lambda invocations — intentionally module-level.
let cachedClient: ManagementClient | null = null;

/**
 * Returns a singleton ManagementClient, fetching credentials from
 * AWS Secrets Manager on the first cold start.
 *
 * Secret path: /cia/auth0/m2m-credentials
 * Secret shape: { clientId, clientSecret, domain }
 */
export async function getAuth0Client(): Promise<ManagementClient> {
  if (cachedClient) return cachedClient;

  const { SecretString } = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: '/cia/auth0/m2m-credentials' }),
  );

  if (!SecretString) {
    throw new Error('Auth0 M2M credentials secret is empty or missing');
  }

  const { clientId, clientSecret, domain } = JSON.parse(SecretString) as Auth0Credentials;

  cachedClient = new ManagementClient({ domain, clientId, clientSecret });

  return cachedClient;
}

/** Clears the cached client — useful in tests to reset state between cases. */
export function resetAuth0ClientCache(): void {
  cachedClient = null;
}
