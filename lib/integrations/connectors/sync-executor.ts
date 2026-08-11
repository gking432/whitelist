import {
  validateCanonicalRecord,
  validateConnectorAdapter,
} from "./contract.ts";
import type {
  CanonicalObjectType,
  CanonicalRecord,
  ConnectorAdapter,
  ConnectorContext,
  ConnectorPushInput,
} from "./types.ts";

export type ConnectorSyncJob = {
  id: string;
  direction: "pull" | "push";
  objectType: CanonicalObjectType;
  operation: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
};

export type ConnectorSyncRepository = {
  saveCanonicalRecord(record: CanonicalRecord): Promise<void>;
  saveCursor(cursor: Record<string, unknown> | null): Promise<void>;
  saveObjectLink(input: {
    objectType: CanonicalObjectType;
    nativeObjectId: string;
    externalObjectId: string;
    externalParentId?: string | null;
    externalUpdatedAt?: string | null;
  }): Promise<void>;
};

export type ConnectorSyncOutcome =
  | { ok: true; processed: number; result: Record<string, unknown> }
  | { ok: false; retryable: boolean; error: string };

export function connectorRetryDelayMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts), 60);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function executeConnectorSyncJob(input: {
  adapter: ConnectorAdapter;
  context: ConnectorContext;
  job: ConnectorSyncJob;
  repository: ConnectorSyncRepository;
}): Promise<ConnectorSyncOutcome> {
  const { adapter, context, job, repository } = input;
  const adapterIssues = validateConnectorAdapter(adapter);

  if (adapterIssues.length > 0) {
    return {
      ok: false,
      retryable: false,
      error: `Connector contract failed: ${adapterIssues
        .map((issue) => issue.message)
        .join("; ")}`,
    };
  }

  try {
    if (job.direction === "pull") {
      if (!adapter.pullPage) {
        return { ok: false, retryable: false, error: "Connector cannot pull records." };
      }

      const cursor =
        job.payload.cursor &&
        typeof job.payload.cursor === "object" &&
        !Array.isArray(job.payload.cursor)
          ? (job.payload.cursor as Record<string, unknown>)
          : null;
      const page = await adapter.pullPage(context, job.objectType, cursor);

      for (const record of page.records) {
        const issues = validateCanonicalRecord(record);
        if (record.objectType !== job.objectType) {
          issues.push({
            field: "objectType",
            message: `Expected ${job.objectType}, received ${record.objectType}.`,
          });
        }
        if (issues.length > 0) {
          return {
            ok: false,
            retryable: false,
            error: `Connector returned an invalid record: ${issues
              .map((issue) => issue.message)
              .join("; ")}`,
          };
        }
        await repository.saveCanonicalRecord(record);
      }

      await repository.saveCursor(page.nextCursor);
      return {
        ok: true,
        processed: page.records.length,
        result: { nextCursor: page.nextCursor },
      };
    }

    if (!adapter.pushRecord) {
      return { ok: false, retryable: false, error: "Connector cannot push records." };
    }

    const nativeObjectId = text(job.payload.nativeObjectId);
    const idempotencyKey = text(job.payload.idempotencyKey);
    const data =
      job.payload.data &&
      typeof job.payload.data === "object" &&
      !Array.isArray(job.payload.data)
        ? (job.payload.data as Record<string, unknown>)
        : null;

    if (!nativeObjectId || !idempotencyKey || !data) {
      return {
        ok: false,
        retryable: false,
        error: "Push job is missing nativeObjectId, idempotencyKey, or data.",
      };
    }

    const operation = ["create", "update", "delete"].includes(job.operation)
      ? (job.operation as ConnectorPushInput["operation"])
      : null;
    if (!operation) {
      return { ok: false, retryable: false, error: "Push operation is invalid." };
    }

    const result = await adapter.pushRecord(context, {
      operation,
      objectType: job.objectType,
      nativeObjectId,
      externalObjectId: text(job.payload.externalObjectId),
      data,
      idempotencyKey,
    });

    if (!result.externalObjectId.trim()) {
      return {
        ok: false,
        retryable: false,
        error: "Connector push did not return an external object id.",
      };
    }

    await repository.saveObjectLink({
      objectType: job.objectType,
      nativeObjectId,
      externalObjectId: result.externalObjectId,
      externalParentId: result.externalParentId,
      externalUpdatedAt: result.updatedAt,
    });

    return {
      ok: true,
      processed: 1,
      result: { externalObjectId: result.externalObjectId },
    };
  } catch (error) {
    return {
      ok: false,
      retryable: job.attempts + 1 < job.maxAttempts,
      error: error instanceof Error ? error.message : "Connector sync failed.",
    };
  }
}
