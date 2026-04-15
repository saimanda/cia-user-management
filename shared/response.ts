import { APIGatewayProxyResult } from 'aws-lambda';

export interface OperationResult {
  operation: string;
  userId: string;
  status: 'success' | 'failed' | 'partial';
  affectedCount?: number;
  retryable?: boolean;
  reason?: string;
  timestamp: string;
}

export function buildResponse(statusCode: number, result: OperationResult): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}

export function successResult(
  operation: string,
  userId: string,
  affectedCount?: number,
): OperationResult {
  return {
    operation,
    userId,
    status: 'success',
    affectedCount,
    timestamp: new Date().toISOString(),
  };
}

export function failedResult(
  operation: string,
  userId: string,
  reason: string,
  retryable: boolean,
): OperationResult {
  return {
    operation,
    userId,
    status: 'failed',
    reason,
    retryable,
    timestamp: new Date().toISOString(),
  };
}

export function partialResult(
  operation: string,
  userId: string,
  reason: string,
  affectedCount: number,
): OperationResult {
  return {
    operation,
    userId,
    status: 'partial',
    reason,
    affectedCount,
    retryable: true,
    timestamp: new Date().toISOString(),
  };
}
